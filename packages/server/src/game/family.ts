import { z } from "zod";
import { config } from "../config.js";
import { addEmotion } from "../npc/emotions.js";
import { addLore, learnLore } from "../npc/knowledge.js";
import { remember } from "../npc/memory.js";
import { grownSkills } from "../npc/growth.js";
import { romanceStageFor } from "../npc/relationship.js";
import { skillLevel, SKILLS, type Skill, type Skills } from "../npc/skills.js";
import { adjustRelation, isEnemy, relationTo } from "../npc/social.js";
import { ATTRIBUTES, type Attributes } from "../npc/stats.js";
import { agreeing, fallbackIdentity, rollTemplate, type NpcTemplate } from "../npc/templates.js";
import { resolveTraits, traitsOf, TRAITS, type Traits } from "../npc/traits.js";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";
import { speciesOf } from "../world/species.js";
import { npcGender, npcName } from "../world/names.js";
import { seededRng, seedFrom, type Rng } from "./dice.js";
import { recordEvent } from "./events.js";
import { note } from "./journal.js";
import { ITEM_TIERS } from "./items.js";
import { ageOn, ageStage, effectiveStats } from "./life.js";
import { ageGapTooWide, canCourtAt, closeKin } from "./people/rules.js";
import type { ScheduleBlock } from "./schedule.js";
import { dailyChance } from "./weather.js";
import { registerTalker, talkerSite } from "./talkers.js";

/**
 * Families (N11.3): courtship, marriage, children and what runs in the blood.
 *
 * All rules in code (design rule 1); the model only ever hears words ("your wife,
 * Mara", "you're expecting a child"). Every night:
 *
 * - **Courtship.** Two unmarried NPCs past courting age (two years after they're grown)
 *   who like and trust each other (both ways),
 *   aren't kin, aren't too far apart in age and haven't sworn off love
 *   (`romance.open: false`) start walking out together. Each night they still feel it,
 *   they grow closer; after `config.family.courtshipNights` they marry. A quarrel that
 *   drops either one's affection ends it.
 * - **Marriage** is news: the whole village hears, both remember it, and each is the
 *   other's spouse until death. The player can marry too, only with romance on and an
 *   NPC who's open to it, at the last romance stage (`propose`).
 * - **Children.** A married couple, both grown and not yet old, may start expecting
 *   (a nightly chance) up to a few children, with rest between, while the town is under
 *   its population cap. The child is born `pregnancyDays` later as a new NPC whose file
 *   lives in the save (`born`): a baby at home, who starts talking and running errands
 *   at `talkAge`, and is grown (no longer `minor`) at their species' adult age.
 * - **Inheritance.** A child's attributes are their parents' average with a little
 *   luck either way; traits are a blend; potential follows the stronger parent. Each
 *   parent's good skills may pass on as **talents**: the child learns them faster
 *   (npc/growth.ts) and comes into part of the parent's skill when they grow up.
 *
 * Minors never court, marry or are proposed to (design rule 7).
 */

export interface Marriage {
  a: string;
  b: string;
  day: number;
}

export interface Courtship {
  a: string;
  b: string;
  since: number;
  nights: number;
}

export interface Expecting {
  parents: [string, string];
  since: number;
  dueDay: number;
}

export interface FamilyState {
  marriages: Marriage[];
  courting: Courtship[];
  expecting: Expecting[];
  /** The last day each couple (by pairKey) had a child. */
  lastBirth: Record<string, number>;
}

export const FamilySchema = z.object({
  marriages: z.array(z.object({ a: z.string(), b: z.string(), day: z.number().int() })).default([]),
  courting: z.array(z.object({ a: z.string(), b: z.string(), since: z.number().int(), nights: z.number().int() })).default([]),
  expecting: z.array(z.object({ parents: z.tuple([z.string(), z.string()]), since: z.number().int(), dueDay: z.number().int() })).default([]),
  lastBirth: z.record(z.string(), z.number().int()).default({}),
});

export const freshFamily = (): FamilyState => ({ marriages: [], courting: [], expecting: [], lastBirth: {} });

/** The world's family records, made if missing. */
export function familyOf(world: Pick<WorldSnapshot, "family">): FamilyState {
  return (world.family ??= freshFamily());
}

/** Courting needs both to like (affection) and trust each other at least this much. */
export const COURT_AFFECTION = 50;
export const COURT_TRUST = 20;
/** Below this affection either way, a courtship is over. */
export const COURT_ENDS_BELOW = 35;
/** How much closer a courting pair grows each night. */
export const COURT_WARMTH = 3;
/** The player, wherever an NPC id could go (a spouse, a parent). */
export const PLAYER = "player";

