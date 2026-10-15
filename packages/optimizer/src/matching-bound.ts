/** Maximum weight one-to-one assignment. Missing columns are zero-value dummy
 * operators. Hungarian potentials keep this polynomial even for a full roster.
 */
export function maximumMatchingWeight(weights: number[][]): number {
  const rows = weights.length;
  if (rows === 0) return 0;
  const columns = Math.max(rows, weights[0]!.length);
  const rowPotential = new Float64Array(rows + 1);
  const columnPotential = new Float64Array(columns + 1);
  const matchedRow = new Int32Array(columns + 1);
  const previousColumn = new Int32Array(columns + 1);
  for (let row = 1; row <= rows; row += 1) {
    matchedRow[0] = row;
    const distances = new Float64Array(columns + 1).fill(Infinity);
    const used = new Uint8Array(columns + 1);
    let column = 0;
    do {
      used[column] = 1;
      const currentRow = matchedRow[column]!;
      let delta = Infinity;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= columns; candidate += 1) {
        if (used[candidate]) continue;
        const cost = -(weights[currentRow - 1]![candidate - 1] ?? 0)
          - rowPotential[currentRow]! - columnPotential[candidate]!;
        if (cost < distances[candidate]!) {
          distances[candidate] = cost;
          previousColumn[candidate] = column;
        }
        if (distances[candidate]! < delta) { delta = distances[candidate]!; nextColumn = candidate; }
      }
      for (let candidate = 0; candidate <= columns; candidate += 1) {
        if (used[candidate]) {
          rowPotential[matchedRow[candidate]!]! += delta;
          columnPotential[candidate]! -= delta;
        } else distances[candidate]! -= delta;
      }
      column = nextColumn;
    } while (matchedRow[column] !== 0);
    do {
      const previous = previousColumn[column]!;
      matchedRow[column] = matchedRow[previous]!;
      column = previous;
    } while (column !== 0);
  }
  let total = 0;
  for (let column = 1; column <= columns; column += 1) {
    if (matchedRow[column] !== 0) total += weights[matchedRow[column]! - 1]![column - 1] ?? 0;
  }
  return total;
}

/** Integer objective with exact secondary priorities encoded in low bits. */
export function maximumIntegerMatching(weights: bigint[][]): number[] {
  const rows = weights.length;
  if (rows === 0) return [];
  const columns = weights[0]!.length;
  const rowPotential = Array<bigint>(rows + 1).fill(0n);
  const columnPotential = Array<bigint>(columns + 1).fill(0n);
  const matchedRow = new Int32Array(columns + 1);
  const previousColumn = new Int32Array(columns + 1);
  for (let row = 1; row <= rows; row += 1) {
    matchedRow[0] = row;
    const distances: Array<bigint | undefined> = Array(columns + 1);
    const used = new Uint8Array(columns + 1);
    let column = 0;
    do {
      used[column] = 1;
      const currentRow = matchedRow[column]!;
      let delta: bigint | undefined;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= columns; candidate += 1) {
        if (used[candidate]) continue;
        const cost = -weights[currentRow - 1]![candidate - 1]! - rowPotential[currentRow]! - columnPotential[candidate]!;
        if (distances[candidate] === undefined || cost < distances[candidate]!) {
          distances[candidate] = cost; previousColumn[candidate] = column;
        }
        if (delta === undefined || distances[candidate]! < delta) { delta = distances[candidate]!; nextColumn = candidate; }
      }
      for (let candidate = 0; candidate <= columns; candidate += 1) {
        if (used[candidate]) { rowPotential[matchedRow[candidate]!]! += delta!; columnPotential[candidate]! -= delta!; }
        else if (distances[candidate] !== undefined) distances[candidate]! -= delta!;
      }
      column = nextColumn;
    } while (matchedRow[column] !== 0);
    do {
      const previous = previousColumn[column]!;
      matchedRow[column] = matchedRow[previous]!; column = previous;
    } while (column !== 0);
  }
  const result = Array<number>(rows).fill(-1);
  for (let column = 1; column <= columns; column += 1) {
    if (matchedRow[column] !== 0) result[matchedRow[column]! - 1] = column - 1;
  }
  return result;
}
