import { describe, expect, it } from "vitest";
import { AiError } from "../src/ai/types";
import { validateHintOutput, validateSummaryOutput } from "../src/ai/validate";

const refs = new Map([
  ["C1", "id-1"],
  ["C2", "id-2"],
]);

const ready = {
  status: "READY",
  reason: null,
  hints: [
    { tier: 1, text: "Pay attention to unusual details in this room.", supporting_clue_refs: ["C1"] },
    { tier: 2, text: "Look more closely at the statues and walls.", supporting_clue_refs: ["C1", "C2"] },
    { tier: 3, text: "Inspect the wall behind the gargoyle.", supporting_clue_refs: ["C2"] },
  ],
  flagged_clue_refs: [],
};

describe("validateHintOutput", () => {
  it("maps refs back to real submission IDs", () => {
    const out = validateHintOutput(ready, refs);
    expect(out.status).toBe("READY");
    expect(out.reason).toBeNull();
    expect(out.tiers.map((t) => t.supportingSubmissionIds)).toEqual([["id-1"], ["id-1", "id-2"], ["id-2"]]);
  });

  it("drops hints that cite only unknown clues and downgrades READY", () => {
    const out = validateHintOutput({ ...ready, hints: [...ready.hints.slice(0, 2), { tier: 3, text: "Invented answer", supporting_clue_refs: ["C99"] }] }, refs);
    expect(out.status).toBe("NEED_REVIEW");
    expect(out.tiers.map((t) => t.tier)).toEqual([1, 2]);
    expect(out.reason).toMatch(/unknown clue/);
  });

  it("downgrades READY when a tier is missing or duplicated", () => {
    expect(validateHintOutput({ ...ready, hints: ready.hints.slice(0, 2) }, refs).status).toBe("NEED_REVIEW");
    expect(validateHintOutput({ ...ready, hints: [...ready.hints, ready.hints[0]] }, refs).status).toBe("NEED_REVIEW");
  });

  it("never upgrades a non-READY status", () => {
    expect(validateHintOutput({ ...ready, status: "NEED_MORE_CLUES", reason: "vague" }, refs).status).toBe("NEED_MORE_CLUES");
  });

  it("rejects malformed output", () => {
    expect(() => validateHintOutput({ status: "DONE", hints: "nope" }, refs)).toThrow(AiError);
    expect(() => validateHintOutput(null, refs)).toThrow(AiError);
  });

  it("truncates over-long hints and flags them for review", () => {
    const long = "x".repeat(500);
    const out = validateHintOutput({ ...ready, hints: [{ ...ready.hints[0]!, text: long }, ...ready.hints.slice(1)] }, refs);
    expect(out.tiers[0]!.text.length).toBeLessThanOrEqual(300);
    expect(out.status).toBe("NEED_REVIEW");
  });

  it("resolves flagged clue refs", () => {
    expect(validateHintOutput({ ...ready, flagged_clue_refs: ["C2", "C7"] }, refs).flaggedSubmissionIds).toEqual(["id-2"]);
  });
});

describe("validateSummaryOutput", () => {
  const mrefs = new Map([
    ["M1", ["a"]],
    ["M2", ["b"]],
    ["M3", ["c"]],
    ["M4", ["d1", "d2"]],
  ]);

  it("computes counts from evidence and drops unsupported items", () => {
    const out = validateSummaryOutput(
      {
        topics: [
          { label: "The gargoyle", detail: "Chat discusses the gargoyle.", evidence_refs: ["M1", "M2", "M2"] },
          { label: "Made up", detail: "No evidence", evidence_refs: ["M42"] },
        ],
        repeated_questions: [
          { label: "What game is this?", detail: "Asked repeatedly.", evidence_refs: ["M1", "M3"] },
          { label: "Single question", detail: "Asked once.", evidence_refs: ["M2"] },
        ],
        suggestions: [],
        reactions: [],
      },
      mrefs,
    );
    expect(out.topics).toHaveLength(1);
    expect(out.topics[0]!.mentionCount).toBe(2);
    expect(out.topics[0]!.evidenceMessageIds).toEqual(["a", "b"]);
    expect(out.questions.map((q) => q.label)).toEqual(["What game is this?"]);
  });

  it("expands collapsed duplicates so a single ref can back a repeated question", () => {
    const out = validateSummaryOutput(
      { topics: [], repeated_questions: [{ label: "What game?", detail: "Asked twice.", evidence_refs: ["M4"] }], suggestions: [], reactions: [] },
      mrefs,
    );
    expect(out.questions[0]!.mentionCount).toBe(2);
    expect(out.questions[0]!.evidenceMessageIds).toEqual(["d1", "d2"]);
  });
});
