import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { StreamerProfile, SystemStatus } from "@breadcrumb/shared";
import { config } from "../config";
import type { Services } from "../container";
import { buildAuthorizeUrl, exchangeCode, validateAccessToken } from "../integrations/twitch/oauth";
import { getAuthenticatedUser } from "../integrations/twitch/helix";
import { requireStreamer } from "../middleware/auth";
import { HttpError } from "../middleware/errors";
import { signOAuthState, signStreamerToken, verifyOAuthState } from "../services/appTokens";
import { decryptToken, encryptToken } from "../services/tokenCrypto";
import { DELETE_SCOPE } from "../services/moderationService";
import type { StreamerConnection } from "../store/repository";

const STATE_COOKIE = "bc_oauth_state";

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function systemStatus(s: Services): SystemStatus {
  return {
    mode: config.demoMode ? "demo" : "live",
    persistence: s.repo.kind,
    ai: { provider: s.ai.name, model: s.ai.model, issue: s.aiIssue },
    twitch: { oauthConfigured: config.twitch.oauthConfigured, extensionConfigured: Boolean(config.twitch.extensionSecret) },
    anonymousViewers: config.allowAnonymousViewers,
    chatPulseIntervalSeconds: config.chatPulse.intervalSeconds,
  };
}

export function toProfile(s: Services, c: StreamerConnection): StreamerProfile {
  const chat = s.eventsub.status(c.id);
  return {
    id: c.id,
    twitchUserId: c.twitchUserId,
    login: c.login,
    displayName: c.displayName,
    isDemo: c.isDemo,
    scopes: c.scopes,
    chatConnected: c.isDemo ? true : chat.connected && chat.subscribed,
    canDeleteMessages: c.isDemo ? true : c.scopes.includes(DELETE_SCOPE),
  };
}

export function authRoutes(s: Services): Router {
  const r = Router();

  r.get("/status", (_req, res) => {
    res.json(systemStatus(s));
  });

  r.post("/demo", async (_req, res) => {
    if (!config.demoMode) throw new HttpError(403, "Demo mode is disabled on this server", "DEMO_DISABLED");
    const streamer = await s.demo.seed();
    res.json({ token: await signStreamerToken(streamer.id, true), streamer: toProfile(s, streamer) });
  });

  r.get("/twitch/login", async (_req, res) => {
    if (!config.twitch.oauthConfigured) throw new HttpError(503, "Twitch OAuth is not configured on this server", "TWITCH_NOT_CONFIGURED");
    const nonce = randomBytes(16).toString("hex");
    const state = await signOAuthState(nonce);
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      maxAge: 10 * 60 * 1000,
      path: "/api/auth/twitch",
    });
    res.redirect(buildAuthorizeUrl(state));
  });

  r.get("/twitch/callback", async (req, res) => {
    const fail = (message: string) => res.redirect(`${config.frontendUrl}/auth/complete#error=${encodeURIComponent(message)}`);
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
    if (error) return fail(error_description || error);
    const cookieState = readCookie(req.headers.cookie, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: "/api/auth/twitch" });
    if (!code || !state || state !== cookieState || !(await verifyOAuthState(state))) {
      return fail("Login expired or was tampered with. Please try again.");
    }
    try {
      const tokens = await exchangeCode(code);
      const validation = await validateAccessToken(tokens.access_token);
      if (!validation) return fail("Twitch returned an invalid token.");
      const user = await getAuthenticatedUser(tokens.access_token);
      if (validation.client_id !== config.twitch.clientId || validation.user_id !== user.id) {
        return fail("Twitch token validation did not match the authenticated account.");
      }
      const connection = await s.repo.upsertConnection({
        twitchUserId: user.id,
        login: user.login,
        displayName: user.display_name,
        isDemo: false,
        scopes: validation.scopes ?? tokens.scope ?? [],
        accessTokenEnc: encryptToken(tokens.access_token),
        refreshTokenEnc: encryptToken(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      });
      await s.eventsub.start(connection);
      const appToken = await signStreamerToken(connection.id, false);
      res.redirect(`${config.frontendUrl}/auth/complete#token=${encodeURIComponent(appToken)}`);
    } catch (err) {
      console.error("[auth] Twitch callback failed", err);
      fail("Couldn't complete Twitch login. Check the server logs.");
    }
  });

  r.get("/me", requireStreamer(s.repo), (req, res) => {
    res.json({ streamer: toProfile(s, req.streamer!), chat: s.eventsub.status(req.streamer!.id) });
  });

  /** Revokes the stored Twitch token and forgets it. */
  r.post("/twitch/disconnect", requireStreamer(s.repo), async (req, res) => {
    const c = req.streamer!;
    if (c.isDemo) throw new HttpError(400, "The demo account is not connected to Twitch", "DEMO_ACCOUNT");
    s.eventsub.stop(c.id);
    let revoked = false;
    if (c.accessTokenEnc && config.twitch.clientId) {
      const body = new URLSearchParams({ client_id: config.twitch.clientId, token: decryptToken(c.accessTokenEnc) });
      try {
        const response = await fetch("https://id.twitch.tv/oauth2/revoke", { method: "POST", body });
        revoked = response.ok;
        if (!response.ok) console.warn(`[auth] Twitch token revocation returned ${response.status}`);
      } catch (err) {
        console.warn("[auth] Twitch token revocation request failed", err);
      }
    }
    await s.repo.updateConnection(c.id, { accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, scopes: [] });
    res.json({ revoked });
  });

  return r;
}
