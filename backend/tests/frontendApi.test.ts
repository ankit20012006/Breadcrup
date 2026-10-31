import { afterEach, describe, expect, it, vi } from "vitest";
import { API_REQUEST_TIMEOUT_MS, API_URL, ApiError, api, getApiUrl, STREAMER_TOKEN_EVENT, streamerToken } from "../../frontend/lib/api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("frontend API client", () => {
  it("uses the local backend URL and sends the expected request details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "session-1" }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api<{ id: string }>("/api/sessions", { body: { game: "Demo" }, token: "streamer-token" })).resolves.toEqual({
      id: "session-1",
    });

    expect(API_URL).toMatch(/localhost:4000$/);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API_URL}/api/sessions`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer streamer-token" });
    expect(init?.body).toBe(JSON.stringify({ game: "Demo" }));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the current browser hostname for API requests in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("window", { location: { hostname: "172.16.12.85", protocol: "http:" } });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(getApiUrl()).toBe("http://172.16.12.85:4000");
    await api("/health");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://172.16.12.85:4000/health");
  });

  it("notifies an already-mounted dashboard when OAuth replaces the demo token", () => {
    const browser = new EventTarget();
    const localStorage = { setItem: vi.fn(), removeItem: vi.fn() };
    let updatedToken: string | null = null;
    browser.addEventListener(STREAMER_TOKEN_EVENT, (event) => {
      updatedToken = (event as CustomEvent<string | null>).detail;
    });
    vi.stubGlobal("window", browser);
    vi.stubGlobal("localStorage", localStorage);

    streamerToken.set("twitch-session-token");
    expect(updatedToken).toBe("twitch-session-token");
    streamerToken.clear();
    expect(updatedToken).toBeNull();
  });

  it("surfaces API errors and invalid success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "Session is closed", code: "SESSION_CLOSED" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response("not JSON", { status: 200 })),
    );

    await expect(api("/api/sessions/closed")).rejects.toMatchObject({
      status: 409,
      message: "Session is closed",
      code: "SESSION_CLOSED",
    });
    await expect(api("/api/auth/status")).rejects.toMatchObject({
      status: 502,
      message: "The Breadcrumb API returned an invalid response.",
      code: "INVALID_RESPONSE",
    });
  });

  it("reports an unavailable backend with a useful message", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")));

    await expect(api("/api/auth/status")).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("Can't reach the Breadcrumb API at"),
      code: "NETWORK",
    } satisfies Partial<ApiError>);
  });

  it("aborts a stalled request and rejects with a recoverable timeout error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          }),
      ),
    );

    const pending = api("/api/sessions");
    const rejected = expect(pending).rejects.toMatchObject({
      status: 504,
      message: "The Breadcrumb API request took too long. Check that the backend is responsive, then try again.",
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejected;
  });
});
