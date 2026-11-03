import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import type { Skill } from "../../npc/skills.js";
import type { Attribute } from "../../npc/stats.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { temperOf } from "../chatter/person.js";
import { unit } from "../gossip/venues.js";
import type { SiteDay } from "../people/conditions.js";
import { outlookOf } from "../people/outlook.js";
import { ageFrom } from "../people/rules.js";
import { traitsOfRow } from "../people/traits.js";
import type { Entrant } from "./games.js";

/**
 * Townsfolk at play (N41): what a row brings to a table or the lists (`rowEntrant`, from their job, age and the fixed draws of who they
 * are, so a person is as strong and as quick-handed every time they play), and how much they want to play tonight (`playScore`: the same
 * score N38's `play` action gives, so leisure is chosen the way everything else is).
 */

const LABOUR = new Set(["labourer", "farmer", "porter", "smith", "miner", "carpenter", "carter"]);
const FIGHTERS = new Set(["guard", "knight", "soldier", "captain"]);

/** A townsperson as an entrant: attributes and skills from what they do and who they are. */
export function rowEntrant(r: PersonRow, day: number): Entrant {
  const age = ageFrom(r.born_day, day);
  const t = temperOf(r);
  const prime = age >= 18 && age <= 35 ? 1 : age > 50 ? -2 : 0;
  const d = (k: string) => Math.round(unit(`${r.id}:${k}`) * 6 - 3);
  const attrs: Partial<Record<Attribute, number>> = {
    strength: 10 + (LABOUR.has(r.job) ? 2 : 0) + (FIGHTERS.has(r.job) ? 3 : 0) + prime + d("str"),
    agility: 10 + (age < 30 ? 1 : age > 50 ? -2 : 0) + d("agi"),
    endurance: 10 + (LABOUR.has(r.job) ? 2 : 0) + prime + d("end"),
    perception: 10 + (r.job === "hunter" || r.job === "guard" ? 2 : 0) + d("per"),
    luck: 10 + d("luck"),
    intelligence: 10 + (["clerk", "scholar", "merchant", "priest"].includes(r.job) ? 2 : 0) + d("int"),
    charisma: 10 + (["merchant", "innkeeper", "server", "priest"].includes(r.job) ? 2 : 0) + d("cha"),
  };
  const skills: Partial<Record<Skill, number>> = {};
  const lvl = r.skill ?? 1;
  if (r.job === "hunter") skills.archery = Math.min(5, 2 + lvl);
  if (r.job === "guard" || r.job === "soldier") skills.archery = Math.max(skills.archery ?? 0, 1);
  if (FIGHTERS.has(r.job)) {
    skills.one_handed = Math.min(5, r.job === "knight" ? 2 + Math.floor(lvl / 2) : 1 + Math.floor(lvl / 2));
    skills.unarmed = 1;
  }
  if (r.job === "knight" || ["gentry", "noble", "royal"].includes(r.cls)) skills.animal_handling = r.job === "knight" ? 3 : 1;
  if (r.job === "farmer") skills.animal_handling = Math.max(skills.animal_handling ?? 0, 1);
  if (LABOUR.has(r.job) || r.job === "porter") skills.unarmed = Math.max(skills.unarmed ?? 0, 1);
  if (["server", "innkeeper"].includes(r.job) || unit(`${r.id}:gambler`) > 0.8) skills.gambling = unit(`${r.id}:gambler`) > 0.95 ? 3 : 1;
  if (t.honesty < 0.3 && t.greed > 0.6) skills.sleight = t.honesty < 0.15 ? 2 : 1;
  if (["priest", "merchant", "scholar"].includes(r.job)) skills.speechcraft = 2;
  return { id: r.id, name: r.name, skills, attrs };
}

/** Would they cheat at a game where they can? The dishonest and greedy who have the hands for it. */
export const wouldCheat = (r: PersonRow): boolean => {
  const t = temperOf(r);
  return t.honesty < 0.3 && t.greed > 0.55 && unit(`${r.id}:cheats`) < 0.8;
};

/** How much someone wants a game tonight, roughly 0..1.5 (decision 4): free hours, coin, sociability, temper, drink, the place's mood. */
export function playScore(r: PersonRow, day: number, sd: Pick<SiteDay, "famine" | "mood">): number {
  const age = ageFrom(r.born_day, day);
  if (age < 16 || r.job === "child" || r.away || r.captive || r.death !== null) return 0;
  const rank = CLASS_RANK[r.cls as SocialClass] ?? 2;
  // A slave has no evening of their own; the very high play elsewhere (at their own tables, not the inn's).
  if (rank <= 0 || rank >= 6) return 0;
  const t = temperOf(r);
  const o = outlookOf(r);
  const coin = rank >= 3 ? 0.2 : rank === 2 ? 0.1 : 0;
  const grief = (sd.mood?.grief ?? 0) / 100;
  const joy = (sd.mood?.joy ?? 0) / 100;
  return Math.max(0, 0.35 * unit(`${r.id}:sociable`) + 0.25 * t.temper + 0.2 * (1 - t.honesty) * t.greed + coin + 0.15 * joy - 0.5 * grief - 0.4 * sd.famine + 0.05 * o.mood + (age < 35 ? 0.1 : 0));
}

/** How much someone wants to enter a contest (decision 4): pride, bravery, youth and wanting a name. */
export function competeScore(r: PersonRow, day: number): number {
  const age = ageFrom(r.born_day, day);
  if (age < 14 || r.job === "child" || r.away || r.captive || r.death !== null) return 0;
  const t = temperOf(r);
  const tr = traitsOfRow(r);
  return 0.4 * t.pride + 0.3 * tr.bravery + 0.2 * tr.ambition + (age < 30 ? 0.2 : age > 50 ? -0.3 : 0) + 0.1 * unit(`${r.id}:sport`);
}
