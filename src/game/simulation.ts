import { npcPrice } from "../npc/actions.js";
import { grudgeFadePerDay, traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { absoluteMinute, advanceMinutes, formatMinute } from "./clock.js";
import { finishCraft, hasInputs, startCraft, tradeRecipes } from "./crafting.js";
import { payDebts } from "./debts.js";
import type { Rng } from "./dice.js";
import { isSleepingHour, npcSelfHeal, regenNpc } from "./healing.js";
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
  if (!job || absoluteMinute(world) >= job.until) return null;
  return `${job.doing} until ${formatMinute(job.until, world.day)}`;
}

/**
 * Let `hours` pass. Returns a log of what the NPC did, for the player.
 * The NPC's quests are refreshed afterwards, since their needs may have changed.
 */
export function passTime(persona: NpcPersona, state: NpcState, world: WorldSnapshot, hours: number, rng: Rng): string[] {
  const log = passMinutes(persona, state, world, hours * 60, rng);
  if (state.outcome !== "dead") refreshNeedQuests(persona, state, world.player);
  return log;
}

/**
 * Let `minutes` pass, stopping at every full hour (healing, work, village sales)
 * and at the minute a crafting job ends, so it finishes exactly on time.
 * `talking`: the player is with the NPC, so they don't start new work or sell
 * to villagers, but they still heal and finish what they were doing.
 */
export function passMinutes(
  persona: NpcPersona,
  state: NpcState,
  world: WorldSnapshot,
  minutes: number,
  rng: Rng,
  { talking = false }: { talking?: boolean } = {},
): string[] {
  const log: string[] = [];
  if (minutes <= 0) return log;
  if (state.outcome === "dead") {
    advanceMinutes(world, minutes);
    return log;
  }
  let left = minutes;
  while (left > 0) {
    const now = absoluteMinute(world);
    const toHour = 60 - (world.minute ?? 0);
    const toJob = state.job && state.job.until > now ? state.job.until - now : Infinity;
    const step = Math.min(left, toHour, toJob);
    advanceMinutes(world, step);
    left -= step;

    const done = finishCraft(state, absoluteMinute(world));
    if (done) log.push(`${persona.name} finished ${done.doing.replace(/^\w+ing /, "")}: ${done.qty} ${itemLabel(done.output)}.`);
    if ((world.minute ?? 0) === 0) log.push(...hourTick(persona, state, world, rng, talking));
  }
  return log;
}

/** What happens to the NPC on the hour. */
function hourTick(persona: NpcPersona, state: NpcState, world: WorldSnapshot, rng: Rng, talking: boolean): string[] {
  const log: string[] = [];
  regenNpc(persona, state, isSleepingHour(world.hour));
  const used = state.inCombat ? null : npcSelfHeal(persona, state);
  if (used?.ok) log.push(`${persona.name} treated their wounds. ${used.message}`);
  // Grudges fade a little each night: forgiving NPCs get over a bad start faster.
  if (world.hour === 0 && state.relationship < 0) {
    state.relationship = Math.min(0, state.relationship + grudgeFadePerDay(traitsOf(persona)));
  }

  if (talking || state.job) return log; // with the player, or still busy
  const working = world.hour >= WORK_START && world.hour < WORK_END;
  if (!working) return log;

  const now = absoluteMinute(world);
  const options = tradeRecipes(persona).filter((r) => hasInputs(state.inventory, r));
  if (options.length > 0 && rng() < CRAFT_CHANCE) {
    const recipe = options[Math.floor(rng() * options.length)]!;
    const job = startCraft(persona, state, recipe, now, rng);
    log.push(`${persona.name} started ${job.doing} (until ${formatMinute(job.until, world.day)}).`);
    return log;
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
  return log;
}
