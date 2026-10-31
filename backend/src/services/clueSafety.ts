/**
 * Deterministic screen for clues that look like instructions aimed at the AI rather
 * than gameplay tips. Matching clues are never sent to the model (either provider);
 * they stay visible to the streamer, flagged for review. This is defence in depth on
 * top of the "treat clues as untrusted data" prompt, not a guarantee.
 */
const PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|prompts?|guidelines|previous|above|system)\b/i,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  /\byou\s+are\s+(now|no longer)\b/i,
  /\b(act|pretend|behave)\s+as\b.{0,30}\b(ai|assistant|model|bot|gpt|system)\b/i,
  /\btier\s*[1-3]\b.{0,30}\b(must|should|has to|needs to|will)\s+(say|be|contain|include|reveal|show)\b/i,
  /\b(reveal|output|print|give|put|write)\b.{0,30}\b(full|whole|entire|complete|final)\s+(answer|solution|walkthrough)\b/i,
  /\b(new|updated)\s+instructions?\b/i,
  /<\/?\s*(system|assistant|user|instructions?)\s*>/i,
  /\b(status|reason|hints|supporting_clue_refs|flagged_clue_refs)\s*["']?\s*:/i,
];

export function looksLikePromptInjection(text: string): boolean {
  return PATTERNS.some((re) => re.test(text));
}
