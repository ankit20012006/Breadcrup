import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests always run against the in-memory store and demo providers.
    env: {
      NODE_ENV: "test",
      DEMO_MODE: "true",
      APP_JWT_SECRET: "test-secret-test-secret-test-secret-123",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      OPENAI_API_KEY: "",
      DEMO_CHAT_SIMULATOR: "false",
      CHAT_PULSE_INTERVAL_SECONDS: "0",
    },
  },
});
