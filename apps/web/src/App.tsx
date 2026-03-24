import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  DemandProfilePreset,
  GameCatalog,
  OptimizationProfile,
  OptimizationResult,
  OptimizationScenario,
  ProductKind,
  SkillRank,
  UpgradeRecommendationResult,
} from "@endfield/domain";

import {
  CURRENT_CATALOG_VERSION,
  DEMAND_PROFILE_PRESETS,
  clampDemandWeight,
  createStarterScenario,
  createDefaultDemandProfile,
  fetchGameCatalog,
  getFacilityLevelCapForControlNexus,
  getGrowthSlotCap,
  getRoomSlotCap,
  getUnlockedFacilityRoomCount,
  hydrateScenarioForCatalog,
  migrateScenario,
  validateScenarioAgainstCatalog,
} from "@endfield/data";
import {
  DEFAULT_OPTIMIZATION_EFFORT,
  DEFAULT_OPTIMIZATION_PROFILE,
  MAX_OPTIMIZATION_EFFORT,
  OPTIMIZATION_PROFILE_EFFORTS,
  clampOptimizationEffort,
  getOptimizationSearchConfig,
} from "@endfield/optimizer";

import { createOptimizerWorker } from "./optimizer.worker.client";
import type { OptimizerWorkerResponse } from "./optimizer-worker-types";
import type {
  OptimizationProgressSnapshot,
  UpgradeRecommendationProgressSnapshot,
} from "@endfield/optimizer";

const DRAFT_KEY = "endfield-dijiang-optimizer:draft";
const OPTIMIZATION_PROFILES: Exclude<OptimizationProfile, "custom">[] = ["fast", "balanced", "thorough", "exhaustive"];
const DEMAND_WEIGHT_ORDER: ProductKind[] = [
  "operator_exp",
  "weapon_exp",
  "fungal",
  "vitrified_plant",
  "rare_mineral",
];

type AppTab = "roster" | "planner" | "results";

interface OptimizationRunState {
  runId: number;
  startedAt: number;
  progress: OptimizationProgressSnapshot;
}

interface RecommendationRunState {
  runId: number;
  startedAt: number;
  progress: UpgradeRecommendationProgressSnapshot;
}

type HardAssignment = OptimizationScenario["facilities"]["hardAssignments"][number];
type RosterEntry = OptimizationScenario["roster"][number];

function sanitizeScenarioForPersistence(scenario: OptimizationScenario): OptimizationScenario {
  return {
    ...scenario,
    facilities: {
      ...scenario.facilities,
      hardAssignments: scenario.facilities.hardAssignments.map((assignment) => ({
        operatorId: assignment.operatorId,
        roomId: assignment.roomId,
      })),
    },
  };
}

function replaceRosterEntry(
  scenario: OptimizationScenario,
  operatorId: string,
  updater: (entry: OptimizationScenario["roster"][number]) => OptimizationScenario["roster"][number],
) {
  return { ...scenario, roster: scenario.roster.map((entry) => (entry.operatorId === operatorId ? updater(entry) : entry)) };
}

