import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === "development" ? { allowedDevOrigins: ["172.16.12.85"] } : {}),
  // The shared workspace package ships TypeScript source.
  transpilePackages: ["@breadcrumb/shared"],
  async headers() {
    return [
      {
        // The viewer panel must be embeddable by Twitch's extension iframe.
        source: "/extension",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors https://*.twitch.tv https://*.ext-twitch.tv 'self'" }],
      },
    ];
  },
};

export default nextConfig;
