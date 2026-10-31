import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAiProvider, type ResponsesClient } from "../src/ai/openaiProvider";

/**
 * Runs the real OpenAI SDK against a local stand-in for POST /v1/responses, so the
 * actual wire request and the SDK's own response parsing (output_text is derived from
 * output[] client-side) are exercised. This is NOT a test against OpenAI itself.
 */
let server: Server;
let baseURL: string;
let lastBody: any = null;
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = raw ? JSON.parse(raw) : null;
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

const provider = () =>
  new OpenAiProvider("test-model", { client: new OpenAI({ apiKey: "sk-test-placeholder", baseURL, maxRetries: 0, timeout: 3000 }) as unknown as ResponsesClient });

const responseWith = (text: string) => ({
  id: "resp_test",
  object: "response",
  created_at: 0,
  status: "completed",
  model: "test-model",
  output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
});

describe("OpenAI provider over the wire (real SDK, local stub server)", () => {
  it("sends a strict json_schema Responses request and parses output[] via the SDK", async () => {
    const ladder = { status: "READY", reason: null, hints: [{ tier: 1, text: "Look around.", supporting_clue_refs: ["C1"] }], flagged_clue_refs: [] };
    reply = { status: 200, body: responseWith(JSON.stringify(ladder)) };
    const out = await provider().generateHints({ game: "G", question: "Q?", context: "", clues: [{ ref: "C1", text: "check the wall" }] });
    expect(out).toEqual(ladder);

    expect(lastBody.model).toBe("test-model");
    expect(lastBody.store).toBe(false);
    expect(lastBody.text.format).toMatchObject({ type: "json_schema", name: "hint_ladder", strict: true });
    expect(lastBody.text.format.schema.additionalProperties).toBe(false);
    expect(lastBody.input[0]).toMatchObject({ role: "user" });
    expect(JSON.parse(lastBody.input[0].content).viewer_clues).toEqual([{ ref: "C1", text: "check the wall" }]);
  });

  it("maps HTTP 429 to RATE_LIMITED and 500 to UPSTREAM", async () => {
    reply = { status: 429, body: { error: { message: "Rate limit reached", type: "rate_limit_error" } } };
    await expect(provider().generateHints({ game: "G", question: "Q?", context: "", clues: [] })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    reply = { status: 500, body: { error: { message: "boom", type: "server_error" } } };
    await expect(provider().generateHints({ game: "G", question: "Q?", context: "", clues: [] })).rejects.toMatchObject({ code: "UPSTREAM" });
  });

  it("maps an unreachable endpoint to UPSTREAM instead of crashing", async () => {
    const dead = new OpenAiProvider("m", { client: new OpenAI({ apiKey: "sk-test", baseURL: "http://127.0.0.1:9/v1", maxRetries: 0, timeout: 2000 }) as unknown as ResponsesClient });
    await expect(dead.summarizeChat({ game: null, messages: [] })).rejects.toMatchObject({ code: "UPSTREAM" });
  });
});
