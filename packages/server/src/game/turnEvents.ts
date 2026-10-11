/**
 * Typed events for the game screen (T13): a frame of the state before an action, a
 * frame after, and the difference as events (shared/events.ts). Working them out from
 * state means every path that changes the game reports the same way, model or not.
 */
import { diffFrames, type EventFrame, type GameEvent } from "@millbrook/shared";
import type { NpcAgent } from "../npc/NpcAgent.js";
import type { AppliedAction, WorldSnapshot } from "../npc/types.js";
import type { PlayerState } from "../npc/types.js";

/** The parts of the state that events are worked out from, copied. */
export function captureFrame(world: WorldSnapshot & { player: PlayerState }, agents: Record<string, NpcAgent>): EventFrame {
  const npcs: EventFrame["npcs"] = {};
  for (const [id, a] of Object.entries(agents)) {
    const s = a.state;
    npcs[id] = {
      mood: s.mood,
      trust: s.relationship,
      hp: s.hp,
      money: s.money,
      inventory: { ...s.inventory },
      dead: a.isDead,
      deathCause: s.deathCause ?? null,
      companion: Boolean(s.companion),
      pendingQuest: s.pendingQuest ? (a.persona.quests?.find((q) => q.id === s.pendingQuest)?.title ?? s.questBoard.find((q) => q.id === s.pendingQuest)?.title ?? s.pendingQuest) : null,
      busy: a.isDead ? null : a.busyWith(world),
    };
  }
  return { player: { money: world.player.money, hp: world.player.hp, inventory: { ...world.player.inventory } }, npcs };
}

/** Actions that are the player striking an NPC. */
const PLAYER_STRIKES = new Set(["attack", "subdue", "ability"]);

/**
 * Events for one action: the state difference, plus who attacked whom (from the NPC's
 * tool calls and the player's action). Attacks come first, so the screen shows the
 * swing before the HP bar drops.
 */
export function turnEvents(before: EventFrame, after: EventFrame, opts: { npc?: string; playerAction?: string; actions?: AppliedAction[] } = {}): GameEvent[] {
  const changes = diffFrames(before, after);
  const attacks: GameEvent[] = [];
  const { npc } = opts;
  if (npc && before.npcs[npc] && after.npcs[npc]) {
    const npcLost = before.npcs[npc]!.hp - after.npcs[npc]!.hp;
    const playerLost = before.player.hp - after.player.hp;
    if (opts.playerAction && PLAYER_STRIKES.has(opts.playerAction)) attacks.push({ type: "attack", by: "player", target: npc, hit: npcLost > 0, damage: Math.max(0, npcLost) });
    for (const a of opts.actions ?? []) {
      if (a.name === "attack_player" && a.ok) attacks.push({ type: "attack", by: npc, target: "player", hit: playerLost > 0, damage: Math.max(0, playerLost) });
    }
  }
  return [...attacks, ...changes];
}
