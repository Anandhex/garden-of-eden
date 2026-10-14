import { isOnTheRoad } from "@millbrook/shared";
import type { SavedWorld } from "../save.js";
import { landOf } from "./ground.js";
import { journeysOf, MAX_JOURNEYS } from "./journeys.js";
import { relayOf } from "./relay.js";
import { tilesFrom } from "@millbrook/shared";

/**
 * N26's balance bounds: numbers the road must stay inside once the realm has been running a while. N22's long-run tests
 * read this list; tests/n26.test.ts does too.
 */
export interface Bound {
  name: string;
  ok: boolean;
  detail: string;
}

export function checkRoadBounds(world: SavedWorld): Bound[] {
  const realm = world.realm!;
  const data = landOf(realm).data;
  const now = (world.day - 1) * 1440 + 12 * 60;
  const all = journeysOf(world);
  const active = all.filter((j) => isOnTheRoad(j, now));
  // Roads are neither empty nor clogged: some are on them, none is crowded.
  const perRoad = new Map<string, number>();
  for (const j of active) for (const r of j.roads) perRoad.set(r.id, (perRoad.get(r.id) ?? 0) + 1);
  const busiest = Math.max(0, ...perRoad.values());
  // Every news item of weight reaches every place its roads lead to.
  const stale = realm.news.filter((n) => n.importance >= 5 && n.at && n.day <= world.day - 12);
  const origin = (id: string) => (realm.settlements[id]?.way ? (realm.settlements[id]!.liege ?? id) : id);
  const missing = stale.filter((n) => relayOf(realm, n).at.size < tilesFrom(data, origin(n.at!)).size);
  // Most caravans arrive: the robbed ones are few and recorded.
  const caravans = all.filter((j) => j.kind === "caravan" && j.arrive < now);
  const lost = caravans.filter((j) => j.ended);
  return [
    { name: "journeys-band", ok: all.length < MAX_JOURNEYS && (world.day < 5 || active.length >= 3) && busiest <= 14, detail: `${active.length} on the road now, ${all.length} kept, busiest road ${busiest}` },
    { name: "news-arrives", ok: missing.length === 0, detail: `${stale.length} items of news, ${missing.length} that don't reach every place the roads lead to` },
    { name: "caravans-complete", ok: caravans.length === 0 || lost.length / caravans.length <= 0.2, detail: `${caravans.length - lost.length} of ${caravans.length} caravans arrived` },
  ];
}
