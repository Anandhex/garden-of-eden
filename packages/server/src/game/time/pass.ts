import { config } from "../../config.js";
import { townEventsOn } from "../events-calendar.js";
import { describeKnown } from "../gossip/describe.js";
import { needsOf } from "../road/needs.js";
import type { Town } from "../town.js";
import { seasonOf } from "../weather.js";

/**
 * Moving through time (N35): one engine for waiting, sleeping, skipping a day or a season. It passes the world an hour
 * at a time with the same step the clock always uses (so nothing about the world's rolls changes), checks the wake
 * conditions after each hour, and stops at the first that's true. Danger always wakes the player. What the player heard
 * meanwhile is gathered into a short summary: news of people they follow first, with source and how sure.
 */
export type WakeCondition =
  | { kind: "followed"; who?: string; what?: Array<"ill" | "dead" | "married" | "moved" | "rank" | "any"> }
  | { kind: "arrives"; who: string }
  | { kind: "job" }
  | { kind: "season" }
  | { kind: "time"; at: number }
  | { kind: "festival" }
  | { kind: "market" };

export interface Heard {
  ref: string;
  text: string;
  sure: string;
  source: string;
  followed: boolean;
}

export interface PassResult {
  hours: number;
  stoppedBy?: { kind: string; text: string; ref?: string };
  heard: Heard[];
  spent: number;
  log: string[];
}

/** The longest wait or skip: a season of the year (N35 decision 4). */
export const maxSkipHours = (): number => Math.max(24, Math.floor(config.daysPerYear / 4) * 24);

const KIND_OF: Record<string, "ill" | "dead" | "married" | "moved" | "rank"> = { illness: "ill", death: "dead", marriage: "married", migration: "moved", promoted: "rank", "seat-won": "rank", knighted: "rank" };

const sureWords = (a: number) => (a >= 0.95 ? "sure" : a >= 0.8 ? "fairly sure" : a >= 0.6 ? "not sure" : "a rumour");

/** The absolute game hour now. */
const hourNow = (t: Town) => (t.world.day - 1) * 24 + t.world.hour;

/**
 * Pass time until a condition is met or `maxHours` have gone by. `step` passes hours the way the caller's clock does
 * (the server's passHours, which also moves what's on the map); a test may pass `town.passHours`.
 */
