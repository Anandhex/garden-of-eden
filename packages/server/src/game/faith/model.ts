import { readFileSync } from "node:fs";
import { z } from "zod";
import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { seededRng, unitFor } from "../dice.js";
import { foundFaction } from "../realm/factions.js";
import type { Realm, RealmFaction } from "../realm/types.js";

/**
 * Belief (N50). A faith is a realm faction of kind `order` (an established church, one a kingdom) or `cult` (a small, often secret faith),
 * with a **creed** of tenets (`data/tenets/tenets.json`: each a few small score parts on the action menu, how its seers read an omen, and who
 * listens to its preachers), a deity, a holy site (the temple at its seat) and its festival (the season's festival day there). Kept in
 * `realm.society.faith`. Every person has a faith and a devotion (`people.faith`: `{ faith, devotion }`), from their place at first, from
 * their mother at birth, and by conversion after.
 */
const TenetSchema = z.object({ id: z.string(), words: z.string(), parts: z.record(z.string(), z.number().min(-0.3).max(0.3)), reading: z.string(), listens: z.string() });
export type Tenet = z.infer<typeof TenetSchema>;
let TENETS: Tenet[] | null = null;
export function tenets(): Tenet[] {
  return (TENETS ??= z.object({ tenets: z.array(TenetSchema) }).parse(JSON.parse(readFileSync(new URL("../../data/tenets/tenets.json", import.meta.url), "utf8"))).tenets);
}
export const tenetById = (id: string): Tenet | undefined => tenets().find((t) => t.id === id);

export interface Faith {
  id: string;
  tenets: string[];
  deity: string;
  /** The holy site (its seat). */
  holy: string | null;
  founded: number;
}

export interface Omen {
  id: string;
  day: number;
  kind: string;
  at: string | null;
  text: string;
}

export interface Reading {
  omen: string;
  /** What the seer says it means: "war", "peace", "purge", "repent", "order", "uprising", "harvest". */
  means: string;
  seer: string;
  faith: string | null;
  kingdom: string;
  day: number;
}

export interface FaithState {
  faiths: Record<string, Faith>;
  omens: Omen[];
  readings: Reading[];
  /** Missionaries on their way: a cult's member bound for another place, and when they get there. */
  missions: Array<{ faith: string; who: string; from: string; to: string; arrives: number; done?: boolean }>;
  next: number;
}

export function faithOf(realm: Realm): FaithState {
  const soc = (realm.society ??= {});
  return (soc.faith ??= { faiths: {}, omens: [], readings: [], missions: [], next: 0 }) as FaithState;
}
export const peekFaith = (realm: Realm): FaithState | undefined => realm.society?.faith as FaithState | undefined;

const DEITIES = ["the Lantern", "the Mother of Wells", "the Grey Judge", "the Sower", "the Hollow King", "the Twin Flames", "the Old Oak", "the Quiet Star"];

/** A person's faith and devotion (0..1), or null before their place gives them one. */
export function beliefOf(r: Pick<PersonRow, "faith">): { faith: string; devotion: number } | null {
  if (!r.faith) return null;
  try {
    return JSON.parse(r.faith) as { faith: string; devotion: number };
  } catch {
    return null;
  }
}
export const beliefCell = (faith: string, devotion: number): string => JSON.stringify({ faith, devotion: Math.round(Math.max(0, Math.min(1, devotion)) * 100) / 100 });

/** Faith factions living now. */
export const faithFactions = (realm: Realm): RealmFaction[] => Object.values(realm.factions).filter((f) => (f.kind === "order" || f.kind === "cult") && f.dissolved === undefined).sort((a, b) => a.id.localeCompare(b.id));

/**
 * The realm's faiths, made on its first day of them: each kingdom's church (an `order` seated at its capital, founded by a priest there or
 * the kingdom's most devout figure), and a cult or two in the towns, besides any order or cult the realm already had. Each gets its creed.
 */
