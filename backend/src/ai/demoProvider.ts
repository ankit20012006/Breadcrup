import { contentWords, jaccard, normalize, sentenceCase } from "../services/text";
import type { AiProvider, ChatInputMessage, ClueInput, HintGenerationInput, RawHintOutput, RawSummaryItem, RawSummaryOutput } from "./types";

/**
 * Deterministic, offline stand-in for the AI provider, used by default or when
 * OPENAI_API_KEY / OPENAI_MODEL are not configured. It only rearranges words that viewers actually
 * wrote, and its output goes through the same server-side validation as the real
 * model. The UI labels everything it produces as "demo heuristic".
 */
export class DemoHeuristicProvider implements AiProvider {
  readonly name = "demo-heuristic" as const;
  readonly model = null;

  async generateHints(input: HintGenerationInput): Promise<RawHintOutput> {
    const clues = input.clues.filter((c) => contentWords(c.text).length > 0);
    if (clues.length === 0) {
      return {
        status: "NEED_MORE_CLUES",
        reason: input.clues.length === 0 ? "No clues have been submitted yet." : "The submitted clues contain no usable details.",
        hints: [],
        flagged_clue_refs: [],
      };
    }

    const clusters = clusterClues(clues);
    const primary = clusters[0]!;
    const others = clusters.slice(1).flat();

    const freq = new Map<string, number>();
    for (const clue of primary) for (const w of new Set(contentWords(clue.text))) freq.set(w, (freq.get(w) ?? 0) + 1);
    const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
    const top = keywords.slice(0, 2);

    const representative = [...primary].sort((a, b) => {
      const score = (c: ClueInput) => contentWords(c.text).filter((w) => top.includes(w)).length;
      return score(b) - score(a) || a.text.length - b.text.length;
    })[0]!;
    const tier2Support = primary.filter((c) => contentWords(c.text).some((w) => top.includes(w)));

    const hints: RawHintOutput["hints"] = [
      {
        tier: 1,
        text: `The clues point to something connected to ${top[0]}. Start with a broad look nearby.`,
        supporting_clue_refs: primary.map((c) => c.ref),
      },
      {
        tier: 2,
        text: `${primary.length > 1 ? "Several viewers point" : "A viewer points"} toward the ${top.join(" and the ")}. Take a closer look there.`,
        supporting_clue_refs: tier2Support.map((c) => c.ref),
      },
      { tier: 3, text: sentenceCase(representative.text), supporting_clue_refs: [representative.ref] },
    ];

    let status: RawHintOutput["status"] = "READY";
    let reason: string | null = null;
    if (primary.length < 2) {
      status = "NEED_REVIEW";
      reason =
        clues.length === 1
          ? "Only one viewer clue supports this ladder. Check it before revealing anything."
          : "No two clues point the same way. Review them before revealing anything.";
    } else if (others.length > 0) {
      status = "NEED_REVIEW";
      reason = `${others.length} clue(s) suggest something different from the majority. They are flagged for your review.`;
    }

    return { status, reason, hints, flagged_clue_refs: primary.length >= 2 ? others.map((c) => c.ref) : [] };
  }

  async summarizeChat(input: { game: string | null; messages: ChatInputMessage[] }): Promise<RawSummaryOutput> {
    const msgs = input.messages;
    const total = (g: ChatInputMessage[]) => g.reduce((n, m) => n + m.count, 0);

    const questions = groupSimilar(msgs.filter((m) => m.text.includes("?")), 0.3)
      .filter((g) => total(g) >= 2)
      .map<RawSummaryItem>((g) => ({
        label: shortest(g).text,
        detail: `Asked ${total(g)} times during this window.`,
        evidence_refs: g.map((m) => m.ref),
      }));

    // Gameplay suggestions need an actual directive ("check the…", "try…"), not just the word ("hydrate check").
    const suggestionRe =
      /\b(try|you should|you need to|go back|go to|have you tried|don'?t forget|look (?:at|behind|under|for|around)|check (?:the|behind|under|out|if|for)|use (?:the|your|a)|maybe (?:go|try|use|check|grab|look))\b/i;
    const suggestions = groupSimilar(msgs.filter((m) => suggestionRe.test(m.text)), 0.35).map<RawSummaryItem>((g) => ({
      label: shortest(g).text,
      detail: total(g) > 1 ? `Suggested ${total(g)} times in similar messages.` : "Suggested by one message.",
      evidence_refs: g.map((m) => m.ref),
    }));

    const reactionVocab = ["lul", "lol", "lmao", "kekw", "pog", "pogchamp", "poggers", "gg", "omg", "monkas", "clutch", "hype", "w", "l", "f"];
    const reactionGroups = new Map<string, ChatInputMessage[]>();
    for (const m of msgs) {
      const tokens = new Set(normalize(m.text).split(" "));
      const hit = reactionVocab.find((r) => tokens.has(r));
      if (hit) reactionGroups.set(hit, [...(reactionGroups.get(hit) ?? []), m]);
    }
    const reactions = [...reactionGroups.entries()].map<RawSummaryItem>(([token, g]) => ({
      label: `"${token.toUpperCase()}" reactions`,
      detail: `Chat reacted with "${token}" in ${total(g)} message(s).`,
      evidence_refs: g.map((m) => m.ref),
    }));

    const keywordMsgs = new Map<string, ChatInputMessage[]>();
    for (const m of msgs) {
      for (const w of new Set(contentWords(m.text))) {
        if (reactionVocab.includes(w)) continue;
        keywordMsgs.set(w, [...(keywordMsgs.get(w) ?? []), m]);
      }
    }
    const topics = [...keywordMsgs.entries()]
      .filter(([, g]) => total(g) >= 3)
      .sort((a, b) => total(b[1]) - total(a[1]))
      .slice(0, 5)
      .map<RawSummaryItem>(([word, g]) => ({
        label: word[0]!.toUpperCase() + word.slice(1),
        detail: `Chat mentioned "${word}" repeatedly in this window.`,
        evidence_refs: g.map((m) => m.ref),
      }));

    return { topics, repeated_questions: questions, suggestions, reactions };
  }
}

/** Greedy clustering of clues by content-word overlap; largest cluster first. */
function clusterClues(clues: ClueInput[]): ClueInput[][] {
  const clusters: { words: Set<string>; items: ClueInput[] }[] = [];
  for (const clue of clues) {
    const w = new Set(contentWords(clue.text));
    const match = clusters.find((c) => [...w].some((x) => c.words.has(x)));
    if (match) {
      match.items.push(clue);
      for (const x of w) match.words.add(x);
    } else {
      clusters.push({ words: w, items: [clue] });
    }
  }
  return clusters.sort((a, b) => b.items.length - a.items.length).map((c) => c.items);
}

function groupSimilar(msgs: ChatInputMessage[], threshold: number): ChatInputMessage[][] {
  const groups: { words: Set<string>; items: ChatInputMessage[] }[] = [];
  for (const m of msgs) {
    const w = new Set(contentWords(m.text));
    if (w.size === 0) continue;
    const match = groups.find((g) => jaccard(g.words, w) >= threshold);
    if (match) match.items.push(m);
    else groups.push({ words: w, items: [m] });
  }
  return groups.sort((a, b) => b.items.length - a.items.length).map((g) => g.items);
}

const shortest = (g: ChatInputMessage[]) => [...g].sort((a, b) => a.text.length - b.text.length)[0]!;
