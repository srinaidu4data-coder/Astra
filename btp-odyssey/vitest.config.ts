import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
  resolve: {
    alias: {
      "@btp-odyssey/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@btp-odyssey/simulation": path.resolve(__dirname, "packages/simulation/src/index.ts"),
      "@btp-odyssey/content-engine": path.resolve(__dirname, "packages/content-engine/src/index.ts"),
      "@btp-odyssey/competency": path.resolve(__dirname, "packages/competency/src/index.ts"),
      "@btp-odyssey/assessment": path.resolve(__dirname, "packages/assessment/src/index.ts"),
    },
  },
});
