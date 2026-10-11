import type { Attribute, Attributes } from "../npc/stats.js";
import type { Skill, Skills } from "../npc/skills.js";
import { skillLevel } from "../npc/skills.js";
import type { QuestDef } from "../npc/types.js";
import type { Rng } from "./dice.js";
import { isCold } from "./weather.js";

/**
 * Lasting injuries and illness (N8.1): harm that lasts days and changes what someone
 * can do. A burned hand costs a smith two tiers of smithing until it heals; a broken
 * arm costs strength and weapon skill. They heal a day at a time with rest, faster
 * with care (a healer, a salve, the herbs someone asked for). Illness is caught (more
 * in winter), saps energy and work, and spreads to those who share a place. Both
 * show as visible state (npc/appearance.ts) and situation lines, and a sufferer may
 * post a quest for the cure. All in code.
 */
export interface InjuryDef {
  name: string;
  /** How it looks to others: "a bandaged, burned hand". */
  visible: string;
  skills?: Partial<Record<Skill, number>>;
  attributes?: Partial<Attributes>;
  /** Days to heal on rest alone. */
  days: number;
  /** What heals it faster, as an item name; a quest for it is posted while they suffer. */
  remedy: { item: string; qty: number };
}

export const INJURIES = {
  burned_hand: { name: "a burned hand", visible: "a bandaged, burned hand", skills: { smithing: -2, alchemy: -1 }, days: 14, remedy: { item: "wild herbs", qty: 3 } },
  broken_arm: { name: "a broken arm", visible: "an arm in a sling", skills: { one_handed: -2, two_handed: -3, blunt: -2, smithing: -2 }, attributes: { strength: -2 }, days: 10, remedy: { item: "healing salve", qty: 1 } },
  deep_cut: { name: "a deep cut", visible: "a blood-soaked bandage", attributes: { agility: -1, endurance: -1 }, days: 4, remedy: { item: "healing salve", qty: 1 } },
  sprained_ankle: { name: "a sprained ankle", visible: "a limp", skills: { evasion: -1 }, attributes: { agility: -2 }, days: 3, remedy: { item: "wild herbs", qty: 2 } },
  bruised_ribs: { name: "bruised ribs", visible: "a wince with every breath", attributes: { endurance: -1, strength: -1 }, days: 3, remedy: { item: "wild herbs", qty: 2 } },
} as const satisfies Record<string, InjuryDef>;
export type InjuryId = keyof typeof INJURIES;
export const INJURY_IDS = Object.keys(INJURIES) as InjuryId[];

export interface IllnessDef {
  name: string;
  visible: string;
  attributes?: Partial<Attributes>;
  /** Extra energy lost each waking hour. */
  energyDrain: number;
  /** Share of work hours they can still work. */
  work: number;
  /** Chance an hour of catching it from someone at the same place. */
  spread: number;
  days: number;
  remedy: { item: string; qty: number };
}

export const ILLNESSES = {
  fever: { name: "a fever", visible: "a flushed, sweating face", attributes: { endurance: -2, strength: -1 }, energyDrain: 2, work: 0.5, spread: 0.08, days: 4, remedy: { item: "healing salve", qty: 1 } },
  winter_cough: { name: "a winter cough", visible: "a hacking cough", attributes: { endurance: -1, charisma: -1 }, energyDrain: 1, work: 0.75, spread: 0.12, days: 5, remedy: { item: "wild herbs", qty: 2 } },
} as const satisfies Record<string, IllnessDef>;
export type IllnessId = keyof typeof ILLNESSES;

export interface Injury {
  id: InjuryId;
  day: number;
  daysLeft: number;
  /** Someone tended it: heals twice as fast. */
  cared?: boolean;
}

export interface Illness {
  id: IllnessId;
  day: number;
  daysLeft: number;
  cared?: boolean;
}

export interface Sufferer {
  injuries?: Injury[];
  illness?: Illness | null;
}

/** Daily chance of falling ill: higher in the cold. */
export const ILLNESS_CHANCE = { warm: 0.01, cold: 0.04 } as const;
/** Chance a blow that takes a quarter of max HP (or drops someone below a quarter) leaves an injury. */
export const FIGHT_INJURY_CHANCE = 0.3;
/** Chance a smith burns their hand in a working hour. */
export const FORGE_ACCIDENT_CHANCE = 0.003;

