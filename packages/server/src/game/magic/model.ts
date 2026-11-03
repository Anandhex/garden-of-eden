import { readFileSync } from "node:fs";
import { z } from "zod";
import type { PersonRow } from "../../store/peopleStore.js";
import { unitFor } from "../dice.js";
import type { Realm } from "../realm/types.js";
import { policyAt } from "../realm/policy.js";

/**
 * Magic (N51) as data and rules. A person's **gift** (0 none, 1 faint, 2 real, 3 strong, 4 great) is on their row (`people.gift`, JSON
 * with the schools they've learned to a rank, who taught them, whether it has shown, whether they hide it, and corruption from forbidden
 * schools); most are 0 and never know. Schools and spells are `data/magic/*.json`. Each kingdom has a law per school (`magic:<school>`:
 * licensed, taxed, crown, banned, burned); a school's spells share its policy key (all four elements are `elemental`).
 */
const SchoolSchema = z.object({ id: z.string(), words: z.string(), forbidden: z.boolean(), policy: z.string(), strongAt: z.array(z.string()) });
const SpellSchema = z.object({
  id: z.string(),
  name: z.string(),
  school: z.string(),
  rank: z.number().int().min(1).max(4),
  cost: z.object({ mp: z.number().min(0), minutes: z.number().min(0), risk: z.number().min(0).max(1), reagents: z.array(z.object({ item: z.string(), qty: z.number().int().min(1) })).optional() }),
  effect: z.object({ kind: z.enum(["heal", "cure", "damage", "shield", "reveal", "charm", "scry", "grow", "calm_beast", "raise_dead", "curse", "ward_place", "illusion"]), magnitude: z.number(), duration: z.number().optional() }),
});
export type School = z.infer<typeof SchoolSchema>;
export type Spell = z.infer<typeof SpellSchema>;

let SCHOOLS: School[] | null = null;
let SPELLS: Spell[] | null = null;
const load = <T>(file: string, schema: z.ZodType<T>): T => schema.parse(JSON.parse(readFileSync(new URL(`../../data/magic/${file}`, import.meta.url), "utf8")));
export const schools = (): School[] => (SCHOOLS ??= load("schools.json", z.object({ schools: z.array(SchoolSchema) })).schools);
export function spells(): Spell[] {
  if (SPELLS) return SPELLS;
  const list = load("spells.json", z.object({ spells: z.array(SpellSchema) })).spells;
  const known = new Set(schools().map((s) => s.id));
  for (const sp of list) if (!known.has(sp.school)) throw new Error(`spell ${sp.id}: no school "${sp.school}"`);
  return (SPELLS = list);
}
export const schoolById = (id: string): School | undefined => schools().find((s) => s.id === id);
export const spellById = (id: string): Spell | undefined => spells().find((s) => s.id === id);

/** Check spell data (check-npcs): every spell's school exists and its numbers are in range. Returns problems. */
export function checkSpells(raw: unknown): string[] {
  const r = z.object({ spells: z.array(SpellSchema) }).safeParse(raw);
  if (!r.success) return r.error.issues.map((i) => `spells.${i.path.join(".")}: ${i.message}`);
  const known = new Set(schools().map((s) => s.id));
  return r.data.spells.filter((s) => !known.has(s.school)).map((s) => `spell ${s.id}: no school "${s.school}"`);
}

export interface Gift {
  gift: number;
  schools: Record<string, number>;
  shown?: number;
  teacher?: string;
  hidden?: boolean;
  corruption?: number;
  /** A hedge witch, a court wizard, a battle mage: what they are to their place. */
  role?: "hedge" | "court" | "battle" | "guild";
}

export function giftOf(r: Pick<PersonRow, "gift">): Gift | null {
  if (!r.gift) return null;
  try {
    return JSON.parse(r.gift) as Gift;
  } catch {
    return null;
  }
}
export const giftCell = (g: Gift): string => JSON.stringify(g);

/** The gift someone is born with: rare, likelier for a gifted parent's child. About 1 in 30 has some, 1 in 2,000 a great one. */
export function rollGift(seed: number, id: string, parentGift = 0): number {
  const u = unitFor(seed, "gift", id) / (1 + parentGift * 1.5);
  return u < 0.0005 ? 4 : u < 0.003 ? 3 : u < 0.01 ? 2 : u < 0.035 ? 1 : 0;
}

/** A school's law where someone stands. */
export const lawOfSchool = (realm: Realm, site: string, school: string, day: number): string => policyAt(realm, site, `magic:${schoolById(school)?.policy ?? school}`, day);
/** Is casting a school a crime here (banned, or burned)? */
export const forbiddenHere = (realm: Realm, site: string, school: string, day: number): boolean => {
  const law = lawOfSchool(realm, site, school, day);
  return law === "banned" || law === "burned";
};

/** How strong magic is at a place, 0..2: its buildings and land for the school, and a dungeon near. */
export function magicAt(realm: Realm, site: string, school: string): number {
  const s = realm.settlements[site];
  if (!s) return 1;
  const sc = schoolById(school);
  let m = 1;
  for (const k of sc?.strongAt ?? []) if ((s.buildings as Record<string, number>)[k] || s.terrain === k) m += 0.3;
  if (Object.values(realm.dungeons).some((d) => d.near === site)) m += 0.2;
  return Math.min(2, m);
}

export interface MagicState {
  /** Figures who are mages: their schools and what they are (court wizard, battle mage). */
  mages: Record<string, { schools: Record<string, number>; role: "court" | "battle" | "guild" | "hedge"; kingdom?: string }>;
  /** The court wizards' divinations: what they foresaw, for whom, when. */
  divinations: Array<{ kingdom: string; wizard: string; means: string; why: string; day: number }>;
}
export function magicOf(realm: Realm): MagicState {
  const soc = (realm.society ??= {});
  return (soc.magic ??= { mages: {}, divinations: [] }) as MagicState;
}
export const peekMagic = (realm: Realm): MagicState | undefined => realm.society?.magic as MagicState | undefined;

/** A battle mage's worth to a side (N51 decision 9): +8% each, never more than +15% in all. */
export function mageBonus(realm: Realm, fighters: ReadonlyArray<{ id: string }>): number {
  const m = peekMagic(realm)?.mages ?? {};
  const n = fighters.filter((f) => m[f.id]?.role === "battle").length;
  return 1 + Math.min(0.15, 0.08 * n);
}
