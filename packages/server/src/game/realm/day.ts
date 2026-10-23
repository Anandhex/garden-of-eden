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
import { dungeonsDay, packsDay } from "./wilds.js";

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
export function realmDay(realm: Realm, day: number, only?: Rng, opts: { live?: ReadonlySet<string> } = {}): void {
  const rng = (step: string): Rng => only ?? streamFor(realm.seed, "realm", day, step);
  // Adventurers walk to their dungeon (N26 Part E): the roads are made once, here, not inside a timed step.
  if (Object.keys(realm.dungeons).length > 0) roadDataOf(realm);
  timed("realm.day", () => withLivePlaces(opts.live ?? new Set(), () => {
    timed("realm.ageing", () => {
      for (const f of ageFigures(realm, day, rng("ageing"))) {
        if (f.renown >= 25 || Object.values(realm.settlements).some((s) => s.leader === f.id) || f.role === "ruler") {
          realmNews(realm, day, f.home, "death", `${titled(f)} has died of old age${f.home ? ` in ${realm.settlements[f.home]?.name ?? "their home"}` : ""}.`, f.role === "ruler" ? 8 : 4, [f.name], { why: "old age" });
        }
      }
    });
    settleTransit(realm, day);
    timed("realm.succession", () => successionDay(realm, day, rng("succession")));
    timed("realm.court", () => courtDay(realm, day, rng("court")));
    timed("realm.economy", () => economyDay(realm, day, rng("economy"), opts.live));
    if (isTaxDay(day)) timed("realm.taxes", () => taxDay(realm, day, rng("taxes")));
    timed("realm.factions", () => factionsDay(realm, day, rng("factions")));
    timed("realm.director", () => directorDay(realm, day, rng("director")));
    timed("realm.raids", () => raidsDay(realm, day, rng("raids")));
    timed("realm.wars", () => warsDay(realm, day, rng("wars")));
    timed("realm.packs", () => packsDay(realm, day, rng("packs")));
    timed("realm.dungeons", () => dungeonsDay(realm, day, rng("dungeons")));
    timed("realm.succession", () => successionDay(realm, day, rng("succession-end")));
    refreshHierarchy(realm);
    realm.day = day;
  }));
}

/** Run every day from the realm's last up to `toDay`. */
export function advanceRealm(realm: Realm, toDay: number, rng?: Rng, opts: { live?: ReadonlySet<string> } = {}): void {
  for (let d = realm.day + 1; d <= toDay; d++) realmDay(realm, d, rng, opts);
}
