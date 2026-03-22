import { getCatalogBundleStatus, validateCatalogBundle } from "../packages/data/src/index.ts";
import { loadCatalogBundle } from "../packages/data/src/node.ts";

const releaseMode = process.argv.includes("--release");
const bundle = await loadCatalogBundle();
const validation = validateCatalogBundle(bundle);
if (!validation.ok) {
  for (const issue of validation.issues) {
    console.error(`[${issue.severity}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

const status = getCatalogBundleStatus(bundle);
const summary = status.summary;

for (const [key, value] of Object.entries(summary)) {
  console.log(`${key}: ${value}`);
}

if (status.countMismatches.length > 0) {
  for (const blocker of status.releaseBlockers) {
    console.error(blocker);
  }
  process.exit(1);
}

if (status.releaseBlockers.length > 0) {
  const printer = releaseMode ? console.error : console.warn;
  for (const blocker of status.releaseBlockers) {
    printer(blocker);
  }

  if (releaseMode) {
    process.exit(1);
  }
}
