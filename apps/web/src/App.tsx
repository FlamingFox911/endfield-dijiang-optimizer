import { startTransition, useEffect, useMemo, useState, useDeferredValue } from "react";

import type { GameCatalog, OptimizationResult, OptimizationScenario, UpgradeRecommendationResult } from "@endfield/domain";

import {
  CURRENT_CATALOG_VERSION,
  createStarterScenario,
  fetchGameCatalog,
  migrateScenario,
  validateScenarioAgainstCatalog,
} from "@endfield/data";
import { recommendUpgrades, solveScenario } from "@endfield/optimizer";

const DRAFT_KEY = "endfield-dijiang-optimizer:draft";

function replaceRosterEntry(
  scenario: OptimizationScenario,
  operatorId: string,
  updater: (entry: OptimizationScenario["roster"][number]) => OptimizationScenario["roster"][number],
) {
  return {
    ...scenario,
    roster: scenario.roster.map((entry) => (entry.operatorId === operatorId ? updater(entry) : entry)),
  };
}

function App() {
  const [catalog, setCatalog] = useState<GameCatalog | null>(null);
  const [scenario, setScenario] = useState<OptimizationScenario | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [recommendations, setRecommendations] = useState<UpgradeRecommendationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

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
          setLoading(false);
          return;
        }

        const migration = migrateScenario(JSON.parse(savedDraft));
        setCatalog(nextCatalog);
        setScenario(migration.scenario);
        setMessages(
          [
            ...(migration.migrated
              ? [`Loaded local draft and migrated it from format ${migration.fromFormatVersion} to ${migration.toFormatVersion}.`]
              : []),
            ...migration.warnings.map((issue) => issue.message),
          ],
        );
      } catch (error) {
        if (!cancelled) {
          setMessages([
            error instanceof Error
              ? error.message
              : "Failed to load the bundled catalog or local draft.",
          ]);
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
    if (!scenario) {
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(scenario));
  }, [scenario]);

  useEffect(() => {
    setResult(null);
    setRecommendations(null);
  }, [scenario]);

  const deferredSearch = useDeferredValue(search);

  const filteredOperators = useMemo(() => {
    if (!catalog || !scenario) {
      return [];
    }
    const needle = deferredSearch.trim().toLowerCase();
    return catalog.operators
      .filter((operator) => !needle || operator.name.toLowerCase().includes(needle) || operator.id.includes(needle))
      .map((operator) => {
        const owned = scenario.roster.find((entry) => entry.operatorId === operator.id);
        return { operator, owned };
      });
  }, [catalog, deferredSearch, scenario]);

  if (loading || !catalog || !scenario) {
    return <main className="shell"><p className="status">Loading bundled catalog…</p></main>;
  }

  const validation = validateScenarioAgainstCatalog(catalog, scenario);

  const updateScenario = (updater: (current: OptimizationScenario) => OptimizationScenario) => {
    startTransition(() => {
      setScenario((current) => (current ? updater(current) : current));
    });
  };

  const runOptimization = () => {
    const nextValidation = validateScenarioAgainstCatalog(catalog, scenario);
    if (!nextValidation.ok) {
      setMessages(nextValidation.issues.map((issue) => issue.message));
      return;
    }
    const nextResult = solveScenario(catalog, scenario);
    setMessages(nextResult.warnings);
    setResult(nextResult);
  };

  const runRecommendations = () => {
    const nextValidation = validateScenarioAgainstCatalog(catalog, scenario);
    if (!nextValidation.ok) {
      setMessages(nextValidation.issues.map((issue) => issue.message));
      return;
    }
    setRecommendations(recommendUpgrades(catalog, scenario));
  };

  const exportScenario = () => {
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
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
      const text = await file.text();
      const migration = migrateScenario(JSON.parse(text));
      setScenario(migration.scenario);
      setMessages([
        migration.migrated
          ? `Imported scenario and migrated it from format ${migration.fromFormatVersion} to ${migration.toFormatVersion}.`
          : "Imported scenario.",
        ...migration.warnings.map((issue) => issue.message),
      ]);
    } catch (error) {
      setMessages([
        error instanceof Error ? error.message : "Failed to import scenario JSON.",
      ]);
    }
  };

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local-first optimizer</p>
          <h1>Endfield Dijiang Optimizer</h1>
          <p className="lede">
            Solve current assignments, simulate max facilities, and compare next Base Skill unlocks
            without account scraping.
          </p>
        </div>
        <div className="heroPanel">
          <p>Catalog</p>
          <strong>{CURRENT_CATALOG_VERSION}</strong>
          <label className="pill">
            <span>Mode</span>
            <select
              value={scenario.options.planningMode}
              onChange={(event) =>
                updateScenario((current) => ({
                  ...current,
                  options: { ...current.options, planningMode: event.target.value as "simple" | "advanced" },
                }))
              }
            >
              <option value="simple">Simple</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label className="pill">
            <span>Ranking</span>
            <select
              value={scenario.options.upgradeRankingMode ?? "balanced"}
              onChange={(event) =>
                updateScenario((current) => ({
                  ...current,
                  options: { ...current.options, upgradeRankingMode: event.target.value as "fastest" | "roi" | "balanced" },
                }))
              }
            >
              <option value="balanced">Balanced</option>
              <option value="roi">ROI</option>
              <option value="fastest">Fastest</option>
            </select>
          </label>
        </div>
      </header>

      <section className="toolbar">
        <label className="pill">
          <span>Search roster</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Chen Qianyu" />
        </label>
        <label className="pill">
          <span>Horizon hours</span>
          <input
            type="number"
            min={1}
            value={scenario.options.horizonHours}
            onChange={(event) =>
              updateScenario((current) => ({
                ...current,
                options: { ...current.options, horizonHours: Number(event.target.value) || 24 },
              }))
            }
          />
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={scenario.options.maxFacilities}
            onChange={(event) =>
              updateScenario((current) => ({
                ...current,
                options: { ...current.options, maxFacilities: event.target.checked },
              }))
            }
          />
          <span>Max facilities overlay</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={scenario.options.includeReceptionRoom !== false}
            onChange={(event) =>
              updateScenario((current) => ({
                ...current,
                options: { ...current.options, includeReceptionRoom: event.target.checked },
              }))
            }
          />
          <span>Include reception room</span>
        </label>
        <button onClick={runOptimization}>Optimize</button>
        <button className="secondary" onClick={runRecommendations}>Recommend unlocks</button>
        <button className="secondary" onClick={exportScenario}>Export JSON</button>
        <label className="secondary upload">
          Import JSON
          <input type="file" accept="application/json" onChange={importScenario} />
        </label>
      </section>

      {messages.length > 0 && (
        <section className="messageBar">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </section>
      )}

      {!validation.ok && (
        <section className="messageBar warning">
          {validation.issues.map((issue) => (
            <p key={`${issue.path}-${issue.message}`}>{issue.message}</p>
          ))}
        </section>
      )}

      <section className="grid">
        <section className="panel rosterPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Roster</p>
              <h2>Operators</h2>
            </div>
            <span>{filteredOperators.filter((entry) => entry.owned?.owned).length} owned</span>
          </div>
          <div className="rosterList">
            {filteredOperators.map(({ operator, owned }) => (
              <article key={operator.id} className={`operatorCard ${owned?.owned ? "active" : ""}`}>
                <div>
                  <p className="operatorName">{operator.name}</p>
                  <p className="operatorMeta">{operator.className} • {operator.rarity}★</p>
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={owned?.owned ?? false}
                    onChange={(event) =>
                      updateScenario((current) =>
                        replaceRosterEntry(current, operator.id, (entry) => ({
                          ...entry,
                          owned: event.target.checked,
                        })),
                      )
                    }
                  />
                  <span>Owned</span>
                </label>
                <div className="numericRow">
                  <label>
                    <span>Level</span>
                    <input
                      type="number"
                      min={1}
                      value={owned?.level ?? 1}
                      onChange={(event) =>
                        updateScenario((current) =>
                          replaceRosterEntry(current, operator.id, (entry) => ({
                            ...entry,
                            level: Number(event.target.value) || 1,
                          })),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Trust</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={owned?.trustPercent ?? 0}
                      onChange={(event) =>
                        updateScenario((current) =>
                          replaceRosterEntry(current, operator.id, (entry) => ({
                            ...entry,
                            trustPercent: Number(event.target.value) || 0,
                          })),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="skillGrid">
                  {operator.baseSkills.map((skill) => {
                    const state = owned?.baseSkillStates.find((entry) => entry.skillId === skill.id);
                    return (
                      <label key={skill.id}>
                        <span>{skill.name}</span>
                        <select
                          value={state?.unlockedRank ?? 0}
                          onChange={(event) =>
                            updateScenario((current) =>
                              replaceRosterEntry(current, operator.id, (entry) => ({
                                ...entry,
                                baseSkillStates: entry.baseSkillStates.map((baseSkill) =>
                                  baseSkill.skillId === skill.id
                                    ? { ...baseSkill, unlockedRank: Number(event.target.value) as 0 | 1 | 2 }
                                    : baseSkill,
                                ),
                              })),
                            )
                          }
                        >
                          <option value={0}>Locked</option>
                          <option value={1}>Alpha</option>
                          <option value={2}>Beta</option>
                        </select>
                      </label>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel plannerPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Planner</p>
              <h2>Dijiang layout</h2>
            </div>
          </div>
          <label className="pill">
            <span>Control Nexus</span>
            <input
              type="number"
              min={1}
              max={5}
              value={scenario.facilities.controlNexus.level}
              onChange={(event) =>
                updateScenario((current) => ({
                  ...current,
                  facilities: {
                    ...current.facilities,
                    controlNexus: {
                      level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5,
                    },
                  },
                }))
              }
            />
          </label>
          <div className="roomStack">
            {scenario.facilities.manufacturingCabins.map((room, index) => (
              <article className="roomCard" key={room.id}>
                <h3>Manufacturing {index + 1}</h3>
                <div className="numericRow">
                  <label>
                    <span>Enabled</span>
                    <input
                      type="checkbox"
                      checked={room.enabled}
                      onChange={(event) =>
                        updateScenario((current) => ({
                          ...current,
                          facilities: {
                            ...current.facilities,
                            manufacturingCabins: current.facilities.manufacturingCabins.map((entry) =>
                              entry.id === room.id ? { ...entry, enabled: event.target.checked } : entry,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Level</span>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={room.level}
                      onChange={(event) =>
                        updateScenario((current) => ({
                          ...current,
                          facilities: {
                            ...current.facilities,
                            manufacturingCabins: current.facilities.manufacturingCabins.map((entry) =>
                              entry.id === room.id ? { ...entry, level: Number(event.target.value) as 1 | 2 | 3 } : entry,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>Recipe</span>
                  <select
                    value={room.fixedRecipeId ?? ""}
                    onChange={(event) =>
                      updateScenario((current) => ({
                        ...current,
                        facilities: {
                          ...current.facilities,
                          manufacturingCabins: current.facilities.manufacturingCabins.map((entry) =>
                            entry.id === room.id
                              ? { ...entry, fixedRecipeId: event.target.value || undefined }
                              : entry,
                          ),
                        },
                      }))
                    }
                  >
                    <option value="">No recipe</option>
                    {catalog.recipes
                      .filter((recipe) => recipe.facilityKind === "manufacturing_cabin" && recipe.roomLevel <= room.level)
                      .map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
                      ))}
                  </select>
                </label>
              </article>
            ))}
            {scenario.facilities.growthChambers.map((room, index) => (
              <article className="roomCard" key={room.id}>
                <h3>Growth Chamber {index + 1}</h3>
                <div className="numericRow">
                  <label>
                    <span>Enabled</span>
                    <input
                      type="checkbox"
                      checked={room.enabled}
                      onChange={(event) =>
                        updateScenario((current) => ({
                          ...current,
                          facilities: {
                            ...current.facilities,
                            growthChambers: current.facilities.growthChambers.map((entry) =>
                              entry.id === room.id ? { ...entry, enabled: event.target.checked } : entry,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Level</span>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={room.level}
                      onChange={(event) =>
                        updateScenario((current) => ({
                          ...current,
                          facilities: {
                            ...current.facilities,
                            growthChambers: current.facilities.growthChambers.map((entry) =>
                              entry.id === room.id ? { ...entry, level: Number(event.target.value) as 1 | 2 | 3 } : entry,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>Recipe</span>
                  <select
                    value={room.fixedRecipeId ?? ""}
                    onChange={(event) =>
                      updateScenario((current) => ({
                        ...current,
                        facilities: {
                          ...current.facilities,
                          growthChambers: current.facilities.growthChambers.map((entry) =>
                            entry.id === room.id
                              ? { ...entry, fixedRecipeId: event.target.value || undefined }
                              : entry,
                          ),
                        },
                      }))
                    }
                  >
                    <option value="">No recipe</option>
                    {catalog.recipes
                      .filter((recipe) => recipe.facilityKind === "growth_chamber" && recipe.roomLevel <= room.level)
                      .map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
                      ))}
                  </select>
                </label>
              </article>
            ))}
          </div>

          {scenario.options.planningMode === "advanced" && (
            <article className="roomCard">
              <h3>Hard assignments</h3>
              {scenario.facilities.hardAssignments.map((assignment, index) => (
                <div className="numericRow" key={`${assignment.operatorId}-${index}`}>
                  <select
                    value={assignment.operatorId}
                    onChange={(event) =>
                      updateScenario((current) => ({
                        ...current,
                        facilities: {
                          ...current.facilities,
                          hardAssignments: current.facilities.hardAssignments.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, operatorId: event.target.value } : entry,
                          ),
                        },
                      }))
                    }
                  >
                    {scenario.roster.filter((entry) => entry.owned).map((entry) => (
                      <option key={entry.operatorId} value={entry.operatorId}>{entry.operatorId}</option>
                    ))}
                  </select>
                  <select
                    value={assignment.roomId}
                    onChange={(event) =>
                      updateScenario((current) => ({
                        ...current,
                        facilities: {
                          ...current.facilities,
                          hardAssignments: current.facilities.hardAssignments.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, roomId: event.target.value } : entry,
                          ),
                        },
                      }))
                    }
                  >
                    <option value="control_nexus">control_nexus</option>
                    {scenario.facilities.manufacturingCabins.map((room) => (
                      <option key={room.id} value={room.id}>{room.id}</option>
                    ))}
                    {scenario.facilities.growthChambers.map((room) => (
                      <option key={room.id} value={room.id}>{room.id}</option>
                    ))}
                    {scenario.facilities.receptionRoom && (
                      <option value={scenario.facilities.receptionRoom.id}>{scenario.facilities.receptionRoom.id}</option>
                    )}
                  </select>
                </div>
              ))}
              <button
                className="secondary"
                onClick={() =>
                  updateScenario((current) => ({
                    ...current,
                    facilities: {
                      ...current.facilities,
                      hardAssignments: [
                        ...current.facilities.hardAssignments,
                        { operatorId: current.roster.find((entry) => entry.owned)?.operatorId ?? current.roster[0].operatorId, roomId: "control_nexus" },
                      ],
                    },
                  }))
                }
              >
                Add hard assignment
              </button>
            </article>
          )}
        </section>

        <section className="panel resultPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Results</p>
              <h2>Why this wins</h2>
            </div>
          </div>
          {result ? (
            <div className="resultStack">
              <article className="resultSummary">
                <p>Total score</p>
                <strong>{result.totalScore.toFixed(2)}</strong>
                <p>Support weights: {result.supportWeightsVersion}</p>
              </article>
              {result.roomPlans.map((room) => (
                <article className="resultCard" key={room.roomId}>
                  <div className="resultHeader">
                    <h3>{room.roomId}</h3>
                    <span>{room.dataConfidence}</span>
                  </div>
                  <p>{room.assignedOperatorIds.join(", ") || "No operators assigned"}</p>
                  <dl>
                    <div><dt>Direct</dt><dd>{room.scoreBreakdown.directProductionScore.toFixed(2)}</dd></div>
                    <div><dt>Support</dt><dd>{room.scoreBreakdown.supportRoomScore.toFixed(2)}</dd></div>
                    <div><dt>Cross-room</dt><dd>{room.scoreBreakdown.crossRoomBonusContribution.toFixed(2)}</dd></div>
                  </dl>
                  {room.warnings.length > 0 && <p className="warningText">{room.warnings.join(" | ")}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="status">Run optimize to generate assignments and room score breakdowns.</p>
          )}

          {recommendations && (
            <div className="recommendationStack">
              <h3>Next unlocks</h3>
              {recommendations.recommendations.map((recommendation) => (
                <article className="resultCard" key={`${recommendation.action.operatorId}-${recommendation.action.skillId}`}>
                  <div className="resultHeader">
                    <strong>{recommendation.action.operatorId}</strong>
                    <span>{recommendation.scoreDelta.toFixed(2)} delta</span>
                  </div>
                  <p>{recommendation.action.skillId} → rank {recommendation.action.targetRank}</p>
                  <p>{recommendation.notes.join(" | ")}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export { App };