export function passUntil(town: Town, o: { maxHours: number; conditions: WakeCondition[]; step?: (hours: number) => string[] }): PassResult {
  const step = o.step ?? ((h: number) => town.passHours(h));
  const w = town.world;
  const p = w.player;
  const site = town.site();
  const realm = w.realm;
  const store = town.store;
  const startKnown = new Set(Object.keys(p.known ?? {}));
  const heardBefore = new Map(Object.entries(p.follows ?? {}).map(([id, f]) => [id, f.heard.length]));
  const season0 = seasonOf(w.day);
  const raided0 = realm?.settlements[site]?.lastRaided;
  const money0 = p.money;
  const jobs = () => town.talkersAt(site).reduce((a, id) => a + (town.agents[id]?.state.questBoard.length ?? 0), 0);
  const jobs0 = jobs();
  const siteOf = (id: string) => store?.people.get(id)?.site ?? null;
  const arrivals0 = new Map(o.conditions.filter((c): c is { kind: "arrives"; who: string } => c.kind === "arrives").map((c) => [c.who, siteOf(c.who)]));
  const log: string[] = [];
  let hours = 0;
  let stoppedBy: PassResult["stoppedBy"];
  const max = Math.max(1, Math.min(o.maxHours, maxSkipHours()));
  while (hours < max && !stoppedBy) {
    log.push(...step(1));
    hours++;
    for (const c of o.conditions) {
      if (c.kind === "followed") {
        for (const [id, f] of Object.entries(p.follows ?? {})) {
          if (c.who && c.who !== id) continue;
          const fresh = f.heard.slice(heardBefore.get(id) ?? 0);
          const hit = fresh.find((h) => {
            if (!c.what || c.what.includes("any")) return true;
            const ev = h.ref.startsWith("e:") ? store?.eventById(h.ref.slice(2)) : null;
            const kind = h.ref.startsWith("d:") ? "dead" : ev ? KIND_OF[ev.kind] : undefined;
            return !!kind && c.what.includes(kind);
          });
          if (hit) {
            stoppedBy = { kind: "followed", text: `Word of ${f.name}: ${hit.text} (${hit.from}).`, ref: hit.ref };
            break;
          }
        }
      } else if (c.kind === "arrives") {
        const now = siteOf(c.who);
        if (now === site && arrivals0.get(c.who) !== site) stoppedBy = { kind: "arrives", text: `${store?.people.get(c.who)?.name ?? "They"} has come to ${realm?.settlements[site]?.name ?? "town"}.` };
      } else if (c.kind === "job") {
        if (jobs() > jobs0) stoppedBy = { kind: "job", text: "There's new work going here." };
      } else if (c.kind === "season") {
        if (seasonOf(w.day) !== season0) stoppedBy = { kind: "season", text: `${seasonOf(w.day)[0]!.toUpperCase()}${seasonOf(w.day).slice(1)} has come.` };
      } else if (c.kind === "time") {
        if (hourNow(town) >= c.at) stoppedBy = { kind: "time", text: "It's time." };
      } else if (c.kind === "festival" || c.kind === "market") {
        if (w.hour >= 8 && townEventsOn(w).includes(c.kind)) stoppedBy = { kind: c.kind, text: c.kind === "market" ? "It's market day." : "The festival has begun." };
      }
      if (stoppedBy) break;
    }
    // Always: danger (checked after the chosen conditions, so news that came in the same hour isn't lost: either wakes them).
    if (stoppedBy) break;
    if (realm && realm.settlements[site]?.lastRaided !== raided0 && realm.settlements[site]?.lastRaided === w.day) stoppedBy = { kind: "danger", text: `Raiders fall on ${realm.settlements[site]?.name ?? "the place"}!` };
    else if (p.road && needsOf(p, (w.day - 1) * 1440 + w.hour * 60).food < 8) stoppedBy = { kind: "danger", text: "You're faint with hunger." };
    else if (p.hp <= p.maxHp * 0.25) stoppedBy = { kind: "danger", text: "You're badly hurt." };
  }
  // What was heard: news of people followed first, then the rest, newest first, a dozen at most.
  const heard: Heard[] = [];
  const followedRefs = new Set(Object.values(p.follows ?? {}).flatMap((f) => f.heard.map((h) => h.ref)));
  for (const [ref, k] of Object.entries(p.known ?? {})) {
    if (startKnown.has(ref) || !realm || !store) continue;
    const text = k.text ?? describeKnown({ realm, store }, ref, k.accuracy ?? 1, k.variant ?? 0);
    if (!text) continue;
    const from = k.from ? (store.people.get(k.from)?.name ?? town.personas[k.from]?.name ?? k.from) : k.how;
    heard.push({ ref, text, sure: sureWords(k.accuracy ?? 1), source: from, followed: followedRefs.has(ref) });
  }
  heard.sort((a, b) => Number(b.followed) - Number(a.followed) || (p.known![b.ref]!.day - p.known![a.ref]!.day));
  return { hours, ...(stoppedBy ? { stoppedBy } : {}), heard: heard.slice(0, 12), spent: Math.max(0, money0 - p.money), log };
}

/** The summary of a wait or skip, in lines. */
export function summaryLines(r: PassResult): string[] {
  const out = [`${r.hours} hour${r.hours === 1 ? "" : "s"} pass${r.hours === 1 ? "es" : ""}.${r.stoppedBy ? ` ${r.stoppedBy.text}` : ""}`];
  if (r.heard.length > 0) out.push(`What you heard: ${r.heard.map((h) => `${h.text} (${h.source}, ${h.sure})`).join("; ")}.`);
  if (r.spent > 0) out.push(`You spent ${r.spent} copper.`);
  return out;
}
