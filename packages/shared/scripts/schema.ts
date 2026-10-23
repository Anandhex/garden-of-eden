/**
 * `npm run schema`: the view protocol (G5) as JSON Schema, for adapters in other languages (Unity's C#, Unreal's
 * C++): generate their types from protocol/schema/*.json with any JSON Schema code generator. The zod schemas in
 * src/view/schema.ts are the source; a test fails if the committed files fall behind them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { schemaFiles } from "../src/view/jsonSchema.js";

const out = fileURLToPath(new URL("../../../protocol/schema/", import.meta.url));
mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(schemaFiles())) {
  writeFileSync(`${out}${name}`, text);
  console.log(`wrote protocol/schema/${name}`);
}
