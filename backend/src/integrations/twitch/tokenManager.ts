import { decryptToken, encryptToken } from "../../services/tokenCrypto";
import type { Repository, StreamerConnection } from "../../store/repository";
import { refreshAccessToken } from "./oauth";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Hands out a usable Twitch user access token, refreshing (and re-encrypting) when close to expiry. */
export class TwitchTokenManager {
  private refreshing = new Map<string, Promise<string>>();

  constructor(private repo: Repository) {}

  async getAccessToken(connection: StreamerConnection, opts: { forceRefresh?: boolean } = {}): Promise<string> {
    if (connection.isDemo || !connection.accessTokenEnc) throw new Error("This account has no Twitch credentials");
    const expiresAt = connection.tokenExpiresAt ? Date.parse(connection.tokenExpiresAt) : 0;
    if (!opts.forceRefresh && expiresAt - Date.now() > REFRESH_MARGIN_MS) return decryptToken(connection.accessTokenEnc);
    return this.refresh(connection);
  }

  private refresh(connection: StreamerConnection): Promise<string> {
    const pending = this.refreshing.get(connection.id);
    if (pending) return pending;
    const job = (async () => {
      if (!connection.refreshTokenEnc) throw new Error("No refresh token stored; the streamer must reconnect Twitch");
      const tokens = await refreshAccessToken(decryptToken(connection.refreshTokenEnc));
      await this.repo.updateConnection(connection.id, {
        accessTokenEnc: encryptToken(tokens.access_token),
        refreshTokenEnc: encryptToken(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes: tokens.scope ?? connection.scopes,
      });
      return tokens.access_token;
    })().finally(() => this.refreshing.delete(connection.id));
    this.refreshing.set(connection.id, job);
    return job;
  }
}
