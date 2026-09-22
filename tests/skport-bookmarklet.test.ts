import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import { SKPORT_CAPTURE_BOOKMARKLET } from "../apps/web/src/skport-capture-bookmarklet.js";

describe("SKPort roster capture bookmarklet", () => {
  it.each([true, false])("captures calculator data only for the same account (match=%s)", async (sameAccount) => {
    const dom = new JSDOM('<script src="https://assets.skport.com/vendor_src_libs-test.js"></script>', { url: "https://game.skport.com/tools/endfield/cost-calculator", runScripts: "outside-only" });
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: copy } });
    const request = vi.fn(async (path: string) => {
      if (path.endsWith("team/user-game-data")) return { data: { userGameData: { roleId: "role", serverId: "server", userChars: { a: { charId: "a", owned: true, level: "20" } }, userEquips: { gear: { equipId: "gear", ownedCount: 2 } } } } };
      if (path.endsWith("calculate/user-game-data")) return { data: { userGameData: { roleId: sameAccount ? "role" : "other-role", serverId: "server", userChars: { a: { charId: "a", owned: true, level: "40", talent: { latestSpaceshipSkillNodes: ["spaceship_skill_chr_0006_wolfgd_1_1"] } } }, itemCount: { credits: 100 } } } };
      if (path.endsWith("search-chars")) return { data: { chars: [{ id: "a", name: "Wulfgard", cultivationTalents: [{ id: "spaceship_skill_chr_0006_wolfgd_1_1" }] }] } };
      if (path.endsWith("calculate/material-list")) return { data: { materials: { credits: { id: "credits", name: "T-Creds" } } } };
      if (path.endsWith("team/user-char-data")) return { data: { userChar: { charId: "a", level: "20", charData: { id: "a", name: "Wulfgard" } } } };
      return { data: {} };
    });
    (dom.window as unknown as Record<string, unknown>).__officialModule = { r: request };
    try {
      dom.window.eval(SKPORT_CAPTURE_BOOKMARKLET.slice("javascript:".length).replace("await import(moduleUrl)", "window.__officialModule"));
      await vi.waitFor(() => expect(dom.window.document.querySelector<HTMLButtonElement>("[data-capture-copy]")?.hidden).toBe(false));
      dom.window.document.querySelector<HTMLButtonElement>("[data-capture-copy]")!.click();
      await vi.waitFor(() => expect(copy).toHaveBeenCalled());
      const text = copy.mock.calls[0]![0] as string;
      const capture = JSON.parse(text);
      expect(capture.response.data.userGameData.itemCount).toEqual(sameAccount ? { credits: 100 } : undefined);
      expect(capture.response.data.userGameData.userEquips.gear.ownedCount).toBe(2);
      expect(capture.characterCatalog.data.chars[0].cultivationTalents[0].id).toBe("spaceship_skill_chr_0006_wolfgd_1_1");
      expect(capture.materialCatalog.data.materials.credits.name).toBe("T-Creds");
      expect(text).not.toMatch(/roleId|serverId|other-role/);
    } finally { dom.window.close(); }
  });

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
