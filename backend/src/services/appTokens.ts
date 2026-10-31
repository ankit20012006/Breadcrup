import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";

const secret = () => new TextEncoder().encode(config.jwtSecret);
const ISSUER = "breadcrumb";

export interface StreamerClaims {
  kind: "streamer";
  /** streamer_connections.id */
  sub: string;
  demo: boolean;
}

export interface ViewerClaims {
  kind: "viewer";
  /** Opaque viewer id, scoped to Breadcrumb. */
  sub: string;
  /** streamer_connections.id of the channel the viewer is watching, if known. */
  channel: string | null;
  anonymous: boolean;
}

export async function signStreamerToken(connectionId: string, demo: boolean): Promise<string> {
  return new SignJWT({ kind: "streamer", demo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(connectionId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export async function signViewerToken(viewerId: string, channel: string | null): Promise<string> {
  return new SignJWT({ kind: "viewer", channel, anonymous: true })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(viewerId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("6h")
    .sign(secret());
}

export async function verifyAppToken(token: string): Promise<StreamerClaims | ViewerClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, algorithms: ["HS256"] });
    if (!payload.sub) return null;
    if (payload.kind === "streamer") return { kind: "streamer", sub: payload.sub, demo: Boolean(payload.demo) };
    if (payload.kind === "viewer") {
      return {
        kind: "viewer",
        sub: payload.sub,
        channel: typeof payload.channel === "string" ? payload.channel : null,
        anonymous: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Short-lived signed OAuth `state` so the callback can't be forged or replayed later. */
export async function signOAuthState(nonce: string): Promise<string> {
  return new SignJWT({ kind: "oauth_state", nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret());
}

export async function verifyOAuthState(state: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(state, secret(), { issuer: ISSUER, algorithms: ["HS256"] });
    return payload.kind === "oauth_state" && typeof payload.nonce === "string" && /^[a-f0-9]{32}$/.test(payload.nonce);
  } catch {
    return false;
  }
}
