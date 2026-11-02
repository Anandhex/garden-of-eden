import { inTerritory, partyAt, type RoadPlace } from "@millbrook/shared";
import { journeysOf, lineOf } from "./journeys.js";
import { check, streamFor } from "../dice.js";
import { itemKey } from "../items.js";
import { formatMoney } from "../money.js";
import { skillLevel } from "../../npc/skills.js";
import type { Town } from "../town.js";
import { stockTerritory } from "./hostiles.js";
import { landOf } from "./ground.js";
import { territoriesNow } from "./territories.js";
import { playerLearns } from "../playerKnowledge.js";
import { minersAt } from "./commute.js";

/**
 * Using the old places beside the road (N26F decision 8): standing stones are a landmark, a ruin or a cave is searched
 * (a little of what was left, and a cave inside a pack's stretch is its den, with the pack in it), a herb patch is
 * gathered and grows back in HERB_DAYS, an ore outcrop is dug with a pick and comes back in ORE_DAYS. What was used when
 * is the player's `road.used`.
 */
export const HERB_DAYS = 4;
export const ORE_DAYS = 12;
export const SEARCH_DAYS = 20;

/** A pick is any of these in the pack. */
const PICKS = ["miner's pick"];

export function useOldPlace(town: Town, pl: RoadPlace, op: string, minute: number): string[] {
  const p = town.world.player;
  const road = p.road!;
  const used = (road.used ??= {});
  const day = town.world.day;
  const since = used[pl.id] === undefined ? Infinity : day - used[pl.id]!;
  const rng = streamFor(town.world.seed, "roadside", pl.id, day, minute);
  if (pl.kind === "stones" && op === "look") return ["Grey stones, taller than a man, leaning. Nobody remembers who set them here. You note the place: it's a landmark on this road."];
  if (pl.kind === "herbs" && op === "gather") {
    if (since < HERB_DAYS) return ["You've picked this patch bare. Give it a few days."];
    const r = check(rng, p.attributes.perception, 10, skillLevel(p.skills, "foraging"));
    used[pl.id] = day;
    town.walkMinutes(30);
    if (!r.success) return ["You spend half an hour among the leaves and come away with nothing worth keeping."];
    const n = r.total >= 16 ? 2 : 1;
    const k = itemKey("wild herbs");
    p.inventory[k] = (p.inventory[k] ?? 0) + n;
    return [`You gather ${n === 1 ? "a handful" : "two handfuls"} of wild herbs.`];
  }
  if (pl.kind === "ore" && op === "dig") {
    if (!Object.keys(p.inventory).some((k) => (p.inventory[k] ?? 0) > 0 && PICKS.some((x) => k.startsWith(x)))) return ["You'd need a pick to get anything out of that rock."];
    if (since < ORE_DAYS) return ["The good seam is worked out for now."];
    used[pl.id] = day;
    town.walkMinutes(60);
    const r = check(rng, p.attributes.strength, 11);
    if (!r.success) return ["An hour's hard work, and only rubble."];
    const k = itemKey("iron ore");
    p.inventory[k] = (p.inventory[k] ?? 0) + (r.total >= 17 ? 2 : 1);
    return [`You break out ${r.total >= 17 ? "two good lumps" : "a lump"} of iron ore.`];
  }
  if ((pl.kind === "ruin" || pl.kind === "cave") && op === "search") {
    // A cave in a pack's stretch is its den: the pack is home.
    const realm = town.world.realm!;
    const den = pl.kind === "cave" ? territoriesNow(realm).find((t) => t.kind === "pack" && inTerritory(landOf(realm).data, t, pl.at) !== null) : undefined;
    if (den && (realm.packs[den.owner]?.count ?? 0) > 0) {
      const made = stockTerritory(town, den, rng);
      for (const c of made) c.pos = { x: pl.at.x + Math.round(rng() * 6 - 3), y: pl.at.y + 1 + Math.round(rng() * 3) };
      road.met[den.id] = day;
      return [`It's a den. ${made.length > 0 ? `${made.map((c) => c.name).slice(0, 2).join(" and ")}${made.length > 2 ? " and the rest" : ""} come out of the dark.` : "The smell of it, and old bones, but nobody home."}`];
    }
    if (since < SEARCH_DAYS) return ["You've been through it already; there's nothing new."];
    used[pl.id] = day;
    town.walkMinutes(30);
    const roll = rng();
    if (roll < 0.35) return ["Dust, nettles and old stones. Nothing."];
    if (roll < 0.75) {
      const coin = 5 + Math.floor(rng() * 40);
      p.money += coin;
      return [`Under a fallen stone you find ${formatMoney(coin)} in old coins.`];
    }
    const k = itemKey(rng() < 0.5 ? "stick" : "wild herbs");
    p.inventory[k] = (p.inventory[k] ?? 0) + 1;
    return ["You find something left behind and take it."];
  }
  return ["Nothing to be done here."];
}

