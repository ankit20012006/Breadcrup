import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatSummary, HintSession, HintSet, HintSubmission, ModerationFlag } from "@breadcrumb/shared";
import {
  NotFoundError,
  type NewChatMessage,
  type NewConnection,
  type NewFlag,
  type NewHintSet,
  type NewSession,
  type NewSubmission,
  type NewSummary,
  type Repository,
  type StreamerConnection,
} from "./repository";

const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

/** Volatile store for demo mode and tests. Data is lost on restart by design. */
export class MemoryRepository implements Repository {
  readonly kind = "memory" as const;

  private connections = new Map<string, StreamerConnection>();
  private sessions = new Map<string, HintSession>();
  private submissions = new Map<string, HintSubmission>();
  private hintSets = new Map<string, HintSet>();
  private chat = new Map<string, ChatMessage>();
  private flags = new Map<string, ModerationFlag>();
  private summaries = new Map<string, ChatSummary>();

  /** Caps keep a long-running demo process from growing without bound. */
  private static readonly MAX_CHAT = 5000;

  async upsertConnection(input: NewConnection) {
    const existing = [...this.connections.values()].find((c) => c.twitchUserId === input.twitchUserId);
    if (existing) return this.updateConnection(existing.id, input);
    const row: StreamerConnection = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.connections.set(row.id, row);
    return clone(row);
  }

  async getConnection(id: string) {
    const row = this.connections.get(id);
    return row ? clone(row) : null;
  }

  async getConnectionByTwitchId(twitchUserId: string) {
    const row = [...this.connections.values()].find((c) => c.twitchUserId === twitchUserId);
    return row ? clone(row) : null;
  }

  async listTokenConnections() {
    return [...this.connections.values()].filter((c) => !c.isDemo && c.accessTokenEnc).map(clone);
  }

  async updateConnection(id: string, patch: Partial<NewConnection>) {
    const row = this.connections.get(id);
    if (!row) throw new NotFoundError("Connection");
    const next = { ...row, ...patch, updatedAt: now() };
    this.connections.set(id, next);
    return clone(next);
  }

  async createSession(input: NewSession) {
    const row: HintSession = {
      ...input,
      id: randomUUID(),
      status: "collecting",
      currentRevealedTier: 0,
      createdAt: now(),
      updatedAt: now(),
      closedAt: null,
    };
    this.sessions.set(row.id, row);
    return clone(row);
  }

  async getSession(id: string) {
    const row = this.sessions.get(id);
    return row ? clone(row) : null;
  }

  async listSessions(streamerId: string, limit: number) {
    return [...this.sessions.values()]
      .filter((s) => s.streamerId === streamerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async getLatestOpenSession(streamerId: string) {
    const [latest] = (await this.listSessions(streamerId, 50)).filter((s) => s.status === "collecting");
    return latest ?? null;
  }

  async updateSession(id: string, patch: Partial<HintSession>) {
    const row = this.sessions.get(id);
    if (!row) throw new NotFoundError("Session");
    const next = { ...row, ...patch, id, updatedAt: now() };
    this.sessions.set(id, next);
    return clone(next);
  }

  async addSubmission(input: NewSubmission) {
    const row: HintSubmission = { ...input, id: randomUUID(), status: "pending", createdAt: now() };
    this.submissions.set(row.id, row);
    return clone(row);
  }

  async listSubmissions(sessionId: string) {
    return [...this.submissions.values()]
      .filter((s) => s.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async updateSubmission(id: string, patch: Partial<HintSubmission>) {
    const row = this.submissions.get(id);
    if (!row) throw new NotFoundError("Submission");
    const next = { ...row, ...patch, id };
    this.submissions.set(id, next);
    return clone(next);
  }

  async insertHintSet(input: NewHintSet) {
    const existing = [...this.hintSets.values()].filter((h) => h.sessionId === input.sessionId);
    for (const set of existing) set.isActive = false;
    const version = existing.reduce((max, h) => Math.max(max, h.version), 0) + 1;
    const row: HintSet = { ...input, id: randomUUID(), version, isActive: true, createdAt: now() };
    this.hintSets.set(row.id, row);
    return clone(row);
  }

  async getActiveHintSet(sessionId: string) {
    const row = [...this.hintSets.values()].find((h) => h.sessionId === sessionId && h.isActive);
    return row ? clone(row) : null;
  }

  async updateHintSet(id: string, patch: Partial<HintSet>) {
    const row = this.hintSets.get(id);
    if (!row) throw new NotFoundError("Hint set");
    const next = { ...row, ...patch, id };
    this.hintSets.set(id, next);
    return clone(next);
  }

  async insertChatMessage(input: NewChatMessage) {
    const row: ChatMessage = { ...input, id: randomUUID(), flagId: null, isDuplicate: false };
    this.chat.set(row.id, row);
    if (this.chat.size > MemoryRepository.MAX_CHAT) {
      const oldest = this.chat.keys().next().value;
      if (oldest) this.chat.delete(oldest);
    }
    return clone(row);
  }

  async updateChatMessage(id: string, patch: Partial<ChatMessage>) {
    const row = this.chat.get(id);
    if (row) this.chat.set(id, { ...row, ...patch, id });
  }

  async listChatMessages(streamerId: string, since: string, until: string, limit: number) {
    return [...this.chat.values()]
      .filter((m) => m.streamerId === streamerId && m.sentAt > since && m.sentAt <= until)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
      .slice(-limit)
      .map(clone);
  }

  async countChatMessages(streamerId: string, since: string) {
    let count = 0;
    for (const m of this.chat.values()) if (m.streamerId === streamerId && m.sentAt > since) count++;
    return count;
  }

  async insertFlag(input: NewFlag) {
    const row: ModerationFlag = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.flags.set(row.id, row);
    return clone(row);
  }

  async getFlag(id: string) {
    const row = this.flags.get(id);
    return row ? clone(row) : null;
  }

  async listFlags(streamerId: string, status: ModerationFlag["reviewStatus"] | "all", limit: number) {
    return [...this.flags.values()]
      .filter((f) => f.streamerId === streamerId && (status === "all" || f.reviewStatus === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async updateFlag(id: string, patch: Partial<ModerationFlag>) {
    const row = this.flags.get(id);
    if (!row) throw new NotFoundError("Flag");
    const next = { ...row, ...patch, id, updatedAt: now() };
    this.flags.set(id, next);
    return clone(next);
  }

  async insertSummary(input: NewSummary) {
    const row: ChatSummary = { ...input, id: randomUUID(), createdAt: now() };
    this.summaries.set(row.id, row);
    return clone(row);
  }

  async listSummaries(streamerId: string, limit: number) {
    return [...this.summaries.values()]
      .filter((s) => s.streamerId === streamerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }
}
