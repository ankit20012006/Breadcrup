import { randomUUID } from "node:crypto";
import type { HintService } from "../services/hintService";
import type { ChatService } from "../services/chatService";
import type { Repository, StreamerConnection } from "../store/repository";
import { CHAT_POOLS, CHATTERS, DEMO_CLUES, DEMO_SESSION, DEMO_STREAMER, EXTRA_DEMO_CLUES, SPAM_SCENARIOS } from "./sampleData";

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything here is labelled `source: "demo"` and never touches Twitch. */
export class DemoService {
  private simTimer: NodeJS.Timeout | null = null;
  private extraClueIndex = 0;
  private demoConnection: StreamerConnection | null = null;

  constructor(
    private repo: Repository,
    private hints: HintService,
    private chat: ChatService,
  ) {}

  async ensureDemoStreamer(): Promise<StreamerConnection> {
    if (this.demoConnection) return this.demoConnection;
    const existing = await this.repo.getConnectionByTwitchId(DEMO_STREAMER.twitchUserId);
    this.demoConnection =
      existing ??
      (await this.repo.upsertConnection({
        ...DEMO_STREAMER,
        isDemo: true,
        scopes: [],
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
      }));
    return this.demoConnection;
  }

  /** Seeds one session with sample clues and a little chat history if the demo account is empty. */
  async seed() {
    const streamer = await this.ensureDemoStreamer();
    const sessions = await this.repo.listSessions(streamer.id, 1);
    if (sessions.length === 0) {
      const session = await this.hints.createSession(streamer.id, { ...DEMO_SESSION, showCredits: true });
      for (const clue of DEMO_CLUES) {
        await this.hints.addSubmission(
          session.id,
          { viewerId: `demo:${randomUUID()}`, channelConnectionId: streamer.id, origin: "anonymous" },
          { text: clue.text, displayName: clue.name ?? undefined, creditOptIn: Boolean(clue.name) },
          "demo",
        );
      }
    }
    const recent = await this.repo.countChatMessages(streamer.id, new Date(Date.now() - 10 * 60_000).toISOString());
    if (recent === 0) {
      for (let i = 0; i < 18; i++) await this.randomChat(streamer.id, new Date(Date.now() - (18 - i) * 15_000).toISOString());
    }
    return streamer;
  }

  async addSimulatedClue(sessionId: string) {
    const streamer = await this.ensureDemoStreamer();
    const clue = EXTRA_DEMO_CLUES[this.extraClueIndex++ % EXTRA_DEMO_CLUES.length]!;
    return this.hints.addSubmission(
      sessionId,
      { viewerId: `demo:${randomUUID()}`, channelConnectionId: streamer.id, origin: "anonymous" },
      { text: clue.text, displayName: clue.name ?? undefined, creditOptIn: Boolean(clue.name) },
      "demo",
    );
  }

  async randomChat(streamerId: string, sentAt?: string) {
    const roll = Math.random();
    const pool =
      roll < 0.25 ? CHAT_POOLS.questions : roll < 0.45 ? CHAT_POOLS.suggestions : roll < 0.7 ? CHAT_POOLS.reactions : CHAT_POOLS.chatter;
    const name = pick(CHATTERS);
    await this.chat.ingest(streamerId, {
      twitchMessageId: null,
      chatterUserId: `demo-${name.toLowerCase()}`,
      chatterLogin: name.toLowerCase(),
      chatterDisplayName: name,
      text: pick(pool),
      isPrivileged: false,
      source: "demo",
      sentAt,
    });
  }

  /** Plays a spam scenario so Chat Guard has something real to flag. */
  async spamBurst(streamerId: string, kind: "link" | "copypasta" | "flood" | "mixed" = "mixed") {
    const send = (user: string, text: string) =>
      this.chat.ingest(streamerId, {
        twitchMessageId: null,
        chatterUserId: `demo-${user}`,
        chatterLogin: user,
        chatterDisplayName: user,
        text,
        isPrivileged: false,
        source: "demo",
      });

    if (kind === "link" || kind === "mixed") {
      for (let i = 0; i < 3; i++) await send(SPAM_SCENARIOS.linkPromo.user, SPAM_SCENARIOS.linkPromo.text);
    }
    if (kind === "copypasta" || kind === "mixed") {
      for (const user of SPAM_SCENARIOS.copypasta.users) await send(user, SPAM_SCENARIOS.copypasta.text);
    }
    if (kind === "flood" || kind === "mixed") {
      for (const text of SPAM_SCENARIOS.flood.texts) {
        await send(SPAM_SCENARIOS.flood.user, text);
        await sleep(20);
      }
    }
  }

  startSimulator(isWatched: () => boolean) {
    if (this.simTimer) return;
    let tick = 0;
    this.simTimer = setInterval(async () => {
      if (!isWatched()) return; // only generate chat while the demo dashboard is open
      try {
        const streamer = await this.ensureDemoStreamer();
        await this.randomChat(streamer.id);
        if (++tick % 40 === 0) await this.spamBurst(streamer.id, pick(["link", "copypasta", "flood"] as const));
      } catch (err) {
        console.error("[demo] simulator tick failed", err);
      }
    }, 2500);
    this.simTimer.unref();
  }

  stopSimulator() {
    if (this.simTimer) clearInterval(this.simTimer);
    this.simTimer = null;
  }
}