export function injure(who: Sufferer, id: InjuryId, day: number): boolean {
  const list = (who.injuries ??= []);
  const had = list.find((i) => i.id === id);
  if (had) {
    had.daysLeft = Math.max(had.daysLeft, INJURIES[id].days);
    return false;
  }
  list.push({ id, day, daysLeft: INJURIES[id].days });
  return true;
}

export function fallIll(who: Sufferer, id: IllnessId, day: number): boolean {
  if (who.illness) return false;
  who.illness = { id, day, daysLeft: ILLNESSES[id].days };
  return true;
}

/** Skill tiers lost to injuries. */
export function skillPenalty(who: Sufferer, skill: Skill): number {
  return (who.injuries ?? []).reduce((sum, i) => sum + ((INJURIES[i.id] as InjuryDef).skills?.[skill] ?? 0), 0);
}

/** Attribute points lost to injuries and illness. */
export function attributePenalty(who: Sufferer, a: Attribute): number {
  const inj = (who.injuries ?? []).reduce((sum, i) => sum + ((INJURIES[i.id] as InjuryDef).attributes?.[a] ?? 0), 0);
  const ill = who.illness ? ((ILLNESSES[who.illness.id] as IllnessDef).attributes?.[a] ?? 0) : 0;
  return inj + ill;
}

/** Skills after injuries (never below 0). Two injuries to the same skill stack. */
export function injuredSkills(skills: Skills, who: Sufferer): Skills {
  if (!(who.injuries ?? []).length) return skills;
  const touched = new Set<Skill>([...(Object.keys(skills) as Skill[]), ...(who.injuries ?? []).flatMap((i) => Object.keys((INJURIES[i.id] as InjuryDef).skills ?? {}) as Skill[])]);
  const out: Skills = { ...skills };
  for (const s of touched) out[s] = Math.max(0, skillLevel(skills, s) + skillPenalty(who, s));
  return out;
}

/** Attributes after injuries and illness (never below 1). */
export function injuredAttributes(attributes: Attributes, who: Sufferer): Attributes {
  if (!(who.injuries ?? []).length && !who.illness) return attributes;
  const out = { ...attributes };
  for (const a of Object.keys(out) as Attribute[]) out[a] = Math.max(1, out[a] + attributePenalty(who, a));
  return out;
}

/** A night passes: injuries and illness heal a day (two with care). Returns what healed. */
export function healOvernight(who: Sufferer): string[] {
  const healed: string[] = [];
  for (const i of who.injuries ?? []) i.daysLeft -= i.cared ? 2 : 1;
  for (const i of (who.injuries ?? []).filter((x) => x.daysLeft <= 0)) healed.push(INJURIES[i.id].name);
  who.injuries = (who.injuries ?? []).filter((x) => x.daysLeft > 0);
  if (who.illness) {
    who.illness.daysLeft -= who.illness.cared ? 2 : 1;
    if (who.illness.daysLeft <= 0) {
      healed.push(ILLNESSES[who.illness.id].name);
      who.illness = null;
    }
  }
  return healed;
}

/** Someone tended them (a healer, a salve, a remedy): everything heals twice as fast. */
export function tend(who: Sufferer): void {
  for (const i of who.injuries ?? []) i.cared = true;
  if (who.illness) who.illness.cared = true;
}

/** The remedy arrived (a quest with `cures`): that injury is healed outright. */
export function cure(who: Sufferer, id: string): boolean {
  const before = (who.injuries ?? []).length;
  who.injuries = (who.injuries ?? []).filter((i) => i.id !== id);
  if (who.illness?.id === id) {
    who.illness = null;
    return true;
  }
  return (who.injuries ?? []).length < before;
}

