import { LIMITS, type HintTier, type SummaryItem } from "@breadcrumb/shared";
import { looksLikePromptInjection } from "../services/clueSafety";
import { extractDomains } from "../services/text";
import { rawHintOutputSchema, rawSummaryOutputSchema } from "./schemas";
import { AiError, type RawSummaryItem, type ValidatedHintResult, type ValidatedSummary } from "./types";

/**
 * Validates model hint output against the clues that were actually sent.
 * The model's own status is a ceiling, never a floor: the server can only
 * downgrade READY to NEED_REVIEW, never upgrade.
 *
 * @param refToId maps model-facing refs ("C1") to submission IDs in this session.
 */
export function validateHintOutput(raw: unknown, refToId: Map<string, string>): ValidatedHintResult {
  const parsed = rawHintOutputSchema.safeParse(raw);
  if (!parsed.success) throw new AiError("MALFORMED", "AI returned output that does not match the hint schema");
  const out = parsed.data;

  const problems: string[] = [];
  const resolve = (refs: string[]) => {
    const ids = new Set<string>();
    for (const ref of refs) {
      const id = refToId.get(ref.trim().toUpperCase());
      if (id) ids.add(id);
      else problems.push(`cited unknown clue "${ref.slice(0, 12)}"`);
    }
    return [...ids];
  };

  const tiers: ValidatedHintResult["tiers"] = [];
  const seen = new Set<number>();
  for (const hint of out.hints) {
    if (hint.tier !== 1 && hint.tier !== 2 && hint.tier !== 3) {
      problems.push(`returned invalid tier ${hint.tier}`);
      continue;
    }
    if (seen.has(hint.tier)) {
      problems.push(`returned tier ${hint.tier} twice`);
      continue;
    }
    let text = hint.text.replace(/\s+/g, " ").trim();
    if (!text) {
      problems.push(`returned an empty tier ${hint.tier}`);
      continue;
    }
    if (text.length > LIMITS.hintTextMaxLength) {
      text = `${text.slice(0, LIMITS.hintTextMaxLength - 1).trimEnd()}…`;
      problems.push(`tier ${hint.tier} was too long and was truncated`);
    }
    // Hint text can end up on a public stream overlay: never accept links, markup or AI-directed text.
    const unsafe = unsafeHintReason(text);
    if (unsafe) {
      problems.push(`tier ${hint.tier} ${unsafe} and was discarded`);
      continue;
    }
    const supportingSubmissionIds = resolve(hint.supporting_clue_refs);
    if (supportingSubmissionIds.length === 0) {
      // An unsupported hint is exactly the "invented answer" case — drop it.
      problems.push(`tier ${hint.tier} cited no valid clues and was discarded`);
      continue;
    }
    seen.add(hint.tier);
    tiers.push({ tier: hint.tier as HintTier, text, supportingSubmissionIds });
  }
  tiers.sort((a, b) => a.tier - b.tier);

  const normalized = new Set(tiers.map((t) => t.text.toLowerCase()));
  if (normalized.size < tiers.length) problems.push("two tiers have identical text");

  const flaggedSubmissionIds = resolve(out.flagged_clue_refs);

  let status = out.status;
  if (status === "READY" && (tiers.length !== 3 || problems.length > 0)) status = "NEED_REVIEW";

  const reasons = [out.reason?.trim() || null];
  if (problems.length) reasons.push(`Server checks: ${[...new Set(problems)].join("; ")}.`);

  return {
    status,
    reason: reasons.filter(Boolean).join(" ") || null,
    tiers,
    flaggedSubmissionIds,
  };
}

/** Returns why hint text is unsafe to show on stream, or null when it's acceptable. */
export function unsafeHintReason(text: string): string | null {
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(text) || extractDomains(text).length > 0) return "contained a link";
  if (/<\/?[a-z][^>]*>|```|\[[^\]]*\]\([^)]*\)/i.test(text)) return "contained markup";
  if (looksLikePromptInjection(text)) return "contained instructions aimed at an AI";
  return null;
}

const clip = (value: string, max: number) => {
  const v = value.replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
};

function validateItems(items: RawSummaryItem[], refToIds: Map<string, string[]>, minEvidence: number, max: number): SummaryItem[] {
  const result: SummaryItem[] = [];
  for (const item of items) {
    const ids = [...new Set(item.evidence_refs.flatMap((r) => refToIds.get(r.trim().toUpperCase()) ?? []))];
    const label = clip(item.label, 80);
    if (!label || ids.length < minEvidence) continue;
    result.push({ label, detail: clip(item.detail, 240), mentionCount: ids.length, evidenceMessageIds: ids });
    if (result.length >= max) break;
  }
  return result.sort((a, b) => b.mentionCount - a.mentionCount);
}

/**
 * Drops any summary item that isn't backed by real messages; counts come from evidence.
 * @param refToId maps each ref to the message ID(s) it stands for (collapsed duplicates map to several).
 */
export function validateSummaryOutput(raw: unknown, refToId: Map<string, string[]>): ValidatedSummary {
  const parsed = rawSummaryOutputSchema.safeParse(raw);
  if (!parsed.success) throw new AiError("MALFORMED", "AI returned output that does not match the summary schema");
  const out = parsed.data;
  return {
    topics: validateItems(out.topics, refToId, 1, 5),
    questions: validateItems(out.repeated_questions, refToId, 2, 5),
    suggestions: validateItems(out.suggestions, refToId, 1, 5),
    reactions: validateItems(out.reactions, refToId, 1, 5),
  };
}
