import { config } from "../../config.js";
import type { NotableRow } from "../../store/notableStore.js";
import type { WorldStore } from "../db.js";
import { unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { ITEM_TIERS, itemKey, notableIdOf, parseItem, type ItemTier } from "../items.js";
import type { Realm } from "../realm/types.js";

/**
 * Items with a history (N43). Most items stay plain stacks; a **notable** item is a stack of one with an id in its key
 * (`iron sword [B] #i12`) and a row in `notable_items`: who made it, who held it, what was done with it, where it was lost and how it was
 * found. An item becomes notable when it is made well (a masterwork, tier B or above, a commission), named, stolen, used in a deed worth
 * telling, passed down, or brought up out of a hoard. Deeds raise its fame; fame earns it a name, and more fame a legend. People who held
 * it, saw it used or heard of it know it (knowledge `i:<id>`, N33) and may recognise it (`recognise`).
 */

export type HistoryKind = "made" | "given" | "sold" | "stolen" | "looted" | "found" | "lost" | "used" | "inherited" | "named";

export interface HistoryEntry {
  day: number;
  kind: HistoryKind;
  /** Who it was done by or to (the new holder for a move; the doer for a deed). */
  who: string;
  /** Their name then (people change names, ranks, and die). */
  name?: string;
  /** The event or deed it belongs to. */
  ref?: string;
  site?: string;
  /** For a deed: what was done ("slew Greyfang"); for a move: from whom. */
  what?: string;
}

/** Fame at which an item earns a name, and a legend. */
export const NAME_AT = 25;
export const LEGEND_AT = 55;
/** History kept: the first, every deed, and the last twelve. */
export const HISTORY_KEPT = 12;

export const notableRef = (id: string): string => `i:${id}`;
export const historyOf = (r: Pick<NotableRow, "history">): HistoryEntry[] => JSON.parse(r.history) as HistoryEntry[];

function keep(h: HistoryEntry[]): HistoryEntry[] {
  if (h.length <= HISTORY_KEPT + 1) return h;
  const last = new Set(h.slice(-HISTORY_KEPT));
  return h.filter((e, i) => i === 0 || last.has(e) || e.kind === "used" || e.kind === "named");
}

/** Is an item of this kind and tier made well enough to be notable on making? */
export const notableOnMaking = (tier: string, masterwork = false): boolean => masterwork || ITEM_TIERS.indexOf(tier as ItemTier) >= ITEM_TIERS.indexOf("B");

export interface NewNotable {
  base: string;
  tier: string;
  holder: string | null;
  holderName?: string;
  day: number;
  site?: string | null;
  maker?: string | null;
  makerName?: string;
  /** Why it becomes notable now, as its first entry: made, stolen, found... */
  how: HistoryKind;
  /** Earlier holders it is known to have had (a family's sword stolen: the family first). */
  before?: Array<{ who: string; name?: string; day: number; kind?: HistoryKind }>;
  name?: string;
  fame?: number;
  ref?: string;
}

/** Make a notable item. Returns its row (its key is `keyOf(row)`). */
export function makeNotable(realm: Realm, store: Pick<WorldStore, "notables">, o: NewNotable): NotableRow {
  // The id comes from what the item is and when it became notable, not from realm.next: a lazy place caught up late makes its items
  // later than a place that ran daily, and taking from the realm's counter would shift every news, figure and faction id after it.
  let n = Math.floor(unitFor(realm.seed, "notable", o.holder ?? "nobody", o.day, o.base, o.tier, o.how, o.maker ?? "") * 1e6);
  while (store.notables.get(`i${o.day}${String(n).padStart(6, "0")}`)) n = (n + 1) % 1e6;
  const id = `i${o.day}${String(n).padStart(6, "0")}`;
  const history: HistoryEntry[] = [
    ...(o.maker ? [{ day: o.day, kind: "made" as const, who: o.maker, ...(o.makerName ? { name: o.makerName } : {}), ...(o.site ? { site: o.site } : {}) }] : []),
    ...(o.before ?? []).map((b) => ({ day: b.day, kind: b.kind ?? ("given" as const), who: b.who, ...(b.name ? { name: b.name } : {}) })),
    ...(o.how !== "made" || !o.maker ? [{ day: o.day, kind: o.how, who: o.holder ?? "nobody", ...(o.holderName ? { name: o.holderName } : {}), ...(o.site ? { site: o.site } : {}), ...(o.ref ? { ref: o.ref } : {}) }] : []),
  ];
  const row: NotableRow = { id, base: o.base, tier: o.tier, name: o.name ?? null, named_by: o.name ? "maker" : null, maker: o.maker ?? null, made_day: o.day, made_site: o.site ?? null, holder: o.holder, holder_since: o.day, fame: o.fame ?? 0, history: JSON.stringify(keep(history)), lost: null };
  store.notables.put(row);
  return row;
}

export const keyOf = (r: Pick<NotableRow, "id" | "base" | "tier">, durability?: number): string => itemKey(r.base, r.tier as ItemTier, durability, r.id);

/**
 * An inventory key made notable (it becomes a stack of one): an ordinary key gets an id and a row; a notable one is left as it is. Returns
 * the key to hold it under now.
 */
export function becomeNotable(realm: Realm, store: Pick<WorldStore, "notables">, key: string, o: Omit<NewNotable, "base" | "tier">): string {
  if (notableIdOf(key)) return key;
  const p = parseItem(key);
  if (!p) return key;
  const row = makeNotable(realm, store, { ...o, base: p.name, tier: p.tier });
  return keyOf(row, p.durability !== undefined && p.maxDurability !== undefined && p.durability < p.maxDurability ? p.durability : undefined);
}

/** Move an item to a new holder, with how (given, sold, stolen, looted, found, inherited, lost). */
export function moveItem(store: Pick<WorldStore, "notables">, id: string, to: string | null, kind: HistoryKind, day: number, o: { name?: string; ref?: string; site?: string; from?: string; how?: string } = {}): NotableRow | null {
  const r = store.notables.get(id);
  if (!r) return null;
  const h = historyOf(r);
  h.push({ day, kind, who: to ?? "nobody", ...(o.name ? { name: o.name } : {}), ...(o.ref ? { ref: o.ref } : {}), ...(o.site ? { site: o.site } : {}), ...(o.from ? { what: `from ${o.from}` } : {}) });
  const lost = kind === "lost" || to === null || to.startsWith("site:") ? JSON.stringify({ day, where: to?.startsWith("site:") ? to.slice(5) : (o.site ?? null), how: o.how ?? kind }) : null;
  const row = { ...r, holder: to, holder_since: day, history: JSON.stringify(keep(h)), lost };
  store.notables.put(row);
  return row;
}

/**
 * A deed done with it (decision 5): fame by the other party's renown (a dragon slain: a lot; a bandit: a little), and a name once it is
 * famous enough. Returns the row and whether it was named now.
 */
export function itemDeed(realm: Realm, store: Pick<WorldStore, "notables">, id: string, d: { day: number; who: string; whoName?: string; what: string; renown: number; ref?: string; site?: string; slain?: string }): { row: NotableRow; named: boolean } | null {
  const r = store.notables.get(id);
  if (!r) return null;
  const h = historyOf(r);
  h.push({ day: d.day, kind: "used", who: d.who, ...(d.whoName ? { name: d.whoName } : {}), what: d.what, ...(d.ref ? { ref: d.ref } : {}), ...(d.site ? { site: d.site } : {}) });
  const fame = Math.min(100, r.fame + 4 + Math.max(0, d.renown) * 0.5);
  let row: NotableRow = { ...r, fame, history: JSON.stringify(keep(h)) };
  let named = false;
  if (!row.name && fame >= NAME_AT) {
    row = { ...row, name: templateName(row, d), named_by: "template" };
    const nh = historyOf(row);
    nh.push({ day: d.day, kind: "named", who: d.who, what: row.name! });
    row.history = JSON.stringify(keep(nh));
    named = true;
  }
  store.notables.put(row);
  void realm;
  return { row, named };
}

const KIND_WORDS: Record<string, string[]> = {
  sword: ["Oath", "Edge", "Promise", "Last Word"],
  axe: ["Hewer", "Widowmaker", "Answer"],
  spear: ["Thorn", "Reach", "Long Goodbye"],
  bow: ["Song", "Whisper", "Reckoning"],
  default: ["Pride", "Mark", "Keepsake"],
};

/** A name from what it did (decision 5's templates): "Greyfang's Bane" for a beast slain, "<holder>'s Oath" for a holder's last fight. */
export function templateName(r: Pick<NotableRow, "id" | "base">, d: { slain?: string; whoName?: string; what: string }): string {
  if (d.slain) return `${d.slain.split(" ")[0]}'s Bane`;
  const kind = Object.keys(KIND_WORDS).find((k) => r.base.includes(k)) ?? "default";
  const words = KIND_WORDS[kind]!;
  const word = words[Math.floor(unitFor(0, "item-name", r.id) * words.length)]!;
  return `${(d.whoName ?? "the Knight").split(" ")[0]}'s ${word}`;
}

/** How to speak of it: its name, else "<maker>'s <kind>", else its kind. */
export function itemName(r: Pick<NotableRow, "name" | "base" | "maker">, makerName?: string): string {
  return r.name ?? (makerName ? `${makerName.split(" ")[0]}'s ${r.base}` : `a fine ${r.base}`);
}

/** Its legend in two sentences, from the facts (decision 5's template; `item-legend` may say it better). */
export function legendOf(r: NotableRow, nameOf: (id: string) => string): string {
  const h = historyOf(r);
  const made = h.find((e) => e.kind === "made");
  const deeds = h.filter((e) => e.kind === "used");
  const last = deeds.at(-1);
  const now = h.at(-1);
  const first = `${itemName(r)} was ${made ? `made by ${made.name ?? nameOf(made.who)}` : "made long ago"}${deeds.length > 0 ? `, and ${deeds.length > 1 ? `has been in ${deeds.length} fights worth telling of` : "was carried in a fight worth telling of"}` : ""}.`;
  const second = last ? `${last.name ?? nameOf(last.who)} ${last.what}${now && now !== last && now.kind !== "named" ? `; it was ${now.kind} after, ${now.name ? `and ${now.name} has it` : "and none can say where it is"}` : ""}.` : "Nobody has made a song of it yet.";
  return `${first} ${second}`;
}

/**
 * Who knows an item (decision 6): its holder's household and friends when it is made or comes to them, witnesses of its deeds, and anyone
 * told. Townsfolk only (rows); talkers learn through their rows.
 */
export function knowItem(ctx: { realm: Realm; store: WorldStore }, id: string, who: string[], day: number, accuracy = 1, source = "saw"): void {
  if (!config.gossip) return;
  for (const w of who) if (ctx.store.people.get(w)) learn(ctx, w, notableRef(id), { day, source, accuracy });
}

export interface Recognition {
  knows: boolean;
  /** The item was stolen or looted from someone the viewer counts as its rightful owner. */
  stolenFrom?: { who: string; name: string; day: number };
  /** The viewer is kin of a past holder (an heirloom: they want it back). */
  kin?: { of: string; name: string };
  line?: string;
}

/**
 * Does someone recognise an item they see (decision 6)? Only if they know it (knowledge `i:<id>`, or they held it, or it's family), with
 * a chance by how well they know it and how famous it is. A stolen one gives the holder away; an heirloom stirs the family.
 */
export function recognise(ctx: { realm: Realm; store: WorldStore }, id: string, viewer: string, day: number, roll = unitFor(ctx.realm.seed, "recognise", id, viewer, day)): Recognition {
  const r = ctx.store.notables.get(id);
  if (!r) return { knows: false };
  const h = historyOf(r);
  const v = ctx.store.people.get(viewer);
  const known = ctx.store.knowledge.get(viewer, notableRef(id));
  const held = h.some((e) => e.who === viewer);
  const kinOf = v ? h.find((e) => e.who !== viewer && isKin(ctx.store, viewer, e.who)) : undefined;
  if (!known && !held && !kinOf) return { knows: false };
  const chance = held || kinOf ? 0.95 : Math.min(0.95, (known?.accuracy ?? 0.5) * (0.5 + r.fame / 100));
  if (roll >= chance) return { knows: false };
  const taken = [...h].reverse().find((e) => e.kind === "stolen" || e.kind === "looted");
  const owner = taken ? [...h.slice(0, h.indexOf(taken))].reverse().find((e) => e.kind === "made" || e.kind === "given" || e.kind === "inherited" || e.kind === "sold") : undefined;
  const nameOf = (who: string) => ctx.store.people.get(who)?.name ?? ctx.realm.figures[who]?.name ?? (who === "player" ? "the stranger" : who);
  const out: Recognition = { knows: true };
  if (taken && owner) out.stolenFrom = { who: owner.who, name: owner.name ?? nameOf(owner.who), day: taken.day };
  if (kinOf) out.kin = { of: kinOf.who, name: kinOf.name ?? nameOf(kinOf.who) };
  out.line = out.stolenFrom ? `That's ${itemName(r)}. It was taken from ${out.stolenFrom.name}${out.kin ? ", my own kin" : ""}.` : `That's ${itemName(r)}; I'd know it anywhere.`;
  return out;
}

/** Kin by the rows: spouse, parent, child, sibling, or the same household. */
export function isKin(store: Pick<WorldStore, "people">, a: string, b: string): boolean {
  const x = store.people.get(a);
  const y = store.people.get(b);
  if (!x || !y) return false;
  return x.spouse === y.id || y.spouse === x.id || x.mother === y.id || x.father === y.id || y.mother === x.id || y.father === x.id || (!!x.mother && x.mother === y.mother) || (x.home !== null && x.home === y.home && x.site === y.site);
}

/** The notable items in an inventory (or worn): their rows. */
export function notablesIn(store: Pick<WorldStore, "notables">, keys: Iterable<string>): NotableRow[] {
  const out: NotableRow[] = [];
  for (const k of keys) {
    const id = notableIdOf(k);
    const r = id ? store.notables.get(id) : undefined;
    if (r) out.push(r);
  }
  return out;
}

/** The dead of the realm's day hand on what they carried (decision 4): to their killer, or it lies where they fell. */
export function handOnDrops(realm: Realm, store: Pick<WorldStore, "notables">, day: number): void {
  for (const d of realm.drops ?? []) {
    const to = d.to;
    const killer = to ? realm.figures[to] : undefined;
    if (killer?.alive) {
      moveItem(store, d.item, killer.id, "looted", d.day, { name: killer.name, from: realm.figures[d.from]?.name ?? d.from, how: d.how });
      killer.items = [...new Set([...(killer.items ?? []), d.item])];
    } else moveItem(store, d.item, d.site ? `site:${d.site}` : null, "lost", d.day, { how: `left where ${realm.figures[d.from]?.name ?? "its holder"} fell (${d.how})`, ...(d.site ? { site: d.site } : {}) });
  }
  realm.drops = [];
  void day;
}
