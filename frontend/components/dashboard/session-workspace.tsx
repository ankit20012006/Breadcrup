"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Eye,
  Flag,
  FlaskConical,
  Loader2,
  Lock,
  MonitorPlay,
  Pencil,
  RefreshCw,
  SkipForward,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  HINT_TIER_LABELS,
  LIMITS,
  type HintSet,
  type HintSubmission,
  type HintTier,
  type HintTierEntry,
  type SessionDetail,
} from "@breadcrumb/shared";
import { CrumbMark } from "@/components/logo";
import { OverlayCard } from "@/components/overlay-card";
import { useToast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import type { Dashboard } from "./useDashboard";

const TIERS: HintTier[] = [1, 2, 3];

export function SessionWorkspace({ dash }: { dash: Dashboard }) {
  const { detail } = dash;
  if (!dash.selectedId) {
    return (
      <Card className="grid min-h-80 place-items-center p-8 text-center">
        <div>
          <CrumbMark className="mx-auto size-10" lit={0} />
          <p className="mt-3 font-display font-semibold">No session selected</p>
          <p className="mt-1 text-sm text-muted">Create a hint session when you get stuck. Viewers can then send you clues privately.</p>
        </div>
      </Card>
    );
  }
  if (!detail) {
    if (dash.detailError) {
      return (
        <Card role="alert" className="grid min-h-80 place-items-center p-8 text-center">
          <div>
            <p className="font-medium text-ember">Couldn&apos;t load this session</p>
            <p className="mt-1 text-sm text-muted">{dash.detailError}</p>
            <Button className="mt-4" variant="outline" onClick={() => void dash.reload.detail()}>
              <RefreshCw /> Retry
            </Button>
          </div>
        </Card>
      );
    }
    return (
      <Card className="grid min-h-80 place-items-center text-muted">
        <Loader2 className="size-5 animate-spin" aria-label="Loading session" />
      </Card>
    );
  }
  return <Workspace dash={dash} detail={detail} />;
}

function Workspace({ dash, detail }: { dash: Dashboard; detail: SessionDetail }) {
  const toast = useToast();
  const { session, submissions, hintSet } = detail;
  const [busy, setBusy] = React.useState<string | null>(null);
  const actionInFlight = React.useRef(false);
  const isOpen = session.status === "collecting";

  /** Runs a mutating request, then refreshes; returns true on success. */
  const act = React.useCallback(
    async (key: string, path: string, body: unknown = {}, method = "POST", success?: string) => {
      if (actionInFlight.current) return null;
      actionInFlight.current = true;
      setBusy(key);
      try {
        const res = await dash.call<any>(path, { method, body });
        await Promise.all([dash.reload.detail(), dash.reload.sessions()]);
        if (success) toast("success", success);
        return res;
      } catch (err) {
        toast("error", errorMessage(err));
        return null;
      } finally {
        actionInFlight.current = false;
        setBusy(null);
      }
    },
    [dash, toast],
  );

  const clueNumber = React.useMemo(() => new Map(submissions.map((s, i) => [s.id, i + 1])), [submissions]);
  const nextTier = TIERS.find((t) => t > session.currentRevealedTier && hintSet?.tiers.find((e) => e.tier === t)?.approval !== "skipped");
  const nextEntry = nextTier ? hintSet?.tiers.find((t) => t.tier === nextTier) : undefined;
  const revealBlocker = !isOpen
    ? "This session is closed."
    : !hintSet
      ? "Generate hints first."
      : !nextTier
        ? "Every tier has been revealed or skipped."
        : !nextEntry?.text
          ? `Tier ${nextTier} hasn't been generated.`
          : nextEntry.approval !== "approved"
            ? `Approve tier ${nextTier} (or skip it) to reveal it.`
            : null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const overlayUrl = `${origin}/overlay/${session.id}`;
  const viewerUrl = `${origin}/extension?session=${session.id}`;
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast("success", `${what} copied`),
      () => toast("error", "Clipboard unavailable. Select and copy the link manually."),
    );

  return (
    <div className="min-w-0 space-y-5">
      {/* Session header */}
      <Card>
        <CardContent className="flex flex-wrap items-start gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold tracking-tight">{session.game}</h2>
              {isOpen ? <Badge variant="sage">Collecting clues</Badge> : <Badge>Closed</Badge>}
            </div>
            <p className="mt-1 text-sm">{session.question}</p>
            {session.context && <p className="mt-1 text-xs text-muted">Context: {session.context}</p>}
            <p className="mt-2 text-[11px] text-subtle">Opened {timeAgo(session.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => copy(overlayUrl, "OBS overlay URL")}>
              <MonitorPlay /> Overlay URL
            </Button>
            <Button variant="outline" size="sm" onClick={() => copy(viewerUrl, "Viewer link")}>
              <Copy /> Viewer link
            </Button>
            {isOpen && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  if (confirm("Close this session? Viewers will no longer be able to submit clues.")) {
                    void act("close", `/api/sessions/${session.id}/close`, {}, "POST", "Session closed");
                  }
                }}
              >
                Close session
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <CluesCard dash={dash} detail={detail} busy={busy} act={act} clueNumber={clueNumber} />

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Hint ladder</CardTitle>
                <CardDescription>Private until you reveal it. Only the revealed tier is sent to the overlay.</CardDescription>
              </div>
              <Button
                size="sm"
                variant={hintSet ? "outline" : "default"}
                disabled={!isOpen || busy !== null}
                onClick={async () => {
                  const res = await act("generate", `/api/sessions/${session.id}/generate`, { force: Boolean(hintSet) });
                  if (res?.cached) toast("info", "Nothing changed since the last generation, so the existing ladder was kept.");
                }}
              >
                {busy === "generate" ? <Loader2 className="animate-spin" /> : hintSet ? <RefreshCw /> : <Sparkles />}
                {hintSet ? "Regenerate unrevealed" : "Generate hints"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {hintSet ? <HintSetBanner set={hintSet} /> : <p className="rounded-lg border border-dashed border-border-strong p-4 text-sm text-muted">No hints yet. Once a few clues arrive, generate a ladder and review each tier before revealing it.</p>}
              {TIERS.map((tier) => (
                <TierCard
                  key={tier}
                  tier={tier}
                  entry={hintSet?.tiers.find((t) => t.tier === tier)}
                  revealed={tier <= session.currentRevealedTier}
                  isNext={tier === nextTier}
                  disabled={!isOpen || busy !== null}
                  busyKey={busy}
                  clueNumber={clueNumber}
                  submissions={submissions}
                  hasSet={Boolean(hintSet)}
                  onDecision={(decision) => act(`decide-${tier}`, `/api/sessions/${session.id}/tiers/decision`, { tier, decision })}
                  onEdit={(text) => act(`edit-${tier}`, `/api/sessions/${session.id}/tiers`, { tier, text }, "PATCH", `Tier ${tier} updated. Approve it again to reveal.`)}
                  onRegenerate={() => act(`regen-${tier}`, `/api/sessions/${session.id}/generate`, { tier, force: true }, "POST", `Tier ${tier} regenerated`)}
                />
              ))}

              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-center gap-2">
                  <CrumbMark className="size-7" lit={session.currentRevealedTier} />
                  <div>
                    <p className="text-sm font-medium">{session.currentRevealedTier === 0 ? "Nothing revealed yet" : `Tier ${session.currentRevealedTier} is on stream`}</p>
                    <p className="text-xs text-muted">{revealBlocker ?? `Next: Tier ${nextTier} · ${HINT_TIER_LABELS[nextTier!]}`}</p>
                  </div>
                </div>
                <Button
                  variant="signal"
                  className="ml-auto"
                  disabled={Boolean(revealBlocker) || busy !== null}
                  onClick={() => act("reveal", `/api/sessions/${session.id}/reveal-next`, {}, "POST", `Tier ${nextTier} revealed on the overlay`)}
                >
                  {busy === "reveal" ? <Loader2 className="animate-spin" /> : <Eye />} Reveal next hint
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <MonitorPlay className="size-4 text-signal" /> Live overlay preview
              </CardTitle>
              <CardDescription>Exactly what your OBS Browser Source shows right now.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border bg-[repeating-conic-gradient(#1b1820_0_25%,#141217_0_50%)] bg-[length:18px_18px] p-5">
                <OverlayCard state={detail.overlay} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Contributors credited so far:</span>
                {detail.contributors.length ? (
                  detail.contributors.map((c) => (
                    <Badge key={c.displayName} variant="crust">
                      {c.displayName}
                    </Badge>
                  ))
                ) : (
                  <span className="text-subtle">{session.showCredits ? "none yet (only viewers who opt in are credited)" : "credits are turned off for this session"}</span>
                )}
              </div>
              <p className="mt-2 break-all font-mono text-[11px] text-subtle">{overlayUrl}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HintSetBanner({ set }: { set: HintSet }) {
  const tone = set.status === "READY" ? "sage" : set.status === "NEED_MORE_CLUES" ? "muted" : "crust";
  const label = { READY: "Ready for review", NEED_REVIEW: "Needs your review", NEED_MORE_CLUES: "Needs more clues", ERROR: "Generation error" }[set.status];
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm",
        tone === "sage" && "border-sage/25 bg-sage-soft",
        tone === "crust" && "border-crust/30 bg-crust-soft",
        tone === "muted" && "border-border-strong bg-surface-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("font-medium", tone === "sage" && "text-sage", tone === "crust" && "text-crust")}>{label}</span>
        <span className="text-xs text-subtle">
          v{set.version} · {set.provider === "openai" ? `OpenAI ${set.model ?? ""}` : "demo heuristic (not AI)"} · {timeAgo(set.createdAt)}
        </span>
      </div>
      {set.reason && <p className="mt-1 text-xs leading-relaxed text-muted">{set.reason}</p>}
      <p className="mt-1 text-[11px] text-subtle">Hints come from viewer clues and can be wrong or too revealing. Check each one before you reveal it.</p>
    </div>
  );
}

function TierCard(props: {
  tier: HintTier;
  entry: HintTierEntry | undefined;
  revealed: boolean;
  isNext: boolean;
  disabled: boolean;
  busyKey: string | null;
  hasSet: boolean;
  clueNumber: Map<string, number>;
  submissions: HintSubmission[];
  onDecision: (d: "approved" | "rejected" | "skipped" | "pending") => void;
  onEdit: (text: string) => Promise<unknown>;
  onRegenerate: () => void;
}) {
  const { tier, entry, revealed, isNext, disabled } = props;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(entry?.text ?? "");
  React.useEffect(() => setDraft(entry?.text ?? ""), [entry?.text]);

  const approval = entry?.approval ?? "pending";
  const hasText = Boolean(entry?.text);
  const state = revealed
    ? { label: "On stream", variant: "signal" as const, icon: <Eye /> }
    : approval === "approved"
      ? { label: "Approved · private", variant: "sage" as const, icon: <Check /> }
      : approval === "rejected"
        ? { label: "Rejected", variant: "ember" as const, icon: <X /> }
        : approval === "skipped"
          ? { label: "Skipped", variant: "default" as const, icon: <SkipForward /> }
          : { label: hasText ? "Pending review · private" : "Not generated", variant: "crust" as const, icon: <Lock /> };

  return (
    <section
      aria-label={`Tier ${tier}`}
      className={cn(
        "rounded-xl border p-4 transition-colors",
        revealed ? "border-signal/50 bg-signal-soft" : "border-dashed border-crust/30 bg-surface-2",
        isNext && !revealed && "border-solid border-crust/60",
        approval === "skipped" && !revealed && "opacity-60",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <CrumbMark className="size-4" lit={tier} />
        <h4 className="text-sm font-semibold">
          Tier {tier} · {HINT_TIER_LABELS[tier]}
        </h4>
        {isNext && !revealed && <Badge variant="outline">Next</Badge>}
        <Badge variant={state.variant} className="ml-auto">
          {state.icon} {state.label}
        </Badge>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft} maxLength={LIMITS.hintTextMaxLength} onChange={(e) => setDraft(e.target.value)} aria-label={`Edit tier ${tier}`} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!draft.trim() || disabled}
              onClick={async () => {
                const result = await props.onEdit(draft.trim());
                if (result) setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : hasText ? (
        <p className={cn("text-sm leading-relaxed", approval === "rejected" && "text-muted line-through")}>{entry!.text}</p>
      ) : (
        <p className="text-sm text-subtle">{props.hasSet ? (approval === "skipped" ? "Skipped." : "Not enough supporting clues for this tier yet.") : "Waiting for generation."}</p>
      )}

      {hasText && entry!.supportingSubmissionIds.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
          Based on
          {entry!.supportingSubmissionIds.map((id) => {
            const sub = props.submissions.find((s) => s.id === id);
            return (
              <span key={id} title={sub?.text} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-muted">
                clue #{props.clueNumber.get(id) ?? "?"}
              </span>
            );
          })}
        </p>
      )}

      {!revealed && props.hasSet && !editing && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {hasText && approval !== "approved" && (
            <Button size="sm" variant="success" disabled={disabled} onClick={() => props.onDecision("approved")}>
              {props.busyKey === `decide-${tier}` ? <Loader2 className="animate-spin" /> : <Check />} Approve
            </Button>
          )}
          {hasText && approval !== "rejected" && (
            <Button size="sm" variant="danger" disabled={disabled} onClick={() => props.onDecision("rejected")}>
              <X /> Reject
            </Button>
          )}
          {approval !== "pending" && hasText && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => props.onDecision("pending")}>
              <Undo2 /> Undo
            </Button>
          )}
          {approval !== "skipped" && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => props.onDecision("skipped")}>
              <SkipForward /> Skip
            </Button>
          )}
          {hasText && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={disabled} onClick={props.onRegenerate}>
            {props.busyKey === `regen-${tier}` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Regenerate
          </Button>
        </div>
      )}
    </section>
  );
}

function CluesCard({
  dash,
  detail,
  busy,
  act,
  clueNumber,
}: {
  dash: Dashboard;
  detail: SessionDetail;
  busy: string | null;
  act: (key: string, path: string, body?: unknown, method?: string, success?: string) => Promise<unknown>;
  clueNumber: Map<string, number>;
}) {
  const { session, submissions, hintSet } = detail;
  const flagged = new Set(hintSet?.flaggedSubmissionIds ?? []);
  const usedIn = (id: string) => (hintSet?.tiers ?? []).filter((t) => t.supportingSubmissionIds.includes(id)).map((t) => t.tier);

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            Incoming clues <span className="font-sans text-sm font-normal text-muted">({submissions.length})</span>
          </CardTitle>
          <CardDescription>Private to you. Viewers never see each other&apos;s clues.</CardDescription>
        </div>
        {dash.me?.isDemo && session.status === "collecting" && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("sim-clue", `/api/demo/sessions/${session.id}/clue`, {}, "POST", "Simulated viewer clue added")}>
            <FlaskConical /> Simulate clue
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {submissions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-muted">
            Waiting for clues. Share the viewer link, or have viewers open the Breadcrumb extension panel.
          </div>
        ) : (
          <ol className="space-y-2">
            {submissions.map((s) => {
              const tiers = usedIn(s.id);
              return (
                <li key={s.id} className={cn("rounded-lg border border-border bg-surface-2 p-3", s.status === "rejected" && "opacity-55")}>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-mono text-subtle">#{clueNumber.get(s.id)}</span>
                    <span className="font-medium text-muted">{s.viewerDisplayName ?? "Anonymous viewer"}</span>
                    {s.creditOptIn && <Badge variant="crust">credit ok</Badge>}
                    {s.source === "demo" && <Badge variant="outline">demo</Badge>}
                    {flagged.has(s.id) && (
                      <Badge variant="ember" title="The generator marked this clue as contradictory, unclear or manipulative">
                        <Flag /> needs review
                      </Badge>
                    )}
                    {tiers.length > 0 && <Badge variant="signal">used in tier {tiers.join(", ")}</Badge>}
                    <span className="ml-auto text-subtle">{timeAgo(s.createdAt)}</span>
                  </div>
                  <p className={cn("text-sm break-words", s.status === "rejected" && "line-through")}>{s.text}</p>
                  <div className="mt-2 flex justify-end">
                    {s.status === "rejected" ? (
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(`sub-${s.id}`, `/api/sessions/${session.id}/submissions/${s.id}`, { status: "pending" }, "PATCH")}>
                        <Undo2 /> Restore
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(`sub-${s.id}`, `/api/sessions/${session.id}/submissions/${s.id}`, { status: "rejected" }, "PATCH")}>
                        <X /> Exclude from hints
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