/** A member of the village for family rules: an id, their file and their state. */
export interface Kin {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** One key per couple, whichever way round: "mara+tomas". */
const pairKey = (a: string, b: string) => [a, b].sort().join("+");

// ---- Who's who ----

/** Someone's living spouse (an NPC id or "player"), or null. */
export function spouseOf(world: Pick<WorldSnapshot, "family">, id: string, alive: (id: string) => boolean = () => true): string | null {
  for (const m of familyOf(world).marriages) {
    const other = m.a === id ? m.b : m.b === id ? m.a : null;
    if (other && alive(other) && alive(id)) return other;
  }
  return null;
}

/** Parent and child, or brothers and sisters: never a couple. */
export function isKin(members: Array<Pick<Kin, "id" | "persona">>, a: string, b: string): boolean {
  // The rule is shared with the townsfolk's (game/people/rules.ts); the cast only counts parents and siblings.
  return closeKin((id) => members.find((m) => m.id === id)?.persona.parents ?? [], a, b, 1);
}

const alive = (k: Kin) => k.state.outcome !== "dead" && !k.state.dormant;
const grown = (k: Kin, day: number) => !k.persona.minor && ageStage(speciesOf(k.persona.species), ageOn(k.state.life, day)) !== "young";
/** Old enough to court: grown, and a couple of years past it (config.family.courtingAfterAdult). */
const courtingAge = (k: Kin, day: number) => grown(k, day) && canCourtAt(k.persona.species, ageOn(k.state.life, day));

/** Can these two court? Code's rules, both ways. */
export function canCourt(a: Kin, b: Kin, world: WorldSnapshot, members: Kin[]): boolean {
  if (!config.content.npcMarriage || a.id === b.id) return false;
  for (const k of [a, b]) {
    if (!alive(k) || !courtingAge(k, world.day) || k.persona.romance?.open === false || k.state.companion) return false;
  }
  const isAlive = (id: string) => id === PLAYER || members.some((m) => m.id === id && alive(m));
  if (spouseOf(world, a.id, isAlive) || spouseOf(world, b.id, isAlive)) return false;
  if (isKin(members, a.id, b.id)) return false;
  if (ageGapTooWide(ageOn(a.state.life, world.day), ageOn(b.state.life, world.day))) return false;
  return !isEnemy(a.state, b.id) && !isEnemy(b.state, a.id);
}

/** Do they feel it, both ways? */
function drawn(a: Kin, b: Kin): boolean {
  const ab = relationTo(a.state, b.id);
  const ba = relationTo(b.state, a.id);
  return ab.affection >= COURT_AFFECTION && ba.affection >= COURT_AFFECTION && ab.trust >= COURT_TRUST && ba.trust >= COURT_TRUST;
}

// ---- News ----

function news(world: WorldSnapshot, members: Kin[], id: string, name: string, text: string, keywords: string[]): void {
  addLore(world, { id, kind: "news", name, aliases: [], keywords, text, event: true });
  if (!world.recentEvents.includes(id)) world.recentEvents.push(id);
  (world.newsDays ??= {})[id] = world.day;
  for (const m of members) if (alive(m) && !(m.persona.bornOnDay !== undefined && ageOn(m.state.life, world.day) < config.family.talkAge)) learnLore(m.state, id, "certain");
}

const nameOf = (members: Kin[], player: PlayerState, id: string) => (id === PLAYER ? player.name : (members.find((m) => m.id === id)?.persona.name ?? id));

/** "wife", "husband", or "spouse", from the voice's gender (the only gender an NPC file has). */
export function spouseWord(p: Pick<NpcPersona, "voice"> | null): string {
  return p?.voice?.gender === "female" ? "wife" : p?.voice?.gender === "male" ? "husband" : "spouse";
}
export function childWord(p: Pick<NpcPersona, "voice">): string {
  return p.voice?.gender === "female" ? "daughter" : p.voice?.gender === "male" ? "son" : "child";
}

// ---- Marriage ----

/** Two people marry. Everyone hears; both remember it. Returns a line for the log. */
export function wed(world: WorldSnapshot, members: Kin[], a: string, b: string): string {
  const fam = familyOf(world);
  fam.marriages.push({ a, b, day: world.day });
  fam.courting = fam.courting.filter((c) => pairKey(c.a, c.b) !== pairKey(a, b) && ![c.a, c.b].some((x) => x === a || x === b));
  const na = nameOf(members, world.player, a);
  const nb = nameOf(members, world.player, b);
  recordEvent(world, { kind: "marriage", actor: a, target: b, details: `${na} married ${nb}`, importance: 7, witnesses: [] });
  news(world, members, `news.wedding_${pairKey(a, b).replace("+", "_")}`, `the wedding of ${na} and ${nb}`, `${na} and ${nb} were married on day ${world.day}.`, ["wedding", "married", "marriage", "wed", "bride", "groom"]);
  for (const [self, other] of [[a, b], [b, a]] as const) {
    const k = members.find((m) => m.id === self);
    if (!k) continue;
    const otherName = nameOf(members, world.player, other);
    remember(k.state, { id: `married-${other}`, day: world.day, text: `you married ${otherName}`, importance: 9, valence: other === PLAYER ? 1 : 0 }, traitsOf(k.persona, k.state));
    addEmotion(k.state, "joy", 0.9, `marrying ${otherName}`, world.day, other === PLAYER);
    if (other !== PLAYER) {
      adjustRelation(k.state, other, "affection", 10);
      adjustRelation(k.state, other, "trust", 10);
    }
  }
  return `${na} and ${nb} are married!`;
}

/**
 * The player asks an NPC to marry them. Only with romance on, an NPC open to it, at the
 * last romance stage, neither already married, and never a minor (design rule 7).
 */
export function propose(world: WorldSnapshot, members: Kin[], id: string): { ok: boolean; message: string } {
  const k = members.find((m) => m.id === id);
  if (!k) return { ok: false, message: "There's nobody by that name." };
  const name = k.persona.name;
  if (k.persona.minor) return { ok: false, message: `${name} is a child.` };
  if (!config.content.romance) return { ok: false, message: "Romance is off in this game (start with ROMANCE=on)." };
  if (!alive(k)) return { ok: false, message: `${name} isn't here.` };
  const isAlive = (x: string) => x === PLAYER || members.some((m) => m.id === x && alive(m));
  const theirs = spouseOf(world, id, isAlive);
  if (theirs) return { ok: false, message: `${name} is already married${theirs === PLAYER ? " — to you" : ""}.` };
  const mine = spouseOf(world, PLAYER, isAlive);
  if (mine) return { ok: false, message: `You're already married to ${nameOf(members, world.player, mine)}.` };
  if (k.persona.romance?.open !== true || romanceStageFor(k.persona, k.state) < 3) {
    return { ok: false, message: `${name} isn't ready for that. (You need to be together first.)` };
  }
  return { ok: true, message: wed(world, members, PLAYER, id) };
}

// ---- Children ----

/** Attributes, skills and traits of a parent: an NPC's grown ones, or the player's. */
interface ParentStock {
  id: string;
  name: string;
  species: string;
  attributes: Attributes;
  maxHp: number;
  maxMp: number;
  skills: Skills;
  traits: Traits;
  potential: (typeof ITEM_TIERS)[number];
  persona: NpcPersona | null;
}

function stockOf(members: Kin[], player: PlayerState, id: string): ParentStock | null {
  if (id === PLAYER) {
    const potential = ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, 2 + Math.floor(player.level / 3))]!;
    return { id, name: player.name, species: "human", attributes: player.attributes, maxHp: player.maxHp, maxMp: player.maxMp ?? 10, skills: player.skills, traits: resolveTraits(undefined), potential, persona: null };
  }
  const k = members.find((m) => m.id === id);
  if (!k) return null;
  const stats = effectiveStats(k.persona.stats, k.state.life);
  return {
    id,
    name: k.persona.name,
    species: k.persona.species ?? "human",
    // The stats they were born with, plus what they've grown into (not age's toll).
    attributes: { ...k.persona.stats.attributes, ...Object.fromEntries(ATTRIBUTES.map((a) => [a, Math.min(20, k.persona.stats.attributes[a] + (k.state.life.growth.attributes[a] ?? 0) + (k.state.growth.attributes[a] ?? 0))])) } as Attributes,
    maxHp: Math.max(stats.maxHp, k.persona.stats.maxHp),
    maxMp: k.persona.stats.maxMp,
    skills: grownSkills(k.persona.skills, k.state.growth),
    traits: traitsOf(k.persona, k.state),
    potential: k.state.life.potential,
    persona: k.persona,
  };
}

