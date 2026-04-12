import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../../../catalogs/2026-03-29-v1.1-phase2/manifest.json";
import progression from "../../../catalogs/2026-03-29-v1.1-phase2/progression.json";
import operators from "../../../catalogs/2026-03-29-v1.1-phase2/operators.json";
import facilities from "../../../catalogs/2026-03-29-v1.1-phase2/facilities.json";
import recipes from "../../../catalogs/2026-03-29-v1.1-phase2/recipes.json";
import sources from "../../../catalogs/2026-03-29-v1.1-phase2/sources.json";
import gaps from "../../../catalogs/2026-03-29-v1.1-phase2/gaps.json";
import assets from "../../../catalogs/2026-03-29-v1.1-phase2/assets.json";

import { App } from "./App";
import type { OptimizerWorkerResponse } from "./optimizer-worker-types";

const { workerInstances } = vi.hoisted(() => {
  class FakeOptimizerWorker {
    onmessage: ((event: MessageEvent<OptimizerWorkerResponse>) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();

    emit(message: OptimizerWorkerResponse) {
      this.onmessage?.({ data: message } as MessageEvent<OptimizerWorkerResponse>);
    }
  }

  return {
    workerInstances: [] as FakeOptimizerWorker[],
    FakeOptimizerWorker,
  };
});

vi.mock("./optimizer.worker.client", () => ({
  createOptimizerWorker: vi.fn(() => {
    const worker = new (class {
      onmessage: ((event: MessageEvent<OptimizerWorkerResponse>) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();

      emit(message: OptimizerWorkerResponse) {
        this.onmessage?.({ data: message } as MessageEvent<OptimizerWorkerResponse>);
      }
    })();
    workerInstances.push(worker);
    return worker as unknown as Worker;
  }),
}));

const responses = new Map<string, unknown>([
  ["/catalogs/2026-03-29-v1.1-phase2/manifest.json", manifest],
  ["/catalogs/2026-03-29-v1.1-phase2/progression.json", progression],
  ["/catalogs/2026-03-29-v1.1-phase2/operators.json", operators],
  ["/catalogs/2026-03-29-v1.1-phase2/facilities.json", facilities],
  ["/catalogs/2026-03-29-v1.1-phase2/recipes.json", recipes],
  ["/catalogs/2026-03-29-v1.1-phase2/sources.json", sources],
  ["/catalogs/2026-03-29-v1.1-phase2/gaps.json", gaps],
  ["/catalogs/2026-03-29-v1.1-phase2/assets.json", assets],
]);

function requireHtmlElement<T extends Element>(element: T | null | undefined): HTMLElement {
  expect(element).not.toBeNull();
  return element as unknown as HTMLElement;
}

function getPortraitTile(name: string): HTMLElement {
  const label = screen.getAllByText(name).find((element) => element.closest(".portraitTile"));
  return requireHtmlElement(label?.closest(".portraitTile"));
}

function getVisiblePortraitNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".portraitGrid .portraitLabel"))
    .map((element) => element.textContent)
    .filter((name): name is string => Boolean(name));
}

