import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
});
