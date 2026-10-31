import { config, type AiSettings } from "../config";
import { DemoHeuristicProvider } from "./demoProvider";
import { OpenAiProvider } from "./openaiProvider";
import type { AiProvider } from "./types";

export type AiSetup =
  | { kind: "openai"; apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number }
  /** issue: a human-readable setup problem to surface in the UI, or null when demo is intentional. */
  | { kind: "demo"; issue: string | null };

export class AiConfigError extends Error {}

/**
 * Decides which provider to use. Half-configured OpenAI settings never fall back
 * silently: they produce an `issue` shown in the dashboard (auto) or a startup
 * error (AI_PROVIDER=openai). The API key is never included in any message.
 */
export function resolveAiSetup(s: AiSettings): AiSetup {
  const missing = [!s.apiKey && "OPENAI_API_KEY", !s.model && "OPENAI_MODEL"].filter(Boolean) as string[];

  if (s.provider === "demo") return { kind: "demo", issue: null };

  if (missing.length === 0) {
    return { kind: "openai", apiKey: s.apiKey!, model: s.model!, timeoutMs: s.timeoutMs, maxOutputTokens: s.maxOutputTokens };
  }
  if (s.provider === "openai") {
    throw new AiConfigError(`AI_PROVIDER=openai but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set in backend/.env.`);
  }
  if (missing.length === 1) {
    return {
      kind: "demo",
      issue: `${missing[0]} is not set, so the labelled demo heuristic is used instead of OpenAI. Set both OPENAI_API_KEY and OPENAI_MODEL in backend/.env and restart the backend.`,
    };
  }
  return { kind: "demo", issue: null };
}

export function createAiProvider(settings: AiSettings = config.ai): { provider: AiProvider; issue: string | null } {
  const setup = resolveAiSetup(settings);
  if (setup.kind === "openai") {
    return {
      provider: new OpenAiProvider(setup.model, { apiKey: setup.apiKey, timeoutMs: setup.timeoutMs, maxOutputTokens: setup.maxOutputTokens }),
      issue: null,
    };
  }
  if (setup.issue) console.warn(`[ai] ${setup.issue}`);
  return { provider: new DemoHeuristicProvider(), issue: setup.issue };
}

export * from "./types";
