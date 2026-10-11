/**
 * Typed game events (T13): what happened in a turn, for the game screen to animate.
 * The server works them out from the state before and after each action, so the
 * client never has to read meaning out of the NPC's words.
 *
 * `who` fields are "player", an NPC id, or a creature uid.
 */
export type GameEvent =
  | { type: "mood_changed"; npc: string; from: string; to: string }
  | { type: "trust_changed"; npc: string; from: number; to: number }
  | { type: "item_moved"; item: string; qty: number; from: string; to: string }
  | { type: "gold_moved"; amount: number; from: string; to: string }
  | { type: "hp_changed"; who: string; from: number; to: number }
  | { type: "attack"; by: string; target: string; hit: boolean; damage: number }
  | { type: "quest_offered"; npc: string; title: string }
  | { type: "npc_busy"; npc: string; doing: string }
  | { type: "npc_died"; npc: string; cause: string | null }
  | { type: "following"; npc: string; on: boolean };

export type GameEventType = GameEvent["type"];

/** Where an item or coin went when it left the player or an NPC and didn't land on anyone we track. */
export const WORLD = "world";

/** One line for a text log (the CLI prints these). Names come from `nameOf`. */
export function describeEvent(e: GameEvent, nameOf: (who: string) => string = (w) => w): string {
  const n = (who: string) => (who === "player" ? "you" : who === WORLD ? "the world" : nameOf(who));
  switch (e.type) {
    case "mood_changed":
      return `${n(e.npc)}: ${e.from} → ${e.to}`;
    case "trust_changed":
      return `${n(e.npc)} trust ${e.from} → ${e.to}`;
    case "item_moved":
      return `${e.qty > 1 ? `${e.qty}× ` : ""}${e.item}: ${n(e.from)} → ${n(e.to)}`;
    case "gold_moved":
      return `${e.amount} copper: ${n(e.from)} → ${n(e.to)}`;
    case "hp_changed":
      return `${n(e.who)} HP ${e.from} → ${e.to}`;
    case "attack":
      return `${n(e.by)} attacks ${n(e.target)}: ${e.hit ? `hit for ${e.damage}` : "miss"}`;
    case "quest_offered":
      return `${n(e.npc)} offers a job: ${e.title}`;
    case "npc_busy":
      return `${n(e.npc)} is busy ${e.doing}`;
    case "npc_died":
      return `${n(e.npc)} died${e.cause ? ` (${e.cause})` : ""}`;
    case "following":
      return `${n(e.npc)} ${e.on ? "is now travelling with you" : "stops travelling with you"}`;
  }
}

/** The parts of the game state that events are worked out from. */
export interface EventFrame {
  player: { money: number; hp: number; inventory: Record<string, number> };
  npcs: Record<
    string,
    {
      mood: string;
      trust: number;
      hp: number;
      money: number;
      inventory: Record<string, number>;
      dead: boolean;
      deathCause: string | null;
      companion: boolean;
      pendingQuest: string | null;
      busy: string | null;
    }
  >;
}

/** Item counts that changed between two inventories: positive gained, negative lost. */
function itemChanges(before: Record<string, number>, after: Record<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[item] ?? 0) - (before[item] ?? 0);
    if (d !== 0) out.set(item, d);
  }
  return out;
}

/**
 * What changed between two frames, as events. Items and coin are matched up: when the
 * player lost something an NPC gained, it moved from the player to that NPC; what's left
 * over went to (or came from) the world.
 */
export function diffFrames(before: EventFrame, after: EventFrame): GameEvent[] {
  const events: GameEvent[] = [];
  const ids = Object.keys(after.npcs).filter((id) => before.npcs[id]);

  for (const id of ids) {
    const a = before.npcs[id]!;
    const b = after.npcs[id]!;
    if (!a.dead && b.dead) events.push({ type: "npc_died", npc: id, cause: b.deathCause });
    if (a.mood !== b.mood && !b.dead) events.push({ type: "mood_changed", npc: id, from: a.mood, to: b.mood });
    if (a.trust !== b.trust && !b.dead) events.push({ type: "trust_changed", npc: id, from: a.trust, to: b.trust });
    if (a.hp !== b.hp) events.push({ type: "hp_changed", who: id, from: a.hp, to: b.hp });
    if (a.companion !== b.companion) events.push({ type: "following", npc: id, on: b.companion });
    if (b.pendingQuest && a.pendingQuest !== b.pendingQuest) events.push({ type: "quest_offered", npc: id, title: b.pendingQuest });
    if (b.busy && a.busy !== b.busy) events.push({ type: "npc_busy", npc: id, doing: b.busy });
  }
  if (before.player.hp !== after.player.hp) events.push({ type: "hp_changed", who: "player", from: before.player.hp, to: after.player.hp });

  // Items: pair the player's losses with NPC gains (and the other way round).
  const playerItems = itemChanges(before.player.inventory, after.player.inventory);
  const npcItems = new Map(ids.map((id) => [id, itemChanges(before.npcs[id]!.inventory, after.npcs[id]!.inventory)]));
  for (const [item, d] of playerItems) {
    let left = Math.abs(d);
    for (const [id, changes] of npcItems) {
      const nd = changes.get(item) ?? 0;
      if (left === 0 || Math.sign(nd) !== -Math.sign(d)) continue;
      const qty = Math.min(left, Math.abs(nd));
      events.push(d < 0 ? { type: "item_moved", item, qty, from: "player", to: id } : { type: "item_moved", item, qty, from: id, to: "player" });
      changes.set(item, nd + (d < 0 ? -qty : qty));
      left -= qty;
    }
    if (left > 0) events.push(d < 0 ? { type: "item_moved", item, qty: left, from: "player", to: WORLD } : { type: "item_moved", item, qty: left, from: WORLD, to: "player" });
  }

  // Coin: the same pairing.
  const pd = after.player.money - before.player.money;
  if (pd !== 0) {
    let left = Math.abs(pd);
    for (const id of ids) {
      const nd = after.npcs[id]!.money - before.npcs[id]!.money;
      if (left === 0 || Math.sign(nd) !== -Math.sign(pd)) continue;
      const amount = Math.min(left, Math.abs(nd));
      events.push(pd < 0 ? { type: "gold_moved", amount, from: "player", to: id } : { type: "gold_moved", amount, from: id, to: "player" });
      left -= amount;
    }
    if (left > 0) events.push(pd < 0 ? { type: "gold_moved", amount: left, from: "player", to: WORLD } : { type: "gold_moved", amount: left, from: WORLD, to: "player" });
  }
  return events;
}
