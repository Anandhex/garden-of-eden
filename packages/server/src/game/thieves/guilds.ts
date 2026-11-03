import type { PersonRow } from "../../store/peopleStore.js";
import type { Rec } from "../../store/recordStore.js";
import { config } from "../../config.js";
import type { WorldStore } from "../db.js";
import { seededRng, unitFor } from "../dice.js";
import { temperOf } from "../chatter/person.js";
import { foundFaction } from "../realm/factions.js";
import type { Realm, RealmFaction, Settlement } from "../realm/types.js";
import type { LifeCtx } from "../people/step.js";

/**
 * Thieves' guilds (N47 decision 1). A guild is a realm faction of kind `guild`, trade `thieves`, founded in each city and capital (and
 * towns of some size) by one of the place's own figures with an eye for it, with no charter (it is not a guild anyone signs for). Each
 * place where it works has a **den**: a record (kind "den") with the cellar's stash, the members' ranks and its heat, hidden from the
 * player's map until found or told. Members are the place's own people: the poor, the young, the not over-honest (`people.faction`).
 */
export const RANKS = ["footpad", "cutpurse", "fence", "master thief", "guildmaster"] as const;
export type Rank = (typeof RANKS)[number];

export interface DenData {
  guild: string;
  /** What has been stolen and not yet sold (copper's worth of goods) and what the den holds in coin. */
  stash: number;
  coin: number;
  ranks: Record<string, Rank>;
  /** 0..1: how much the watch is looking for them (thefts raise it, time and bribes cool it). */
  heat: number;
  /** Who knows where it is (besides the members): the player once told or found it. */
  found?: string[];
  thefts: number;
  fenced: number;
  arrests: number;
  lastSmuggle?: number;
}

export type Den = Rec<DenData>;

/** Places a guild works: cities and capitals, and towns big enough. */
export const wantsGuild = (s: Settlement): boolean => !s.abandoned && !s.fallen && (s.kind === "city" || s.kind === "capital" || (s.kind === "town" && s.population >= 600));

export const guildAt = (realm: Realm, site: string): RealmFaction | undefined =>
  Object.values(realm.factions).find((f) => f.trade === "thieves" && f.dissolved === undefined && (f.seat === site || f.branches.includes(site)));

export const denOf = (store: Pick<WorldStore, "records">, site: string): Den | undefined => store.records.get<DenData>(`den:${site}`);

/**
 * The realm's day: a city with no guild gets one, founded by a figure of the place with greed and little loyalty (a merchant gone crooked,
 * an adventurer, a captain). A guild works its seat; a town near its seat may become a branch.
 */
export function foundGuilds(realm: Realm, day: number): RealmFaction[] {
  if (!config.society.underworld) return [];
  const made: RealmFaction[] = [];
  for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!wantsGuild(s) || guildAt(realm, s.id)) continue;
    const founder = Object.values(realm.figures)
      .filter((f) => f.alive && f.home === s.id && !f.talks && !f.away && f.id !== s.leader && ["merchant", "adventurer", "captain", "noble", "bandit", "commoner"].includes(f.role) && !Object.values(realm.factions).some((x) => x.leader === f.id))
      .sort((a, b) => b.greed - b.loyalty - (a.greed - a.loyalty) || a.id.localeCompare(b.id))[0];
    if (!founder) continue;
    const fac = foundFaction(realm, seededRng(Math.floor(unitFor(realm.seed, "guild-name", s.id) * 2 ** 31)), { kind: "guild", trade: "thieves", founder, seat: s.id, creed: "what's yours is ours, quietly", why: "where there is coin, someone takes it" }, day);
    // Nobody signs a charter for a thieves' guild.
    delete fac.charter;
    made.push(fac);
  }
  return made;
}

/** How many the den wants among a place's people. */
export const denSize = (pop: number): number => Math.max(3, Math.min(40, Math.round(pop / 60)));

/** Would someone join a thieves' guild: poor, not over-honest, grown, free to. */
export function likelyThief(r: PersonRow): boolean {
  if (r.death !== null || r.job === "child" || r.faction || r.cls === "slave" || r.captive) return false;
  const low = r.cls === "commoner" || r.cls === "serf";
  return low && temperOf(r).honesty < 0.4 && ["beggar", "labourer", "porter", "carter", "servant", "fisher", "miner"].includes(r.job);
}

/** The den of a place: made on its first day, its members brought up to strength from the place's people, ranks given by time and nerve. */
export function denDay(ctx: LifeCtx, site: string, day: number): Den | undefined {
  const { realm, store } = ctx;
  const guild = guildAt(realm, site);
  if (!guild) return undefined;
  let den = denOf(store, site);
  if (!den) {
    den = { id: `den:${site}`, kind: "den", site, a: guild.id, b: null, since: day, status: "open", ended: null, data: { guild: guild.id, stash: 0, coin: 0, ranks: {}, heat: 0, thefts: 0, fenced: 0, arrests: 0 } };
    store.records.put(den);
  }
  if (den.ended !== null) return undefined;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null);
  const members = rows.filter((r) => r.faction === guild.id);
  const ranks: Record<string, Rank> = {};
  for (const m of members) ranks[m.id] = den.data.ranks[m.id] ?? "footpad";
  // Brought up to strength, a few a week, from those likely.
  if (members.length < denSize(rows.length) && day % 3 === 0) {
    const pool = rows.filter(likelyThief).sort((a, b) => temperOf(a).honesty - temperOf(b).honesty || a.id.localeCompare(b.id));
    for (const r of pool.slice(0, 2)) {
      store.people.update(r.id, { faction: guild.id });
      ranks[r.id] = "footpad";
    }
  }
  // Ranks: a season in, the bold rise; one fence at least; a master thief once the den is big.
  if (day % 12 === 0) {
    const sorted = Object.keys(ranks).sort((a, b) => a.localeCompare(b));
    if (!Object.values(ranks).includes("fence") && sorted.length >= 2) ranks[sorted.find((id) => ranks[id] === "cutpurse") ?? sorted[0]!] = "fence";
    for (const id of sorted) if (ranks[id] === "footpad" && unitFor(realm.seed, "rank", id, day) < 0.35) ranks[id] = "cutpurse";
    if (sorted.length >= 6 && !Object.values(ranks).includes("master thief")) {
      const best = sorted.find((id) => ranks[id] === "cutpurse");
      if (best) ranks[best] = "master thief";
    }
  }
  store.records.patch<DenData>(den.id, { data: { ranks, heat: Math.max(0, den.data.heat - 0.02) } });
  return store.records.get<DenData>(den.id);
}
