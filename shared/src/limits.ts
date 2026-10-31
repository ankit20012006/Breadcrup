/** Limits shared by the API validation layer and the UI so both report the same numbers. */
export const LIMITS = {
  submissionMinLength: 3,
  submissionMaxLength: 280,
  displayNameMaxLength: 40,
  gameMaxLength: 120,
  questionMaxLength: 300,
  contextMaxLength: 1200,
  hintTextMaxLength: 300,
  /** Max clues a single viewer may submit to one session. */
  submissionsPerViewerPerSession: 5,
  /** Rolling window for the per-viewer burst limit. */
  submissionBurstWindowSeconds: 60,
  submissionBurstMax: 2,
  /** Max clues considered for a single AI generation. */
  maxSubmissionsPerGeneration: 40,
} as const;

export const HINT_TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "Subtle hint",
  2: "Directional hint",
  3: "Specific clue",
};
