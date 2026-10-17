// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchOfficialGameVersion,
  parseOfficialGameVersionAnnouncement,
  resolveCurrentGameVersion,
} from "../scripts/official-game-version.mjs";

const now = new Date("2026-10-17T00:00:00.000Z");
const current = {
  gameVersion: "Sanctuary of Ink",
  gameVersionReleasedAt: "2026-10-15T04:00:00.000Z",
  gameVersionSourceUrl: "https://endfield.gryphline.com/en-us/news/9560",
};
const previousVersion = {
  gameVersion: "Dreamscape of Wind and Snow",
  gameVersionReleasedAt: "2026-09-02T04:00:00.000Z",
  gameVersionSourceUrl: "https://endfield.gryphline.com/en-us/news/5208",
};
const policy = {
  operatorReleases: [{
    operatorId: "typhoeus",
    gameVersion: previousVersion.gameVersion,
    releaseAt: previousVersion.gameVersionReleasedAt,
    sourceUrl: previousVersion.gameVersionSourceUrl,
  }],
};

function announcement(overrides: Partial<{ cid: string; title: string; data: string; displayTime: number }> = {}) {
  return {
    cid: "9560",
    title: "[Sanctuary of Ink] Version Update Notes",
    displayTime: Date.parse("2026-10-15T01:00:00Z") / 1_000,
    data: "<p><strong>■ Update &amp; Maintenance Time</strong></p>"
      + "<p>Asia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:00 (UTC+8)</p>"
      + "<p>Americas / Europe Server: Oct. 14, 2026 at 17:00 – Oct. 14, 2026 at 23:00 (UTC-5)</p>",
    ...overrides,
  };
}

function mockNews(items: ReturnType<typeof announcement>[], detailOverrides = new Map<string, unknown>()) {
  return vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
    if (input.pathname === "/api/bulletin") {
      return Response.json({ code: 0, data: { list: items, total: items.length } });
    }
    const cid = input.pathname.split("/").at(-1)!;
    return Response.json({ code: 0, data: detailOverrides.get(cid) ?? items.find((item) => item.cid === cid) });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("official game version announcements", () => {
  it("reads the version, UTC maintenance end, and source URL from official update notes", () => {
    expect(parseOfficialGameVersionAnnouncement(announcement(), now)).toEqual(current);
  });

  it.each([
    "[Future Version] Version Pre-Download & Update Notice",
    "[Future Version] Version Preview Program",
    "Arknights: Endfield [Future Version] Version DEV Comm",
    "[Future Version] New Version Guide Page Release Details",
    "[Future Version] Version Update Notes Preview",
    "[Other Event] Event Update Notes",
  ])("ignores announcement titles that do not confirm a version update: %s", (title) => {
    expect(parseOfficialGameVersionAnnouncement(announcement({ title }), now)).toBeUndefined();
  });

  it("waits for maintenance to end even when the update notes have already been published", () => {
    expect(parseOfficialGameVersionAnnouncement(announcement(), new Date("2026-10-15T01:01:00Z"))).toBeUndefined();
    expect(parseOfficialGameVersionAnnouncement(announcement(), new Date(current.gameVersionReleasedAt))).toEqual(current);
  });

  it("normalizes inline formatting, named/numeric entities, and nonbreaking whitespace", () => {
    expect(parseOfficialGameVersionAnnouncement(announcement({
      title: "[Sanctuary of Ink]   Version Update Notes",
      data: "<p>Version Maintenance Time</p><p>Asia&nbsp;Server: <b>Oct.</b> 15, 2026 at 06:00"
        + " &ndash; Oct. 15, 2026 at 12:00 (UTC&#43;8)</p>",
    }), now)).toEqual(current);
  });

  it("handles month boundaries, full month names, and fractional UTC offsets explicitly", () => {
    expect(parseOfficialGameVersionAnnouncement(announcement({
      data: "<p>Update &amp; Maintenance Time</p>"
        + "<p>Asia Server: September 30, 2026 at 22:00 - October 1, 2026 at 04:00 (UTC+5:30)</p>",
    }), now)?.gameVersionReleasedAt).toBe("2026-09-30T22:30:00.000Z");
  });

  it.each([
    "<p>No maintenance window has been documented yet.</p>",
    "Update & Maintenance Time\nAsia Server: Oct. 32, 2026 at 06:00 – Oct. 32, 2026 at 12:00 (UTC+8)",
    "Update & Maintenance Time\nAsia Server: Octoberish 15, 2026 at 06:00 – Octoberish 15, 2026 at 12:00 (UTC+8)",
    "Update & Maintenance Time\nAsia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 25:00 (UTC+8)",
    "Update & Maintenance Time\nAsia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:60 (UTC+8)",
    "Update & Maintenance Time\nAsia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:00 (UTC+15)",
    "Update & Maintenance Time\nAsia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:00 (UTC+8:60)",
    "Update & Maintenance Time\nAsia Server: Oct. 15, 2026 at 12:00 – Oct. 15, 2026 at 06:00 (UTC+8)",
    "<p>Unrelated event: Asia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:00 (UTC+8)</p>",
  ])("rejects ambiguous or invalid maintenance content", (data) => {
    expect(() => parseOfficialGameVersionAnnouncement(announcement({ data }), now)).toThrow();
  });
});

describe("official public news retrieval", () => {
  it("uses the official public CMS and does not request previews or pre-download details", async () => {
    mockNews([
      announcement(),
      announcement({ cid: "0744", title: "[Future Version] Version Pre-Download & Update Notice" }),
    ]);
    expect(await fetchOfficialGameVersion(now)).toEqual(current);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((url) => url.pathname)).toEqual(["/api/bulletin", "/api/bulletin/9560"]);
    expect(urls[0]!.origin).toBe("https://web-news.gryphline.com");
    expect(urls[0]!.searchParams.get("lang")).toBe("en-us");
    expect(urls[0]!.searchParams.get("code")).toBe("arknights_endfield_official");
    expect(urls[0]!.searchParams.get("tabs[]")).toBe("notices");
  });

  it("chooses release time instead of sticky order or the article's last display date", async () => {
    mockNews([
      announcement({
        cid: "5208", title: "[Dreamscape of Wind and Snow] Version Update Notes",
        displayTime: Date.parse("2026-10-16T04:00:00Z") / 1_000,
        data: "Update & Maintenance Time\nAsia Server: Sept. 2, 2026 at 06:00 – Sept. 2, 2026 at 12:00 (UTC+8)",
      }),
      announcement(),
    ]);
    expect(await fetchOfficialGameVersion(now)).toEqual(current);
  });

  it("ignores future-dated notes and skips unreleased maintenance windows", async () => {
    mockNews([
      announcement({ cid: "9999", displayTime: Date.parse("2026-12-01T00:00:00Z") / 1_000 }),
      announcement({
        cid: "9998", title: "[Future Version] Version Update Notes",
        data: "Update & Maintenance Time\nAsia Server: Dec. 1, 2026 at 06:00 – Dec. 1, 2026 at 12:00 (UTC+8)",
      }),
      announcement(),
    ]);
    expect(await fetchOfficialGameVersion(now)).toEqual(current);
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/9999?"))).toBe(false);
  });

  it("searches beyond the first notices page when necessary", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      if (input.pathname !== "/api/bulletin") return Response.json({ code: 0, data: announcement() });
      const list = input.searchParams.get("page") === "1"
        ? Array.from({ length: 30 }, () => ({ title: "Other event" })) : [announcement()];
      return Response.json({ code: 0, data: { list, total: 31 } });
    }));
    expect(await fetchOfficialGameVersion(now)).toEqual(current);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("bounds the amount of history inspected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      code: 0, data: { list: Array.from({ length: 30 }, () => ({ title: "Other event" })), total: 1_000 },
    })));
    expect(await fetchOfficialGameVersion(now)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    () => { throw new Error("Network unavailable"); },
    () => new Response("Unavailable", { status: 503 }),
    () => new Response("Not JSON"),
    () => Response.json({ code: 1, data: {} }),
    () => Response.json({ code: 0, data: {} }),
  ])("treats source failures as metadata-only failures", async (respond) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => respond()));
    expect(await fetchOfficialGameVersion(now)).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("retaining the last confirmed version"));
  });

  it.each([
    { ...announcement(), cid: "9999" },
    { ...announcement(), title: "[Different Version] Version Update Notes" },
    { ...announcement(), data: "Incomplete maintenance details" },
  ])("rejects mismatched or incomplete detail records instead of guessing", async (detail) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockNews([announcement()], new Map([["9560", detail]]));
    expect(await fetchOfficialGameVersion(now)).toBeUndefined();
  });
});

