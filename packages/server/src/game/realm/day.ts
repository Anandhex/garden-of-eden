import { moodRealmDay } from "../mood/model.js";
import { timed } from "../../metrics/timing.js";
import { type Rng, streamFor } from "../dice.js";
import { directorDay } from "./director.js";
import { raidsDay, warsDay } from "./diplomacy.js";
import { economyDay } from "./economy.js";
import { factionsDay } from "./factions.js";
import { ageFigures, titled } from "./figures.js";
import { roadDataOf } from "../road/generateRoads.js";
import { realmNews } from "./log.js";
import { withLivePlaces } from "./military.js";
import { courtDay, isTaxDay, refreshHierarchy, settleTransit, successionDay, taxDay } from "./politics.js";
import type { Realm } from "./types.js";
import type { WorldStore } from "../db.js";
import { officesDay, reputeDay } from "../office/day.js";
import { fame } from "../office/repute.js";
import { dungeonsDay, packsDay } from "./wilds.js";
import { leisureRealmDay } from "../leisure/events.js";
import { marketDay } from "../market/day.js";
import { config } from "../../config.js";

/**
 * One day of the realm (N13), in this order: people age (and some die); empty
 * seats are filled (heads of places, then the crowns' courts); settlements eat, earn, build and move; taxes climb the chain
 * on tax days; factions recruit, expand and split; the director pushes what's most
 * needed; raids; wars; beasts; dungeons; and the chain of command is tidied.
 * `live`: the places whose people are rows that live their own lives (game/people/); the economy
 * leaves their population to them. Everything is code and the dice: a seed gives the same realm every time. Each step rolls
 * from its own stream (`streamFor(realm.seed, "realm", day, step)`), so a new roll in one
 * step never changes another's results (N18). Tests may pass one `rng` for all of them.
 */
export function realmDay(realm: Realm, day: number, only?: Rng, opts: RealmDayOptions = {}): void {
  const rng = (step: string): Rng => only ?? streamFor(realm.seed, "realm", day, step);
  // Adventurers walk to their dungeon (N26 Part E): the roads are made once, here, not inside a timed step.
  if (Object.keys(realm.dungeons).length > 0) roadDataOf(realm);
  timed("realm.day", () => withLivePlaces(opts.live ?? new Set(), () => {
    timed("realm.ageing", () => {
      for (const f of ageFigures(realm, day, rng("ageing"))) {
        if (fame(f) >= 25 || Object.values(realm.settlements).some((s) => s.leader === f.id) || f.role === "ruler") {
          realmNews(realm, day, f.home, "death", `${titled(f)} has died of old age${f.home ? ` in ${realm.settlements[f.home]?.name ?? "their home"}` : ""}.`, f.role === "ruler" ? 8 : 4, [f.name], { why: "old age" });
        }
      }
    });
    settleTransit(realm, day);
    timed("realm.succession", () => successionDay(realm, day, rng("succession")));
    timed("realm.court", () => courtDay(realm, day, rng("court")));
    timed("realm.economy", () => economyDay(realm, day, rng("economy"), opts.live));
    // The people who run places and factions (N69): posts filled, the day's skimming, and on tax days wages and audits before the taxes.
    timed("realm.offices", () => officesDay(realm, day, opts.store, opts.live));
    if (isTaxDay(day)) timed("realm.taxes", () => taxDay(realm, day, rng("taxes")));
    timed("realm.factions", () => factionsDay(realm, day, rng("factions"), opts.store));
    timed("realm.director", () => directorDay(realm, day, rng("director")));
    timed("realm.raids", () => raidsDay(realm, day, rng("raids")));
    timed("realm.wars", () => warsDay(realm, day, rng("wars")));
    timed("realm.packs", () => packsDay(realm, day, rng("packs")));
    timed("realm.dungeons", () => dungeonsDay(realm, day, rng("dungeons")));
    // Fairs and tournaments (N41): announced, travelled to, held.
    if (config.leisure) timed("realm.leisure", () => leisureRealmDay(realm, day, rng("leisure"), opts.store));
    // The shared quest market (N42): jobs posted, parties formed, jobs claimed and done.
    if (config.market && opts.store) timed("realm.market", () => marketDay(realm, opts.store!, day));
    timed("realm.succession", () => successionDay(realm, day, rng("succession-end")));
    // Support, challenges, epithets, fading renown; what the realm owes townsfolk, and those whose name is known rising (N69).
    timed("realm.repute", () => reputeDay(realm, day, opts.store, opts.live));
    refreshHierarchy(realm);
    // Every place's mood from what happened today (N36), after everything that could shock it; the people's day reads it.
    timed("realm.mood", () => moodRealmDay(realm, day));
    realm.day = day;
  }));
}

export interface RealmDayOptions {
  /** Places whose people are rows living their own lives. */
  live?: ReadonlySet<string>;
  /** The people table (N69): townsfolk hold posts, join factions and follow their leaders. Absent where people are a number. */
  store?: WorldStore;
}

/** Run every day from the realm's last up to `toDay`. */
export function advanceRealm(realm: Realm, toDay: number, rng?: Rng, opts: RealmDayOptions = {}): void {
  for (let d = realm.day + 1; d <= toDay; d++) realmDay(realm, d, rng, opts);
}
