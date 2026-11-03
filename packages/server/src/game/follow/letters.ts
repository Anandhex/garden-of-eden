import { tilesFrom, type Journey, type RoadData } from "@millbrook/shared";
import type { PlayerState } from "../../npc/types.js";
import type { WorldStore } from "../db.js";
import { formatMoney } from "../money.js";
import type { Realm } from "../realm/types.js";
import { journeyOf, journeysOf } from "../road/journeys.js";
import { followsOf, noticeFollowed } from "./follow.js";

/**
 * Letters (N34 decision 4): written to someone at the place the writer believes them to be, and carried there by real
 * travellers. A letter waits at a place until a journey leaves it toward where it's going (to that place, or nearer it),
 * rides with that party, is put down where they stop (a round trip: where they turn), and waits there for the next. It
 * arrives when its last carrier does, not by a formula, so a letter on a quiet road waits; it is lost if its carrier's
 * journey ends badly before they get there. The legs list the real people who carried it.
 */
export interface Letter {
  id: string;
  /** A person's id, or "player". */
  from: string;
  fromName: string;
  to: string;
  toName: string;
  /** The refs it tells of (what the writer wanted to say). */
  about: string[];
  text: string;
  written: number;
  fromSite: string;
  toSite: string;
  /** The place it waits at now (null while carried). */
  at: string | null;
  carrier?: { journey: string; person: string; name: string; to: string; arrive: number };
  legs: Array<{ person: string; name: string; journey: string; from: string; to: string; day: number }>;
  arrived?: number;
  lost?: { day: number; why: string };
  read?: number;
}

export const lettersOf = (realm: Realm): Letter[] => ((realm as Realm & { letters?: Letter[] }).letters ??= []);

/** Days a delivered or lost letter is kept in the realm. */
const KEEP = 48;

/** Write a letter: it waits at the writer's place for a traveller going its way. */
export function writeLetter(realm: Realm, l: Omit<Letter, "id" | "at" | "legs">): Letter {
  const list = lettersOf(realm);
  const letter: Letter = { ...l, id: `L${l.written}-${l.from}-${list.length}`, at: l.fromSite, legs: [] };
  list.push(letter);
  return letter;
}

/** Where a journey puts a letter down, and the minute: its turning place on a round trip, else where it ends. */
function dropOf(j: Journey): { site: string; minute: number } {
  return j.turn ? { site: j.turn.site, minute: j.turn.arrive } : { site: j.path.at(-1)!, minute: j.arrive };
}

/**
 * The day's post: carried letters are put down where their carriers stop (or lost with them); waiting letters go with a
 * party leaving today that takes them to their place or nearer it.
 */
export function lettersDay(realm: Realm, data: RoadData, day: number): void {
  const list = lettersOf(realm);
  const dist = new Map<string, Map<string, number>>();
  const far = (from: string, to: string) => {
    let m = dist.get(from);
    if (!m) dist.set(from, (m = tilesFrom(data, from)));
    return from === to ? 0 : (m.get(to) ?? Infinity);
  };
  const end = day * 1440;
  for (const l of list) {
    if (l.arrived !== undefined || l.lost) continue;
    if (l.carrier) {
      const j = journeyOf(realm, l.carrier.journey);
      const ended = j?.ended;
      if (ended && ended.minute < l.carrier.arrive) {
        l.lost = { day, why: `${l.carrier.name}'s party never got there (${ended.why})` };
        delete l.carrier;
        continue;
      }
      if (l.carrier.arrive > end) continue;
      l.legs.push({ person: l.carrier.person, name: l.carrier.name, journey: l.carrier.journey, from: l.legs.at(-1)?.to ?? l.fromSite, to: l.carrier.to, day });
      l.at = l.carrier.to;
      delete l.carrier;
      if (l.at === l.toSite) {
        l.arrived = day;
        continue;
      }
    }
    if (!l.at) continue;
    // A party leaving here today toward where it's going (the one that takes it nearest).
    const here = far(l.at, l.toSite);
    let best: { j: Journey; drop: { site: string; minute: number }; left: number } | null = null;
    for (const j of journeysOf(realm)) {
      if (j.path[0] !== l.at || j.depart < (day - 1) * 1440 || j.depart >= end || j.party.length === 0) continue;
      const drop = dropOf(j);
      const left = far(drop.site, l.toSite);
      if (left >= here) continue;
      if (!best || left < best.left || (left === best.left && j.id < best.j.id)) best = { j, drop, left };
    }
    if (best) {
      const t = best.j.party[0]!;
      l.carrier = { journey: best.j.id, person: t.person, name: t.name, to: best.drop.site, arrive: best.drop.minute };
      l.at = null;
    }
  }
  // Old letters are dropped.
  (realm as Realm & { letters?: Letter[] }).letters = list.filter((l) => !((l.arrived !== undefined && day - l.arrived > KEEP && l.read !== undefined) || (l.lost && day - l.lost.day > KEEP)));
}

