import type { NpcAgent } from "../npc/NpcAgent.js";
import { adjust } from "../npc/relationship.js";
import { traitsOf } from "../npc/traits.js";
import type { TurnResult, WorldSnapshot } from "../npc/types.js";
import type { Rng } from "./dice.js";
import { itemsForSale } from "../npc/actions.js";
import { parseItem } from "./items.js";

/**
 * Group scenes (N6.5): the player talks with several NPCs at one place. The player
 * addresses one (by name, or /to), and code decides whether another joins in: at
 * most one interjection per player turn, chosen by whether the topic touches them,
 * how sociable they are and how they feel about the player, with a cooldown so no
 * one takes over. Each NPC keeps their own history and situation, plus a short
 * "what just happened here" line (sceneLog), so they react to each other.
 */

/** Lines of what others just said, shown to each NPC (design rule 3). */
export const SCENE_LINES = 3;
/** Player turns an NPC waits after chiming in before they can again. */
export const INTERJECT_COOLDOWN_TURNS = 2;
/** Trust a vouch from a trusted NPC in the scene adds, once a day per voucher. */
export const SCENE_VOUCH_TRUST = 3;
/** A voucher needs to trust the player at least this much. */
export const VOUCH_TRUST = 50;

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class Scene {
  readonly log: Array<{ speaker: string; text: string }> = [];
  turn = 0;
  /** Turn each NPC last chimed in, by id. */
  readonly lastInterjection: Record<string, number> = {};

  constructor(readonly place: string) {}

  record(speaker: string, text: string): void {
    if (!text.trim()) return;
    this.log.push({ speaker, text: text.trim() });
    if (this.log.length > 8) this.log.shift();
  }

  /** What others said recently, for one NPC's situation (not their own lines). */
  linesFor(name: string): string[] {
    return this.log
      .filter((l) => l.speaker !== name)
      .slice(-SCENE_LINES)
      .map((l) => `${l.speaker} said: "${clip(l.text)}"`);
  }
}

/** The NPC a line addresses by name ("Odo, what about Mara?" is to Odo): the present NPC named first, if any. */
export function addressedByName(line: string, present: NpcAgent[]): NpcAgent | null {
  const lower = line.toLowerCase();
  let best: { agent: NpcAgent; at: number } | null = null;
  for (const agent of present) {
    for (const w of agent.persona.name.split(/\s+/).filter((w) => w.length > 2 && !/^(old|the|corporal)$/i.test(w))) {
      const at = lower.search(new RegExp(`\\b${w.toLowerCase()}\\b`));
      if (at >= 0 && (!best || at < best.at)) best = { agent, at };
    }
  }
  return best?.agent ?? null;
}

/** How much a line touches an NPC: their name, or goods they sell. 0..1. */
export function topicTouches(agent: NpcAgent, line: string): number {
  const lower = line.toLowerCase();
  const named = agent.persona.name.split(/\s+/).some((w) => w.length > 2 && new RegExp(`\\b${w.toLowerCase()}\\b`).test(lower));
  if (named) return 1;
  const goods = itemsForSale({ persona: agent.persona, state: agent.state }).map((k) => parseItem(k)?.name).filter((n): n is string => !!n);
  return goods.some((g) => lower.includes(g)) ? 0.5 : 0;
}

/** Chance an NPC chimes in: a little for everyone, more for the sociable, the concerned and those with feelings about the player. */
export function interjectChance(agent: NpcAgent, line: string): number {
  const s = agent.state;
  const feeling = Math.abs(s.relationship) >= 30 ? 0.1 : 0;
  return Math.min(0.9, 0.05 + 0.3 * traitsOf(agent.persona, agent.state).sociability + 0.4 * topicTouches(agent, line) + feeling);
}

/**
 * Who (if anyone) chimes in after the addressed NPC answers. Highest chance first,
 * one roll; NPCs in their cooldown, busy, in a fight or out of it are skipped.
 */
export function chooseInterjector(scene: Scene, present: NpcAgent[], addressed: NpcAgent, line: string, world: WorldSnapshot, rng: Rng): NpcAgent | null {
  const candidates = present
    .filter((a) => a !== addressed && !a.isDead && !a.state.inCombat && !a.state.outcome && !a.busyWith(world))
    .filter((a) => scene.turn - (scene.lastInterjection[a.persona.id] ?? -Infinity) > INTERJECT_COOLDOWN_TURNS)
    .map((a) => ({ a, chance: interjectChance(a, line) }))
    .sort((x, y) => y.chance - x.chance);
  const best = candidates[0];
  if (!best || rng() >= best.chance) return null;
  return best.a;
}

export interface SceneTurn {
  addressed: { id: string; result: TurnResult };
  interjection: { id: string; result: TurnResult } | null;
  /** A trusted NPC's word raised the addressed NPC's trust. */
  vouched: string | null;
}

/** The world as one NPC in the scene sees it: who else is here, and what was just said. */
export function sceneWorld(world: WorldSnapshot, scene: Scene, present: NpcAgent[], self: NpcAgent): WorldSnapshot {
  world.present = present.filter((a) => a !== self).map((a) => a.persona.id);
  world.sceneLog = scene.linesFor(self.persona.name);
  return world;
}

/**
 * One player turn in a scene: the addressed NPC always answers; then at most one
 * other may chime in. `onText` gets each speaker's id with their text.
 */
export async function sceneTurn(
  scene: Scene,
  present: NpcAgent[],
  addressed: NpcAgent,
  line: string,
  world: WorldSnapshot,
  rng: Rng,
  onText: (id: string, delta: string) => void = () => {},
): Promise<SceneTurn> {
  scene.turn += 1;
  scene.record(world.player.name, line);
  sceneWorld(world, scene, present, addressed);
  const result = await addressed.respond(line, world, (d) => onText(addressed.persona.id, d));
  scene.record(addressed.persona.name, result.text);

  let interjection: SceneTurn["interjection"] = null;
  let vouched: string | null = null;
  const other = result.busy ? null : chooseInterjector(scene, present, addressed, line, world, rng);
  if (other) {
    scene.lastInterjection[other.persona.id] = scene.turn;
    sceneWorld(world, scene, present, other);
    const r = await other.interject(world, (d) => onText(other.persona.id, d));
    scene.record(other.persona.name, r.text);
    interjection = { id: other.persona.id, result: r };
    // A trusted NPC speaking up for the player lifts the other's trust a little, once a day.
    if (other.state.relationship >= VOUCH_TRUST && addressed.state.vouchedDay[other.persona.id] !== world.day) {
      addressed.state.vouchedDay[other.persona.id] = world.day;
      adjust(addressed.state, "trust", SCENE_VOUCH_TRUST);
      vouched = other.persona.name;
    }
  }
  world.present = present.filter((a) => a !== addressed).map((a) => a.persona.id);
  world.sceneLog = [];
  return { addressed: { id: addressed.persona.id, result }, interjection, vouched };
}
