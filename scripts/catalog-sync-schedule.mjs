import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_POLICY_PATH = path.resolve("catalogs", "live-sync-policy.json");

function hours(value) {
  return value * 60 * 60 * 1_000;
}

function readArgument(argv, name, fallback) {
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

function validatePolicy(policy) {
  if (policy?.schemaVersion !== 1) {
    throw new Error("Catalog sync policy must use schemaVersion 1.");
  }
  if (typeof policy.dailySchedule !== "string" || !Array.isArray(policy.burstSchedules)) {
    throw new Error("Catalog sync policy schedules are invalid.");
  }
  if (!Number.isInteger(policy.stableWeekdayUtc) || policy.stableWeekdayUtc < 0 || policy.stableWeekdayUtc > 6) {
    throw new Error("Catalog sync policy stableWeekdayUtc must be between 0 and 6.");
  }
  if (!Number.isFinite(policy.releaseLeadHours) || !Number.isFinite(policy.releaseBurstHours)) {
    throw new Error("Catalog sync policy release windows are invalid.");
  }
  if (!Array.isArray(policy.operatorReleases)) {
    throw new Error("Catalog sync policy operatorReleases must be an array.");
  }
  for (const release of policy.operatorReleases) {
    if (!release?.operatorId || !Number.isFinite(Date.parse(release.releaseAt))) {
      throw new Error("Every catalog sync operator release needs an operatorId and valid releaseAt timestamp.");
    }
  }
  return policy;
}

export function decideCatalogSync(policyInput, publishedUpdate, nowInput, scheduleExpression) {
  const policy = validatePolicy(policyInput);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Catalog sync decision requires a valid current timestamp.");
  }

  const publishedOperatorIds = new Set(
    Array.isArray(publishedUpdate?.operators)
      ? publishedUpdate.operators.map((operator) => operator?.id).filter(Boolean)
      : [],
  );
  const released = policy.operatorReleases.filter((release) => Date.parse(release.releaseAt) <= now.getTime());
  const missingOperatorIds = released
    .map((release) => release.operatorId)
    .filter((operatorId) => !publishedOperatorIds.has(operatorId));
  const hasPublishedWarnings = !publishedUpdate || !Array.isArray(publishedUpdate.warnings)
    || publishedUpdate.warnings.length > 0;
  const activeRelease = policy.operatorReleases.find((release) => {
    const releaseTime = Date.parse(release.releaseAt);
    return now.getTime() >= releaseTime - hours(policy.releaseLeadHours)
      && now.getTime() <= releaseTime + hours(policy.releaseBurstHours);
  });

  let cadence;
  if (activeRelease) {
    cadence = "burst";
  } else if (missingOperatorIds.length > 0 || hasPublishedWarnings) {
    cadence = "daily";
  } else {
    cadence = "weekly";
  }

  const isDailySlot = scheduleExpression === policy.dailySchedule;
  const shouldCheck = cadence === "burst"
    ? policy.burstSchedules.includes(scheduleExpression)
    : cadence === "daily"
      ? isDailySlot
      : isDailySlot && now.getUTCDay() === policy.stableWeekdayUtc;
  const nextRelease = policy.operatorReleases
    .filter((release) => Date.parse(release.releaseAt) > now.getTime())
    .sort((left, right) => Date.parse(left.releaseAt) - Date.parse(right.releaseAt))[0];

  return {
    cadence,
    shouldCheck,
    missingOperatorIds,
    activeOperatorId: activeRelease?.operatorId,
    nextOperatorId: nextRelease?.operatorId,
    nextReleaseAt: nextRelease?.releaseAt,
  };
}

async function fetchPublishedUpdate(url) {
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}checked=${Date.now()}`, {
      headers: { "User-Agent": "endfield-dijiang-optimizer-catalog-scheduler/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.warn(`Could not read the published catalog; using daily recovery cadence. ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const policyPath = path.resolve(readArgument(argv, "--policy", DEFAULT_POLICY_PATH));
  const publishedUrl = readArgument(argv, "--published-url");
  const scheduleExpression = readArgument(argv, "--schedule");
  const githubOutput = readArgument(argv, "--github-output", process.env.GITHUB_OUTPUT);
  const now = new Date(readArgument(argv, "--now", new Date().toISOString()));
  if (!publishedUrl) {
    throw new Error("--published-url is required.");
  }
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  const decision = decideCatalogSync(policy, await fetchPublishedUpdate(publishedUrl), now, scheduleExpression);
  const summary = [
    `cadence=${decision.cadence}`,
    `check=${decision.shouldCheck}`,
    decision.activeOperatorId ? `active=${decision.activeOperatorId}` : undefined,
    decision.missingOperatorIds.length > 0 ? `missing=${decision.missingOperatorIds.join(",")}` : undefined,
    decision.nextOperatorId ? `next=${decision.nextOperatorId}@${decision.nextReleaseAt}` : undefined,
  ].filter(Boolean).join(" ");
  console.log(`catalog sync schedule: ${summary}`);
  if (githubOutput) {
    await fs.appendFile(githubOutput, `should_check=${decision.shouldCheck}\ncadence=${decision.cadence}\n`, "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
