import { createHash } from "node:crypto";
import {
  HINT_TIER_LABELS,
  LIMITS,
  SOCKET_EVENTS,
  type Contributor,
  type CreateSessionInput,
  type CreateSubmissionInput,
  type DataSource,
  type HintSession,
  type HintSet,
  type HintSubmission,
  type HintTier,
  type HintTierEntry,
  type PublicOverlayState,
  type PublicSessionInfo,
  type SessionDetail,
  type TierApproval,
} from "@breadcrumb/shared";
import { AiError, type AiProvider } from "../ai/types";
import { validateHintOutput } from "../ai/validate";
import { looksLikePromptInjection } from "./clueSafety";
import { HttpError } from "../middleware/errors";
import type { ViewerIdentity } from "../middleware/auth";
import type { Realtime } from "../realtime/realtime";
import type { Repository } from "../store/repository";

const TIERS: HintTier[] = [1, 2, 3];

export class HintService {
  private inFlight = new Set<string>();

  constructor(
    private repo: Repository,
    private ai: AiProvider,
    private rt: Realtime,
  ) {}

  // ---- sessions -----------------------------------------------------------

  async createSession(streamerId: string, input: CreateSessionInput): Promise<HintSession> {
    const session = await this.repo.createSession({ streamerId, ...input });
    this.rt.toStreamer(streamerId, SOCKET_EVENTS.sessionUpdated, session);
    return session;
  }

  listSessions(streamerId: string) {
    return this.repo.listSessions(streamerId, 25);
  }

  /** 404 (not 403) for other streamers' sessions so IDs can't be probed. */
  async getOwnedSession(streamerId: string, sessionId: string): Promise<HintSession> {
    const session = await this.repo.getSession(sessionId);
    if (!session || session.streamerId !== streamerId) throw new HttpError(404, "Session not found", "NOT_FOUND");
    return session;
  }

  async detail(streamerId: string, sessionId: string): Promise<SessionDetail> {
    const session = await this.getOwnedSession(streamerId, sessionId);
    const [submissions, hintSet] = await Promise.all([this.repo.listSubmissions(sessionId), this.repo.getActiveHintSet(sessionId)]);
    return {
      session,
      submissions,
      hintSet,
      overlay: buildOverlayState(session, hintSet, submissions),
      contributors: revealedContributors(session, hintSet, submissions),
    };
  }

  async close(streamerId: string, sessionId: string): Promise<HintSession> {
    const session = await this.getOwnedSession(streamerId, sessionId);
    if (session.status === "closed") return session;
    const closed = await this.repo.updateSession(sessionId, { status: "closed", closedAt: new Date().toISOString() });
    this.rt.toStreamer(streamerId, SOCKET_EVENTS.sessionClosed, closed);
    await this.pushOverlay(closed);
    return closed;
  }

  // ---- submissions ----------------------------------------------------------

  async addSubmission(
    sessionId: string,
    viewer: ViewerIdentity,
    input: CreateSubmissionInput,
    source?: DataSource,
  ): Promise<Pick<HintSubmission, "id" | "status" | "createdAt">> {
    const session = await this.repo.getSession(sessionId);
    if (!session) throw new HttpError(404, "Session not found", "NOT_FOUND");
    if (viewer.channelConnectionId && viewer.channelConnectionId !== session.streamerId) {
      throw new HttpError(403, "This session belongs to a different channel", "WRONG_CHANNEL");
    }
    if (session.status !== "collecting") throw new HttpError(409, "This hint session is closed", "SESSION_CLOSED");

    const existing = await this.repo.listSubmissions(sessionId);
    const mine = existing.filter((s) => s.viewerId === viewer.viewerId);
    if (mine.length >= LIMITS.submissionsPerViewerPerSession) {
      throw new HttpError(429, `You can submit up to ${LIMITS.submissionsPerViewerPerSession} clues per session`, "SUBMISSION_LIMIT");
    }
    const windowStart = Date.now() - LIMITS.submissionBurstWindowSeconds * 1000;
    if (mine.filter((s) => Date.parse(s.createdAt) > windowStart).length >= LIMITS.submissionBurstMax) {
      throw new HttpError(429, `Please wait a minute before sending another clue`, "SUBMISSION_RATE");
    }
    const normalized = input.text.toLowerCase().replace(/\s+/g, " ");
    if (mine.some((s) => s.text.toLowerCase().replace(/\s+/g, " ") === normalized)) {
      throw new HttpError(409, "You already sent this clue", "DUPLICATE_SUBMISSION");
    }

    const submission = await this.repo.addSubmission({
      sessionId,
      viewerId: viewer.viewerId,
      viewerDisplayName: input.displayName || null,
      creditOptIn: Boolean(input.creditOptIn && input.displayName),
      text: input.text,
      source: source ?? ((await this.repo.getConnection(session.streamerId))?.isDemo ? "demo" : "live"),
    });
    this.rt.toStreamer(session.streamerId, SOCKET_EVENTS.submissionCreated, submission);
    return { id: submission.id, status: submission.status, createdAt: submission.createdAt };
  }

