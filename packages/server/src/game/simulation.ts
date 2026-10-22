import { npcPrice } from "../npc/actions.js";
import { baselineMood, fadeEmotions, MOOD_HOURS } from "../npc/emotions.js";
import { adjust, FEAR_FADE_PER_DAY } from "../npc/relationship.js";
import { heldBack, rollWorkDay, applyMasterwork } from "./signature.js";
import { grudgeFadePerDay, traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { absoluteHour, absoluteMinute, advanceMinutes, formatMinute } from "./clock.js";
import { checkPlayerPromises } from "./commitments.js";
import { canStartCommission, commissionMade } from "./commissions.js";
import { exposeLies } from "./deception.js";
import { saleChanceFactor } from "./events-calendar.js";
import { tickNeeds } from "./needs.js";
import { blockAt, planHour, scheduleOf } from "./schedule.js";
import { isCold } from "./weather.js";
import { mendEquipment } from "./gear.js";
import { skillLevel } from "../npc/skills.js";
import { finishCraft, fitsCraft, hasInputs, startCraft, tradeRecipes } from "./crafting.js";
import { payDebts } from "./debts.js";
import type { Rng } from "./dice.js";
import { npcSelfHeal, regenNpc } from "./healing.js";
import { ITEM_TIERS, itemLabel, parseItem } from "./items.js";
import { newDay, XP } from "./life.js";
import { refreshNeedQuests } from "./quests.js";
import { lifeContext, npcGainXp, npcOvercome, npcSlots, statsOf } from "../npc/state.js";
import { canWorkIll, FORGE_ACCIDENT_CHANCE, healOvernight, illnessDrain, injure, maybeFallIll, ILLNESSES } from "./health.js";
import { addSkillXp, growthEvent, skillTrial } from "../npc/growth.js";
import { RECIPES } from "./crafting.js";
import { ITEMS } from "./items.js";
import { pickDemanded } from "./economy.js";
import { isDebtFree } from "./debts.js";
import { fadeRevenge, wantRevenge } from "../director/revenge.js";
import { remember } from "../npc/memory.js";
import { setGrudge } from "../npc/relationship.js";
import { addEmotion } from "../npc/emotions.js";
import { chosenPlan } from "./choice/memory.js";

/**
 * Time passing for an NPC. Each hour they follow their schedule (game/schedule.ts),
 * and their needs tick. In a work hour, an idle NPC may start making something they
 * have the materials for (a commission first), and is busy until it's done, or sell
 * a piece of stock to villagers. Everything is rolled in code.
 */
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
  if (state.outcome === "dead" || state.dormant) {
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
    if (done) {
      log.push(`${persona.name} finished ${done.doing.replace(/^\w+ing /, "")}: ${done.qty} ${itemLabel(done.output)}.`);
      if (done.forCommission) {
        const made = commissionMade(persona, state, done.output, world);
        if (made) log.push(made);
      }
      const tier = parseItem(done.output)?.tier ?? "G";
      const ready = npcGainXp(persona, state, XP.craftPerTier * (ITEM_TIERS.indexOf(tier) + 1));
      if (ready) log.push(ready);
      // A piece at their own rank or better is a challenge overcome.
      log.push(...npcOvercome(persona, state, { kind: "craft", rank: tier, what: `making a ${itemLabel(done.output)}` }, world.day));
      // Growth (N9): practice at the skill; a piece above the usual tier is the trial; and file challenges.
      const recipe = RECIPES.find((r) => r.id === done.recipeId);
      if (recipe) {
        const ready = addSkillXp(persona, state, recipe.skill, 5);
        if (ready) log.push(ready);
        const fine = ITEM_TIERS.indexOf(tier) > ITEM_TIERS.indexOf(ITEMS[recipe.output]!.tier);
        const rose = skillTrial(persona, state, recipe.skill, fine, world.day);
        if (rose) log.push(rose);
      }
      log.push(...growthEvent(persona, state, { kind: "craft", tier }, world.day));
    }
    if ((world.minute ?? 0) === 0) log.push(...hourTick(persona, state, world, rng, talking));
    if ((state.outcome as NpcState["outcome"]) === "dead") {
      advanceMinutes(world, left); // died of old age: the clock still runs, but nothing more happens to them
      break;
    }
  }
  return log;
}

