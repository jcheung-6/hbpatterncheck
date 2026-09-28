import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["sharp"],
  reactStrictMode: true,
  experimental: {
    middlewareClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
