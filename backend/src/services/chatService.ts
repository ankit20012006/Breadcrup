import { SOCKET_EVENTS, type ChatMessage, type DataSource } from "@breadcrumb/shared";
import type { Realtime } from "../realtime/realtime";
import type { Repository } from "../store/repository";
import type { ChatGuard } from "./chatGuard";

export interface IngestInput {
  twitchMessageId: string | null;
  chatterUserId: string;
  chatterLogin: string;
  chatterDisplayName: string;
  text: string;
  isPrivileged: boolean;
  source: DataSource;
  sentAt?: string;
}

/** Stores incoming chat, runs Chat Guard, records flags and notifies the streamer's dashboard. */
export class ChatService {
  private seenTwitchIds = new Map<string, Set<string>>();
  private statTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private repo: Repository,
    private guard: ChatGuard,
    private rt: Realtime,
  ) {}

  async ingest(streamerId: string, input: IngestInput): Promise<ChatMessage | null> {
    if (input.twitchMessageId && this.alreadySeen(streamerId, input.twitchMessageId)) return null;
    const text = input.text.trim().slice(0, 1000);
    if (!text) return null;

    const message = await this.repo.insertChatMessage({
      streamerId,
      twitchMessageId: input.twitchMessageId,
      chatterUserId: input.chatterUserId,
      chatterLogin: input.chatterLogin,
      chatterDisplayName: input.chatterDisplayName,
      text,
      isPrivileged: input.isPrivileged,
      source: input.source,
      sentAt: input.sentAt ?? new Date().toISOString(),
    });

    const verdict = this.guard.evaluate(streamerId, {
      id: message.id,
      chatterUserId: message.chatterUserId,
      text: message.text,
      isPrivileged: message.isPrivileged,
      sentAtMs: Date.parse(message.sentAt),
    });

    if (verdict.flag) {
      const flag = await this.repo.insertFlag({
        streamerId,
        chatMessageId: message.id,
        twitchMessageId: message.twitchMessageId,
        chatterUserId: message.chatterUserId,
        chatterLogin: message.chatterLogin,
        messageText: message.text,
        reasons: verdict.flag.reasons,
        category: verdict.flag.category,
        confidence: verdict.flag.confidence,
        reviewStatus: "open",
        action: "none",
        actionDetail: null,
        history: [{ at: new Date().toISOString(), kind: "flagged", detail: verdict.flag.reasons.map((r) => r.detail).join("; ") }],
        source: message.source,
        messageSentAt: message.sentAt,
      });
      message.flagId = flag.id;
      message.isDuplicate = verdict.isDuplicate;
      await this.repo.updateChatMessage(message.id, { flagId: flag.id, isDuplicate: verdict.isDuplicate });
      this.rt.toStreamer(streamerId, SOCKET_EVENTS.flagCreated, flag);
    } else if (verdict.isDuplicate) {
      message.isDuplicate = true;
      await this.repo.updateChatMessage(message.id, { isDuplicate: true });
    }

    this.scheduleStats(streamerId);
    return message;
  }

  /** Message counts for the dashboard, computed from stored data. */
  async stats(streamerId: string, sinceMinutes = 10) {
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const [messages, openFlags] = await Promise.all([
      this.repo.listChatMessages(streamerId, since, new Date().toISOString(), 5000),
      this.repo.listFlags(streamerId, "open", 500),
    ]);
    const sources = new Set(messages.map((m) => m.source));
    return {
      windowMinutes: sinceMinutes,
      messages: messages.length,
      uniqueChatters: new Set(messages.map((m) => m.chatterUserId)).size,
      flagged: messages.filter((m) => m.flagId).length,
      duplicates: messages.filter((m) => m.isDuplicate).length,
      openFlags: openFlags.length,
      sources: [...sources],
      recent: messages.slice(-25).map((m) => ({
        id: m.id,
        chatter: m.chatterDisplayName,
        text: m.text,
        flagged: Boolean(m.flagId),
        duplicate: m.isDuplicate,
        source: m.source,
        sentAt: m.sentAt,
      })),
    };
  }

  /** Throttle live stat pushes to at most one per second per channel. */
  private scheduleStats(streamerId: string) {
    if (this.statTimers.has(streamerId)) return;
    const timer = setTimeout(async () => {
      this.statTimers.delete(streamerId);
      try {
        this.rt.toStreamer(streamerId, SOCKET_EVENTS.chatStats, await this.stats(streamerId));
      } catch (err) {
        console.error("[chat] stats push failed", err);
      }
    }, 1000);
    timer.unref();
    this.statTimers.set(streamerId, timer);
  }

  private alreadySeen(streamerId: string, id: string) {
    let set = this.seenTwitchIds.get(streamerId);
    if (!set) this.seenTwitchIds.set(streamerId, (set = new Set()));
    if (set.has(id)) return true;
    set.add(id);
    if (set.size > 2000) set.delete(set.values().next().value!);
    return false;
  }
}