/**
 * Midnight: the NPC is a day older, gains a day's XP, and past elder age may die
 * in their sleep (game/life.ts). Returns lines for the log.
 */
export function npcNewDay(persona: NpcPersona, state: NpcState, day: number, rng: Rng): string[] {
  if (state.outcome === "dead") return [];
  const { log, died } = newDay(persona.name, state.life, lifeContext(persona), day, rng);
  if (died) {
    state.outcome = "dead";
    state.deathCause = "old age";
    state.conversationOver = true;
    state.inCombat = false;
    state.job = null;
    return log;
  }
  // Getting older can lower max HP.
  state.hp = Math.min(state.hp, statsOf(persona, state).maxHp);
  // Feelings and fear fade overnight; bad feelings at the NPC's forgiveness. So does revenge.
  fadeEmotions(state, traitsOf(persona, state));
  adjust(state, "fear", -FEAR_FADE_PER_DAY);
  fadeRevenge(persona, state);
  // Injuries and illness heal a day at a time (N8.1); and a night is when fevers start.
  for (const healed of healOvernight(state)) log.push(`${persona.name} is over ${healed}.`);
  if (rng !== undefined) {
    const ill = maybeFallIll(state, day, rng);
    if (ill) log.push(`${persona.name} has come down with ${ILLNESSES[ill].name}.`);
  }
  // A smith mends their own gear overnight.
  if (skillLevel(persona.skills, "smithing") > 0) {
    const mended = mendEquipment(state);
    if (mended.length > 0) log.push(`${persona.name} mended their ${mended.map(itemLabel).join(" and ")}.`);
  }
  return log;
}

