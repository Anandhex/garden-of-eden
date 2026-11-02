import type { FactionKind, Office, Realm, RealmFaction, Settlement, SettlementKind } from "../realm/types.js";

/**
 * Offices are data (N69 decision 1). Every place and every faction is run by people in posts: the head (the place's or faction's
 * `leader`, as always) and the officers below, each with one duty, a wage and a name for the words. A post held is an entry of
 * `realm.offices` keyed `<inst>|<post>`, `inst` being `s:<settlement>` or `f:<faction>`. A hamlet has only its elder; a crown's
 * council is its capital's posts.
 *
 * Each duty changes one number in the rules that already exist (decision 4), never a new economy: the coffer the income, the watch
 * the place's strength in defence, the levy its strength when it goes out, the works the cost of building and grain, the recruiter a
 * faction's drives. An empty post costs its bonus and a little more (the head does it badly).
 */
export type Duty = "coffer" | "watch" | "levy" | "law" | "works" | "council" | "spies" | "recruit" | "master";

export interface PostDef {
  /** "reeve", "treasurer", "master:2". */
  id: string;
  duty: Duty;
  /** In words: "reeve", "captain of the watch". */
  title: string;
  /** Copper a tax period, before the place's scale. */
  wage: number;
  /** Renown for taking it up (decision 6). */
  renown: number;
}

const post = (id: string, duty: Duty, title: string, wage: number, renown = 2): PostDef => ({ id, duty, title, wage, renown });

/** The posts of each kind of place, besides its head. */
export const PLACE_POSTS: Record<SettlementKind, PostDef[]> = {
  hamlet: [],
  village: [post("reeve", "coffer", "reeve", 20, 2), post("constable", "watch", "constable", 18, 2)],
  town: [post("treasurer", "coffer", "treasurer", 20, 3), post("captain", "watch", "captain of the watch", 20, 3), post("magistrate", "law", "magistrate", 22, 3), post("clerk", "works", "clerk", 12, 1)],
  city: [post("treasurer", "coffer", "treasurer", 20, 3), post("captain", "watch", "captain of the watch", 20, 3), post("magistrate", "law", "magistrate", 22, 3), post("steward", "works", "steward", 18, 2), post("marshal", "levy", "marshal", 22, 3)],
  capital: [post("chancellor", "council", "chancellor", 26, 4), post("treasurer", "coffer", "treasurer", 20, 3), post("marshal", "levy", "marshal", 22, 3), post("steward", "works", "steward", 18, 2), post("magistrate", "law", "magistrate", 22, 3), post("spymaster", "spies", "spymaster", 14, 1)],
};

/** The posts of each kind of faction, besides its head (masters are added by size: `factionPosts`). */
export const FACTION_POSTS: Record<FactionKind, PostDef[]> = {
  crown: [],
  guild: [post("treasurer", "coffer", "treasurer", 14, 3), post("warden", "recruit", "warden", 14, 2)],
  association: [post("treasurer", "coffer", "treasurer", 10, 3), post("warden", "recruit", "warden", 10, 2)],
  order: [post("treasurer", "coffer", "treasurer", 12, 3), post("marshal", "recruit", "marshal", 14, 3)],
  cult: [post("treasurer", "coffer", "treasurer", 10, 2), post("preacher", "recruit", "preacher", 10, 2)],
  gang: [post("lieutenant", "recruit", "lieutenant", 14, 2), post("quartermaster", "coffer", "quartermaster", 10, 1)],
  rebels: [post("lieutenant", "recruit", "lieutenant", 14, 2), post("quartermaster", "coffer", "quartermaster", 10, 1)],
};

/** How big a place is, for wages: the most a place's wages scale to (a capital's); a place pays by the square root of its people (treasury.ts). */
export const WAGE_SCALE: Record<SettlementKind, number> = { hamlet: 0.5, village: 1, town: 2.5, city: 5, capital: 7 };
/** A head's wage a tax period, before scale. */
export const HEAD_WAGE = 30;
/** Most masters a guild keeps (one per four members). */
export const MAX_MASTERS = 4;

const GUILDLIKE: ReadonlySet<FactionKind> = new Set(["guild", "association"]);

/** The posts of a faction with `members` members: no more than it has members besides its head (a band of two has a lieutenant, no more). */
export function factionPosts(kind: FactionKind, members: number): PostDef[] {
  const out = [...FACTION_POSTS[kind]];
  if (GUILDLIKE.has(kind)) for (let k = 1; k <= Math.min(MAX_MASTERS, Math.floor(members / 4)); k++) out.push(post(`master:${k}`, "master", "master", 6, 1));
  return out.slice(0, Math.max(0, members - 1));
}

export const placeInst = (id: string) => `s:${id}`;
export const factionInst = (id: string) => `f:${id}`;
export const officeKey = (inst: string, postId: string) => `${inst}|${postId}`;

/** The posts an institution has now (a chartering guild has none until it is chartered; a dissolved or fallen one none). */
export function postsOf(realm: Realm, inst: string, members = 0): PostDef[] {
  const id = inst.slice(2);
  if (inst.startsWith("s:")) {
    const s = realm.settlements[id];
    if (!s || s.abandoned || s.fallen || s.way) return [];
    return PLACE_POSTS[s.kind];
  }
  const f = realm.factions[id];
  if (!f || f.dissolved !== undefined || f.charter) return [];
  return factionPosts(f.kind, members);
}

