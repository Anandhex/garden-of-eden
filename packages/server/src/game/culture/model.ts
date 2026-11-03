import { readFileSync } from "node:fs";
import { z } from "zod";
import { seedFrom, unitFor, type Rng } from "../dice.js";
import type { Realm } from "../realm/types.js";

/**
 * Cultures and languages (N53). Culture **templates** are data (`data/cultures/templates.json`, like species: no place is authored): name
 * syllables, greetings and honorifics, dishes and drinks, dress colours, the four festivals' names and customs, customs and taboos,
 * attitudes, and a tongue family. Each kingdom's culture is **generated** from a template picked by its capital's land, varied by the seed
 * (a custom or taboo swapped for a neighbour template's, the syllables shifted), so it is the same culture every time for a seed and
 * different from the next kingdom's. It is a pure function of the realm, written down in `realm.society.cultures` on the first day (and
 * for kingdoms born later, N64). Places drift toward their neighbours' cultures (`mix`).
 */
const TemplateSchema = z.object({
  id: z.string(),
  family: z.string(),
  terrain: z.array(z.string()),
  female: z.array(z.string()).min(5),
  male: z.array(z.string()).min(5),
  familyA: z.array(z.string()).min(3),
  familyB: z.array(z.string()).min(3),
  greetings: z.object({ up: z.string(), even: z.string(), down: z.string() }),
  honorifics: z.record(z.string(), z.string()),
  dishes: z.array(z.string()).min(2),
  drinks: z.array(z.string()).min(1),
  colours: z.array(z.string()).min(1),
  festivals: z.object({ spring: z.tuple([z.string(), z.string()]), summer: z.tuple([z.string(), z.string()]), autumn: z.tuple([z.string(), z.string()]), winter: z.tuple([z.string(), z.string()]) }),
  customs: z.array(z.string()),
  taboos: z.array(z.string()),
  attitudes: z.object({ strangers: z.enum(["warm", "wary", "hostile"]), classes: z.enum(["rigid", "loose"]) }),
});
export type Template = z.infer<typeof TemplateSchema>;

let TEMPLATES: Template[] | null = null;
export function templates(): Template[] {
  return (TEMPLATES ??= z.object({ templates: z.array(TemplateSchema).min(4) }).parse(JSON.parse(readFileSync(new URL("../../data/cultures/templates.json", import.meta.url), "utf8"))).templates);
}

export interface Culture {
  id: string;
  name: string;
  template: string;
  tongue: { id: string; family: string };
  female: string[];
  male: string[];
  families: string[];
  greetings: Template["greetings"];
  honorifics: Record<string, string>;
  dishes: string[];
  drinks: string[];
  colours: string[];
  festivals: Template["festivals"];
  customs: string[];
  taboos: string[];
  attitudes: Template["attitudes"];
}

/** A culture made from a template and a seed: varied a little (a custom and a taboo from another template, syllables shifted). */
export function generateCulture(id: string, name: string, t: Template, seed: number, other?: Template): Culture {
  const u = (k: string) => unitFor(seed, "culture", id, k);
  const rot = <T>(xs: T[], k: string) => {
    const n = Math.floor(u(k) * xs.length);
    return [...xs.slice(n), ...xs.slice(0, n)];
  };
  const families: string[] = [];
  for (const a of rot(t.familyA, "fa")) for (const b of rot(t.familyB, "fb")) families.push(`${a}${b}`);
  const customs = [...t.customs];
  const taboos = [...t.taboos];
  if (other && u("borrow") < 0.6) {
    customs[Math.floor(u("ci") * customs.length)] = other.customs[Math.floor(u("co") * other.customs.length)]!;
    taboos[Math.floor(u("ti") * taboos.length)] = other.taboos[Math.floor(u("to") * other.taboos.length)]!;
  }
  return {
    id,
    name,
    template: t.id,
    tongue: { id: `tongue:${id}`, family: t.family },
    female: rot(t.female, "f"),
    male: rot(t.male, "m"),
    families: families.slice(0, 24),
    greetings: t.greetings,
    honorifics: t.honorifics,
    dishes: rot(t.dishes, "d"),
    drinks: t.drinks,
    colours: t.colours,
    festivals: t.festivals,
    customs: [...new Set(customs)],
    taboos: [...new Set(taboos)],
    attitudes: t.attitudes,
  };
}

const memo = new WeakMap<object, Map<string, Culture>>();