/** What happens to the NPC on the hour. */
function hourTick(persona: NpcPersona, state: NpcState, world: WorldSnapshot, rng: Rng, talking: boolean): string[] {
  const log: string[] = [];
  // Knocked out (/subdue): they come round, sore, and know who did it.
  if (state.outcome === "unconscious") {
    if (state.unconsciousUntil !== null && absoluteMinute(world) < state.unconsciousUntil) return log;
    state.outcome = null;
    state.unconsciousUntil = null;
    state.conversationOver = false;
    state.hp = Math.max(1, state.hp);
    const t = traitsOf(persona, state);
    setGrudge(state, t, "they beat you senseless", world.day);
    addEmotion(state, "resentment", 0.6, "being beaten senseless", world.day, true);
    wantRevenge(persona, state, "attacked", "they beat you senseless", world.day);
    remember(state, { id: `woke-${world.day}`, day: world.day, text: "you came round after they knocked you out", importance: 6, valence: -1 }, t);
    log.push(`${persona.name} comes round, aching.`);
  }
  if (world.hour === 0) {
    log.push(...npcNewDay(persona, state, world.day, rng));
    if (state.outcome === "dead") return log;
    // Lies may come out, and the player's overdue promises are broken.
    log.push(...exposeLies(persona, state, world, rng));
    log.push(...checkPlayerPromises(persona, state, world.player, world));
  }
  // This hour's plan: the schedule, unless a need, the weather or a festival says otherwise.
  // (N38: a talker's own pick for this hour, when it is not the schedule's, is followed instead.)
  const chosen = chosenPlan(state, absoluteHour(world));
  const plan = state.inCombat && state.activity ? state.activity : chosen ? { activity: chosen.activity, place: chosen.place, why: chosen.why } : planHour(persona, state, world);
  state.activity = { activity: plan.activity, place: plan.place, ...(plan.why ? { why: plan.why } : {}), at: absoluteHour(world) };
  tickNeeds(state.needs, plan.activity, { cold: isCold(world.day), drain: illnessDrain(state) });
  regenNpc(persona, state, plan.activity === "sleep");
  const used = state.inCombat ? null : npcSelfHeal(persona, state);
  if (used?.ok) log.push(`${persona.name} treated their wounds. ${used.message}`);
  // Grudges fade a little each night: forgiving NPCs get over a bad start faster.
  if (world.hour === 0 && state.relationship < 0) {
    state.relationship = Math.min(0, state.relationship + grudgeFadePerDay(traitsOf(persona, state)));
  }
  // Away from the player, a mood drifts back to the baseline (feelings, then needs) after a few hours.
  const now = absoluteMinute(world);
  if (!talking && !state.inCombat) {
    const settled = baselineMood(state);
    if (settled === state.mood) state.moodHours = 0;
    else if (++state.moodHours >= MOOD_HOURS) {
      state.mood = settled;
      state.moodHours = 0;
      state.provocations = 0;
    }
  }

  // Paid off the last debt: a challenge met (an innkeeper's, N9).
  if ((persona.debts ?? []).length > 0 && state.triggerDay["debt_cleared"] === undefined && isDebtFree(persona, state)) {
    state.triggerDay["debt_cleared"] = world.day;
    log.push(...growthEvent(persona, state, { kind: "debt_cleared" }, world.day));
  }
  if (plan.activity !== "work") return log;
  // Ill: some hours they just can't work (N8.1).
  if (!canWorkIll(state, rng)) return log;
  // A slip at the forge: a burned hand (N8.1).
  if (plan.place === "forge" && skillLevel(persona.skills, "smithing") > 0 && !talking && rng() < FORGE_ACCIDENT_CHANCE && injure(state, "burned_hand", world.day)) {
    log.push(`${persona.name} burned a hand at the forge.`);
  }
  // The first hour of a working day: is it a good one? (game/signature.ts)
  if (world.hour === blockAt(scheduleOf(persona), world.hour).from) {
    const good = rollWorkDay(persona, state, world.day, statsOf(persona, state).attributes.luck, rng);
    if (good) log.push(good);
  }
  if (talking || state.job) return log; // with the player, or still busy
  const selling = !!chosen?.sell;

  // A commission comes before anything else they might make.
  const ordered = selling ? null : canStartCommission(persona, state);
  if (ordered) {
    // An order gets the best materials they have (N10).
    const job = startCraft(persona, state, ordered, now, rng, { best: true });
    job.forCommission = true;
    state.commission!.status = "making";
    const special = applyMasterwork(persona, state, job, world.day);
    if (special) log.push(special);
    log.push(`${persona.name} started ${job.doing} for you (until ${formatMinute(job.until, world.day)}).`);
    return log;
  }

  // Only what they have the materials for, and room to keep.
  const options = selling ? [] : tradeRecipes(persona).filter((r) => hasInputs(state.inventory, r) && fitsCraft(state.inventory, npcSlots(persona, state), r));
  if (options.length > 0 && rng() < CRAFT_CHANCE) {
    const recipe = options[Math.floor(rng() * options.length)]!;
    const job = startCraft(persona, state, recipe, now, rng);
    const special = applyMasterwork(persona, state, job, world.day);
    if (special) log.push(special);
    log.push(`${persona.name} started ${job.doing} (until ${formatMinute(job.until, world.day)}).`);
    return log;
  }

  // Villagers don't come to the bandit camp to shop.
  if (plan.place === "camp") return log;
  if (rng() < (selling ? 0.9 : VILLAGE_SALE_CHANCE * saleChanceFactor(world))) {
    const stock = Object.keys(state.inventory).filter(
      (k) => (state.inventory[k] ?? 0) > 0 && npcPrice(persona, k) !== undefined && !heldBack(persona, { relationship: -100, metBefore: false }, k),
    );
    if (stock.length > 0) {
      // What villagers want most goes first (N10).
      const item = pickDemanded(stock, rng)!;
      const price = npcPrice(persona, item, world, state)!;
      state.inventory[item] = (state.inventory[item] ?? 0) - 1;
      if (state.inventory[item] === 0) delete state.inventory[item];
      state.money += price;
      payDebts(persona, state);
      log.push(`${persona.name} sold a ${itemLabel(item)} to a villager.`);
      log.push(...growthEvent(persona, state, { kind: "sell" }, world.day));
      const ready = npcGainXp(persona, state, XP.villageSale);
      if (ready) log.push(ready);
    }
  }
  return log;
}
