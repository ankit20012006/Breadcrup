import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS, type HintSet, type SessionDetail } from "@breadcrumb/shared";
import type { AiProvider, RawHintOutput } from "../src/ai/types";
import { makeStreamer, setup, viewerAuth } from "./helpers";

/** Scripted AI: returns a READY ladder citing the first two clue refs. */
class ScriptedAi implements AiProvider {
  readonly name = "openai" as const;
  readonly model = "test-model";
  calls = 0;
  next: RawHintOutput | Error | null = null;
  async generateHints(input: { clues: { ref: string }[] }): Promise<RawHintOutput> {
    this.calls++;
    if (this.next instanceof Error) throw this.next;
    if (this.next) return this.next;
    const [a, b] = input.clues;
    return {
      status: "READY",
      reason: null,
      hints: [
        { tier: 1, text: "SECRET-T1 Pay attention to unusual details.", supporting_clue_refs: [a!.ref] },
        { tier: 2, text: "SECRET-T2 Look at the statues and walls.", supporting_clue_refs: [a!.ref, (b ?? a)!.ref] },
        { tier: 3, text: "SECRET-T3 Inspect the wall behind the gargoyle.", supporting_clue_refs: [(b ?? a)!.ref] },
      ],
      flagged_clue_refs: [],
    };
  }
  async summarizeChat() {
    return { topics: [], repeated_questions: [], suggestions: [], reactions: [] };
  }
}

