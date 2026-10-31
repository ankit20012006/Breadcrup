import { SOCKET_EVENTS, type ChatMessage, type ChatSummary, type ChatSummaryStats, type ModerationFlag } from "@breadcrumb/shared";
import { AiError, type AiProvider } from "../ai/types";
import { validateSummaryOutput } from "../ai/validate";
import type { AppConfig } from "../config";
import { HttpError } from "../middleware/errors";
import type { Realtime } from "../realtime/realtime";
import type { Repository } from "../store/repository";
import { normalize } from "./text";

const MAX_CHARS_PER_MESSAGE = 200;
/** Rough input budget (~4 chars per token) so a busy chat can't blow up a request. */
const MAX_INPUT_CHARS = 16_000;

/**
 * Chat Pulse: summarises batches of real stored chat. Spam (high-confidence or
 * confirmed flags) and duplicates are excluded before anything reaches the AI.
 */
export class ChatPulse {
  private running = new Set<string>();
  private lastWindowEnd = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private repo: Repository,
    private ai: AiProvider,
    private rt: Realtime,
    private cfg: AppConfig["chatPulse"],
  ) {}

  /** Periodic batches for streamers with an open dashboard or live chat. */
  start(activeStreamers: () => Iterable<string>) {
    if (this.cfg.intervalSeconds <= 0) return;
    this.timer = setInterval(async () => {
      for (const streamerId of activeStreamers()) {
        try {
          await this.generate(streamerId, { manual: false });
        } catch (err) {
          if (!(err instanceof HttpError)) console.error("[pulse] batch failed", err);
        }
      }
    }, this.cfg.intervalSeconds * 1000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  list(streamerId: string) {
    return this.repo.listSummaries(streamerId, 10);
  }

  /**
   * @param manual manual refreshes summarise the last 10 minutes; scheduled batches
   * only summarise messages newer than the previous batch and skip small windows.
   */
  async generate(streamerId: string, opts: { manual: boolean }): Promise<ChatSummary | null> {
    if (this.running.has(streamerId)) throw new HttpError(409, "A summary is already being generated", "IN_PROGRESS");
    this.running.add(streamerId);
    try {
      const windowEnd = new Date().toISOString();
      const previous = this.lastWindowEnd.get(streamerId);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const windowStart = opts.manual || !previous ? tenMinutesAgo : previous;

      const messages = await this.repo.listChatMessages(streamerId, windowStart, windowEnd, 2000);
      if (!opts.manual && messages.length < this.cfg.minMessages) return null;

      const flags = await this.repo.listFlags(streamerId, "all", 500);
      const openFlags = flags.filter((f) => f.reviewStatus === "open").length;

      const { analysed, excludedSpam, collapsedDuplicates } = selectForAnalysis(messages, spamFilter(flags), this.cfg.maxMessages);
      const stats: ChatSummaryStats = {
        totalMessages: messages.length,
        uniqueChatters: new Set(messages.map((m) => m.chatterUserId)).size,
        analysedMessages: analysed.length,
        excludedSpam,
        collapsedDuplicates,
        openFlags,
      };
      const source = messages.some((m) => m.source === "live") ? "live" : "demo";
      const base = { streamerId, windowStart, windowEnd, stats, provider: this.ai.name, model: this.ai.model, source } as const;

      if (analysed.length === 0) {
        const summary = await this.repo.insertSummary({ ...base, status: "EMPTY", topics: [], questions: [], suggestions: [], reactions: [], error: null });
        this.lastWindowEnd.set(streamerId, windowEnd);
        this.rt.toStreamer(streamerId, SOCKET_EVENTS.summaryUpdated, summary);
        return summary;
      }

      const refToIds = new Map(analysed.map((g, i) => [`M${i + 1}`, g.ids]));
      const activeSession = await this.repo.getLatestOpenSession(streamerId);
      let summary: ChatSummary;
      try {
        const raw = await this.ai.summarizeChat({
          game: activeSession?.game ?? null,
          messages: analysed.map((g, i) => ({ ref: `M${i + 1}`, text: g.message.text.slice(0, MAX_CHARS_PER_MESSAGE), count: g.ids.length })),
        });
        const validated = validateSummaryOutput(raw, refToIds);
        summary = await this.repo.insertSummary({ ...base, status: "READY", ...validated, error: null });
      } catch (err) {
        const message = err instanceof AiError ? err.message : "Summary generation failed";
        if (!(err instanceof AiError)) console.error("[pulse] summarise failed", err);
        summary = await this.repo.insertSummary({ ...base, status: "ERROR", topics: [], questions: [], suggestions: [], reactions: [], error: message });
      }
      this.lastWindowEnd.set(streamerId, windowEnd);
      this.rt.toStreamer(streamerId, SOCKET_EVENTS.summaryUpdated, summary);
      return summary;
    } finally {
      this.running.delete(streamerId);
    }
  }
}

export interface SpamFilter {
  messageIds: Set<string>;
  /** Accounts with a confirmed or high-confidence flag: all their messages are excluded. */
  userIds: Set<string>;
  /** Normalised text of repetition spam (copy-paste waves etc.): every copy is excluded, flagged or not. */
  texts: Set<string>;
}

const REPETITION: ReadonlySet<ModerationFlag["category"]> = new Set(["copypasta", "duplicate", "near_duplicate"]);

/**
 * Excludes: confirmed spam; open medium/high flags; any open repetition flag (an
 * "obvious duplicate" whatever its confidence). A low-confidence link flag alone
 * doesn't exclude a message. Dismissed flags never do.
 */
export function spamFilter(flags: ModerationFlag[]): SpamFilter {
  const active = flags.filter(
    (f) => f.reviewStatus === "confirmed_spam" || (f.reviewStatus === "open" && (f.confidence !== "low" || REPETITION.has(f.category))),
  );
  return {
    messageIds: new Set(active.map((f) => f.chatMessageId)),
    userIds: new Set(active.filter((f) => f.reviewStatus === "confirmed_spam" || f.confidence === "high").map((f) => f.chatterUserId)),
    texts: new Set(active.filter((f) => REPETITION.has(f.category)).map((f) => normalize(f.messageText))),
  };
}

export interface MessageGroup {
  message: ChatMessage;
  /** This message plus any identical copies collapsed into it. */
  ids: string[];
}

/** Exported for tests: removes spam, collapses exact duplicates (keeping counts), applies count and size budgets. */
export function selectForAnalysis(messages: ChatMessage[], spam: SpamFilter, maxMessages: number) {
  let excludedSpam = 0;
  let collapsedDuplicates = 0;
  const groups = new Map<string, MessageGroup>();
  for (const m of messages) {
    const key = normalize(m.text);
    if (spam.messageIds.has(m.id) || spam.userIds.has(m.chatterUserId) || spam.texts.has(key)) {
      excludedSpam++;
      continue;
    }
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(m.id);
      collapsedDuplicates++;
    } else {
      groups.set(key, { message: m, ids: [m.id] });
    }
  }
  // Most recent entries win when over budget.
  let recent = [...groups.values()].slice(-maxMessages);
  let chars = recent.reduce((n, g) => n + Math.min(g.message.text.length, MAX_CHARS_PER_MESSAGE), 0);
  while (chars > MAX_INPUT_CHARS && recent.length > 1) {
    chars -= Math.min(recent[0]!.message.text.length, MAX_CHARS_PER_MESSAGE);
    recent = recent.slice(1);
  }
  return { analysed: recent, excludedSpam, collapsedDuplicates };
}