describe("game version selection and outage recovery", () => {
  it("replaces a stale release policy and legacy overlay with the current official version", () => {
    expect(resolveCurrentGameVersion(current, { gameVersion: previousVersion.gameVersion }, policy, now)).toEqual(current);
  });

  it("preserves the confirmed version and provenance during an outage", () => {
    expect(resolveCurrentGameVersion(undefined, current, policy, now)).toEqual(current);
  });

  it("does not roll back a newer confirmed version when the official feed is stale", () => {
    expect(resolveCurrentGameVersion(previousVersion, current, policy, now)).toEqual(current);
  });

  it("preserves legacy overlay versions instead of replacing them with stale policy data", () => {
    expect(resolveCurrentGameVersion(undefined, { gameVersion: current.gameVersion }, policy, now))
      .toEqual({ gameVersion: current.gameVersion });
  });

  it("uses manual policy labels only for bootstrap, never to advance a saved version during an outage", () => {
    const changedPolicy = { operatorReleases: [{ gameVersion: "Unverified Version", releaseAt: "2026-10-16T00:00:00Z" }] };
    expect(resolveCurrentGameVersion(undefined, current, changedPolicy, now)).toEqual(current);
    expect(resolveCurrentGameVersion(current, undefined, changedPolicy, now)).toEqual(current);
  });

  it("uses effective policy data for an initial offline build only when there is no saved version", () => {
    expect(resolveCurrentGameVersion(undefined, undefined, policy, now)).toEqual(previousVersion);
    expect(resolveCurrentGameVersion(undefined, undefined, policy, new Date("2026-09-01T00:00:00Z"))).toBeUndefined();
  });

  it("rejects future official versions and keeps a confirmed version", () => {
    expect(resolveCurrentGameVersion({ ...current, gameVersionReleasedAt: "2026-12-01T00:00:00Z" }, previousVersion, policy, now))
      .toEqual(previousVersion);
  });

  it("does not erase provenance when the official source and saved version have the same effective date", () => {
    expect(resolveCurrentGameVersion(current, current, policy, now)).toEqual(current);
  });
});
