import WebSocket from "ws";
import type { Repository, StreamerConnection } from "../../store/repository";
import { createChatMessageSubscription } from "./helix";
import type { TwitchTokenManager } from "./tokenManager";

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const PRIVILEGED_BADGES = new Set(["broadcaster", "moderator", "vip", "lead_moderator"]);

export interface IncomingChatMessage {
  twitchMessageId: string;
  chatterUserId: string;
  chatterLogin: string;
  chatterDisplayName: string;
  text: string;
  isPrivileged: boolean;
  sentAt: string;
}

export type ChatHandler = (connectionId: string, message: IncomingChatMessage) => void;

export interface ChatConnectionStatus {
  connected: boolean;
  subscribed: boolean;
  lastError: string | null;
}

/**
 * One EventSub WebSocket per connected streamer, subscribed to channel.chat.message
 * (user token with user:read:chat). Handles keepalive timeouts, session_reconnect
 * hand-over and revocations. Twitch requires subscribing within 10s of the welcome.
 */
export class EventSubManager {
  private clients = new Map<string, EventSubClient>();
  private errors = new Map<string, string>();

  constructor(
    private repo: Repository,
    private tokens: TwitchTokenManager,
    private onChat: ChatHandler,
    /** Overridable for tests; defaults to Twitch's EventSub WebSocket endpoint. */
    private url: string = EVENTSUB_URL,
    private subscribe: typeof createChatMessageSubscription = createChatMessageSubscription,
  ) {}

  async start(connection: StreamerConnection) {
    this.stop(connection.id);
    if (connection.isDemo || !connection.accessTokenEnc) return;
    if (!connection.scopes.includes("user:read:chat")) {
      const message = "Missing user:read:chat permission. Reconnect Twitch and grant chat access.";
      this.errors.set(connection.id, message);
      console.warn(`[eventsub] ${connection.login}: ${message}`);
      return;
    }
    this.errors.delete(connection.id);
    const client = new EventSubClient(connection.id, this.repo, this.tokens, this.onChat, this.url, this.subscribe);
    this.clients.set(connection.id, client);
    client.connect(this.url);
  }

  async startAll() {
    for (const connection of await this.repo.listTokenConnections()) await this.start(connection);
  }

  status(connectionId: string): ChatConnectionStatus {
    return this.clients.get(connectionId)?.status() ?? { connected: false, subscribed: false, lastError: this.errors.get(connectionId) ?? null };
  }

  stop(connectionId: string) {
    this.clients.get(connectionId)?.stop();
    this.clients.delete(connectionId);
    this.errors.delete(connectionId);
  }

  stopAll() {
    for (const client of this.clients.values()) client.stop();
    this.clients.clear();
    this.errors.clear();
  }
}

class EventSubClient {
  private ws: WebSocket | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private keepaliveSeconds = 30;
  private stopped = false;
  private subscribed = false;
  private attempts = 0;
  private lastError: string | null = null;
  private seen: string[] = [];

  constructor(
    private connectionId: string,
    private repo: Repository,
    private tokens: TwitchTokenManager,
    private onChat: ChatHandler,
    private baseUrl: string,
    private createSubscription: typeof createChatMessageSubscription,
  ) {}

  status(): ChatConnectionStatus {
    return { connected: this.ws?.readyState === WebSocket.OPEN, subscribed: this.subscribed, lastError: this.lastError };
  }

  stop() {
    this.stopped = true;
    this.clearKeepalive();
    this.ws?.close();
  }

  /** @param isReconnect true when following a session_reconnect: subscriptions carry over. */
  connect(url: string, isReconnect = false) {
    if (this.stopped) return;
    const previous = this.ws;
    const ws = new WebSocket(url);

    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      const type = msg?.metadata?.message_type;
      this.armKeepalive();

      if (type === "session_welcome") {
        this.ws = ws;
        this.attempts = 0;
        this.keepaliveSeconds = msg.payload?.session?.keepalive_timeout_seconds ?? this.keepaliveSeconds;
        if (isReconnect) {
          previous?.removeAllListeners("close");
          previous?.close();
        } else {
          void this.subscribe(msg.payload.session.id);
        }
      } else if (type === "session_reconnect") {
        this.connect(msg.payload.session.reconnect_url, true);
      } else if (type === "notification" && msg.metadata.subscription_type === "channel.chat.message") {
        if (this.isRepeat(msg.metadata.message_id)) return;
        const e = msg.payload.event;
        this.onChat(this.connectionId, {
          twitchMessageId: e.message_id,
          chatterUserId: e.chatter_user_id,
          chatterLogin: e.chatter_user_login,
          chatterDisplayName: e.chatter_user_name,
          text: String(e.message?.text ?? "").slice(0, 1000),
          isPrivileged: (e.badges ?? []).some((b: { set_id: string }) => PRIVILEGED_BADGES.has(b.set_id)),
          sentAt: msg.metadata.message_timestamp ?? new Date().toISOString(),
        });
      } else if (type === "revocation") {
        this.subscribed = false;
        this.lastError = `Twitch revoked the chat subscription (${msg.payload?.subscription?.status ?? "unknown"}). Reconnect Twitch.`;
        console.warn(`[eventsub] ${this.lastError}`);
      }
    });

    ws.on("close", (code) => {
      if (this.ws !== ws && this.ws !== null) return; // superseded by a reconnect hand-over
      this.subscribed = false;
      this.clearKeepalive();
      if (this.stopped) return;
      this.lastError = `Chat connection closed (code ${code}); reconnecting`;
      this.scheduleFreshConnect();
    });

    ws.on("error", (err) => {
      this.lastError = `Chat connection error: ${err.message}`;
    });

    if (!isReconnect) this.ws = ws;
  }

  private scheduleFreshConnect() {
    const delay = Math.min(60_000, 1000 * 2 ** this.attempts++);
    setTimeout(() => this.connect(this.baseUrl), delay).unref();
  }

  private async subscribe(sessionId: string) {
    try {
      const connection = await this.repo.getConnection(this.connectionId);
      if (!connection) return this.stop();
      let token = await this.tokens.getAccessToken(connection);
      let res = await this.createSubscription(token, connection.twitchUserId, connection.twitchUserId, sessionId);
      if (res.status === 401) {
        token = await this.tokens.getAccessToken(connection, { forceRefresh: true });
        res = await this.createSubscription(token, connection.twitchUserId, connection.twitchUserId, sessionId);
      }
      if (!res.ok) throw new Error(`Subscription failed (${res.status}): ${res.error}`);
      this.subscribed = true;
      this.lastError = null;
      console.log(`[eventsub] listening to chat for ${connection.login}`);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[eventsub] ${this.lastError}`);
    }
  }

  private armKeepalive() {
    this.clearKeepalive();
    this.keepaliveTimer = setTimeout(() => {
      // No message or keepalive in time: the connection is dead. Start fresh (resubscribe).
      this.lastError = "Keepalive timeout; reconnecting";
      const dead = this.ws;
      this.ws = null;
      dead?.removeAllListeners("close");
      dead?.terminate();
      this.subscribed = false;
      this.scheduleFreshConnect();
    }, (this.keepaliveSeconds + 10) * 1000);
    this.keepaliveTimer.unref();
  }

  private clearKeepalive() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  private isRepeat(messageId: string): boolean {
    if (this.seen.includes(messageId)) return true;
    this.seen.push(messageId);
    if (this.seen.length > 500) this.seen.shift();
    return false;
  }
}
