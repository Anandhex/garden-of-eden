import type { NpcPersona, PlayerState, WorldSnapshot } from "../npc/types.js";
import { formatMoney } from "./money.js";
import type { GameEvent } from "./events.js";
import { factionOf, shiftStanding, STANDING } from "./factions.js";
import { note } from "./journal.js";

/**
 * Crimes (N7): attacking, killing, stealing or looting in a place. A crime only
 * counts once a guard knows of it: they saw it, or someone told them (gossip
 * carries the event, game/gossip.ts). Then there's a bounty, the guard brings it up
 * (npc/initiative.ts), won't deal with the player, and at a high enough bounty
 * tries to arrest them by force. The player can /payfine or /surrender (time in the
 * cells instead of coin). Hurting bandits isn't a crime.
 */
export const CRIME_KINDS = ["assault", "murder", "theft", "looting"] as const;
export type CrimeKind = (typeof CRIME_KINDS)[number];

export interface Crime {
  id: string;
  kind: CrimeKind;
  /** NPC id of the victim. */
  victim: string;
  victimName: string;
  day: number;
  /** The event it came from (game/events.ts). */
  event: string;
  fine: number;
  /** Paid or served. */
  settled?: boolean;
}

/** Fines in copper. Theft is twice the value taken, at least FINES.theft. */
export const FINES: Record<CrimeKind, number> = { assault: 200, murder: 2000, theft: 100, looting: 500 };
/** A bounty this high and the guard will try to take the player by force. */
export const ARREST_BOUNTY = 1000;
/** Hours in the cells per gold of fine, when the player surrenders instead of paying (at least 4, at most 48). */
export const JAIL_HOURS_PER_GOLD = 2;

/** The crime an event is, if any: what the player did to a villager (not a bandit). */
export function crimeFor(event: GameEvent, personas: Record<string, NpcPersona>): CrimeKind | null {
  if (event.actor !== "player") return null;
  const victim = personas[event.target];
  if (!victim) return null;
  if (factionOf({ persona: victim })?.id === "gang") return null;
  if (event.kind === "attacked") return "assault";
  if (event.kind === "killed") return "murder";
  if (event.kind === "theft-caught" || event.kind === "theft") return "theft";
  if (event.kind === "looted") return "looting";
  return null;
}

/** Guards: NPCs with `guard: true` who are alive. */
export function isGuard(persona: Pick<NpcPersona, "guard">): boolean {
  return persona.guard === true;
}

/** Copper the player is wanted for. */
export function bountyOf(player: Pick<PlayerState, "bounty">): number {
  return player.bounty ?? 0;
}

/**
 * Check the log for crimes a guard now knows of, and put a price on them. Returns
 * lines for the player. Safe to call often: each event becomes a crime once.
 */
export function reportCrimes(world: Pick<WorldSnapshot, "events" | "player" | "day">, personas: Record<string, NpcPersona>, guards: string[]): string[] {
  const player = world.player;
  const log: string[] = [];
  const crimes = (player.crimes ??= []);
  for (const e of world.events ?? []) {
    const kind = crimeFor(e, personas);
    if (!kind || crimes.some((c) => c.event === e.id)) continue;
    const guard = guards.find((g) => (e.knownBy ?? e.witnesses ?? []).includes(g));
    if (!guard) continue;
    const valueMatch = e.details.match(/worth (\d+)c/);
    const fine = kind === "theft" ? Math.max(FINES.theft, 2 * Number(valueMatch?.[1] ?? 0)) : FINES[kind];
    const victim = personas[e.target]!;
    crimes.push({ id: `crime-${e.id}`, kind, victim: victim.id, victimName: victim.name, day: e.day, event: e.id, fine });
    player.bounty = bountyOf(player) + fine;
    shiftStanding(player, "guard", kind === "murder" ? STANDING.killed : STANDING.attacked / 2);
    note(player, { id: `crime-${e.id}`, day: world.day, kind: "rumour", text: `The guard wants you for ${kind} (${victim.name}). Fine: ${formatMoney(fine)}.` });
    log.push(`${personas[guard]?.name ?? "The guard"} knows about the ${kind} of ${victim.name}. There's a bounty of ${formatMoney(player.bounty)} on you.`);
  }
  return log;
}

/** Crimes the player hasn't paid for. */
export function openCrimes(player: Pick<PlayerState, "crimes">): Crime[] {
  return (player.crimes ?? []).filter((c) => !c.settled);
}

/** Pay the fine in full to a guard (/payfine). */
export function payFine(player: PlayerState): { ok: boolean; message: string; paid: number } {
  const owed = bountyOf(player);
  if (owed <= 0) return { ok: false, paid: 0, message: "You're not wanted for anything." };
  if (player.money < owed) return { ok: false, paid: 0, message: `The fine is ${formatMoney(owed)}; you have ${formatMoney(player.money)}. You could /surrender instead.` };
  player.money -= owed;
  settleAll(player);
  shiftStanding(player, "guard", STANDING.finePaid);
  return { ok: true, paid: owed, message: `You paid ${formatMoney(owed)} in fines. The guard calls it settled.` };
}

/** Give yourself up (/surrender): hours in the cells instead of coin. Returns the hours to pass. */
export function surrender(player: PlayerState): { ok: boolean; message: string; hours: number } {
  const owed = bountyOf(player);
  if (owed <= 0) return { ok: false, hours: 0, message: "You're not wanted for anything." };
  const hours = Math.max(4, Math.min(48, Math.round((owed / 100) * JAIL_HOURS_PER_GOLD)));
  settleAll(player);
  return { ok: true, hours, message: `You give yourself up and spend ${hours} hours in the cells. The slate is clean.` };
}

function settleAll(player: PlayerState): void {
  for (const c of player.crimes ?? []) c.settled = true;
  player.bounty = 0;
}

/** For a guard's situation: what the player is wanted for, or null. */
export function describeWanted(persona: Pick<NpcPersona, "guard">, player: PlayerState): string | null {
  if (!isGuard(persona) || bountyOf(player) <= 0) return null;
  const crimes = openCrimes(player);
  const what = [...new Set(crimes.map((c) => `${c.kind} (${c.victimName})`))].join(", ");
  const force = bountyOf(player) >= ARREST_BOUNTY ? " It's serious enough that you should arrest them, by force if you must." : "";
  return `${player.name} is wanted for ${what}. The fine is ${formatMoney(bountyOf(player))}: they can pay it or come quietly. You won't deal with them until they do.${force}`;
}
