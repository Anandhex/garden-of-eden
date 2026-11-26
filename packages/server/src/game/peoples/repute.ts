import type { PlayerState } from "../../npc/types.js";
import { PEOPLES, stanceOf } from "../../world/species.js";

/**
 * Reputation by people (N54 D3): beside a place's and a faction's view of the player, each people has one, -100..100, kept on the player
 * (`society.peoples`). A deed against one of a people lowers it with all of them; peoples who hate that people (a stance of -60 or worse)
 * think better of the player for it. Time spent among them raises it a little, never past a friend's mark that way.
 */
export const BEFRIEND_CAP = 30;

export function peopleReputeOf(p: PlayerState): Record<string, number> {
  return ((p.society ??= {}).peoples ??= {}) as Record<string, number>;
}

const clamp = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));

export function shiftPeopleRepute(p: PlayerState, species: string, delta: number): number {
  const r = peopleReputeOf(p);
  r[species] = clamp((r[species] ?? 0) + delta);
  return r[species]!;
}

/** The people a fight template belongs to, if it's one of the peoples (not a plain animal or a human bandit). */
export function peopleOfCreature(template: string): string | undefined {
  const p = PEOPLES.find((x) => x.creature === template && x.living !== "wild" && x.id !== "human");
  return p?.id;
}

/** The player killed (or routed) one of a people: it's remembered by them, and by those who hate them. Returns lines for the player. */
export function deedAgainstPeople(p: PlayerState, species: string, killed: boolean): string[] {
  const after = shiftPeopleRepute(p, species, killed ? -8 : -3);
  const glad: string[] = [];
  for (const other of PEOPLES) {
    if (other.id === species || other.living === "wild" || stanceOf(other.id, species) > -60) continue;
    shiftPeopleRepute(p, other.id, killed ? 3 : 1);
    glad.push(other.id);
  }
  const name = PEOPLES.find((x) => x.id === species)?.name.replace(/^(an?|one of the) /, "") ?? species;
  return after <= -30 ? [`Word will spread among the ${name.endsWith("folk") ? name : `${name}s`}: they won't forget you.`] : [];
}

/** An hour among residents of a people: a little goodwill, up to a friend's mark. */
export function befriendPeople(p: PlayerState, species: string): number {
  const now = peopleReputeOf(p)[species] ?? 0;
  if (now >= BEFRIEND_CAP) return now;
  return shiftPeopleRepute(p, species, Math.min(3, BEFRIEND_CAP - now));
}
