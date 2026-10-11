import { absoluteMinute } from "../game/clock.js";
import { armorValue, equippedWeapon } from "../game/gear.js";
import { ITEM_TIERS, itemLabel, parseItem } from "../game/items.js";
import { EXHAUSTED, HUNGRY, STARVING, TIRED } from "../game/needs.js";
import { currentPlan } from "../game/schedule.js";
import { skillLevel } from "./skills.js";
import { statsOf } from "./state.js";
import { fearsInSight, lovedItem } from "./triggers.js";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "./types.js";

/**
 * Appearances (N4.4). Each NPC file has a fixed description (build, age, clothes);
 * code adds what's visible now: wounds (from HP), soot (a smith at work), weapons
 * and armour, drink, tiredness, hunger. The player's look is built the same way from
 * their gear and condition. /look shows either, with no model call. NPCs notice the
 * most striking thing about the player, once an encounter (design rule 3).
 */

/** Minutes a weapon stays bloody after the player draws blood with it. */
export const BLOODY_MINUTES = 120;
/** At or above this much money (copper) the player looks well off. */
export const RICH = 2000;
/** Below this much money, and no armour, the player looks ragged. */
export const RAGGED = 50;

function woundWords(hp: number, maxHp: number): string | null {
  const share = hp / maxHp;
  if (hp <= 0) return "out cold";
  if (share < 0.25) return "badly wounded, bandages soaked through";
  if (share < 0.6) return "nursing fresh wounds";
  if (share < 0.9) return "a little battered";
  return null;
}

/** What's visible about an NPC right now, besides their fixed look. */
export function visibleState(persona: NpcPersona, state: NpcState, world: WorldSnapshot): string[] {
  const parts: string[] = [];
  if (state.outcome === "dead") return ["dead"];
  const plan = currentPlan(persona, state, world);
  const wound = woundWords(state.hp, statsOf(persona, state).maxHp);
  if (wound) parts.push(wound);
  if (plan.activity === "sleep") parts.push("asleep");
  else if (plan.activity === "work" && skillLevel(persona.skills, "smithing") > 0 && plan.place === "forge") parts.push("covered in soot from the forge");
  else if (state.job) parts.push(`busy ${state.job.doing}`);
  const weapon = state.equipment.weapon;
  if (weapon) parts.push(`carrying ${itemLabel(weapon)}`);
  if (state.equipment.armor) parts.push(`wearing ${itemLabel(state.equipment.armor)}`);
  if (state.tipsyUntil !== null && absoluteMinute(world) < state.tipsyUntil) parts.push("a little drunk");
  if (state.needs.energy <= EXHAUSTED) parts.push("dead on their feet");
  else if (state.needs.energy <= TIRED) parts.push("tired, with dark rings under the eyes");
  if (state.needs.hunger >= STARVING) parts.push("pale and half-starved");
  else if (state.needs.hunger >= HUNGRY) parts.push("hungry-looking");
  return parts;
}

/** /look at an NPC: their fixed look plus what's visible now. */
export function describeNpcAppearance(persona: NpcPersona, state: NpcState, world: WorldSnapshot): string {
  const base = persona.appearance ?? `${persona.name}, ${persona.role}.`;
  const now = visibleState(persona, state, world);
  return now.length > 0 ? `${base} Right now: ${now.join(", ")}.` : base;
}

/** Is the player's weapon bloody (they drew blood with it in the last BLOODY_MINUTES)? */
export function isBloodied(player: PlayerState, world: Pick<WorldSnapshot, "day" | "hour" | "minute">): boolean {
  return player.bloodiedAt !== undefined && absoluteMinute(world) - player.bloodiedAt <= BLOODY_MINUTES;
}

/** The player drew blood: their weapon shows it for a while. */
export function markBloodied(player: PlayerState, world: Pick<WorldSnapshot, "day" | "hour" | "minute">): void {
  player.bloodiedAt = absoluteMinute(world);
}

/** Notable things about the player, most striking first, each with a key (so it's remarked on once). */
export function playerFeatures(player: PlayerState, world: WorldSnapshot): Array<{ key: string; text: string; rank: number }> {
  const out: Array<{ key: string; text: string; rank: number }> = [];
  const weapon = player.equipment?.weapon;
  const weaponName = weapon ? itemLabel(weapon) : null;
  if (weaponName && isBloodied(player, world)) out.push({ key: "bloody", text: `their ${weaponName} is bloody, fresh from a fight`, rank: 5 });
  const wound = woundWords(player.hp, player.maxHp);
  if (wound && player.hp / player.maxHp < 0.6) out.push({ key: "wounded", text: `they're ${wound}`, rank: 4 });
  if (weapon) {
    const tier = parseItem(weapon)?.tier;
    if (tier && ITEM_TIERS.indexOf(tier) >= ITEM_TIERS.indexOf("C")) out.push({ key: `fine:${weapon}`, text: `they carry a fine ${weaponName}`, rank: 2 });
  }
  if (player.money >= RICH) out.push({ key: "rich", text: "they're dressed like someone with money", rank: 1 });
  else if (player.money < RAGGED && armorValue(player) === 0) out.push({ key: "ragged", text: "they look ragged and down on their luck", rank: 1 });
  return out;
}

/** /look at yourself. */
export function describePlayerAppearance(player: PlayerState, world: WorldSnapshot): string {
  const weapon = equippedWeapon(player);
  const parts = [
    player.equipment?.weapon ? `armed with ${itemLabel(player.equipment.weapon)}${isBloodied(player, world) ? " (bloody)" : ""}` : `unarmed (${weapon.name})`,
    player.equipment?.armor ? `wearing ${itemLabel(player.equipment.armor)}` : "no armour",
    woundWords(player.hp, player.maxHp) ?? "unhurt",
  ];
  const money = player.money >= RICH ? "well dressed" : player.money < RAGGED && armorValue(player) === 0 ? "ragged" : "plainly dressed";
  return `${player.name}: ${parts.join(", ")}; ${money}.`;
}

/**
 * The one thing about the player this NPC remarks on this turn, or null. Things they
 * love or fear count most (a loved blade, a feared weapon), then blood, wounds, fine
 * gear, wealth. Each is remarked on once an encounter (state.noticed; startEncounter clears it).
 */
export function noticeLine(persona: NpcPersona, state: NpcState, world: WorldSnapshot): string | null {
  const player = world.player;
  const features = playerFeatures(player, world);
  const weapon = player.equipment?.weapon;
  if (weapon && lovedItem(persona, weapon)) features.push({ key: `loved:${weapon}`, text: `they carry ${itemLabel(weapon)}, just the kind you admire`, rank: 6 });
  if (weapon && fearsInSight(persona, world).some((f) => f.item !== undefined && parseItem(weapon)?.name === f.item)) {
    features.push({ key: `feared:${weapon}`, text: `they carry ${itemLabel(weapon)}, and it frightens you`, rank: 7 });
  }
  const top = features.sort((a, b) => b.rank - a.rank)[0];
  if (!top || state.noticed === top.key) return null;
  state.noticed = top.key;
  return `You notice: ${top.text}.`;
}
