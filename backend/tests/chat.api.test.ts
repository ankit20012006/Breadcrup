import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ModerationFlag } from "@breadcrumb/shared";
import { selectForAnalysis } from "../src/services/chatPulse";
import { makeStreamer, setup } from "./helpers";

describe("Chat Guard API & moderation actions", () => {
  it("demo flags are 'deleted' only as a labelled simulation, without calling Twitch", async () => {
    const deleteMessage = vi.fn();
    const { app, services } = setup({ deleteMessage });
    const streamer = await makeStreamer(services, { demo: true });
    await services.demo.spamBurst(streamer.connection.id, "link");

    const flags: ModerationFlag[] = (await request(app).get("/api/moderation/flags").set(streamer.auth).expect(200)).body;
    expect(flags.length).toBeGreaterThan(0);
    const flag = flags[0]!;
    expect(flag.source).toBe("demo");

    const res = await request(app).post(`/api/moderation/flags/${flag.id}/action`).set(streamer.auth).send({ action: "delete_message" }).expect(200);
    expect(res.body.flag.action).toBe("demo_deleted");
    expect(res.body.flag.actionDetail).toMatch(/No Twitch API request/);
    expect(deleteMessage).not.toHaveBeenCalled();

    await request(app).post(`/api/moderation/flags/${flag.id}/action`).set(streamer.auth).send({ action: "delete_message" }).expect(409);
  });

  it("live deletion requires the moderator scope and records Twitch's real response", async () => {
    const deleteMessage = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, data: null, error: "The user in moderator_id is not one of the broadcaster's moderators" });
    const { app, services } = setup({ deleteMessage });

    const noScope = await makeStreamer(services, { scopes: ["user:read:chat"] });
    await services.chat.ingest(noScope.connection.id, { twitchMessageId: "tw-1", chatterUserId: "x", chatterLogin: "x", chatterDisplayName: "x", text: "buy followers at cheapviewz.xyz", isPrivileged: false, source: "live" });
    const [f1] = (await request(app).get("/api/moderation/flags").set(noScope.auth)).body as ModerationFlag[];
    const denied = await request(app).post(`/api/moderation/flags/${f1!.id}/action`).set(noScope.auth).send({ action: "delete_message" }).expect(403);
    expect(denied.body.code).toBe("MISSING_SCOPE");

    const mod = await makeStreamer(services, { scopes: ["user:read:chat", "moderator:manage:chat_messages"], twitchUserId: "1337" });
    await services.chat.ingest(mod.connection.id, { twitchMessageId: "tw-2", chatterUserId: "y", chatterLogin: "y", chatterDisplayName: "y", text: "best viewers on cheapviewz.xyz", isPrivileged: false, source: "live" });
    const [f2] = (await request(app).get("/api/moderation/flags").set(mod.auth)).body as ModerationFlag[];

    const failed = await request(app).post(`/api/moderation/flags/${f2!.id}/action`).set(mod.auth).send({ action: "delete_message" }).expect(200);
    expect(failed.body.ok).toBe(false);
    expect(failed.body.flag.action).toBe("delete_failed");
    expect(failed.body.flag.actionDetail).toContain("HTTP 403");
    expect(deleteMessage).toHaveBeenCalledWith("access-token", "1337", "1337", "tw-2");

    deleteMessage.mockResolvedValueOnce({ ok: true, status: 204, data: null, error: null });
    const ok = await request(app).post(`/api/moderation/flags/${f2!.id}/action`).set(mod.auth).send({ action: "delete_message" }).expect(200);
    expect(ok.body.flag.action).toBe("deleted");
    expect(ok.body.flag.reviewStatus).toBe("confirmed_spam");
    expect(ok.body.flag.history.map((h: { kind: string }) => h.kind)).toEqual(["flagged", "action", "action"]);

    // Other streamers can't touch this flag.
    await request(app).post(`/api/moderation/flags/${f2!.id}/review`).set(noScope.auth).send({ status: "dismissed" }).expect(404);
  });

  it("reviews flags and never bans", async () => {
    const { app, services } = setup();
    const streamer = await makeStreamer(services, { demo: true });
    await services.demo.spamBurst(streamer.connection.id, "flood");
    const [flag] = (await request(app).get("/api/moderation/flags").set(streamer.auth)).body as ModerationFlag[];
    const res = await request(app).post(`/api/moderation/flags/${flag!.id}/review`).set(streamer.auth).send({ status: "dismissed" }).expect(200);
    expect(res.body.reviewStatus).toBe("dismissed");
    const cfg = await request(app).get("/api/moderation/config").set(streamer.auth).expect(200);
    expect(cfg.body.autoBan).toBe(false);
  });

  it("ignores redelivered Twitch messages", async () => {
    const { services } = setup();
    const streamer = await makeStreamer(services);
    const msg = { twitchMessageId: "dup-1", chatterUserId: "a", chatterLogin: "a", chatterDisplayName: "a", text: "hello", isPrivileged: false, source: "live" as const };
    expect(await services.chat.ingest(streamer.connection.id, msg)).not.toBeNull();
    expect(await services.chat.ingest(streamer.connection.id, msg)).toBeNull();
  });
});