  async setSubmissionStatus(streamerId: string, sessionId: string, submissionId: string, status: HintSubmission["status"]) {
    await this.getOwnedSession(streamerId, sessionId);
    const submissions = await this.repo.listSubmissions(sessionId);
    if (!submissions.some((s) => s.id === submissionId)) throw new HttpError(404, "Submission not found", "NOT_FOUND");
    const updated = await this.repo.updateSubmission(submissionId, { status });
    this.rt.toStreamer(streamerId, SOCKET_EVENTS.sessionUpdated, { sessionId, submission: updated });
    return updated;
  }

  /** Viewer-facing view of their own clues only. */
  async viewerView(sessionId: string, viewer: ViewerIdentity) {
    const session = await this.repo.getSession(sessionId);
    if (!session) throw new HttpError(404, "Session not found", "NOT_FOUND");
    if (viewer.channelConnectionId && viewer.channelConnectionId !== session.streamerId) {
      throw new HttpError(403, "This session belongs to a different channel", "WRONG_CHANNEL");
    }
    const mine = (await this.repo.listSubmissions(sessionId))
      .filter((s) => s.viewerId === viewer.viewerId)
      .map((s) => ({ id: s.id, text: s.text, status: s.status, createdAt: s.createdAt }));
    return {
      session: toPublicSession(session),
      mySubmissions: mine,
      remaining: Math.max(0, LIMITS.submissionsPerViewerPerSession - mine.length),
    };
  }

  async activeSessionForChannel(streamerId: string): Promise<PublicSessionInfo | null> {
    const session = await this.repo.getLatestOpenSession(streamerId);
    return session ? toPublicSession(session) : null;
  }

  // ---- generation -----------------------------------------------------------

