import type { MountView } from "@millbrook/shared";
import type { PlayerState } from "../../npc/types.js";
import { itemKey } from "../items.js";
import { formatMoney } from "../money.js";
import type { Rng } from "../dice.js";
import type { Mount, MountKind } from "./state.js";

/**
 * Horses and carts (N26 D2). A horse covers twice the ground in the same time; a cart is slower than a horse but carries
 * more (it adds pack slots); a river boat is not made yet. They cost coin where they are sold, eat on the road, tire, can
 * go lame, and are stolen from a camp with nobody on watch. A mount that is not fed or rested is slower and then useless.
 */
export const MOUNT_PRICE: Record<MountKind, number> = { horse: 600, cart: 380 };
/** Steps one tile costs by kind (walking is 1): a horse is twice as fast. */
export const MOUNT_STEP: Record<MountKind, number> = { horse: 0.5, cart: 0.77 };
/** Extra pack slots a cart gives. */
export const CART_SLOTS = 12;
/** What it costs to see to a lame horse. */
export const FARRIER = 90;
/** Feed that horses take, and how much each gives. */
export const FEED: Record<string, number> = { turnips: 25, "bread loaf": 18, "wild herbs": 8 };

const NAMES = ["Biscuit", "Copper", "Dapple", "Ember", "Flint", "Gorse", "Hazel", "Juniper", "Mabel", "Nutmeg", "Pepper", "Sorrel"];

export function buyMount(player: PlayerState, kind: MountKind, at: string, rng: Rng): { ok: boolean; message: string } {
  if (player.mount) return { ok: false, message: `You already have ${player.mount.name}.` };
  const price = MOUNT_PRICE[kind];
  if (player.money < price) return { ok: false, message: `A ${kind} costs ${formatMoney(price)}; you have ${formatMoney(player.money)}.` };
  player.money -= price;
  const name = NAMES[Math.floor(rng() * NAMES.length)]!;
  player.mount = { kind, name, fitness: 100, fed: 100, stabled: null };
  void at;
  return { ok: true, message: `You buy a ${kind} for ${formatMoney(price)} and name it ${name}.` };
}

export function sellMount(player: PlayerState): { ok: boolean; message: string } {
  const m = player.mount;
  if (!m) return { ok: false, message: "You have no mount." };
  const price = Math.round(MOUNT_PRICE[m.kind] * 0.5 * (m.fitness / 100) * (m.lame ? 0.4 : 1));
  player.money += price;
  delete player.mount;
  return { ok: true, message: `You sell ${m.name} for ${formatMoney(price)}.` };
}

/** Steps a tile costs on the player's mount: tired and hungry ones are slower; a lame one is led. */
export function mountStep(m: Mount | undefined): number {
  if (!m || m.lame) return 1;
  const slow = m.fitness < 25 || m.fed < 15 ? 1.6 : m.fitness < 50 || m.fed < 35 ? 1.2 : 1;
  return MOUNT_STEP[m.kind] * slow;
}

/** The hours pass: the mount tires and eats. Returns a line when something changes. */
export function tickMount(player: PlayerState, hours: number, o: { riding: boolean; rng: Rng }): string[] {
  const m = player.mount;
  if (!m) return [];
  const lines: string[] = [];
  m.fed = Math.max(0, m.fed - 4 * hours);
  m.fitness = Math.max(0, Math.min(100, m.fitness + (o.riding ? -2.5 : 8) * hours));
  if (m.fed <= 0) m.fitness = Math.max(0, m.fitness - 3 * hours);
  // Pushed too hard or starved, it goes lame.
  if (o.riding && !m.lame && (m.fitness < 30 || m.fed < 10) && o.rng() < 0.05 * hours) {
    m.lame = true;
    lines.push(`${m.name} goes lame. You'll have to lead it until a farrier sees to it.`);
  } else if (o.riding && m.fed < 20 && hours >= 1 && m.fed + 4 * hours >= 20) lines.push(`${m.name} is hungry.`);
  return lines;
}

export function feedMount(player: PlayerState, item: string): { ok: boolean; message: string } {
  const m = player.mount;
  if (!m) return { ok: false, message: "You have no mount." };
  const have = Object.keys(player.inventory).find((k) => (player.inventory[k] ?? 0) > 0 && (k === itemKey(item) || k.startsWith(`${item} [`)));
  const gives = FEED[item];
  if (!have || !gives) return { ok: false, message: have ? `${m.name} won't eat ${item}.` : `You have no ${item}.` };
  const left = (player.inventory[have] ?? 1) - 1;
  if (left <= 0) delete player.inventory[have];
  else player.inventory[have] = left;
  m.fed = Math.min(100, m.fed + gives);
  return { ok: true, message: `${m.name} eats the ${item}.` };
}

export function treatMount(player: PlayerState): { ok: boolean; message: string } {
  const m = player.mount;
  if (!m?.lame) return { ok: false, message: m ? `${m.name} is sound.` : "You have no mount." };
  if (player.money < FARRIER) return { ok: false, message: `The farrier asks ${formatMoney(FARRIER)}.` };
  player.money -= FARRIER;
  delete m.lame;
  m.fitness = Math.max(m.fitness, 60);
  return { ok: true, message: `The farrier sees to ${m.name}'s hoof (${formatMoney(FARRIER)}). It's sound.` };
}

export function mountView(m: Mount | undefined): MountView | null {
  if (!m) return null;
  return { kind: m.kind, name: m.name, fitness: Math.round(m.fitness), fed: Math.round(m.fed), lame: m.lame === true, speed: Math.round((1 / mountStep(m)) * 100) / 100 };
}