describe("Chat Pulse", () => {
  it("summarises real messages, excluding spam and duplicates, with computed stats", async () => {
    const { app, services } = setup();
    const streamer = await makeStreamer(services, { demo: true });
    const say = (user: string, text: string) =>
      services.chat.ingest(streamer.connection.id, { twitchMessageId: null, chatterUserId: user, chatterLogin: user, chatterDisplayName: user, text, isPrivileged: false, source: "demo" });
    await say("a", "what game is this?");
    await say("b", "what game is this??");
    await say("c", "try the wall behind the gargoyle");
    await say("d", "LUL");
    await say("e", "LUL");
    await services.demo.spamBurst(streamer.connection.id, "link");

    const res = await request(app).post("/api/chat/summaries/generate").set(streamer.auth).send({}).expect(200);
    const summary = res.body;
    expect(summary.status).toBe("READY");
    expect(summary.source).toBe("demo");
    expect(summary.provider).toBe("demo-heuristic");
    expect(summary.stats.totalMessages).toBe(8);
    expect(summary.stats.collapsedDuplicates).toBeGreaterThanOrEqual(1);
    expect(summary.stats.excludedSpam).toBeGreaterThanOrEqual(1);
    expect(summary.questions[0].mentionCount).toBe(2);
    const text = JSON.stringify(summary);
    expect(text).not.toContain("cheapviewz");

    const list = await request(app).get("/api/chat/summaries").set(streamer.auth).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("excludes every copy of a copy-paste wave, including the unflagged first copies", async () => {
    const { app, services } = setup();
    const streamer = await makeStreamer(services, { demo: true });
    await services.chat.ingest(streamer.connection.id, { twitchMessageId: null, chatterUserId: "a", chatterLogin: "a", chatterDisplayName: "a", text: "try the wall behind the gargoyle", isPrivileged: false, source: "demo" });
    await services.demo.spamBurst(streamer.connection.id, "copypasta");
    const res = await request(app).post("/api/chat/summaries/generate").set(streamer.auth).send({}).expect(200);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("forever");
    expect(res.body.stats.excludedSpam).toBe(4);
    expect(res.body.stats.analysedMessages).toBe(1);
  });

  it("returns an EMPTY summary when there is no chat", async () => {
    const { app, services } = setup();
    const streamer = await makeStreamer(services, { demo: true });
    const res = await request(app).post("/api/chat/summaries/generate").set(streamer.auth).send({}).expect(200);
    expect(res.body.status).toBe("EMPTY");
    expect(res.body.stats.totalMessages).toBe(0);
  });

  it("selectForAnalysis enforces count budgets and keeps the most recent", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      streamerId: "s",
      twitchMessageId: null,
      chatterUserId: "u",
      chatterLogin: "u",
      chatterDisplayName: "u",
      text: `message ${i}`,
      isPrivileged: false,
      isDuplicate: false,
      flagId: null,
      source: "demo" as const,
      sentAt: new Date().toISOString(),
    }));
    const out = selectForAnalysis(msgs, { messageIds: new Set(["m9"]), userIds: new Set(), texts: new Set() }, 3);
    expect(out.analysed.map((g) => g.message.id)).toEqual(["m6", "m7", "m8"]);
    expect(out.excludedSpam).toBe(1);
  });
});

describe("Auth & status", () => {
  it("exposes system status and refuses demo login when demo mode is off", async () => {
    const { app } = setup();
    const status = await request(app).get("/api/auth/status").expect(200);
    expect(status.body.mode).toBe("demo");
    expect(status.body.persistence).toBe("memory");
    expect(status.body.ai.provider).toBe("demo-heuristic");
    const demo = await request(app).post("/api/auth/demo").expect(200);
    expect(demo.body.streamer.isDemo).toBe(true);
    await request(app).get("/api/auth/me").set({ Authorization: `Bearer ${demo.body.token}` }).expect(200);
  });

  it("rejects forged tokens", async () => {
    const { app } = setup();
    await request(app).get("/api/sessions").set({ Authorization: "Bearer not.a.jwt" }).expect(401);
  });

  it("blocks demo controls for real Twitch accounts", async () => {
    const { app, services } = setup();
    const live = await makeStreamer(services);
    await request(app).post("/api/demo/chat/burst").set(live.auth).send({}).expect(403);
  });
});
