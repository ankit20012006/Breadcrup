import OpenAI from "openai";
import { buildHintUserPayload, buildSummaryUserPayload, HINT_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from "./prompts";
import { hintOutputJsonSchema, summaryOutputJsonSchema } from "./schemas";
import { AiError, type AiProvider, type ChatInputMessage, type HintGenerationInput, type RawHintOutput, type RawSummaryOutput } from "./types";

/** Minimal surface of the SDK we use, so tests can inject a fake client. */
export interface ResponsesClient {
  responses: {
    create(body: Record<string, unknown>): Promise<{
      status?: string | null;
      incomplete_details?: { reason?: string | null } | null;
      output_text: string;
      output: Array<{ type: string; content?: Array<{ type: string; refusal?: string }> }>;
    }>;
  };
}

/**
 * OpenAI Responses API with Structured Outputs (text.format json_schema, strict).
 * The API key stays server-side; the model is configured via OPENAI_MODEL.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  private client: ResponsesClient;
  private maxOutputTokens: number;

  constructor(
    readonly model: string,
    opts: { apiKey?: string; timeoutMs?: number; maxOutputTokens?: number; client?: ResponsesClient },
  ) {
    this.maxOutputTokens = opts.maxOutputTokens ?? 4000;
    this.client =
      opts.client ??
      (new OpenAI({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 30000, maxRetries: 2 }) as unknown as ResponsesClient);
  }

  generateHints(input: HintGenerationInput): Promise<RawHintOutput> {
    return this.structured<RawHintOutput>({
      instructions: HINT_SYSTEM_PROMPT,
      input: buildHintUserPayload(input),
      name: "hint_ladder",
      schema: hintOutputJsonSchema,
    });
  }

  summarizeChat(input: { game: string | null; messages: ChatInputMessage[] }): Promise<RawSummaryOutput> {
    return this.structured<RawSummaryOutput>({
      instructions: SUMMARY_SYSTEM_PROMPT,
      input: buildSummaryUserPayload(input.game, input.messages),
      name: "chat_pulse",
      schema: summaryOutputJsonSchema,
    });
  }

  private async structured<T>(req: { instructions: string; input: string; name: string; schema: object }): Promise<T> {
    let response: Awaited<ReturnType<ResponsesClient["responses"]["create"]>>;
    try {
      response = await this.client.responses.create({
        model: this.model,
        instructions: req.instructions,
        input: [{ role: "user", content: req.input }],
        text: { format: { type: "json_schema", name: req.name, schema: req.schema, strict: true } },
        max_output_tokens: this.maxOutputTokens,
        store: false,
      });
    } catch (err) {
      throw mapOpenAiError(err, this.model);
    }

    for (const item of response.output ?? []) {
      for (const part of item.content ?? []) {
        if (part.type === "refusal") throw new AiError("REFUSED", `The model declined: ${part.refusal ?? "no reason given"}`);
      }
    }
    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason ?? "unknown";
      throw new AiError(
        "INCOMPLETE",
        `The model response was cut off (${reason})${reason === "max_output_tokens" ? `. Raise OPENAI_MAX_OUTPUT_TOKENS (currently ${this.maxOutputTokens}).` : ""}`,
      );
    }
    if (response.status && response.status !== "completed") {
      throw new AiError("UPSTREAM", `The model response ended with status "${response.status}"`);
    }
    try {
      return JSON.parse(response.output_text) as T;
    } catch {
      throw new AiError("MALFORMED", "The model did not return valid JSON");
    }
  }
}

/**
 * Strips anything that looks like an API key (OpenAI's 401 message echoes a masked
 * fragment of the key) before an upstream message reaches the UI or logs.
 */
export function redactSecrets(text: string): string {
  return text.replace(/\b(sk|rk|sess)-[A-Za-z0-9_*.\-]{4,}/g, "[redacted]").replace(/Bearer\s+[A-Za-z0-9_.\-]+/gi, "Bearer [redacted]");
}

/** Maps SDK errors to actionable, secret-free messages. Order matters: subclasses before APIError. */
export function mapOpenAiError(err: unknown, model?: string): AiError {
  if (err instanceof AiError) return err;
  const upstream = (e: { message?: string }) => redactSecrets(String(e.message ?? "")).slice(0, 300);

  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AiError("TIMEOUT", "The OpenAI request timed out. Try again, or raise OPENAI_TIMEOUT_MS.");
  if (err instanceof OpenAI.APIConnectionError) return new AiError("UPSTREAM", "Couldn't reach the OpenAI API. Check the network connection.");
  if (err instanceof OpenAI.AuthenticationError) {
    return new AiError("AUTH", "OpenAI rejected the API key (401). Check OPENAI_API_KEY in backend/.env, then restart the backend.");
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new AiError("AUTH", `This API key isn't permitted to make this request (403): ${upstream(err)}`);
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new AiError("MODEL", `Model "${model ?? "?"}" wasn't found or this key can't access it (404). Check OPENAI_MODEL in backend/.env.`);
  }
  if (err instanceof OpenAI.RateLimitError) {
    if (err.code === "insufficient_quota") return new AiError("QUOTA", "The OpenAI account has no remaining quota (429 insufficient_quota). Check billing.");
    return new AiError("RATE_LIMITED", "OpenAI is rate limiting requests (429). Try again shortly.");
  }
  if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.UnprocessableEntityError) {
    return new AiError(
      "BAD_REQUEST",
      `OpenAI rejected the request (${err.status}): ${upstream(err)}. Check that OPENAI_MODEL supports Structured Outputs on the Responses API.`,
    );
  }
  if (err instanceof OpenAI.APIError) return new AiError("UPSTREAM", `OpenAI error${err.status ? ` (${err.status})` : ""}: ${upstream(err)}`);
  if (err instanceof OpenAI.OpenAIError) return new AiError("AUTH", `OpenAI client error: ${upstream(err)}`);
  return new AiError("UPSTREAM", err instanceof Error ? redactSecrets(err.message) : "Unknown AI error");
}
