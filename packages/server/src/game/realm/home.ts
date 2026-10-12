import { tierOfAsk } from "../../director/validator.js";
import { skillLevel } from "../../npc/skills.js";
import type { NpcPersona, NpcState, QuestDef, WorldSnapshot } from "../../npc/types.js";
import { speciesOf } from "../../world/species.js";
import { factionOf } from "../factions.js";
import { itemKey, ITEMS, ITEM_TIERS } from "../items.js";
import { compareTiers } from "../levels.js";
import type { Tier } from "../life.js";
import { formatMoney } from "../money.js";
import type { SpawnRule } from "../spawning.js";
import { homeNeeds, type HomeNeed } from "./director.js";
import { killFigure, makeFigure } from "./figures.js";
import { HOME_ID } from "./generate.js";
import { tally } from "./log.js";
import type { Figure, Realm, Role } from "./types.js";

/**
 * Where the realm meets Millbrook's own map and its talking NPCs (N13.5-N13.8).
 *
 * - The talking cast are realm figures too (`talks`), so the hierarchy runs through
 *   them: Hale answers to Captain Holt, the merchants to their head, Rook leads his
 *   gang, and the mayor answers to the town above. Their rank and death follow the NPC.
 * - What the realm sends Millbrook happens on the map: raiders by night, beasts out
 *   of the woods, refugees on the road, a grain caravan at the inn.
 * - Millbrook's needs become work: quests on the boards of the NPCs who'd want them
 *   done, with the reward from their own purse (like director quests, N12.4).
 */