describe("Hint Ladder API", () => {
  let ctx: ReturnType<typeof setup>;
  let ai: ScriptedAi;
  let streamer: Awaited<ReturnType<typeof makeStreamer>>;
  let sessionId: string;

  beforeEach(async () => {
    ai = new ScriptedAi();
    ctx = setup({ ai });
    streamer = await makeStreamer(ctx.services, { demo: true });
    const res = await request(ctx.app)
      .post("/api/sessions")
      .set(streamer.auth)
      .send({ game: "Gloomspire", question: "How do I open the sealed door?", context: "Bell tower" })
      .expect(201);
    sessionId = res.body.id;
  });

  const submit = async (text: string, displayName?: string) => {
    const viewer = await viewerAuth(streamer.connection.id);
    return request(ctx.app).post(`/api/sessions/${sessionId}/submissions`).set(viewer).send({ text, displayName, creditOptIn: Boolean(displayName) });
  };

  it("runs the full flow: submit → generate → approve → reveal, exposing only the revealed tier", async () => {
    expect((await submit("Check the wall behind the gargoyle.", "Mira")).status).toBe(201);
    expect((await submit("hit the cracked brick behind the gargoyle", "pip")).status).toBe(201);

    // Overlay starts empty.
    const empty = await request(ctx.app).get(`/api/sessions/${sessionId}/overlay`).expect(200);
    expect(empty.body.revealed).toBeNull();

    const gen = await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    const set: HintSet = gen.body.hintSet;
    expect(set.status).toBe("READY");
    expect(set.tiers).toHaveLength(3);
    expect(set.tiers.every((t) => t.approval === "pending")).toBe(true);

    // Can't reveal before approval.
    const blocked = await request(ctx.app).post(`/api/sessions/${sessionId}/reveal-next`).set(streamer.auth).expect(409);
    expect(blocked.body.code).toBe("NOT_APPROVED");

    // Approving tier 1 doesn't put anything on the overlay by itself.
    await request(ctx.app).post(`/api/sessions/${sessionId}/tiers/decision`).set(streamer.auth).send({ tier: 1, decision: "approved" }).expect(200);
    const stillEmpty = await request(ctx.app).get(`/api/sessions/${sessionId}/overlay`).expect(200);
    expect(stillEmpty.body.revealed).toBeNull();

    const reveal = await request(ctx.app).post(`/api/sessions/${sessionId}/reveal-next`).set(streamer.auth).expect(200);
    expect(reveal.body.session.currentRevealedTier).toBe(1);

    const overlay = await request(ctx.app).get(`/api/sessions/${sessionId}/overlay`).expect(200);
    expect(overlay.body.revealed.tier).toBe(1);
    expect(overlay.body.revealed.text).toContain("SECRET-T1");
    expect(overlay.body.revealed.credits).toEqual([{ displayName: "Mira" }]);
    const raw = JSON.stringify(overlay.body);
    expect(raw).not.toContain("SECRET-T2");
    expect(raw).not.toContain("SECRET-T3");
    expect(raw).not.toContain("gargoyle."); // no clue text leaks

    // Public realtime events carry only public overlay data.
    const publicEvents = ctx.realtime.events.filter((e) => e.room.startsWith("overlay:"));
    expect(publicEvents.length).toBeGreaterThan(0);
    for (const e of publicEvents) {
      expect(e.event).toBe(SOCKET_EVENTS.overlayUpdate);
      expect(JSON.stringify(e.payload)).not.toMatch(/SECRET-T2|SECRET-T3|wall behind/);
    }

    // Skip tier 2, approve tier 3 → next reveal jumps to 3.
    await request(ctx.app).post(`/api/sessions/${sessionId}/tiers/decision`).set(streamer.auth).send({ tier: 2, decision: "skipped" }).expect(200);
    await request(ctx.app).post(`/api/sessions/${sessionId}/tiers/decision`).set(streamer.auth).send({ tier: 3, decision: "approved" }).expect(200);
    await request(ctx.app).post(`/api/sessions/${sessionId}/reveal-next`).set(streamer.auth).expect(200);
    const final = await request(ctx.app).get(`/api/sessions/${sessionId}/overlay`).expect(200);
    expect(final.body.revealed.tier).toBe(3);
    expect(JSON.stringify(final.body)).not.toContain("SECRET-T2");

    await request(ctx.app).post(`/api/sessions/${sessionId}/reveal-next`).set(streamer.auth).expect(409);
    // Revealed tiers are locked.
    await request(ctx.app).post(`/api/sessions/${sessionId}/tiers/decision`).set(streamer.auth).send({ tier: 1, decision: "rejected" }).expect(409);
  });

  it("caches identical generations and only calls the AI again when forced or inputs change", async () => {
    await submit("Check the wall behind the gargoyle.");
    await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    const again = await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    expect(again.body.cached).toBe(true);
    expect(ai.calls).toBe(1);

    await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({ force: true }).expect(200);
    expect(ai.calls).toBe(2);
    await submit("another clue about the gargoyle wall");
    const changed = await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    expect(changed.body.cached).toBe(false);
    expect(changed.body.hintSet.version).toBe(3);
  });

  it("returns NEED_MORE_CLUES without calling the AI when there are no usable clues", async () => {
    const res = await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    expect(res.body.hintSet.status).toBe("NEED_MORE_CLUES");
    expect(ai.calls).toBe(0);
  });

  it("downgrades hallucinated support and keeps prior state on AI failure", async () => {
    await submit("Check the wall behind the gargoyle.");
    ai.next = {
      status: "READY",
      reason: null,
      hints: [
        { tier: 1, text: "Look around.", supporting_clue_refs: ["C1"] },
        { tier: 2, text: "Statues.", supporting_clue_refs: ["C1"] },
        { tier: 3, text: "Use the moon key from chapter 9.", supporting_clue_refs: ["C77"] },
      ],
      flagged_clue_refs: [],
    };
    const res = await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    expect(res.body.hintSet.status).toBe("NEED_REVIEW");
    expect(res.body.hintSet.tiers.map((t: { tier: number }) => t.tier)).toEqual([1, 2]);

    const { AiError } = await import("../src/ai/types");
    ai.next = new AiError("RATE_LIMITED", "slow down");
    const failed = await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({ force: true }).expect(429);
    expect(failed.body.code).toBe("AI_RATE_LIMITED");
    const detail: SessionDetail = (await request(ctx.app).get(`/api/sessions/${sessionId}`).set(streamer.auth).expect(200)).body;
    expect(detail.hintSet?.version).toBe(1); // previous set untouched
  });

  it("requires a fresh approval after a streamer edits a tier", async () => {
    await submit("Check the wall behind the gargoyle.");
    await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    await request(ctx.app).post(`/api/sessions/${sessionId}/tiers/decision`).set(streamer.auth).send({ tier: 1, decision: "approved" }).expect(200);
    const edited = await request(ctx.app).patch(`/api/sessions/${sessionId}/tiers`).set(streamer.auth).send({ tier: 1, text: "Slow down and look around." }).expect(200);
    expect(edited.body.tiers[0].approval).toBe("pending");
    await request(ctx.app).post(`/api/sessions/${sessionId}/reveal-next`).set(streamer.auth).expect(409);
  });

  it("keeps sessions private to their owner", async () => {
    const other = await makeStreamer(ctx.services, { demo: true });
    await request(ctx.app).get(`/api/sessions/${sessionId}`).set(other.auth).expect(404);
    await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(other.auth).send({}).expect(404);
    await request(ctx.app).post(`/api/sessions/${sessionId}/reveal-next`).set(other.auth).expect(404);
    await request(ctx.app).get(`/api/sessions/${sessionId}`).expect(401);
    const list = await request(ctx.app).get(`/api/sessions`).set(other.auth).expect(200);
    expect(list.body).toEqual([]);
  });

  it("does not let viewer tokens read private session data or act as a streamer", async () => {
    const viewer = await viewerAuth(streamer.connection.id);
    await request(ctx.app).get(`/api/sessions/${sessionId}`).set(viewer).expect(401);
    await request(ctx.app).post(`/api/sessions/${sessionId}/reveal-next`).set(viewer).expect(401);
  });

  it("only shows viewers their own submissions", async () => {
    const alice = await viewerAuth(streamer.connection.id);
    const bob = await viewerAuth(streamer.connection.id);
    await request(ctx.app).post(`/api/sessions/${sessionId}/submissions`).set(alice).send({ text: "alice's secret clue" }).expect(201);
    const bobView = await request(ctx.app).get(`/api/viewer/sessions/${sessionId}`).set(bob).expect(200);
    expect(bobView.body.mySubmissions).toEqual([]);
    expect(JSON.stringify(bobView.body)).not.toContain("alice");
  });

  it("enforces submission validation and per-viewer limits", async () => {
    const viewer = await viewerAuth(streamer.connection.id);
    const post = (text: string) => request(ctx.app).post(`/api/sessions/${sessionId}/submissions`).set(viewer).send({ text });
    await post("no").expect(400);
    await post("x".repeat(281)).expect(400);
    await post("first clue").expect(201);
    await post("first clue").expect(409);
    await post("second clue").expect(201);
    const burst = await post("third clue");
    expect(burst.status).toBe(429);
    expect(burst.body.code).toBe("SUBMISSION_RATE");
  });

  it("rejects submissions to another channel's session and to closed sessions", async () => {
    const otherStreamer = await makeStreamer(ctx.services, { demo: true });
    const wrongChannel = await viewerAuth(otherStreamer.connection.id);
    await request(ctx.app).post(`/api/sessions/${sessionId}/submissions`).set(wrongChannel).send({ text: "hello there" }).expect(403);
    await request(ctx.app).post(`/api/sessions/${sessionId}/close`).set(streamer.auth).expect(200);
    expect((await submit("too late now")).status).toBe(409);
    const overlay = await request(ctx.app).get(`/api/sessions/${sessionId}/overlay`).expect(200);
    expect(overlay.body.status).toBe("closed");
  });

  it("excluded clues are left out of generation", async () => {
    await submit("Check the wall behind the gargoyle.");
    const detail: SessionDetail = (await request(ctx.app).get(`/api/sessions/${sessionId}`).set(streamer.auth)).body;
    await request(ctx.app).patch(`/api/sessions/${sessionId}/submissions/${detail.submissions[0]!.id}`).set(streamer.auth).send({ status: "rejected" }).expect(200);
    const res = await request(ctx.app).post(`/api/sessions/${sessionId}/generate`).set(streamer.auth).send({}).expect(200);
    expect(res.body.hintSet.status).toBe("NEED_MORE_CLUES");
    expect(ai.calls).toBe(0);
  });

  it("returns 404 for malformed and unknown overlay ids", async () => {
    await request(ctx.app).get(`/api/sessions/not-a-uuid/overlay`).expect(404);
    await request(ctx.app).get(`/api/sessions/${crypto.randomUUID()}/overlay`).expect(404);
  });
});
