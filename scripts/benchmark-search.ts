import { readFile } from "node:fs/promises";
import { createStarterScenario, mergeLiveRosterUpdate } from "../packages/data/src/index.js";
import { loadDefaultCatalog } from "../packages/data/src/node.js";
import { solveScenario, OptimizationCancelledError } from "../packages/optimizer/src/solver.js";
import { getOptimizationSearchConfig } from "../packages/optimizer/src/config.js";

const bundled = await loadDefaultCatalog();
const live = JSON.parse(await readFile("apps/web/public/roster/latest.json", "utf8"));
const catalog = mergeLiveRosterUpdate(bundled, live).catalog;
const scenario = createStarterScenario(catalog);
scenario.options.maxFacilities = true;
scenario.options.optimizationProfile = "exhaustive";
scenario.options.optimizationEffort = 100;
const rank = Number(process.argv.find((arg) => arg.startsWith("--rank="))?.split("=")[1] ?? 2) as 0 | 1 | 2;
for (const operator of scenario.roster) {
  operator.owned = true;
  operator.baseSkillStates = catalog.operators.find((entry) => entry.id === operator.operatorId)!.baseSkills
    .map((skill) => ({ skillId: skill.id, unlockedRank: rank }));
}
scenario.facilities.manufacturingCabins.forEach((room, index) => {
  room.fixedRecipeId = index === 0 ? "advanced-cognitive-carrier" : "arms-insp-set";
});
scenario.facilities.growthChambers[0]!.fixedRecipeIds = Array(9).fill("bloodcap");
const legacy = process.argv.includes("--legacy");
const startedAt = performance.now();
let nodes = 0;
let score = 0;
try {
  const result = solveScenario(catalog, scenario, {
    // Explicit finite override exercises the former slot search for comparison.
    searchConfig: legacy ? { ...getOptimizationSearchConfig("custom", 99), maxVisitedNodes: Number.MAX_SAFE_INTEGER,
      maxBranchCandidatesPerSlot: null, progressIntervalNodes: 1_000 } : undefined,
    shouldCancel: () => performance.now() - startedAt > 30_000,
    onProgress: (progress) => { nodes = progress.visitedNodes; score = progress.bestScore; },
  });
  console.log(JSON.stringify({ legacy, rank, owned: scenario.roster.length, elapsedMs: performance.now() - startedAt,
    score: result.totalScore, search: result.search }));
} catch (error) {
  if (!(error instanceof OptimizationCancelledError)) throw error;
  console.log(JSON.stringify({ legacy, rank, owned: scenario.roster.length, elapsedMs: performance.now() - startedAt,
    score, nodes, completed: false, reason: "Benchmark stopped after 30 seconds; production maximum remains unlimited." }));
}
