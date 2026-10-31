import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../src/config";
import { EventSubManager, type IncomingChatMessage } from "../src/integrations/twitch/eventsub";
import { createChatMessageSubscription, deleteChatMessage } from "../src/integrations/twitch/helix";
import { buildAuthorizeUrl } from "../src/integrations/twitch/oauth";
import { TwitchTokenManager } from "../src/integrations/twitch/tokenManager";
import { MemoryRepository } from "../src/store/memoryRepository";
import { encryptToken } from "../src/services/tokenCrypto";

/**
 * Protocol-level tests for the Twitch integration using local stand-ins. These follow the
 * message shapes in Twitch's EventSub WebSocket and Helix docs; they are NOT tests
 * against Twitch itself.
 */

const servers: WebSocketServer[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  vi.unstubAllGlobals();
});

function wsServer(onConnect: (ws: WebSocket) => void) {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", onConnect);
  servers.push(wss);
  return `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
}

const meta = (type: string, extra: Record<string, unknown> = {}) => ({
  message_id: crypto.randomUUID(),
  message_type: type,
  message_timestamp: new Date().toISOString(),
  ...extra,
});
const welcome = (id: string) => JSON.stringify({ metadata: meta("session_welcome"), payload: { session: { id, status: "connected", keepalive_timeout_seconds: 10, reconnect_url: null } } });
const chat = (messageId: string, text: string, badges: { set_id: string }[] = [], metaId = crypto.randomUUID()) =>
  JSON.stringify({
    metadata: { ...meta("notification"), message_id: metaId, subscription_type: "channel.chat.message", subscription_version: "1" },
    payload: {
      subscription: { type: "channel.chat.message" },
      event: {
        broadcaster_user_id: "1971641",
        chatter_user_id: "4145994",
        chatter_user_login: "viewer32",
        chatter_user_name: "Viewer32",
        message_id: messageId,
        message: { text, fragments: [] },
        badges,
      },
    },
  });
const until = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function liveConnection(repo: MemoryRepository) {
  return repo.upsertConnection({
    twitchUserId: "1971641",
    login: "streamer",
    displayName: "Streamer",
    isDemo: false,
    scopes: ["user:read:chat", "moderator:manage:chat_messages"],
    accessTokenEnc: encryptToken("user-access-token"),
    refreshTokenEnc: encryptToken("refresh"),
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
}

describe("EventSub WebSocket client", () => {
  it("subscribes after session_welcome, maps chat notifications, de-duplicates redeliveries and survives session_reconnect", async () => {
    const repo = new MemoryRepository();
    const connection = await liveConnection(repo);
    const received: IncomingChatMessage[] = [];
    const subscribe = vi.fn(async () => ({ ok: true, status: 202, data: { data: [{ id: "sub", status: "enabled" }] }, error: null }));

    let secondSocket: WebSocket | null = null;
    const reconnectUrl = wsServer((ws) => {
      secondSocket = ws;
      ws.send(welcome("session-2"));
    });
    let firstSocket: WebSocket | null = null;
    let firstClosed = false;
    const url = wsServer((ws) => {
      firstSocket = ws;
      ws.on("close", () => (firstClosed = true));
      ws.send(welcome("session-1"));
    });

    const manager = new EventSubManager(repo, new TwitchTokenManager(repo), (_id, m) => received.push(m), url, subscribe as typeof createChatMessageSubscription);
    await manager.start(connection);

    await until(() => subscribe.mock.calls.length === 1);
    expect(subscribe).toHaveBeenCalledWith("user-access-token", "1971641", "1971641", "session-1");
    await until(() => manager.status(connection.id).subscribed);

    const metaId = crypto.randomUUID();
    firstSocket!.send(chat("msg-1", "hello chat", [], metaId));
    firstSocket!.send(chat("msg-1", "hello chat", [], metaId)); // redelivery, same metadata id
    firstSocket!.send(chat("msg-2", "!rules", [{ set_id: "moderator" }]));
    await until(() => received.length === 2);
    expect(received[0]).toMatchObject({ twitchMessageId: "msg-1", chatterUserId: "4145994", chatterLogin: "viewer32", chatterDisplayName: "Viewer32", text: "hello chat", isPrivileged: false });
    expect(received[1]).toMatchObject({ twitchMessageId: "msg-2", isPrivileged: true });

    // Reconnect hand-over: connect to the new URL, keep subscriptions (no resubscribe), close the old socket.
    firstSocket!.send(JSON.stringify({ metadata: meta("session_reconnect"), payload: { session: { id: "session-1", status: "reconnecting", reconnect_url: reconnectUrl } } }));
    await until(() => secondSocket !== null && firstClosed);
    secondSocket!.send(chat("msg-3", "after reconnect"));
    await until(() => received.length === 3);
    expect(subscribe).toHaveBeenCalledTimes(1);

    manager.stopAll();
  });

  it("refreshes the token and retries once when Twitch rejects the subscription with 401", async () => {
    const repo = new MemoryRepository();
    const connection = await liveConnection(repo);
    const subscribe = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, data: null, error: "Invalid OAuth token" })
      .mockResolvedValueOnce({ ok: true, status: 202, data: null, error: null });
    const tokens = new TwitchTokenManager(repo);
    const getAccessToken = vi.spyOn(tokens, "getAccessToken").mockResolvedValueOnce("old-token").mockResolvedValueOnce("new-token");
    const url = wsServer((ws) => ws.send(welcome("s")));
    const manager = new EventSubManager(repo, tokens, () => undefined, url, subscribe);
    await manager.start(connection);
    await until(() => manager.status(connection.id).subscribed);
    expect(getAccessToken).toHaveBeenLastCalledWith(expect.anything(), { forceRefresh: true });
    expect(subscribe.mock.calls.map((c) => c[0])).toEqual(["old-token", "new-token"]);
    manager.stopAll();
  });

  it("does not connect accounts missing the user:read:chat scope", async () => {
    const repo = new MemoryRepository();
    const connection = await repo.upsertConnection({ ...(await liveConnection(repo)), twitchUserId: "2", scopes: [] });
    const subscribe = vi.fn();
    const manager = new EventSubManager(repo, new TwitchTokenManager(repo), () => undefined, "ws://127.0.0.1:9", subscribe);
    await manager.start(connection);
    expect(manager.status(connection.id)).toEqual({
      connected: false,
      subscribed: false,
      lastError: "Missing user:read:chat permission. Reconnect Twitch and grant chat access.",
    });
  });

  it("stops a connected account and clears its EventSub status", async () => {
    const repo = new MemoryRepository();
    const connection = await liveConnection(repo);
    const url = wsServer((ws) => ws.send(welcome("stop-test")));
    const subscribe = vi.fn(async () => ({ ok: true, status: 202, data: null, error: null }));
    const manager = new EventSubManager(repo, new TwitchTokenManager(repo), () => undefined, url, subscribe);
    await manager.start(connection);
    await until(() => manager.status(connection.id).subscribed);

    manager.stop(connection.id);

    expect(manager.status(connection.id)).toEqual({ connected: false, subscribed: false, lastError: null });
  });
});

describe("Helix requests match Twitch's documented shapes", () => {
  it("Delete Chat Messages and Create EventSub Subscription", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    });

    const del = await deleteChatMessage("tok", "11111", "11111", "abc-123-def");
    expect(del).toMatchObject({ ok: true, status: 204 });
    expect(calls[0]!.url).toBe("https://api.twitch.tv/helix/moderation/chat?broadcaster_id=11111&moderator_id=11111&message_id=abc-123-def");
    expect(calls[0]!.init.method).toBe("DELETE");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(Object.keys(calls[0]!.init.headers as object)).toContain("Client-Id");

    await createChatMessageSubscription("tok", "1971641", "1971641", "ws-session");
    expect(calls[1]!.url).toBe("https://api.twitch.tv/helix/eventsub/subscriptions");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: "1971641", user_id: "1971641" },
      transport: { method: "websocket", session_id: "ws-session" },
    });
  });

  it("reports Twitch's error message on failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Forbidden", status: 403, message: "The user in moderator_id is not one of the broadcaster's moderators" }), { status: 403 }));
    const res = await deleteChatMessage("tok", "1", "2", "m");
    expect(res).toMatchObject({ ok: false, status: 403, error: "The user in moderator_id is not one of the broadcaster's moderators" });
  });

  it("uses the registered callback and requests chat access without exposing a client secret", () => {
    if (!config.twitch.oauthConfigured) {
      expect(() => buildAuthorizeUrl("state")).toThrow(/not configured/);
      return;
    }

    const authorize = new URL(buildAuthorizeUrl("signed-state"));
    expect(authorize.origin + authorize.pathname).toBe("https://id.twitch.tv/oauth2/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe(config.twitch.redirectUri);
    expect(new URL(config.twitch.redirectUri!).pathname).toBe("/api/auth/twitch/callback");
    expect(authorize.searchParams.get("scope")).toContain("user:read:chat");
    expect(authorize.searchParams.has("client_secret")).toBe(false);
  });
});
