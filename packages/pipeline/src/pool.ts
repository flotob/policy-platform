/**
 * Minimal concurrency pool for the embarrassingly-parallel pipeline stages
 * (throughput plan O3). Order of completion is not guaranteed; workers must
 * be independent. Errors are collected, not thrown — stages stay per-item
 * fault-tolerant and rerunnable.
 */
export interface PoolOptions<T> {
  /** Names the item in failure lines (window, point, map point …) — "item 17" says nothing afterwards. */
  label?: (item: T, index: number) => string;
  /** Prints "[name] done/total (pct) · elapsed" at every 10 % — long stages stay visibly alive. */
  progress?: string;
}

export async function runPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
  opts: PoolOptions<T> = {},
): Promise<{ ok: number; failed: number }> {
  let next = 0;
  let ok = 0;
  let failed = 0;
  let fatal: string | null = null;
  const started = Date.now();
  const step = Math.max(1, Math.ceil(items.length / 10));
  const report = () => {
    const done = ok + failed;
    if (!opts.progress || items.length < 10 || (done % step !== 0 && done !== items.length)) return;
    console.log(
      `  [${opts.progress}] ${done}/${items.length} (${Math.round((done / items.length) * 100)}%) · ` +
        `${Math.round((Date.now() - started) / 1000)}s${failed ? ` · ${failed} FAILED` : ""}`,
    );
  };
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        if (fatal) return;
        const index = next++;
        if (index >= items.length) return;
        try {
          await worker(items[index]!, index);
          ok++;
        } catch (err) {
          failed++;
          let what = `item ${index}`;
          try {
            if (opts.label) what = opts.label(items[index]!, index);
          } catch {
            /* a broken label must not hide the real error */
          }
          console.log(`  FAILED ${what}: ${err instanceof Error ? err.message : err}`);
          // A fatal error (e.g. invalid API key) would fail every item alike:
          // stop scheduling, count the rest as failed.
          if ((err as { fatal?: boolean } | null)?.fatal && !fatal) {
            fatal = err instanceof Error ? err.message : String(err);
            const rest = items.length - next;
            failed += Math.max(0, rest);
            next = items.length;
            console.log(`  FAILED — fatal error, ${rest} remaining items not attempted`);
          }
        }
        report();
      }
    },
  );
  await Promise.all(lanes);
  return { ok, failed };
}

/** Caps concurrent calls to one resource (e.g. LLM calls) across pools. */
export class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private free: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.queue.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.free++;
    }
  }
}
