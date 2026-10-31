import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function importProductionConfig(overrides: Record<string, string>) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    APP_JWT_SECRET: "test-only-jwt-secret",
    TOKEN_ENCRYPTION_KEY: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    TWITCH_CLIENT_ID: "",
    TWITCH_CLIENT_SECRET: "",
    TWITCH_REDIRECT_URI: "",
    ...overrides,
  };
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('./src/config.ts')"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env,
    encoding: "utf8",
  });
}

describe("production persistence configuration", () => {
  it("fails clearly when Supabase credentials are missing", () => {
    const result = importProductionConfig({});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production");
  });

  it.each([
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "" },
    { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role-key" },
  ])("fails clearly when Supabase credentials are incomplete", (overrides: Record<string, string>) => {
    const result = importProductionConfig(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production");
  });
});
