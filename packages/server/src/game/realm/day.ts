import type { Rng } from "../dice.js";
import { directorDay } from "./director.js";
import { raidsDay, warsDay } from "./diplomacy.js";
import { economyDay } from "./economy.js";
import { factionsDay } from "./factions.js";
import { ageFigures, titled } from "./figures.js";
import { realmNews } from "./log.js";
import { isTaxDay, refreshHierarchy, successionDay, taxDay } from "./politics.js";
import type { Realm } from "./types.js";
import { dungeonsDay, packsDay } from "./wilds.js";

/**
 * One day of the realm (N13), in this order: people age (and some die); empty
 * seats are filled; settlements eat, earn, build and move; taxes climb the chain
 * on tax days; factions recruit, expand and split; the director pushes what's most
 * needed; raids; wars; beasts; dungeons; and the chain of command is tidied.
 * Everything is code and the given RNG: a seed gives the same realm every time.
 */
export function realmDay(realm: Realm, day: number, rng: Rng): void {
  for (const f of ageFigures(realm, day, rng)) {
    if (f.renown >= 25 || Object.values(realm.settlements).some((s) => s.leader === f.id) || f.role === "ruler") {
      realmNews(realm, day, f.home, "death", `${titled(f)} has died of old age${f.home ? ` in ${realm.settlements[f.home]?.name ?? "their home"}` : ""}.`, f.role === "ruler" ? 8 : 4, [f.name]);
    }
  }
  successionDay(realm, day, rng);
  economyDay(realm, day, rng);
  if (isTaxDay(day)) taxDay(realm, day, rng);
  factionsDay(realm, day, rng);
  directorDay(realm, day, rng);
  raidsDay(realm, day, rng);
  warsDay(realm, day, rng);
  packsDay(realm, day, rng);
  dungeonsDay(realm, day, rng);
  successionDay(realm, day, rng);
  refreshHierarchy(realm);
  realm.day = day;
}

/** Run every day from the realm's last up to `toDay`. */
export function advanceRealm(realm: Realm, toDay: number, rng: Rng): void {
  for (let d = realm.day + 1; d <= toDay; d++) realmDay(realm, d, rng);
}