export interface CastMember {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** The roles roleOf gives: a figure with one of these follows its NPC's file; any other is an office the realm gave. */
const CAST_ROLES = new Set<Role>(["child", "guard", "bandit chief", "bandit", "apprentice", "innkeeper", "smith", "farmer", "commoner", "miner", "carter", "hunter"]);

/** A talking NPC's place in the realm's roles. */
export function roleOf(p: NpcPersona): Role {
  if (p.minor) return "child";
  if (p.guard) return "guard";
  if (p.faction === "bandits" || factionOf({ persona: p })?.id === "bandits") return p.id === "rook" ? "bandit chief" : "bandit";
  if (/apprentice/i.test(p.role)) return "apprentice";
  if (p.prices.ale !== undefined || /inn/i.test(p.role)) return "innkeeper";
  if (skillLevel(p.skills, "smithing") > 0) return "smith";
  if (/farm|smallholder/i.test(p.role)) return "farmer";
  return "commoner";
}

/**
 * Keep the realm's figures for the talking cast in step: one per NPC (added the
 * first time), with their name, rank, age and death. Faction heads for the file
 * factions come from them (Rook leads his gang; the merchants' head is the most
 * renowned merchant).
 */
export function syncCast(realm: Realm, cast: CastMember[], day: number): void {
  const byNpc = new Map(Object.values(realm.figures).filter((f) => f.talks).map((f) => [f.talks!, f]));
  for (const m of cast) {
    let f = byNpc.get(m.id);
    if (!f) {
      if (m.state.dormant) continue;
      const fac = factionOf({ persona: m.persona });
      f = makeFigure(realm, () => 0.5, { role: roleOf(m.persona), home: fac?.id === "bandits" ? null : HOME_ID, tier: m.state.life.tier as Tier, age: 20, species: m.persona.species ?? "human", gender: m.persona.voice?.gender === "male" ? "male" : "female", name: m.persona.name, renown: m.id === "rook" ? 35 : 18, faction: fac && realm.factions[fac.id] ? fac.id : null }, day);
      f.talks = m.id;
      if (f.faction) realm.factions[f.faction]!.members.push(f.id);
      byNpc.set(m.id, f);
    }
    f.name = m.persona.name;
    // An office the realm gave them (Millbrook's mayor, its guard captain: N15) stays theirs.
    if (CAST_ROLES.has(f.role)) f.role = roleOf(m.persona);
    f.life = structuredClone(m.state.life) as Figure["life"];
    if (m.state.outcome === "dead" && f.alive) killFigure(realm, f, day, m.state.deathCause ?? "unknown");
  }
  const rook = byNpc.get("rook");
  const gang = realm.factions.bandits;
  if (gang && rook?.alive && gang.leader !== rook.id) gang.leader = rook.id;
  const merchants = realm.factions.merchants;
  if (merchants && !(merchants.leader && realm.figures[merchants.leader]?.alive)) {
    const head = merchants.members.map((id) => realm.figures[id]!).filter((f) => f?.alive).sort((a, b) => b.renown - a.renown || a.life.bornOnDay - b.life.bornOnDay)[0];
    merchants.leader = head?.id ?? null;
  }
}

/**
 * What the realm sent Millbrook happens on the map: spawn rules for raiders (at night,
 * on the road) and beasts (at the forest edge), refugees on the west road, and a
 * caravan's grain for whoever sells bread. Each once. Returns lines for the player.
 */
export function applyHomeEvents(realm: Realm, world: WorldSnapshot, cast: CastMember[], creatureKinds: string[]): string[] {
  const lines: string[] = [];
  for (const e of realm.home) {
    if (e.done) continue;
    e.done = true;
    const rules: SpawnRule[] = [];
    if (e.kind === "raid" && creatureKinds.includes("bandit")) {
      rules.push({ id: `realm_raid_${e.day}_${realm.next++}`, creature: "bandit", count: Math.max(1, Math.min(5, e.count)), place: "road_ambush", hours: [20, 4], untilDay: e.day + 1 });
      lines.push(`Raiders from ${e.by} are on the road tonight.`);
    } else if (e.kind === "beasts") {
      const kind = creatureKinds.includes(e.by) ? e.by : "wolf";
      if (creatureKinds.includes(kind)) rules.push({ id: `realm_beasts_${e.day}_${realm.next++}`, creature: kind, count: Math.max(1, Math.min(4, e.count)), place: "forest_edge", hours: [19, 5], untilDay: e.day + 1 });
      lines.push(`${e.by === "wolf" ? "Wolves" : "Beasts"} have been seen at the forest edge.`);
    } else if (e.kind === "refugees" && creatureKinds.includes("villager")) {
      rules.push({ id: `realm_refugees_${e.day}_${realm.next++}`, creature: "villager", count: Math.max(1, Math.min(4, e.count)), place: "west_road", hours: [6, 20], untilDay: e.day + 2 });
      lines.push(`Folk from ${e.by} are coming down the west road with their bundles.`);
    } else if (e.kind === "caravan") {
      const baker = cast.find((m) => m.state.outcome !== "dead" && !m.state.dormant && m.persona.prices["bread loaf"] !== undefined);
      if (baker) {
        const k = itemKey("bread loaf");
        baker.state.inventory[k] = (baker.state.inventory[k] ?? 0) + 4;
        lines.push(`A grain caravan from ${e.by} stopped at ${baker.persona.name}'s.`);
      }
    }
    if (rules.length > 0) (world.extraSpawnRules ??= []).push(...rules);
  }
  realm.home = realm.home.filter((e) => !e.done || world.day - e.day <= 10);
  return lines;
}

/** Who'd want each need dealt with, and the job. */
interface NeedJob {
  giver: (m: CastMember) => boolean;
  quest: (realm: Realm) => { title: string; description: string; objective: QuestDef["objective"]; value: number; tier: Tier };
}

const JOBS: Partial<Record<HomeNeed, NeedJob>> = {
  beasts: {
    giver: (m) => !!m.persona.guard,
    quest: (realm) => {
      const pack = Object.values(realm.packs).find((p) => p.near === HOME_ID);
      const kind = pack?.species === "wolf" || !pack ? "wolf" : "wolf";
      return { title: "Thin out the wolves", description: `The wolves in the woods are breeding (${pack?.count ?? "too many"} of them now) and the flocks won't last. Kill three.`, objective: { type: "defeat", creature: kind, qty: 3 }, value: 300, tier: tierOfAsk("defeat", 0, "F", 3) };
    },
  },
  raiders: {
    giver: (m) => !!m.persona.guard,
    quest: () => ({ title: "Hunt down the raiders", description: "Raiders hit Millbrook and some are still about on the road. Deal with two of them.", objective: { type: "defeat", creature: "bandit", qty: 2 }, value: 360, tier: tierOfAsk("defeat", 0, "E", 2) }),
  },
  walls: {
    giver: (m) => skillLevel(m.persona.skills, "smithing") > 0 && !/apprentice/i.test(m.persona.role),
    quest: () => ({ title: "Iron for the new walls", description: "The village is putting up walls and gates, and every hinge and bar needs iron. Bring six iron ore.", objective: { type: "deliver", item: "iron ore", qty: 6 }, value: ITEMS["iron ore"]!.value * 6, tier: tierOfAsk("deliver", ITEMS["iron ore"]!.value * 6) }),
  },
  dungeon: {
    giver: (m) => !!m.persona.guard,
    quest: (realm) => {
      const d = Object.values(realm.dungeons).find((x) => x.near === HOME_ID)!;
      const tier = ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, ITEM_TIERS.indexOf(d.tier) + (d.depth >= 3 ? 1 : 0))]!;
      return { title: `Clear out ${d.name}`, description: `Things are crawling about down in ${d.name}, and sooner or later they'll come up the road. Go down and clear it, every level.`, objective: { type: "clear", dungeon: d.id, name: d.name, qty: 1 }, value: 150 * (ITEM_TIERS.indexOf(d.tier) + 1) * d.depth, tier };
    },
  },
  food: {
    giver: (m) => m.persona.prices.stew !== undefined || m.persona.prices["bread loaf"] !== undefined,
    quest: () => ({ title: "Something for the pot", description: "Stores are low and folk are hungry. Bring five handfuls of wild herbs to stretch the stew.", objective: { type: "deliver", item: "wild herbs", qty: 5 }, value: ITEMS["wild herbs"]!.value * 5, tier: tierOfAsk("deliver", ITEMS["wild herbs"]!.value * 5) }),
  },
};

