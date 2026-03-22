export function createOptimizerWorker(): Worker {
  return new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
}
