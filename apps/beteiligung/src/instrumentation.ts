/** At server start: the machine's background worker (KERN_WORKER=0 turns it off, e.g. for a second instance) and the demo login. */
export async function register() {
  // The condition must wrap the imports: Next drops the branch from the edge build only this way.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.KERN_WORKER !== "0") {
      const { startWorker } = await import("./lib/worker");
      startWorker();
    }
    // The read-only demo login, if configured (lib/demo-login.ts): created or repaired at every start.
    const { ensureDemoLogin } = await import("./lib/demo-login");
    ensureDemoLogin().catch((e) => console.error("[demo-login]", (e as Error).message));
  }
}
