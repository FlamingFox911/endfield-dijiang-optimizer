import { mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const cliRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(cliRoot, "..", "..");
const distRoot = path.resolve(cliRoot, "dist");

await mkdir(distRoot, { recursive: true });

await build({
  entryPoints: [path.resolve(cliRoot, "src", "index.ts")],
  outfile: path.resolve(distRoot, "endfield-opt.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  define: {
    "import.meta.url": "undefined",
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});

await cp(path.resolve(repoRoot, "catalogs"), path.resolve(distRoot, "catalogs"), {
  recursive: true,
  force: true,
});

await cp(path.resolve(repoRoot, "scenarios"), path.resolve(distRoot, "scenarios"), {
  recursive: true,
  force: true,
});

await writeFile(
  path.resolve(distRoot, "README.txt"),
  [
    "Bundled CLI assets",
    "This directory contains the executable, bundled catalogs, and example scenarios required by endfield-opt.",
  ].join("\n"),
  "utf8",
);