/** Letters for the player waiting where they are: given to them (a line each, and news of the followed writer). */
export function collectLetters(realm: Realm, store: WorldStore, p: PlayerState, site: string, day: number): string[] {
  const lines: string[] = [];
  const mine = (p.letters ??= []);
  for (const l of lettersOf(realm)) {
    if (l.to !== "player" || l.arrived === undefined || l.toSite !== site || mine.some((m) => m.id === l.id)) continue;
    l.read = day;
    mine.push(structuredClone(l));
    if (mine.length > 30) mine.shift();
    const by = l.legs.map((x) => x.name).join(", then ");
    lines.push(`A letter for you from ${l.fromName}, written on day ${l.written}${by ? ` and carried by ${by}` : ""}: "${l.text}"`);
    for (const ref of l.about) noticeFollowed(realm, store, p, ref, day, `a letter from ${l.fromName}`, 1);
  }
  return lines;
}

/** What it costs the player to send a letter: a little, more the farther it goes. */
export function postage(data: RoadData, from: string, to: string): number {
  const tiles = tilesFrom(data, from).get(to) ?? 8000;
  return 2 + Math.round(tiles / 2000);
}

/** The player writes to someone they follow, to where they last knew them to be. */
export function playerWrites(realm: Realm, data: RoadData, p: PlayerState, site: string, to: string, text: string, day: number): string {
  const f = followsOf(p)[to];
  if (!f) return "Write to someone you keep track of.";
  const toSite = f.lastKnown?.site;
  if (!toSite) return `You don't know where ${f.name} is to write to.`;
  if (f.lastKnown?.dead) return `${f.name} is dead.`;
  const cost = postage(data, site, toSite);
  if (p.money < cost) return `Sending it costs ${formatMoney(cost)}.`;
  p.money -= cost;
  const body = text.trim().slice(0, 300) || `Thinking of you. — ${p.name}`;
  writeLetter(realm, { from: "player", fromName: p.name, to, toName: f.name, about: [], text: body, written: day, fromSite: site, toSite });
  return `You leave a letter for ${f.name} at ${realm.settlements[toSite]?.name ?? "their place"} with the next traveller going that way (${formatMoney(cost)}).`;
}

/** A follow-up for the writer of a letter: news worth writing of, in their own plain words (the template the model betters). */
export function letterText(fromName: string, toName: string, events: Array<{ kind: string; details: string }>, place: string): string {
  const first = fromName.split(" ")[0];
  const news = events.map((e) => (e.kind === "marriage" ? `I am married now: ${e.details.replace(/^.*married /, "")}` : e.kind === "birth" ? `we have a child: ${e.details.replace(/^.* bore /, "")}` : e.kind === "migration" ? `we have moved, and live in ${place} now` : e.details)).join("; and ");
  return `Dear ${toName.split(" ")[0]}, I write from ${place}. ${news[0]?.toUpperCase()}${news.slice(1)}. We are well. — ${first}`;
}
