import { it } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { openWorld } from "../src/game/openWorld.js";
import { Town } from "../src/game/town.js";
import { TABLES } from "../src/store/schema.js";
import { worldHash } from "../src/game/hash.js";
import { allPersonas, FakeProvider } from "./helpers.js";
function startTown(seed: number) {
  config.realmSeed = seed;
  const personas = allPersonas();
  const templates = loadCreatureTemplates();
  const store = new WorldStore(":memory:");
  const opened = openWorld({ file: "/nonexistent/world.json", deathsFile: "/nonexistent/deaths.json", personas, templates, store, fresh: true });
  return new Town({ personas, creatureTemplates: templates, world: opened.world, llm: new FakeProvider(), store });
}
it("diff", () => {
  if (process.env.SOC_OFF) for (const k of Object.keys(config.society)) (config.society as Record<string, boolean>)[k] = false;
  if (process.env.SOC_ONLY) for (const k of Object.keys(config.society)) (config.society as Record<string, boolean>)[k] = process.env.SOC_ONLY.split(",").includes(k);
  config.director = false; config.planning = false; config.summaries = false; config.realm = true;
  const a = startTown(3); const b = startTown(3);
  console.log("HASH0", worldHash(a.world, a.store!) === worldHash(b.world, b.store!));
  for (let d = 0; d < 12; d++) a.passHours(24);
  for (let d = 0; d < 12; d++) b.passHours(24);
  console.log("HASH1", worldHash(a.world, a.store!) === worldHash(b.world, b.store!));
  const ja = a.world.realm as any, jb = b.world.realm as any;
  for (const k of Object.keys(ja)) if (JSON.stringify(ja[k]) !== JSON.stringify(jb[k])) {
    console.log("REALM DIFF", k);
    if (k === "society" || k === "news" || k === "figures" || k === "settlements" || k === "kingdoms" || k === "factions") {
      const A = ja[k], B = jb[k];
      if (Array.isArray(A)) { for (let i = 0; i < Math.max(A.length, B.length); i++) if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) { console.log(" first", i, JSON.stringify(A[i])?.slice(0, 300), "\n vs  ", JSON.stringify(B[i])?.slice(0, 300)); break; } }
      else for (const kk of Object.keys({ ...A, ...B })) if (JSON.stringify(A[kk]) !== JSON.stringify(B[kk])) { console.log(" key", kk, JSON.stringify(A[kk])?.slice(0, 400), "\n vs ", JSON.stringify(B[kk])?.slice(0, 400)); break; }
    }
  }
  for (const t of Object.keys(TABLES)) { const x = JSON.stringify(a.store!.dumpTable(t as any)); const y = JSON.stringify(b.store!.dumpTable(t as any)); if (x !== y) console.log("TABLE DIFF", t, x.length, y.length); }
  const wa = a.world as any, wb = b.world as any;
  for (const k of Object.keys(wa)) if (k !== "realm" && JSON.stringify(wa[k]) !== JSON.stringify(wb[k])) console.log("WORLD DIFF", k);
  const la = new Set((wa.lore ?? []).map((x: any) => x.id)), lb = new Set((wb.lore ?? []).map((x: any) => x.id));
  console.log("LORE only a", [...la].filter((x) => !lb.has(x)).slice(0, 10), "only b", [...lb].filter((x) => !la.has(x)).slice(0, 10));
  for (const e of wa.lore ?? []) { const o = (wb.lore ?? []).find((x: any) => x.id === e.id); if (o && JSON.stringify(o) !== JSON.stringify(e)) { console.log("LORE DIFF", JSON.stringify(e).slice(0, 300), "\n VS", JSON.stringify(o).slice(0, 300)); break; } }
  const ea = wa.events ?? [], eb = wb.events ?? [];
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) if (JSON.stringify(ea[i]) !== JSON.stringify(eb[i])) { console.log("EVENT DIFF", i, JSON.stringify(ea[i])?.slice(0, 300), "\n VS", JSON.stringify(eb[i])?.slice(0, 300)); break; }
}, 600000);
