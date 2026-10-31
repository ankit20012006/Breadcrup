import "dotenv/config";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: int(4000),
  /** Comma-separated list of allowed browser origins. */
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  PUBLIC_API_URL: z.string().default("http://localhost:4000"),

  DEMO_MODE: bool(true),
  DEMO_CHAT_SIMULATOR: bool(true),
  ALLOW_ANONYMOUS_VIEWERS: optionalString,

  APP_JWT_SECRET: optionalString,
  TOKEN_ENCRYPTION_KEY: optionalString,

  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  /** demo: offline heuristic by default. auto/openai opt into OpenAI when configured. */
  AI_PROVIDER: z.enum(["auto", "openai", "demo"]).default("demo"),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_TIMEOUT_MS: int(30000),
  /** Upper bound per response. Reasoning models count reasoning tokens here, so keep headroom. */
  OPENAI_MAX_OUTPUT_TOKENS: int(4000),

  TWITCH_CLIENT_ID: optionalString,
  TWITCH_CLIENT_SECRET: optionalString,
  TWITCH_REDIRECT_URI: optionalString,
  TWITCH_EXTENSION_CLIENT_ID: optionalString,
  TWITCH_EXTENSION_SECRET: optionalString,

  CHAT_PULSE_INTERVAL_SECONDS: int(25),
  CHAT_PULSE_MIN_MESSAGES: int(5),
  CHAT_PULSE_MAX_MESSAGES: int(150),

  GUARD_DUPLICATE_WINDOW_SECONDS: int(30),
  GUARD_DUPLICATE_THRESHOLD: int(3),
  GUARD_COPYPASTA_MIN_LENGTH: int(20),
  GUARD_SIMILARITY_THRESHOLD: z
    .string()
    .optional()
    .transform((v) => (v ? Number.parseFloat(v) : 0.75))
    .pipe(z.number().min(0.5).max(1)),
  GUARD_FLOOD_WINDOW_SECONDS: int(10),
  GUARD_FLOOD_THRESHOLD: int(6),
  GUARD_LINK_WINDOW_SECONDS: int(300),
  GUARD_LINK_THRESHOLD: int(3),
});

const env = envSchema.parse(process.env);

const isProduction = env.NODE_ENV === "production";
const twitchOAuthConfigured = Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET && env.TWITCH_REDIRECT_URI);

if (isProduction && !env.APP_JWT_SECRET) {
  throw new Error("APP_JWT_SECRET is required in production.");
}
if (isProduction && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production; in-memory storage is only available outside production.");
}
if (isProduction && twitchOAuthConfigured && !env.TOKEN_ENCRYPTION_KEY) {
  throw new Error("TOKEN_ENCRYPTION_KEY is required in production when Twitch OAuth is configured.");
}

export const config = {
  env: env.NODE_ENV,
  isProduction,
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  frontendOrigins: env.FRONTEND_URL.split(",").map((o) => o.trim().replace(/\/$/, "")),
  frontendUrl: env.FRONTEND_URL.split(",")[0]!.trim().replace(/\/$/, ""),
  publicApiUrl: env.PUBLIC_API_URL.replace(/\/$/, ""),

  demoMode: env.DEMO_MODE,
  demoChatSimulator: env.DEMO_CHAT_SIMULATOR,
  /** Anonymous viewer links are restricted to the explicit demo mode. */
  allowAnonymousViewers:
    env.DEMO_MODE &&
    (env.ALLOW_ANONYMOUS_VIEWERS === undefined ||
      ["1", "true", "yes", "on"].includes(env.ALLOW_ANONYMOUS_VIEWERS.toLowerCase())),

  // A random per-process secret is acceptable for local dev only (enforced above for prod).
  jwtSecret: env.APP_JWT_SECRET ?? `dev-only-${Math.random().toString(36).slice(2)}${Date.now()}`,
  tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,

  supabase:
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }
      : null,

  /** Raw AI settings; resolved (and validated) by resolveAiSetup() in ai/index.ts. Never log apiKey. */
  ai: {
    provider: env.AI_PROVIDER,
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
  },

  twitch: {
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    redirectUri: env.TWITCH_REDIRECT_URI,
    oauthConfigured: twitchOAuthConfigured,
    extensionClientId: env.TWITCH_EXTENSION_CLIENT_ID,
    extensionSecret: env.TWITCH_EXTENSION_SECRET,
    /** Scopes requested at login. Verified against Twitch docs:
     * - user:read:chat — EventSub channel.chat.message over WebSocket with a user token
     * - moderator:manage:chat_messages — DELETE /helix/moderation/chat */
    scopes: ["user:read:chat", "moderator:manage:chat_messages"],
  },

  chatPulse: {
    intervalSeconds: env.CHAT_PULSE_INTERVAL_SECONDS,
    minMessages: env.CHAT_PULSE_MIN_MESSAGES,
    maxMessages: env.CHAT_PULSE_MAX_MESSAGES,
  },

  guard: {
    duplicateWindowSeconds: env.GUARD_DUPLICATE_WINDOW_SECONDS,
    duplicateThreshold: env.GUARD_DUPLICATE_THRESHOLD,
    copypastaMinLength: env.GUARD_COPYPASTA_MIN_LENGTH,
    similarityThreshold: env.GUARD_SIMILARITY_THRESHOLD,
    floodWindowSeconds: env.GUARD_FLOOD_WINDOW_SECONDS,
    floodThreshold: env.GUARD_FLOOD_THRESHOLD,
    linkWindowSeconds: env.GUARD_LINK_WINDOW_SECONDS,
    linkThreshold: env.GUARD_LINK_THRESHOLD,
  },
};

/** Browser origins allowed for REST and Socket.IO: configured frontends plus Twitch's extension iframe host. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  const developmentOrigins = ["http://localhost:3000", "http://172.16.12.85:3000"];
  return (
    !origin ||
    config.frontendOrigins.includes(origin) ||
    (!config.isProduction && developmentOrigins.includes(origin)) ||
    /^https:\/\/[a-z0-9]+\.ext-twitch\.tv$/.test(origin)
  );
}

export type AppConfig = typeof config;
export type AiSettings = AppConfig["ai"];
export type GuardConfig = AppConfig["guard"];
