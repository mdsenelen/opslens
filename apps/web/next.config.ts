import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // apps/api ships TS source directly (no build step in dev); Next needs to
  // transpile the shared-types workspace package itself rather than expect
  // a prebuilt dist/.
  transpilePackages: ["@opslens/shared-types"],
  // The floating dev-tools badge overlaps the bottom-left of every page in
  // local screenshots and demos; build errors still surface as an overlay.
  devIndicators: false,
};

export default nextConfig;
