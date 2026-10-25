/** Starts the machine's background worker with the server (KERN_WORKER=0 turns it off, e.g. for a second instance). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.KERN_WORKER !== "0") {
    const { startWorker } = await import("./lib/worker");
    startWorker();
  }
}
