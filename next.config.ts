import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pique-a-choo reads these docs to scope tech requests against what's built (src/lib/ai/howItWorks.ts).
  outputFileTracingIncludes: {
    "/api/slack/events": ["./CLAUDE.md", "./docs/pique-bot-notification-legend.md", "./docs/zapier-migration.md"],
  },
  experimental: {
    // This is a live ops queue - every tab switch should hit the server for
    // current data, not show whatever was cached from an earlier visit.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
