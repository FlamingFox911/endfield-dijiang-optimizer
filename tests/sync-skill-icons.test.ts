import { describe, expect, it } from "vitest";

import {
  chooseResolvedSkillIconAssetId,
  extractBaseSkillTablesFromHtml,
  normalizeSkillName,
  reconcileScrapedBaseSkills,
} from "../scripts/sync-skill-icons";

describe("sync skill icons helpers", () => {
  it("extracts Base Skill table headers from operator page HTML", () => {
    const html = `
      <html>
        <body>
          <h2><span id="Base_Skills">Base Skills</span></h2>
          <table class="mrfz-wtable">
            <tr>
              <th colspan="2">
                <img src="/images/thumb/CN-power.png/25px-CN-power.png?abc" alt="CN-power.png" />
                <span style="font-size:14px;"> Youthful Ambition</span>
                <span style="float:right;">
                  <a href="/wiki/Control_Nexus" title="Control Nexus">
                    <img src="/images/thumb/Control_Nexus_icon.png/25px-Control_Nexus_icon.png" alt="Control Nexus icon.png" />
                  </a>
                </span>
              </th>
            </tr>
          </table>
          <table class="mrfz-wtable">
            <tr>
              <th colspan="2">
                <img src="/images/thumb/RR-guestroom_clue.png/25px-RR-guestroom_clue.png?def" alt="RR-guestroom clue.png" />
                <span style="font-size:14px;"> Laddie Reliable</span>
                <span style="float:right;">
                  <a href="/wiki/Reception_Room" title="Reception Room">
                    <img src="/images/thumb/Reception_Room_icon.png/25px-Reception_Room_icon.png" alt="Reception Room icon.png" />
                  </a>
                </span>
              </th>
            </tr>
          </table>
          <div><h3><span id="Base_Skill_upgrades">Base Skill upgrades</span></h3></div>
        </body>
      </html>
    `;

    const extracted = extractBaseSkillTablesFromHtml(html, "https://endfield.wiki.gg/wiki/Lifeng");

    expect(extracted).toEqual([
      {
        name: "Youthful Ambition",
        skillIconUrl: "https://endfield.wiki.gg/images/thumb/CN-power.png/25px-CN-power.png?abc",
        facilityIconUrl: "https://endfield.wiki.gg/images/thumb/Control_Nexus_icon.png/25px-Control_Nexus_icon.png",
        facilityLabel: "Control Nexus",
        facilityKind: "control_nexus",
      },
      {
        name: "Laddie Reliable",
        skillIconUrl: "https://endfield.wiki.gg/images/thumb/RR-guestroom_clue.png/25px-RR-guestroom_clue.png?def",
        facilityIconUrl: "https://endfield.wiki.gg/images/thumb/Reception_Room_icon.png/25px-Reception_Room_icon.png",
        facilityLabel: "Reception Room",
        facilityKind: "reception_room",
      },
    ]);
  });

  it("matches scraped tables to catalog skills by normalized name before using order", () => {
    const mapped = reconcileScrapedBaseSkills(
      {
        id: "lifeng",
        baseSkills: [
          { id: "youthful-ambition", name: "Youthful Ambition" },
          { id: "laddie-reliable", name: "Laddie Reliable" },
        ],
      },
      [
        { name: "Laddie Reliable" },
        { name: "Youthful Ambition" },
      ],
    );

    expect(mapped.get("youthful-ambition")?.name).toBe("Youthful Ambition");
    expect(mapped.get("laddie-reliable")?.name).toBe("Laddie Reliable");
  });

  it("falls back to skill order when scraped names do not reconcile cleanly", () => {
    const mapped = reconcileScrapedBaseSkills(
      {
        id: "test-operator",
        baseSkills: [
          { id: "skill-1", name: "First Skill" },
          { id: "skill-2", name: "Second Skill" },
        ],
      },
      [
        { name: "Header A" },
        { name: "Header B" },
      ],
    );

    expect(mapped.get("skill-1")?.name).toBe("Header A");
    expect(mapped.get("skill-2")?.name).toBe("Header B");
  });

  it("uses skill, then facility, then placeholder icon ids in fallback order", () => {
    expect(normalizeSkillName("Mr. Dolly's Game")).toBe("mrdollysgame");
    expect(chooseResolvedSkillIconAssetId("skill-ardelia-mr-dollys-game-icon", "facility-reception_room-icon")).toBe(
      "skill-ardelia-mr-dollys-game-icon",
    );
    expect(chooseResolvedSkillIconAssetId(undefined, "facility-reception_room-icon")).toBe("facility-reception_room-icon");
    expect(chooseResolvedSkillIconAssetId(undefined, undefined)).toBe("placeholder-facility-icon");
  });
});
