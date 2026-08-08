import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseLiveRosterUpdate } from "@endfield/data";
import type { LiveRosterUpdateDocument } from "@endfield/domain";

interface LiveRosterDeploymentDecision {
  shouldDeploy: boolean;
  reason: string;
}

export function evaluateLiveRosterDeployment(
  candidateInput: unknown,
  publishedInput: unknown,
): LiveRosterDeploymentDecision {
  const candidate = parseLiveRosterUpdate(candidateInput);
  const published = parseLiveRosterUpdate(publishedInput);
  if (candidate.warnings.length > 0) {
    throw new Error(`Candidate catalog has ${candidate.warnings.length} warning(s): ${candidate.warnings.join(" | ")}`);
  }
  if (candidate.operators.length < published.operators.length) {
    throw new Error(
      `Candidate catalog would reduce live operators from ${published.operators.length} to ${candidate.operators.length}.`,
    );
  }
  if (candidate.recipes.length < published.recipes.length) {
    throw new Error(
      `Candidate catalog would reduce live resource nodes from ${published.recipes.length} to ${candidate.recipes.length}.`,
    );
  }
  if (candidate.contentHash === published.contentHash) {
    if (published.warnings.length > 0) {
      return { shouldDeploy: true, reason: "published catalog health recovered" };
    }
    return { shouldDeploy: false, reason: "semantic catalog content is unchanged" };
  }
  return { shouldDeploy: true, reason: "validated semantic catalog content changed" };
}

function readArgument(argv: string[], name: string, fallback?: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}checked=${Date.now()}`, {
    headers: { "User-Agent": "endfield-dijiang-optimizer-catalog-deployment/0.1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Could not read published catalog: ${response.status} ${response.statusText}`);
  }
  return await response.json() as unknown;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const candidatePath = readArgument(argv, "--candidate");
  const publishedUrl = readArgument(argv, "--published-url");
  const githubOutput = readArgument(argv, "--github-output", process.env.GITHUB_OUTPUT);
  if (!candidatePath || !publishedUrl) {
    throw new Error("--candidate and --published-url are required.");
  }
  const candidate = JSON.parse(await fs.readFile(path.resolve(candidatePath), "utf8")) as LiveRosterUpdateDocument;
  const decision = evaluateLiveRosterDeployment(candidate, await fetchJson(publishedUrl));
  console.log(`catalog deployment decision: deploy=${decision.shouldDeploy} (${decision.reason})`);
  if (githubOutput) {
    await fs.appendFile(
      githubOutput,
      `should_deploy=${decision.shouldDeploy}\nreason=${decision.reason}\n`,
      "utf8",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
