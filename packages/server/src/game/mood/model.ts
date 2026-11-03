import { config } from "../../config.js";
import { festivalOn } from "../events-calendar.js";
import { atWar, FAMINE } from "../realm/economy.js";
import { isTaxDay, WAR_TAX } from "../realm/politics.js";
import type { Realm, Settlement } from "../realm/types.js";

/**
 * The mood of a place (N36): six numbers, 0..100, worked out in code each day from what happened there and how many
 * there felt it, decaying toward a baseline set by how the place lives. Not one emotion: a place can grieve and be angry
 * at once. Kept on the settlement (so every place, lived in by rows or not, has one, the same either way) and copied into
 * its day's conditions for everyone's rules to read. Computed from events and conditions, never from the people's own
 * moods (no loop).
 */
export const MOOD_KINDS = ["grief", "fear", "anger", "joy", "hope", "unease"] as const;
export type MoodKind = (typeof MOOD_KINDS)[number];
export type Mood = Record<MoodKind, number> & { causes?: Array<{ ref: string; mood: MoodKind; push: number }> };

/** Half-lives in days: grief lasts about a season, joy a few days. */
const HALF_LIFE: Record<MoodKind, number> = { grief: 7, fear: 4, anger: 6, joy: 2, hope: 6, unease: 4 };
/** The biggest push one shock can give. */
export const SHOCK_CAP = 60;
/** A mood counts as the place's mood above this. */
export const DOMINANT = 30;

export const calm = (): Mood => ({ grief: 0, fear: 0, anger: 0, joy: 0, hope: 0, unease: 0 });

/** Where a place's mood settles with nothing happening: a poor or hungry place is uneasy, a thriving one hopeful. */
export function baseline(s: Pick<Settlement, "prosperity" | "food">): Mood {
  const b = calm();
  b.unease = Math.max(0, Math.round((45 - s.prosperity) * 0.6 + (s.food < 30 ? (30 - s.food) * 0.5 : 0)));
  b.hope = Math.max(0, Math.round((s.prosperity - 55) * 0.5));
  return b;
}

/** The mood that shows: the highest above DOMINANT, or null (an ordinary day). */
export function dominant(m: Partial<Mood> | undefined): MoodKind | null {
  if (!m) return null;
  let best: MoodKind | null = null;
  for (const k of MOOD_KINDS) if ((m[k] ?? 0) > DOMINANT && (!best || (m[k] ?? 0) > (m[best] ?? 0))) best = k;
  return best;
}

export const MOOD_WORDS: Record<MoodKind, string> = { grief: "grieving", fear: "afraid", anger: "angry", joy: "glad", hope: "hopeful", unease: "uneasy" };

/** A day's shocks: what pushed which mood, and why. */
export interface Shock {
  ref: string;
  mood: MoodKind;
  push: number;
}

/**
 * Today's shocks at a place, from the realm: deaths ordered for today (by cause, weighted by the share of the place's
 * families they touch), a raid, a war begun and a war won or lost, a tax day's war levy or heavy share, hunger, the
 * harvest judged, a festival (more when the harvest was good).
 */
export function shocksOf(realm: Realm, s: Settlement, day: number, yesterdayAtWar: boolean): Shock[] {
  const out: Shock[] = [];
  const pop = Math.max(10, s.population);
  const cap = (n: number) => Math.min(SHOCK_CAP, Math.round(n));
  // The dead: each touches a family of about four.
  const dead = realm.casualties.filter((c) => c.site === s.id && c.day === day);
  for (const c of dead) {
    const felt = Math.min(1, (c.count * 4) / pop);
    const ref = c.event ?? `${c.cause}:${day}:${s.id}`;
    out.push({ ref, mood: "grief", push: cap(20 + 160 * felt) });
    if (["raid", "battle", "siege", "beast"].includes(c.cause)) out.push({ ref, mood: "fear", push: cap(10 + 80 * felt) });
    if (["raid", "battle", "siege", "murder", "execution"].includes(c.cause)) out.push({ ref, mood: "anger", push: cap(8 + 60 * felt) });
  }
  if (s.lastRaided === day) {
    out.push({ ref: `raid:${day}:${s.id}`, mood: "fear", push: 25 }, { ref: `raid:${day}:${s.id}`, mood: "anger", push: 15 });
  }
  const war = atWar(realm, s);
  if (war && !yesterdayAtWar) out.push({ ref: `war:${day}:${s.id}`, mood: "fear", push: 25 });
  // A war's end: the winners' places are glad and hopeful, the losers' angry (taxes and tribute to come).
  for (const w of realm.wars) {
    if (w.end !== day || !w.winner || w.winner === "none" || !s.kingdom) continue;
    const side = w.attackers.includes(`k:${s.kingdom}`) ? "attackers" : w.defenders.includes(`k:${s.kingdom}`) ? "defenders" : null;
    if (!side) continue;
    if (side === w.winner) out.push({ ref: `victory:${w.id}`, mood: "joy", push: 30 }, { ref: `victory:${w.id}`, mood: "hope", push: 15 });
    else out.push({ ref: `defeat:${w.id}`, mood: "anger", push: 15 }, { ref: `defeat:${w.id}`, mood: "grief", push: 10 });
  }
  // Tax day: a war levy on top of the usual share angers a place, and so does a heavy share.
  if (isTaxDay(day) && s.liege && (s.taxRate > 0.25 || war)) out.push({ ref: `tax:${day}:${s.id}`, mood: "anger", push: (war ? Math.round(WAR_TAX * 250) : 0) + (s.taxRate > 0.25 ? Math.round((s.taxRate - 0.25) * 80) + 6 : 0) });
  if (s.food < FAMINE) out.push({ ref: `famine:${s.id}`, mood: "unease", push: 6 }, ...(s.hungrySince !== undefined && day - s.hungrySince > 5 ? [{ ref: `famine:${s.id}`, mood: "anger" as const, push: 4 }] : []));
  // The harvest, judged on the first day of winter (N30).
  const h = s.harvest;
  if (h?.yield && h.after !== undefined && day === firstOfWinter(day)) {
    if (h.yield === "good") out.push({ ref: `harvest:${h.year}:${s.id}`, mood: "joy", push: 25 }, { ref: `harvest:${h.year}:${s.id}`, mood: "hope", push: 20 });
    else if (h.yield === "poor") out.push({ ref: `harvest:${h.year}:${s.id}`, mood: "unease", push: 25 });
  }
  // A festival: a day's joy, more after a good harvest and in good times.
  const fest = festivalOn(day);
  if (fest) {
    const good = (h?.yield ?? h?.last) === "good";
    out.push({ ref: `festival:${day}:${s.id}`, mood: "joy", push: 15 + (good ? 25 : 0) + (s.prosperity > 60 ? 5 : 0) });
  }
  return out;
}

