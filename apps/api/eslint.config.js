import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

// Enforces the module-boundary discipline from the repo blueprint's backend
// section: a module (services/, metrics/, alerts/, deployments/, realtime/)
// may use infra/, but never reach into another module directly. Without a
// framework-level DI container (see the Fastify-over-NestJS decision), this
// lint rule is what actually holds that boundary.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "module", pattern: "src/modules/*/**" },
        { type: "infra", pattern: "src/infra/**" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [{ from: "module", allow: ["infra"] }],
        },
      ],
    },
  },
  { ignores: ["dist/**"] },
);
