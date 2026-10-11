import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { recordEvent, type GameEvent } from "./events.js";
import { playerHasRoom } from "./gear.js";
import { itemLabel, resolveItem } from "./items.js";
import { formatMoney } from "./money.js";
import { townLearns } from "./reputation.js";
import { standingForDeed, STANDING } from "./factions.js";

/**
 * Loot (N8): a dead or knocked-out NPC's pack and purse can be taken (/loot). It's a
 * crime against anyone but a bandit, and others who see it remember (game/crime.ts
 * hears of it through them). What doesn't fit stays. Done in code.
 */
export interface LootResult {
  ok: boolean;
  message: string;
  taken: string[];
  event?: GameEvent;
}

export function lootBody(persona: NpcPersona, state: NpcState, world: WorldSnapshot, witnesses: string[], item?: string): LootResult {
  if (state.outcome !== "dead" && state.outcome !== "unconscious") return { ok: false, taken: [], message: `${persona.name} would notice. (/steal, if you dare.)` };
  const player = world.player;
  const keys = item ? [resolveItem(state.inventory, item)].filter((k): k is string => !!k && (state.inventory[k] ?? 0) > 0) : Object.keys(state.inventory).filter((k) => (state.inventory[k] ?? 0) > 0);
  if (item && keys.length === 0) return { ok: false, taken: [], message: `${persona.name} has no ${item}.` };
  const taken: string[] = [];
  const left: string[] = [];
  for (const key of keys) {
    const qty = item ? 1 : (state.inventory[key] ?? 0);
    if (!playerHasRoom(player, { [key]: qty })) {
      left.push(itemLabel(key));
      continue;
    }
    state.inventory[key] = (state.inventory[key] ?? 0) - qty;
    if (state.inventory[key] === 0) delete state.inventory[key];
    player.inventory[key] = (player.inventory[key] ?? 0) + qty;
    taken.push(`${itemLabel(key)} x${qty}`);
  }
  if (!item && state.money > 0) {
    taken.push(formatMoney(state.money));
    player.money += state.money;
    state.money = 0;
  }
  if (taken.length === 0) return { ok: false, taken, message: left.length > 0 ? `No room in your pack for: ${left.join(", ")}.` : `${persona.name} has nothing worth taking.` };
  const event = recordEvent(world, { kind: "looted", actor: "player", target: persona.id, details: taken.join(", "), importance: 7, witnesses: witnesses.filter((w) => w !== persona.id) });
  for (const _ of event.witnesses ?? []) townLearns(player, event);
  standingForDeed(player, { persona }, STANDING.theft);
  return {
    ok: true,
    taken,
    event,
    message: `You take from ${persona.name}${state.outcome === "dead" ? "'s body" : ", out cold"}: ${taken.join(", ")}.${left.length > 0 ? ` No room for: ${left.join(", ")}.` : ""}`,
  };
}
