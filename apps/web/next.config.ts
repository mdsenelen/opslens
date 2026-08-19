import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // apps/api ships TS source directly (no build step in dev); Next needs to
  // transpile the shared-types workspace package itself rather than expect
  // a prebuilt dist/.
  transpilePackages: ["@opslens/shared-types"],
};

export default nextConfig;
