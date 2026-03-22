import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../../../catalogs/2026-03-20-v1.1-phase1/manifest.json";
import progression from "../../../catalogs/2026-03-20-v1.1-phase1/progression.json";
import operators from "../../../catalogs/2026-03-20-v1.1-phase1/operators.json";
import facilities from "../../../catalogs/2026-03-20-v1.1-phase1/facilities.json";
import recipes from "../../../catalogs/2026-03-20-v1.1-phase1/recipes.json";
import sources from "../../../catalogs/2026-03-20-v1.1-phase1/sources.json";
import gaps from "../../../catalogs/2026-03-20-v1.1-phase1/gaps.json";
import assets from "../../../catalogs/2026-03-20-v1.1-phase1/assets.json";

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
  ["/catalogs/2026-03-20-v1.1-phase1/manifest.json", manifest],
  ["/catalogs/2026-03-20-v1.1-phase1/progression.json", progression],
  ["/catalogs/2026-03-20-v1.1-phase1/operators.json", operators],
  ["/catalogs/2026-03-20-v1.1-phase1/facilities.json", facilities],
  ["/catalogs/2026-03-20-v1.1-phase1/recipes.json", recipes],
  ["/catalogs/2026-03-20-v1.1-phase1/sources.json", sources],
  ["/catalogs/2026-03-20-v1.1-phase1/gaps.json", gaps],
  ["/catalogs/2026-03-20-v1.1-phase1/assets.json", assets],
]);

describe("App", () => {
  const getOptimizationProfileSelect = () => screen.getByText("Optimization profile").closest("label")!.querySelector("select") as HTMLSelectElement;
  const getSearchEffortSlider = () => screen.getByText("Search effort").closest("label")!.querySelector('input[type="range"]') as HTMLInputElement;

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
          catalogVersion: "2026-03-20/v1.1-phase1",
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

    const roomHeading = screen.getAllByText("Manufacturing 1").find((element) => element.closest(".resultCard"));
    const roomCard = roomHeading?.closest(".resultCard");
    expect(roomCard).not.toBeNull();
    expect(within(roomCard!).getByRole("img", { name: "Chen Qianyu portrait" })).toBeInTheDocument();
    expect(within(roomCard!).getByRole("img", { name: "Xaihi portrait" })).toBeInTheDocument();
  });

  it("renders bundled operator portraits in the roster", async () => {
    render(<App />);

    const portrait = await screen.findByRole("img", { name: "Chen Qianyu portrait" });

    expect(portrait).toHaveAttribute(
      "src",
      "/catalogs/2026-03-20-v1.1-phase1/assets/operators/chen-qianyu.webp",
    );
    expect(portrait.closest(".avatar")).toHaveAttribute("data-rarity", "5");
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

    await userEvent.click(screen.getByRole("button", { name: "Recommend unlocks" }));

    act(() => {
      workerInstances[0]!.emit({
        type: "recommendations-completed",
        runId: 1,
        result: {
          catalogVersion: "2026-03-20/v1.1-phase1",
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
    expect(recommendationCard.closest(".resultCard")).not.toBeNull();
    expect(screen.getByAltText("Blade Critique icon")).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("tab", { name: /Planner/i }));
    const plannerPanel = screen.getByText("Dijiang layout").closest(".plannerPanel");
    expect(plannerPanel).not.toBeNull();
    const facilityHeadings = within(plannerPanel!).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(facilityHeadings.slice(0, 5)).toEqual([
      "Control Nexus",
      "Reception Room",
      "Manufacturing 1",
      "Manufacturing 2",
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
          catalogVersion: "2026-03-20/v1.1-phase1",
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
          catalogVersion: "2026-03-20/v1.1-phase1",
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
    const badgeImage = within(recommendationCard).getByAltText("Blade Critique icon");
    const expectedOverlay = badge.getAttribute("aria-label")?.includes("GAMMA")
      ? "\u03b3"
      : badge.getAttribute("aria-label")?.includes("ALPHA")
        ? "\u03b1"
        : "\u03b2";

    fireEvent.error(badgeImage);

    await waitFor(() => {
      expect(within(recommendationCard).queryByAltText("Blade Critique icon")).not.toBeInTheDocument();
      expect(badge).toHaveClass("fallback");
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
      catalogVersion: "2026-03-20/v1.1-phase1",
      roster: [],
      facilities: {
        controlNexus: { level: 3 },
        manufacturingCabins: [{ id: "mfg-1", enabled: true, level: 2, fixedRecipeId: "elementary-cognitive-carrier" }],
        growthChambers: [],
        receptionRoom: { id: "reception-1", enabled: true, level: 1 },
        hardAssignments: [],
      },
      options: {
        planningMode: "simple",
        horizonHours: 24,
        maxFacilities: false,
        includeReceptionRoom: true,
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

  it("normalizes older drafts so the second manufacturing cabin is visible and keeps optimization effort", async () => {
    localStorage.setItem(
      "endfield-dijiang-optimizer:draft",
      JSON.stringify({
        scenarioFormatVersion: 1,
        catalogVersion: "2026-03-20/v1.1-phase1",
        roster: [],
        facilities: {
          controlNexus: { level: 5 },
          manufacturingCabins: [{ id: "mfg-1", enabled: true, level: 3, fixedRecipeId: "advanced-cognitive-carrier" }],
          growthChambers: [],
          hardAssignments: [],
        },
        options: {
          planningMode: "simple",
          horizonHours: 24,
          maxFacilities: false,
          includeReceptionRoom: true,
          upgradeRankingMode: "balanced",
          optimizationProfile: "thorough",
          optimizationEffort: 14,
        },
      }),
    );

    render(<App />);

    await screen.findByText("Endfield Dijiang Optimizer");
    await userEvent.click(screen.getByRole("tab", { name: /Planner/i }));

    await waitFor(() => {
      expect(screen.getByText("Manufacturing 2")).toBeInTheDocument();
      expect(getOptimizationProfileSelect()).toHaveValue("thorough");
      expect(getSearchEffortSlider()).toHaveValue("14");
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
          catalogVersion: "2026-03-20/v1.1-phase1",
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