  async generate(
    streamerId: string,
    sessionId: string,
    opts: { force: boolean; tier?: HintTier },
  ): Promise<{ hintSet: HintSet; cached: boolean }> {
    const session = await this.getOwnedSession(streamerId, sessionId);
    if (session.status !== "collecting") throw new HttpError(409, "Closed sessions can't be regenerated", "SESSION_CLOSED");
    if (opts.tier && opts.tier <= session.currentRevealedTier) {
      throw new HttpError(409, `Tier ${opts.tier} is already public and can't be regenerated`, "TIER_REVEALED");
    }
    if (this.inFlight.has(sessionId)) throw new HttpError(409, "Hints are already being generated for this session", "IN_PROGRESS");

    const all = await this.repo.listSubmissions(sessionId);
    const candidates = all.filter((s) => s.status !== "rejected");
    // Clues that read like instructions to the AI are never sent to it.
    const suspicious = candidates.filter((s) => looksLikePromptInjection(s.text));
    const usable = candidates.filter((s) => !suspicious.includes(s)).slice(-LIMITS.maxSubmissionsPerGeneration);
    const inputHash = hashInput(session, usable, opts.tier);
    const active = await this.repo.getActiveHintSet(sessionId);

    if (!opts.force && active && active.inputHash === inputHash) return { hintSet: active, cached: true };

    this.inFlight.add(sessionId);
    try {
      const refToId = new Map(usable.map((s, i) => [`C${i + 1}`, s.id]));
      let validated;
      if (usable.length === 0) {
        validated = { status: "NEED_MORE_CLUES" as const, reason: "No usable clues yet. Rejected clues are excluded.", tiers: [], flaggedSubmissionIds: [] };
      } else {
        try {
          const raw = await this.ai.generateHints({
            game: session.game,
            question: session.question,
            context: session.context,
            clues: usable.map((s, i) => ({ ref: `C${i + 1}`, text: s.text })),
          });
          validated = validateHintOutput(raw, refToId);
        } catch (err) {
          throw aiHttpError(err);
        }
      }
      if (suspicious.length > 0) {
        validated = {
          ...validated,
          reason: [validated.reason, `${suspicious.length} clue(s) read like instructions to the AI rather than gameplay tips, so they were not sent to it.`]
            .filter(Boolean)
            .join(" "),
          flaggedSubmissionIds: [...new Set([...validated.flaggedSubmissionIds, ...suspicious.map((s) => s.id)])],
        };
      }

      const fresh = new Map(validated.tiers.map((t) => [t.tier, t]));
      const previous = new Map((active?.tiers ?? []).map((t) => [t.tier, t]));
      const tiers: HintTierEntry[] = [];
      for (const tier of TIERS) {
        const old = previous.get(tier);
        const keepOld = tier <= session.currentRevealedTier || (opts.tier !== undefined && tier !== opts.tier);
        if (keepOld && old) {
          tiers.push(old);
          continue;
        }
        const next = fresh.get(tier);
        if (next) tiers.push({ ...next, approval: "pending", revealedAt: null });
      }

      if (opts.tier && !fresh.has(opts.tier)) {
        throw new HttpError(422, `Couldn't produce tier ${opts.tier}: ${validated.reason ?? "not enough supporting clues"}`, validated.status);
      }

      const hintSet = await this.repo.insertHintSet({
        sessionId,
        status: opts.tier && active ? (tiers.length === 3 ? active.status : "NEED_REVIEW") : validated.status,
        reason: validated.reason,
        flaggedSubmissionIds: validated.flaggedSubmissionIds,
        tiers,
        provider: this.ai.name,
        model: this.ai.model,
        inputHash,
      });
      this.rt.toStreamer(streamerId, SOCKET_EVENTS.hintsGenerated, { sessionId, hintSet });
      return { hintSet, cached: false };
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  // ---- review & reveal ------------------------------------------------------

  async decideTier(streamerId: string, sessionId: string, tier: HintTier, decision: TierApproval): Promise<HintSet> {
    const session = await this.getOwnedSession(streamerId, sessionId);
    if (session.status !== "collecting") throw new HttpError(409, "This session is closed", "SESSION_CLOSED");
    const set = await this.requireActiveSet(sessionId);
    if (tier <= session.currentRevealedTier) throw new HttpError(409, `Tier ${tier} is already public`, "TIER_REVEALED");
    const entry = set.tiers.find((t) => t.tier === tier);
    if (!entry && decision !== "skipped") throw new HttpError(409, `Tier ${tier} has no generated text to review`, "TIER_MISSING");

    const tiers = entry
      ? set.tiers.map((t) => (t.tier === tier ? { ...t, approval: decision } : t))
      : [...set.tiers, { tier, text: "", supportingSubmissionIds: [], approval: "skipped" as const, revealedAt: null }].sort((a, b) => a.tier - b.tier);
    const updated = await this.repo.updateHintSet(set.id, { tiers });
    this.rt.toStreamer(streamerId, SOCKET_EVENTS.hintApproval, { sessionId, tier, decision, hintSet: updated });
    return updated;
  }

  async editTier(streamerId: string, sessionId: string, tier: HintTier, text: string): Promise<HintSet> {
    const session = await this.getOwnedSession(streamerId, sessionId);
    if (session.status !== "collecting") throw new HttpError(409, "This session is closed", "SESSION_CLOSED");
    const set = await this.requireActiveSet(sessionId);
    if (tier <= session.currentRevealedTier) throw new HttpError(409, `Tier ${tier} is already public`, "TIER_REVEALED");
    const entry = set.tiers.find((t) => t.tier === tier);
    if (!entry || !entry.text) throw new HttpError(409, `Tier ${tier} has no generated text to edit`, "TIER_MISSING");
    // Edits return to "pending" so a changed hint is always re-approved explicitly.
    const tiers = set.tiers.map((t) => (t.tier === tier ? { ...t, text, approval: "pending" as const } : t));
    const updated = await this.repo.updateHintSet(set.id, { tiers });
    this.rt.toStreamer(streamerId, SOCKET_EVENTS.hintApproval, { sessionId, tier, decision: "pending", hintSet: updated });
    return updated;
  }

  async revealNext(streamerId: string, sessionId: string): Promise<{ session: HintSession; overlay: PublicOverlayState }> {
    const session = await this.getOwnedSession(streamerId, sessionId);
    if (session.status !== "collecting") throw new HttpError(409, "This session is closed", "SESSION_CLOSED");
    const set = await this.requireActiveSet(sessionId);

    const next = TIERS.find((t) => t > session.currentRevealedTier && set.tiers.find((e) => e.tier === t)?.approval !== "skipped");
    if (!next) throw new HttpError(409, "Every tier has already been revealed or skipped", "NOTHING_TO_REVEAL");
    const entry = set.tiers.find((t) => t.tier === next);
    if (!entry || !entry.text) throw new HttpError(409, `Tier ${next} hasn't been generated yet`, "TIER_MISSING");
    if (entry.approval !== "approved") {
      throw new HttpError(409, `Approve tier ${next} (or skip it) before revealing`, "NOT_APPROVED");
    }

    const revealedAt = new Date().toISOString();
    const updatedSet = await this.repo.updateHintSet(set.id, {
      tiers: set.tiers.map((t) => (t.tier === next ? { ...t, revealedAt } : t)),
    });
    const updated = await this.repo.updateSession(sessionId, { currentRevealedTier: next });
    const overlay = buildOverlayState(updated, updatedSet, await this.repo.listSubmissions(sessionId));

    this.rt.toStreamer(streamerId, SOCKET_EVENTS.hintRevealed, { sessionId, tier: next, session: updated, hintSet: updatedSet });
    this.rt.toOverlay(sessionId, overlay);
    return { session: updated, overlay };
  }

  // ---- public ---------------------------------------------------------------

  async publicOverlay(sessionId: string): Promise<PublicOverlayState | null> {
    const session = await this.repo.getSession(sessionId);
    if (!session) return null;
    const [set, submissions] = await Promise.all([this.repo.getActiveHintSet(sessionId), this.repo.listSubmissions(sessionId)]);
    return buildOverlayState(session, set, submissions);
  }

  private async pushOverlay(session: HintSession) {
    const [set, submissions] = await Promise.all([this.repo.getActiveHintSet(session.id), this.repo.listSubmissions(session.id)]);
    this.rt.toOverlay(session.id, buildOverlayState(session, set, submissions));
  }

  private async requireActiveSet(sessionId: string): Promise<HintSet> {
    const set = await this.repo.getActiveHintSet(sessionId);
    if (!set) throw new HttpError(409, "Generate hints first", "NO_HINTS");
    return set;
  }
}

// ---- pure helpers (exported for tests) ---------------------------------------

/**
 * The single place where public overlay data is assembled. Only the tier equal to
 * currentRevealedTier — which was approved and explicitly revealed — is included.
 */
export function buildOverlayState(session: HintSession, set: HintSet | null, submissions: HintSubmission[]): PublicOverlayState {
  const base: PublicOverlayState = { sessionId: session.id, game: session.game, status: session.status, revealed: null, totalTiers: 3 };
  if (!set || session.currentRevealedTier === 0) return base;
  const entry = set.tiers.find((t) => t.tier === session.currentRevealedTier);
  if (!entry || !entry.revealedAt || entry.approval !== "approved") return base;
  return {
    ...base,
    revealed: {
      tier: entry.tier,
      label: HINT_TIER_LABELS[entry.tier],
      text: entry.text,
      revealedAt: entry.revealedAt,
      credits: session.showCredits ? creditsFor(entry.supportingSubmissionIds, submissions) : [],
    },
  };
}

function creditsFor(ids: string[], submissions: HintSubmission[]): Contributor[] {
  const names = new Set<string>();
  for (const s of submissions) {
    if (ids.includes(s.id) && s.creditOptIn && s.viewerDisplayName && s.status !== "rejected") names.add(s.viewerDisplayName);
  }
  return [...names].map((displayName) => ({ displayName }));
}

function revealedContributors(session: HintSession, set: HintSet | null, submissions: HintSubmission[]): Contributor[] {
  if (!set) return [];
  const ids = set.tiers.filter((t) => t.revealedAt && t.tier <= session.currentRevealedTier).flatMap((t) => t.supportingSubmissionIds);
  return creditsFor(ids, submissions);
}

export function toPublicSession(s: HintSession): PublicSessionInfo {
  return { id: s.id, game: s.game, question: s.question, status: s.status, currentRevealedTier: s.currentRevealedTier, createdAt: s.createdAt };
}

function hashInput(session: HintSession, submissions: HintSubmission[], tier?: HintTier): string {
  const payload = JSON.stringify({
    g: session.game,
    q: session.question,
    c: session.context,
    s: submissions.map((s) => [s.id, s.text]),
    t: tier ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function aiHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof AiError) {
    // Setup problems (bad key/model/quota) are 503; upstream or output problems are 502.
    const status = err.code === "RATE_LIMITED" ? 429 : err.code === "TIMEOUT" ? 504 : ["AUTH", "MODEL", "QUOTA"].includes(err.code) ? 503 : 502;
    return new HttpError(status, err.message, `AI_${err.code}`);
  }
  console.error("[hints] unexpected generation failure", err);
  return new HttpError(502, "Hint generation failed", "AI_UPSTREAM");
}
