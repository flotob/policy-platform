import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { contractRegistry } from "../src/index.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(contractRegistry)) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
  const path = join(outDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(jsonSchema, null, 2) + "\n");
  console.log(`emitted ${path}`);
}
