/**
 * Run the machine's queued work once, without the server (the dev server's
 * worker does the same in the background). Usage (from apps/beteiligung):
 *   set -a && source .env.local && set +a && tsx scripts/drain.mts
 */
import { drain } from "../src/lib/worker.ts";

const n = await drain();
console.log(`${n} job(s) done`);
process.exit(0);
