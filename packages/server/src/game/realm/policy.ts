import { unitFor } from "../dice.js";
import { realmNews } from "./log.js";
import type { Figure, Kingdom, Realm } from "./types.js";
import { stanceOf } from "../../world/species.js";

/**
 * Kingdom policies (plans README section 14, built in N45): one mechanism for every law a ruler picks, can change, and that play follows.
 * Inheritance, divorce and who arranges marriages (N45), punishments and judges (N48), the state faith and heresy (N50), magic by school
 * (N51), other peoples (N54), levies (N55), the answer to unrest, curfews and crackdowns (N47, N58), runaways from each neighbour (N59).
 *
 * A key is declared once in `POLICY_KEYS` with its values, its default and how a ruler scores each value, so the admin view lists every
 * kingdom's laws in one table. A kingdom's law is `kingdom.policy[key]` once set, else what its first ruler would have chosen (worked out
 * from the seed, so it is the same before and after the first day). A change is always realm news (kind "policy") with a why that names
 * the pressure; `until` makes a law temporary (a curfew runs out unless renewed).
 */

export interface PolicyEntry {
  value: string;
  since: number;
  until?: number;
  why: string;
}

/** What the ruler is like, as laws read it (0..1 each). */
export interface RulerLean {
  harsh: number;
  pious: number;
  greedy: number;
  bold: number;
  proud: number;
}

export interface PolicyDef {
  values: readonly string[];
  default: string;
  /** How much a ruler like this wants each value (higher is likelier); the kingdom's own laws (slavery, serfdom) lean it. */
  score(value: string, r: RulerLean, k: Kingdom): number;
  /** Words for the admin table and the news: "the eldest child inherits". */
  words: Record<string, string>;
}

const by = (m: Record<string, (r: RulerLean, k: Kingdom) => number>) => (v: string, r: RulerLean, k: Kingdom) => m[v]?.(r, k) ?? 0;
const unfree = (k: Kingdom) => (k.laws.slavery ? 1 : k.laws.serfdom ? 0.6 : 0);

/** The other peoples a kingdom has a law for (N54). */
export const LIVING_PEOPLES = ["goblin", "orc", "dwarf", "elf", "ogre", "centaur", "lizardfolk"] as const;

export const MAGIC_SCHOOLS = ["healing", "elemental", "illusion", "divination", "warding", "beast", "necromancy", "blood"] as const;
export type MagicSchool = (typeof MAGIC_SCHOOLS)[number];

