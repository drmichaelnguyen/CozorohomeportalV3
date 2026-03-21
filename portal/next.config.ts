import type { NextConfig } from "next";

const apiServerOrigin = process.env.API_SERVER_ORIGIN?.trim() || "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
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