function formatLabel(value: string): string {
  return value.split(/[_-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatCosts(costs: Array<{ itemId: string; quantity: number }>): string {
  return costs.length > 0 ? costs.map((cost) => `${cost.quantity}x ${cost.itemId}`).join(", ") : "No material cost recorded";
}

function getRecommendationExtraNotes(
  recommendation: UpgradeRecommendationResult["recommendations"][number],
  operatorName?: string,
): string[] {
  return recommendation.notes.filter((note) => {
    if (note === recommendation.action.unlockHint) {
      return false;
    }
    if (operatorName && note === `Operator: ${operatorName}`) {
      return false;
    }
    if (note.startsWith("Requires ")) {
      return false;
    }
    if (note.startsWith("Leveling materials:") || note.startsWith("Upper-bound leveling materials:")) {
      return false;
    }
    if (note.startsWith("Includes promotion materials:")) {
      return false;
    }
    if (note.startsWith("Includes Base Skill node materials:")) {
      return false;
    }
    return true;
  });
}

function formatDurationMinutes(value: number | undefined): string {
  return value == null ? "Duration not recorded" : `${(value / 60).toFixed(1)}h`;
}

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function compareOperatorsByDefaultOrder(
  left: GameCatalog["operators"][number],
  right: GameCatalog["operators"][number],
): number {
  if (left.rarity !== right.rarity) {
    return right.rarity - left.rarity;
  }

  return left.name.localeCompare(right.name);
}

function getCatalogAssetUrl(catalog: GameCatalog, assetPath: string): string {
  if (/^https?:\/\//.test(assetPath)) {
    return assetPath;
  }

  return `/catalogs/${catalog.manifest.catalogId}/${assetPath.replace(/^\/+/, "")}`;
}

function getOperatorPortraitUrl(
  catalog: GameCatalog,
  operator: GameCatalog["operators"][number],
): string | undefined {
  const portrait = operator.images.find((image) => image.kind === "portrait");
  return portrait ? getCatalogAssetUrl(catalog, portrait.path) : undefined;
}

function getBaseSkillIconUrl(
  catalog: GameCatalog,
  skill: GameCatalog["operators"][number]["baseSkills"][number],
): string | undefined {
  return skill.icon ? getCatalogAssetUrl(catalog, skill.icon.path) : undefined;
}

function getPromotionTierLabel(promotionTier: 0 | 1 | 2 | 3 | 4): string {
  return promotionTier === 0 ? "Base" : `Elite ${promotionTier}`;
}

function getSkillRankLabel(
  skill: GameCatalog["operators"][number]["baseSkills"][number],
  rank: SkillRank,
): string {
  if (rank === 0) {
    return "Locked";
  }

  return skill.ranks.find((entry) => entry.rank === rank)?.label.toUpperCase() ?? `RANK ${rank}`;
}

function getSkillBadgeLabel(
  skill: GameCatalog["operators"][number]["baseSkills"][number],
  rank: SkillRank,
): string {
  if (rank === 0) {
    return "-";
  }

  const label = skill.ranks.find((entry) => entry.rank === rank)?.label;
  switch (label) {
    case "alpha":
      return "\u03b1";
    case "beta":
      return "\u03b2";
    case "gamma":
      return "\u03b3";
    default:
      return getSkillRankLabel(skill, rank).charAt(0).toLowerCase();
  }
}

function getSkillBadgeTitle(
  skill: GameCatalog["operators"][number]["baseSkills"][number],
  rank: SkillRank,
): string {
  return `${skill.name}: ${getSkillRankLabel(skill, rank)}`;
}

function SkillIconBadge(
  {
    catalog,
    skill,
    rank,
    className,
    showOverlay = true,
    hideWhenLocked = false,
  }: {
    catalog: GameCatalog;
    skill: GameCatalog["operators"][number]["baseSkills"][number];
    rank: SkillRank;
    className?: string;
    showOverlay?: boolean;
    hideWhenLocked?: boolean;
  },
) {
  if (hideWhenLocked && rank === 0) {
    return null;
  }

  const iconUrl = getBaseSkillIconUrl(catalog, skill);
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={`skillBadge ${rank > 0 ? "unlocked" : "locked"} ${failed || !iconUrl ? "fallback" : "withIcon"} ${showOverlay ? "" : "plain"} ${className ?? ""}`.trim()}
      title={getSkillBadgeTitle(skill, rank)}
      aria-label={getSkillBadgeTitle(skill, rank)}
    >
      {iconUrl && !failed && (
        <img
          className="skillBadgeImage"
          src={iconUrl}
          alt={`${skill.name} icon`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      {showOverlay && <span className="skillBadgeOverlay">{getSkillBadgeLabel(skill, rank)}</span>}
    </span>
  );
}

function OperatorPortrait(
  {
    catalog,
    operator,
    className,
  }: {
    catalog: GameCatalog;
    operator: GameCatalog["operators"][number];
    className?: string;
  },
) {
  const portraitUrl = getOperatorPortraitUrl(catalog, operator);
  const [failed, setFailed] = useState(false);

  return (
    <div className={`avatar ${className ?? ""}`.trim()} data-rarity={operator.rarity}>
      {portraitUrl && !failed
        ? (
            <img
              className="avatarImage"
              src={portraitUrl}
              alt={`${operator.name} portrait`}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          )
        : <span>{getInitials(operator.name)}</span>}
    </div>
  );
}

function OperatorChip(
  {
    catalog,
    operator,
    fallbackLabel,
    meta,
  }: {
    catalog: GameCatalog;
    operator?: GameCatalog["operators"][number];
    fallbackLabel: string;
    meta?: ReactNode;
  },
) {
  const displayName = operator?.name ?? fallbackLabel;

  return (
    <div className="operatorChip">
      {operator
        ? <OperatorPortrait catalog={catalog} operator={operator} />
        : <div className="avatar"><span>{getInitials(displayName)}</span></div>}
      <div className="operatorChipCopy">
        <strong>{displayName}</strong>
        {meta && <div className="operatorChipMeta">{meta}</div>}
      </div>
    </div>
  );
}

function summarizeHydration(hydration: ReturnType<typeof hydrateScenarioForCatalog>): string[] {
  if (!hydration.hydrated) {
    return [];
  }
  const messages: string[] = [];
  if (hydration.stats.addedOperators > 0) {
    messages.push(`Expanded the draft with ${hydration.stats.addedOperators} missing operator entr${hydration.stats.addedOperators === 1 ? "y" : "ies"} from the active catalog.`);
  }
  if (hydration.stats.addedBaseSkillStates > 0) {
    messages.push(`Added ${hydration.stats.addedBaseSkillStates} missing Base Skill state${hydration.stats.addedBaseSkillStates === 1 ? "" : "s"} from the active catalog.`);
  }
  if (hydration.stats.preservedUnknownOperators > 0) {
    messages.push(`Preserved ${hydration.stats.preservedUnknownOperators} roster entr${hydration.stats.preservedUnknownOperators === 1 ? "y" : "ies"} that are not in the active catalog.`);
  }
  return messages;
}

function describeSkill(skill: GameCatalog["operators"][number]["baseSkills"][number]): string {
  return skill.ranks.map((rank) => {
    const modifiers = rank.modifiers.map((modifier) => `${formatLabel(modifier.metric)} +${modifier.value}% (${formatLabel(modifier.appliesTo)})`);
    return `${rank.label.toUpperCase()}: ${modifiers.join(", ") || "No active modifier"}`;
  }).join(" / ");
}

function getRankLabel(
  skill: GameCatalog["operators"][number]["baseSkills"][number],
  rank: 1 | 2,
): string {
  const label = skill.ranks.find((entry) => entry.rank === rank)?.label;
  if (!label) {
    return `Rank ${rank} (${getSkillBadgeLabel(skill, rank)})`;
  }

  return `${label.charAt(0).toUpperCase()}${label.slice(1)} (${getSkillBadgeLabel(skill, rank)})`;
}

function getCanonicalEffortForProfile(profile: Exclude<OptimizationProfile, "custom">): number {
  return OPTIMIZATION_PROFILE_EFFORTS[profile];
}

function getScenarioSearchConfig(scenario: OptimizationScenario) {
  const profile = scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE;
  const fallbackEffort = profile === "custom"
    ? DEFAULT_OPTIMIZATION_EFFORT
    : getCanonicalEffortForProfile(profile);
  const effort = clampOptimizationEffort(scenario.options.optimizationEffort ?? fallbackEffort);

  return getOptimizationSearchConfig(profile, effort);
}

function getAvailableHardAssignmentOperatorIds(
  ownedOperators: RosterEntry[],
  hardAssignments: HardAssignment[],
  currentIndex: number,
): string[] {
  const selectedElsewhere = new Set(
    hardAssignments
      .filter((_, index) => index !== currentIndex)
      .map((assignment) => assignment.operatorId)
      .filter(Boolean),
  );

  return ownedOperators
    .filter((entry) => !selectedElsewhere.has(entry.operatorId))
    .map((entry) => entry.operatorId);
}

function getNextHardAssignmentOperatorId(
  ownedOperators: RosterEntry[],
  hardAssignments: HardAssignment[],
): string | null {
  const assignedOperatorIds = new Set(hardAssignments.map((assignment) => assignment.operatorId).filter(Boolean));
  return ownedOperators.find((entry) => !assignedOperatorIds.has(entry.operatorId))?.operatorId ?? null;
}

function formatElapsedTime(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getOptimizationProfileSummary(profile: OptimizationProfile): string {
  switch (profile) {
    case "fast":
      return "Quickest estimate";
    case "balanced":
      return "Recommended default";
    case "thorough":
      return "Searches more assignments";
    case "exhaustive":
      return "Slowest; may still stop at the search budget";
    case "custom":
      return "Custom search budget";
  }
}

function getUpgradeRankingModeSummary(mode: "balanced" | "roi" | "fastest"): string {
  switch (mode) {
    case "balanced":
      return "For Recommend unlocks: sort by score gain first, then ROI, then estimated time.";
    case "roi":
      return "For Recommend unlocks: sort by payoff per effort spent.";
    case "fastest":
      return "For Recommend unlocks: sort by shortest estimated unlock time, then impact.";
  }
}

function getDemandProfileSummary(preset: DemandProfilePreset): string {
  switch (preset) {
    case "balanced":
      return "General long-run value across all current output types.";
    case "operator_exp":
      return "Favor Operator EXP rooms and operator-exp recipes.";
    case "weapon_exp":
      return "Favor Weapon EXP rooms and weapon-exp recipes.";
    case "growth":
      return "Favor Growth Chamber outputs across all material families.";
    case "fungal":
      return "Favor operator-promotion fungi such as Pink, Red, Ruby, and Bloodcap.";
    case "vitrified_plant":
      return "Favor vitrified plant recipes and related Growth Chamber value.";
    case "rare_mineral":
      return "Favor rare minerals such as Kalkonyx, Auronyx, Umbronyx, Igneosite, and Wulingstone.";
    case "reception":
      return "Favor Reception Room support value and clue-driven utility.";
    case "custom":
      return "Use the sliders below to define your own objective mix.";
  }
}

function formatWeight(value: number): string {
  return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}x`;
}

function App() {
  const [catalog, setCatalog] = useState<GameCatalog | null>(null);
  const [scenario, setScenario] = useState<OptimizationScenario | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [recommendations, setRecommendations] = useState<UpgradeRecommendationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [optimizationRun, setOptimizationRun] = useState<OptimizationRunState | null>(null);
  const [recommendationRun, setRecommendationRun] = useState<RecommendationRunState | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activeTab, setActiveTab] = useState<AppTab>("roster");
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const activeRunIdRef = useRef<number | null>(null);
  const activeRunKindRef = useRef<"optimization" | "recommendations" | null>(null);
  const nextRunIdRef = useRef(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextCatalog = await fetchGameCatalog();
        if (cancelled) {
          return;
        }

        const savedDraft = localStorage.getItem(DRAFT_KEY);
        if (!savedDraft) {
          setCatalog(nextCatalog);
          setScenario(createStarterScenario(nextCatalog));
          return;
        }

        const migration = migrateScenario(JSON.parse(savedDraft));
        const hydration = hydrateScenarioForCatalog(nextCatalog, migration.scenario);
        setCatalog(nextCatalog);
        setScenario(hydration.scenario);
        setMessages([
          ...(migration.migrated ? [`Loaded local draft and migrated it from format ${migration.fromFormatVersion} to ${migration.toFormatVersion}.`] : []),
          ...summarizeHydration(hydration),
          ...migration.warnings.map((issue) => issue.message),
        ]);
      } catch (error) {
        if (!cancelled) {
          setMessages([error instanceof Error ? error.message : "Failed to load the bundled catalog or local draft."]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scenario) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(sanitizeScenarioForPersistence(scenario)));
    }
  }, [scenario]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    activeRunIdRef.current = null;
    activeRunKindRef.current = null;
  }, []);

  useEffect(() => {
    if (!catalog || !scenario) {
      return;
    }

    const hydration = hydrateScenarioForCatalog(catalog, scenario);
    if (!hydration.hydrated) {
      return;
    }

    setScenario(hydration.scenario);
    setMessages((current) => [...summarizeHydration(hydration), ...current]);
  }, [catalog, scenario]);

  useEffect(() => {
    setResult(null);
    setRecommendations(null);
  }, [scenario]);

  useEffect(() => {
    const activeRun = optimizationRun ?? recommendationRun;
    if (!activeRun) {
      setElapsedMs(0);
      return;
    }

    setElapsedMs(Date.now() - activeRun.startedAt);
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - activeRun.startedAt);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [optimizationRun, recommendationRun]);

  const deferredSearch = useDeferredValue(search);

  const sortedOperators = useMemo(
    () => [...(catalog?.operators ?? [])].sort(compareOperatorsByDefaultOrder),
    [catalog],
  );
  const operatorsById = useMemo(() => new Map(catalog?.operators.map((operator) => [operator.id, operator]) ?? []), [catalog]);
  const rosterById = useMemo(() => new Map(scenario?.roster.map((entry) => [entry.operatorId, entry]) ?? []), [scenario]);
  const recipesById = useMemo(() => new Map(catalog?.recipes.map((recipe) => [recipe.id, recipe]) ?? []), [catalog]);
  const priorityRecipeOptions = useMemo(
    () => [...(catalog?.recipes ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [catalog],
  );
  const facilitiesByKind = useMemo(() => new Map(catalog?.facilities.map((facility) => [facility.kind, facility]) ?? []), [catalog]);

  useEffect(() => {
    if (sortedOperators.length === 0) {
      setSelectedOperatorId(null);
      return;
    }

    setSelectedOperatorId((current) => {
      if (current && operatorsById.has(current)) {
        return current;
      }

      return sortedOperators[0]?.id ?? null;
    });
  }, [operatorsById, sortedOperators]);

  const filteredOperators = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    return sortedOperators
      .filter((operator) => !needle || operator.name.toLowerCase().includes(needle) || operator.id.includes(needle))
      .map((operator) => ({ operator, owned: rosterById.get(operator.id) }));
  }, [deferredSearch, rosterById, sortedOperators]);

  if (loading || !catalog || !scenario) {
    return <main className="shell"><p className="status">Loading bundled catalog...</p></main>;
  }

  const validation = validateScenarioAgainstCatalog(catalog, scenario);
  const ownedOperators = scenario.roster.filter((entry) => entry.owned);
  const unlockedManufacturingRoomCount = getUnlockedFacilityRoomCount("manufacturing_cabin", scenario.facilities.controlNexus.level);
  const unlockedGrowthRoomCount = getUnlockedFacilityRoomCount("growth_chamber", scenario.facilities.controlNexus.level);
  const unlockedReceptionRoomCount = getUnlockedFacilityRoomCount("reception_room", scenario.facilities.controlNexus.level);
  const manufacturingLevelCap = getFacilityLevelCapForControlNexus("manufacturing_cabin", scenario.facilities.controlNexus.level);
  const growthLevelCap = getFacilityLevelCapForControlNexus("growth_chamber", scenario.facilities.controlNexus.level);
  const receptionLevelCap = getFacilityLevelCapForControlNexus("reception_room", scenario.facilities.controlNexus.level);
  const roomOptions = [
    { id: "control_nexus", label: "Control Nexus" },
    ...(scenario.facilities.receptionRoom ? [{ id: scenario.facilities.receptionRoom.id, label: "Reception Room" }] : []),
    ...scenario.facilities.manufacturingCabins.map((room, index) => ({ id: room.id, label: `Manufacturing Cabin ${index + 1}` })),
    ...scenario.facilities.growthChambers.map((room, index) => ({ id: room.id, label: `Growth Chamber ${index + 1}` })),
  ];
  const nextHardAssignmentOperatorId = getNextHardAssignmentOperatorId(ownedOperators, scenario.facilities.hardAssignments);
  const roomLabelById = new Map(roomOptions.map((room) => [room.id, room.label]));
  const roomOrderById = new Map(roomOptions.map((room, index) => [room.id, index]));
  const orderedResultRoomPlans = result
    ? [...result.roomPlans].sort((left, right) => {
      const leftOrder = roomOrderById.get(left.roomId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = roomOrderById.get(right.roomId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    })
    : [];
  const projectedOutputEntries = result
    ? Object.entries(result.projectedOutputs).filter(([, value]) => value > 0)
    : [];
  const recommendationEntries = recommendations?.recommendations ?? [];
  const optimizationSearchWarning = result?.warnings.find((warning) => warning.startsWith("Optimization search stopped"));
  const secondaryResultWarnings = result?.warnings.filter((warning) => warning !== optimizationSearchWarning) ?? [];
  const selectedOperator = selectedOperatorId ? operatorsById.get(selectedOperatorId) : sortedOperators[0];
  const selectedOwnedState = selectedOperator ? rosterById.get(selectedOperator.id) : undefined;
  const completedResultsCount = (result ? 1 : 0) + (recommendations ? 1 : 0);
  const demandProfile = scenario.options.demandProfile ?? createDefaultDemandProfile();

  const updateScenario = (updater: (current: OptimizationScenario) => OptimizationScenario) => {
    setScenario((current) => (current ? updater(current) : current));
  };

  const updateDemandProfile = (
    updater: (
      current: NonNullable<OptimizationScenario["options"]["demandProfile"]>,
    ) => NonNullable<OptimizationScenario["options"]["demandProfile"]>,
  ) => {
    updateScenario((current) => ({
      ...current,
      options: {
        ...current.options,
        demandProfile: updater(current.options.demandProfile ?? createDefaultDemandProfile()),
      },
    }));
  };

  const setOptimizationProfile = (profile: OptimizationProfile) => {
    updateScenario((current) => ({
      ...current,
      options: {
        ...current.options,
        optimizationProfile: profile,
        optimizationEffort: profile === "custom"
          ? clampOptimizationEffort(current.options.optimizationEffort ?? DEFAULT_OPTIMIZATION_EFFORT)
          : getCanonicalEffortForProfile(profile),
      },
    }));
  };

  const setOptimizationEffort = (effort: number) => {
    const clampedEffort = clampOptimizationEffort(effort);
    const matchingProfile = OPTIMIZATION_PROFILES.find(
      (profile) => getCanonicalEffortForProfile(profile) === clampedEffort,
    );

    updateScenario((current) => ({
      ...current,
      options: {
        ...current.options,
        optimizationEffort: clampedEffort,
        optimizationProfile: matchingProfile ?? "custom",
      },
    }));
  };

  const setDemandPreset = (preset: DemandProfilePreset) => {
    updateDemandProfile((current) => ({
      ...current,
      preset,
    }));
  };

  const setDemandWeight = (productKind: ProductKind, weight: number) => {
    updateDemandProfile((current) => ({
      ...current,
      productWeights: {
        ...current.productWeights,
        [productKind]: clampDemandWeight(weight),
      },
    }));
  };

  const setReceptionDemandWeight = (weight: number) => {
    updateDemandProfile((current) => ({
      ...current,
      receptionWeight: clampDemandWeight(weight),
    }));
  };

  const setPriorityRecipeId = (priorityRecipeId: string) => {
    updateDemandProfile((current) => ({
      ...current,
      priorityRecipeId: priorityRecipeId || undefined,
    }));
  };

  const stopActiveWorker = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    activeRunIdRef.current = null;
    activeRunKindRef.current = null;
  };

  const runOptimization = () => {
    const nextValidation = validateScenarioAgainstCatalog(catalog, scenario);
    if (!nextValidation.ok) {
      setMessages(nextValidation.issues.map((issue) => issue.message));
      return;
    }

    stopActiveWorker();

    const runId = nextRunIdRef.current;
    nextRunIdRef.current += 1;
    const searchConfig = getScenarioSearchConfig(scenario);
    const worker = createOptimizerWorker();
    workerRef.current = worker;
    activeRunIdRef.current = runId;
    activeRunKindRef.current = "optimization";

    const startingProgress: OptimizationProgressSnapshot = {
      phase: "Queueing optimization",
      visitedNodes: 0,
      totalSlots: 0,
      currentDepth: 0,
      bestScore: 0,
      maxBranchCandidatesPerSlot: searchConfig.maxBranchCandidatesPerSlot,
      profileLabel: searchConfig.profileLabel,
      effort: searchConfig.effort,
      maxVisitedNodes: searchConfig.maxVisitedNodes,
    };
    setOptimizationRun({
      runId,
      startedAt: Date.now(),
      progress: startingProgress,
    });
    setRecommendationRun(null);

    worker.onmessage = (event: MessageEvent<OptimizerWorkerResponse>) => {
      const message = event.data;
      if (message.runId !== activeRunIdRef.current) {
        return;
      }

      if (message.type === "optimization-started" || message.type === "optimization-progress") {
        setOptimizationRun((current) => current && current.runId === message.runId
          ? { ...current, progress: message.progress }
          : current);
        return;
      }

      if (message.type === "optimization-completed") {
        stopActiveWorker();
        setOptimizationRun(null);
        setMessages(message.result.warnings);
        setResult(message.result);
        setActiveTab("results");
        return;
      }

      if (message.type === "recommendations-started" || message.type === "recommendations-progress") {
        setRecommendationRun((current) => current && current.runId === message.runId
          ? { ...current, progress: message.progress }
          : current);
        return;
      }

      if (message.type === "recommendations-completed") {
        stopActiveWorker();
        setRecommendationRun(null);
        setRecommendations(message.result);
        setMessages([]);
        setActiveTab("results");
        return;
      }

      if (message.type === "canceled") {
        const runKind = activeRunKindRef.current;
        stopActiveWorker();
        setOptimizationRun(null);
        setRecommendationRun(null);
        setMessages([runKind === "recommendations" ? "Recommendations canceled." : "Optimization canceled."]);
        return;
      }

      stopActiveWorker();
      setOptimizationRun(null);
      setRecommendationRun(null);
      setMessages(["message" in message ? message.message : "Optimization failed."]);
    };

    worker.postMessage({ type: "start-optimization", runId, catalog, scenario, searchConfig });
  };

  const cancelOptimization = () => {
    const runId = activeRunIdRef.current;
    const runKind = activeRunKindRef.current;
    if (runId == null) {
      return;
    }

    workerRef.current?.postMessage({ type: "cancel", runId });
    stopActiveWorker();
    setOptimizationRun(null);
    setRecommendationRun(null);
    setMessages([runKind === "recommendations" ? "Recommendations canceled." : "Optimization canceled."]);
  };

  const runRecommendations = () => {
    const nextValidation = validateScenarioAgainstCatalog(catalog, scenario);
    if (!nextValidation.ok) {
      setMessages(nextValidation.issues.map((issue) => issue.message));
      return;
    }

    stopActiveWorker();

    const runId = nextRunIdRef.current;
    nextRunIdRef.current += 1;
    const worker = createOptimizerWorker();
    workerRef.current = worker;
    activeRunIdRef.current = runId;
    activeRunKindRef.current = "recommendations";

    setRecommendationRun({
      runId,
      startedAt: Date.now(),
      progress: {
        phase: "Queueing recommendations",
        completedCandidates: 0,
        totalCandidates: 0,
        baselineScore: 0,
        bestScoreDelta: 0,
      },
    });
    setOptimizationRun(null);

    worker.onmessage = (event: MessageEvent<OptimizerWorkerResponse>) => {
      const message = event.data;
      if (message.runId !== activeRunIdRef.current) {
        return;
      }

      if (message.type === "recommendations-started" || message.type === "recommendations-progress") {
        setRecommendationRun((current) => current && current.runId === message.runId
          ? { ...current, progress: message.progress }
          : current);
        return;
      }

      if (message.type === "recommendations-completed") {
        stopActiveWorker();
        setRecommendationRun(null);
        setRecommendations(message.result);
        setMessages([]);
        setActiveTab("results");
        return;
      }

      if (message.type === "canceled") {
        stopActiveWorker();
        setRecommendationRun(null);
        setMessages(["Recommendations canceled."]);
        return;
      }

      if (message.type === "optimization-started" || message.type === "optimization-progress") {
        return;
      }

      stopActiveWorker();
      setRecommendationRun(null);
      setMessages(["message" in message ? message.message : "Recommendations failed."]);
    };

    worker.postMessage({ type: "start-recommendations", runId, catalog, scenario });
  };

  const exportScenario = () => {
    const blob = new Blob([JSON.stringify(sanitizeScenarioForPersistence(scenario), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "dijiang-scenario.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importScenario = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const migration = migrateScenario(JSON.parse(await file.text()));
      const hydration = hydrateScenarioForCatalog(catalog, migration.scenario);
      setScenario(hydration.scenario);
      setMessages([
        migration.migrated ? `Imported scenario and migrated it from format ${migration.fromFormatVersion} to ${migration.toFormatVersion}.` : "Imported scenario.",
        ...summarizeHydration(hydration),
        ...migration.warnings.map((issue) => issue.message),
      ]);
    } catch (error) {
      setMessages([error instanceof Error ? error.message : "Failed to import scenario JSON."]);
    } finally {
      event.target.value = "";
    }
  };

  const tabOptions: Array<{ id: AppTab; label: string; detail: string }> = [
    { id: "roster", label: "Roster", detail: `${ownedOperators.length} owned` },
    { id: "planner", label: "Planner", detail: `${roomOptions.length} rooms` },
    { id: "results", label: "Results", detail: completedResultsCount > 0 ? `${completedResultsCount} pane${completedResultsCount === 1 ? "" : "s"} ready` : "Waiting to run" },
  ];

  return (
    <main className="shell">
      <header className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Local-first optimizer</p>
          <h1>Endfield Dijiang Optimizer</h1>
          <p className="lede">The editor now uses a tabbed workspace and a portrait-driven roster so you can configure operators without the roster dominating the page.</p>
          <div className="heroStats">
            <article><span>Catalog</span><strong>{CURRENT_CATALOG_VERSION}</strong></article>
            <article><span>Game version</span><strong>{catalog.manifest.gameVersion}</strong></article>
            <article><span>Snapshot</span><strong>{catalog.manifest.snapshotDate}</strong></article>
            <article><span>Operators</span><strong>{catalog.operators.length}</strong></article>
          </div>
        </div>
        <div className="heroPanel">
          <div className="heroMetaGrid">
            <div><span>Owned</span><strong>{ownedOperators.length}</strong></div>
            <div><span>Recipes</span><strong>{catalog.recipes.length}</strong></div>
            <div><span>Sources</span><strong>{catalog.sources.length}</strong></div>
            <div><span>Gaps</span><strong>{catalog.gaps.length}</strong></div>
          </div>
        </div>
      </header>

      <section className="toolbar">
        <div className="toolbarGrid">
          <label className="pill compact toolbarField toolbarFieldProfile">
            <span>Optimization profile</span>
            <select value={scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE} onChange={(event) => setOptimizationProfile(event.target.value as OptimizationProfile)}>
              {OPTIMIZATION_PROFILES.map((profile) => <option key={profile} value={profile}>{formatLabel(profile)}</option>)}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="pill rangePill toolbarField toolbarFieldEffort">
            <span>Search effort</span>
            <input
              type="range"
              min={1}
              max={MAX_OPTIMIZATION_EFFORT}
              value={clampOptimizationEffort(scenario.options.optimizationEffort ?? DEFAULT_OPTIMIZATION_EFFORT)}
              onChange={(event) => setOptimizationEffort(Number(event.target.value))}
            />
            <strong>{clampOptimizationEffort(scenario.options.optimizationEffort ?? DEFAULT_OPTIMIZATION_EFFORT)}/{MAX_OPTIMIZATION_EFFORT}</strong>
            <small>{getOptimizationProfileSummary(scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE)}</small>
          </label>
          <label className="pill toolbarField toolbarFieldDemand">
            <span className="labelWithHelp">
              <span>Demand profile</span>
              <span
                className="helpBadge"
                role="img"
                aria-label={`Controls which long-run outputs the score model favors. Current mode: ${formatLabel(demandProfile.preset)}.`}
                title={"Controls which long-run outputs the score model favors.\n\nBalanced keeps a general objective.\nOther presets favor a specific output family.\nCustom unlocks direct per-output weight sliders.\n\nThis changes score weighting only. Projected outputs remain raw units per hour."}
              >
                ?
              </span>
            </span>
            <select value={demandProfile.preset} onChange={(event) => setDemandPreset(event.target.value as DemandProfilePreset)}>
              {DEMAND_PROFILE_PRESETS.map((preset) => <option key={preset} value={preset}>{formatLabel(preset)}</option>)}
            </select>
            <small>{getDemandProfileSummary(demandProfile.preset)}</small>
          </label>
          <label className="pill toolbarField toolbarFieldRanking">
            <span className="labelWithHelp">
              <span>Recommend Unlocks Ranking</span>
              <span
                className="helpBadge"
                role="img"
                aria-label={`Controls how Recommend unlocks sorts results. Balanced ranks by score gain first, then ROI, then estimated time. ROI ranks by payoff per effort. Fastest ranks by estimated unlock time first. Current mode: ${formatLabel(scenario.options.upgradeRankingMode ?? "balanced")}.`}
                title={`Controls how Recommend unlocks sorts results.\n\nBalanced: highest score gain first, then ROI, then estimated time.\nROI: best payoff per effort.\nFastest: quickest estimated unlock first, then impact.`}
              >
                ?
              </span>
            </span>
            <select
              value={scenario.options.upgradeRankingMode ?? "balanced"}
              onChange={(event) => updateScenario((current) => ({
                ...current,
                options: {
                  ...current.options,
                  upgradeRankingMode: event.target.value as "fastest" | "roi" | "balanced",
                },
              }))}
            >
              <option value="balanced">Balanced</option>
              <option value="roi">ROI</option>
              <option value="fastest">Fastest</option>
            </select>
            <small>{getUpgradeRankingModeSummary(scenario.options.upgradeRankingMode ?? "balanced")}</small>
          </label>
          <label className="pill compact toolbarField toolbarFieldPriorityRecipe">
            <span className="labelWithHelp">
              <span>Priority recipe</span>
              <span
                className="helpBadge"
                role="img"
                aria-label={`Boost one exact recipe when you care about a specific material. Current recipe: ${demandProfile.priorityRecipeId ? (catalog.recipes.find((recipe) => recipe.id === demandProfile.priorityRecipeId)?.name ?? demandProfile.priorityRecipeId) : "None"}.`}
                title={"Boost one exact recipe when you care about a specific material.\n\nExamples: Kalkonyx, Bloodcap, Advanced Combat Record, or Arms INSP Set.\n\nThis changes score weighting only. It does not force a recipe plan or alter raw projected output rates."}
              >
                ?
              </span>
            </span>
            <select
              value={demandProfile.priorityRecipeId ?? ""}
              onChange={(event) => setPriorityRecipeId(event.target.value)}
            >
              <option value="">None</option>
              {priorityRecipeOptions.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name} ({formatLabel(recipe.productKind)})
                </option>
              ))}
            </select>
            <small>Boost a single exact recipe on top of the broader demand profile.</small>
          </label>
          <label className="toggle toolbarField toolbarFieldOverlay">
            <input
              type="checkbox"
              checked={scenario.options.maxFacilities}
              onChange={(event) => updateScenario((current) => ({
                ...current,
                options: {
                  ...current.options,
                  maxFacilities: event.target.checked,
                },
              }))}
            />
            <span className="labelWithHelp">
              <span>Max facilities overlay</span>
              <span
                className="helpBadge"
                role="img"
                aria-label="When enabled, optimization assumes a fully built base overlay: Control Nexus level 5, all manufacturing and growth rooms enabled at level 3, and a level 3 reception room added or enabled. This affects optimization and recommend unlocks inputs, but does not rewrite the planner form."
                title={"When enabled, optimization assumes a fully built base overlay.\n\nControl Nexus is treated as level 5.\nAll manufacturing and growth rooms are treated as enabled at level 3.\nA level 3 reception room is added or enabled.\n\nThis affects Optimize and Recommend unlocks inputs, but does not rewrite the planner form."}
              >
                ?
              </span>
            </span>
          </label>
        </div>
        <div className="toolbarActions">
          <button onClick={runOptimization} disabled={optimizationRun != null || recommendationRun != null}>Optimize</button>
          <button className="secondary" onClick={runRecommendations} disabled={optimizationRun != null || recommendationRun != null}>Recommend unlocks</button>
          <button className="secondary" onClick={exportScenario}>Export JSON</button>
          <label className="secondary upload">Import JSON<input type="file" accept="application/json" onChange={importScenario} /></label>
        </div>
      </section>

      {demandProfile.preset === "custom" && (
        <section className="objectivePanel">
          <div className="panelHeader panelHeaderWide">
            <div>
              <p className="eyebrow">Objective</p>
              <h2>Custom demand weights</h2>
            </div>
            <span className="miniStat">{DEMAND_WEIGHT_ORDER.length + 1} sliders</span>
          </div>
          <div className="objectiveGrid">
            {DEMAND_WEIGHT_ORDER.map((productKind) => (
              <label className="pill rangePill objectiveWeightField" key={productKind}>
                <span>{formatLabel(productKind)}</span>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={0.25}
                  value={demandProfile.productWeights[productKind]}
                  onChange={(event) => setDemandWeight(productKind, Number(event.target.value))}
                />
                <strong>{formatWeight(demandProfile.productWeights[productKind])}</strong>
                <small>Score weight only. Raw output rates stay unchanged.</small>
              </label>
            ))}
            <label className="pill rangePill objectiveWeightField">
              <span>Reception utility</span>
              <input
                type="range"
                min={0}
                max={4}
                step={0.25}
                value={demandProfile.receptionWeight}
                onChange={(event) => setReceptionDemandWeight(Number(event.target.value))}
              />
              <strong>{formatWeight(demandProfile.receptionWeight)}</strong>
              <small>Applies to clue-collection support scoring, not exact clue-state simulation.</small>
            </label>
          </div>
        </section>
      )}

      {optimizationRun && (
        <section className="modalBackdrop">
          <div className="modalCard" role="dialog" aria-modal="true" aria-label="Optimization progress">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Optimization progress</p>
                <h2>{formatLabel(optimizationRun.progress.profileLabel)}</h2>
              </div>
              <span className="miniStat">{formatElapsedTime(elapsedMs)}</span>
            </div>
            <p className="status">{optimizationRun.progress.phase}</p>
            <div className="heroMetaGrid modalStats">
              <div><span>Visited nodes</span><strong>{optimizationRun.progress.visitedNodes}</strong></div>
              <div><span>Best score</span><strong>{optimizationRun.progress.bestScore.toFixed(2)}</strong></div>
              <div><span>Depth</span><strong>{optimizationRun.progress.currentDepth} / {Math.max(optimizationRun.progress.totalSlots, 0)}</strong></div>
              <div><span>Branch cap</span><strong>{optimizationRun.progress.maxBranchCandidatesPerSlot}</strong></div>
              <div><span>Node budget</span><strong>{optimizationRun.progress.maxVisitedNodes}</strong></div>
              <div><span>Effort</span><strong>{optimizationRun.progress.effort}/{MAX_OPTIMIZATION_EFFORT}</strong></div>
            </div>
            <p className="warningText">{getOptimizationProfileSummary(optimizationRun.progress.profileLabel)}</p>
            <button type="button" onClick={cancelOptimization}>Cancel</button>
          </div>
        </section>
      )}

      {recommendationRun && (
        <section className="modalBackdrop">
          <div className="modalCard" role="dialog" aria-modal="true" aria-label="Recommendation progress">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Recommendation progress</p>
                <h2>Unlock ranking</h2>
              </div>
              <span className="miniStat">{formatElapsedTime(elapsedMs)}</span>
            </div>
            <p className="status">{recommendationRun.progress.phase}</p>
            <div className="heroMetaGrid modalStats">
              <div><span>Candidates</span><strong>{recommendationRun.progress.completedCandidates} / {recommendationRun.progress.totalCandidates}</strong></div>
              <div><span>Baseline score</span><strong>{recommendationRun.progress.baselineScore.toFixed(2)}</strong></div>
              <div><span>Best delta</span><strong>{recommendationRun.progress.bestScoreDelta.toFixed(2)}</strong></div>
            </div>
            <button type="button" onClick={cancelOptimization}>Cancel</button>
          </div>
        </section>
      )}

      {messages.length > 0 && <section className="messageBar">{messages.map((message) => <p key={message}>{message}</p>)}</section>}
      {!validation.ok && <section className="messageBar warning">{validation.issues.map((issue) => <p key={`${issue.path}-${issue.message}`}>{issue.message}</p>)}</section>}

      <section className="tabShell">
        <div className="tabBar" role="tablist" aria-label="Workspace sections">
          {tabOptions.map((tab) => (
            <button
              key={tab.id}
              id={`${tab.id}-tab`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`${tab.id}-panel`}
              className={`tabButton ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              <small>{tab.detail}</small>
            </button>
          ))}
        </div>

        {activeTab === "roster" && selectedOperator && (
          <section id="roster-panel" role="tabpanel" aria-labelledby="roster-tab" className="workspacePanel">
            <div className="panelHeader panelHeaderWide">
              <div>
                <p className="eyebrow">Roster</p>
                <h2>Operator portraits</h2>
              </div>
              <span>{ownedOperators.length} owned / {catalog.operators.length} bundled</span>
            </div>

            <div className="rosterWorkspace">
              <div className="rosterBrowser">
                <label className="pill grow">
                  <span>Search roster</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ardelia" />
                </label>

                <div className="rosterStats">
                  <article><span>Showing</span><strong>{filteredOperators.length}</strong></article>
                  <article><span>Owned</span><strong>{ownedOperators.length}</strong></article>
                  <article><span>Selected</span><strong>{selectedOperator.name}</strong></article>
                </div>

                <div className="portraitGrid">
                  {filteredOperators.map(({ operator, owned }) => (
                    <button
                      key={operator.id}
                      type="button"
                      className={`portraitTile ${selectedOperator.id === operator.id ? "active" : ""} ${owned?.owned ? "owned" : "unowned"}`}
                      onClick={() => setSelectedOperatorId(operator.id)}
                    >
                      <div className="portraitFrame">
                        <OperatorPortrait catalog={catalog} operator={operator} className="portraitAvatar" />
                        <span className={`portraitCorner portraitStatus ${owned?.owned ? "level" : "locked"}`}>
                          {owned?.owned ? owned.level : "\uD83D\uDD12"}
                        </span>
                        <span className="portraitCorner portraitSkills">
                          {operator.baseSkills.map((skill) => {
                            const skillRank = owned?.baseSkillStates.find((entry) => entry.skillId === skill.id)?.unlockedRank ?? 0;
                            return (
                              <SkillIconBadge
                                key={`${operator.id}-${skill.id}`}
                                catalog={catalog}
                                skill={skill}
                                rank={skillRank}
                                hideWhenLocked
                              />
                            );
                          })}
                        </span>
                      </div>
                      <span className="portraitLabel">{operator.name}</span>
                      <span className="portraitMeta">{operator.className} | {getPromotionTierLabel(owned?.promotionTier ?? 0)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <aside className="operatorEditor">
                <div className="operatorEditorHeader">
                  <div className="operatorEditorIdentity">
                    <OperatorPortrait catalog={catalog} operator={selectedOperator} className="detailAvatar" />
                    <div>
                      <p className="operatorName">{selectedOperator.name}</p>
                      <p className="operatorMeta">{selectedOperator.className} | {selectedOperator.rarity} star | {selectedOperator.dataConfidence ?? "verified"}</p>
                    </div>
                  </div>
                  <label className="toggle editorToggle">
                    <input
                      type="checkbox"
                      checked={selectedOwnedState?.owned ?? false}
                      onChange={(event) => updateScenario((current) => replaceRosterEntry(current, selectedOperator.id, (entry) => ({
                        ...entry,
                        owned: event.target.checked,
                      })))}
                    />
                    <span>Owned</span>
                  </label>
                </div>

                <div className="editorStats">
                  <article><span>Status</span><strong>{selectedOwnedState?.owned ? "Owned" : "Unowned"}</strong></article>
                  <article><span>Promotion</span><strong>{getPromotionTierLabel(selectedOwnedState?.promotionTier ?? 0)}</strong></article>
                  <article><span>Unlocked skills</span><strong>{selectedOwnedState?.baseSkillStates.filter((entry) => entry.unlockedRank > 0).length ?? 0}/{selectedOperator.baseSkills.length}</strong></article>
                </div>

                {!selectedOwnedState?.owned && (
                  <p className="editorHint">Mark the operator as owned to set their level, promotion, and active Base Skills.</p>
                )}

                <div className="numericRow">
                  <label>
                    <span>Level</span>
                    <input
                      type="number"
                      min={1}
                      value={selectedOwnedState?.level ?? 1}
                      disabled={!selectedOwnedState?.owned}
                      onChange={(event) => updateScenario((current) => replaceRosterEntry(current, selectedOperator.id, (entry) => ({
                        ...entry,
                        level: Number(event.target.value) || 1,
                      })))}
                    />
                  </label>
                  <label>
                    <span>Promotion</span>
                    <select
                      value={selectedOwnedState?.promotionTier ?? 0}
                      disabled={!selectedOwnedState?.owned}
                      onChange={(event) => updateScenario((current) => replaceRosterEntry(current, selectedOperator.id, (entry) => ({
                        ...entry,
                        promotionTier: Number(event.target.value) as 0 | 1 | 2 | 3 | 4,
                      })))}
                    >
                      <option value={0}>Base</option>
                      <option value={1}>Elite 1</option>
                      <option value={2}>Elite 2</option>
                      <option value={3}>Elite 3</option>
                      <option value={4}>Elite 4</option>
                    </select>
                  </label>
                </div>

                <div className="skillGrid editorSkillGrid">
                  {selectedOperator.baseSkills.map((skill) => {
                    const state = selectedOwnedState?.baseSkillStates.find((entry) => entry.skillId === skill.id);
                    return (
                      <article key={skill.id} className="skillCard">
                        <div className="skillHeader">
                          <div className="skillSummary">
                            <SkillIconBadge
                              catalog={catalog}
                              skill={skill}
                              rank={state?.unlockedRank ?? 0}
                              className="skillBadgeLarge skillBadgePlain"
                              showOverlay={false}
                            />
                            <div>
                              <strong>{skill.name}</strong>
                              <p>{formatLabel(skill.facilityKind)} | {skill.dataConfidence ?? "verified"}</p>
                            </div>
                          </div>
                          <select
                            value={state?.unlockedRank ?? 0}
                            disabled={!selectedOwnedState?.owned}
                            onChange={(event) => updateScenario((current) => replaceRosterEntry(current, selectedOperator.id, (entry) => ({
                              ...entry,
                              baseSkillStates: entry.baseSkillStates.map((baseSkill) => baseSkill.skillId === skill.id
                                ? { ...baseSkill, unlockedRank: Number(event.target.value) as 0 | 1 | 2 }
                                : baseSkill),
                            })))}
                          >
                            <option value={0}>Locked (-)</option>
                            <option value={1}>{getRankLabel(skill, 1)}</option>
                            <option value={2}>{getRankLabel(skill, 2)}</option>
                          </select>
                        </div>
                        <p className="skillBody">{describeSkill(skill)}</p>
                      </article>
                    );
                  })}
                </div>
              </aside>
            </div>
          </section>
        )}

        {activeTab === "planner" && (
          <section id="planner-panel" role="tabpanel" aria-labelledby="planner-tab" className="workspacePanel plannerPanel">
            <div className="panelHeader panelHeaderWide">
              <div>
                <p className="eyebrow">Planner</p>
                <h2>Dijiang layout</h2>
              </div>
              <span>{scenario.facilities.hardAssignments.length} hard assignment{scenario.facilities.hardAssignments.length === 1 ? "" : "s"}</span>
            </div>

            <div className="plannerGrid">
              <article className="roomCard plannerRoomCard plannerRoomCardWide">
                <div className="plannerRoomBody">
                  <div className="plannerRoomIntro">
                    <div className="facilityHeader">
                      <div>
                        <h3>Control Nexus</h3>
                        <p>{facilitiesByKind.get("control_nexus")?.unlockHint}</p>
                      </div>
                      <span className="miniStat">{getRoomSlotCap(catalog, "control_nexus", scenario.facilities.controlNexus.level, scenario.facilities.controlNexus.level)} slots</span>
                    </div>
                    <div className="plannerStatRow">
                      <div className="plannerStatCell">
                        <span>Current level</span>
                        <strong>{scenario.facilities.controlNexus.level}</strong>
                      </div>
                      <div className="plannerStatCell">
                        <span>Unlocks online</span>
                        <strong>{roomOptions.length - 1} rooms</strong>
                      </div>
                    </div>
                  </div>
                  <div className="plannerCellGrid plannerCellGridCompact">
                    <label className="plannerCell">
                      <span>Level</span>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={scenario.facilities.controlNexus.level}
                        onChange={(event) => updateScenario((current) => ({
                          ...current,
                          facilities: {
                            ...current.facilities,
                            controlNexus: { level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 },
                          },
                        }))}
                      />
                    </label>
                    <div className="plannerCell plannerInfoCell">
                      <span>Manufacturing unlocks</span>
                      <strong>{unlockedManufacturingRoomCount} / {scenario.facilities.manufacturingCabins.length}</strong>
                    </div>
                    <div className="plannerCell plannerInfoCell">
                      <span>Growth unlocks</span>
                      <strong>{unlockedGrowthRoomCount} / {scenario.facilities.growthChambers.length}</strong>
                    </div>
                    <div className="plannerCell plannerInfoCell">
                      <span>Reception</span>
                      <strong>{unlockedReceptionRoomCount > 0 ? "Available" : "Locked"}</strong>
                    </div>
                  </div>
                </div>
              </article>

              {scenario.facilities.receptionRoom && (
                <article className="roomCard plannerRoomCard">
                  {(() => {
                    const roomLocked = unlockedReceptionRoomCount === 0;
                    return (
                      <div className="plannerRoomBody">
                        <div className="plannerRoomIntro">
                          <div className="facilityHeader">
                            <div>
                              <h3>Reception Room</h3>
                              <p>{facilitiesByKind.get("reception_room")?.unlockHint}</p>
                            </div>
                            <span className="miniStat">{getRoomSlotCap(catalog, "reception_room", scenario.facilities.receptionRoom.level, scenario.facilities.controlNexus.level)} slots</span>
                          </div>
                          <p className="roomMeta">{roomLocked ? "Locked until Control Nexus level 3" : "Available for clue assignments"}</p>
                          <div className="plannerStatRow">
                            <div className="plannerStatCell">
                              <span>Status</span>
                              <strong>{roomLocked ? "Locked" : scenario.facilities.receptionRoom.enabled ? "Enabled" : "Disabled"}</strong>
                            </div>
                            <div className="plannerStatCell">
                              <span>Level cap</span>
                              <strong>{Math.max(receptionLevelCap, 1)}</strong>
                            </div>
                          </div>
                        </div>
                        <div className="plannerCellGrid plannerCellGridCompact">
                          <label className="plannerCell plannerToggleCell">
                            <span>Enabled</span>
                            <input
                              type="checkbox"
                              checked={scenario.facilities.receptionRoom.enabled}
                              disabled={roomLocked}
                              onChange={(event) => updateScenario((current) => current.facilities.receptionRoom ? ({
                                ...current,
                                facilities: {
                                  ...current.facilities,
                                  receptionRoom: {
                                    ...current.facilities.receptionRoom,
                                    enabled: event.target.checked,
                                  },
                                },
                              }) : current)}
                            />
                          </label>
                          <label className="plannerCell">
                            <span>Level</span>
                            <input
                              type="number"
                              min={1}
                              max={Math.max(receptionLevelCap, 1)}
                              value={scenario.facilities.receptionRoom.level}
                              disabled={roomLocked}
                              onChange={(event) => updateScenario((current) => current.facilities.receptionRoom ? ({
                                ...current,
                                facilities: {
                                  ...current.facilities,
                                  receptionRoom: {
                                    ...current.facilities.receptionRoom,
                                    level: Number(event.target.value) as 1 | 2 | 3,
                                  },
                                },
                              }) : current)}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })()}
                </article>
              )}

              {scenario.facilities.manufacturingCabins.map((room, index) => {
                const recipe = room.fixedRecipeId ? recipesById.get(room.fixedRecipeId) : undefined;
                const roomLocked = index >= unlockedManufacturingRoomCount;
                return (
                  <article className="roomCard plannerRoomCard" key={room.id}>
                    <div className="plannerRoomBody">
                      <div className="plannerRoomIntro">
                        <div className="facilityHeader">
                          <div>
                            <h3>Manufacturing Cabin {index + 1}</h3>
                            <p>{facilitiesByKind.get("manufacturing_cabin")?.unlockHint}</p>
                          </div>
                          <span className="miniStat">{getRoomSlotCap(catalog, "manufacturing_cabin", room.level, scenario.facilities.controlNexus.level)} slots</span>
                        </div>
                        <div className="plannerStatRow">
                          <div className="plannerStatCell">
                            <span>Status</span>
                            <strong>{roomLocked ? "Locked" : room.enabled ? "Enabled" : "Disabled"}</strong>
                          </div>
                          <div className="plannerStatCell">
                            <span>Level cap</span>
                            <strong>{manufacturingLevelCap}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="plannerCellGrid">
                        <label className="plannerCell plannerToggleCell">
                          <span>Enabled</span>
                          <input
                            type="checkbox"
                            checked={room.enabled}
                            disabled={roomLocked}
                            onChange={(event) => updateScenario((current) => ({
                              ...current,
                              facilities: {
                                ...current.facilities,
                                manufacturingCabins: current.facilities.manufacturingCabins.map((entry) => entry.id === room.id ? { ...entry, enabled: event.target.checked } : entry),
                              },
                            }))}
                          />
                        </label>
                        <label className="plannerCell">
                          <span>Level</span>
                          <input
                            type="number"
                            min={1}
                            max={manufacturingLevelCap}
                            value={room.level}
                            disabled={roomLocked}
                            onChange={(event) => updateScenario((current) => ({
                              ...current,
                              facilities: {
                                ...current.facilities,
                                manufacturingCabins: current.facilities.manufacturingCabins.map((entry) => entry.id === room.id ? { ...entry, level: Number(event.target.value) as 1 | 2 | 3 } : entry),
                              },
                            }))}
                          />
                        </label>
                        <label className="plannerCell plannerCellWide">
                          <span>Recipe</span>
                          <select
                            value={room.fixedRecipeId ?? ""}
                            disabled={roomLocked}
                            onChange={(event) => updateScenario((current) => ({
                              ...current,
                              facilities: {
                                ...current.facilities,
                                manufacturingCabins: current.facilities.manufacturingCabins.map((entry) => entry.id === room.id ? { ...entry, fixedRecipeId: event.target.value || undefined } : entry),
                              },
                            }))}
                          >
                            <option value="">No recipe</option>
                            {catalog.recipes.filter((entry) => entry.facilityKind === "manufacturing_cabin" && entry.roomLevel <= room.level).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                          </select>
                          <small className="plannerCellNote">{roomLocked ? "Locked until Control Nexus level 3" : recipe ? `${formatLabel(recipe.productKind)} | ${formatDurationMinutes(recipe.baseDurationMinutes)} | output ${recipe.outputAmount ?? "?"}` : "No recipe selected"}</small>
                        </label>
                      </div>
                    </div>
                  </article>
                );
              })}

              {scenario.facilities.growthChambers.map((room, index) => {
                const growthSlotCap = getGrowthSlotCap(catalog, room.level);
                const roomLocked = index >= unlockedGrowthRoomCount;
                return (
                  <article className="roomCard plannerRoomCard plannerRoomCardWide" key={room.id}>
                    <div className="plannerRoomBody plannerRoomBodyWide">
                      <div className="plannerRoomIntro">
                        <div className="facilityHeader">
                          <div>
                            <h3>Growth Chamber {index + 1}</h3>
                            <p>{facilitiesByKind.get("growth_chamber")?.unlockHint}</p>
                          </div>
                          <span className="miniStat">{getRoomSlotCap(catalog, "growth_chamber", room.level, scenario.facilities.controlNexus.level)} slots</span>
                        </div>
                        {roomLocked && <p className="roomMeta">Locked until Control Nexus level 2</p>}
                        <div className="plannerStatRow">
                          <div className="plannerStatCell">
                            <span>Status</span>
                            <strong>{roomLocked ? "Locked" : room.enabled ? "Enabled" : "Disabled"}</strong>
                          </div>
                          <div className="plannerStatCell">
                            <span>Growth slots</span>
                            <strong>{growthSlotCap}</strong>
                          </div>
                          <div className="plannerStatCell">
                            <span>Level cap</span>
                            <strong>{Math.max(growthLevelCap, 1)}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="plannerCellGrid">
                        <label className="plannerCell plannerToggleCell">
                          <span>Enabled</span>
                          <input
                            type="checkbox"
                            checked={room.enabled}
                            disabled={roomLocked}
                            onChange={(event) => updateScenario((current) => ({
                              ...current,
                              facilities: {
                                ...current.facilities,
                                growthChambers: current.facilities.growthChambers.map((entry) => entry.id === room.id ? { ...entry, enabled: event.target.checked } : entry),
                              },
                            }))}
                          />
                        </label>
                        <label className="plannerCell">
                          <span>Level</span>
                          <input
                            type="number"
                            min={1}
                            max={Math.max(growthLevelCap, 1)}
                            value={room.level}
                            disabled={roomLocked}
                            onChange={(event) => updateScenario((current) => ({
                              ...current,
                              facilities: {
                                ...current.facilities,
                                growthChambers: current.facilities.growthChambers.map((entry) => entry.id === room.id ? { ...entry, level: Number(event.target.value) as 1 | 2 | 3 } : entry),
                              },
                            }))}
                          />
                        </label>
                      </div>
                      <div className="plannerSlotGrid">
                        {Array.from({ length: growthSlotCap }, (_, slotIndex) => {
                          const selectedRecipe = room.fixedRecipeIds?.[slotIndex]
                            ? recipesById.get(room.fixedRecipeIds[slotIndex]!)
                            : undefined;
                          return (
                            <label className="plannerCell" key={`${room.id}-growth-slot-${slotIndex}`}>
                              <span>Growth Slot {slotIndex + 1}</span>
                              <select
                                value={room.fixedRecipeIds?.[slotIndex] ?? ""}
                                disabled={roomLocked}
                                onChange={(event) => updateScenario((current) => ({
                                  ...current,
                                  facilities: {
                                    ...current.facilities,
                                    growthChambers: current.facilities.growthChambers.map((entry) => {
                                      if (entry.id !== room.id) {
                                        return entry;
                                      }
                                      const nextRecipeIds = [...(entry.fixedRecipeIds ?? [])];
                                      if (event.target.value) {
                                        nextRecipeIds[slotIndex] = event.target.value;
                                      } else {
                                        nextRecipeIds.splice(slotIndex, 1);
                                      }
                                      return { ...entry, fixedRecipeIds: nextRecipeIds.filter(Boolean) };
                                    }),
                                  },
                                }))}
                              >
                                <option value="">Empty slot</option>
                                {catalog.recipes.filter((entry) => entry.facilityKind === "growth_chamber" && entry.roomLevel <= room.level).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                              </select>
                              <small className="plannerCellNote">
                                {roomLocked
                                  ? "Locked until Control Nexus level 2"
                                  : selectedRecipe
                                    ? `${formatLabel(selectedRecipe.productKind)} | ${formatDurationMinutes(selectedRecipe.baseDurationMinutes)} | output ${selectedRecipe.outputAmount ?? "?"}`
                                    : "Empty slot"}
                              </small>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <article className="roomCard plannerRoomCard plannerRoomCardWide">
              <div className="plannerRoomBody plannerRoomBodyWide">
                <div className="plannerRoomIntro">
                  <div className="facilityHeader">
                    <div>
                      <h3>Hard assignments</h3>
                      <p>Optional overrides. Leave this empty to let the optimizer place everyone freely.</p>
                    </div>
                    <span className="miniStat">{scenario.facilities.hardAssignments.length} pinned</span>
                  </div>
                  <div className="plannerStatRow">
                    <div className="plannerStatCell">
                      <span>Owned operators</span>
                      <strong>{ownedOperators.length}</strong>
                    </div>
                    <div className="plannerStatCell">
                      <span>Target rooms</span>
                      <strong>{roomOptions.length}</strong>
                    </div>
                  </div>
                </div>
                <div className="hardAssignmentGrid">
                  {scenario.facilities.hardAssignments.map((assignment, index) => {
                    const currentOperatorName = operatorsById.get(assignment.operatorId)?.name ?? assignment.operatorId;
                    const operatorOptionIds = Array.from(
                      new Set([
                        assignment.operatorId,
                        ...getAvailableHardAssignmentOperatorIds(ownedOperators, scenario.facilities.hardAssignments, index),
                      ].filter(Boolean)),
                    );

                    return (
                      <div className="hardAssignmentRow" key={index}>
                        <label className="plannerCell">
                          <span>Operator</span>
                          <select
                            value={assignment.operatorId}
                            onChange={(event) => updateScenario((current) => ({
                              ...current,
                              facilities: {
                                ...current.facilities,
                                hardAssignments: current.facilities.hardAssignments.map((entry, entryIndex) => entryIndex === index ? { operatorId: event.target.value, roomId: entry.roomId } : { operatorId: entry.operatorId, roomId: entry.roomId }),
                              },
                            }))}
                          >
                            {operatorOptionIds.map((operatorId) => (
                              <option key={operatorId} value={operatorId}>{operatorsById.get(operatorId)?.name ?? operatorId}</option>
                            ))}
                          </select>
                        </label>
                        <label className="plannerCell">
                          <span>Room</span>
                          <select
                            value={assignment.roomId}
                            onChange={(event) => updateScenario((current) => ({
                              ...current,
                              facilities: {
                                ...current.facilities,
                                hardAssignments: current.facilities.hardAssignments.map((entry, entryIndex) => entryIndex === index ? { operatorId: entry.operatorId, roomId: event.target.value } : { operatorId: entry.operatorId, roomId: entry.roomId }),
                              },
                            }))}
                          >
                            {roomOptions.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="secondary hardAssignmentRemoveButton"
                          aria-label={`Remove hard assignment for ${currentOperatorName}`}
                          title={`Remove hard assignment for ${currentOperatorName}`}
                          onClick={() => updateScenario((current) => ({
                            ...current,
                            facilities: {
                              ...current.facilities,
                              hardAssignments: current.facilities.hardAssignments.filter((_, entryIndex) => entryIndex !== index),
                            },
                          }))}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="secondary hardAssignmentButton"
                    disabled={!nextHardAssignmentOperatorId}
                    onClick={() => updateScenario((current) => ({
                      ...current,
                      facilities: {
                        ...current.facilities,
                        hardAssignments: nextHardAssignmentOperatorId
                          ? [
                              ...current.facilities.hardAssignments,
                              {
                                operatorId: nextHardAssignmentOperatorId,
                                roomId: roomOptions[0]?.id ?? "control_nexus",
                              },
                            ]
                          : current.facilities.hardAssignments,
                      },
                    }))}
                  >
                    Add hard assignment
                  </button>
                </div>
              </div>
            </article>
          </section>
        )}

        {activeTab === "results" && (
          <section id="results-panel" role="tabpanel" aria-labelledby="results-tab" className="workspacePanel resultPanel">
            <div className="panelHeader panelHeaderWide">
              <div>
                <p className="eyebrow">Results</p>
                <h2>Why this wins</h2>
              </div>
              <span>{completedResultsCount > 0 ? `${completedResultsCount} pane${completedResultsCount === 1 ? "" : "s"} ready` : "Waiting to run"}</span>
            </div>

            {result ? (
              <div className="resultWorkspace">
                {optimizationSearchWarning && (
                  <article className="resultSummary resultAlertSummary">
                    <div className="panelHeader panelHeaderWide">
                      <div>
                        <p className="eyebrow">Optimization</p>
                        <h3>Search stopped</h3>
                      </div>
                      <span className="miniStat">{result.totalScore.toFixed(2)} score</span>
                    </div>
                    <div className="resultNotesGrid">
                      <p className="warningText resultNoteCell">{optimizationSearchWarning}</p>
                    </div>
                  </article>
                )}

                <div className="resultGrid">
                  {orderedResultRoomPlans.map((room) => {
                    const recipes = (room.chosenRecipeIds ?? [])
                      .map((recipeId) => recipesById.get(recipeId))
                      .filter((recipe): recipe is NonNullable<typeof recipe> => recipe != null);
                    const nonZeroRoomOutputs = Object.entries(room.projectedOutputs).filter(([, value]) => value > 0);
                    const roomWarnings = room.warnings.filter((warning) => !warning.startsWith("Optimization search stopped"));
                    return (
                      <article className="resultCard" key={room.roomId}>
                        <div className="resultHeader">
                          <div>
                            <h3>{roomLabelById.get(room.roomId) ?? room.roomId}</h3>
                            <p>Lv{room.roomLevel}</p>
                          </div>
                          <span className="miniStat">{room.dataConfidence}</span>
                        </div>
                        {room.assignedOperatorIds.length > 0
                          ? (
                              <div className="operatorChipList operatorChipGrid">
                                {room.assignedOperatorIds.map((operatorId) => {
                                  const operator = operatorsById.get(operatorId);
                                  return (
                                    <OperatorChip
                                      key={`${room.roomId}-${operatorId}`}
                                      catalog={catalog}
                                      operator={operator}
                                      fallbackLabel={operatorId}
                                      meta={`${operator?.className ?? "Unknown"} | ${operator?.rarity ?? "?"} star`}
                                    />
                                  );
                                })}
                              </div>
                            )
                          : <p className="resultLine">No operators assigned</p>}
                        {recipes.length > 0 && (
                          <div className="resultRecipeList">
                            {recipes.map((recipe) => (
                              <span className="resultRecipeChip" key={`${room.roomId}-${recipe.id}`}>
                                <strong>{recipe.name}</strong>
                                <small>{formatLabel(recipe.productKind)}</small>
                              </span>
                            ))}
                          </div>
                        )}
                        {nonZeroRoomOutputs.length > 0 && (
                          <div className="resultDataGrid">
                            {nonZeroRoomOutputs.map(([productKind, value]) => (
                              <div className="resultDataCell" key={`${room.roomId}-${productKind}`}>
                                <span>{formatLabel(productKind)}</span>
                                <strong>{value.toFixed(2)}/hr</strong>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="resultMetricGrid resultMetricGridSecondary">
                          <div className="resultMetric">
                            <span>Total</span>
                            <strong>{room.projectedScore.toFixed(2)}</strong>
                          </div>
                          <div className="resultMetric">
                            <span>Direct</span>
                            <strong>{room.scoreBreakdown.directProductionScore.toFixed(2)}</strong>
                          </div>
                          <div className="resultMetric">
                            <span>Support</span>
                            <strong>{room.scoreBreakdown.supportRoomScore.toFixed(2)}</strong>
                          </div>
                          <div className="resultMetric">
                            <span>Cross-room</span>
                            <strong>{room.scoreBreakdown.crossRoomBonusContribution.toFixed(2)}</strong>
                          </div>
                        </div>
                        {(room.usedFallbackHeuristics || roomWarnings.length > 0) && (
                          <div className="resultNotesGrid">
                            {room.usedFallbackHeuristics && <p className="warningText resultNoteCell">Fallback heuristics were used for part of this room score.</p>}
                            {roomWarnings.map((warning) => <p className="warningText resultNoteCell" key={`${room.roomId}-${warning}`}>{warning}</p>)}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <article className="resultSummary">
                  <div className="panelHeader panelHeaderWide">
                    <div>
                      <p className="eyebrow">Optimization</p>
                      <h3>Scenario snapshot</h3>
                    </div>
                    <span className="miniStat">{orderedResultRoomPlans.length} rooms planned</span>
                  </div>
                  <div className="resultSummaryGrid">
                    <div className="resultMetric resultMetricHighlight">
                      <span>Total score</span>
                      <strong>{result.totalScore.toFixed(2)}</strong>
                    </div>
                    <div className="resultMetric">
                      <span>Score model</span>
                      <strong>{result.supportWeightsVersion}</strong>
                    </div>
                    <div className="resultMetric">
                      <span>Warnings</span>
                      <strong>{result.warnings.length}</strong>
                    </div>
                    <div className="resultMetric">
                      <span>Tracked outputs</span>
                      <strong>{projectedOutputEntries.length}</strong>
                    </div>
                  </div>
                  <div className="summaryOutputs">
                    {projectedOutputEntries.map(([productKind, value]) => <span key={productKind}>{formatLabel(productKind)} {value.toFixed(2)}/hr</span>)}
                  </div>
                  {secondaryResultWarnings.length > 0 && (
                    <div className="resultNotesGrid">
                      {secondaryResultWarnings.map((warning) => <p className="warningText resultNoteCell" key={warning}>{warning}</p>)}
                    </div>
                  )}
                </article>
              </div>
            ) : (
              <p className="status">Run optimize to generate assignments, confidence, and recipe-backed output.</p>
            )}

            {recommendations && (
              <div className="recommendationStack">
                <div className="panelHeader panelHeaderWide">
                  <div>
                    <p className="eyebrow">Recommendations</p>
                    <h3>Next unlocks</h3>
                  </div>
                  <span className="miniStat">{recommendationEntries.length} candidates</span>
                </div>
                <div className="resultSummaryGrid recommendationSummaryGrid">
                  <div className="resultMetric">
                    <span>Baseline score</span>
                    <strong>{recommendations.baselineScore.toFixed(2)}</strong>
                  </div>
                  <div className="resultMetric">
                    <span>Ranking mode</span>
                    <strong>{formatLabel(recommendations.rankingMode)}</strong>
                  </div>
                </div>
                <div className="recommendationGrid">
                  {recommendationEntries.map((recommendation) => {
                  const operator = operatorsById.get(recommendation.action.operatorId);
                  const skill = operator?.baseSkills.find((entry) => entry.id === recommendation.action.skillId);
                  const extraNotes = getRecommendationExtraNotes(recommendation, operator?.name);
                  return (
                    <article className="resultCard recommendationCard" key={`${recommendation.action.operatorId}-${recommendation.action.skillId}`}>
                      <div className="resultHeader">
                        <div>
                          <OperatorChip
                            catalog={catalog}
                            operator={operator}
                            fallbackLabel={recommendation.action.operatorId}
                            meta={skill
                              ? (
                                  <span className="recommendationSkill">
                                    <SkillIconBadge
                                      catalog={catalog}
                                      skill={skill}
                                      rank={recommendation.action.targetRank}
                                      className="skillBadgeInline"
                                    />
                                    <span>{skill.name}</span>
                                  </span>
                                )
                              : recommendation.action.skillId}
                          />
                        </div>
                        <span className="miniStat">{recommendation.scoreDelta.toFixed(2)} delta</span>
                      </div>
                      <div className="resultMetricGrid">
                        <div className="resultMetric">
                          <span>Delta</span>
                          <strong>{recommendation.scoreDelta.toFixed(2)}</strong>
                        </div>
                        <div className="resultMetric">
                          <span>ROI</span>
                          <strong>{recommendation.roi.toFixed(2)}</strong>
                        </div>
                        <div className="resultMetric">
                          <span>ETA</span>
                          <strong>{recommendation.estimatedDaysToUnlock.toFixed(1)}d</strong>
                        </div>
                      </div>
                      <div className="resultNotesGrid recommendationInfoGrid">
                        <p className="resultLine resultNoteCell">
                          Current Elite {recommendation.action.currentPromotionTier} Lv{recommendation.action.currentLevel} {"->"} target Elite {recommendation.action.requiredPromotionTier ?? recommendation.action.currentPromotionTier} Lv{recommendation.action.requiredLevel ?? recommendation.action.currentLevel}
                        </p>
                        {recommendation.action.unlockHint && <p className="resultLine resultNoteCell">{recommendation.action.unlockHint}</p>}
                      </div>
                      <div className="resultDataGrid">
                        <div className="resultDataCell">
                          <span>Leveling</span>
                          <strong>{formatCosts(recommendation.action.levelMaterialCosts)}</strong>
                        </div>
                        <div className="resultDataCell">
                          <span>Promotion</span>
                          <strong>{formatCosts(recommendation.action.promotionMaterialCosts)}</strong>
                        </div>
                        <div className="resultDataCell">
                          <span>Skill</span>
                          <strong>{formatCosts(recommendation.action.skillMaterialCosts)}</strong>
                        </div>
                      </div>
                      {extraNotes.length > 0 && (
                        <div className="resultNotesGrid">
                          {extraNotes.map((note) => (
                            <p
                              className={`${note.includes("does not improve") || note.includes("No bundled upgrade cost") ? "warningText" : "resultLine"} resultNoteCell`}
                              key={`${recommendation.action.operatorId}-${recommendation.action.skillId}-${note}`}
                            >
                              {note}
                            </p>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

export { App };
