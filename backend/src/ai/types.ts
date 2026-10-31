import type { AiProviderName, HintSetStatus, HintTier, SummaryItem } from "@breadcrumb/shared";

export interface ClueInput {
  /** Short reference shown to the model (e.g. "C3"); mapped back to a submission ID server-side. */
  ref: string;
  text: string;
}

export interface HintGenerationInput {
  game: string;
  question: string;
  context: string;
  clues: ClueInput[];
}

/** Raw model output, before server-side validation. Refs are model-facing ("C1"). */
export interface RawHintOutput {
  status: "READY" | "NEED_MORE_CLUES" | "NEED_REVIEW";
  reason: string | null;
  hints: { tier: number; text: string; supporting_clue_refs: string[] }[];
  flagged_clue_refs: string[];
}

export interface ValidatedHintResult {
  status: Exclude<HintSetStatus, "ERROR">;
  reason: string | null;
  tiers: { tier: HintTier; text: string; supportingSubmissionIds: string[] }[];
  flaggedSubmissionIds: string[];
}

export interface ChatInputMessage {
  ref: string;
  text: string;
  /** How many identical copies were collapsed into this entry (1 = unique). */
  count: number;
}

export interface RawSummaryItem {
  label: string;
  detail: string;
  evidence_refs: string[];
}

export interface RawSummaryOutput {
  topics: RawSummaryItem[];
  repeated_questions: RawSummaryItem[];
  suggestions: RawSummaryItem[];
  reactions: RawSummaryItem[];
}

export interface ValidatedSummary {
  topics: SummaryItem[];
  questions: SummaryItem[];
  suggestions: SummaryItem[];
  reactions: SummaryItem[];
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string | null;
  generateHints(input: HintGenerationInput): Promise<RawHintOutput>;
  summarizeChat(input: { game: string | null; messages: ChatInputMessage[] }): Promise<RawSummaryOutput>;
}

export type AiErrorCode =
  | "AUTH" // key missing, invalid or not permitted
  | "MODEL" // OPENAI_MODEL not found / not accessible
  | "BAD_REQUEST" // request rejected (e.g. model lacks Structured Outputs on the Responses API)
  | "QUOTA" // billing/quota exhausted
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "REFUSED"
  | "INCOMPLETE"
  | "MALFORMED"
  | "UPSTREAM";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
