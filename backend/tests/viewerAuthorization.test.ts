import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyExtensionJwtMock } = vi.hoisted(() => ({ verifyExtensionJwtMock: vi.fn() }));
vi.mock("../src/integrations/twitch/extensionJwt", () => ({ verifyExtensionJwt: verifyExtensionJwtMock }));

import type { ExtensionClaims } from "../src/integrations/twitch/extensionJwt";
import { makeStreamer, setup, viewerAuth } from "./helpers";

async function createSession(app: ReturnType<typeof setup>["app"], streamer: Awaited<ReturnType<typeof makeStreamer>>) {
  const res = await request(app)
    .post("/api/sessions")
    .set(streamer.auth)
    .send({ game: "G", question: "How do I open the gate?" })
    .expect(201);
  return res.body.id as string;
}

function authorizeExtension(channelId: string) {
  verifyExtensionJwtMock.mockResolvedValue({
    opaqueUserId: "opaque-viewer",
    userId: null,
    channelId,
    role: "viewer",
  } satisfies ExtensionClaims);
  return { Authorization: "Bearer extension-token" };
}

describe("Twitch extension viewer channel authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects reads and clue submissions for an unmapped Twitch channel", async () => {
    const ctx = setup();
    const streamer = await makeStreamer(ctx.services, { demo: true });
    const sessionId = await createSession(ctx.app, streamer);
    const auth = authorizeExtension("unmapped-twitch-channel");

    const read = await request(ctx.app).get(`/api/viewer/sessions/${sessionId}`).set(auth).expect(401);
    expect(read.body.code).toBe("CHANNEL_UNKNOWN");
    const submit = await request(ctx.app).post(`/api/sessions/${sessionId}/submissions`).set(auth).send({ text: "look behind the gate" }).expect(401);
    expect(submit.body.code).toBe("CHANNEL_UNKNOWN");
  });

  it("rejects reads and clue submissions when the mapped broadcaster owns another session", async () => {
    const ctx = setup();
    const owner = await makeStreamer(ctx.services, { demo: true });
    const other = await makeStreamer(ctx.services, { demo: true });
    const sessionId = await createSession(ctx.app, owner);
    const auth = authorizeExtension(other.connection.twitchUserId);

    const read = await request(ctx.app).get(`/api/viewer/sessions/${sessionId}`).set(auth).expect(403);
    expect(read.body.code).toBe("WRONG_CHANNEL");
    const submit = await request(ctx.app).post(`/api/sessions/${sessionId}/submissions`).set(auth).send({ text: "look behind the gate" }).expect(403);
    expect(submit.body.code).toBe("WRONG_CHANNEL");
  });

  it("allows a mapped extension viewer to read and submit to that broadcaster's session", async () => {
    const ctx = setup();
    const streamer = await makeStreamer(ctx.services, { demo: true });
    const sessionId = await createSession(ctx.app, streamer);
    const auth = authorizeExtension(streamer.connection.twitchUserId);

    const active = await request(ctx.app).get("/api/viewer/active").set(auth).expect(200);
    expect(active.body.session.id).toBe(sessionId);
    const read = await request(ctx.app).get(`/api/viewer/sessions/${sessionId}`).set(auth).expect(200);
    expect(read.body.session.id).toBe(sessionId);
    await request(ctx.app).post(`/api/sessions/${sessionId}/submissions`).set(auth).send({ text: "look behind the gate" }).expect(201);
  });

  it("rejects unbound anonymous tokens and does not issue demo links for live sessions", async () => {
    const ctx = setup();
    const liveStreamer = await makeStreamer(ctx.services);
    const sessionId = await createSession(ctx.app, liveStreamer);

    const issue = await request(ctx.app).post("/api/viewer/token").send({ sessionId }).expect(403);
    expect(issue.body.code).toBe("ANON_DISABLED");
    const auth = await viewerAuth(null);
    const active = await request(ctx.app).get("/api/viewer/active").set(auth).expect(401);
    expect(active.body.code).toBe("CHANNEL_UNKNOWN");
  });
});
