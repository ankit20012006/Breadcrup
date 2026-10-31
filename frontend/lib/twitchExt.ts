/**
 * Twitch Extension integration. When the viewer panel runs inside Twitch's
 * extension iframe, Twitch appends query params like `platform`, `mode` and
 * `anchor`. In that case we load the official helper and wait for onAuthorized,
 * whose JWT the backend verifies with the extension secret.
 */
const HELPER_URL = "https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js";

interface TwitchExtAuth {
  token: string;
  channelId: string;
  userId: string;
}

declare global {
  interface Window {
    Twitch?: { ext: { onAuthorized(cb: (auth: TwitchExtAuth) => void): void } };
  }
}

export function isInTwitchExtension(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.has("platform") && params.has("anchor") && window.parent !== window;
}

export function getTwitchExtensionToken(timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Twitch did not authorise the extension in time")), timeoutMs);
    const onReady = () => window.Twitch!.ext.onAuthorized((auth) => {
      clearTimeout(timer);
      resolve(auth.token);
    });
    if (window.Twitch?.ext) return onReady();
    const script = document.createElement("script");
    script.src = HELPER_URL;
    script.onload = onReady;
    script.onerror = () => reject(new Error("Couldn't load the Twitch extension helper"));
    document.head.appendChild(script);
  });
}