function firstOfWinter(day: number): number {
  const dpy = config.daysPerYear;
  const doy = (((day - 1) % dpy) + dpy) % dpy;
  const start = Math.ceil((3 * dpy) / 4);
  return doy === start ? day : -1;
}

/** Yesterday's mood, decayed toward today's baseline, plus today's shocks. Pure. */
export function nextMood(prev: Mood | undefined, base: Mood, shocks: Shock[]): Mood {
  const p = prev ?? base;
  const out = calm();
  for (const k of MOOD_KINDS) {
    const keep = 0.5 ** (1 / HALF_LIFE[k]);
    out[k] = base[k] + (p[k] - base[k]) * keep;
  }
  for (const sh of shocks) out[sh.mood] = Math.min(100, out[sh.mood] + sh.push);
  for (const k of MOOD_KINDS) out[k] = Math.max(0, Math.min(100, Math.round(out[k] * 10) / 10));
  // The strongest causes of today's mood, kept for the admin and for talk.
  const causes = [...shocks].sort((a, b) => b.push - a.push).slice(0, 4);
  if (causes.length > 0) out.causes = causes;
  else if (prev?.causes) out.causes = prev.causes;
  return out;
}

/** Every place's mood for the day (in the realm's day, before the people step). */
export function moodRealmDay(realm: Realm, day: number): void {
  for (const s of Object.values(realm.settlements)) {
    if (s.abandoned) continue;
    const prev = s.mood as Mood | undefined;
    const warYesterday = s.moodWar ?? false;
    const shocks = shocksOf(realm, s, day, warYesterday);
    s.mood = nextMood(prev, baseline(s), shocks);
    s.moodWar = atWar(realm, s);
    // For the bounds: days each mood showed, and how long a mood has stood high without a fresh shock of its kind.
    const d = dominant(s.mood as Mood);
    if (d) realm.stats[`mood_${d}`] = (realm.stats[`mood_${d}`] ?? 0) + 1;
    const high = MOOD_KINDS.find((k) => (s.mood as Mood)[k] >= PINNED);
    if (!high || shocks.some((x) => x.mood === high)) delete s.moodHigh;
    else if (s.moodHigh?.kind !== high) s.moodHigh = { kind: high, since: day };
  }
}

/** A mood this high is "pinned" if it stays there more than a season with no fresh shock of its kind (`moods-move`). */
export const PINNED = 70;

/** N36's bound: `moods-move` (no place pinned in one mood above 70 for more than a season without fresh shocks; how often each showed). */
export function checkMoodBounds(realm: Realm, day: number): Array<{ name: string; ok: boolean; detail: string }> {
  const season = Math.max(1, Math.floor(config.daysPerYear / 4));
  const stuck = Object.values(realm.settlements).filter((s) => s.moodHigh && day - s.moodHigh.since > season);
  const shown = MOOD_KINDS.map((k) => `${k} ${realm.stats[`mood_${k}`] ?? 0}`).join(", ");
  return [{ name: "moods-move", ok: stuck.length === 0, detail: stuck.length ? `stuck: ${stuck.slice(0, 3).map((s) => `${s.name} (${s.moodHigh!.kind})`).join(", ")}` : `days shown: ${shown}` }];
}

/** A line for talkers and the header: "Northmere is grieving (after the raid on day 12)." */
export function moodLine(s: Pick<Settlement, "name" | "mood">, realm: Realm): string | null {
  const m = s.mood as Mood | undefined;
  const d = dominant(m);
  if (!d || !m) return null;
  const cause = m.causes?.find((c) => c.mood === d);
  const why = cause ? describeCause(cause.ref, realm) : null;
  return `${s.name} is ${MOOD_WORDS[d]}${why ? ` (${why})` : ""}.`;
}

function describeCause(ref: string, realm: Realm): string | null {
  const [kind, day] = ref.split(":");
  if (kind === "raid") return `after the raid on day ${day}`;
  if (kind === "war") return "now the war has come";
  if (kind === "famine") return "the granaries are empty";
  if (kind === "harvest") return "the harvest is in";
  if (kind === "festival") return "the festival";
  const n = realm.news.find((x) => x.id === ref);
  return n ? n.text.replace(/\.$/, "").toLowerCase() : null;
}

/** The mood line of the place the world's player is in, or null. */
export function moodLineHere(world: object): string | null {
  const w = world as { realm?: Realm | null; player?: { site?: string } };
  const s = w.realm && w.player?.site ? w.realm.settlements[w.player.site] : undefined;
  return s && w.realm ? moodLine(s, w.realm) : null;
}
