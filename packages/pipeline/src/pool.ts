/**
 * Minimal concurrency pool for the embarrassingly-parallel pipeline stages
 * (throughput plan O3). Order of completion is not guaranteed; workers must
 * be independent. Errors are collected, not thrown — stages stay per-item
 * fault-tolerant and rerunnable.
 */
export async function runPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
): Promise<{ ok: number; failed: number }> {
  let next = 0;
  let ok = 0;
  let failed = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        try {
          await worker(items[index]!, index);
          ok++;
        } catch (err) {
          failed++;
          console.log(`  item ${index} FAILED: ${err instanceof Error ? err.message : err}`);
        }
      }
    },
  );
  await Promise.all(lanes);
  return { ok, failed };
}
