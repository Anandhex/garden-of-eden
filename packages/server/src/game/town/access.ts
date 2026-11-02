import { canEnter, CLASS_RANK, type District, type Entrant, type SocialClass, type Verdict } from "@millbrook/shared";
import type { PlayerState } from "../../npc/types.js";
import { skillLevel } from "../../npc/skills.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import { check, seedFrom, type Rng } from "../dice.js";
import { recordBribe, sentencePlayer } from "../law/justice.js";
import { traitsOfRow } from "../people/traits.js";
import { realmNews } from "../realm/log.js";
import type { Realm } from "../realm/types.js";
import { ageOn } from "../realm/who.js";

/**
 * Gates, posts and the ways in (N26H decisions 5–7). Every gate in the wall round a closed quarter is a post, manned by
 * the place's own guards on a rota of three watches: who is on the gate now is a function of the day and the hour, so the
 * guard bribed at night isn't the one on the gate at noon, and a post with nobody to fill it (the guards dead, away, at
 * war) stands empty. The player is let through by `canEnter` (rank, papers for the day, work), or gets past the guard by
 * a bribe the guard may take (by their greed and loyalty, and the stakes), by sneaking (against the guard's eyes, easier at
 * night), or by force (breaking in: a crime, and a price on their head).
 */
export interface Post {
  id: string;
  site: string;
  /** The district the gate lets into. */
  district: string;
  x: number;
  y: number;
}

/** The three watches of the day. */
export const watchOf = (hour: number): number => (hour < 8 ? 0 : hour < 16 ? 1 : 2);

