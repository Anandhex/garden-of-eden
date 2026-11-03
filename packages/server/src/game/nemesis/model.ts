import { seasonDay } from "@millbrook/shared";
import { config } from "../../config.js";
import type { PlayerState } from "../../npc/types.js";
import { parseItem } from "../items.js";
import type { Realm } from "../realm/types.js";
import { seasonOf } from "../weather.js";

/**
 * A nemesis (N44): the record of one person who has a grudge against the player and survived them. Every meeting is kept (where, when,
 * how it went, what the player used), and what the nemesis knows of the player's way of fighting is counts, not words: weapons by kind,
 * companions, sneaking, running. What they do about it is a table of counters (prepare.ts).
 */

export interface Meeting {
  day: number;
  site: string | null;
  kind: "fight" | "talk" | "contest" | "job" | "crime";
  /** How it ended for them: beaten and let go (spared), ran (fled), won, or no blows. */
  outcome: "spared" | "fled" | "won" | "lost" | "words";
  playerUsed: { weapon?: string; skill?: string; abilities: string[]; companions: number; tricks: string[] };
  wounds?: number;
  ref?: string;
}

export interface StyleModel {
  weapons: Record<string, number>;
  skills: Record<string, number>;
  companions: number;
  sneaks: number;
  ranged: number;
  fled: number;
  magic: number;
}

export type Stage = "rising" | "striking" | "finish" | "won_over" | "dead" | "outlasted";

export interface Nemesis {
  who: string;
  name: string;
  since: number;
  cause: string;
  stage: Stage;
  /** The rung of their revenge (N40's ladder): gather, rise, strike, finish. */
  step: "gather" | "rise" | "strike" | "finish";
  knows: StyleModel;
  /** The counters they have made: "shield", "armour", "men", "watch", "weapon". */
  prepared: string[];
  /** Men they have hired (people row or figure ids: nobody made up). */
  men: string[];
  /** The rank they rose to, and the titles they got from meetings with the player. */
  rank?: string;
  titles: string[];
  scars: string[];
  lastStrike?: number;
  struck: Array<{ day: number; what: string; site: string | null }>;
  /** The taunt they will open with when they face the player again. */
  taunt?: string;
  /** The day they came to face the player (a staged encounter). */
  faced?: number;
}

export interface NemesisState {
  list: Nemesis[];
  /** Meetings with the player of everyone who survived one, by who: the candidates. */
  meetings: Record<string, Meeting[]>;
}

export function nemesesOf(realm: Realm): NemesisState {
  const n = (realm.nemeses ??= { list: [], meetings: {} }) as NemesisState;
  n.list ??= [];
  n.meetings ??= {};
  return n;
}

/** The most nemeses at once (decision 1: the threshold and the cap keep it special). */
export const MAX_NEMESES = 2;
/** The least grudge for a candidate. */
export const LEAST_GRUDGE = 0.5;
/** At most one strike a season (the strikes-rare bound). */
export const strikeEvery = (): number => Math.max(1, Math.floor(config.daysPerYear / 4));

/** What the player fought with: the weapon in hand and its skill. */
export function usedBy(p: Pick<PlayerState, "equipment" | "sneaking">, companions: number, abilities: string[] = []): Meeting["playerUsed"] {
  const w = p.equipment?.weapon ? parseItem(p.equipment.weapon) : undefined;
  return { ...(w ? { weapon: w.name, skill: w.def.weapon?.skill } : { weapon: "fists", skill: "unarmed" }), abilities, companions, tricks: p.sneaking ? ["sneak"] : [] };
}

/** Record a meeting for someone who survived it (the candidates' log, decision 2). */
export function recordMeeting(realm: Realm, who: string, m: Meeting): void {
  const s = nemesesOf(realm);
  s.meetings[who] = [...(s.meetings[who] ?? []), m].slice(-12);
  const n = s.list.find((x) => x.who === who && (x.stage === "rising" || x.stage === "striking" || x.stage === "finish"));
  if (n) {
    n.knows = styleOf(s.meetings[who]!);
    // Beaten again and alive: a scar, and the grudge burns hotter (decision 7).
    if (m.outcome === "spared" || m.outcome === "fled") n.scars.push(`a scar from day ${m.day}`);
  }
}

/** The style model: counts from the meetings. */
export function styleOf(ms: Meeting[]): StyleModel {
  const out: StyleModel = { weapons: {}, skills: {}, companions: 0, sneaks: 0, ranged: 0, fled: 0, magic: 0 };
  for (const m of ms) {
    if (m.playerUsed.weapon) out.weapons[m.playerUsed.weapon] = (out.weapons[m.playerUsed.weapon] ?? 0) + 1;
    if (m.playerUsed.skill) out.skills[m.playerUsed.skill] = (out.skills[m.playerUsed.skill] ?? 0) + 1;
    if (m.playerUsed.companions > 0) out.companions++;
    if (m.playerUsed.tricks.includes("sneak")) out.sneaks++;
    if (m.playerUsed.skill === "archery") out.ranged++;
    if (m.outcome === "won") out.fled++;
  }
  return out;
}

/** Their favourite weapon of the player's (the one used most), if any. */
export const favouredWeapon = (k: StyleModel): string | null => Object.entries(k.weapons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** The day they met, as they'd say it: "the third day of spring" (decision 6). */
export function dayWords(day: number): string {
  const sd = seasonDay(day, config.daysPerYear);
  const words = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
  return `the ${words[sd] ?? ordinal(sd)} day of ${seasonOf(day)}`;
}

/** The taunt from the meeting log (decision 6's template; the model's `taunt` may say it better). */
export function templateTaunt(realm: Realm, ms: Meeting[], playerName: string): string {
  const first = ms[0];
  if (!first) return `${playerName}. We meet again.`;
  const where = first.site ? (realm.settlements[first.site]?.name ?? "the road") : "the road";
  const how = first.outcome === "spared" ? "You let me live. You shouldn't have." : first.outcome === "fled" ? "I ran from you once. Not today." : "You'll not have it so easy this time.";
  const weapon = first.playerUsed.weapon && first.playerUsed.weapon !== "fists" ? ` You and your ${first.playerUsed.weapon}.` : "";
  return `${where}'s road, ${dayWords(first.day)}.${weapon} ${how}`;
}
