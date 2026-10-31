import { createApp } from "../src/app";
import { createServices } from "../src/container";
import type { AiProvider } from "../src/ai/types";
import type { deleteChatMessage } from "../src/integrations/twitch/helix";
import { RecordingRealtime } from "../src/realtime/realtime";
import { signStreamerToken, signViewerToken } from "../src/services/appTokens";
import { encryptToken } from "../src/services/tokenCrypto";

export function setup(opts: { ai?: AiProvider; deleteMessage?: typeof deleteChatMessage } = {}) {
  const services = createServices(opts);
  const realtime = new RecordingRealtime();
  services.realtime.setTarget(realtime);
  const app = createApp(services);
  return { services, app, realtime };
}

export async function makeStreamer(
  services: ReturnType<typeof createServices>,
  opts: { demo?: boolean; scopes?: string[]; twitchUserId?: string } = {},
) {
  const twitchUserId = opts.twitchUserId ?? `user-${Math.random().toString(36).slice(2)}`;
  const connection = await services.repo.upsertConnection({
    twitchUserId,
    login: twitchUserId,
    displayName: twitchUserId,
    isDemo: opts.demo ?? false,
    scopes: opts.scopes ?? [],
    accessTokenEnc: opts.demo ? null : encryptToken("access-token"),
    refreshTokenEnc: opts.demo ? null : encryptToken("refresh-token"),
    tokenExpiresAt: opts.demo ? null : new Date(Date.now() + 3600_000).toISOString(),
  });
  const token = await signStreamerToken(connection.id, Boolean(opts.demo));
  return { connection, token, auth: { Authorization: `Bearer ${token}` } };
}

export async function viewerAuth(channelId: string | null) {
  const token = await signViewerToken(crypto.randomUUID(), channelId);
  return { Authorization: `Bearer ${token}` };
}