export const POLICY_KEYS: Record<string, PolicyDef> = {
  // ---- N45: families ----
  inheritance: {
    values: ["eldest", "eldest_son", "split", "chosen"],
    default: "eldest",
    score: by({ eldest: () => 0.5, eldest_son: (r, k) => 0.2 + 0.5 * unfree(k) + 0.3 * r.proud, split: (r, k) => 0.5 - 0.4 * unfree(k) + 0.2 * (1 - r.greedy), chosen: (r) => 0.25 + 0.3 * r.bold }),
    words: { eldest: "the eldest child inherits", eldest_son: "the eldest son inherits", split: "an estate is split among the children", chosen: "an estate goes where the will says" },
  },
  divorce: {
    values: ["forbidden", "church", "allowed"],
    default: "church",
    score: by({ forbidden: (r) => 0.2 + 0.6 * r.pious, church: () => 0.5, allowed: (r, k) => 0.35 + 0.3 * (1 - r.pious) - 0.2 * unfree(k) }),
    words: { forbidden: "a marriage is for life", church: "a marriage may be ended by a priest", allowed: "a marriage may be ended" },
  },
  marriage_by: {
    values: ["family", "free"],
    default: "family",
    score: by({ family: (r, k) => 0.4 + 0.3 * unfree(k) + 0.2 * r.proud, free: (r, k) => 0.45 - 0.3 * unfree(k) }),
    words: { family: "families arrange marriages", free: "people marry whom they choose" },
  },
  // ---- N48: law and trials ----
  punishments: {
    values: ["harsh", "middling", "lenient"],
    default: "middling",
    score: by({ harsh: (r, k) => 0.15 + 0.6 * r.harsh + 0.4 * unfree(k), middling: () => 0.5, lenient: (r, k) => 0.5 * (1 - r.harsh) - 0.5 * unfree(k) + 0.1 }),
    words: { harsh: "punishments are harsh", middling: "punishments fit the crime", lenient: "punishments are light" },
  },
  class_weight: {
    values: ["strong", "some", "equal"],
    default: "some",
    score: by({ strong: (r, k) => 0.2 + 0.4 * r.proud + 0.4 * unfree(k), some: () => 0.5, equal: (r, k) => 0.4 - 0.5 * unfree(k) + 0.2 * (1 - r.proud) }),
    words: { strong: "a noble's word outweighs a commoner's", some: "rank weighs on a court", equal: "every word weighs the same in court" },
  },
  // ---- N50: belief ----
  heresy: {
    values: ["persecute", "tolerate"],
    default: "tolerate",
    score: by({ persecute: (r, k) => 0.05 + 0.4 * r.pious + 0.25 * r.harsh + 0.15 * unfree(k), tolerate: (r) => 0.6 - 0.2 * r.pious }),
    words: { persecute: "heresy is hunted", tolerate: "other faiths are let be" },
  },
  // ---- N54: other peoples ----
  peoples: {
    values: ["welcome", "tolerated", "shunned"],
    default: "tolerated",
    score: by({ welcome: (r, k) => 0.35 - 0.3 * unfree(k) + 0.2 * r.bold, tolerated: () => 0.5, shunned: (r) => 0.15 + 0.4 * r.proud + 0.2 * r.harsh }),
    words: { welcome: "other peoples are welcome", tolerated: "other peoples are tolerated", shunned: "other peoples are shunned" },
  },
  // ---- N55: armies ----
  levy: {
    values: ["light", "heavy"],
    default: "light",
    score: by({ light: () => 0.5, heavy: (r) => 0.2 + 0.4 * r.bold + 0.3 * r.harsh }),
    words: { light: "one in twenty is levied in war", heavy: "one in ten is levied in war" },
  },
  // ---- N47, N58: order ----
  unrest: {
    values: ["concede", "repress", "ignore"],
    default: "ignore",
    score: by({ concede: (r) => 0.45 * (1 - r.harsh) + 0.1, repress: (r, k) => 0.2 + 0.5 * r.harsh + 0.2 * unfree(k), ignore: (r) => 0.3 + 0.2 * r.greedy }),
    words: { concede: "unrest is met with concessions", repress: "unrest is put down", ignore: "unrest is ignored" },
  },
  curfew: {
    values: ["none", "dusk"],
    default: "none",
    score: by({ none: () => 1, dusk: () => 0 }),
    words: { none: "no curfew", dusk: "a curfew from dusk" },
  },
  crackdown: {
    values: ["off", "on"],
    default: "off",
    score: by({ off: () => 1, on: () => 0 }),
    words: { off: "the watch keeps its usual round", on: "the watch is cracking down" },
  },
};

const MAGIC_POLICY: PolicyDef = {
  values: ["licensed", "taxed", "monopoly", "banned", "burned"],
  default: "licensed",
  score: by({ licensed: (r) => 0.45 * (1 - r.pious) + 0.1, taxed: (r) => 0.2 + 0.4 * r.greedy, monopoly: (r) => 0.1 + 0.3 * r.proud + 0.2 * r.greedy, banned: (r) => 0.1 + 0.4 * r.pious, burned: (r, k) => 0.05 + 0.4 * r.pious * r.harsh + 0.1 * unfree(k) }),
  words: { licensed: "licensed", taxed: "licensed and taxed", monopoly: "for the crown's mages alone", banned: "banned", burned: "burned as witchcraft" },
};

const RUNAWAY_POLICY: PolicyDef = {
  values: ["return", "shelter"],
  default: "return",
  score: by({ return: (r, k) => 0.3 + 0.5 * unfree(k), shelter: (r, k) => 0.5 - 0.5 * unfree(k) }),
  words: { return: "runaways are sent back", shelter: "runaways are sheltered" },
};

const FAITH_POLICY: PolicyDef = { values: [], default: "none", score: () => 0, words: {} };

/** How a kingdom treats another people living in it (N54 decision 7): its people's stance toward them leans the choice. */
function speciesPolicy(species: string): PolicyDef {
  return {
    values: ["welcome", "limited", "slaves_only", "banned"],
    default: "limited",
    score: (v, r, k) => {
      const stance = stanceOf(k.species ?? "human", species) / 100;
      if (v === "welcome") return 0.3 + stance * 0.6 - 0.2 * r.proud;
      if (v === "limited") return 0.45;
      if (v === "slaves_only") return k.laws.slavery ? 0.35 - stance * 0.5 + 0.2 * r.harsh : -9;
      return 0.1 - stance * 0.5 + 0.2 * r.harsh;
    },
    words: { welcome: `${species}s are welcome`, limited: `${species}s may live in the outer quarters, unarmed and taxed`, slaves_only: `${species}s may be kept only as slaves`, banned: `${species}s are banned and hunted` },
  };
}

