import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const cliPath = path.resolve(repoRoot, "apps", "cli", "dist", "endfield-opt.cjs");

function ensureBuiltCli() {
  if (!existsSync(cliPath)) {
    execFileSync("npm", ["run", "build", "--workspace", "@endfield/cli"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
    });
  }
}

describe("cli", () => {
  it("validates bundled data through the packaged command", () => {
    ensureBuiltCli();
    const output = execFileSync(process.execPath, [cliPath, "validate-data", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const parsed = JSON.parse(output);
    expect(parsed.bundleValidation.ok).toBe(true);
    expect(parsed.scenarioResults.length).toBeGreaterThan(0);
  });

  it("packs bundled catalogs and scenarios with the published CLI artifact", { timeout: 15000 }, () => {
    ensureBuiltCli();
    const output = execFileSync("npm", ["pack", "--workspace", "@endfield/cli", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: true,
    });

    const packed = JSON.parse(output)[0];
    const paths = new Set((packed.files as Array<{ path: string }>).map((entry) => entry.path));
    expect(paths.has("dist/catalogs/2026-03-29-v1.1-phase2/manifest.json")).toBe(true);
    expect(paths.has("dist/scenarios/examples/current-base.simple.json")).toBe(true);
    expect(paths.has("dist/endfield-opt.cjs")).toBe(true);
  });
});
