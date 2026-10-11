import { npcPrice } from "../npc/actions.js";
import { worldLore } from "../npc/knowledge.js";
import { skillLevel } from "../npc/skills.js";
import { npcGainXp, npcOvercome, statsOf } from "../npc/state.js";
import { fleeAt, traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { absoluteHour } from "./clock.js";
import {
  type Creature,
  creatureDamageBonus,
  creatureGainXp,
  creatureOvercomes,
  creatureStats,
  type CreatureTemplate,
  creatureWeapon,
  needsWeapon,
} from "./creatures.js";
import { payDebts } from "./debts.js";
import { attack, type Rng } from "./dice.js";
import { equippedWeapon, gearLimit, isBroken, slotFor, soak, wearGear } from "./gear.js";
import { ITEM_TIERS, type ItemKey, type ItemTier, itemLabel, itemValue, tierDamageBonus, type Weapon } from "./items.js";
import { XP } from "./life.js";
import { formatMoney } from "./money.js";

/**
 * The village's underside, run at night in code: what happens because bandits'
 * gear wears out.
 *
 * - **The black market.** Bandits can't mend their gear (they have no smith).
 *   One whose weapon is broken or gone tries to buy one, in secret, from a
 *   villager dishonest enough to deal (honesty below FENCE_HONESTY) who has a
 *   weapon it can wield. They pay over the odds from the gang's purse. The
 *   seller remembers it; the player only hears a rumour.
 * - **Raids.** When enough armed bandits clearly outmatch a shop's defenders
 *   (the shopkeeper and any guards), they may band together and raid it. The
 *   fight is rolled in code, and wears everyone's gear. Winning bandits carry off
 *   gear and coin (which they drop when killed); beaten ones run. Both sides
 *   learn from it, and the news reaches every NPC.
 */
export interface VillageNpc {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Villagers below this honesty will sell to bandits. */
export const FENCE_HONESTY = 0.5;
/** What bandits pay over the usual price for a weapon no honest smith will sell them. */
export const BLACK_MARKET_MARKUP = 1.5;
/** Armed bandits needed before they'll raid. */
export const RAID_MIN = 3;
/** How much stronger than the defenders they have to feel. */
export const RAID_RATIO = 1.2;
/** Chance, on a night they're strong enough, that they go. */
export const RAID_CHANCE = 0.25;
/** Most pieces a raid carries off. */
export const RAID_LOOT_ITEMS = 3;
/** Share of the shop's money a raid takes. */
export const RAID_MONEY_SHARE = 0.25;
/** The hour raids and back-alley deals happen. */
export const NIGHT_HOUR = 2;
/** How many news items the village remembers (world.recentEvents). */
export const NEWS_KEPT = 3;

const alive = (v: VillageNpc) => v.state.outcome !== "dead";

/** Bandit kinds: creatures that use forged gear. */
function gangOf(templates: Record<string, CreatureTemplate>, creatures: Record<string, Creature>) {
  return Object.values(creatures).flatMap((c) => {
    const t = templates[c.template];
    return t && t.weapon && c.outcome !== "dead" ? [{ t, c }] : [];
  });
}

/** Take `amount` from the gang's purses, richest first. Assumes they have it. */
function spendFromGang(gang: Creature[], amount: number): void {
  for (const c of [...gang].sort((a, b) => (b.money ?? 0) - (a.money ?? 0))) {
    const take = Math.min(amount, c.money ?? 0);
    c.money = (c.money ?? 0) - take;
    amount -= take;
    if (amount <= 0) return;
  }
}

export interface Deal {
  seller: string;
  buyer: string;
  item: ItemKey;
  price: number;
}

/**
 * Every bandit without a working weapon tries to buy one from a dishonest
 * villager. Returns the deals made (for tests) and the rumours (for the player).
 */
export function blackMarket(
  templates: Record<string, CreatureTemplate>,
  creatures: Record<string, Creature>,
  village: VillageNpc[],
  day: number,
): { deals: Deal[]; log: string[] } {
  const deals: Deal[] = [];
  const log: string[] = [];
  const gang = gangOf(templates, creatures);
  for (const { t, c } of gang) {
    if (c.outcome || !needsWeapon(t, c)) continue;
    const kin = gang.filter((g) => g.t.id === t.id && !g.c.outcome).map((g) => g.c);
    const purse = kin.reduce((sum, k) => sum + (k.money ?? 0), 0);
    // What's on offer: weapons in a dishonest villager's stock that this bandit can wield.
    const offers = village
      .filter((v) => alive(v) && !v.state.inCombat && traitsOf(v.persona).honesty < FENCE_HONESTY)
      .flatMap((v) =>
        Object.entries(v.state.inventory)
          .filter(([key, qty]) => qty > 0 && slotFor(key) === "weapon" && !isBroken(key) && !gearLimit(c.life.tier, key))
          .map(([key]) => ({ v, key, price: Math.ceil((npcPrice(v.persona, key) ?? itemValue(key) ?? 0) * BLACK_MARKET_MARKUP) })),
      )
      .filter((o) => o.price > 0 && o.price <= purse)
      .sort((a, b) => a.price - b.price);
    const deal = offers[0];
    if (!deal) continue;

    spendFromGang(kin, deal.price);
    const { v, key, price } = deal;
    v.state.inventory[key] = (v.state.inventory[key] ?? 0) - 1;
    if (v.state.inventory[key] === 0) delete v.state.inventory[key];
    v.state.money += price;
    payDebts(v.persona, v.state);
    c.equipment = { ...c.equipment, weapon: key }; // the broken one is tossed
    v.state.memories.push({
      id: `fenced-${day}-${c.uid}`,
      day,
      text: `On day ${day} you secretly sold a ${itemLabel(key)} to the bandits for ${formatMoney(price)}. If it came out you'd be finished; keep it quiet.`,
    });
    deals.push({ seller: v.id, buyer: c.uid, item: key, price });
    log.push(`Rumour has it someone in Millbrook is selling weapons to the bandits.`);
  }
  return { deals, log: [...new Set(log)] };
}

/** One side of a raid: a bandit or a villager, with what the fight needs. */
interface Fighter {
  name: string;
  side: "bandits" | "village";
  rank: ItemTier;
  holder: { equipment?: { weapon?: ItemKey; armor?: ItemKey } };
  hp: () => number;
  setHp: (hp: number) => void;
  maxHp: number;
  strength: number;
  agility: number;
  evasion: number;
  weapon: () => Weapon;
  weaponSkill: (w: Weapon) => number;
  bonus: (w: Weapon) => number;
  /** Below this HP they're out of the fight. */
  outAt: number;
  /** Bandits can be killed; villagers are beaten down, not killed. */
  mortal: boolean;
}

function banditFighter(t: CreatureTemplate, c: Creature): Fighter {
  const stats = creatureStats(t, c);
  return {
    name: c.name,
    side: "bandits",
    rank: c.life.tier,
    holder: c,
    hp: () => c.hp,
    setHp: (hp) => (c.hp = hp),
    maxHp: stats.maxHp,
    strength: stats.attributes.strength,
    agility: stats.attributes.agility,
    evasion: skillLevel(t.skills, "evasion"),
    weapon: () => creatureWeapon(t, c),
    weaponSkill: (w) => skillLevel(t.skills, w.skill),
    bonus: (w) => creatureDamageBonus(t, c, w),
    outAt: stats.maxHp * t.fleeAt,
    mortal: true,
  };
}

function villageFighter(v: VillageNpc): Fighter {
  const stats = statsOf(v.persona, v.state);
  return {
    name: v.persona.name,
    side: "village",
    rank: v.state.life.tier,
    holder: v.state,
    hp: () => v.state.hp,
    setHp: (hp) => (v.state.hp = hp),
    maxHp: stats.maxHp,
    strength: stats.attributes.strength,
    agility: stats.attributes.agility,
    evasion: skillLevel(v.persona.skills, "evasion"),
    weapon: () => equippedWeapon(v.state),
    weaponSkill: (w) => skillLevel(v.persona.skills, w.skill),
    bonus: (w) => tierDamageBonus(w.tier),
    outAt: stats.maxHp * fleeAt(traitsOf(v.persona)),
    mortal: false,
  };
}

/** How dangerous a fighter looks: rank, how hurt they are, and whether they're armed. */
function power(f: Fighter): number {
  const armed = f.weapon().name !== "fists" ? 1 : 0.5;
  return (ITEM_TIERS.indexOf(f.rank) + 1) * (f.hp() / f.maxHp) * armed;
}

const standing = (fs: Fighter[]) => fs.filter((f) => f.hp() > f.outAt && f.hp() > 0);

/** Fight it out, all in code. Returns the winning side. Gear wears on every blow. */
function battle(bandits: Fighter[], village: Fighter[], rng: Rng): { winner: "bandits" | "village"; killed: string[] } {
  const killed: string[] = [];
  for (let round = 0; round < 30; round++) {
    const order = [...standing(bandits), ...standing(village)].sort(() => rng() - 0.5);
    for (const f of order) {
      if (f.hp() <= f.outAt || f.hp() <= 0) continue;
      const foes = standing(f.side === "bandits" ? village : bandits);
      if (foes.length === 0) break;
      const foe = foes[Math.floor(rng() * foes.length)]!;
      const w = f.weapon();
      const hit = attack(rng, { strength: f.strength, weaponSkill: f.weaponSkill(w) }, { agility: foe.agility, evasion: foe.evasion }, w.die, f.bonus(w));
      if (!hit.success) continue;
      const hp = foe.hp() - soak(hit.damage, foe.holder);
      foe.setHp(foe.mortal ? Math.max(0, hp) : Math.max(1, hp));
      if (foe.mortal && foe.hp() === 0) killed.push(foe.name);
      wearGear(f.holder, "weapon");
      wearGear(foe.holder, "armor");
    }
    if (standing(bandits).length === 0) return { winner: "village", killed };
    if (standing(village).length === 0) return { winner: "bandits", killed };
  }
  // Nobody broke: the raiders give up at dawn.
  return { winner: "village", killed };
}

/**
 * Lore ids for raid news every NPC hears. world.recentEvents holds lore ids
 * (npc/knowledge.ts), so these need entries in src/data/world.json; until
 * they exist the news isn't spread (the people involved still remember it).
 */
export const RAID_NEWS = { raided: "news.bandit_raid", repelled: "news.raid_repelled" } as const;

/** Add a news event every NPC hears (world.recentEvents), keeping the last few. Skipped if the lore has no such entry. */
function spreadNews(world: Pick<WorldSnapshot, "recentEvents"> & { lastRaidDay?: number; day?: number }, id: string): void {
  // The raid day (game/events-calendar.ts): prices rise and the mine road shuts.
  if (world.day !== undefined) world.lastRaidDay = world.day;
  if (!worldLore().byId.has(id)) return;
  world.recentEvents.push(id);
  while (world.recentEvents.length > NEWS_KEPT) world.recentEvents.shift();
}

/** What a raid would carry off from a shop: gear first, then the dearest goods. */
function pickSpoils(inventory: Record<ItemKey, number>): ItemKey[] {
  const copies = Object.entries(inventory).flatMap(([key, qty]) => Array<ItemKey>(Math.max(0, qty)).fill(key));
  return copies
    .sort((a, b) => Number(slotFor(b) !== null) - Number(slotFor(a) !== null) || (itemValue(b) ?? 0) - (itemValue(a) ?? 0))
    .slice(0, RAID_LOOT_ITEMS);
}

export interface RaidResult {
  target: string;
  winner: "bandits" | "village";
  taken: ItemKey[];
  money: number;
  killed: string[];
}

/**
 * If enough armed bandits feel strong enough, they may raid the richest shop.
 * Returns what happened (for tests) and lines for the player.
 */
export function considerRaid(
  templates: Record<string, CreatureTemplate>,
  creatures: Record<string, Creature>,
  village: VillageNpc[],
  world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">,
  rng: Rng,
): { raid: RaidResult | null; log: string[] } {
  const none = { raid: null, log: [] };
  const gang = gangOf(templates, creatures).filter(({ t, c }) => t.raids && !c.outcome && !needsWeapon(t, c));
  if (gang.length < RAID_MIN) return none;
  const shops = village.filter((v) => alive(v) && v.persona.storage && !v.state.inCombat);
  const worth = (v: VillageNpc) => Object.entries(v.state.inventory).reduce((sum, [k, q]) => sum + (itemValue(k) ?? 0) * q, 0) + v.state.money;
  const target = shops.sort((a, b) => worth(b) - worth(a))[0];
  if (!target) return none;
  const defenders = [target, ...village.filter((v) => v !== target && alive(v) && v.persona.guard)];

  const bandits = gang.map(({ t, c }) => banditFighter(t, c));
  const village_ = defenders.map(villageFighter);
  const ratio = bandits.reduce((s, f) => s + power(f), 0) / Math.max(0.1, village_.reduce((s, f) => s + power(f), 0));
  if (ratio < RAID_RATIO || rng() >= RAID_CHANCE) return none;

  const place = `${target.persona.name}'s place`;
  const { winner, killed } = battle(bandits, village_, rng);
  const toughest = (fs: Fighter[]) => fs.reduce((best, f) => (ITEM_TIERS.indexOf(f.rank) > ITEM_TIERS.indexOf(best) ? f.rank : best), "G" as ItemTier);
  const log: string[] = [];

  // Bandits who fell are dead; the rest of a beaten gang runs (back the next day).
  for (const { c } of gang) {
    if (c.hp === 0) {
      c.outcome = "dead";
      c.deathCause = `the defence of ${place}`;
    }
  }

  if (winner === "bandits") {
    const taken = pickSpoils(target.state.inventory);
    const raiders = gang.filter(({ c }) => !c.outcome);
    taken.forEach((key, i) => {
      target.state.inventory[key] = (target.state.inventory[key] ?? 0) - 1;
      if (target.state.inventory[key] === 0) delete target.state.inventory[key];
      // A raider who can use a piece arms himself with it; the rest is carried off.
      const user = raiders.find(({ c }) => slotFor(key) === "weapon" && needsWeapon(templates[c.template]!, c) && !gearLimit(c.life.tier, key));
      if (user) user.c.equipment = { ...user.c.equipment, weapon: key };
      else {
        const carrier = raiders[i % Math.max(1, raiders.length)]?.c;
        if (carrier) carrier.pack = { ...carrier.pack, [key]: (carrier.pack?.[key] ?? 0) + 1 };
      }
    });
    const money = Math.floor(target.state.money * RAID_MONEY_SHARE);
    target.state.money -= money;
    raiders.forEach(({ c }, i) => (c.money = (c.money ?? 0) + Math.floor(money / raiders.length) + (i === 0 ? money % raiders.length : 0)));
    for (const { t, c } of raiders) {
      creatureOvercomes(t, c, XP.winFight, { kind: "fight", rank: toughest(village_), what: `raiding ${place}` }, world.day);
    }
    target.state.mood = "afraid";
    target.state.memories.push({
      id: `raided-${world.day}`,
      day: world.day,
      text: `On night ${world.day} bandits raided ${place} and took ${taken.map(itemLabel).join(", ") || "nothing"}${money > 0 ? ` and ${formatMoney(money)}` : ""}.`,
    });
    const news = `Bandits raided ${place} in the night and made off with ${taken.map(itemLabel).join(", ") || "nothing"}${money > 0 ? ` and ${formatMoney(money)}` : ""}.`;
    spreadNews(world, RAID_NEWS.raided);
    log.push(news);
    return { raid: { target: target.id, winner, taken, money, killed }, log };
  }

  for (const { t, c } of gang) {
    if (c.outcome) continue;
    c.outcome = "fled";
    creatureGainXp(t, c, XP.surviveFight);
  }
  const names = defenders.map((d) => d.persona.name);
  for (const d of defenders) {
    npcGainXp(d.persona, d.state, XP.winFight);
    npcOvercome(d.persona, d.state, { kind: "fight", rank: toughest(bandits), what: `driving bandits off ${place}` }, world.day);
    d.state.memories.push({
      id: `defended-${world.day}`,
      day: world.day,
      text: `On night ${world.day} you helped drive a bandit raid off ${place}${killed.length > 0 ? `; ${killed.length} of them died` : ""}.`,
    });
  }
  const news = `${names.join(" and ")} drove off a bandit raid on ${place} in the night${killed.length > 0 ? `, and ${killed.length} bandit${killed.length === 1 ? "" : "s"} died` : ""}.`;
  spreadNews(world, RAID_NEWS.repelled);
  log.push(news);
  return { raid: { target: target.id, winner, taken: [], money: 0, killed }, log };
}

/** The night's business: back-alley deals, then maybe a raid. Lines for the player. */
export function villageNight(
  templates: Record<string, CreatureTemplate>,
  creatures: Record<string, Creature>,
  village: VillageNpc[],
  world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">,
  rng: Rng,
): string[] {
  return [...blackMarket(templates, creatures, village, world.day).log, ...considerRaid(templates, creatures, village, world, rng).log];
}

/** Run villageNight for every NIGHT_HOUR crossed in `hours` from `from`. */
export function passVillageNights(
  templates: Record<string, CreatureTemplate>,
  creatures: Record<string, Creature>,
  village: VillageNpc[],
  world: Pick<WorldSnapshot, "recentEvents" | "lastRaidDay">,
  from: Pick<WorldSnapshot, "day" | "hour">,
  hours: number,
  rng: Rng,
): string[] {
  const log: string[] = [];
  const start = absoluteHour(from);
  for (let h = 1; h <= hours; h++) {
    const abs = start + h;
    if (abs % 24 !== NIGHT_HOUR) continue;
    const night: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay"> = { day: Math.floor(abs / 24) + 1, recentEvents: world.recentEvents };
    log.push(...villageNight(templates, creatures, village, night, rng));
    if (night.lastRaidDay !== undefined) world.lastRaidDay = night.lastRaidDay;
  }
  return log;
}
