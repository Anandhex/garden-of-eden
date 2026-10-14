/**
 * The people on the open road (N26): journeys fetched from the server and placed with the same formula the server uses
 * (`partyAt`), so what is drawn is where they are. Nothing per step goes over the wire.
 */
import { journeyLine, partyAt, type Journey, type Snapshot } from "@millbrook/shared";
import { land } from "./roadData";

export interface Traveller {
  /** The id to talk to: the person's row in the `people` table. */
  id: string;
  x: number;
  y: number;
  name: string;
  role: string;
  kind: string;
  purpose: string;
  from: string;
  to: string;
  walking: boolean;
}

export const travellers = { journeys: [] as Journey[], fetchedAt: 0, fetchedDay: -1, at: { x: 0, y: 0 }, people: [] as Traveller[], loading: false };

export const minuteOf = (s: Snapshot): number => (s.time.day - 1) * 1440 + s.time.hour * 60 + s.time.minute;

/** Get the journeys near the player now and then (not on every step). */
export async function refreshJourneys(s: Snapshot): Promise<void> {
  if (!s.road || travellers.loading) return;
  const moved = Math.hypot(s.position.x - travellers.at.x, s.position.y - travellers.at.y);
  if (performance.now() - travellers.fetchedAt < 4000 && moved < 250 && travellers.fetchedDay === s.time.day) return;
  travellers.loading = true;
  try {
    const r = (await (await fetch("/api/road/journeys")).json()) as { journeys: Journey[] };
    travellers.journeys = r.journeys;
    travellers.fetchedAt = performance.now();
    travellers.fetchedDay = s.time.day;
    travellers.at = { x: s.position.x, y: s.position.y };
  } catch {
    // the next sync tries again
  } finally {
    travellers.loading = false;
  }
}

/** Work out where everyone is at the snapshot's minute. */
export function placeTravellers(s: Snapshot, name: (id: string) => string): Traveller[] {
  const data = land.data;
  if (!s.road || !data) return (travellers.people = []);
  const m = minuteOf(s);
  const out: Traveller[] = [];
  for (const j of travellers.journeys) {
    if (m < j.depart || m >= (j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive)) continue;
    const line = journeyLine(data, j.roads, j.path);
    // Resting at a town they are visiting, they are in its crowd, not on the road.
    partyAt(j, line, m).forEach((p, k) => {
      const who = j.party[k]!;
      out.push({ id: who.person, x: p.x, y: p.y, name: who.name, role: who.role, kind: j.kind, purpose: j.purpose, from: name(j.path[0]!), to: name(j.path.at(-1)!), walking: p.state === "walking" });
    });
  }
  return (travellers.people = out);
}

export const travellerNear = (s: Snapshot, range: number): Traveller | undefined =>
  travellers.people.filter((t) => Math.hypot(t.x - s.position.x, t.y - s.position.y) <= range).sort((a, b) => Math.hypot(a.x - s.position.x, a.y - s.position.y) - Math.hypot(b.x - s.position.x, b.y - s.position.y))[0];

export const KIND_COLOR: Record<string, string> = { caravan: "#b5763f", courier: "#d9a441", market: "#9aa86a", kin: "#b58aa0", work: "#a08a6a", officials: "#6a7fa8", patrol: "#4f6fa0", pilgrims: "#c9c3b0", adventurers: "#b5503f", refugees: "#8a7a5f", migrants: "#8a7a5f", coach: "#7a9b57" };
