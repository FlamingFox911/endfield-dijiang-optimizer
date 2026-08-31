import { describe, expect, it } from "vitest";

import {
  decideCatalogSync,
  readReleasedSkportOperatorIds,
} from "../scripts/catalog-sync-schedule.mjs";

const policy = {
  schemaVersion: 1,
  dailySchedule: "17 0 * * *",
  burstSchedules: ["17 0 * * *", "17 6,12,18 * * *"],
  stableWeekdayUtc: 0,
  releaseLeadHours: 24,
  releaseBurstHours: 48,
  operatorReleases: [
    {
      operatorId: "arcane",
      releaseAt: "2026-07-17T04:00:00.000Z",
      sourceUrl: "https://example.com/arcane",
    },
    {
      operatorId: "liino",
      releaseAt: "2026-08-09T04:00:00.000Z",
      sourceUrl: "https://example.com/liino",
    },
  ],
};

function published(operatorIds: string[], warnings: string[] = []) {
  return {
    operators: operatorIds.map((id) => ({ id })),
    warnings,
  };
}

describe("release-aware catalog sync schedule", () => {
  it("checks only the weekly slot after released coverage is complete", () => {
    const sunday = decideCatalogSync(
      policy,
      published(["arcane", "liino"]),
      new Date("2026-08-16T00:30:00.000Z"),
      policy.dailySchedule,
    );
    const extraSlot = decideCatalogSync(
      policy,
      published(["arcane", "liino"]),
      new Date("2026-08-16T06:30:00.000Z"),
      policy.burstSchedules[1],
    );
    const monday = decideCatalogSync(
      policy,
      published(["arcane", "liino"]),
      new Date("2026-08-17T00:30:00.000Z"),
      policy.dailySchedule,
    );

    expect(sunday).toMatchObject({ cadence: "weekly", shouldCheck: true, missingOperatorIds: [] });
    expect(extraSlot).toMatchObject({ cadence: "weekly", shouldCheck: false });
    expect(monday).toMatchObject({ cadence: "weekly", shouldCheck: false });
  });

  it("uses every heartbeat around an announced release", () => {
    const decision = decideCatalogSync(
      policy,
      published(["arcane"]),
      new Date("2026-08-08T12:30:00.000Z"),
      policy.burstSchedules[1],
    );

    expect(decision).toMatchObject({
      cadence: "burst",
      shouldCheck: true,
      activeOperatorId: "liino",
      nextOperatorId: "liino",
    });
  });

  it("checks daily when released information remains incomplete", () => {
    const daily = decideCatalogSync(
      policy,
      published(["arcane"]),
      new Date("2026-08-12T00:30:00.000Z"),
      policy.dailySchedule,
    );
    const extraSlot = decideCatalogSync(
      policy,
      published(["arcane"]),
      new Date("2026-08-12T12:30:00.000Z"),
      policy.burstSchedules[1],
    );

    expect(daily).toMatchObject({ cadence: "daily", shouldCheck: true, missingOperatorIds: ["liino"] });
    expect(extraSlot).toMatchObject({ cadence: "daily", shouldCheck: false, missingOperatorIds: ["liino"] });
  });

  it("uses daily recovery cadence when the published update is unavailable or unhealthy", () => {
    const unavailable = decideCatalogSync(
      policy,
      undefined,
      new Date("2026-08-20T00:30:00.000Z"),
      policy.dailySchedule,
    );
    const warned = decideCatalogSync(
      policy,
      published(["arcane", "liino"], ["source warning"]),
      new Date("2026-08-20T00:30:00.000Z"),
      policy.dailySchedule,
    );

    expect(unavailable).toMatchObject({ cadence: "daily", shouldCheck: true });
    expect(warned).toMatchObject({ cadence: "daily", shouldCheck: true });
  });

  it("uses daily cadence when SKPORT publishes an operator absent from the deployed roster", () => {
    const daily = decideCatalogSync(
      policy,
      published(["arcane", "liino"]),
      new Date("2026-08-20T00:30:00.000Z"),
      policy.dailySchedule,
      ["arcane", "liino", "typhoeus"],
    );
    const extraSlot = decideCatalogSync(
      policy,
      published(["arcane", "liino"]),
      new Date("2026-08-20T12:30:00.000Z"),
      policy.burstSchedules[1],
      ["arcane", "liino", "typhoeus"],
    );

    expect(daily).toMatchObject({
      cadence: "daily",
      shouldCheck: true,
      upstreamMissingOperatorIds: ["typhoeus"],
    });
    expect(extraSlot).toMatchObject({ cadence: "daily", shouldCheck: false });
  });

  it("does not treat SKPORT preview cards as released operators", () => {
    const operatorIds = readReleasedSkportOperatorIds({
      catalog: [{
        id: "1",
        typeSub: [{
          id: "1",
          items: [
            { name: "Typhoeus", brief: { dotType: "label_type_preview" } },
            { name: "Mi Fu", brief: {} },
            { name: "Endministrator (Male)", brief: {} },
          ],
        }],
      }],
    });

    expect(operatorIds).toEqual(["mifu"]);
  });
});