/** The definition of a post of an institution, if it has it. */
export function postDef(realm: Realm, inst: string, postId: string): PostDef | undefined {
  if (inst.startsWith("s:")) {
    const s = realm.settlements[inst.slice(2)];
    return s ? PLACE_POSTS[s.kind].find((p) => p.id === postId) : undefined;
  }
  const f = realm.factions[inst.slice(2)];
  if (!f) return undefined;
  return postId.startsWith("master:") ? post(postId, "master", "master", 6, 1) : FACTION_POSTS[f.kind].find((p) => p.id === postId);
}

/** The offices of an institution, in a fixed order. */
export function officesOf(realm: Realm, inst: string): Office[] {
  return Object.entries(realm.offices ?? {})
    .filter(([k]) => k.startsWith(`${inst}|`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, o]) => o);
}

/** The office of an institution with a duty (the first, by key), held or not. */
export function officeFor(realm: Realm, inst: string, duty: Duty): { def: PostDef; office: Office | undefined } | null {
  const id = inst.slice(2);
  const defs = inst.startsWith("s:") ? (realm.settlements[id] ? PLACE_POSTS[realm.settlements[id]!.kind] : []) : realm.factions[id] ? FACTION_POSTS[realm.factions[id]!.kind] : [];
  const def = defs.find((p) => p.duty === duty);
  if (!def) return null;
  return { def, office: realm.offices?.[officeKey(inst, def.id)] };
}

/** The office someone holds, if any (one at most besides membership: decision 1). */
export function officeOf(realm: Realm, holder: string): Office | undefined {
  return Object.values(realm.offices ?? {}).find((o) => o.holder === holder);
}

/** The skill of whoever holds the duty, or null when the post is there and empty, or undefined when the place has no such post. */
function heldSkill(realm: Realm, inst: string, duty: Duty): number | null | undefined {
  const o = officeFor(realm, inst, duty);
  if (!o) return undefined;
  // A townsperson's post (or a nameless one's) counts as an ordinary hand's, whoever holds it: the realm's numbers don't wait on a place's day.
  if (o.office?.holder && (o.office.town || o.office.holder === "crowd" || o.office.holder === "townsfolk")) return 0.5;
  return o.office?.holder ? o.office.skill : null;
}

/** What the coffer's keeper makes of the income (decision 4): × (0.9 + 0.2 × skill), or 0.95 when the post is empty. */
export function cofferMod(realm: Realm, inst: string): number {
  const k = heldSkill(realm, inst, "coffer");
  return k === undefined ? 1 : k === null ? 0.95 : 0.9 + 0.2 * k;
}

/** What the watch (in defence) or the levy (going out) adds to a place's strength: a skilled captain +15%, an empty post −5%. */
export function guardMod(realm: Realm, s: Pick<Settlement, "id" | "kind">, defending: boolean): number {
  const inst = placeInst(s.id);
  // A capital's marshal keeps its watch too; a city's marshal leads its levy and its captain its watch.
  const duty: Duty = !defending && heldSkill(realm, inst, "levy") !== undefined ? "levy" : heldSkill(realm, inst, "watch") !== undefined ? "watch" : "levy";
  const k = heldSkill(realm, inst, duty);
  return k === undefined ? 1 : k === null ? 0.95 : 1 + 0.15 * k;
}

/** What the steward or clerk makes of building and buying grain: −10% for a skilled one, +5% when the post is empty. */
export function worksMod(realm: Realm, s: Pick<Settlement, "id">): number {
  const k = heldSkill(realm, placeInst(s.id), "works");
  return k === undefined ? 1 : k === null ? 1.05 : 1 - 0.1 * k;
}

/** The recruiter's skill (warden, preacher, marshal, lieutenant), or 0 with nobody in the post. */
export function recruiterSkill(realm: Realm, fac: Pick<RealmFaction, "id">): number {
  return heldSkill(realm, factionInst(fac.id), "recruit") ?? 0;
}

/** Posts of the place that are empty now (its head included), out of how many it has. */
export function emptyPosts(realm: Realm, s: Settlement): { empty: number; of: number } {
  const defs = PLACE_POSTS[s.kind];
  let empty = s.leader && realm.figures[s.leader]?.alive ? 0 : 1;
  for (const d of defs) if (!realm.offices?.[officeKey(placeInst(s.id), d.id)]?.holder) empty++;
  return { empty, of: defs.length + 1 };
}

/** "unrun" (decision 4): most of its posts empty, its prosperity heads 5 lower. Hamlets have only their elder. */
export function unrun(realm: Realm, s: Settlement): boolean {
  if (s.kind === "hamlet") return false;
  const { empty, of } = emptyPosts(realm, s);
  return empty * 2 > of;
}

/** The institution's name in words: "Hollin", "the Smiths' Guild". */
export function instName(realm: Realm, inst: string): string {
  const id = inst.slice(2);
  return inst.startsWith("s:") ? (realm.settlements[id]?.name ?? id) : (realm.factions[id]?.name ?? id);
}

/** "reeve of Hollin", "treasurer of the Smiths' Guild". */
export function postWords(realm: Realm, o: Pick<Office, "inst" | "post">): string {
  const def = postDef(realm, o.inst, o.post);
  return `${def?.title ?? o.post.replace(/:\d+$/, "")} of ${instName(realm, o.inst)}`;
}