/** The guards of a place who can stand a watch: grown, at home, alive. */
export function guardsOf(store: WorldStore, site: string, day: number): PersonRow[] {
  return (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job === "guard" && r.death === null && !r.away && r.persona === null && ageOn(r, day) >= 16).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Who is on a post now (the rota), or null if nobody is left to stand it. */
export function onDuty(store: WorldStore, post: Post, posts: Post[], day: number, hour: number): PersonRow | null {
  const guards = guardsOf(store, post.site, day);
  if (guards.length === 0) return null;
  const k = Math.max(0, posts.findIndex((p) => p.id === post.id));
  return guards[(k * 3 + watchOf(hour) + day) % guards.length]!;
}

/** The player as someone at a gate. */
export function playerEntrant(p: PlayerState, day: number): Entrant {
  return {
    cls: (p.cls as SocialClass | undefined) ?? "commoner",
    job: "adventurer",
    belongs: p.factions ?? [],
    papers: (p.papers ?? []).filter((x) => x.day === day),
  };
}

/** May the player go into this district now? */
export function playerMayEnter(p: PlayerState, d: District, day: number, hour: number): Verdict {
  return canEnter(playerEntrant(p, day), { id: d.id, name: d.name, access: d.access }, day, hour);
}

/** The guard's words at a gate the player may not pass. */
export function refusal(guard: PersonRow | null, d: District, v: Verdict): string {
  const who = guard ? guard.name : "Nobody is on the gate, but it's barred";
  const ways = v.unless.filter((w) => w !== "sneak" && w !== "bribe");
  return `${who}${guard ? " looks you over" : ""}. ${v.why[0]!.toUpperCase()}${v.why.slice(1)}.${ways.length ? ` (A ${ways.join(", a ").replace("relation", "friend inside").replace("invite", "invitation").replace("work", "job there")} would do it.)` : ""}`;
}

/** What a bribe at this gate costs, by the stakes: the palace dear, a noble street cheaper, more by night. */
export function bribePrice(d: District, hour: number): number {
  const base = d.kind === "palace" ? 300 : d.kind === "castle" ? 160 : d.kind === "noble" ? 60 : 40;
  return Math.round(base * (hour >= 20 || hour < 6 ? 1.4 : 1));
}

export interface GateOutcome {
  ok: boolean;
  lines: string[];
  /** Hours to pass (a sentence served). */
  hours: number;
}

/** Offer the guard on duty a bribe. Taken: a pass for the day (and a bribe on record). Refused: a loyal guard reports it. */
export function offerBribe(realm: Realm, store: WorldStore, p: PlayerState, post: Post, posts: Post[], d: District, day: number, hour: number, rng: Rng): GateOutcome {
  const guard = onDuty(store, post, posts, day, hour);
  const price = bribePrice(d, hour);
  if (!guard) return { ok: true, lines: ["Nobody is on the gate to bribe; it's yours to walk through."], hours: 0 };
  if (p.money < price) return { ok: false, lines: [`${guard.name} wouldn't look at less than ${price} copper.`], hours: 0 };
  const t = traitsOfRow(guard);
  const night = hour >= 20 || hour < 6;
  const takes = rng() < t.greed * 0.9 - t.loyalty * 0.5 + (night ? 0.15 : 0) + 0.15;
  if (takes) {
    p.money -= price;
    (p.papers ??= []).push({ kind: "pass", to: d.id, day, from: guard.id });
    // Anyone on another watch at the same gate? No: one guard a post. It comes out later if they talk.
    recordBribe(realm, store, { guard: guard.id, briber: "player", site: post.site, day, amount: price, witnesses: [], what: `let ${p.name} into ${d.name}` });
    return { ok: true, lines: [`${guard.name} pockets the ${price} copper and looks the other way.`], hours: 0 };
  }
  // Refused, and reported if they're loyal: bribery, before the place's head.
  if (t.loyalty > 0.5) {
    const r = sentencePlayer(realm, p, "bribery", post.site, day, rng);
    return { ok: false, lines: [`${guard.name} won't take it, and calls for the watch.`, ...r.lines], hours: r.hours };
  }
  return { ok: false, lines: [`${guard.name} shakes their head. "Not for that."`], hours: 0 };
}

/** Try to slip past the guard (by night, along the wall): sneaking against their eyes. Caught: trespass. */
export function sneakPast(realm: Realm, store: WorldStore, p: PlayerState, post: Post, posts: Post[], d: District, day: number, hour: number, rng: Rng): GateOutcome {
  const guard = onDuty(store, post, posts, day, hour);
  if (!guard) return { ok: true, lines: ["Nobody is watching. You're through."], hours: 0 };
  const night = hour >= 20 || hour < 6;
  const target = 12 + (d.kind === "palace" ? 4 : d.kind === "castle" ? 2 : 0) - (night ? 4 : 0);
  const r = check(rng, p.attributes.agility, target, skillLevel(p.skills, "sneak"));
  if (r.success) {
    (p.papers ??= []).push({ kind: "pass", to: d.id, day, from: "sneak" });
    return { ok: true, lines: [`You wait for ${guard.name} to look away, and you're over the wall.`], hours: 0 };
  }
  const s = sentencePlayer(realm, p, "trespass", post.site, day, rng);
  return { ok: false, lines: [`${guard.name} catches you on the wall.`, ...s.lines], hours: s.hours };
}

/** Force the gate: through, but it's breaking in, and the place puts a price on the player's head. */
export function forceGate(realm: Realm, store: WorldStore, p: PlayerState, post: Post, posts: Post[], d: District, day: number, hour: number, rng: Rng): GateOutcome {
  const guard = onDuty(store, post, posts, day, hour);
  (p.papers ??= []).push({ kind: "pass", to: d.id, day, from: "force" });
  const s = sentencePlayer(realm, p, "breaking_in", post.site, day, rng, { fled: true });
  realmNews(realm, day, post.site, "justice", `${p.name} forced the gate of ${d.name}${guard ? `, past ${guard.name}` : ""}.`, 5, [p.name]);
  return { ok: true, lines: [`You force your way past${guard ? ` ${guard.name}` : ""} and through the gate.`, ...s.lines], hours: 0 };
}

/**
 * A summons (N26H decision 6): an office calls the player in on a day: a document they carry, which the gate guards accept
 * on that day only. Writs (a lawful quest's pass) are the same with `kind: "writ"`.
 */
export function summon(p: PlayerState, to: District, day: number, by: string, kind: "summons" | "writ" = "summons"): void {
  (p.papers ??= []).push({ kind, to: to.id, day, from: by });
}

/** For tests and the admin view: the rank a district asks, as a number. */
export const rankFor = (d: District): number => CLASS_RANK[d.access.minClass ?? "commoner"];

export { seedFrom };