/** The declaration of a key, including the per-school (`magic:<school>`), per-neighbour (`runaways:<k>`) and faith (`state_faith`) keys. */
export function policyDef(key: string): PolicyDef | undefined {
  if (POLICY_KEYS[key]) return POLICY_KEYS[key];
  if (key.startsWith("magic:")) {
    const school = key.slice(6);
    // The forbidden schools start banned or worse almost everywhere.
    if (school === "necromancy" || school === "blood") return { ...MAGIC_POLICY, default: "banned", score: (v, r, k) => (v === "licensed" || v === "taxed" ? 0.02 : MAGIC_POLICY.score(v, r, k) + (v === "banned" ? 0.4 : 0)) };
    return MAGIC_POLICY;
  }
  if (key.startsWith("runaways:")) return RUNAWAY_POLICY;
  if (key === "state_faith") return FAITH_POLICY;
  if (key.startsWith("species:")) return speciesPolicy(key.slice(8));
  return undefined;
}

/** The keys every kingdom has a law for (what the admin table lists). Per-neighbour keys are added for each other kingdom. */
export function policyKeysOf(realm: Realm, k: Kingdom): string[] {
  const others = Object.keys(realm.kingdoms).filter((id) => id !== k.id).sort();
  return [...Object.keys(POLICY_KEYS), ...MAGIC_SCHOOLS.map((s) => `magic:${s}`), "state_faith", ...others.map((o) => `runaways:${o}`), ...LIVING_PEOPLES.map((sp) => `species:${sp}`)];
}

/** What a ruler is like for laws (a figure's traits; a kingdom with no ruler leans on its own seed). */
export function rulerLean(realm: Realm, k: Kingdom, ruler: Figure | undefined = k.ruler ? realm.figures[k.ruler] : undefined): RulerLean {
  const u = (salt: string) => unitFor(realm.seed, "lean", k.id, ruler?.id ?? "none", salt);
  if (!ruler) return { harsh: u("harsh"), pious: u("pious"), greedy: u("greedy"), bold: u("bold"), proud: u("proud") };
  return { harsh: 0.6 * (1 - ruler.loyalty) + 0.4 * u("harsh"), pious: u("pious"), greedy: ruler.greed, bold: ruler.bravery, proud: 0.5 * ruler.ambition + 0.5 * u("proud") };
}

/** The value a ruler like this picks for a key: the best score, with a little of the ruler's own dice so kingdoms differ. */
export function pickValue(realm: Realm, k: Kingdom, key: string, lean: RulerLean, salt: string | number): string {
  const def = policyDef(key);
  if (!def || def.values.length === 0) return def?.default ?? "";
  let best = def.default;
  let top = -Infinity;
  for (const v of def.values) {
    const s = def.score(v, lean, k) + 0.25 * unitFor(realm.seed, "policy", k.id, key, v, salt);
    if (s > top) [best, top] = [v, s];
  }
  return best;
}

/** A kingdom's law on a key: what was set (and hasn't run out), else what it was born with. */
export function policyOf(realm: Realm, kingdomId: string | null | undefined, key: string, day = realm.day): string {
  const k = kingdomId ? realm.kingdoms[kingdomId] : undefined;
  const def = policyDef(key);
  if (!k) return def?.default ?? "";
  const e = k.policy?.[key];
  if (e && (e.until === undefined || e.until > day)) return e.value;
  if (e && e.until !== undefined) return def?.default ?? "";
  return bornWith(realm, k, key);
}

/** The law a kingdom was made with: its first ruler's pick, from the seed. Temporary laws start at their default. */
function bornWith(realm: Realm, k: Kingdom, key: string): string {
  const def = policyDef(key);
  if (!def) return "";
  if (key === "curfew" || key === "crackdown" || key === "state_faith") return def.default;
  return pickValue(realm, k, key, rulerLean(realm, k, undefined), "born");
}

/** The policy of the kingdom a place belongs to. */
export const policyAt = (realm: Realm, site: string, key: string, day = realm.day): string => policyOf(realm, realm.settlements[site]?.kingdom ?? null, key, day);

/** Something more that weighs on a ruler's decision of a law: value → added score, and the words for the why. */
export interface Pressure {
  pressures: Record<string, number>;
  why: string;
}
/** Pressures other phases add to every `decidePolicy` (N50 registers the court seer's reading). */
export const PRESSURES: Array<(realm: Realm, kingdom: string, key: string, day: number) => Pressure | null> = [];

export interface PolicyChange {
  kingdom: string;
  key: string;
  from: string;
  to: string;
  why: string;
}

/**
 * Set a law, with news and a why. `until`: a temporary law. Returns the change, or null when it was already so (a temporary law that is
 * renewed has its `until` moved on, quietly).
 */