/** Days before the same need is posted again. */
export const NEED_COOLDOWN = 6;

/**
 * Millbrook's needs, pushed onto quest boards (N13.8): one realm job per giver at a
 * time, one per need on offer, a cooldown between, and the reward from the giver's
 * purse (half of it at most). Defeat jobs bring their quarry while taken. Returns lines.
 */
export function postNeedQuests(realm: Realm, world: WorldSnapshot, cast: CastMember[]): string[] {
  const lines: string[] = [];
  const open = new Set([...cast.flatMap((m) => m.state.questBoard.map((q) => q.id)), ...world.player.quests.active.map((q) => q.id)]);
  for (const { need, why } of homeNeeds(realm, world.day)) {
    const job = JOBS[need];
    if (!job) continue;
    if ([...open].some((id) => id.startsWith(`rq_${need}_`))) continue;
    const last = realm.stats[`quest_${need}`];
    if (last !== undefined && world.day - last < NEED_COOLDOWN) continue;
    const giver = cast.find((m) => m.state.outcome !== "dead" && !m.state.dormant && !m.persona.minor && job.giver(m) && !m.state.questBoard.some((q) => q.id.startsWith("rq_")));
    if (!giver) continue;
    const q = job.quest(realm);
    if (compareTiers(q.tier, giver.persona.maxQuestTier) > 0) continue;
    const money = Math.min(Math.ceil(q.value * 1.5), Math.floor(giver.state.money / 2));
    if (money <= 0) continue;
    const id = `rq_${need}_${world.day}`;
    giver.state.questBoard.push({ id, title: q.title, description: `${q.description} (${why}.)`, tier: q.tier, minTrust: 0, objective: q.objective, reward: { money }, director: true });
    if (q.objective.type === "defeat") (world.extraSpawnRules ??= []).push({ id: `rq_${id}`, creature: q.objective.creature, count: q.objective.qty, quest: id });
    realm.stats[`quest_${need}`] = world.day;
    tally(realm, "home_quests");
    lines.push(`${giver.persona.name} has work: "${q.title}" (${formatMoney(money)}), because ${why}.`);
  }
  return lines;
}

/** Can this figure's species talk? (Beasts never become talking NPCs.) */
export const canTalk = (f: Figure) => speciesOf(f.species).talks;
