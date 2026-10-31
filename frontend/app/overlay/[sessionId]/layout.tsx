import type { Viewport } from "next";

// The app is dark-scheme, but with a transparent page Chromium (and OBS's CEF) paints
// the dark-scheme canvas colour behind it. Reset the scheme so the backdrop is truly clear.
export const viewport: Viewport = { colorScheme: "normal" };

/** OBS Browser Source needs a transparent page; override the app background for this route only. */
export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`html, body { background: transparent !important; color-scheme: normal !important; }`}</style>
      {children}
    </>
  );
}
