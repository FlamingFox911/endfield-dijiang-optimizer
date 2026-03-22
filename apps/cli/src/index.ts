import path from "node:path";
import process from "node:process";

import { Command } from "commander";
import prompts from "prompts";

import {
  createStarterScenario,
  formatValidationIssues,
  hydrateScenarioForCatalog,
  migrateScenario,
  validateScenarioAgainstCatalog,
} from "@endfield/data";
import {
  loadDefaultCatalog,
  loadScenarioFile,
  resolveBundledPath,
  saveScenarioFile,
  validateDefaultBundleAndExamples,
} from "@endfield/data/node";
import {
  formatOptimizationResultText,
  formatUpgradeRecommendationsText,
  solveScenario,
  recommendUpgrades,
} from "@endfield/optimizer";

async function resolveScenarioPath(scenarioPath: string | undefined): Promise<string> {
  if (scenarioPath) {
    return path.resolve(process.cwd(), scenarioPath);
  }

  const bundledExamplePath = resolveBundledPath("scenarios", "examples", "current-base.simple.json");

  const response = await prompts({
    type: "text",
    name: "scenarioPath",
    message: "Scenario path",
    initial: bundledExamplePath,
  });

  return path.resolve(response.scenarioPath ?? bundledExamplePath);
}

async function loadPreparedScenario(scenarioPath: string) {
  const catalog = await loadDefaultCatalog();
  const originalScenario = await loadScenarioFile(scenarioPath);
  const migration = migrateScenario(originalScenario);
  const hydration = hydrateScenarioForCatalog(catalog, migration.scenario);
  const scenario = hydration.scenario;
  const validation = validateScenarioAgainstCatalog(catalog, scenario);

  return { catalog, scenario, validation, migration, hydration };
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

const program = new Command();
program
  .name("endfield-opt")
  .description("Local-first Endfield Dijiang optimizer")
  .version("0.1.0");

program
  .command("init-scenario")
  .description("Create a starter scenario pinned to the bundled catalog")
  .argument("[output]", "Output scenario path")
  .action(async (output) => {
    const catalog = await loadDefaultCatalog();
    const outputPath = output
      ? path.resolve(process.cwd(), output)
      : path.resolve(process.cwd(), "scenario.json");
    await saveScenarioFile(outputPath, createStarterScenario(catalog));
    console.log(`Created ${outputPath}`);
  });

program
  .command("optimize")
  .description("Solve a scenario file")
  .option("-s, --scenario <path>", "Scenario JSON path")
  .option("--mode <mode>", "Override planning mode")
  .option("--max-facilities", "Apply the max-facilities overlay")
  .option("--json", "Emit JSON output")
  .action(async (options) => {
    const scenarioPath = await resolveScenarioPath(options.scenario);
    const { catalog, scenario, validation, migration, hydration } = await loadPreparedScenario(scenarioPath);
    if (!migration.ok) {
      console.error(formatValidationIssues(migration.warnings));
      process.exitCode = 1;
      return;
    }
    if (!validation.ok) {
      console.error(formatValidationIssues(validation.issues));
      process.exitCode = 1;
      return;
    }

    if (options.mode) {
      scenario.options.planningMode = options.mode;
    }
    if (options.maxFacilities) {
      scenario.options.maxFacilities = true;
    }

    const result = solveScenario(catalog, scenario);
    if (options.json) {
      printJson({ migration, result });
      return;
    }

    if (migration.migrated) {
      console.log(`Migrated scenario in memory from format ${migration.fromFormatVersion} to ${migration.toFormatVersion}.`);
    }
    if (hydration.hydrated) {
      console.log(
        `Hydrated scenario in memory with ${hydration.stats.addedOperators} operator(s) and ${hydration.stats.addedBaseSkillStates} Base Skill state(s) from catalog ${catalog.version}.`,
      );
    }
    console.log(formatOptimizationResultText(result, catalog));
  });

program
  .command("recommend-upgrades")
  .description("Rank the next Base Skill unlocks that improve Dijiang output")
  .option("-s, --scenario <path>", "Scenario JSON path")
  .option("--ranking <mode>", "fastest, roi, or balanced")
  .option("--json", "Emit JSON output")
  .action(async (options) => {
    const scenarioPath = await resolveScenarioPath(options.scenario);
    const { catalog, scenario, validation, migration, hydration } = await loadPreparedScenario(scenarioPath);
    if (!migration.ok) {
      console.error(formatValidationIssues(migration.warnings));
      process.exitCode = 1;
      return;
    }
    if (!validation.ok) {
      console.error(formatValidationIssues(validation.issues));
      process.exitCode = 1;
      return;
    }

    if (options.ranking) {
      scenario.options.upgradeRankingMode = options.ranking;
    }

    const result = recommendUpgrades(catalog, scenario);
    if (options.json) {
      printJson({ migration, result });
      return;
    }

    if (migration.migrated) {
      console.log(`Migrated scenario in memory from format ${migration.fromFormatVersion} to ${migration.toFormatVersion}.`);
    }
    if (hydration.hydrated) {
      console.log(
        `Hydrated scenario in memory with ${hydration.stats.addedOperators} operator(s) and ${hydration.stats.addedBaseSkillStates} Base Skill state(s) from catalog ${catalog.version}.`,
      );
    }
    console.log(formatUpgradeRecommendationsText(result, catalog));
  });

program
  .command("validate-data")
  .description("Validate the bundled catalog and example scenarios")
  .option("--json", "Emit JSON output")
  .action(async (options) => {
    const result = await validateDefaultBundleAndExamples();
    if (options.json) {
      printJson(result);
      return;
    }

    if (result.bundleValidation.ok) {
      console.log(`catalog: ok (${result.bundle.manifest.catalogVersion})`);
    } else {
      console.log(formatValidationIssues(result.bundleValidation.issues));
      process.exitCode = 1;
    }

    for (const scenario of result.scenarioResults) {
      const name = scenario.filePath.split(/[/\\]/).at(-1);
      if (scenario.validation.ok) {
        console.log(`scenario: ok (${name})`);
      } else {
        console.log(formatValidationIssues(scenario.validation.issues));
        process.exitCode = 1;
      }
    }
  });

program
  .command("migrate-scenario")
  .description("Preview and write a migrated scenario file")
  .requiredOption("-s, --scenario <path>", "Scenario JSON path")
  .option("-o, --output <path>", "Write migrated scenario to a new file")
  .option("--json", "Emit JSON preview output")
  .action(async (options) => {
    const scenarioPath = path.resolve(process.cwd(), options.scenario);
    const original = await loadScenarioFile(scenarioPath);
    const migration = migrateScenario(original);
    if (!migration.ok) {
      console.error(formatValidationIssues(migration.warnings));
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      printJson(migration);
      return;
    }

    console.log(`from format ${migration.fromFormatVersion} -> ${migration.toFormatVersion}`);
    for (const change of migration.changes) {
      console.log(`- ${change.path}: ${change.message}`);
    }

    let outputPath = options.output as string | undefined;
    if (!outputPath) {
      const response = await prompts({
        type: "text",
        name: "outputPath",
        message: "Write migrated scenario to",
        initial: scenarioPath.replace(/\.json$/i, ".migrated.json"),
      });
      outputPath = response.outputPath;
    }

    if (!outputPath) {
      return;
    }

    const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
    if (resolvedOutputPath === scenarioPath) {
      console.error("migrate-scenario requires a new output path; it will not overwrite the original scenario.");
      process.exitCode = 1;
      return;
    }

    await saveScenarioFile(resolvedOutputPath, migration.scenario);
    console.log(`Wrote ${resolvedOutputPath}`);
  });

program.parseAsync(process.argv);
