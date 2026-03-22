import { validateDefaultBundleAndExamples } from "../packages/data/src/node.ts";

const result = await validateDefaultBundleAndExamples();
const failures: string[] = [];

if (result.bundleValidation.ok) {
  console.log(`catalog: ok (${result.bundle.manifest.catalogVersion})`);
} else {
  failures.push(...result.bundleValidation.issues.map((issue) => `catalog: ${issue.message}`));
}

for (const scenario of result.scenarioResults) {
  const name = scenario.filePath.split(/[/\\]/).at(-1);
  if (scenario.validation.ok) {
    console.log(`scenario: ok (${name})`);
  } else {
    failures.push(...scenario.validation.issues.map((issue) => `${name}: ${issue.message}`));
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exitCode = 1;
}
