import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "";
const publicApiOrigin = /^https?:\/\//i.test(publicApiBaseUrl) ? publicApiBaseUrl.replace(/\/+$/, "") : "";
const apiServerOrigin =
  process.env.API_SERVER_ORIGIN?.trim() ||
  publicApiOrigin ||
  "http://127.0.0.1:4000";

// AntiGravity: Added clear console warning if origins are missing in production build
if (!process.env.API_SERVER_ORIGIN && !publicApiOrigin) {
  console.warn("⚠️ [AntiGravity] API_SERVER_ORIGIN and NEXT_PUBLIC_API_BASE_URL are missing. Using local fallback 127.0.0.1:4000 for backend proxy.");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["app.cozorohome.com"],
  devIndicators: { position: "top-left" },
  turbopack: {
    root: configDir
  },
  async rewrites() {
    return [
      {
        source: "/api-proxy/:path*",
        destination: `${apiServerOrigin}/:path*`
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-transform"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