describe("App", () => {
  const getOptimizationProfileSelect = () => screen.getByText("Optimization profile").closest("label")!.querySelector("select") as HTMLSelectElement;
  const getSearchEffortSlider = () => screen.getByText("Search depth").closest("label")!.querySelector('input[type="range"]') as HTMLInputElement;
  const getDemandProfileSelect = () => screen.getByText("Demand profile").closest("label")!.querySelector("select") as HTMLSelectElement;
  const getPriorityRecipeSelect = () => screen.getByText("Priority recipe").closest("label")!.querySelector("select") as HTMLSelectElement;
  const getRosterSortSelect = () => screen.getByText("Sort roster").closest("label")!.querySelector("select") as HTMLSelectElement;
  const getRosterOwnedFilterSelect = () => screen.getByText("Owned state").closest("label")!.querySelector("select") as HTMLSelectElement;
  const getRosterFacilityFilterSelect = () => screen.getByText("Facility focus").closest("label")!.querySelector("select") as HTMLSelectElement;
  const getDemandSlider = (label: string) => screen
    .getAllByText(label)
    .find((element) => element.closest(".objectiveWeightField"))
    ?.closest("label")
    ?.querySelector('input[type="range"]') as HTMLInputElement;
  const seedDraft = (ownedOperatorIds: string[]) => {
    localStorage.setItem(
      "endfield-dijiang-optimizer:draft",
      JSON.stringify({
        scenarioFormatVersion: 1,
        catalogVersion: "2026-03-29/v1.1-phase2",
        roster: ownedOperatorIds.map((operatorId) => ({
          operatorId,
          owned: true,
          level: 1,
          promotionTier: 0,
          baseSkillStates: [],
        })),
        facilities: {
          controlNexus: { level: 3 },
          manufacturingCabins: [
            { id: "mfg-1", enabled: true, level: 1, fixedRecipeId: "elementary-cognitive-carrier" },
            { id: "mfg-2", enabled: true, level: 1, fixedRecipeId: "arms-inspector" },
          ],
          growthChambers: [
            { id: "growth-1", enabled: true, level: 1, fixedRecipeIds: ["kalkonyx"] },
          ],
          receptionRoom: { id: "reception-1", enabled: true, level: 1 },
          hardAssignments: [],
        },
        options: {
          maxFacilities: false,
          upgradeRankingMode: "balanced",
        },
      }),
    );
  };

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    workerInstances.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const key = String(input);
        const body = responses.get(key);
        if (!body) {
          return new Response("not found", { status: 404 });
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
  });

  it("loads the bundled catalog and runs optimize from the UI", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const ownedToggles = await screen.findAllByRole("checkbox", { name: "Owned" });
    await userEvent.click(ownedToggles[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    expect(screen.getByRole("dialog", { name: "Optimization progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Optimize" })).toBeDisabled();

    act(() => {
      workerInstances[0]!.emit({
        type: "optimization-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          totalScore: 42,
          projectedRecipeOutputs: {},
          projectedOutputs: {
            operator_exp: 0,
            weapon_exp: 0,
            fungal: 0,
            vitrified_plant: 0,
            rare_mineral: 0,
          },
          roomPlans: [
            {
              roomId: "mfg-1",
              roomKind: "manufacturing_cabin",
              roomLevel: 1,
              chosenRecipeIds: ["elementary-cognitive-carrier"],
              chosenProductKind: "operator_exp",
              assignedOperatorIds: ["chen-qianyu", "xaihi"],
              scoreBreakdown: {
                directProductionScore: 30,
                supportRoomScore: 12,
                crossRoomBonusContribution: 0,
                totalScore: 42,
              },
              projectedScore: 42,
              projectedOutputs: {
                operator_exp: 30,
                weapon_exp: 0,
                fungal: 0,
                vitrified_plant: 0,
                rare_mineral: 0,
              },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
          ],
          explanations: [],
          warnings: [],
          supportWeightsVersion: "test",
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Optimization progress" })).not.toBeInTheDocument();
      expect(screen.getByText("Why this wins")).toBeInTheDocument();
      expect(screen.getByText(/Total score/i)).toBeInTheDocument();
    });

    const roomHeading = screen.getAllByText("Manufacturing Cabin 1").find((element) => element.closest(".resultCard"));
    const roomCard = requireHtmlElement(roomHeading?.closest(".resultCard"));
    expect(within(roomCard).getByRole("img", { name: "Chen Qianyu portrait" })).toBeInTheDocument();
    expect(within(roomCard).getByRole("img", { name: "Xaihi portrait" })).toBeInTheDocument();
  });

  it("omits empty recipe text for support rooms and renders growth recipes without pipe separators", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    act(() => {
      workerInstances[0]!.emit({
        type: "optimization-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          totalScore: 3,
          projectedRecipeOutputs: {},
          projectedOutputs: {
            operator_exp: 0,
            weapon_exp: 0,
            fungal: 1,
            vitrified_plant: 1,
            rare_mineral: 1,
          },
          roomPlans: [
            {
              roomId: "control_nexus",
              roomKind: "control_nexus",
              roomLevel: 3,
              chosenRecipeIds: [],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 0, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 0 },
              projectedScore: 0,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
            {
              roomId: "reception-1",
              roomKind: "reception_room",
              roomLevel: 1,
              chosenRecipeIds: [],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 0, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 0 },
              projectedScore: 0,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
            {
              roomId: "growth-1",
              roomKind: "growth_chamber",
              roomLevel: 3,
              chosenRecipeIds: ["wulingstone", "false-aggela", "cosmagaric"],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 3, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 3 },
              projectedScore: 3,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 1, vitrified_plant: 1, rare_mineral: 1 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
          ],
          explanations: [],
          warnings: [],
          supportWeightsVersion: "test",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Why this wins")).toBeInTheDocument();
    });

    expect(screen.queryByText("No recipe selected")).not.toBeInTheDocument();

    const growthHeading = screen.getAllByText("Growth Chamber 1").find((element) => element.closest(".resultCard"));
    const growthCard = requireHtmlElement(growthHeading?.closest(".resultCard"));
    expect(growthCard).toHaveTextContent("Wulingstone");
    expect(growthCard).toHaveTextContent("False Aggela");
    expect(growthCard).toHaveTextContent("Cosmagaric");
    expect(growthCard).not.toHaveTextContent("||");
  });

  it("renders bundled operator portraits in the roster", async () => {
    render(<App />);

    const portrait = await screen.findByRole("img", { name: "Chen Qianyu portrait" });

    expect(portrait).toHaveAttribute(
      "src",
      "/catalogs/2026-03-29-v1.1-phase2/assets/operators/chen-qianyu.webp",
    );
    expect(requireHtmlElement(portrait.closest(".avatar"))).toHaveAttribute("data-rarity", "5");
  });

  it("uses clearer workspace and catalog labels", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    expect(screen.getByRole("tab", { name: /Edit roster/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Plan base/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /View results/i })).toBeInTheDocument();
    expect(screen.getAllByText("Owned operators").length).toBeGreaterThan(0);
    expect(screen.getByText("Source refs")).toBeInTheDocument();
    expect(screen.getByText("Known data gaps")).toBeInTheDocument();
    expect(screen.getByText("Search depth")).toBeInTheDocument();
  });

  it("filters the roster by owned state, facility focus, and search text", async () => {
    seedDraft(["ardelia", "chen-qianyu"]);
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    expect(screen.getByText("Matching owned")).toBeInTheDocument();

    await userEvent.selectOptions(getRosterOwnedFilterSelect(), "owned");
    await waitFor(() => {
      expect(getVisiblePortraitNames(container)).toContain("Ardelia");
      expect(getVisiblePortraitNames(container)).toContain("Chen Qianyu");
      expect(getVisiblePortraitNames(container)).not.toContain("Avywenna");
      expect(screen.queryByText("Matching owned")).not.toBeInTheDocument();
    });

    await userEvent.selectOptions(getRosterFacilityFilterSelect(), "reception_room");
    await waitFor(() => {
      expect(getVisiblePortraitNames(container)).toContain("Ardelia");
      expect(getVisiblePortraitNames(container)).not.toContain("Chen Qianyu");
    });

    await userEvent.type(screen.getByRole("textbox", { name: "Search roster" }), "avy");
    await waitFor(() => {
      expect(screen.getByText("No operators match the current search and filters.")).toBeInTheDocument();
    });
  });

  it("explains what operator level is used for in planning", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    expect(screen.getByText(/Level and promotion are used to estimate what it takes to unlock the next Base Skill rank/i)).toBeInTheDocument();
    expect(screen.getByText(/Base Skill unlocks depend on meeting the prerequisite level, reaching the required Elite tier, and then unlocking the skill itself/i)).toBeInTheDocument();
  });

  it("shows help popovers immediately on hover and focus", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const demandHelp = screen.getByRole("button", {
      name: /Controls which long-run outputs the score model favors/i,
    });

    fireEvent.mouseEnter(demandHelp);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Balanced keeps a general objective.");
    fireEvent.mouseLeave(demandHelp);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    fireEvent.focus(demandHelp);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Projected outputs remain raw units per hour.");
  });

  it("renders Base Skill icons in the roster, operator editor, and recommendations", async () => {
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    expect(container.querySelectorAll(".editorSkillGrid .skillBadgeImage").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".editorSkillGrid .skillBadgeOverlay").length).toBe(0);

    const ownedToggles = await screen.findAllByRole("checkbox", { name: "Owned" });
    await userEvent.click(ownedToggles[0]!);
    const firstSkillSelect = container.querySelector(".editorSkillGrid .skillCard select") as HTMLSelectElement;
    fireEvent.change(firstSkillSelect, {
      target: {
        value: "1",
      },
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".portraitSkills .skillBadgeImage").length).toBeGreaterThan(0);
    });
    const rosterSkillBadge = container.querySelector(".portraitSkills .skillTooltipWrap");
    expect(rosterSkillBadge).not.toHaveAttribute("title");
    fireEvent.mouseEnter(requireHtmlElement(rosterSkillBadge));
    expect(screen.getByRole("tooltip")).toHaveTextContent(rosterSkillBadge!.getAttribute("aria-label") ?? "");
    fireEvent.mouseLeave(requireHtmlElement(rosterSkillBadge));
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Recommend unlocks" }));

    act(() => {
      workerInstances[0]!.emit({
        type: "recommendations-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          baselineScore: 1,
          rankingMode: "balanced",
          recommendations: [
            {
              action: {
                operatorId: "chen-qianyu",
                skillId: "blade-critique",
                targetRank: 1,
                currentLevel: 1,
                currentPromotionTier: 0,
                requiredLevel: 20,
                requiredPromotionTier: 1,
                levelsToGain: 19,
                levelExpCost: 0,
                levelTCredCost: 0,
                levelMaterialCosts: [],
                levelCostIsUpperBound: false,
                promotionMaterialCosts: [],
                skillMaterialCosts: [],
                materialCosts: [],
                unlockHint: "test",
              },
              scoreDelta: 1,
              roi: 1,
              estimatedDaysToUnlock: 1,
              notes: [],
            },
          ],
        },
      });
    });

    const recommendationCard = await screen.findByText("Blade Critique");
    expect(requireHtmlElement(recommendationCard.closest(".resultCard"))).not.toBeNull();
    expect(screen.getByAltText("Blade Critique icon")).toBeInTheDocument();
  });

  it("removes duplicated recommendation note content from the result card", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(screen.getByRole("button", { name: "Recommend unlocks" }));

    act(() => {
      workerInstances[0]!.emit({
        type: "recommendations-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          baselineScore: 1,
          rankingMode: "balanced",
          recommendations: [
            {
              action: {
                operatorId: "chen-qianyu",
                skillId: "blade-critique",
                targetRank: 1,
                currentLevel: 40,
                currentPromotionTier: 1,
                requiredLevel: 40,
                requiredPromotionTier: 2,
                levelsToGain: 0,
                levelExpCost: 100,
                levelTCredCost: 200,
                levelMaterialCosts: [{ itemId: "advanced-combat-record", quantity: 3 }],
                levelCostIsUpperBound: false,
                promotionMaterialCosts: [{ itemId: "protodisk", quantity: 2 }],
                skillMaterialCosts: [{ itemId: "protoprism", quantity: 1 }],
                materialCosts: [],
                unlockHint: "Unlock Blade Critique gamma.",
              },
              scoreDelta: 1,
              roi: 1,
              estimatedDaysToUnlock: 1,
              notes: [
                "Operator: Chen Qianyu",
                "Unlock Blade Critique gamma.",
                "Requires 0 level(s) of EXP progression to reach Elite 2 Level 40.",
                "100 Operator EXP and 200 T-Creds for leveling.",
                "Leveling materials: 3x advanced-combat-record.",
                "Includes promotion materials: 2x protodisk.",
                "Includes Base Skill node materials: 1x protoprism.",
                "Approximate effort score 12.0 derived from bundled promotion costs, Base Skill costs, and level gating.",
              ],
            },
          ],
        },
      });
    });

    const recommendationCard = requireHtmlElement((await screen.findByText("Blade Critique")).closest(".resultCard"));
    expect(within(recommendationCard).queryByText(/Current Elite 1 Lv40/)).not.toBeInTheDocument();
    expect(within(recommendationCard).queryByText("Operator: Chen Qianyu")).not.toBeInTheDocument();
    expect(within(recommendationCard).queryByText(/Leveling materials:/)).not.toBeInTheDocument();
    expect(within(recommendationCard).queryByText(/Includes promotion materials:/)).not.toBeInTheDocument();
    expect(within(recommendationCard).queryByText(/Includes Base Skill node materials:/)).not.toBeInTheDocument();
    expect(within(recommendationCard).getByAltText("Advanced Combat Record icon")).toBeInTheDocument();
    expect(within(recommendationCard).getByText("3x")).toBeInTheDocument();
    expect(within(recommendationCard).getByText("Advanced Combat Record")).toBeInTheDocument();
    expect(within(recommendationCard).getByAltText("Protodisk icon")).toBeInTheDocument();
    expect(within(recommendationCard).getByText("Protoprism")).toBeInTheDocument();
    expect(within(recommendationCard).queryByText("100 Operator EXP and 200 T-Creds for leveling.")).not.toBeInTheDocument();
    expect(within(recommendationCard).getByText("Approximate effort score 12.0 derived from bundled promotion costs, Base Skill costs, and level gating.")).toBeInTheDocument();
  });

  it("orders facilities like the in-game layout and operators by rarity then name", async () => {
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const operatorNames = Array.from(container.querySelectorAll(".portraitGrid .portraitLabel"))
      .map((element) => element.textContent)
      .filter(Boolean);
    expect(operatorNames.indexOf("Ardelia")).toBeLessThan(operatorNames.indexOf("Alesh"));
    expect(operatorNames.indexOf("Ember")).toBeLessThan(operatorNames.indexOf("Gilberta"));
    expect(operatorNames.indexOf("Gilberta")).toBeLessThan(operatorNames.indexOf("Tangtang"));

    await userEvent.click(screen.getByRole("tab", { name: /Plan base/i }));
    const plannerPanel = requireHtmlElement(screen.getByText("Dijiang layout").closest(".plannerPanel"));
    const facilityHeadings = within(plannerPanel).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(facilityHeadings.slice(0, 5)).toEqual([
      "Control Nexus",
      "Reception Room",
      "Manufacturing Cabin 1",
      "Manufacturing Cabin 2",
      "Growth Chamber 1",
    ]);
  });

  it("shows a readable unowned badge on roster portraits", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const portraitTile = getPortraitTile("Ardelia");
    expect(within(portraitTile).getByText("Unowned")).toBeInTheDocument();
    expect(portraitTile).not.toHaveTextContent("\\uD83D");
  });

  it("keeps the owned portrait badge as a visible level label", async () => {
    seedDraft(["ardelia"]);
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const portraitTile = getPortraitTile("Ardelia");
    expect(within(portraitTile).getByText("Lv")).toBeInTheDocument();
    expect(within(portraitTile).getByText("1")).toBeInTheDocument();
    const ownedBadge = within(portraitTile).getByLabelText("Owned operator, level 1");
    expect(ownedBadge).toBeInTheDocument();
    expect(ownedBadge).not.toHaveAttribute("title");
    fireEvent.mouseEnter(ownedBadge);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Marked as owned.");
    fireEvent.mouseLeave(ownedBadge);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("sorts the roster alphabetically when requested", async () => {
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.selectOptions(getRosterSortSelect(), "alphabetical");

    const operatorNames = Array.from(container.querySelectorAll(".portraitGrid .portraitLabel"))
      .map((element) => element.textContent)
      .filter(Boolean);
    expect(operatorNames.slice(0, 5)).toEqual(["Akekuri", "Alesh", "Antal", "Arclight", "Ardelia"]);
  });

  it("sorts the roster by owned level with unowned operators treated as level 0", async () => {
    seedDraft(["ardelia", "alesh", "xaihi"]);
    localStorage.setItem(
      "endfield-dijiang-optimizer:draft",
      JSON.stringify({
        ...JSON.parse(localStorage.getItem("endfield-dijiang-optimizer:draft") ?? "{}"),
        roster: [
          { operatorId: "ardelia", owned: true, level: 80, promotionTier: 0, baseSkillStates: [] },
          { operatorId: "alesh", owned: true, level: 20, promotionTier: 0, baseSkillStates: [] },
          { operatorId: "xaihi", owned: true, level: 5, promotionTier: 0, baseSkillStates: [] },
        ],
      }),
    );
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.selectOptions(getRosterSortSelect(), "level");

    const operatorNames = Array.from(container.querySelectorAll(".portraitGrid .portraitLabel"))
      .map((element) => element.textContent)
      .filter(Boolean);
    expect(operatorNames.indexOf("Ardelia")).toBeLessThan(operatorNames.indexOf("Alesh"));
    expect(operatorNames.indexOf("Alesh")).toBeLessThan(operatorNames.indexOf("Xaihi"));
    expect(operatorNames.indexOf("Xaihi")).toBeLessThan(operatorNames.indexOf("Chen Qianyu"));
  });

  it("sorts the roster by facility-focused skill order", async () => {
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.selectOptions(getRosterSortSelect(), "skill");

    const operatorNames = Array.from(container.querySelectorAll(".portraitGrid .portraitLabel"))
      .map((element) => element.textContent)
      .filter(Boolean);
    expect(operatorNames.indexOf("Perlica")).toBeLessThan(operatorNames.indexOf("Ardelia"));
    expect(operatorNames.indexOf("Ardelia")).toBeLessThan(operatorNames.indexOf("Chen Qianyu"));
    expect(operatorNames.indexOf("Chen Qianyu")).toBeLessThan(operatorNames.indexOf("Yvonne"));
  });

  it("shows clue-targeted reception skills with their specific clue number", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(getPortraitTile("Lifeng"));

    expect(screen.getByText(/Clue Rate Up \+8% \(Clue 3\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Clue Rate Up \+12% \(Clue 3\)/i)).toBeInTheDocument();
  });

  it("removes the redundant Control Nexus current level summary", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(screen.getByRole("tab", { name: /Plan base/i }));

    const plannerPanel = requireHtmlElement(screen.getByText("Dijiang layout").closest(".plannerPanel"));
    const controlNexusCard = requireHtmlElement(within(plannerPanel).getByText("Control Nexus").closest(".plannerRoomCard"));
    expect(within(plannerPanel).queryByText("Current level")).not.toBeInTheDocument();
    expect(within(controlNexusCard).getByRole("spinbutton", { name: "Level" })).toHaveValue(1);
  });

  it("lets locked future rooms be preconfigured without blocking optimization", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(screen.getByRole("tab", { name: /Plan base/i }));

    const plannerPanel = requireHtmlElement(screen.getByText("Dijiang layout").closest(".plannerPanel"));
    const manufacturingCard = requireHtmlElement(within(plannerPanel).getByText("Manufacturing Cabin 2").closest(".plannerRoomCard"));
    const enabledToggle = within(manufacturingCard).getByRole("checkbox", { name: "Enabled" });
    const levelInput = within(manufacturingCard).getByRole("spinbutton", { name: "Level" });
    const recipeSelect = within(manufacturingCard).getAllByRole("combobox")[0] as HTMLSelectElement;

    expect(enabledToggle).not.toBeDisabled();
    expect(levelInput).not.toBeDisabled();
    expect(recipeSelect).not.toBeDisabled();
    expect(levelInput).toHaveAttribute("max", "3");
    expect(within(recipeSelect).getByRole("option", { name: "Advanced Cognitive Carrier" })).toBeInTheDocument();

    await userEvent.click(enabledToggle);
    fireEvent.change(levelInput, { target: { value: "3" } });
    await userEvent.selectOptions(within(manufacturingCard).getAllByRole("combobox")[0] as HTMLSelectElement, "advanced-cognitive-carrier");

    const warningLink = screen.getByText(/Manufacturing Cabin 2 is saved for later and will stay inactive until your Control Nexus unlocks it/i);
    expect(enabledToggle).toHaveClass("validationTargetWarning");

    await userEvent.click(warningLink);

    await waitFor(() => {
      expect(enabledToggle).toHaveAttribute("data-warning-target", "flash");
    });

    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));
    expect(screen.getByRole("dialog", { name: "Proceed with warnings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Proceed" }));

    await waitFor(() => {
      expect(workerInstances[0]!.postMessage).toHaveBeenCalledTimes(1);
    });
  });

  it("allows preconfiguring unowned operators without counting them as owned", async () => {
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const selectedOperatorName = requireHtmlElement(container.querySelector(".operatorName")).textContent ?? "";
    const selectedOperator = operators.operators.find((entry) => entry.name === selectedOperatorName);
    const levelInput = screen.getByRole("spinbutton", { name: "Level" });
    const promotionSelect = screen.getByRole("combobox", { name: "Promotion" });
    const firstSkillSelect = container.querySelector(".editorSkillGrid .skillCard select") as HTMLSelectElement;

    expect(selectedOperator).toBeTruthy();
    expect(screen.getByText(/does not count as owned until you enable the toggle/i)).toBeInTheDocument();
    expect(levelInput).not.toBeDisabled();
    expect(promotionSelect).not.toBeDisabled();
    expect(firstSkillSelect).not.toBeDisabled();

    fireEvent.change(levelInput, { target: { value: "37" } });
    await userEvent.selectOptions(promotionSelect, "2");
    await userEvent.selectOptions(firstSkillSelect, "1");
    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    await waitFor(() => {
      expect(workerInstances[0]!.postMessage).toHaveBeenCalledTimes(1);
    });

    const rosterEntry = workerInstances[0]!.postMessage.mock.calls[0]![0].scenario.roster.find((entry: { operatorId: string }) => entry.operatorId === selectedOperator!.id);
    const statusCard = requireHtmlElement(screen.getByText("Status").closest("article"));
    expect(within(statusCard).getByText("Unowned")).toBeInTheDocument();
    expect(rosterEntry).toMatchObject({
      operatorId: selectedOperator!.id,
      owned: false,
      level: 37,
      promotionTier: 2,
    });
    expect(rosterEntry.baseSkillStates[0]).toMatchObject({
      unlockedRank: 1,
    });
  });

  it("caps operator level edits at 90 before sending optimization input", async () => {
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const selectedOperatorName = requireHtmlElement(container.querySelector(".operatorName")).textContent ?? "";
    const selectedOperator = operators.operators.find((entry) => entry.name === selectedOperatorName);
    const levelInput = screen.getByRole("spinbutton", { name: "Level" });

    expect(selectedOperator).toBeTruthy();
    expect(levelInput).toHaveAttribute("max", "90");

    fireEvent.change(levelInput, { target: { value: "999" } });
    expect(levelInput).toHaveValue(90);

    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    await waitFor(() => {
      expect(workerInstances[0]!.postMessage).toHaveBeenCalledTimes(1);
    });

    const rosterEntry = workerInstances[0]!.postMessage.mock.calls[0]![0].scenario.roster.find((entry: { operatorId: string }) => entry.operatorId === selectedOperator!.id);
    expect(rosterEntry).toMatchObject({
      operatorId: selectedOperator!.id,
      level: 90,
    });
  });

  it("orders result facilities to match the planner layout", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    act(() => {
      workerInstances[0]!.emit({
        type: "optimization-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          totalScore: 10,
          projectedRecipeOutputs: {},
          projectedOutputs: {
            operator_exp: 0,
            weapon_exp: 0,
            fungal: 0,
            vitrified_plant: 0,
            rare_mineral: 0,
          },
          roomPlans: [
            {
              roomId: "growth-1",
              roomKind: "growth_chamber",
              roomLevel: 1,
              chosenRecipeIds: [],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 0, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 0 },
              projectedScore: 0,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
            {
              roomId: "mfg-1",
              roomKind: "manufacturing_cabin",
              roomLevel: 1,
              chosenRecipeIds: [],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 0, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 0 },
              projectedScore: 0,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
            {
              roomId: "reception-1",
              roomKind: "reception_room",
              roomLevel: 1,
              chosenRecipeIds: [],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 0, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 0 },
              projectedScore: 0,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
            {
              roomId: "control_nexus",
              roomKind: "control_nexus",
              roomLevel: 1,
              chosenRecipeIds: [],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 0, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 0 },
              projectedScore: 0,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
            {
              roomId: "mfg-2",
              roomKind: "manufacturing_cabin",
              roomLevel: 1,
              chosenRecipeIds: [],
              assignedOperatorIds: [],
              scoreBreakdown: { directProductionScore: 0, supportRoomScore: 0, crossRoomBonusContribution: 0, totalScore: 0 },
              projectedScore: 0,
              projectedOutputs: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 },
              warnings: [],
              usedFallbackHeuristics: false,
              dataConfidence: "verified",
            },
          ],
          explanations: [],
          warnings: [],
          supportWeightsVersion: "test",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Why this wins")).toBeInTheDocument();
    });

    const resultHeadings = screen.getAllByRole("heading", { level: 3 })
      .filter((heading) => heading.closest(".resultCard"))
      .map((heading) => heading.textContent);

    expect(resultHeadings.slice(0, 5)).toEqual([
      "Control Nexus",
      "Reception Room",
      "Manufacturing Cabin 1",
      "Manufacturing Cabin 2",
      "Growth Chamber 1",
    ]);
  });

  it("runs recommendations from the UI", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const ownedToggles = await screen.findAllByRole("checkbox", { name: "Owned" });
    await userEvent.click(ownedToggles[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Recommend unlocks" }));

    expect(screen.getByRole("dialog", { name: "Recommendation progress" })).toBeInTheDocument();

    act(() => {
      workerInstances[0]!.emit({
        type: "recommendations-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          baselineScore: 1,
          rankingMode: "balanced",
          recommendations: [
            {
              action: {
                operatorId: "chen-qianyu",
                skillId: "blade-critique",
                targetRank: 1,
                currentLevel: 1,
                currentPromotionTier: 0,
                requiredLevel: 20,
                requiredPromotionTier: 1,
                levelsToGain: 19,
                levelExpCost: 0,
                levelTCredCost: 0,
                levelMaterialCosts: [],
                levelCostIsUpperBound: false,
                promotionMaterialCosts: [],
                skillMaterialCosts: [],
                materialCosts: [],
                unlockHint: "test",
              },
              scoreDelta: 1,
              roi: 1,
              estimatedDaysToUnlock: 1,
              notes: [],
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Next unlocks")).toBeInTheDocument();
    });
  });

  it("falls back to a greek-only badge when a Base Skill icon fails to load", async () => {
    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    const ownedToggles = await screen.findAllByRole("checkbox", { name: "Owned" });
    await userEvent.click(ownedToggles[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Recommend unlocks" }));

    act(() => {
      workerInstances[0]!.emit({
        type: "recommendations-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          baselineScore: 1,
          rankingMode: "balanced",
          recommendations: [
            {
              action: {
                operatorId: "chen-qianyu",
                skillId: "blade-critique",
                targetRank: 1,
                currentLevel: 1,
                currentPromotionTier: 0,
                requiredLevel: 20,
                requiredPromotionTier: 1,
                levelsToGain: 19,
                levelExpCost: 0,
                levelTCredCost: 0,
                levelMaterialCosts: [],
                levelCostIsUpperBound: false,
                promotionMaterialCosts: [],
                skillMaterialCosts: [],
                materialCosts: [],
                unlockHint: "test",
              },
              scoreDelta: 1,
              roi: 1,
              estimatedDaysToUnlock: 1,
              notes: [],
            },
          ],
        },
      });
    });

    const recommendationCard = (await screen.findByText("Blade Critique")).closest(".resultCard") as HTMLElement;
    const badge = within(recommendationCard).getByLabelText(/Blade Critique:/);
    const badgeIcon = requireHtmlElement(badge.querySelector(".skillBadge"));
    const badgeImage = within(recommendationCard).getByAltText("Blade Critique icon");
    const expectedOverlay = badge.getAttribute("aria-label")?.includes("GAMMA")
      ? "\u03b3"
      : badge.getAttribute("aria-label")?.includes("ALPHA")
        ? "\u03b1"
        : "\u03b2";

    fireEvent.error(badgeImage);

    await waitFor(() => {
      expect(within(recommendationCard).queryByAltText("Blade Critique icon")).not.toBeInTheDocument();
      expect(badgeIcon).toHaveClass("fallback");
      expect(within(recommendationCard).getByText(expectedOverlay)).toBeInTheDocument();
    });
  });

  it("exports the current scenario as JSON", async () => {
    const createObjectUrl = vi.fn(() => "blob:test");
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi.fn();

    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        Object.defineProperty(element, "click", {
          value: anchorClick,
          configurable: true,
        });
      }
      return element;
    });

    render(<App />);
    await screen.findByText("Endfield Dijiang Optimizer");

    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:test");
  });

  it("imports a scenario JSON file", async () => {
    render(<App />);
    await screen.findByText("Endfield Dijiang Optimizer");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const importedScenario = {
      scenarioFormatVersion: 1,
      catalogVersion: "2026-03-29/v1.1-phase2",
      roster: [],
      facilities: {
        controlNexus: { level: 3 },
        manufacturingCabins: [{ id: "mfg-1", enabled: true, level: 2, fixedRecipeId: "elementary-cognitive-carrier" }],
        growthChambers: [],
        receptionRoom: { id: "reception-1", enabled: true, level: 1 },
        hardAssignments: [],
      },
      options: {
        maxFacilities: false,
        upgradeRankingMode: "balanced",
        optimizationProfile: "custom",
        optimizationEffort: 17,
      },
    };

    const file = new File([JSON.stringify(importedScenario)], "scenario.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () => JSON.stringify(importedScenario)),
    });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(getOptimizationProfileSelect()).toHaveValue("custom");
      expect(getSearchEffortSlider()).toHaveValue("17");
    });
  });

  it("rejects non-JSON imports before reading them", async () => {
    render(<App />);
    await screen.findByText("Endfield Dijiang Optimizer");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["not json"], "scenario.txt", { type: "text/plain" });
    const textSpy = vi.fn(async () => "not json");
    Object.defineProperty(file, "text", {
      value: textSpy,
    });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Import requires a JSON file.")).toBeInTheDocument();
    });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized JSON imports before reading them", async () => {
    render(<App />);
    await screen.findByText("Endfield Dijiang Optimizer");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(1_000_001)], "scenario.json", { type: "application/json" });
    const textSpy = vi.fn(async () => "{}");
    Object.defineProperty(file, "text", {
      value: textSpy,
    });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Import file is too large/i)).toBeInTheDocument();
    });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("rejects imported scenarios that fail catalog validation", async () => {
    render(<App />);
    await screen.findByText("Endfield Dijiang Optimizer");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const importedScenario = {
      scenarioFormatVersion: 1,
      catalogVersion: "2026-03-29/v1.1-phase2",
      roster: [],
      facilities: {
        controlNexus: { level: 3 },
        manufacturingCabins: [{ id: "mfg-1", enabled: true, level: 2, fixedRecipeId: "definitely-not-a-real-recipe" }],
        growthChambers: [],
        receptionRoom: { id: "reception-1", enabled: true, level: 1 },
        hardAssignments: [],
      },
      options: {
        maxFacilities: false,
        upgradeRankingMode: "balanced",
      },
    };

    const file = new File([JSON.stringify(importedScenario)], "scenario.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () => JSON.stringify(importedScenario)),
    });

    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/references unknown recipe/i)).toBeInTheDocument();
      expect(getOptimizationProfileSelect()).toHaveValue("balanced");
    });
  });

  it("sends the selected demand profile and priority recipe to optimization runs", async () => {
    render(<App />);
    await screen.findByText("Endfield Dijiang Optimizer");

    await userEvent.selectOptions(getDemandProfileSelect(), "custom");
    await waitFor(() => {
      expect(screen.getByText("Custom demand weights")).toBeInTheDocument();
    });

    fireEvent.change(getDemandSlider("Operator Exp"), {
      target: { value: "3.5" },
    });
    fireEvent.change(getDemandSlider("Reception utility"), {
      target: { value: "2.25" },
    });
    await userEvent.selectOptions(getPriorityRecipeSelect(), "arms-inspector");
    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    await waitFor(() => {
      expect(workerInstances[0]!.postMessage).toHaveBeenCalledTimes(1);
    });

    const message = workerInstances[0]!.postMessage.mock.calls[0]![0];
    expect(message.type).toBe("start-optimization");
    expect(message.scenario.options.demandProfile).toEqual({
      preset: "custom",
      productWeights: {
        operator_exp: 3.5,
        weapon_exp: 1,
        fungal: 1,
        vitrified_plant: 1,
        rare_mineral: 1,
      },
      receptionWeight: 2.25,
      priorityRecipeId: "arms-inspector",
    });
  });

  it("normalizes older drafts so the second manufacturing cabin is visible and keeps optimization effort", async () => {
    localStorage.setItem(
      "endfield-dijiang-optimizer:draft",
      JSON.stringify({
        scenarioFormatVersion: 1,
        catalogVersion: "2026-03-29/v1.1-phase2",
        roster: [],
        facilities: {
          controlNexus: { level: 5 },
          manufacturingCabins: [{ id: "mfg-1", enabled: true, level: 3, fixedRecipeId: "advanced-cognitive-carrier" }],
          growthChambers: [],
          hardAssignments: [],
        },
        options: {
          maxFacilities: false,
          upgradeRankingMode: "balanced",
          optimizationProfile: "thorough",
          optimizationEffort: 14,
        },
      }),
    );

    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(screen.getByRole("tab", { name: /Plan base/i }));

    await waitFor(() => {
      expect(screen.getByText("Manufacturing Cabin 2")).toBeInTheDocument();
      expect(getOptimizationProfileSelect()).toHaveValue("thorough");
      expect(getSearchEffortSlider()).toHaveValue("14");
    });
  });

  it("rewrites stale local drafts to the current catalog version on startup", async () => {
    localStorage.setItem(
      "endfield-dijiang-optimizer:draft",
      JSON.stringify({
        scenarioFormatVersion: 1,
        catalogVersion: "2026-03-20/v1.1-phase1",
        roster: [],
        facilities: {
          controlNexus: { level: 1 },
          manufacturingCabins: [],
          growthChambers: [],
          hardAssignments: [],
        },
        options: {
          maxFacilities: false,
          upgradeRankingMode: "balanced",
        },
      }),
    );

    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");

    await waitFor(() => {
      const savedDraft = JSON.parse(localStorage.getItem("endfield-dijiang-optimizer:draft") ?? "{}");
      expect(savedDraft.catalogVersion).toBe("2026-03-29/v1.1-phase2");
      expect(savedDraft.roster).toHaveLength(operators.operators.length);
    });
  });

  it("prevents duplicate hard-assignment operators and keeps manual operator changes", async () => {
    seedDraft(["chen-qianyu", "xaihi", "snowshine"]);
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(screen.getByRole("tab", { name: /Plan base/i }));

    const addButton = screen.getByRole("button", { name: "Add hard assignment" });
    await userEvent.click(addButton);
    await userEvent.click(addButton);

    await waitFor(() => {
      expect(container.querySelectorAll(".hardAssignmentRow").length).toBe(2);
    });

    const [firstRow, secondRow] = Array.from(container.querySelectorAll<HTMLElement>(".hardAssignmentRow"));
    const firstOperatorSelect = within(firstRow!).getByRole("combobox", { name: "Operator" }) as HTMLSelectElement;
    const secondOperatorSelect = within(secondRow!).getByRole("combobox", { name: "Operator" }) as HTMLSelectElement;
    const firstOperatorId = firstOperatorSelect.value;
    const secondOperatorId = secondOperatorSelect.value;

    expect(secondOperatorId).not.toBe(firstOperatorId);
    expect(Array.from(secondOperatorSelect.options).map((option) => option.value)).not.toContain(firstOperatorId);

    const nextFirstOperatorId = Array.from(firstOperatorSelect.options)
      .map((option) => option.value)
      .find((value) => value !== firstOperatorId && value !== secondOperatorId);

    expect(nextFirstOperatorId).toBeTruthy();

    await userEvent.selectOptions(firstOperatorSelect, nextFirstOperatorId!);

    await waitFor(() => {
      const updatedRows = Array.from(container.querySelectorAll<HTMLElement>(".hardAssignmentRow"));
      const updatedFirstOperatorSelect = within(updatedRows[0]!).getByRole("combobox", { name: "Operator" }) as HTMLSelectElement;
      const updatedSecondOperatorSelect = within(updatedRows[1]!).getByRole("combobox", { name: "Operator" }) as HTMLSelectElement;
      const updatedSecondOptions = Array.from(updatedSecondOperatorSelect.options).map((option) => option.value);

      expect(updatedFirstOperatorSelect).toHaveValue(nextFirstOperatorId!);
      expect(updatedSecondOptions).not.toContain(nextFirstOperatorId!);
      expect(updatedSecondOptions).toContain(firstOperatorId);
    });
  });

  it("removes hard-assignment rows and disables adding when no operators remain", async () => {
    seedDraft(["chen-qianyu", "xaihi"]);
    const { container } = render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(screen.getByRole("tab", { name: /Plan base/i }));

    const addButton = screen.getByRole("button", { name: "Add hard assignment" });
    await userEvent.click(addButton);
    await userEvent.click(addButton);

    await waitFor(() => {
      expect(container.querySelectorAll(".hardAssignmentRow").length).toBe(2);
      expect(screen.getByRole("button", { name: "Add hard assignment" })).toBeDisabled();
    });

    const removeButtons = screen.getAllByRole("button", { name: /Remove hard assignment for/i });
    await userEvent.click(removeButtons[0]!);

    await waitFor(() => {
      expect(container.querySelectorAll(".hardAssignmentRow").length).toBe(1);
      expect(screen.getByRole("button", { name: "Add hard assignment" })).not.toBeDisabled();
    });
  });

  it("cancels an in-flight optimization and preserves the last completed result", async () => {
    render(<App />);
    await screen.findByText("Endfield Dijiang Optimizer");

    const ownedToggles = await screen.findAllByRole("checkbox", { name: "Owned" });
    await userEvent.click(ownedToggles[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));

    act(() => {
      workerInstances[0]!.emit({
        type: "optimization-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-29/v1.1-phase2",
          totalScore: 77,
          projectedRecipeOutputs: {},
          projectedOutputs: {
            operator_exp: 0,
            weapon_exp: 0,
            fungal: 0,
            vitrified_plant: 0,
            rare_mineral: 0,
          },
          roomPlans: [],
          explanations: [],
          warnings: [],
          supportWeightsVersion: "test",
        },
      });
    });

    await screen.findByText("77.00");

    await userEvent.click(screen.getByRole("button", { name: "Optimize" }));
    await screen.findByRole("dialog", { name: "Optimization progress" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(workerInstances[1]!.terminate).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: "Optimization progress" })).not.toBeInTheDocument();
      expect(screen.getByText("Optimization canceled.")).toBeInTheDocument();
      expect(screen.getByText("77.00")).toBeInTheDocument();
    });
  });
});
