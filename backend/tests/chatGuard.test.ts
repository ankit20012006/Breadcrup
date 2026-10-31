import { describe, expect, it } from "vitest";
import { ChatGuard } from "../src/services/chatGuard";

const cfg = {
  duplicateWindowSeconds: 30,
  duplicateThreshold: 3,
  copypastaMinLength: 20,
  similarityThreshold: 0.75,
  floodWindowSeconds: 10,
  floodThreshold: 6,
  linkWindowSeconds: 300,
  linkThreshold: 3,
};

let seq = 0;
const msg = (user: string, text: string, at: number, isPrivileged = false) => ({ id: `m${seq++}`, chatterUserId: user, text, isPrivileged, sentAtMs: at });

describe("ChatGuard", () => {
  it("flags the same account repeating an identical message", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    expect(g.evaluate("c", msg("u1", "anyone want free stuff", t)).flag).toBeNull();
    expect(g.evaluate("c", msg("u1", "anyone want free stuff", t + 1000)).flag).toBeNull();
    const third = g.evaluate("c", msg("u1", "Anyone want free stuff!!", t + 2000));
    expect(third.flag?.category).toBe("duplicate");
    expect(third.isDuplicate).toBe(true);
  });

  it("does not flag short hype repeats from many different people", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    for (let i = 0; i < 10; i++) {
      const v = g.evaluate("c", msg(`u${i}`, "W", t + i * 100));
      expect(v.flag).toBeNull();
      if (i > 0) expect(v.isDuplicate).toBe(true);
    }
  });

  it("flags long copy-paste blocks spreading across accounts", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    const text = "THIS STREAMER IS STUCK FOREVER type 1 if you agree";
    g.evaluate("c", msg("a", text, t));
    g.evaluate("c", msg("b", text, t + 500));
    const v = g.evaluate("c", msg("c2", text, t + 900));
    expect(v.flag?.reasons.some((r) => r.category === "copypasta")).toBe(true);
  });

  it("flags near-duplicate spam with small edits from one account", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    g.evaluate("c", msg("u", "follow my channel for daily speedruns", t));
    g.evaluate("c", msg("u", "follow my channel for daily speedrun", t + 1000));
    const v = g.evaluate("c", msg("u", "follow my channel 4 daily speedruns", t + 2000));
    expect(v.flag?.reasons.some((r) => r.category === "near_duplicate")).toBe(true);
  });

  it("flags message floods from one account", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    let last;
    for (let i = 0; i < 6; i++) last = g.evaluate("c", msg("u", `message number ${i} about things`, t + i * 500));
    expect(last!.flag?.reasons.some((r) => r.category === "flood")).toBe(true);
  });

  it("allows a single ordinary link but flags repeated promo domains", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    expect(g.evaluate("c", msg("u1", "the wiki page is at wiki.example.com/gloomspire", t)).flag).toBeNull();
    const promo = "best viewers on cheapviewz.xyz";
    const first = g.evaluate("c", msg("p", promo, t + 1000));
    expect(first.flag?.confidence).toBe("low"); // promo wording, single link
    const second = g.evaluate("c", msg("p", promo, t + 2000));
    expect(second.flag?.category).toBe("link_promo");
    expect(second.flag?.confidence).not.toBe("low");
  });

  it("never flags broadcaster/moderator messages", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    for (let i = 0; i < 8; i++) expect(g.evaluate("c", msg("mod", "!rules please read the rules", t + i * 200, true)).flag).toBeNull();
  });

  it("keeps channels independent", () => {
    const g = new ChatGuard(cfg);
    const t = Date.now();
    g.evaluate("a", msg("u", "same text here ok", t));
    g.evaluate("a", msg("u", "same text here ok", t + 100));
    expect(g.evaluate("b", msg("u", "same text here ok", t + 200)).flag).toBeNull();
  });
});
