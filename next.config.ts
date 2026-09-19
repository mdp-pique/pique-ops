import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // This is a live ops queue - every tab switch should hit the server for
    // current data, not show whatever was cached from an earlier visit.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
