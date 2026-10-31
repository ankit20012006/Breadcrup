import { jwtVerify } from "jose";
import { config } from "../../config";

/**
 * Verifies the JWT that the Twitch Extension helper hands to the extension frontend
 * (window.Twitch.ext.onAuthorized -> auth.token). Twitch signs it with HS256 using the
 * extension's shared secret, which the developer console shows base64-encoded.
 */
export interface ExtensionClaims {
  opaqueUserId: string;
  /** Present only when the viewer has shared their identity with the extension. */
  userId: string | null;
  channelId: string;
  role: "broadcaster" | "moderator" | "viewer" | "external";
}

export async function verifyExtensionJwt(token: string): Promise<ExtensionClaims | null> {
  const secret = config.twitch.extensionSecret;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, Buffer.from(secret, "base64"), { algorithms: ["HS256"] });
    const opaque = payload.opaque_user_id;
    const channel = payload.channel_id;
    if (typeof opaque !== "string" || typeof channel !== "string") return null;
    return {
      opaqueUserId: opaque,
      userId: typeof payload.user_id === "string" ? payload.user_id : null,
      channelId: channel,
      role: (payload.role as ExtensionClaims["role"]) ?? "viewer",
    };
  } catch {
    return null;
  }
}
