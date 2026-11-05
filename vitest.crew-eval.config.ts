import { defineConfig, loadEnv } from "vite";
import path from "node:path";

// The model-quality evaluation of the AI automation agents (npm run crew:eval). Separate from vitest.config.ts so the normal suite never calls a model.
export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    include: ["src/lib/crew/eval/*.eval.ts"],
    env: loadEnv(mode, process.cwd(), ""),
    testTimeout: 1_800_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/lib/testShims/serverOnly.ts"),
    },
  },
}));
