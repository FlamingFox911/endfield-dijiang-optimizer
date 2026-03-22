import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type {
  GameCatalog,
  OptimizationProfile,
  OptimizationResult,
  OptimizationScenario,
  UpgradeRecommendationResult,
} from "@endfield/domain";

import {
  CURRENT_CATALOG_VERSION,
  createStarterScenario,
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
const OPTIMIZATION_PROFILES: OptimizationProfile[] = ["fast", "balanced", "thorough", "exhaustive"];

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

function formatDurationMinutes(value: number | undefined): string {
  return value == null ? "Duration not recorded" : `${(value / 60).toFixed(1)}h`;
}

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
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
  return skill.ranks.find((entry) => entry.rank === rank)?.label.toUpperCase() ?? `RANK ${rank}`;
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

  const operatorsById = useMemo(() => new Map(catalog?.operators.map((operator) => [operator.id, operator]) ?? []), [catalog]);
  const recipesById = useMemo(() => new Map(catalog?.recipes.map((recipe) => [recipe.id, recipe]) ?? []), [catalog]);
  const facilitiesByKind = useMemo(() => new Map(catalog?.facilities.map((facility) => [facility.kind, facility]) ?? []), [catalog]);

  const filteredOperators = useMemo(() => {
    if (!catalog || !scenario) {
      return [];
    }
    const needle = deferredSearch.trim().toLowerCase();
    return catalog.operators
      .filter((operator) => !needle || operator.name.toLowerCase().includes(needle) || operator.id.includes(needle))
      .map((operator) => ({ operator, owned: scenario.roster.find((entry) => entry.operatorId === operator.id) }));
  }, [catalog, deferredSearch, scenario]);

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
    ...scenario.facilities.manufacturingCabins.map((room, index) => ({ id: room.id, label: `Manufacturing ${index + 1}` })),
    ...scenario.facilities.growthChambers.map((room, index) => ({ id: room.id, label: `Growth Chamber ${index + 1}` })),
    ...(scenario.facilities.receptionRoom ? [{ id: scenario.facilities.receptionRoom.id, label: "Reception Room" }] : []),
  ];

  const updateScenario = (updater: (current: OptimizationScenario) => OptimizationScenario) => {
    startTransition(() => setScenario((current) => (current ? updater(current) : current)));
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
      setMessages([message.message]);
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
      setMessages([message.message]);
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

  return (
    <main className="shell">
      <header className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Local-first optimizer</p>
          <h1>Endfield Dijiang Optimizer</h1>
          <p className="lede">The editor now hydrates older drafts against the active catalog and surfaces more of the bundled room, recipe, and upgrade data directly in the UI.</p>
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
          <label className="pill"><span>Mode</span><select value={scenario.options.planningMode} onChange={(event) => updateScenario((current) => ({ ...current, options: { ...current.options, planningMode: event.target.value as "simple" | "advanced" } }))}><option value="simple">Simple</option><option value="advanced">Advanced</option></select></label>
          <label className="pill">
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
            <select value={scenario.options.upgradeRankingMode ?? "balanced"} onChange={(event) => updateScenario((current) => ({ ...current, options: { ...current.options, upgradeRankingMode: event.target.value as "fastest" | "roi" | "balanced" } }))}><option value="balanced">Balanced</option><option value="roi">ROI</option><option value="fastest">Fastest</option></select>
            <small>{getUpgradeRankingModeSummary(scenario.options.upgradeRankingMode ?? "balanced")}</small>
          </label>
        </div>
      </header>

      <section className="toolbar">
        <label className="pill grow"><span>Search roster</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Chen Qianyu" /></label>
        <label className="pill compact"><span>Horizon hours</span><input type="number" min={1} value={scenario.options.horizonHours} onChange={(event) => updateScenario((current) => ({ ...current, options: { ...current.options, horizonHours: Number(event.target.value) || 24 } }))} /></label>
        <label className="pill compact"><span>Optimization profile</span><select value={scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE} onChange={(event) => setOptimizationProfile(event.target.value as OptimizationProfile)}>{OPTIMIZATION_PROFILES.map((profile) => <option key={profile} value={profile}>{formatLabel(profile)}</option>)}<option value="custom">Custom</option></select></label>
        <label className="pill rangePill"><span>Search effort</span><input type="range" min={1} max={MAX_OPTIMIZATION_EFFORT} value={clampOptimizationEffort(scenario.options.optimizationEffort ?? DEFAULT_OPTIMIZATION_EFFORT)} onChange={(event) => setOptimizationEffort(Number(event.target.value))} /><strong>{clampOptimizationEffort(scenario.options.optimizationEffort ?? DEFAULT_OPTIMIZATION_EFFORT)}/{MAX_OPTIMIZATION_EFFORT}</strong><small>{getOptimizationProfileSummary(scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE)}</small></label>
        <label className="toggle"><input type="checkbox" checked={scenario.options.maxFacilities} onChange={(event) => updateScenario((current) => ({ ...current, options: { ...current.options, maxFacilities: event.target.checked } }))} /><span>Max facilities overlay</span></label>
        <label className="toggle"><input type="checkbox" checked={scenario.options.includeReceptionRoom !== false} onChange={(event) => updateScenario((current) => ({ ...current, options: { ...current.options, includeReceptionRoom: event.target.checked } }))} /><span>Include reception room</span></label>
        <button onClick={runOptimization} disabled={optimizationRun != null || recommendationRun != null}>Optimize</button>
        <button className="secondary" onClick={runRecommendations} disabled={optimizationRun != null || recommendationRun != null}>Recommend unlocks</button>
        <button className="secondary" onClick={exportScenario}>Export JSON</button>
        <label className="secondary upload">Import JSON<input type="file" accept="application/json" onChange={importScenario} /></label>
      </section>

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

      <section className="grid">
        <section className="panel rosterPanel">
          <div className="panelHeader"><div><p className="eyebrow">Roster</p><h2>Operators</h2></div><span>{ownedOperators.length} owned / {catalog.operators.length} bundled</span></div>
          <div className="rosterList">
            {filteredOperators.map(({ operator, owned }) => (
              <article key={operator.id} className={`operatorCard ${owned?.owned ? "active" : ""}`}>
                <div className="operatorHeader">
                  <div className="avatar">{getInitials(operator.name)}</div>
                  <div><p className="operatorName">{operator.name}</p><p className="operatorMeta">{operator.className} | {operator.rarity} star | {operator.dataConfidence ?? "verified"}</p></div>
                  <label className="toggle inlineToggle"><input type="checkbox" checked={owned?.owned ?? false} onChange={(event) => updateScenario((current) => replaceRosterEntry(current, operator.id, (entry) => ({ ...entry, owned: event.target.checked })))} /><span>Owned</span></label>
                </div>
                <div className="numericRow">
                  <label><span>Level</span><input type="number" min={1} value={owned?.level ?? 1} onChange={(event) => updateScenario((current) => replaceRosterEntry(current, operator.id, (entry) => ({ ...entry, level: Number(event.target.value) || 1 })))} /></label>
                  <label><span>Promotion</span><select value={owned?.promotionTier ?? 0} onChange={(event) => updateScenario((current) => replaceRosterEntry(current, operator.id, (entry) => ({ ...entry, promotionTier: Number(event.target.value) as 0 | 1 | 2 | 3 | 4 })))}><option value={0}>Base</option><option value={1}>Elite 1</option><option value={2}>Elite 2</option><option value={3}>Elite 3</option><option value={4}>Elite 4</option></select></label>
                </div>
                <div className="skillGrid">
                  {operator.baseSkills.map((skill) => {
                    const state = owned?.baseSkillStates.find((entry) => entry.skillId === skill.id);
                    return (
                      <article key={skill.id} className="skillCard">
                        <div className="skillHeader">
                          <div><strong>{skill.name}</strong><p>{formatLabel(skill.facilityKind)} | {skill.dataConfidence ?? "verified"}</p></div>
                          <select value={state?.unlockedRank ?? 0} onChange={(event) => updateScenario((current) => replaceRosterEntry(current, operator.id, (entry) => ({ ...entry, baseSkillStates: entry.baseSkillStates.map((baseSkill) => baseSkill.skillId === skill.id ? { ...baseSkill, unlockedRank: Number(event.target.value) as 0 | 1 | 2 } : baseSkill) })))}><option value={0}>Locked</option><option value={1}>{getRankLabel(skill, 1)}</option><option value={2}>{getRankLabel(skill, 2)}</option></select>
                        </div>
                        <p className="skillBody">{describeSkill(skill)}</p>
                      </article>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel plannerPanel">
          <div className="panelHeader"><div><p className="eyebrow">Planner</p><h2>Dijiang layout</h2></div><span>{scenario.options.planningMode} mode</span></div>
          <article className="roomCard">
            <div className="facilityHeader"><div><h3>Control Nexus</h3><p>{facilitiesByKind.get("control_nexus")?.unlockHint}</p></div><span className="miniStat">{getRoomSlotCap(catalog, "control_nexus", scenario.facilities.controlNexus.level, scenario.facilities.controlNexus.level)} slots</span></div>
            <label className="pill compact"><span>Level</span><input type="number" min={1} max={5} value={scenario.facilities.controlNexus.level} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, controlNexus: { level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 } } }))} /></label>
          </article>
          <div className="roomStack">
            {scenario.facilities.manufacturingCabins.map((room, index) => {
              const recipe = room.fixedRecipeId ? recipesById.get(room.fixedRecipeId) : undefined;
              const roomLocked = index >= unlockedManufacturingRoomCount;
              return (
                <article className="roomCard" key={room.id}>
                  <div className="facilityHeader"><div><h3>Manufacturing {index + 1}</h3><p>{facilitiesByKind.get("manufacturing_cabin")?.unlockHint}</p></div><span className="miniStat">{getRoomSlotCap(catalog, "manufacturing_cabin", room.level, scenario.facilities.controlNexus.level)} slots</span></div>
                  <div className="numericRow"><label><span>Enabled</span><input type="checkbox" checked={room.enabled} disabled={roomLocked} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, manufacturingCabins: current.facilities.manufacturingCabins.map((entry) => entry.id === room.id ? { ...entry, enabled: event.target.checked } : entry) } }))} /></label><label><span>Level</span><input type="number" min={1} max={manufacturingLevelCap} value={room.level} disabled={roomLocked} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, manufacturingCabins: current.facilities.manufacturingCabins.map((entry) => entry.id === room.id ? { ...entry, level: Number(event.target.value) as 1 | 2 | 3 } : entry) } }))} /></label></div>
                  <label><span>Recipe</span><select value={room.fixedRecipeId ?? ""} disabled={roomLocked} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, manufacturingCabins: current.facilities.manufacturingCabins.map((entry) => entry.id === room.id ? { ...entry, fixedRecipeId: event.target.value || undefined } : entry) } }))}><option value="">No recipe</option>{catalog.recipes.filter((entry) => entry.facilityKind === "manufacturing_cabin" && entry.roomLevel <= room.level).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
                  <p className="roomMeta">{roomLocked ? "Locked until Control Nexus level 3" : recipe ? `${formatLabel(recipe.productKind)} | ${formatDurationMinutes(recipe.baseDurationMinutes)} | output ${recipe.outputAmount ?? "?"}` : "No recipe selected"}</p>
                </article>
              );
            })}
            {scenario.facilities.growthChambers.map((room, index) => {
              const recipes = (room.fixedRecipeIds ?? []).map((recipeId) => recipesById.get(recipeId)).filter(Boolean);
              const growthSlotCap = getGrowthSlotCap(catalog, room.level);
              const roomLocked = index >= unlockedGrowthRoomCount;
              return (
                <article className="roomCard" key={room.id}>
                  <div className="facilityHeader"><div><h3>Growth Chamber {index + 1}</h3><p>{facilitiesByKind.get("growth_chamber")?.unlockHint}</p></div><span className="miniStat">{getRoomSlotCap(catalog, "growth_chamber", room.level, scenario.facilities.controlNexus.level)} slots</span></div>
                  <div className="numericRow"><label><span>Enabled</span><input type="checkbox" checked={room.enabled} disabled={roomLocked} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, growthChambers: current.facilities.growthChambers.map((entry) => entry.id === room.id ? { ...entry, enabled: event.target.checked } : entry) } }))} /></label><label><span>Level</span><input type="number" min={1} max={Math.max(growthLevelCap, 1)} value={room.level} disabled={roomLocked} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, growthChambers: current.facilities.growthChambers.map((entry) => entry.id === room.id ? { ...entry, level: Number(event.target.value) as 1 | 2 | 3 } : entry) } }))} /></label></div>
                  <div className="skillGrid">
                    {Array.from({ length: growthSlotCap }, (_, slotIndex) => (
                      <label key={`${room.id}-growth-slot-${slotIndex}`}>
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
                      </label>
                    ))}
                  </div>
                  <p className="roomMeta">{roomLocked ? "Locked until Control Nexus level 2" : recipes.length > 0 ? recipes.map((recipe) => `${recipe.name} (${formatLabel(recipe.productKind)})`).join(" | ") : "No growth materials selected"}</p>
                </article>
              );
            })}
            {scenario.facilities.receptionRoom && (
              <article className="roomCard">
                {(() => {
                  const roomLocked = unlockedReceptionRoomCount === 0;
                  return (
                    <>
                <div className="facilityHeader"><div><h3>Reception Room</h3><p>{facilitiesByKind.get("reception_room")?.unlockHint}</p></div><span className="miniStat">{getRoomSlotCap(catalog, "reception_room", scenario.facilities.receptionRoom.level, scenario.facilities.controlNexus.level)} slots</span></div>
                <div className="numericRow"><label><span>Enabled</span><input type="checkbox" checked={scenario.facilities.receptionRoom.enabled} disabled={roomLocked} onChange={(event) => updateScenario((current) => current.facilities.receptionRoom ? ({ ...current, facilities: { ...current.facilities, receptionRoom: { ...current.facilities.receptionRoom, enabled: event.target.checked } } }) : current)} /></label><label><span>Level</span><input type="number" min={1} max={Math.max(receptionLevelCap, 1)} value={scenario.facilities.receptionRoom.level} disabled={roomLocked} onChange={(event) => updateScenario((current) => current.facilities.receptionRoom ? ({ ...current, facilities: { ...current.facilities, receptionRoom: { ...current.facilities.receptionRoom, level: Number(event.target.value) as 1 | 2 | 3 } } }) : current)} /></label></div>
                <p className="roomMeta">{roomLocked ? "Locked until Control Nexus level 3" : "Available for clue assignments"}</p>
                    </>
                  );
                })()}
              </article>
            )}
          </div>
          {scenario.options.planningMode === "advanced" && (
            <article className="roomCard">
              <h3>Hard assignments</h3>
              {scenario.facilities.hardAssignments.map((assignment, index) => (
                <div className="numericRow" key={`${assignment.operatorId}-${index}`}>
                  <select value={assignment.operatorId} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, hardAssignments: current.facilities.hardAssignments.map((entry, entryIndex) => entryIndex === index ? { operatorId: event.target.value, roomId: entry.roomId } : { operatorId: entry.operatorId, roomId: entry.roomId }) } }))}>{ownedOperators.map((entry) => <option key={entry.operatorId} value={entry.operatorId}>{operatorsById.get(entry.operatorId)?.name ?? entry.operatorId}</option>)}</select>
                  <select value={assignment.roomId} onChange={(event) => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, hardAssignments: current.facilities.hardAssignments.map((entry, entryIndex) => entryIndex === index ? { operatorId: entry.operatorId, roomId: event.target.value } : { operatorId: entry.operatorId, roomId: entry.roomId }) } }))}>{roomOptions.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}</select>
                </div>
              ))}
              <button className="secondary" onClick={() => updateScenario((current) => ({ ...current, facilities: { ...current.facilities, hardAssignments: [...current.facilities.hardAssignments, { operatorId: ownedOperators[0]?.operatorId ?? current.roster[0]?.operatorId ?? "", roomId: "control_nexus" }] } }))}>Add hard assignment</button>
            </article>
          )}
        </section>

        <section className="panel resultPanel">
          <div className="panelHeader"><div><p className="eyebrow">Results</p><h2>Why this wins</h2></div></div>
          {result ? (
            <div className="resultStack">
              <article className="resultSummary">
                <p>Total score</p>
                <strong>{result.totalScore.toFixed(2)}</strong>
                <p>Support weights: {result.supportWeightsVersion}</p>
                <div className="summaryOutputs">{Object.entries(result.projectedOutputs).filter(([, value]) => value > 0).map(([productKind, value]) => <span key={productKind}>{formatLabel(productKind)} {value.toFixed(2)}</span>)}</div>
              </article>
              {result.roomPlans.map((room) => {
                const recipes = (room.chosenRecipeIds ?? []).map((recipeId) => recipesById.get(recipeId)).filter(Boolean);
                return (
                  <article className="resultCard" key={room.roomId}>
                    <div className="resultHeader"><div><h3>{roomOptions.find((entry) => entry.id === room.roomId)?.label ?? room.roomId}</h3><p>{formatLabel(room.roomKind)} Lv{room.roomLevel}</p></div><span>{room.dataConfidence}</span></div>
                    <p className="resultLine">{recipes.length > 0 ? recipes.map((recipe) => `${recipe.name} | ${formatLabel(recipe.productKind)}`).join(" || ") : "No recipe selected"}</p>
                    <p className="resultLine">{room.assignedOperatorIds.map((operatorId) => operatorsById.get(operatorId)?.name ?? operatorId).join(", ") || "No operators assigned"}</p>
                    <dl><div><dt>Direct</dt><dd>{room.scoreBreakdown.directProductionScore.toFixed(2)}</dd></div><div><dt>Support</dt><dd>{room.scoreBreakdown.supportRoomScore.toFixed(2)}</dd></div><div><dt>Cross-room</dt><dd>{room.scoreBreakdown.crossRoomBonusContribution.toFixed(2)}</dd></div></dl>
                    {room.usedFallbackHeuristics && <p className="warningText">Fallback heuristics were used for part of this room score.</p>}
                    {room.warnings.length > 0 && <p className="warningText">{room.warnings.join(" | ")}</p>}
                  </article>
                );
              })}
            </div>
          ) : <p className="status">Run optimize to generate assignments, confidence, and recipe-backed output.</p>}

          {recommendations && (
            <div className="recommendationStack">
              <h3>Next unlocks</h3>
              {recommendations.recommendations.map((recommendation) => {
                const operator = operatorsById.get(recommendation.action.operatorId);
                const skill = operator?.baseSkills.find((entry) => entry.id === recommendation.action.skillId);
                return (
                  <article className="resultCard" key={`${recommendation.action.operatorId}-${recommendation.action.skillId}`}>
                    <div className="resultHeader"><div><strong>{operator?.name ?? recommendation.action.operatorId}</strong><p>{skill?.name ?? recommendation.action.skillId}</p></div><span>{recommendation.scoreDelta.toFixed(2)} delta</span></div>
                    <p className="resultLine">Current Elite {recommendation.action.currentPromotionTier} Lv{recommendation.action.currentLevel} {"->"} target Elite {recommendation.action.requiredPromotionTier ?? recommendation.action.currentPromotionTier} Lv{recommendation.action.requiredLevel ?? recommendation.action.currentLevel}</p>
                    <p className="resultLine">{recommendation.action.unlockHint ?? "No unlock hint recorded"}</p>
                    <p className="resultLine">Leveling: {formatCosts(recommendation.action.levelMaterialCosts)}</p>
                    <p className="resultLine">Promotion: {formatCosts(recommendation.action.promotionMaterialCosts)}</p>
                    <p className="resultLine">Skill: {formatCosts(recommendation.action.skillMaterialCosts)}</p>
                    <p className="warningText">{recommendation.notes.join(" | ")}</p>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export { App };