/** A hit landed: maybe a lasting injury. `share` is damage over max HP; `left` HP left over max. */
export function maybeInjure(who: Sufferer, share: number, left: number, day: number, rng: Rng): InjuryId | null {
  if (share < 0.25 && left > 0.25) return null;
  if (rng() >= FIGHT_INJURY_CHANCE) return null;
  const pick: InjuryId[] = ["deep_cut", "bruised_ribs", "sprained_ankle", "broken_arm"];
  const id = pick[Math.floor(rng() * pick.length)]!;
  return injure(who, id, day) ? id : null;
}

/** Midnight: a chance of catching something, more in the cold. */
export function maybeFallIll(who: Sufferer, day: number, rng: Rng): IllnessId | null {
  if (who.illness) return null;
  const chance = isCold(day) ? ILLNESS_CHANCE.cold : ILLNESS_CHANCE.warm;
  if (rng() >= chance) return null;
  const id: IllnessId = isCold(day) ? "winter_cough" : "fever";
  return fallIll(who, id, day) ? id : null;
}

/** An hour together: the sick may pass it on. Returns who caught what (for logs). */
export function spreadIllness<T extends { name: string; who: Sufferer }>(group: T[], day: number, rng: Rng): Array<{ name: string; illness: IllnessId }> {
  const caught: Array<{ name: string; illness: IllnessId }> = [];
  const sick = group.filter((g) => g.who.illness);
  for (const s of sick) {
    const def = ILLNESSES[s.who.illness!.id];
    for (const other of group) {
      if (other === s || other.who.illness) continue;
      if (rng() < def.spread && fallIll(other.who, s.who.illness!.id, day)) caught.push({ name: other.name, illness: s.who.illness!.id });
    }
  }
  return caught;
}

/** What shows: "a bandaged, burned hand; a hacking cough". */
export function visibleHealth(who: Sufferer): string[] {
  return [...(who.injuries ?? []).map((i) => INJURIES[i.id].visible), ...(who.illness ? [ILLNESSES[who.illness.id].visible] : [])];
}

/** The situation line for a sufferer, or null. */
export function describeHealth(who: Sufferer): string | null {
  const parts = [
    ...(who.injuries ?? []).map((i) => {
      const def = INJURIES[i.id] as InjuryDef;
      const costs = [...Object.entries(def.skills ?? {}).map(([s, d]) => `${s.replace("_", "-")} ${d}`), ...Object.entries(def.attributes ?? {}).map(([a, d]) => `${a} ${d}`)];
      return `${def.name} (${costs.join(", ")}; ${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"} to heal${i.cared ? ", tended" : ""})`;
    }),
    ...(who.illness ? [`${ILLNESSES[who.illness.id].name}, which saps your strength`] : []),
  ];
  return parts.length > 0 ? `You're suffering from ${parts.join(" and ")}. It shows in your work.` : null;
}

/** Can they work this hour, ill? (A fever lets you work half the hours.) */
export function canWorkIll(who: Sufferer, rng: Rng): boolean {
  if (!who.illness) return true;
  return rng() < ILLNESSES[who.illness.id].work;
}

/** Extra energy lost an hour from illness. */
export function illnessDrain(who: Sufferer): number {
  return who.illness ? ILLNESSES[who.illness.id].energyDrain : 0;
}

/** A need quest for the cure while they suffer: "Herbs for my hand". Null if the file already has one that cures it. */
export function cureQuest(npcId: string, who: Sufferer, existing: QuestDef[], money: number): QuestDef | null {
  const ail = (who.injuries ?? [])[0] ?? null;
  const id = ail ? ail.id : who.illness?.id;
  if (!id) return null;
  if (existing.some((q) => q.cures === id)) return null;
  const def = ail ? (INJURIES[ail.id] as InjuryDef) : (ILLNESSES[who.illness!.id] as IllnessDef);
  const reward = Math.min(money, 60 * def.remedy.qty + 40);
  if (reward <= 0) return null;
  return {
    id: `cure_${npcId}_${id}`,
    title: `Something for ${def.name}`,
    description: `You're laid low by ${def.name} and need ${def.remedy.qty} ${def.remedy.item} to treat it.`,
    tier: "G",
    minTrust: 0,
    objective: { type: "deliver", item: def.remedy.item, qty: def.remedy.qty },
    reward: { money: reward },
    cures: id,
  };
}
