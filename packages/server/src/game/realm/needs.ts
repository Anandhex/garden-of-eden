import { tierOfAsk } from "../../director/validator.js";
import { skillLevel } from "../../npc/skills.js";
import type { QuestDef, WorldSnapshot } from "../../npc/types.js";
import { ITEMS, ITEM_TIERS } from "../items.js";
import { compareTiers } from "../levels.js";
import type { Tier } from "../life.js";
import { formatMoney } from "../money.js";
import { siteState, type SiteWorld } from "../site.js";
import { needsOf, type Need } from "./director.js";
import { tally } from "./log.js";
import type { Talking } from "./arrivals.js";
import type { Realm } from "./types.js";

/**
 * A place's needs become work (N13.8, N25a decision 8): quests on the boards of the talkers who'd want them done,
 * with the reward from their own purse (like director quests, N12.4). It is the same for every place: the head,
 * the guard, the smith or the innkeeper of whichever place the player is in.
 */

const HEAD_ROLES = /\b(mayor|head|elder|lord|lady|king|queen|ruler)\b/i;

/** The head of a place speaks for it. */
export const isHead = (m: Talking) => HEAD_ROLES.test(m.persona.role);

/** Who'd want each need dealt with, and the job. */
interface NeedJob {
  giver: (m: Talking) => boolean;
  quest: (realm: Realm, site: string) => { title: string; description: string; objective: QuestDef["objective"]; value: number; tier: Tier };
}

const places = (realm: Realm, site: string) => realm.settlements[site]?.name ?? "the village";

const JOBS: Record<Need, NeedJob> = {
  beasts: {
    giver: (m) => isHead(m) || !!m.persona.guard,
    quest: (realm, site) => {
      const pack = Object.values(realm.packs).find((p) => p.near === site);
      const species = pack?.species ?? "wolf";
      return { title: `Thin out the ${species === "wolf" ? "wolves" : `${species}s`}`, description: `The ${species === "wolf" ? "wolves" : `${species}s`} in the woods around ${places(realm, site)} are a danger to the flocks (${pack?.count ?? "too many"} of them now). Kill three.`, objective: { type: "defeat", creature: species, qty: 3 }, value: 300, tier: tierOfAsk("defeat", 0, pack?.tier ?? "F", 3) };
    },
  },
  raiders: {
    giver: (m) => isHead(m) || !!m.persona.guard,
    quest: (realm, site) => ({ title: "Hunt down the raiders", description: `Raiders hit ${places(realm, site)} and some are still about on the road. Deal with two of them.`, objective: { type: "defeat", creature: "bandit", qty: 2 }, value: 360, tier: tierOfAsk("defeat", 0, "E", 2) }),
  },
  walls: {
    giver: (m) => skillLevel(m.persona.skills, "smithing") > 0 && !/apprentice/i.test(m.persona.role),
    quest: (realm, site) => ({ title: "Iron for the new walls", description: `${places(realm, site)} is putting up walls and gates, and every hinge and bar needs iron. Bring six iron ore.`, objective: { type: "deliver", item: "iron ore", qty: 6 }, value: ITEMS["iron ore"]!.value * 6, tier: tierOfAsk("deliver", ITEMS["iron ore"]!.value * 6) }),
  },
  dungeon: {
    giver: (m) => isHead(m) || !!m.persona.guard,
    quest: (realm, site) => {
      const d = Object.values(realm.dungeons).find((x) => x.near === site)!;
      const tier = ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, ITEM_TIERS.indexOf(d.tier) + (d.depth >= 3 ? 1 : 0))]!;
      return { title: `Clear out ${d.name}`, description: `Things are crawling about down in ${d.name}, and sooner or later they'll come up the road. Go down and clear it, every level.`, objective: { type: "clear", dungeon: d.id, name: d.name, qty: 1 }, value: 150 * (ITEM_TIERS.indexOf(d.tier) + 1) * d.depth, tier };
    },
  },
  food: {
    giver: (m) => m.persona.prices.stew !== undefined || m.persona.prices["bread loaf"] !== undefined,
    quest: () => ({ title: "Something for the pot", description: "Stores are low and folk are hungry. Bring five handfuls of wild herbs to stretch the stew.", objective: { type: "deliver", item: "wild herbs", qty: 5 }, value: ITEMS["wild herbs"]!.value * 5, tier: tierOfAsk("deliver", ITEMS["wild herbs"]!.value * 5) }),
  },
};

/** Days before the same need is posted again at a place. */
export const NEED_COOLDOWN = 6;

/**
 * A place's needs, pushed onto the boards of its talkers: one realm job per giver at a time, one per need on
 * offer, a cooldown between, and the reward from the giver's purse (half of it at most). Defeat jobs bring their
 * quarry while taken. A head who is the giver can post a job above their usual rank: it is theirs to name.
 * Returns lines.
 */
export function postNeedQuests(realm: Realm, world: WorldSnapshot & SiteWorld, site: string, folk: Talking[], opts: { opening?: boolean } = {}): string[] {
  const lines: string[] = [];
  const state = siteState(world, site);
  const open = new Set([...folk.flatMap((m) => m.state.questBoard.map((q) => q.id)), ...world.player.quests.active.map((q) => q.id)]);
  for (const { need, why } of needsOf(realm, site, world.day, opts)) {
    const job = JOBS[need];
    if ([...open].some((id) => id.startsWith(`rq_${need}_`))) continue;
    const last = state.needCooldowns[need];
    if (last !== undefined && world.day - last < NEED_COOLDOWN) continue;
    const giver = folk
      .filter((m) => m.state.outcome !== "dead" && !m.state.dormant && !m.persona.minor && job.giver(m) && !m.state.questBoard.some((q) => q.id.startsWith("rq_")))
      .sort((a, b) => Number(isHead(b)) - Number(isHead(a)))[0];
    if (!giver) continue;
    const q = job.quest(realm, site);
    if (compareTiers(q.tier, giver.persona.maxQuestTier) > 0) {
      if (!isHead(giver)) continue;
      giver.persona.maxQuestTier = q.tier;
    }
    const money = Math.min(Math.ceil(q.value * 1.5), Math.floor(giver.state.money / 2));
    if (money <= 0) continue;
    const id = `rq_${need}_${world.day}`;
    giver.state.questBoard.push({ id, title: q.title, description: `${q.description} (${why}.)`, tier: q.tier, minTrust: 0, objective: q.objective, reward: { money }, director: true });
    if (q.objective.type === "defeat") state.rules.push({ id: `rq_${id}`, creature: q.objective.creature, count: q.objective.qty, quest: id, place: q.objective.creature === "bandit" ? "gate_road" : "deep_woods" });
    state.needCooldowns[need] = world.day;
    tally(realm, "home_quests");
    lines.push(`${giver.persona.name} has work: "${q.title}" (${formatMoney(money)}), because ${why}.`);
  }
  return lines;
}
