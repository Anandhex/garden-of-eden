import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The first hour's opening incidents (N39 decision 2): data in data/incidents/*.json, in the road situations' shape (actors, text,
 * choices with effects) with **needs** (what must already be true of the town for the incident to happen) and a **stage** (where it
 * breaks and how the player is pointed at it). Roles are bound by the needs to real people of the town; nothing is authored.
 */

export const NEED_KINDS = ["frail", "grievance", "thief", "stranger", "pack_near", "dues", "child", "carter", "arrival_due", "runaway", "noble", "drinkers"] as const;
export type NeedKind = (typeof NEED_KINDS)[number];

/** Where an incident can break: a place of the town's map (game/schedule.ts PLACES). */
export const STAGES = ["square", "gate", "inn", "forge"] as const;
export type Stage = (typeof STAGES)[number];

const Axes = { trust: z.number().optional(), affection: z.number().optional(), respect: z.number().optional(), fear: z.number().optional() };

export const IncidentEffectSchema: z.ZodType<IncidentEffect> = z.lazy(() =>
  z.object({
    type: z.enum(["say", "rel", "grievance", "favour", "money", "item", "hp", "xp", "reputation", "check", "time", "death", "standing", "fight", "settle"]),
    text: z.string().optional(),
    /** The role it is about (a key of the incident's bound actors). */
    who: z.string().optional(),
    /** For `rel` and `grievance`: toward whom ("player" or a role). For `favour`: who owes ("player" owes them, or "them"). */
    toward: z.string().optional(),
    owes: z.enum(["player", "them"]).optional(),
    weight: z.number().optional(),
    amount: z.number().optional(),
    item: z.string().optional(),
    qty: z.number().optional(),
    attr: z.string().optional(),
    target: z.number().optional(),
    success: z.array(IncidentEffectSchema).optional(),
    fail: z.array(IncidentEffectSchema).optional(),
    minutes: z.number().optional(),
    cause: z.string().optional(),
    chance: z.number().min(0).max(1).optional(),
    power: z.number().optional(),
    ...Axes,
  }),
);

export interface IncidentEffect {
  type: "say" | "rel" | "grievance" | "favour" | "money" | "item" | "hp" | "xp" | "reputation" | "check" | "time" | "death" | "standing" | "fight" | "settle";
  text?: string | undefined;
  who?: string | undefined;
  toward?: string | undefined;
  owes?: "player" | "them" | undefined;
  weight?: number | undefined;
  amount?: number | undefined;
  item?: string | undefined;
  qty?: number | undefined;
  attr?: string | undefined;
  target?: number | undefined;
  success?: IncidentEffect[] | undefined;
  fail?: IncidentEffect[] | undefined;
  minutes?: number | undefined;
  cause?: string | undefined;
  chance?: number | undefined;
  power?: number | undefined;
  trust?: number | undefined;
  affection?: number | undefined;
  respect?: number | undefined;
  fear?: number | undefined;
}

export const NeedSchema = z.object({
  kind: z.enum(NEED_KINDS),
  /** For `grievance`: the least weight a grudge must have now. */
  minWeight: z.number().min(0).max(1).optional(),
});
export type Need = z.infer<typeof NeedSchema>;

export const IncidentSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  /** How strong an opening it is (picking weighs it). */
  weight: z.number().min(0).max(5),
  /** Which of the living world's systems its choices reach: a grudge, a debt, a friendship. Picking prefers the ones that touch more. */
  touches: z.array(z.enum(["grievance", "debt", "friendship"])).min(1),
  needs: z.array(NeedSchema),
  stage: z.object({
    where: z.enum(STAGES),
    /** The one line that points the player at it at the start ("Shouting from the square."). */
    nudge: z.string().min(1),
    /** What is brought forward to break now, in words, for the log (why: "first hour"). Empty when nothing is. */
    bring: z.string().default(""),
  }),
  /** The roles of the people in it, in the order the needs bind them; `{role}` in the text is their name. */
  actors: z.array(z.string()).min(1),
  text: z.string().min(1),
  choices: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]+$/),
        label: z.string().min(1),
        requires: z.object({ money: z.number().optional(), item: z.string().optional() }).optional(),
        /** What the choice is, for the event and the gossip ("stepped in for {victim}"). */
        deed: z.string().min(1),
        effects: z.array(IncidentEffectSchema),
      }),
    )
    .min(2),
});
export type IncidentDef = z.infer<typeof IncidentSchema>;

const DIR = new URL("../../data/incidents/", import.meta.url);
let loaded: IncidentDef[] | null = null;

/** Every incident file, checked (`npm run check-npcs` runs this too). Throws on the first bad one, naming it. */
export function loadIncidents(dir: URL = DIR): IncidentDef[] {
  if (loaded && dir === DIR) return loaded;
  const out: IncidentDef[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const r = IncidentSchema.safeParse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    if (!r.success) throw new Error(`${f} is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    if (r.data.id !== f.replace(/\.json$/, "")) throw new Error(`${f}: the id is "${r.data.id}", which should be the file's name.`);
    const roles = new Set(r.data.actors);
    const check = (e: IncidentEffect, path: string) => {
      for (const k of [e.who, e.toward]) if (k && k !== "player" && k !== "head" && !roles.has(k)) throw new Error(`${f}: ${path} names "${k}", which is not one of its actors (${[...roles].join(", ")}).`);
      for (const x of [...(e.success ?? []), ...(e.fail ?? [])]) check(x, path);
    };
    for (const c of r.data.choices) c.effects.forEach((e, i) => check(e, `choice ${c.id} effect ${i}`));
    out.push(r.data);
  }
  if (out.length === 0) throw new Error("There are no opening incidents (data/incidents/).");
  if (!out.some((d) => d.needs.length === 0 || d.needs.every((n) => n.kind === "stranger"))) throw new Error("No incident can always happen: one must need only a stranger (the fallback).");
  if (dir === DIR) loaded = out;
  return out;
}
