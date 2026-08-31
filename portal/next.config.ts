import type { NextConfig } from "next";

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
  // Monorepo `turbopack.root` caused dev/tooling JSON parse issues on some Windows + OneDrive setups; portal uses `next dev --webpack`.
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
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable, no-transform"
          }
        ]
      },
      {
        source: "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|ico|svg|txt|js|json|woff2?)$).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate, no-transform"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
