import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/config";

describe("browser origin allowlist", () => {
  it("allows localhost and the configured LAN frontend origin", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://172.16.12.85:3000")).toBe(true);
  });

  it("does not allow other LAN origins or ports", () => {
    expect(isAllowedOrigin("http://172.16.12.85:3001")).toBe(false);
    expect(isAllowedOrigin("http://172.16.12.86:3000")).toBe(false);
  });
});