/** A kingdom's culture: written down, or worked out from the seed (the same either way). */
export function cultureOfKingdom(realm: Realm, kingdomId: string): Culture | null {
  const saved = (realm.society?.cultures as Record<string, Culture> | undefined)?.[`c:${kingdomId}`];
  if (saved) return saved;
  const k = realm.kingdoms[kingdomId];
  if (!k) return null;
  let m = memo.get(realm.kingdoms);
  if (!m) memo.set(realm.kingdoms, (m = new Map()));
  const have = m.get(kingdomId);
  if (have) return have;
  const ts = templates();
  const land = realm.settlements[k.capital]?.terrain ?? "plains";
  const fits = ts.filter((t) => t.terrain.includes(land));
  // Neighbouring kingdoms rarely share a template: the kingdom's place in the list turns the choice.
  const order = Object.keys(realm.kingdoms).sort().indexOf(kingdomId);
  const pool = fits.length > 0 ? fits : ts;
  const t = order >= 0 && fits.length > 0 && unitFor(realm.seed, "culture-template", kingdomId) < 0.5 ? pool[order % pool.length]! : ts[(order + Math.floor(unitFor(realm.seed, "culture-any", kingdomId) * ts.length)) % ts.length]!;
  const other = ts[(ts.indexOf(t) + 1 + Math.floor(unitFor(realm.seed, "culture-other", kingdomId) * (ts.length - 1))) % ts.length];
  const c = generateCulture(`c:${kingdomId}`, `the ways of ${k.name}`, t, realm.seed, other);
  m.set(kingdomId, c);
  return c;
}

/** The culture of a place: its own kingdom's, or the nearest kingdom's for a free place. */
export function cultureAt(realm: Realm, site: string): Culture | null {
  const s = realm.settlements[site];
  if (!s) return null;
  if (s.kingdom) return cultureOfKingdom(realm, s.kingdom);
  const nearest = Object.values(realm.kingdoms).filter((k) => !k.fallen && realm.settlements[k.capital]).sort((a, b) => Math.hypot(realm.settlements[a.capital]!.pos.x - s.pos.x, realm.settlements[a.capital]!.pos.y - s.pos.y) - Math.hypot(realm.settlements[b.capital]!.pos.x - s.pos.x, realm.settlements[b.capital]!.pos.y - s.pos.y))[0];
  return nearest ? cultureOfKingdom(realm, nearest.id) : null;
}

/** A person's name in a culture: the same two draws as the realm's old name lists (so nothing else rolled changes). */
export function cultureName(c: Culture, rng: Rng, gender: "female" | "male"): string {
  const given = (gender === "female" ? c.female : c.male)[Math.floor(rng() * (gender === "female" ? c.female : c.male).length)]!;
  const fam = c.families[Math.floor(rng() * c.families.length)]!;
  return `${given} ${fam}`;
}
export function cultureGiven(c: Culture, rng: Rng, gender: "female" | "male"): string {
  const list = gender === "female" ? c.female : c.male;
  return list[Math.floor(rng() * list.length)]!;
}

/** How someone greets another by the gap in rank, with the culture's honorific. */
export function greeting(c: Culture, gap: number, theirCls: string): string {
  const title = c.honorifics[theirCls] ?? c.honorifics.default ?? "friend";
  return (gap > 0 ? c.greetings.up : gap < 0 ? c.greetings.down : c.greetings.even).replace("{title}", title);
}

/** The festival of a season in a culture: its name and its custom. */
export const festivalOf = (c: Culture, season: string): { name: string; custom: string } => {
  const f = c.festivals[season as keyof Culture["festivals"]] ?? c.festivals.summer;
  return { name: f[0], custom: f[1] };
};

/** What the inn serves: the culture's dishes and drinks (the place's mix may bring another's). */
export const innFare = (c: Culture): string[] => [...c.dishes.slice(0, 3), ...c.drinks.slice(0, 1)];

/**
 * How far apart two tongues are, 0 (the same) .. 1 (nothing in common): the same family is near.
 */
export function tongueDistance(a: Culture | null, b: Culture | null): number {
  if (!a || !b || a.id === b.id) return 0;
  if (a.tongue.family === b.tongue.family) return 0.35;
  return 0.8;
}

/** Write every kingdom's culture down (the first day; a kingdom born later gets its own the day it's founded). */
export function writeCultures(realm: Realm): void {
  const soc = (realm.society ??= {});
  const all = (soc.cultures ??= {}) as Record<string, Culture>;
  for (const k of Object.values(realm.kingdoms)) {
    const id = `c:${k.id}`;
    if (!all[id]) {
      const c = cultureOfKingdom(realm, k.id);
      if (c) all[id] = c;
    }
    k.culture = id;
  }
}

/** A stable small hash for a culture's word generator (a tongue's "seed"). */
export const tongueSeed = (c: Culture): number => seedFrom(c.tongue.id);

/** A culture by its id (`c:<kingdom>`), written down or worked out. */
export function cultureById(realm: Realm, id: string): Culture | null {
  return (realm.society?.cultures as Record<string, Culture> | undefined)?.[id] ?? (id.startsWith("c:") ? cultureOfKingdom(realm, id.slice(2)) : null);
}
