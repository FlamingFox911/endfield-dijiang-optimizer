# Research Snapshot

Snapshot date: March 20, 2026.

This document records the source-backed facts that shaped the application architecture, plus the gaps that still need manual validation or in-game verification.

## Confirmed facts

- Arknights: Endfield officially launched on January 22, 2026 across all platforms, according to the official pre-download notice. Source: [official release notice](https://endfield.gryphline.com/news/9574).
- The official site published a security warning on March 12, 2026 against using unofficial tools that ask players to authorize account login. That is the reason this app is designed to use the internet only for public catalog data and to keep all player state manual instead of account scraping. Source: [official security warning](https://endfield.gryphline.com/en-us/news/7026).
- Version 1.1 Phase 1 went live on March 12, 2026 and Phase 2 is scheduled for March 29, 2026. Tangtang is in Phase 1 and Rossi is in Phase 2. The catalog therefore needs explicit game-data versioning. Source: [Game8 version 1.1 schedule](https://game8.co/games/Arknights-Endfield/archives/582142).
- Game8's Control Nexus guide says the Control Nexus has levels 1 through 5, and that upgrades unlock or raise cabin caps. It specifically lists Growth Chamber unlock at level 2, a second unconstructed cabin at level 3, and later room-level-cap increases. Source: [Game8 Control Nexus guide](https://game8.co/games/Arknights-Endfield/archives/575985).
- Game8's Manufacturing Cabin guide confirms the Manufacturing Cabin produces operator EXP and weapon EXP materials, and that a second Manufacturing Cabin becomes available at Control Nexus level 3. Source: [Game8 Manufacturing Cabin guide](https://game8.co/games/Arknights-Endfield/archives/577556).
- Game8's Growth Chamber guide confirms that the chamber grows rare materials from seeds and cores, and that the chamber reaches 9 growth slots at max level. It also confirms the three production families used there: fungal matter, vitrified plants, and rare minerals. Source: [Game8 Growth Chamber guide](https://game8.co/games/Arknights-Endfield/archives/577534).
- GameWith's Dijiang overview aligns with the broad facility roles: Control Nexus manages assignments and trust gain, Manufacturing Cabin produces character and weapon materials, and Growth Chamber grows promotion, skill, and tuning materials. Source: [GameWith Dijiang overview](https://gamewith.net/akendfield/72893).
- Game8 operator pages expose base-skill effects in text, including alpha and beta ranks. Examples:
  - Chen Qianyu: `Blade Critique` and `Jadeworking`. Source: [Chen Qianyu](https://game8.co/games/Arknights-Endfield/archives/523674).
  - Xaihi: `Standardized Scripting`. Source: [Xaihi](https://game8.co/games/Arknights-Endfield/archives/523669).
  - Snowshine: `Rescuer's Perseverance` and `Happy-Go-Lucky`. Source: [Snowshine](https://game8.co/games/Arknights-Endfield/archives/523666).
  - Catcher: `Silent Caretaker` and `Grounded Approach`. Source: [Catcher](https://game8.co/games/Arknights-Endfield/archives/562317).
- Those operator pages also expose material costs for base-skill rank upgrades in text. This means the upgrade-advice feature can be based on cataloged unlock costs even before every unlock prerequisite is fully scraped. Example source: [Chen Qianyu talent materials section](https://game8.co/games/Arknights-Endfield/archives/523674).
- The Endfield Talos Wiki exposes cleaner structured data for several pieces of seed-catalog data:
  - exact Base Skill unlock tiers and upgrade costs for Chen Qianyu, Xaihi, and Snowshine
  - exact Manufacturing Cabin load and production times for `Advanced Cognitive Carrier` and `Arms INSP Set`
  - exact Growth Chamber production times for early fungal, plant, and mineral recipes such as `Pink Bolete`, `Kalkodendra`, and `Kalkonyx`
  Sources: [OMV Dijiang Facility](https://endfield.wiki.gg/wiki/OMV_Dijiang/Facility), [Chen Qianyu](https://endfield.wiki.gg/wiki/Chen_Qianyu), [Xaihi](https://endfield.wiki.gg/wiki/Xaihi), [Snowshine](https://endfield.wiki.gg/wiki/Snowshine).

## Ambiguities and gaps

- Public guides disagree on exactly when Dijiang or related quests become available. One guide frames the requirement around Authority Level 15, while another says the `Maintenance Progress` mission unlocks at Authority Level 18 after `Work Preparation`. The app should keep unlock rules in data, not in code. Sources: [Game8 Control Nexus guide](https://game8.co/games/Arknights-Endfield/archives/575985), [Game8 Maintenance Progress guide](https://game8.co/games/Arknights-Endfield/archives/575874).
- The meaning of `Assignment Limit (2 > 3)` and `Assignment Limit (3 > 4)` is not fully clear from public text. Some best-setup tables still show three slots in rooms even when the Control Nexus guide mentions an increase to four. Slot counts must therefore be cataloged with manual overrides and scenario validation. Sources: [Game8 Control Nexus guide](https://game8.co/games/Arknights-Endfield/archives/575985), [Game8 best Dijiang setup](https://game8.co/games/Arknights-Endfield/archives/583161).
- Many recipe production times and MFG Load values are still missing for the full live catalog even though a verified seed subset is now available from the structured wiki source.
- Exact unlock prerequisites are now verified for a small seed subset, but the broader roster still needs structured extraction and verification.
- Public guides are guide sites with their own editorial layer. That is acceptable for initial catalog construction, but every imported record should retain source provenance and confidence so incorrect values can be patched cleanly.

## Working assumptions for the first implementation

- The optimizer should treat publicly confirmed skill effects as authoritative enough for a first-pass catalog when at least one reputable guide page provides the operator's alpha and beta values.
- Recipe timings and exact unlock gates should be taken from the structured wiki source where available, and otherwise remain explicit gaps or maintainer overrides until verified.
- The UI should accept explicit base-skill ranks from the user even if their operator level is also provided, because level alone is not a reliable proxy for unlocked nodes from public sources.
- Owned operators, operator levels, unlocked base skills, and room levels are always manual user inputs or values loaded from the user's own local scenario files.
- The tool should version its catalog by game patch or snapshot date, starting with `2026-03-20/v1.1-phase1`.