export function ensureFaiths(realm: Realm, day: number): FaithState {
  const st = faithOf(realm);
  if (!config.society.belief) return st;
  const used = new Set(Object.values(realm.factions).map((f) => f.leader));
  const founderAt = (site: string) =>
    Object.values(realm.figures)
      .filter((f) => f.alive && f.home === site && !f.talks && !f.away && !used.has(f.id) && Object.values(realm.settlements).every((s) => s.leader !== f.id))
      .sort((a, b) => Number(b.role === "priest") - Number(a.role === "priest") || a.id.localeCompare(b.id))[0];
  for (const k of Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id))) {
    if (k.fallen) continue;
    if (faithFactions(realm).some((f) => f.kind === "order" && (f.seat ? realm.settlements[f.seat]?.kingdom === k.id : false))) continue;
    const founder = founderAt(k.capital);
    if (!founder) continue;
    used.add(founder.id);
    const fac = foundFaction(realm, seededRng(Math.floor(unitFor(realm.seed, "church", k.id) * 2 ** 31)), { kind: "order", founder, seat: k.capital, creed: "", why: `the faith of ${k.name}` }, day);
    delete fac.charter;
  }
  // A cult or two, in towns away from the capitals.
  const towns = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned && (s.kind === "town" || s.kind === "village") && !Object.values(realm.kingdoms).some((k) => k.capital === s.id)).sort((a, b) => a.id.localeCompare(b.id));
  const cults = faithFactions(realm).filter((f) => f.kind === "cult").length;
  for (let i = cults; i < 2 && towns.length > 0; i++) {
    const s = towns[Math.floor(unitFor(realm.seed, "cult-town", i) * towns.length)]!;
    const founder = founderAt(s.id);
    if (!founder) continue;
    used.add(founder.id);
    const fac = foundFaction(realm, seededRng(Math.floor(unitFor(realm.seed, "cult", i) * 2 ** 31)), { kind: "cult", founder, seat: s.id, creed: "", why: "a revelation" }, day);
    delete fac.charter;
  }
  // Creeds for every faith without one: two tenets, an order leaning to obedience or charity, a cult to purity, liberation or ascetic ways.
  const all = tenets().map((t) => t.id);
  for (const f of faithFactions(realm)) {
    if (st.faiths[f.id]) continue;
    const lean = f.kind === "order" ? ["obedience", "charity", "mercy", "prosperity", "martial"] : ["purity", "liberation", "ascetic", "martial", "charity"];
    const first = lean[Math.floor(unitFor(realm.seed, "tenet1", f.id) * lean.length)]!;
    const rest = all.filter((t) => t !== first && !(first === "mercy" && t === "martial") && !(first === "martial" && t === "mercy"));
    const second = rest[Math.floor(unitFor(realm.seed, "tenet2", f.id) * rest.length)]!;
    const deity = DEITIES[Math.floor(unitFor(realm.seed, "deity", f.id) * DEITIES.length)]!;
    st.faiths[f.id] = { id: f.id, tenets: [first, second], deity, holy: f.seat, founded: day };
    f.creed = `${tenetById(first)!.words}; ${tenetById(second)!.words}`;
  }
  return st;
}

/** The faith a place's people are born into: the church of its kingdom, or a faith seated or with a branch there. */
export function faithOfPlace(realm: Realm, site: string): string | null {
  const s = realm.settlements[site];
  const here = faithFactions(realm).filter((f) => f.seat === site || f.branches.includes(site));
  const church = faithFactions(realm).find((f) => f.kind === "order" && f.seat && realm.settlements[f.seat]?.kingdom === s?.kingdom);
  return (church ?? here.find((f) => f.kind === "order") ?? here[0] ?? faithFactions(realm).find((f) => f.kind === "order"))?.id ?? null;
}

/** The tenets of a person's faith, with their devotion, for the menu. */
export function tenetsOf(realm: Realm, r: Pick<PersonRow, "faith">): { tenets: string[]; devotion: number; faith: string } | null {
  const b = beliefOf(r);
  const f = b ? peekFaith(realm)?.faiths[b.faith] : undefined;
  return b && f ? { tenets: f.tenets, devotion: b.devotion, faith: b.faith } : null;
}
