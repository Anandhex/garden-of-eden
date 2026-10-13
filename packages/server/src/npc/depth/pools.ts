import { readFileSync } from "node:fs";
import { z } from "zod";
import { DilemmaSchema } from "../../game/dilemmas.js";
import { parseItem } from "../../game/items.js";
import { TRAITS } from "../traits.js";
import type { FactsSheet } from "./facts.js";
import type { NpcPersona } from "../types.js";

/**
 * The pools the code fallback draws from (N25a step 5c): phrases by job, trait, class and kind of fact, in
 * data/templates/depth/*.json. No people are named in them. Everything a pool entry says is a template
 * ({name}, {creditor}...) filled from the facts sheet.
 */
const DIR = new URL("../../data/templates/depth/", import.meta.url);

const range = z.tuple([z.number(), z.number()]);
export const FACT_TAGS = ["loss:beast", "loss:raid", "loss:illness", "loss:famine", "loss:battle", "loss:siege", "loss:any", "raided", "famine", "war", "debt", "gang", "faction", "family", "child", "spouse", "poor", "rich"] as const;

/** When a pool entry applies: every field given must hold. */
export const WhenSchema = z
  .object({
    job: z.array(z.string()).optional(),
    law: z.array(z.enum(["free", "serf", "slave"])).optional(),
    cls: z.array(z.string()).optional(),
    fact: z.array(z.enum(FACT_TAGS)).optional(),
    elder: z.boolean().optional(),
    young: z.boolean().optional(),
    traits: z.partialRecord(z.enum(TRAITS), range).optional(),
  })
  .strict();
export type When = z.infer<typeof WhenSchema>;

const TriggerEntry = z.object({ when: WhenSchema, name: z.string().min(1), words: z.array(z.string().min(1)).min(1), because: z.string().optional(), item: z.string().optional() }).strict();
const QuirkEntry = z.object({ when: WhenSchema, quirk: z.object({ when: z.record(z.string(), z.unknown()), line: z.string().min(1) }) }).strict();
const SecretEntry = z.object({ kind: z.string(), about: z.string(), text: z.string(), cover: z.string(), keywords: z.array(z.string()).min(1) }).strict();
const ArcEntry = z
  .object({
    kind: z.string(),
    requires: WhenSchema,
    id: z.string(),
    name: z.string(),
    stages: z.array(z.object({ id: z.string(), line: z.string(), after: z.number().int().optional(), journal: z.string().optional() })).min(2),
  })
  .strict();
const ReputationEntry = z.object({ when: WhenSchema, text: z.string(), truth: z.enum(["true", "exaggerated", "false"]), keywords: z.array(z.string()).min(1) }).strict();

export interface Pools {
  fears: Array<z.infer<typeof TriggerEntry>>;
  loves: Array<z.infer<typeof TriggerEntry>>;
  quirks: Array<z.infer<typeof QuirkEntry>>;
  secrets: Array<z.infer<typeof SecretEntry>>;
  dilemmas: Array<{ kind: string; requires: When; id: string; offer: string; keywords: string[]; minTrust?: number; options: unknown[] }>;
  arcs: Array<z.infer<typeof ArcEntry>>;
  reputation: Array<z.infer<typeof ReputationEntry>>;
}

let cache: Pools | null = null;

function read<T>(file: string, schema: z.ZodType<T>): T[] {
  const r = z.array(schema).safeParse(JSON.parse(readFileSync(new URL(file, DIR), "utf8")));
  if (!r.success) throw new Error(`data/templates/depth/${file} is invalid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

/** Every pool (cached), checked: unknown items and dilemma shapes fail here, not in play. */
export function loadPools(): Pools {
  if (cache) return cache;
  const pools: Pools = {
    fears: read("fears.json", TriggerEntry),
    loves: read("loves.json", TriggerEntry),
    quirks: read("quirks.json", QuirkEntry),
    secrets: read("secrets.json", SecretEntry),
    dilemmas: read("dilemmas.json", z.any()) as Pools["dilemmas"],
    arcs: read("arcs.json", ArcEntry),
    reputation: read("reputation.json", ReputationEntry),
  };
  for (const e of [...pools.loves, ...pools.fears]) if (e.item && !parseItem(e.item)) throw new Error(`data/templates/depth: unknown item "${e.item}"`);
  for (const d of pools.dilemmas) {
    const r = DilemmaSchema.safeParse({ id: d.id, offer: d.offer, keywords: d.keywords, ...(d.minTrust !== undefined ? { minTrust: d.minTrust } : {}), options: d.options });
    if (!r.success) throw new Error(`data/templates/depth/dilemmas.json: ${d.id}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    z.object({ requires: WhenSchema }).parse(d);
  }
  cache = pools;
  return pools;
}

/** The tags of fact the sheet bears out. */
export function tagsOf(sheet: FactsSheet): Set<string> {
  const tags = new Set<string>();
  for (const r of sheet.family) {
    if (r.kind === "child") tags.add("child");
    if (r.kind === "spouse") tags.add("spouse");
    if (r.kind !== "spouse") tags.add("family");
    if (!r.alive && r.cause) {
      tags.add("loss:any");
      const c = r.cause;
      tags.add(/beast/.test(c) ? "loss:beast" : /raid/.test(c) ? "loss:raid" : /illness|fever/.test(c) ? "loss:illness" : /hunger/.test(c) ? "loss:famine" : /battle/.test(c) ? "loss:battle" : /siege/.test(c) ? "loss:siege" : "loss:other");
    }
  }
  if (sheet.conditions.some((c) => /raided/.test(c))) tags.add("raided");
  if (sheet.conditions.some((c) => /nearly empty/.test(c))) tags.add("famine");
  if (sheet.conditions.some((c) => /at war/.test(c))) tags.add("war");
  if (sheet.secrets.some((s) => s.kind === "debt")) tags.add("debt");
  if (sheet.faction) tags.add("faction");
  if (sheet.faction?.kind === "gang") tags.add("gang");
  if (sheet.wealth < 400) tags.add("poor");
  if (sheet.wealth > 4000) tags.add("rich");
  return tags;
}

/** Does a pool entry's condition hold for this person? */
export function holds(when: When, sheet: FactsSheet, persona: NpcPersona, tags: Set<string> = tagsOf(sheet)): boolean {
  if (when.job && !when.job.includes(sheet.job)) return false;
  if (when.law && !when.law.includes(sheet.law)) return false;
  if (when.cls && !when.cls.includes(sheet.cls)) return false;
  if (when.fact && !when.fact.some((f) => tags.has(f))) return false;
  if (when.elder !== undefined && when.elder !== sheet.age >= 55) return false;
  if (when.young !== undefined && when.young !== sheet.age < 18) return false;
  for (const [trait, [lo, hi]] of Object.entries(when.traits ?? {})) {
    const v = persona.traits?.[trait as keyof NonNullable<NpcPersona["traits"]>] ?? 0.5;
    if (v < lo || v > hi) return false;
  }
  return true;
}
