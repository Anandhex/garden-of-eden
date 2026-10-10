import { npcPrice } from "../npc/actions.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { absoluteHour, advanceTime, formatHour } from "./clock.js";
import { finishCraft, hasInputs, startCraft, tradeRecipes } from "./crafting.js";
import { payDebts } from "./debts.js";
import type { Rng } from "./dice.js";
import { itemLabel } from "./items.js";
import { refreshNeedQuests } from "./quests.js";

/**
 * Time passing for an NPC. Each hour, an idle NPC in working hours may start
 * making something they have the materials for (and is busy until it's done),
 * or sell a piece of stock to villagers. Everything is rolled in code.
 */
export const WORK_START = 6;
export const WORK_END = 20;
/** Chance per idle working hour of starting to craft (if they can). */
export const CRAFT_CHANCE = 0.5;
/** Chance per idle working hour of selling one item to villagers. */
export const VILLAGE_SALE_CHANCE = 0.25;

/** What the NPC is busy with right now, or null if free to talk. */
export function busyWith(state: NpcState, world: WorldSnapshot): string | null {
  const job = state.job;
  if (!job || absoluteHour(world) >= job.until) return null;
  return `${job.doing} until ${formatHour(job.until, world.day)}`;
}

/**
 * Let `hours` pass, hour by hour. Returns a log of what the NPC did, for the player.
 * The NPC's quests are refreshed afterwards, since their needs may have changed.
 */
export function passTime(persona: NpcPersona, state: NpcState, world: WorldSnapshot, hours: number, rng: Rng): string[] {
  const log: string[] = [];
  if (state.outcome === "dead") {
    advanceTime(world, hours);
    return log;
  }
  for (let h = 0; h < hours; h++) {
    advanceTime(world, 1);
    const now = absoluteHour(world);

    const done = finishCraft(state, now);
    if (done) log.push(`${persona.name} finished ${done.doing.replace(/^\w+ing /, "")}: ${done.qty} ${itemLabel(done.output)}.`);
    if (state.job) continue; // still busy

    const working = world.hour >= WORK_START && world.hour < WORK_END;
    if (!working) continue;

    const options = tradeRecipes(persona).filter((r) => hasInputs(state.inventory, r));
    if (options.length > 0 && rng() < CRAFT_CHANCE) {
      const recipe = options[Math.floor(rng() * options.length)]!;
      const job = startCraft(persona, state, recipe, now, rng);
      log.push(`${persona.name} started ${job.doing} (until ${formatHour(job.until, world.day)}).`);
      continue;
    }

    if (rng() < VILLAGE_SALE_CHANCE) {
      const stock = Object.keys(state.inventory).filter((k) => (state.inventory[k] ?? 0) > 0 && npcPrice(persona, k) !== undefined);
      if (stock.length > 0) {
        const item = stock[Math.floor(rng() * stock.length)]!;
        const price = npcPrice(persona, item)!;
        state.inventory[item] = (state.inventory[item] ?? 0) - 1;
        if (state.inventory[item] === 0) delete state.inventory[item];
        state.gold += price;
        payDebts(persona, state);
        log.push(`${persona.name} sold a ${itemLabel(item)} to a villager.`);
      }
    }
  }
  refreshNeedQuests(persona, state, world.player);
  return log;
}
