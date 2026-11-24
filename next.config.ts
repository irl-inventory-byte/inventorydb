import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next.js caches a visited dynamic page in the browser for a little while (30s by default) and can
    // reuse it for the NEXT dynamic navigation under some conditions. That's almost certainly why every
    // power bank you click shows the same rig (IC-151) — whichever dynamic item page loaded first got
    // stuck in this cache and kept being reused. Setting "dynamic" to 0 tells Next.js to never reuse a
    // cached dynamic page client-side — every click to /inventory/[id] always fetches fresh.
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;