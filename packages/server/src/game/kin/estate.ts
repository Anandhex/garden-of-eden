import type { PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import { unitFor } from "../dice.js";
import { transfer } from "../realm/ledger.js";
import { realmNews } from "../realm/log.js";
import { policyAt } from "../realm/policy.js";
import type { Figure, Realm } from "../realm/types.js";
import { ageFrom, isGrown } from "../people/rules.js";
import { config } from "../../config.js";

/**
 * Estates and heirs (N45 decisions 2–3). When someone dies, what they held (a shop, land, a house they headed, coin, notable items, an
 * office that passes by blood) goes by their kingdom's inheritance law (`policyAt(…, "inheritance")`):
 *
 * - `eldest`: the first grown child; `eldest_son`: the first son, else the first daughter;
 * - `split`: coin and land shared among the grown children, the house, the shop and any office to the eldest;
 * - `chosen`: a will (`people.will`, made by those with an estate when they grow old), else the eldest.
 *
 * No children: the spouse, then brothers and sisters, then parents. One function for townsfolk rows and realm figures.
 */
export type Law = "eldest" | "eldest_son" | "split" | "chosen";

export interface Will {
  heir: string;
  day: number;
}

export const willOf = (r: Pick<PersonRow, "will">): Will | null => {
  if (!r.will) return null;
  try {
    return JSON.parse(r.will) as Will;
  } catch {
    return null;
  }
};

/** A person's kin in the order the law looks at them, living and grown only: children (by birth), then spouse, siblings, parents. */
export function kinInOrder(store: Pick<WorldStore, "people">, r: PersonRow, day: number): { children: PersonRow[]; rest: PersonRow[] } {
  const people = store.people;
  const living = (x: PersonRow | null | undefined): x is PersonRow => !!x && x.death === null && isGrown(x.species, ageFrom(x.born_day, day));
  const byBirth = (a: PersonRow, b: PersonRow) => a.born_day - b.born_day || a.id.localeCompare(b.id);
  const children = people.childrenOf(r.id).filter(living).sort(byBirth);
  const spouse = r.spouse ? people.get(r.spouse) : null;
  const parents = [r.mother, r.father].map((p) => (p ? people.get(p) : null));
  const siblings = new Map<string, PersonRow>();
  for (const p of parents) if (p) for (const c of people.childrenOf(p.id)) if (c.id !== r.id && living(c)) siblings.set(c.id, c);
  const rest = [spouse, ...[...siblings.values()].sort(byBirth), ...parents].filter(living);
  return { children, rest: [...new Map(rest.map((x) => [x.id, x])).values()] };
}

/** The heirs of a person under a law: the first is the heir to what can't be split; `shares` are those who split what can. */
export function heirsOf(store: Pick<WorldStore, "people">, r: PersonRow, law: Law, day: number): { heir: PersonRow | null; shares: PersonRow[]; order: PersonRow[] } {
  const { children, rest } = kinInOrder(store, r, day);
  let order = [...children];
  if (law === "eldest_son") order = [...children.filter((c) => c.gender === "male"), ...children.filter((c) => c.gender !== "male")];
  if (law === "chosen") {
    const w = willOf(r);
    const named = w ? [...children, ...rest].find((x) => x.id === w.heir) : undefined;
    if (named) order = [named, ...children.filter((c) => c.id !== named.id)];
  }
  order = [...order, ...rest.filter((x) => !order.some((o) => o.id === x.id))];
  const heir = order[0] ?? null;
  const shares = law === "split" && children.length > 1 ? children : heir ? [heir] : [];
  return { heir, shares, order };
}

/** The law where someone lived. */
export const lawAt = (realm: Realm, site: string, day = realm.day): Law => policyAt(realm, site, "inheritance", day) as Law;

/**
 * Put the order of the law on those who could take on a shop (N40's candidates: grown, of its trade, ranked): kin by the law first, then
 * the spouse, then whoever worked its front. The second of the law's kin who also wanted it is the rival a dispute may come from.
 */
export function lawfulCandidates(store: Pick<WorldStore, "people">, realm: Realm, dead: PersonRow, candidates: readonly PersonRow[], day: number, frontOf: (x: PersonRow) => boolean): PersonRow[] {
  const law = lawAt(realm, dead.site, day);
  const { order } = heirsOf(store, dead, law, day);
  const rank = new Map(order.map((x, i) => [x.id, i]));
  return [...candidates]
    .filter((x) => rank.has(x.id) || frontOf(x))
    .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || Number(frontOf(b)) - Number(frontOf(a)) || (b.skill ?? 0) - (a.skill ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Wills (decision 3): someone with something to leave makes one as they grow old, under a `chosen` law: the child they love most and think
 * most able (their feelings, their skill, a little of their own dice), which may not be the eldest.
 */
export function makeWill(store: Pick<WorldStore, "people" | "social">, realm: Realm, r: PersonRow, day: number): Will | null {
  const { children } = kinInOrder(store, r, day);
  if (children.length === 0) return null;
  let best = children[0]!;
  let top = -Infinity;
  for (const c of children) {
    const rel = store.social.rel(r.id, c.id);
    const s = (rel?.affection ?? 0) / 50 + (c.skill ?? 0) * 0.3 + unitFor(realm.seed, "will", r.id, c.id);
    if (s > top) [best, top] = [c, s];
  }
  const w = { heir: best.id, day };
  store.people.update(r.id, { will: JSON.stringify(w) });
  return w;
}

// ---- Realm figures (lords, captains, merchants): coin and the dead's purse ----

/** A figure's grown children among the living figures. */
export function figureChildren(realm: Realm, f: Figure): Figure[] {
  return Object.values(realm.figures)
    .filter((c) => c.alive && c.parents?.includes(f.id) && c.life.stage !== "young")
    .sort((a, b) => a.life.bornOnDay - b.life.bornOnDay || a.id.localeCompare(b.id));
}

/**
 * The realm's dead hand on their purse (decision 2, for figures): by the law where they lived, to their children (split, or to one), else
 * to the treasury of their home. Coin moves through the ledger. A younger child far better known than the eldest disputes it (`disputes`).
 * Returns the estates passed.
 */
export function figureEstatesDay(realm: Realm, day: number, store?: WorldStore): Array<{ from: string; to: string[]; amount: number }> {
  if (!config.society.feuds) return [];
  const out: Array<{ from: string; to: string[]; amount: number }> = [];
  for (const f of Object.values(realm.figures).sort((a, b) => a.id.localeCompare(b.id))) {
    if (f.alive || f.deathDay !== day || f.wealth <= 0) continue;
    const home = f.home ?? "";
    const law = home ? lawAt(realm, home, day) : "eldest";
    let kids = figureChildren(realm, f);
    if (law === "eldest_son") kids = [...kids.filter((k) => k.gender === "male"), ...kids.filter((k) => k.gender !== "male")];
    if (law === "chosen") kids = [...kids].sort((a, b) => b.renown - a.renown || a.id.localeCompare(b.id));
    const amount = f.wealth;
    if (kids.length === 0) {
      if (home && realm.settlements[home]) transfer(realm, `p:${f.id}`, `s:${home}`, amount, `inheritance of ${f.name}, who left no heir`, undefined, day);
      out.push({ from: f.id, to: home ? [`s:${home}`] : [], amount });
      continue;
    }
    const heirs = law === "split" ? kids : [kids[0]!];
    const each = Math.floor(amount / heirs.length);
    for (const h of heirs) transfer(realm, `p:${f.id}`, `p:${h.id}`, each, `inheritance from ${f.name}`, undefined, day);
    // What the split leaves over goes to the eldest.
    if (f.wealth > 0) transfer(realm, `p:${f.id}`, `p:${heirs[0]!.id}`, f.wealth, `inheritance from ${f.name}`, undefined, day);
    out.push({ from: f.id, to: heirs.map((h) => h.id), amount });
    // A passed-over child far better known than the heir contests it before the place's head.
    const rival = law !== "split" ? kids.slice(1).find((k) => k.renown >= heirs[0]!.renown + 20) : undefined;
    if (rival && store) {
      store.records.put({ id: `dispute:${f.id}:purse`, kind: "dispute", site: home || null, a: heirs[0]!.id, b: rival.id, since: day, status: "open", ended: null, data: { of: f.id, ofName: f.name, part: "purse", claimants: [heirs[0]!.id, rival.id], lawful: heirs[0]!.id, figures: true, amount: each } });
      realmNews(realm, day, home || null, "dispute", `${rival.name} disputes the inheritance of ${f.name} with ${heirs[0]!.name}.`, 4, [rival.name, heirs[0]!.name, f.name], { why: `the law gives it to ${heirs[0]!.name}, but ${rival.name} is the better known` });
    }
  }
  return out;
}
