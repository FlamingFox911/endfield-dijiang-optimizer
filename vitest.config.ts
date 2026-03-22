import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@endfield/data/node", replacement: path.resolve(repoRoot, "packages/data/src/node.ts") },
      { find: "@endfield/data", replacement: path.resolve(repoRoot, "packages/data/src/index.ts") },
      { find: "@endfield/domain", replacement: path.resolve(repoRoot, "packages/domain/src/index.ts") },
      { find: "@endfield/optimizer", replacement: path.resolve(repoRoot, "packages/optimizer/src/index.ts") },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
  },
});
