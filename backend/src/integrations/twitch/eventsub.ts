import WebSocket from "ws";
import type { Repository, StreamerConnection } from "../../store/repository";
import { createChatMessageSubscription } from "./helix";
import type { TwitchTokenManager } from "./tokenManager";

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const PRIVILEGED_BADGES = new Set(["broadcaster", "moderator", "vip", "lead_moderator"]);
const MAX_SUBSCRIPTION_RETRIES = 3;
const MAX_SUBSCRIPTION_FAILURE_CYCLES = 6;

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
  private subscriptionRetryTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepaliveSeconds = 30;
  private stopped = false;
  private subscribed = false;
  private attempts = 0;
  private subscriptionRetries = 0;
  private subscriptionFailureCycles = 0;
  private subscribingSocket: WebSocket | null = null;
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
    this.clearSubscriptionRetry();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
        if (!isReconnect) this.subscriptionRetries = 0;
        this.keepaliveSeconds = msg.payload?.session?.keepalive_timeout_seconds ?? this.keepaliveSeconds;
        if (isReconnect) {
          previous?.removeAllListeners("close");
          previous?.close();
        }
        if (!this.subscribed) void this.subscribe(msg.payload.session.id, ws);
      } else if (type === "session_reconnect") {
        this.clearSubscriptionRetry();
        if (!this.subscribed) this.subscriptionRetries = 0;
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
      if (this.ws === ws) this.ws = null;
      this.subscribed = false;
      this.clearKeepalive();
      this.clearSubscriptionRetry();
      if (this.stopped) return;
      this.lastError = `Chat connection closed (code ${code}); reconnecting`;
      this.scheduleFreshConnect();
    });

    ws.on("error", (err) => {
      this.lastError = `Chat connection error: ${err.message}`;
    });

    this.ws = ws;
  }

  private scheduleFreshConnect(delayOverride?: number) {
    if (this.stopped || this.reconnectTimer) return;
    const delay = delayOverride ?? Math.min(60_000, 1000 * 2 ** this.attempts++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.baseUrl);
    }, delay);
    this.reconnectTimer.unref();
  }

  private async subscribe(sessionId: string, ws: WebSocket) {
    if (this.stopped || this.ws !== ws || ws.readyState !== WebSocket.OPEN || this.subscribed || this.subscribingSocket === ws) return;
    this.subscribingSocket = ws;
    try {
      const connection = await this.repo.getConnection(this.connectionId);
      if (!connection) return this.stop();
      let token = await this.tokens.getAccessToken(connection);
      let res = await this.createSubscription(token, connection.twitchUserId, connection.twitchUserId, sessionId);
      if (res.status === 401) {
        token = await this.tokens.getAccessToken(connection, { forceRefresh: true });
        res = await this.createSubscription(token, connection.twitchUserId, connection.twitchUserId, sessionId);
      }
      if (this.stopped || this.ws !== ws) return;
      if (res.status === 409 && /already exists|already subscribed/i.test(res.error ?? "")) {
        this.subscribed = true;
        this.subscriptionRetries = 0;
        this.subscriptionFailureCycles = 0;
        this.lastError = null;
        console.log(`[eventsub] chat subscription already active for ${connection.login}`);
        return;
      }
      if (!res.ok) {
        const message = `Subscription failed (${res.status}): ${res.error}`;
        if (res.status === 0 || res.status === 429 || res.status >= 500) {
          this.retrySubscription(sessionId, ws, message);
          return;
        }
        this.lastError = message;
        console.error(`[eventsub] ${this.lastError}`);
        return;
      }
      this.subscribed = true;
      this.subscriptionRetries = 0;
      this.subscriptionFailureCycles = 0;
      this.lastError = null;
      console.log(`[eventsub] listening to chat for ${connection.login}`);
    } catch (err) {
      if (this.stopped || this.ws !== ws) return;
      this.retrySubscription(sessionId, ws, err instanceof Error ? err.message : String(err));
    } finally {
      if (this.subscribingSocket === ws) this.subscribingSocket = null;
    }
  }

  private retrySubscription(sessionId: string, ws: WebSocket, message: string) {
    if (this.stopped || this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
    this.lastError = message;
    if (this.subscriptionRetries >= MAX_SUBSCRIPTION_RETRIES) {
      this.subscriptionRetries = 0;
      this.subscriptionFailureCycles++;
      if (this.subscriptionFailureCycles > MAX_SUBSCRIPTION_FAILURE_CYCLES) {
        this.lastError = `${message}; automatic recovery paused after repeated failures`;
        console.error(`[eventsub] ${this.lastError}`);
        return;
      }
      const delay = Math.min(60_000, 1000 * 2 ** (this.subscriptionFailureCycles - 1));
      console.error(`[eventsub] ${message}; reconnecting to obtain a fresh subscription session`);
      this.subscribed = false;
      this.clearKeepalive();
      if (this.ws === ws) this.ws = null;
      ws.removeAllListeners("close");
      ws.terminate();
      this.scheduleFreshConnect(delay);
      return;
    }

    const delay = 250 * 2 ** this.subscriptionRetries++;
    this.subscriptionRetryTimer = setTimeout(() => {
      this.subscriptionRetryTimer = null;
      void this.subscribe(sessionId, ws);
    }, delay);
    this.subscriptionRetryTimer.unref();
  }

  private clearSubscriptionRetry() {
    if (this.subscriptionRetryTimer) clearTimeout(this.subscriptionRetryTimer);
    this.subscriptionRetryTimer = null;
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