/** A cart left where a party was really robbed (N26F decision 8): only from a journey that ended so on this road. */
export interface Wreck {
  id: string;
  name: string;
  x: number;
  y: number;
  journey: string;
}

/** Robbed parties' carts within `radius` tiles of the player, for the last LEFT_DAYS days. */
export const LEFT_DAYS = 12;

export function wrecksNear(town: Town, radius = 8): Wreck[] {
  const realm = town.world.realm;
  const road = town.world.player.road;
  if (!realm || !road) return [];
  const data = landOf(realm).data;
  const out: Wreck[] = [];
  const now = (town.world.day - 1) * 1440;
  for (const j of journeysOf(realm)) {
    if (!j.ended || !j.ended.why.startsWith("robbed") || j.ended.minute < now - LEFT_DAYS * 1440) continue;
    const at = partyAt(j, lineOf(data, j), j.ended.minute)[0];
    if (!at || Math.hypot(at.x - road.x, at.y - road.y) > radius) continue;
    out.push({ id: `wreck:${j.id}`, name: `${j.party[0]?.name ?? "someone"}'s cart, overturned`, x: Math.round(at.x) + 2, y: Math.round(at.y) + 2, journey: j.id });
  }
  return out;
}

/** Search a robbed cart: what the robbers left (once). */
export function searchWreck(town: Town, id: string): string[] {
  const road = town.world.player.road!;
  const used = (road.used ??= {});
  if (used[id] !== undefined) return ["You've been through it. The robbers left little, and you have that."];
  const w = wrecksNear(town, 10).find((x) => x.id === id);
  if (!w) return ["That is out of reach."];
  used[id] = town.world.day;
  const j = journeysOf(town.world.realm!).find((x) => x.id === w.journey);
  const left = Object.entries(j?.cargo ?? {}).slice(0, 1);
  if (left.length === 0) return ["Broken boxes and a torn sack. They took everything."];
  const [item] = left[0]!;
  const k = itemKey(item);
  town.world.player.inventory[k] = (town.world.player.inventory[k] ?? 0) + 1;
  return [`Under the boards, one ${item} they missed.`];
}

/** A gang's camp the player knows of, near where they stand (N26F decision 9). */
export interface CampNear {
  id: string;
  gang: string;
  seat: string;
  name: string;
  x: number;
  y: number;
}

/** Tiles within which a camp off the road is found by walking near it. */
export const CAMP_FOUND = 14;

/**
 * Camps within `radius` tiles that the player knows of. Walking close enough to one is how it's found (smoke, a dropped
 * knife, voices): the player learns it (`camp:<gang>`), as they could be told it.
 */
export function campsNear(town: Town, radius: number): CampNear[] {
  const realm = town.world.realm;
  const p = town.world.player;
  if (!realm || !p.road) return [];
  const out: CampNear[] = [];
  for (const t of territoriesNow(realm)) {
    if (t.kind !== "gang" || !t.camp) continue;
    const d = Math.hypot(t.camp.x - p.road.x, t.camp.y - p.road.y);
    const ref = `camp:${t.owner}`;
    if (d <= CAMP_FOUND && !p.known?.[ref]) playerLearns(p, ref, "saw", town.world.day);
    if (d > radius || !p.known?.[ref]) continue;
    const g = realm.factions[t.owner];
    out.push({ id: ref, gang: t.owner, seat: t.near, name: `the camp of ${g?.name ?? "outlaws"}`, x: t.camp.x, y: t.camp.y });
  }
  return out;
}

/** Who is at a working mine now, in words (its miners are commuters: road/commute.ts). */
export function minersWords(town: Town, site: string): string {
  const at = minersAt(town, site);
  return at.length === 0 ? "Nobody is at work." : `${at.slice(0, 3).join(", ")}${at.length > 3 ? ` and ${at.length - 3} more` : ""} at work.`;
}
