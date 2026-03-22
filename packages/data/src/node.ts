import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CatalogBundle, CatalogManifest, GameCatalog, OptimizationScenario } from "@endfield/domain";

import {
  CURRENT_CATALOG_BUNDLE_ID,
  CURRENT_CATALOG_VERSION,
  EXAMPLE_SCENARIOS_DIR,
  toGameCatalog,
  validateCatalogBundle,
  validateScenarioAgainstCatalog,
} from "./index.js";

const runtimeFilename =
  typeof __filename === "string"
    ? __filename
    : fileURLToPath(import.meta.url);
const __dirname = path.dirname(runtimeFilename);

function detectRepoRoot(): string {
  const candidates = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", ".."),
    path.resolve(__dirname, "..", "..", ".."),
    path.resolve(__dirname, "..", "..", "..", ".."),
    path.resolve(__dirname, "..", "..", "..", "..", ".."),
  ];

  for (const candidate of candidates) {
    let current = path.resolve(candidate);
    while (true) {
      const hasCatalogs = existsSync(path.resolve(current, "catalogs"));
      const hasScenarios = existsSync(path.resolve(current, "scenarios"));
      if (hasCatalogs && hasScenarios) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return process.cwd();
}

const REPO_ROOT = detectRepoRoot();

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(REPO_ROOT, ...segments);
}

export function resolveBundledPath(...segments: string[]): string {
  return resolveRepoPath(...segments);
}

export async function loadCatalogBundle(
  bundleDir = resolveRepoPath("catalogs", CURRENT_CATALOG_BUNDLE_ID),
): Promise<CatalogBundle> {
  const manifestPath = path.resolve(bundleDir, "manifest.json");
  const manifest = await readJsonFile<CatalogManifest>(manifestPath);

  const [progression, operators, facilities, recipes, sources, gaps, assets] = await Promise.all([
    readJsonFile<CatalogBundle["progression"]>(path.resolve(bundleDir, manifest.files.progression)),
    readJsonFile<CatalogBundle["operators"]>(path.resolve(bundleDir, manifest.files.operators)),
    readJsonFile<CatalogBundle["facilities"]>(path.resolve(bundleDir, manifest.files.facilities)),
    readJsonFile<CatalogBundle["recipes"]>(path.resolve(bundleDir, manifest.files.recipes)),
    readJsonFile<CatalogBundle["sources"]>(path.resolve(bundleDir, manifest.files.sources)),
    readJsonFile<CatalogBundle["gaps"]>(path.resolve(bundleDir, manifest.files.gaps)),
    readJsonFile<CatalogBundle["assets"]>(path.resolve(bundleDir, manifest.files.assets)),
  ]);

  return {
    manifest,
    progression,
    operators,
    facilities,
    recipes,
    sources,
    gaps,
    assets,
  };
}

export async function loadDefaultCatalog(): Promise<GameCatalog> {
  return toGameCatalog(await loadCatalogBundle());
}

export async function loadScenarioFile(filePath: string): Promise<OptimizationScenario> {
  return readJsonFile<OptimizationScenario>(filePath);
}

export async function saveScenarioFile(filePath: string, scenario: OptimizationScenario): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
}

export async function validateDefaultBundleAndExamples(): Promise<{
  bundle: CatalogBundle;
  bundleValidation: ReturnType<typeof validateCatalogBundle>;
  scenarioResults: Array<{
    filePath: string;
    validation: ReturnType<typeof validateScenarioAgainstCatalog>;
  }>;
}> {
  const bundle = await loadCatalogBundle();
  const catalog = toGameCatalog(bundle);
  const bundleValidation = validateCatalogBundle(bundle);

  const scenarioDir = resolveRepoPath(EXAMPLE_SCENARIOS_DIR);
  const fileNames = (await readdir(scenarioDir)).filter((name) => name.endsWith(".json"));
  const scenarioResults = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.resolve(scenarioDir, fileName);
      const scenario = await loadScenarioFile(filePath);
      return {
        filePath,
        validation: validateScenarioAgainstCatalog(catalog, scenario),
      };
    }),
  );

  return {
    bundle,
    bundleValidation,
    scenarioResults,
  };
}

export async function syncCatalogsToDirectory(targetDirectory: string): Promise<void> {
  await mkdir(targetDirectory, { recursive: true });
  await cp(resolveRepoPath("catalogs"), path.resolve(targetDirectory, "catalogs"), {
    force: true,
    recursive: true,
  });
}

export { CURRENT_CATALOG_VERSION };
