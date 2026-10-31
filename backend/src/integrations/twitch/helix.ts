import { config } from "../../config";

const HELIX = "https://api.twitch.tv/helix";

export interface HelixResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function helix<T = unknown>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  accessToken: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<HelixResult<T>> {
  const url = new URL(`${HELIX}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": config.twitch.clientId ?? "",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (parsed as T) : null,
    error: res.ok ? null : (parsed?.message ?? text ?? res.statusText),
  };
}

export interface HelixUser {
  id: string;
  login: string;
  display_name: string;
}

export async function getAuthenticatedUser(accessToken: string): Promise<HelixUser> {
  const res = await helix<{ data: HelixUser[] }>("GET", "/users", accessToken);
  const user = res.data?.data[0];
  if (!res.ok || !user) throw new Error(`Get Users failed (${res.status}): ${res.error}`);
  return user;
}

/**
 * DELETE /helix/moderation/chat — requires a user token with
 * moderator:manage:chat_messages. moderator_id must match the token's user.
 * Twitch only allows deleting messages younger than 6 hours, and never the
 * broadcaster's or another moderator's messages.
 */
export function deleteChatMessage(accessToken: string, broadcasterId: string, moderatorId: string, messageId: string) {
  return helix("DELETE", "/moderation/chat", accessToken, {
    query: { broadcaster_id: broadcasterId, moderator_id: moderatorId, message_id: messageId },
  });
}

export function createChatMessageSubscription(accessToken: string, broadcasterId: string, userId: string, sessionId: string) {
  return helix<{ data: { id: string; status: string }[] }>("POST", "/eventsub/subscriptions", accessToken, {
    body: {
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, user_id: userId },
      transport: { method: "websocket", session_id: sessionId },
    },
  });
}
