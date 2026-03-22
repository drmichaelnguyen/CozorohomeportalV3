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

const nextConfig: NextConfig = {
  output: "standalone",
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
  }
};

export default nextConfig;