/** A parent's skill (apprentice, tier 2, or better) passes on as a talent with this chance per tier: 40% at 2, 60% at 3, 100% at 5. */
export const TALENT_CHANCE_PER_TIER = 0.2;
export const MAX_TALENTS = 3;

export interface Inheritance {
  attributes: Attributes;
  traits: Traits;
  potential: (typeof ITEM_TIERS)[number];
  talents: Skill[];
  /** Skill tiers they come into when grown: half the better parent's, at least 1. */
  inherited: Partial<Record<Skill, number>>;
  species: string;
  maxHp: number;
  maxMp: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * What a child gets from their parents, rolled by code. The order of rolls is fixed,
 * so the same parents and seed give the same child.
 */
export function inherit(a: ParentStock, b: ParentStock, rng: Rng): Inheritance {
  const species = rng() < 0.5 ? a.species : b.species;
  const sp = speciesOf(species);
  // Attributes: the parents' average, and a little luck either way (-2..+2).
  const attributes = Object.fromEntries(ATTRIBUTES.map((at) => [at, clamp(Math.round((a.attributes[at] + b.attributes[at]) / 2) + Math.floor(rng() * 5) - 2, 1, 20)])) as Attributes;
  // Traits: a blend, nudged (±0.15) so no child is a copy.
  const traits = Object.fromEntries(TRAITS.map((t) => [t, clamp(Math.round(((a.traits[t] + b.traits[t]) / 2 + (rng() - 0.5) * 0.3) * 100) / 100, 0, 1)])) as Traits;
  // Potential: the stronger parent's, give or take a rank, never above the species.
  const best = Math.max(ITEM_TIERS.indexOf(a.potential), ITEM_TIERS.indexOf(b.potential));
  const potential = ITEM_TIERS[clamp(best + Math.floor(rng() * 3) - 1, 1, ITEM_TIERS.indexOf(sp.maxTier))]!;
  // Talents: each parent's skills at apprentice (2) or better may pass on.
  const candidates: Array<{ skill: Skill; level: number }> = [];
  for (const s of SKILLS) {
    const level = Math.max(skillLevel(a.skills, s), skillLevel(b.skills, s));
    if (level >= 2) candidates.push({ skill: s, level });
  }
  candidates.sort((x, y) => y.level - x.level);
  const talents: Skill[] = [];
  const inherited: Partial<Record<Skill, number>> = {};
  for (const c of candidates) {
    const roll = rng();
    if (talents.length >= MAX_TALENTS || roll >= c.level * TALENT_CHANCE_PER_TIER) continue;
    talents.push(c.skill);
    inherited[c.skill] = Math.max(1, Math.floor(c.level / 2));
  }
  return { attributes, traits, potential, talents, inherited, species, maxHp: Math.round((a.maxHp + b.maxHp) / 2), maxMp: Math.round((a.maxMp + b.maxMp) / 2) };
}

/** A baby's day: at home, asleep or fed, all day (nobody else is there). */
export const INFANT_SCHEDULE: ScheduleBlock[] = [
  { from: 20, to: 7, activity: "sleep", place: "home" },
  { from: 7, to: 8, activity: "eat", place: "home" },
  { from: 8, to: 12, activity: "socialise", place: "home" },
  { from: 12, to: 13, activity: "eat", place: "home" },
  { from: 13, to: 18, activity: "socialise", place: "home" },
  { from: 18, to: 20, activity: "eat", place: "home" },
];

/** The family name: the last word of a parent's name with more than one word ("Mara Ashford" → "Ashford"). */
function familyName(stocks: ParentStock[], fallback: string): string {
  for (const s of stocks) {
    const words = s.name.split(" ");
    if (s.persona && words.length > 1 && !/^(old|young|corporal|captain|mistress|master)$/i.test(words.at(-1)!)) return words.at(-1)!;
  }
  for (const s of stocks) {
    const words = s.name.split(" ");
    if (words.length > 1) return words.at(-1)!;
  }
  return fallback;
}

/**
 * A newborn's NPC file, from the child template and their parents. `takenIds` and
 * `takenNames` keep the id and first name new.
 */
export function makeChild(template: NpcTemplate, a: ParentStock, b: ParentStock, day: number, takenIds: string[], takenNames: string[], place = "the village"): NpcPersona {
  const rng = seededRng(seedFrom(`${a.id}+${b.id}@${day}`));
  const rolled = rollTemplate(template, rng);
  const inh = inherit(a, b, rng);
  const family = familyName([a, b], rolled.fallbackName.family);
  const firsts = template.names[rolled.gender].filter((n) => !takenNames.some((t) => t.split(" ")[0] === n));
  const first = firsts.length > 0 ? firsts[Math.floor(rng() * firsts.length)]! : `${rolled.fallbackName.first}`;
  const name = `${first} ${family}`;
  let id = first.toLowerCase();
  for (let n = 2; takenIds.includes(id); n++) id = `${first.toLowerCase()}${n}`;
  const words = fallbackIdentity(template, { ...rolled, traits: inh.traits }, rng, name);
  const parentsWords = `${a.name} and ${b.name}`;
  const sp = speciesOf(inh.species);
  return {
    id,
    name,
    role: `the baby of ${parentsWords}`,
    species: inh.species,
    age: 0,
    tier: "G",
    potential: inh.potential,
    personality: agreeing(words.personality, { traits: inh.traits, greed: rolled.greed }, template.fallback.personality.flat()),
    greed: rolled.greed,
    traits: inh.traits,
    speechStyle: "A baby: only babbles, cries and laughs.",
    fallbackLine: "Ba!",
    voice: rolled.voice,
    backstory: `${first} was born in ${place} on day ${day}, to ${parentsWords}.`,
    goals: ["Be fed", "Be held"],
    knows: {},
    secrets: [],
    stats: { maxHp: Math.max(10, Math.round(inh.maxHp * 0.6)), maxMp: inh.maxMp, attributes: inh.attributes },
    skills: {},
    maxQuestTier: "G",
    quests: [],
    weapon: "stick",
    startingInventory: {},
    startingMoney: 0,
    reserveMoney: 0,
    buys: [],
    prices: {},
    appearance: `A ${sp.name.replace(/^an? /, "")} baby, small and red-faced, with ${a.name.split(" ")[0]}'s eyes.`,
    minor: true,
    schedule: INFANT_SCHEDULE.map((x) => ({ ...x })),
    relationships: {
      ...(a.id !== PLAYER ? { [a.id]: { trust: 80, affection: 90 } } : {}),
      ...(b.id !== PLAYER ? { [b.id]: { trust: 80, affection: 90 } } : {}),
    },
    parents: [a.id, b.id],
    ...(inh.talents.length > 0 ? { talents: inh.talents, inherited: inh.inherited } : {}),
    template: template.id,
    bornOnDay: day,
  };
}

/** A child's file at talking age: the child template's words, schedule and knowledge. */
export function childhood(p: NpcPersona, template: NpcTemplate, day: number): NpcPersona {
  const rng = seededRng(seedFrom(`${p.id}:childhood`));
  const rolled = rollTemplate(template, rng);
  const words = fallbackIdentity(template, { ...rolled, age: config.family.talkAge, traits: resolveTraits(p.traits) }, rng, p.name);
  return {
    ...p,
    role: `${pick(rng, template.roles)}`,
    speechStyle: words.speechStyle,
    fallbackLine: template.fallback.fallbackLine,
    backstory: `${p.backstory} ${words.backstory}`,
    appearance: words.appearance,
    goals: words.goals,
    knows: { ...template.knows },
    skills: { ...rolled.skills, ...p.skills },
    stats: { ...p.stats, maxHp: Math.max(p.stats.maxHp, rolled.maxHp) },
    schedule: template.schedule.map((x) => ({ ...x })),
  };
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

/** "smithing", "smithing and blunt", "foraging, evasion and hunting". */
export function skillList(skills: readonly string[]): string {
  const words = skills.map((s) => s.replace("_", "-"));
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * A child comes of age: no longer a minor; they come into their talents' inherited
 * tiers, a grown body, and their working parent's trade and hours.
 */
export function adulthood(p: NpcPersona, parents: Array<NpcPersona | null>, day: number, place = "the village"): NpcPersona {
  const skills: Skills = { ...p.skills };
  for (const [s, level] of Object.entries(p.inherited ?? {}) as Array<[Skill, number]>) skills[s] = Math.max(skillLevel(skills, s), level);
  const mentor = parents.find((x): x is NpcPersona => x !== null && x.schedule !== undefined && x.minor !== true);
  const teaches = (p.talents ?? []).find((s) => skillLevel(skills, s) > 0);
  const { minor: _minor, ...rest } = p;
  const parentWord = mentor ? `${mentor.name}'s ${childWord(p)}` : `born and raised in ${place}`;
  return {
    ...rest,
    role: mentor ? `a young villager of ${place}, ${parentWord}, who works alongside them` : `a young villager of ${place}, ${parentWord}`,
    goals: ["Make a name for themselves", ...(mentor ? [`Do right by ${mentor.name.split(" ")[0]}`] : ["Find steady work"])],
    stats: { ...p.stats, maxHp: Math.max(p.stats.maxHp, Math.round(p.stats.maxHp / 0.6)) },
    skills,
    ...(teaches ? { teaches } : {}),
    // Their parent's trade: what they buy and sell, and where they keep it (they inherit the stock if no one else does: game/succession.ts).
    ...(mentor ? { buys: [...mentor.buys], prices: { ...mentor.prices }, ...(mentor.storage ? { storage: { ...mentor.storage } } : {}) } : {}),
    schedule: (mentor?.schedule ?? [{ from: 6, to: 18, activity: "work", place: "square" }, { from: 18, to: 21, activity: "eat", place: "inn" }, { from: 21, to: 6, activity: "sleep", place: "home" }]).map((x) => ({ ...x })),
    reserveMoney: 100,
    backstory: `${p.backstory} ${p.name.split(" ")[0]} came of age on day ${day}.`,
  };
}

// ---- The night ----

export interface FamilyNight {
  log: string[];
  /** NPC files born tonight: the town makes them agents. */
  born: NpcPersona[];
  /** NPC files that changed (grew up): the town swaps them in. */
  changed: NpcPersona[];
}

/**
 * The family rules for one midnight: courtships move on or end, couples marry,
 * children are expected and born, and children grow up. `template` is the child
 * template (src/data/templates/child.json).
 */
export function familyNight(members: Kin[], world: WorldSnapshot, rng: Rng, template: NpcTemplate | undefined, place = { site: "", name: "the village" }): FamilyNight {
  const out: FamilyNight = { log: [], born: [], changed: [] };
  const fam = familyOf(world);
  const byId = (id: string) => members.find((m) => m.id === id);
  const isAlive = (id: string) => id === PLAYER || (byId(id) !== undefined && alive(byId(id)!));
  const day = world.day;

  // Courtships: move on, or end.
  for (const c of [...fam.courting]) {
    const a = byId(c.a);
    const b = byId(c.b);
    if (!a || !b || !canCourt(a, b, world, members) || relationTo(a.state, b.id).affection < COURT_ENDS_BELOW || relationTo(b.state, a.id).affection < COURT_ENDS_BELOW) {
      fam.courting = fam.courting.filter((x) => x !== c);
      if (a && b && alive(a) && alive(b)) out.log.push(`${a.persona.name} and ${b.persona.name} are no longer walking out together.`);
      continue;
    }
    c.nights += 1;
    adjustRelation(a.state, b.id, "affection", COURT_WARMTH);
    adjustRelation(b.state, a.id, "affection", COURT_WARMTH);
    if (c.nights >= config.family.courtshipNights) out.log.push(wed(world, members, a.id, b.id));
  }

  // New courtships: the fondest pair first, one each per night.
  const busy = new Set(fam.courting.flatMap((c) => [c.a, c.b]));
  const pairs: Array<{ a: Kin; b: Kin; warmth: number }> = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!;
      const b = members[j]!;
      if (busy.has(a.id) || busy.has(b.id) || !drawn(a, b) || !canCourt(a, b, world, members)) continue;
      pairs.push({ a, b, warmth: relationTo(a.state, b.id).affection + relationTo(b.state, a.id).affection });
    }
  }
  pairs.sort((x, y) => y.warmth - x.warmth);
  for (const { a, b } of pairs) {
    if (busy.has(a.id) || busy.has(b.id)) continue;
    busy.add(a.id).add(b.id);
    fam.courting.push({ a: a.id, b: b.id, since: day, nights: 0 });
    recordEvent(world, { kind: "courtship", actor: a.id, target: b.id, details: `${a.persona.name} and ${b.persona.name} began walking out together`, importance: 4, witnesses: [] });
    news(world, members, `news.courting_${pairKey(a.id, b.id).replace("+", "_")}`, `${a.persona.name} and ${b.persona.name} courting`, `${a.persona.name} and ${b.persona.name} have been walking out together since day ${day}.`, ["courting", "sweethearts", "walking out"]);
    out.log.push(`${a.persona.name} and ${b.persona.name} have started walking out together.`);
  }

  // Births that are due. One parent living is enough.
  const takenIds = () => [...members.map((m) => m.id), ...out.born.map((p) => p.id)];
  const takenNames = () => [...members.map((m) => m.persona.name), ...out.born.map((p) => p.name)];
  for (const e of [...fam.expecting]) {
    if (e.dueDay > day) continue;
    fam.expecting = fam.expecting.filter((x) => x !== e);
    if (!e.parents.some(isAlive) || !template) continue;
    const [sa, sb] = e.parents.map((id) => stockOf(members, world.player, id) ?? stockOf(members, world.player, e.parents.find((x) => x !== id)!));
    if (!sa || !sb) continue;
    const child = makeChild(template, sa, sb, day, [...takenIds(), ...Object.keys(world.talkers ?? {})], takenNames(), place.name);
    registerTalker(world, child, place.site);
    fam.lastBirth[pairKey(...e.parents)] = day;
    out.born.push(child);
    const parentsWords = `${sa.name} and ${sb.name}`;
    recordEvent(world, { kind: "birth", actor: child.id, target: e.parents[0], details: `${child.name} was born to ${parentsWords}`, importance: 7, witnesses: [] });
    news(world, members, `news.birth_${child.id}`, `the birth of ${child.name}`, `${parentsWords} had a ${childWord(child)}, ${child.name}, on day ${day}.`, ["baby", "born", "birth", "child", childWord(child)]);
    for (const pid of e.parents) {
      const k = byId(pid);
      if (!k || !alive(k)) continue;
      remember(k.state, { id: `child-${child.id}`, day, text: `your ${childWord(child)} ${child.name.split(" ")[0]} was born`, importance: 9, valence: 0 }, traitsOf(k.persona, k.state));
      addEmotion(k.state, "joy", 1, `${child.name.split(" ")[0]} being born`, day);
      adjustRelation(k.state, child.id, "affection", 90);
      adjustRelation(k.state, child.id, "trust", 60);
    }
    if (e.parents.includes(PLAYER)) note(world.player, { id: `birth:${child.id}`, day, npc: child.id, kind: "family", text: `Your ${childWord(child)} ${child.name} was born.` });
    const talents = child.talents?.length ? ` ${child.name.split(" ")[0]} has a gift for ${skillList(child.talents)}, like their parents.` : "";
    out.log.push(`${parentsWords} have a ${childWord(child)}: ${child.name}!${talents}`);
  }

  // New pregnancies.
  const living = members.filter(alive).length + out.born.length;
  for (const m of fam.marriages) {
    if (living >= config.family.maxPopulation) break;
    if (![m.a, m.b].every(isAlive)) continue;
    const key = pairKey(m.a, m.b);
    if (fam.expecting.some((e) => pairKey(...e.parents) === key)) continue;
    if ((fam.lastBirth[key] ?? -Infinity) + config.family.restDays > day) continue;
    const kids = members.filter((k) => k.persona.parents && pairKey(k.persona.parents[0]!, k.persona.parents[1] ?? "") === key).length + out.born.filter((p) => pairKey(p.parents![0]!, p.parents![1]!) === key).length;
    if (kids >= config.family.maxChildrenPerCouple) continue;
    // Both grown, and neither old yet.
    const young = [m.a, m.b].every((id) => {
      if (id === PLAYER) return true;
      const k = byId(id)!;
      return ageStage(speciesOf(k.persona.species), ageOn(k.state.life, day)) === "adult";
    });
    if (!young || rng() >= dailyChance(config.family.conceptionYearly)) continue;
    fam.expecting.push({ parents: [m.a, m.b], since: day, dueDay: day + config.family.pregnancyDays });
    const na = nameOf(members, world.player, m.a);
    const nb = nameOf(members, world.player, m.b);
    recordEvent(world, { kind: "expecting", actor: m.a, target: m.b, details: `${na} and ${nb} are expecting a child`, importance: 5, witnesses: [] });
    news(world, members, `news.expecting_${key.replace("+", "_")}`, `${na} and ${nb}'s child on the way`, `${na} and ${nb} are expecting a child.`, ["expecting", "baby", "pregnant", "with child"]);
    out.log.push(`${na} and ${nb} are expecting a child.`);
  }

  // Growing up: born children reach talking age; any minor reaches adulthood.
  for (const k of members) {
    if ((k.persona.bornOnDay === undefined && !k.persona.minor) || !alive(k)) continue;
    const age = ageOn(k.state.life, day);
    const sp = speciesOf(k.persona.species);
    const parents = (k.persona.parents ?? []).map((id) => (id === PLAYER ? null : (byId(id)?.persona ?? null)));
    let next: NpcPersona | null = null;
    if (k.persona.minor && age >= sp.adultAge) {
      next = adulthood(k.persona, parents, day, place.name);
      recordEvent(world, { kind: "coming-of-age", actor: k.id, target: k.id, details: `${k.persona.name} came of age`, importance: 5, witnesses: [] });
      // "has come of age" is already said by the life rules (game/life.ts); this is what the blood brings.
      const gifts = Object.entries(next.inherited ?? {}).map(([sk, lvl]) => `${sk.replace("_", "-")} (${lvl})`);
      if (gifts.length > 0) out.log.push(`${k.persona.name} comes into what runs in the family: ${gifts.join(", ")}.`);
    } else if (k.persona.minor && age >= config.family.talkAge && k.persona.speechStyle.startsWith("A baby") && template) {
      next = childhood(k.persona, template, day);
      out.log.push(`${k.persona.name} is old enough to run errands round the square now.`);
    }
    if (next) {
      registerTalker(world, next, talkerSite(world, k.id) ?? place.site);
      out.changed.push(next);
    }
  }
  return out;
}

// ---- Words for the model ----

/** Talk about family: the family line is only shown then, or when family is present (design rule 3). */
export const FAMILY_TALK = /\b(famil\w*|wife|husband|spouse|married|marry|wedding|child\w*|kids?|son|daughter|baby|babies|parents?|mother|father|mum|mam|dad|pa|ma|brothers?|sisters?|courting|sweetheart)\b/i;

/** Everyone born in play (talkers with a birth day), grown up or not. */
export function bornKids(world: Pick<WorldSnapshot, "talkers">): NpcPersona[] {
  return Object.values(world.talkers ?? {}).map((t) => t.persona).filter((p) => p.bornOnDay !== undefined);
}

/** Age in whole years of someone born in play, on `day`. */
export function bornAge(p: Pick<NpcPersona, "bornOnDay">, day: number): number {
  return Math.max(0, Math.floor((day - (p.bornOnDay ?? day)) / config.daysPerYear));
}

const wordFor = (gender: string | undefined, female: string, male: string, other: string) => (gender === "female" ? female : gender === "male" ? male : other);

/**
 * One situation line about their family, or null: "Your husband is Tomas Reed. Your
 * children: Tam (6), Ivo (a baby). You're expecting another child, due in 3 days."
 * Only the living count; the dead are in the news and their memories.
 */
export function describeFamily(persona: NpcPersona, world: WorldSnapshot): string | null {
  const living = (id: string) => id === PLAYER || !world.deaths?.[id];
  const name = (id: string) => (id === PLAYER ? world.player.name : npcName(id));
  const parts: string[] = [];
  const fam = world.family;
  if (fam) {
    const spouse = spouseOf(world, persona.id, living);
    if (spouse) parts.push(spouse === PLAYER ? `You are married to ${world.player.name}.` : `Your ${wordFor(npcGender(spouse), "wife", "husband", "spouse")} is ${name(spouse)}.`);
    const court = fam.courting.find((c) => c.a === persona.id || c.b === persona.id);
    if (court) parts.push(`You're courting ${name(court.a === persona.id ? court.b : court.a)}.`);
    const kids = bornKids(world).filter((p) => p.parents?.includes(persona.id) && living(p.id));
    if (kids.length > 0) parts.push(`Your children: ${kids.map((p) => `${p.name.split(" ")[0]} (${bornAge(p, world.day) < 1 ? "a baby" : bornAge(p, world.day)})`).join(", ")}.`);
    const due = fam.expecting.find((e) => e.parents.includes(persona.id));
    if (due) parts.push(`You're expecting ${kids.length > 0 ? "another" : "a"} child, due in ${Math.max(0, due.dueDay - world.day)} day(s).`);
  }
  if (persona.parents?.length) parts.push(`Your parents: ${persona.parents.map(name).join(" and ")}${persona.parents.some((p) => !living(p)) ? " (not all living)" : ""}.`);
  if (persona.talents?.length) parts.push(`${skillList(persona.talents)} come${persona.talents.length === 1 ? "s" : ""} easily to you: it runs in the family.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Is anyone in their family here (so the family line is worth showing)? */
export function familyPresent(persona: NpcPersona, world: WorldSnapshot): boolean {
  const here = new Set(world.present ?? []);
  if (here.size === 0) return false;
  if ((persona.parents ?? []).some((p) => here.has(p))) return true;
  const fam = world.family;
  if (!fam) return false;
  const spouse = spouseOf(world, persona.id);
  if (spouse && here.has(spouse)) return true;
  return bornKids(world).some((p) => p.parents?.includes(persona.id) && here.has(p.id));
}

/** Marriages a new world starts with: every NPC file that names a spouse (both ways). */
export function authoredMarriages(personas: Record<string, NpcPersona>): Marriage[] {
  const out: Marriage[] = [];
  for (const p of Object.values(personas)) {
    if (!p.spouse || personas[p.spouse]?.spouse !== p.id || p.id > p.spouse) continue;
    out.push({ a: p.id, b: p.spouse, day: 0 });
  }
  return out;
}
