import { z } from "zod";
import { LIMITS } from "./limits";

/** Strip control characters (keep newlines/tabs) and trim. */
const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();

const text = (min: number, max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(min).max(max));

export const createSessionSchema = z.object({
  game: text(1, LIMITS.gameMaxLength),
  question: text(3, LIMITS.questionMaxLength),
  context: text(0, LIMITS.contextMaxLength).default(""),
  showCredits: z.boolean().default(true),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

/** Credit names can appear on stream, so only Twitch-like names: no URLs, markup or symbols. */
export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}_ -]*$/u;

export const createSubmissionSchema = z.object({
  text: text(LIMITS.submissionMinLength, LIMITS.submissionMaxLength),
  displayName: text(0, LIMITS.displayNameMaxLength)
    .pipe(z.string().regex(DISPLAY_NAME_PATTERN, "Names can only use letters, numbers, spaces, _ and -"))
    .optional(),
  creditOptIn: z.boolean().default(false),
});
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const generateHintsSchema = z.object({
  /** Bypass the input-hash cache and call the AI again. */
  force: z.boolean().default(false),
  /** Regenerate only this tier, keeping the others. */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export const tierDecisionSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  decision: z.enum(["approved", "rejected", "skipped", "pending"]),
});

export const editTierSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: text(1, LIMITS.hintTextMaxLength),
});

export const submissionDecisionSchema = z.object({
  status: z.enum(["pending", "rejected"]),
});

export const reviewFlagSchema = z.object({
  status: z.enum(["open", "dismissed", "confirmed_spam"]),
});

export const flagActionSchema = z.object({
  action: z.literal("delete_message"),
});

export const uuidParam = z.string().uuid();
