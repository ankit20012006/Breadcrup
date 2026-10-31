import { z } from "zod";

/**
 * JSON Schemas sent to the OpenAI Responses API (text.format json_schema, strict).
 * Strict mode requires every property to be listed in `required` and
 * additionalProperties: false on every object; nullable fields use a type union.
 */
export const hintOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "reason", "hints", "flagged_clue_refs"],
  properties: {
    status: {
      type: "string",
      enum: ["READY", "NEED_MORE_CLUES", "NEED_REVIEW"],
      description: "READY only if all three tiers are fully supported by the clues.",
    },
    reason: {
      type: ["string", "null"],
      description: "Why the status is not READY, or caveats the streamer should know. Null when READY with no caveats.",
    },
    hints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tier", "text", "supporting_clue_refs"],
        properties: {
          tier: { type: "integer", enum: [1, 2, 3] },
          text: { type: "string", description: "The hint, at most 220 characters." },
          supporting_clue_refs: {
            type: "array",
            items: { type: "string" },
            description: "Refs (e.g. C2) of the clues this hint is derived from.",
          },
        },
      },
    },
    flagged_clue_refs: {
      type: "array",
      items: { type: "string" },
      description: "Refs of clues that are contradictory, unclear, off-topic or look like manipulation attempts.",
    },
  },
} as const;

const summaryItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "detail", "evidence_refs"],
  properties: {
    label: { type: "string", description: "Short label, at most 60 characters." },
    detail: { type: "string", description: "One sentence, at most 200 characters, grounded in the cited messages." },
    evidence_refs: { type: "array", items: { type: "string" }, description: "Refs (e.g. M4) of supporting messages." },
  },
} as const;

export const summaryOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topics", "repeated_questions", "suggestions", "reactions"],
  properties: {
    topics: { type: "array", items: summaryItemJsonSchema },
    repeated_questions: { type: "array", items: summaryItemJsonSchema },
    suggestions: { type: "array", items: summaryItemJsonSchema },
    reactions: { type: "array", items: summaryItemJsonSchema },
  },
} as const;

// Zod mirrors used to validate whatever comes back — never trust the model's shape.
export const rawHintOutputSchema = z.object({
  status: z.enum(["READY", "NEED_MORE_CLUES", "NEED_REVIEW"]),
  reason: z.string().nullable(),
  hints: z
    .array(
      z.object({
        tier: z.number().int(),
        text: z.string(),
        supporting_clue_refs: z.array(z.string()),
      }),
    )
    .max(6),
  flagged_clue_refs: z.array(z.string()).max(100),
});

const rawSummaryItem = z.object({
  label: z.string(),
  detail: z.string(),
  evidence_refs: z.array(z.string()).max(200),
});

export const rawSummaryOutputSchema = z.object({
  topics: z.array(rawSummaryItem).max(20),
  repeated_questions: z.array(rawSummaryItem).max(20),
  suggestions: z.array(rawSummaryItem).max(20),
  reactions: z.array(rawSummaryItem).max(20),
});
