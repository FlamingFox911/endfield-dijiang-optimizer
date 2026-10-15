import type { GameCatalog, OptimizationResult } from "@endfield/domain";
import type { NormalizedScenarioResult } from "./solver.js";
import type { SolveScenarioOptions } from "./types.js";

type Solver = (catalog: GameCatalog, normalized: NormalizedScenarioResult, options?: SolveScenarioOptions) => OptimizationResult;

/** A cabin with fewer than two staffed teams cannot use Auto-Rotate. Re-solve
 * it as a normal cabin, rather than keeping an empty scheduled team or merely
 * hiding that team from results. Each pass removes at least one shift pair.
 */
export function solveHybridRotation(
  catalog: GameCatalog, normalized: NormalizedScenarioResult, options: SolveScenarioOptions | undefined, solve: Solver,
): OptimizationResult {
  const startedAt = performance.now();
  const normal = new Set<string>();
  let visitedNodes = 0;
  let evaluatedSchedules = 0;
  let changedModes = false;
  let hints = options?.initialAssignments;
  while (true) {
    const rooms = normalized.rooms.filter((room) => !normal.has(room.physicalRoomId!) || room.shift !== "B")
      .map((room) => normal.has(room.physicalRoomId!)
        ? { ...room, roomId: room.physicalRoomId!, shift: undefined, shiftSchedule: undefined } : { ...room });
    const scenario = { ...normalized.scenario, facilities: { ...normalized.scenario.facilities,
      hardAssignments: normalized.scenario.facilities.hardAssignments.map((pin) => normal.has(pin.roomId)
        ? { ...pin, shift: undefined } : pin),
    } };
    const offset = visitedNodes;
    const result = solve(catalog, { ...normalized, rooms, scenario }, { ...options, initialAssignments: hints,
      ...(options?.onProgress ? { onProgress: (progress) => {
        const elapsedMs = performance.now() - startedAt;
        options.onProgress!({ ...progress, visitedNodes: offset + progress.visitedNodes,
          ...(progress.timing ? { timing: { ...progress.timing, elapsedMs,
            nodesPerSecond: (offset + progress.visitedNodes) * 1000 / Math.max(1, elapsedMs),
          } } : {}),
        });
      } } : {}),
    });
    visitedNodes += result.search?.visitedNodes ?? 0;
    evaluatedSchedules += result.search?.scheduleSearch?.evaluatedSchedules ?? 0;
    const missingTeam = new Set(result.roomPlans.filter((plan) => plan.shift && plan.assignedOperatorIds.length === 0)
      .map((plan) => plan.physicalRoomId!));
    if (missingTeam.size === 0) {
      if (result.search) {
        result.search.visitedNodes = visitedNodes;
        // Mode changes are a bounded repair, not exhaustive mode enumeration.
        if (changedModes) result.search.complete = false;
        if (result.search.scheduleSearch) result.search.scheduleSearch.evaluatedSchedules = evaluatedSchedules;
      }
      return result;
    }
    changedModes = true;
    for (const id of missingTeam) normal.add(id);
    // Canonical normal-room ids preserve even a lone Shift B hard assignment.
    // Keep the incumbent workforce as a feasible seed while its uptime changes.
    hints = result.roomPlans.filter((plan) => !missingTeam.has(plan.physicalRoomId!) || plan.shift === "A")
      .map((plan) => missingTeam.has(plan.physicalRoomId!) ? {
        ...plan, roomId: plan.physicalRoomId!, shift: undefined, shiftSchedule: undefined,
        assignedOperatorIds: result.roomPlans.filter((entry) => entry.physicalRoomId === plan.physicalRoomId)
          .flatMap((entry) => entry.assignedOperatorIds),
      } : plan);
  }
}
