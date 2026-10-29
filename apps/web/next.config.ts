import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  // Video uploads go through the /api proxy below; Next cuts proxied bodies at 10 MB by default.
  // Matches the API's own 300 MB upload limit.
  experimental: { proxyClientMaxBodySize: "300mb" },
  // /api/* is proxied to the API server, so the session cookie is first-party.
  // (iOS Safari blocks third-party cookies, so a separate API domain would break login.)
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
