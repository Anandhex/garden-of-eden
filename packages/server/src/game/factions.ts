import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { NpcPersona, PlayerState } from "../npc/types.js";

/**
 * Factions (N7.3): groups with their own standing towards the player, by kind, from data files
 * (src/data/factions/kinds/*.json): the guard, the merchants, the gangs of the road. A kind is
 * not a place or a person: every guard in the realm belongs to the guard, whichever town they serve.
 * Standing (-100..100) comes from what the player does to members, and to their
 * rivals: hurting a guard costs standing with the guard and wins some with the
 * bandits (each faction's `attitudes` say how it feels about the others). Standing
 * sets ranks, a member's discount, quest access and how wary members are.
 */
export const FactionSchema = z
  .object({
    id: z.string().regex(/^[a-z_]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    /** Creature template ids that belong too (bandits). */
    creatures: z.array(z.string()).optional(),
    /** How this faction feels about the others, -1..1. */
    attitudes: z.record(z.string(), z.number().min(-1).max(1)),
    /** Why, in words, for the model. */
    attitudeReasons: z.record(z.string(), z.string()).optional(),
    /** Ranks by standing, lowest first. A `member` rank is reached by joining. */
    ranks: z.array(z.object({ name: z.string().min(1), minStanding: z.number().min(-100).max(100), member: z.boolean().optional() })).min(1),
    joinable: z.boolean().default(false),
    /** Percent off members' prices for a member of the faction. */
    discount: z.number().min(0).max(50).default(0),
  })
  .strict();
export type Faction = z.infer<typeof FactionSchema>;

let cache: Record<string, Faction> | null = null;

/** Every faction, by id (cached). */
export function loadFactions(dir: URL = new URL("../data/factions/kinds/", import.meta.url)): Record<string, Faction> {
  if (cache) return cache;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  cache = Object.fromEntries(
    files.map((f) => {
      const r = FactionSchema.safeParse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
      if (!r.success) throw new Error(`src/data/factions/kinds/${f} is invalid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return [r.data.id, r.data];
    }),
  );
  return cache;
}

/** Problems with faction data: unknown creature kinds or attitude targets (a typo). */
export function badFactions(factions: Record<string, Faction>, creatureIds: string[]): string[] {
  const problems: string[] = [];
  for (const f of Object.values(factions)) {
    for (const c of f.creatures ?? []) if (!creatureIds.includes(c)) problems.push(`${f.id}: no creature "${c}"`);
    for (const other of Object.keys(f.attitudes)) if (!factions[other]) problems.push(`${f.id}: no faction "${other}"`);
  }
  return problems;
}

/** The faction kind a person made from a template belongs to, if any. */
export const FACTION_OF_TEMPLATE: Record<string, string> = { guard: "guard", merchant: "merchants", smith: "merchants", innkeeper: "merchants", bandit: "gang" };

/** The faction an NPC (by persona.faction) or a creature kind belongs to. */
export function factionOf(who: { persona?: Pick<NpcPersona, "id" | "faction">; creature?: string }, factions = loadFactions()): Faction | null {
  if (who.persona?.faction) return factions[who.persona.faction] ?? null;
  return Object.values(factions).find((f) => who.creature && f.creatures?.includes(who.creature)) ?? null;
}

const clamp = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));

export function standingWith(player: Pick<PlayerState, "standing">, faction: string): number {
  return player.standing?.[faction] ?? 0;
}

/**
 * Something the player did to a faction's member (or for them): standing moves by
 * `delta`, and every other faction moves by `delta` × its attitude to this one.
 * Returns the changes, for logs.
 */
export function shiftStanding(player: PlayerState, factionId: string, delta: number, factions = loadFactions()): Record<string, number> {
  const changes: Record<string, number> = {};
  const standing = (player.standing ??= {});
  const apply = (id: string, d: number) => {
    if (Math.round(d) === 0) return;
    standing[id] = clamp((standing[id] ?? 0) + d);
    changes[id] = Math.round(d);
  };
  apply(factionId, delta);
  for (const other of Object.values(factions)) {
    if (other.id === factionId) continue;
    const attitude = other.attitudes[factionId] ?? 0;
    // Members of a faction care less what you did to their rivals' friends than to their own.
    apply(other.id, delta * attitude * 0.6);
  }
  return changes;
}

/** Standing shifts for the player's deeds against (or for) a member. Code-set amounts. */
export const STANDING = { questDone: 8, gift: 1, attacked: -15, killed: -35, subdued: -10, theft: -10, finePaid: 5, creatureKilled: -6, raidDefended: 10, dilemma: 0 } as const;

/** The player did something to `who` (an NPC persona or a creature kind): shift their faction's standing. */
export function standingForDeed(player: PlayerState, who: { persona?: Pick<NpcPersona, "id" | "faction">; creature?: string }, delta: number): Record<string, number> {
  const f = factionOf(who);
  return f ? shiftStanding(player, f.id, delta) : {};
}

/** The rank the player holds with a faction. Member ranks need joining. */
export function rankWith(player: Pick<PlayerState, "standing" | "factions">, faction: Faction): string {
  const s = standingWith(player, faction.id);
  const joined = (player.factions ?? []).includes(faction.id);
  let rank = faction.ranks[0]!.name;
  for (const r of faction.ranks) if (s >= r.minStanding && (!r.member || joined)) rank = r.name;
  return rank;
}

export function isMember(player: Pick<PlayerState, "factions">, factionId: string): boolean {
  return (player.factions ?? []).includes(factionId);
}

/** Percent off this NPC gives the player as a fellow member of their faction. */
export function memberDiscount(persona: Pick<NpcPersona, "id" | "faction">, player: Pick<PlayerState, "factions" | "standing">): number {
  const f = factionOf({ persona });
  return f && isMember(player, f.id) ? f.discount : 0;
}

/** Standing low enough that members are wary: a price markup and a cold line. */
export const WARY_STANDING = -15;

/** Percent markup a member of a faction the player has crossed charges them. */
export function factionMarkup(persona: Pick<NpcPersona, "id" | "faction">, player: Pick<PlayerState, "standing">): number {
  const f = factionOf({ persona });
  if (!f) return 0;
  const s = standingWith(player, f.id);
  return s <= WARY_STANDING ? Math.min(30, Math.round(-s / 2)) : 0;
}

export interface JoinResult {
  ok: boolean;
  message: string;
}

/** Join a faction (/join): needs the standing of its first member rank. Rivals close their doors. */
export function joinFaction(player: PlayerState, factionId: string, factions = loadFactions()): JoinResult {
  const f = factions[factionId];
  if (!f) return { ok: false, message: `No such faction. Factions: ${Object.keys(factions).join(", ")}.` };
  if (!f.joinable) return { ok: false, message: `${f.name} doesn't take outsiders.` };
  if (isMember(player, f.id)) return { ok: false, message: `You're already one of ${f.name}.` };
  const need = f.ranks.find((r) => r.member)?.minStanding ?? 50;
  if (standingWith(player, f.id) < need) return { ok: false, message: `${f.name} won't have you yet (standing ${standingWith(player, f.id)}, need ${need}).` };
  const rival = (player.factions ?? []).find((id) => (f.attitudes[id] ?? 0) <= -0.5 || (factions[id]?.attitudes[f.id] ?? 0) <= -0.5);
  if (rival) return { ok: false, message: `${f.name} won't take one of ${factions[rival]!.name}.` };
  (player.factions ??= []).push(f.id);
  // Joining closes doors with their rivals.
  for (const other of Object.values(factions)) {
    if ((f.attitudes[other.id] ?? 0) <= -0.5) player.standing![other.id] = clamp(standingWith(player, other.id) - 20);
  }
  return { ok: true, message: `You're now ${f.ranks.find((r) => r.member)?.name ?? `one of ${f.name}`}.` };
}

/**
 * The situation line about the player's standing with this NPC's faction, or null
 * when unremarkable: "As one of the village guard, you see them as an enemy of the guard."
 */
export function describeFactionView(persona: Pick<NpcPersona, "id" | "faction">, player: Pick<PlayerState, "standing" | "factions" | "name">): string | null {
  const f = factionOf({ persona });
  if (!f) return null;
  const s = standingWith(player, f.id);
  if (isMember(player, f.id)) return `${player.name} is ${rankWith(player, f)}, one of your own. Treat them as such.`;
  if (s <= WARY_STANDING) return `As one of ${f.name}, you're wary of ${player.name}: to your lot they're ${rankWith(player, f)}.`;
  if (s >= 20) return `As one of ${f.name}, you think well of ${player.name}: ${rankWith(player, f)}.`;
  return null;
}

/** Every faction's standing for the player, for /factions and the browser. */
export function describeStandings(player: PlayerState, factions = loadFactions()): Array<{ id: string; name: string; standing: number; rank: string; member: boolean }> {
  return Object.values(factions).map((f) => ({ id: f.id, name: f.name, standing: standingWith(player, f.id), rank: rankWith(player, f), member: isMember(player, f.id) }));
}
