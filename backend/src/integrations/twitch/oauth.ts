import { config } from "../../config";

/** Twitch OAuth authorization code grant flow (https://id.twitch.tv/oauth2). */
const ID_BASE = "https://id.twitch.tv/oauth2";

export interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: string;
}

export interface TwitchValidation {
  client_id: string;
  login: string;
  user_id: string;
  scopes: string[] | null;
  expires_in: number;
}

function requireOAuth() {
  const { clientId, clientSecret, redirectUri, oauthConfigured } = config.twitch;
  if (!oauthConfigured || !clientId || !clientSecret || !redirectUri) throw new Error("Twitch OAuth is not configured");
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireOAuth();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: config.twitch.scopes.join(" "),
    state,
    force_verify: "true",
  });
  return `${ID_BASE}/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TwitchTokenResponse> {
  const res = await fetch(`${ID_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Twitch token endpoint returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as TwitchTokenResponse;
}

export function exchangeCode(code: string) {
  const { clientId, clientSecret, redirectUri } = requireOAuth();
  return tokenRequest({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
}

export function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = requireOAuth();
  return tokenRequest({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Returns null if the token is invalid/revoked. */
export async function validateAccessToken(accessToken: string): Promise<TwitchValidation | null> {
  const res = await fetch(`${ID_BASE}/validate`, { headers: { Authorization: `OAuth ${accessToken}` } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Twitch validate returned ${res.status}`);
  return (await res.json()) as TwitchValidation;
}
