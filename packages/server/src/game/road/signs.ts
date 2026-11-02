import { besideRoad, partyAt } from "@millbrook/shared";
import type { Town } from "../town.js";
import { landOf } from "./ground.js";
import { journeysOf, lineOf } from "./journeys.js";
import { territoriesNow } from "./territories.js";

/**
 * Signs before the thing (N26F decision 11): fresh tracks and a gnawed carcass inside a pack's stretch, smoke above the trees
 * where a gang's camp is, crows over a fresh grave where someone really died on this road. All from the world as it is,
 * never seeded on their own, so the road is readable: tracks mean the pack is near. Drawn as places beside the road with a
 * line the first time the player passes them each day.
 */
export interface Sign {
  id: string;
  kind: "tracks" | "carcass" | "smoke" | "grave";
  name: string;
  x: number;
  y: number;
  line: string;
}

/** Tiles between signs along a pack's stretch. */
export const SIGN_EVERY = 320;
/** Days a grave by the road draws crows. */
export const GRAVE_DAYS = 6;

export function signsNear(town: Town, radius: number): Sign[] {
  const realm = town.world.realm;
  const p = town.world.player.road;
  if (!realm || !p) return [];
  const data = landOf(realm).data;
  const out: Sign[] = [];
  const near = (x: number, y: number) => Math.hypot(x - p.x, y - p.y) <= radius;
  for (const t of territoriesNow(realm, data)) {
    const road = data.roads.find((r) => r.id === t.road);
    if (!road) continue;
    if (t.kind === "pack") {
      const species = realm.packs[t.owner]?.species ?? "wolf";
      for (let at = t.t0 + SIGN_EVERY / 2, k = 0; at < t.t1; at += SIGN_EVERY, k++) {
        const q = besideRoad(road, at, k % 2 === 0 ? 3 : -3);
        if (!near(q.x, q.y)) continue;
        const carcass = k % 3 === 2;
        out.push({
          id: `sign:${t.id}:${k}`,
          kind: carcass ? "carcass" : "tracks",
          name: carcass ? "a gnawed carcass" : `fresh ${species} tracks`,
          x: q.x,
          y: q.y,
          line: carcass ? `A deer's carcass by the road, gnawed to the ribs. Something ate well here, and not long ago.` : `Tracks in the mud of the verge: ${species}s, several, fresh.`,
        });
      }
    } else if (t.camp) {
      const mid = besideRoad(road, (t.t0 + t.t1) / 2, 0);
      if (near(mid.x, mid.y)) out.push({ id: `sign:${t.id}:smoke`, kind: "smoke", name: "smoke above the trees", x: mid.x, y: mid.y, line: "A thread of smoke rises above the trees off the road. Somebody has a fire out here." });
    }
  }
  const now = (town.world.day - 1) * 1440;
  for (const j of journeysOf(realm)) {
    if (!j.ended?.dead?.length || j.ended.minute < now - GRAVE_DAYS * 1440) continue;
    const at = partyAt(j, lineOf(data, j), j.ended.minute)[0];
    if (!at || !near(at.x, at.y)) continue;
    out.push({ id: `sign:grave:${j.id}`, kind: "grave", name: "a fresh grave", x: Math.round(at.x) - 3, y: Math.round(at.y) + 3, line: `Crows over a mound of fresh earth by the road. Someone has scratched a name on a board: ${j.ended.dead.join(", ")}.` });
  }
  return out;
}

/** Lines for signs the player has just come up to (each once a day). */
export function passSigns(town: Town): string[] {
  const road = town.world.player.road;
  if (!road) return [];
  const day = town.world.day;
  const lines: string[] = [];
  for (const s of signsNear(town, 6)) {
    if (road.seen[s.id] === day) continue;
    road.seen[s.id] = day;
    lines.push(s.line);
  }
  return lines;
}
