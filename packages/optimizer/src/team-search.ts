import type { createAssignmentScorer } from "./assignment-scoring.js";
import type { NormalizedRoom } from "./solver.js";

type Assignments = Map<string, Array<string | null>>;
interface Team {
  ids: string[];
  mask: bigint;
  score: number;
}

/**
 * Exact search: with Control Nexus fixed, room scores are independent except
 * for exclusive operator ownership. Enumerate room subsets once per support
 * context, then use the best compatible room teams as an admissible bound.
 */
export function searchRoomTeams(options: {
  rooms: NormalizedRoom[];
  available: string[];
  hardAssignments: Assignments;
  scorer: ReturnType<typeof createAssignmentScorer>;
  compareOperators: (left: string, right: string) => number;
  best: () => { score: number; assignments: Assignments; workerCount: number };
  accept: (assignments: Assignments, score: number) => void;
  checkCancel: () => void;
  visit: (depth: number) => void;
  phase: (message: string) => void;
  rootCount: (count: number) => void;
  rootComplete: () => void;
}) {
  const { rooms, available, hardAssignments, scorer, compareOperators, checkCancel } = options;
  const bits = new Map(available.map((id, index) => [id, 1n << BigInt(index)]));
  const fixed = new Map(rooms.map((room) => [room.roomId,
    hardAssignments.get(room.roomId)!.filter((id): id is string => id != null)]));
  const fixedIds = [...fixed.values()].flat();
  const assigned: Assignments = new Map(rooms.map((room) => [room.roomId, [...hardAssignments.get(room.roomId)!]]));
  const compareLists = (left: string[], right: string[]) => {
    const a = [...left].sort(compareOperators);
    const b = [...right].sort(compareOperators);
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      const order = compareOperators(a[index]!, b[index]!);
      if (order !== 0) return order;
    }
    return a.length - b.length;
  };
  const workers = (assignment: Assignments) => [...assignment.values()].flat().filter((id): id is string => id != null);
  const put = (room: NormalizedRoom, ids: string[]) => {
    const values = [...fixed.get(room.roomId)!, ...ids] as Array<string | null>;
    while (values.length < room.slotCap) values.push(null);
    assigned.set(room.roomId, values);
  };
  const teamsFor = (room: NormalizedRoom): Team[] => {
    const candidates = available.filter((id) => scorer.canContribute(room.roomId, id));
    const capacity = room.slotCap - fixed.get(room.roomId)!.length;
    const teams: Team[] = [];
    const chosen: string[] = [];
    const enumerate = (start: number, mask: bigint) => {
      checkCancel();
      teams.push({ ids: [...chosen], mask, score: 0 });
      if (chosen.length === capacity) return;
      for (let index = start; index < candidates.length; index += 1) {
        const id = candidates[index]!;
        chosen.push(id);
        enumerate(index + 1, mask | bits.get(id)!);
        chosen.pop();
      }
    };
    enumerate(0, 0n);
    return teams;
  };
  const control = rooms.find((room) => room.roomKind === "control_nexus")!;
  const productive = rooms.filter((room) => room !== control);
  options.phase("Preparing room combinations");
  const rawTeams = new Map(rooms.map((room) => [room.roomId, teamsFor(room)]));
  // Try stronger shipwide support early; this ordering never excludes a team.
  const controlTeams = rawTeams.get(control.roomId)!.map((team) => {
    put(control, team.ids);
    const support = scorer.controlSupport(assigned);
    return { ...team, score: support.moodDropReductionPercent + support.moodRegenPercent };
  }).sort((left, right) => right.score - left.score || left.ids.length - right.ids.length || compareLists(left.ids, right.ids));
  put(control, []);
  options.rootCount(controlTeams.length);
  options.visit(0);

  for (const controlTeam of controlTeams) {
    checkCancel();
    put(control, controlTeam.ids);
    const support = scorer.controlSupport(assigned);
    options.phase("Scoring room combinations");
    const candidates = new Map(productive.map((room) => [room.roomId,
      rawTeams.get(room.roomId)!.filter((team) => (team.mask & controlTeam.mask) === 0n).map((team) => {
        checkCancel();
        return { ...team, score: scorer.scoreTeam(room.roomId, [...fixed.get(room.roomId)!, ...team.ids], support) };
      }).sort((left, right) => right.score - left.score || left.ids.length - right.ids.length || compareLists(left.ids, right.ids)),
    ]));
    // Few-choice rooms first reduce overlap branching. Original room order is
    // retained separately for score summation and deterministic placement ties.
    const ordered = [...productive].sort((a, b) => candidates.get(a.roomId)!.length - candidates.get(b.roomId)!.length);
    const selected = new Map<string, Team>();
    const sumScores = (maxima: Map<string, Team>) => productive.reduce((sum, room) =>
      sum + (selected.get(room.roomId) ?? maxima.get(room.roomId))!.score, 0);

    const search = (index: number, used: bigint, count: number) => {
      checkCancel();
      options.visit(control.slotCap - fixed.get(control.roomId)!.length
        + ordered.slice(0, index).reduce((sum, room) => sum + room.slotCap - fixed.get(room.roomId)!.length, 0));
      const best = options.best();
      if (index === ordered.length) {
        options.accept(assigned, scorer.score(assigned));
        return;
      }
      const rest = ordered.slice(index);
      const maxima = new Map<string, Team>();
      for (const room of rest) {
        const top = candidates.get(room.roomId)!.find((team) => (team.mask & used) === 0n)!;
        maxima.set(room.roomId, top);
      }
      const upperBound = sumScores(maxima);
      if (upperBound < best.score - 1e-12) return;

      // Equal-score branches must still honor fewest workers, preferred
      // workforce, and placement order. Use optimistic bounds for those too.
      if (upperBound === best.score) {
        // A slightly lower room score can round to the same whole-plan score.
        // Include those teams in secondary bounds instead of assuming only an
        // individually maximal room score can participate in a total-score tie.
        const couldTie = (roomId: string, team: Team) => productive.reduce((sum, room) => sum
          + (room.roomId === roomId ? team : selected.get(room.roomId) ?? maxima.get(room.roomId))!.score, 0) >= best.score;
        const minimumCounts = new Map<string, number>();
        for (const room of rest) {
          let minimum = Number.POSITIVE_INFINITY;
          for (const team of candidates.get(room.roomId)!) {
            if (!couldTie(room.roomId, team)) break;
            if ((team.mask & used) === 0n) minimum = Math.min(minimum, team.ids.length);
          }
          minimumCounts.set(room.roomId, minimum);
        }
        const minCount = count + [...minimumCounts.values()].reduce((sum, value) => sum + value, 0);
        if (minCount > best.workerCount) return;
        if (minCount === best.workerCount) {
          const usedIds = available.filter((id) => (bits.get(id)! & used) !== 0n);
          const optimisticFree = available.filter((id) => (bits.get(id)! & used) === 0n)
            .slice(0, minCount - count);
          const optimisticWorkforce = [...fixedIds, ...usedIds, ...optimisticFree];
          const workforceOrder = compareLists(optimisticWorkforce, workers(best.assignments));
          if (workforceOrder > 0) return;
          if (workforceOrder === 0) {
            const targetMask = optimisticFree.reduce((mask, id) => mask | bits.get(id)!, 0n);
            const optimisticPlacement = new Map<string, string[]>();
            for (const room of rest) {
              let preferred: Team | undefined;
              for (const team of candidates.get(room.roomId)!) {
                if (!couldTie(room.roomId, team)) break;
                if (team.ids.length !== minimumCounts.get(room.roomId)
                  || (team.mask & targetMask) !== team.mask) continue;
                if (!preferred || compareLists([...fixed.get(room.roomId)!, ...team.ids],
                  [...fixed.get(room.roomId)!, ...preferred.ids]) < 0) preferred = team;
              }
              if (!preferred) return;
              optimisticPlacement.set(room.roomId, [...fixed.get(room.roomId)!, ...preferred.ids]);
            }
            let placementOrder = 0;
            for (const room of rooms) {
              placementOrder = compareLists(optimisticPlacement.get(room.roomId)
                ?? assigned.get(room.roomId)!.filter((id): id is string => id != null),
              best.assignments.get(room.roomId)!.filter((id): id is string => id != null));
              if (placementOrder !== 0) break;
            }
            if (placementOrder >= 0) return;
          }
        }
      }

      const room = ordered[index]!;
      for (const team of candidates.get(room.roomId)!) {
        checkCancel();
        if ((team.mask & used) !== 0n) continue;
        selected.set(room.roomId, team);
        // Lists are score-sorted; once this loose bound loses, all following
        // teams lose too. Descendants tighten it against the updated used set.
        if (sumScores(maxima) < options.best().score - 1e-12) break;
        put(room, team.ids);
        search(index + 1, used | team.mask, count + team.ids.length);
      }
      selected.delete(room.roomId);
      put(room, []);
    };
    options.phase("Searching assignments");
    search(0, controlTeam.mask, fixedIds.length + controlTeam.ids.length);
    for (const room of productive) put(room, []);
    options.rootComplete();
  }
}
