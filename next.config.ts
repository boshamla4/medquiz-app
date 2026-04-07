import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevents better-sqlite3 native addon from being bundled into serverless functions
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
