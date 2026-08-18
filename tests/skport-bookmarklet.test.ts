import { describe, expect, it } from "vitest";

import { SKPORT_CAPTURE_BOOKMARKLET } from "../apps/web/src/skport-capture-bookmarklet.js";

describe("SKPort roster capture bookmarklet", () => {
  it("captures the official Team Picks roster response without embedding credentials", () => {
    expect(SKPORT_CAPTURE_BOOKMARKLET).toMatch(/^javascript:/);
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("/game/endfield/team/user-game-data");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("/game/endfield/team/user-char-data");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("/game/endfield/card/detail");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("/game/endfield/search-chars");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("vendor_src_libs-");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("Promise.allSettled");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("navigator.clipboard.writeText");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("endfield-dijiang-skport-roster-v3");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("endfield-skport-roster-");
    expect(SKPORT_CAPTURE_BOOKMARKLET).toContain("skport\\.com");
    expect(() => new Function(SKPORT_CAPTURE_BOOKMARKLET.slice("javascript:".length))).not.toThrow();
    expect(SKPORT_CAPTURE_BOOKMARKLET).not.toMatch(/setRequestHeader|document\.cookie|localStorage|sessionStorage/);
    expect(SKPORT_CAPTURE_BOOKMARKLET).not.toMatch(/\bcred\b|\bsign\b|authorization/i);
  });
});
