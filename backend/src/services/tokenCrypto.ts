import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config";

/**
 * AES-256-GCM encryption for Twitch OAuth tokens at rest. The key comes from
 * TOKEN_ENCRYPTION_KEY (any string; hashed to 32 bytes). Format: v1.<iv>.<tag>.<ciphertext>.
 */
function key(): Buffer {
  const material = config.tokenEncryptionKey ?? (config.isProduction ? undefined : config.jwtSecret);
  if (!material) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return createHash("sha256").update(material).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(encoded: string): string {
  const [version, iv, tag, ciphertext] = encoded.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unrecognised token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
