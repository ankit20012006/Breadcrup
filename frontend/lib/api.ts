const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
export const API_URL = (configuredApiUrl ?? "http://localhost:4000").replace(/\/$/, "");

export function getApiUrl(): string {
  if (!configuredApiUrl && process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return API_URL;
}

// The backend's default upstream AI deadline is 30 seconds; allow 5 seconds for
// the API response to reach the browser before releasing action loading states.
export const API_REQUEST_TIMEOUT_MS = 35_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const STREAMER_TOKEN_KEY = "breadcrumb.streamerToken";
export const STREAMER_TOKEN_EVENT = "breadcrumb:streamer-token";

function notifyStreamerTokenChange(token: string | null) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STREAMER_TOKEN_EVENT, { detail: token }));
  }
}

/** localStorage can throw (private mode, blocked storage, sandboxed iframes). */
export const streamerToken = {
  get(): string | null {
    try {
      return localStorage.getItem(STREAMER_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(STREAMER_TOKEN_KEY, token);
    } catch {
      /* session-only */
    }
    notifyStreamerTokenChange(token);
  },
  clear() {
    try {
      localStorage.removeItem(STREAMER_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    notifyStreamerTokenChange(null);
  },
};

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_REQUEST_TIMEOUT_MS);

  try {
    let res: Response;
    try {
      res = await fetch(`${getApiUrl()}${path}`, {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      if (timedOut) {
        throw new ApiError(504, "The Breadcrumb API request took too long. Check that the backend is responsive, then try again.", "TIMEOUT");
      }
      throw new ApiError(0, `Can't reach the Breadcrumb API at ${getApiUrl()}. Is the backend running?`, "NETWORK");
    }

    if (res.status === 204) return undefined as T;

    let data: { error?: string; code?: string; issues?: { path: string; message: string }[] } | null;
    try {
      data = await res.json();
    } catch {
      if (timedOut) {
        throw new ApiError(504, "The Breadcrumb API request took too long. Check that the backend is responsive, then try again.", "TIMEOUT");
      }
      if (res.ok) throw new ApiError(502, "The Breadcrumb API returned an invalid response.", "INVALID_RESPONSE");
      data = null;
    }
    if (!res.ok) {
      const issues = Array.isArray(data?.issues) ? ` (${data.issues.map((i) => `${i.path}: ${i.message}`).join(", ")})` : "";
      throw new ApiError(res.status, `${data?.error ?? `Request failed (${res.status})`}${issues}`, data?.code);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");
