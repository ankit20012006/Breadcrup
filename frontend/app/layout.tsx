import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Breadcrumb",
  description: "Get help without losing the joy of discovery. Spoiler-safe viewer hints, chat guard and chat pulse for Twitch streamers.",
};

export const viewport: Viewport = {
  themeColor: "#0e0c10",
  colorScheme: "dark",
};

// Fonts load at runtime from Google Fonts (with system fallbacks) rather than via
// next/font, so builds and the dev server never fail when the font CDN is unreachable.
const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body>{children}</body>
    </html>
  );
}
