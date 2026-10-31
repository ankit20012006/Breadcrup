import { describe, expect, it } from "vitest";
import { DemoHeuristicProvider } from "../src/ai/demoProvider";
import { validateHintOutput } from "../src/ai/validate";

describe("DemoHeuristicProvider", () => {
  const ai = new DemoHeuristicProvider();
  const clues = [
    { ref: "C1", text: "Check the wall behind the gargoyle statue, one brick looks cracked." },
    { ref: "C2", text: "the gargoyle wall! hit the cracked brick behind it" },
    { ref: "C3", text: "I think you need to ring the bell first" },
  ];
  const refs = new Map(clues.map((c) => [c.ref, `id-${c.ref}`]));

  it("builds a grounded ladder and flags the dissenting clue", async () => {
    const raw = await ai.generateHints({ game: "g", question: "q", context: "", clues });
    const out = validateHintOutput(raw, refs);
    expect(out.tiers).toHaveLength(3);
    expect(out.tiers[0]!.text.toLowerCase()).toContain("wall");
    expect(out.tiers[2]!.text.toLowerCase()).toContain("gargoyle");
    expect(out.tiers.every((tier) => tier.supportingSubmissionIds.length > 0)).toBe(true);
    expect(out.flaggedSubmissionIds).toEqual(["id-C3"]);
    expect(out.status).toBe("NEED_REVIEW");
  });

  it("asks for more clues when there are none", async () => {
    const raw = await ai.generateHints({ game: "g", question: "q", context: "", clues: [] });
    expect(raw.status).toBe("NEED_MORE_CLUES");
    expect(raw.hints).toEqual([]);
  });

  it("summarises only from provided messages", async () => {
    const messages = [
      { ref: "M1", text: "what game is this?", count: 1 },
      { ref: "M2", text: "what game is this??", count: 1 },
      { ref: "M3", text: "try the wall behind the gargoyle", count: 1 },
      { ref: "M4", text: "LUL", count: 1 },
    ];
    const raw = await ai.summarizeChat({ game: null, messages });
    const allRefs = [...raw.topics, ...raw.repeated_questions, ...raw.suggestions, ...raw.reactions].flatMap((i) => i.evidence_refs);
    expect(allRefs.every((r) => messages.some((m) => m.ref === r))).toBe(true);
    expect(raw.repeated_questions[0]?.evidence_refs.sort()).toEqual(["M1", "M2"]);
    expect(raw.suggestions[0]?.evidence_refs).toEqual(["M3"]);
  });
});
