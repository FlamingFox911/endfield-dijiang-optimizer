import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const workspaceSourceAliases = {
  "@endfield/data": fileURLToPath(new URL("../../packages/data/src/index.ts", import.meta.url)),
  "@endfield/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
  "@endfield/optimizer": fileURLToPath(new URL("../../packages/optimizer/src/index.ts", import.meta.url)),
};

function normalizeBasePath(basePath = "/"): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig({
  plugins: [react()],
  base: normalizeBasePath(process.env.PAGES_BASE_PATH),
  resolve: {
    alias: workspaceSourceAliases,
  },
});
