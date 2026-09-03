import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

// Enforces the four-layer frontend convention from the repo blueprint:
// UI (components/) must stay presentational, feature/ composes UI + data,
// lib/ is fetch/query/URL-state infrastructure, app/ is routes. See
// apps/web/README section "Frontend layering" for the full rationale.
const boundariesConfig = {
  plugins: { boundaries },
  settings: {
    "boundaries/elements": [
      // Matched before feature/ui/lib below so a co-located *.test.ts(x)
      // file (or a helper under src/test/) is classified as "test", not as
      // whichever layer it happens to sit in — tests legitimately need to
      // import across every layer to exercise it. mode: "file" is required
      // here: the default "folder" mode treats the pattern as identifying
      // a parent directory (which is right for feature/ui/lib below, but
      // would make a suffix pattern like *.test.tsx match nothing).
      { type: "test", pattern: "*.test.{ts,tsx}", mode: "file" },
      { type: "test", pattern: "src/test/**" },
      { type: "app", pattern: "src/app/**" },
      // capture: ["family"] identifies which features/<family> folder a
      // file belongs to, so the rule below can allow a feature's own files
      // (container + chart component + CSS module, etc.) to reference each
      // other while still blocking one feature from reaching into another.
      { type: "feature", pattern: "src/features/*/**", capture: ["family"] },
      { type: "ui", pattern: "src/components/**" },
      { type: "lib", pattern: "src/lib/**" },
    ],
  },
  rules: {
    "boundaries/element-types": [
      "error",
      {
        default: "disallow",
        rules: [
          { from: "test", allow: ["test", "app", "feature", "ui", "lib"] },
          { from: "app", allow: ["feature", "ui", "lib"] },
          { from: "feature", allow: ["ui", "lib", ["feature", { family: "${from.family}" }]] },
          { from: "ui", allow: ["ui"] },
          { from: "lib", allow: ["lib"] },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundariesConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