export function setPolicy(realm: Realm, kingdomId: string, key: string, value: string, day: number, why: string, until?: number, opts: { quiet?: boolean } = {}): PolicyChange | null {
  const k = realm.kingdoms[kingdomId];
  if (!k) return null;
  const from = policyOf(realm, kingdomId, key, day);
  k.policy ??= {};
  if (from === value) {
    const cur = k.policy[key];
    if (cur && until !== undefined) cur.until = Math.max(cur.until ?? 0, until);
    else if (!cur) k.policy[key] = { value, since: day, why, ...(until !== undefined ? { until } : {}) };
    return null;
  }
  k.policy[key] = { value, since: day, why, ...(until !== undefined ? { until } : {}) };
  if (!opts.quiet) {
    const def = policyDef(key);
    const said = key.startsWith("magic:") ? `${key.slice(6)} magic is ${def?.words[value] ?? value}` : key.startsWith("runaways:") ? `runaways from ${realm.kingdoms[key.slice(9)]?.name ?? "abroad"} are ${value === "shelter" ? "sheltered" : "sent back"}` : (def?.words[value] ?? `${key}: ${value}`);
    realmNews(realm, day, k.capital, "policy", `In ${k.name}, from now on ${said}${until !== undefined ? ` (until day ${until})` : ""}: ${why}.`, 5, [], { why });
  }
  realm.stats.policyChanges = (realm.stats.policyChanges ?? 0) + 1;
  return { kingdom: kingdomId, key, from, to: value, why };
}

/**
 * A ruler weighs a key under pressure (README section 14's `decidePolicy`): their lean plus the pressure's push on values (`pressures`:
 * value → added score) against the law as it stands (which keeps a small edge: laws are not changed lightly). Changes it when another value
 * wins, with the why. Returns the change, or null.
 */
export function decidePolicy(realm: Realm, kingdomId: string, key: string, day: number, salt: string | number, pressures: Record<string, number> = {}, why = "", until?: number): PolicyChange | null {
  const k = realm.kingdoms[kingdomId];
  const def = policyDef(key);
  if (!k || !def || def.values.length === 0) return null;
  const lean = rulerLean(realm, k);
  const cur = policyOf(realm, kingdomId, key, day);
  // Whatever else weighs on the ruler (N50: a court seer's reading of an omen), with its words for the why.
  const extra = PRESSURES.map((f) => f(realm, kingdomId, key, day)).filter((x): x is Pressure => !!x);
  let best = cur;
  let top = -Infinity;
  for (const v of def.values) {
    const s = def.score(v, lean, k) + (pressures[v] ?? 0) + extra.reduce((a, x) => a + (x.pressures[v] ?? 0), 0) + (v === cur ? 0.2 : 0) + 0.15 * unitFor(realm.seed, "decide", k.id, key, v, salt);
    if (s > top) [best, top] = [v, s];
  }
  if (best === cur) return null;
  const ruler = k.ruler ? realm.figures[k.ruler] : undefined;
  const moved = extra.filter((x) => (x.pressures[best] ?? 0) > 0).map((x) => x.why);
  const base = why || `${ruler ? ruler.name : "the crown"} so decided`;
  return setPolicy(realm, kingdomId, key, best, day, moved.length > 0 ? `${base}, ${moved.join(", ")}` : base, until);
}

/**
 * The realm's day for laws: every kingdom's laws are written down on its first day (so the admin table shows them, and a change is a change
 * from something), temporary laws that ran out are struck, and a new ruler may change a law or two (each with news naming them).
 */
export function policyRealmDay(realm: Realm, day: number): void {
  for (const k of Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id))) {
    if (k.fallen) continue;
    if (!k.policy) {
      k.policy = {};
      for (const key of policyKeysOf(realm, k)) k.policy[key] = { value: policyOf(realm, k.id, key, day), since: day, why: "the law of the land since the kingdom began" };
      k.policyRuler = k.ruler ?? undefined;
      continue;
    }
    for (const [key, e] of Object.entries(k.policy)) {
      if (e.until !== undefined && e.until <= day) {
        const def = policyDef(key);
        delete k.policy[key];
        if (def) k.policy[key] = { value: def.default, since: day, why: `the ${key} ran out` };
      }
    }
    if ((k.ruler ?? undefined) !== k.policyRuler) {
      k.policyRuler = k.ruler ?? undefined;
      const ruler = k.ruler ? realm.figures[k.ruler] : undefined;
      if (!ruler) continue;
      // A new reign: each lasting law is weighed once; most stay as they were.
      for (const key of policyKeysOf(realm, k)) {
        if (key === "curfew" || key === "crackdown" || key === "state_faith") continue;
        if (unitFor(realm.seed, "reign", k.id, ruler.id, key) > 0.3) continue;
        decidePolicy(realm, k.id, key, day, ruler.id, {}, `${ruler.name} came to the throne and willed it so`);
      }
    }
  }
}
