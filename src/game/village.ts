import { npcPrice } from "../npc/actions.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { absoluteMinute, advanceMinutes } from "./clock.js";
import { payDebts } from "./debts.js";
import type { Rng } from "./dice.js";
import { gossipTogether, type Gossiper } from "./gossip.js";
import { itemLabel, parseItem } from "./items.js";
import { formatMoney } from "./money.js";
import { refreshNeedQuests } from "./quests.js";
import { currentPlan, PLACE_NAMES, type PlaceId } from "./schedule.js";
import { passMinutes } from "./simulation.js";

/**
 * The whole village living together (N6), an hour at a time. Each NPC's own hour
 * runs first (needs, work, healing: game/simulation.ts); then what happens between
 * them: suppers bought at the inn (the first trade between NPCs), a drink for the
 * sociable, and gossip among those who share a place (game/gossip.ts).
 */
export interface VillageMember {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** What a supper is, in order of preference, from whoever keeps the place. */
const MEALS = ["stew", "bread loaf"];
/** Sociable NPCs (sociability at least this) have an ale with their evening. */
export const DRINKER_SOCIABILITY = 0.6;
/** Minutes an evening ale leaves them tipsy. */
export const TIPSY_MINUTES = 120;

const awakeAt = (m: VillageMember, world: WorldSnapshot) => {
  if (m.state.outcome === "dead") return null;
  const plan = currentPlan(m.persona, m.state, world);
  return plan.activity === "sleep" || plan.place === "home" ? null : plan;
};

/** Who keeps a place: someone working or at their ease there who sells food. */
function hostAt(members: VillageMember[], place: PlaceId, world: WorldSnapshot, except: VillageMember): VillageMember | undefined {
  return members.find((m) => {
    if (m === except) return false;
    const plan = awakeAt(m, world);
    return plan?.place === place && (plan.activity === "work" || plan.activity === "socialise") && MEALS.some((f) => m.persona.prices[f] !== undefined);
  });
}

/** Buy one of `names` (the first in stock) from the host. Returns the item key, or null. */
function buyFrom(buyer: VillageMember, host: VillageMember, names: string[], world: WorldSnapshot): { item: string; price: number } | null {
  for (const name of names) {
    const key = Object.keys(host.state.inventory).find((k) => parseItem(k)?.name === name && (host.state.inventory[k] ?? 0) > 0);
    if (!key) continue;
    const price = npcPrice(host.persona, key, world) ?? 0;
    if (price <= 0 || buyer.state.money < price) return null;
    buyer.state.money -= price;
    host.state.money += price;
    host.state.inventory[key] = (host.state.inventory[key] ?? 0) - 1;
    if (host.state.inventory[key] === 0) delete host.state.inventory[key];
    payDebts(host.persona, host.state);
    return { item: key, price };
  }
  return null;
}

/** What happens between NPCs at the start of an hour. Returns log lines. */
export function villageHour(members: VillageMember[], world: WorldSnapshot, rng: Rng): string[] {
  const log: string[] = [];
  const now = absoluteMinute(world);
  for (const m of members) {
    const plan = awakeAt(m, world);
    if (!plan) continue;
    // Supper out: pay whoever keeps the place (Brena pays Pell at the inn).
    if (plan.activity === "eat" && plan.place !== "home") {
      const host = hostAt(members, plan.place, world, m);
      const bought = host ? buyFrom(m, host, MEALS, world) : null;
      if (bought && host) log.push(`${m.persona.name} had ${parseItem(bought.item)?.name ?? itemLabel(bought.item)} at ${PLACE_NAMES[plan.place]} and paid ${host.persona.name} ${formatMoney(bought.price)}.`);
    }
    // An evening ale for the sociable.
    if ((plan.activity === "eat" || plan.activity === "socialise") && plan.place !== "home" && traitsOf(m.persona).sociability >= DRINKER_SOCIABILITY && world.hour >= 18) {
      const host = hostAt(members, plan.place, world, m);
      const bought = host ? buyFrom(m, host, ["ale"], world) : null;
      if (bought) m.state.tipsyUntil = now + TIPSY_MINUTES;
    }
  }
  // Gossip among those who share a place.
  const byPlace = new Map<PlaceId, Gossiper[]>();
  for (const m of members) {
    const plan = awakeAt(m, world);
    if (plan) byPlace.set(plan.place, [...(byPlace.get(plan.place) ?? []), m]);
  }
  for (const group of byPlace.values()) if (group.length > 1) log.push(...gossipTogether(group, world.day, rng));
  return log;
}

/**
 * Let `hours` pass for everyone, an hour at a time, then move the world clock.
 * `talkingTo`: an NPC who's with the player (they heal and finish work, but don't start any).
 */
export function passVillage(
  members: VillageMember[],
  world: WorldSnapshot,
  hours: number,
  rng: Rng,
  { talkingTo }: { talkingTo?: string } = {},
): string[] {
  const log: string[] = [];
  world.events ??= [];
  const clocks = members.map(() => ({ ...world }));
  for (let h = 0; h < hours; h++) {
    members.forEach((m, i) => log.push(...passMinutes(m.persona, m.state, clocks[i]!, 60, rng, { talking: m.id === talkingTo })));
    const at: WorldSnapshot = { ...world, day: clocks[0]?.day ?? world.day, hour: clocks[0]?.hour ?? world.hour, minute: clocks[0]?.minute ?? world.minute, timeOfDay: clocks[0]?.timeOfDay ?? world.timeOfDay };
    log.push(...villageHour(members, at, rng));
  }
  advanceMinutes(world, hours * 60);
  for (const m of members) if (m.state.outcome !== "dead") refreshNeedQuests(m.persona, m.state, world.player);
  return log;
}

/** The members at a place now (awake and there), for scenes and the CLI. */
export function membersAt(members: VillageMember[], place: PlaceId, world: WorldSnapshot): VillageMember[] {
  return members.filter((m) => awakeAt(m, world)?.place === place);
}
