import { absoluteMinute, formatMinute } from "../game/clock.js";
import { LATE_DISCOUNT, openCommitments } from "../game/commitments.js";
import { callInFavour, CALL_IN_AFTER_DAYS } from "../game/favours.js";
import { townEventsOn } from "../game/events-calendar.js";
import { formatMoney } from "../game/money.js";
import { describeObjective, questProgress } from "../game/quests.js";
import { PLACE_NAMES, placeOf } from "../game/schedule.js";
import { fearOf, holdsGrudge } from "./relationship.js";
import { bountyOf, describeWanted, isGuard } from "../game/crime.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "./types.js";

/**
 * NPCs who start things (N6.3). Triggers in code decide when an NPC speaks first:
 * an apology they owe, a promise due, a grudge or fear on sight, a favour to call
 * in, a job they gave you, news, a need, or a first greeting. The model writes only
 * the one opening line, from a short event line. A cooldown per trigger stops
 * nagging, and the caller lets at most one NPC per scene speak first (pickOpener).
 */
export const TRIGGERS = ["crime", "apology", "confront", "promise_due", "grudge", "fear", "favour", "quest_followup", "news", "need", "greeting"] as const;
export type InitiativeTrigger = (typeof TRIGGERS)[number];

export const PRIORITY: Record<InitiativeTrigger, number> = {
  crime: 95,
  apology: 90,
  confront: 85,
  promise_due: 80,
  grudge: 70,
  fear: 65,
  favour: 60,
  quest_followup: 50,
  news: 40,
  need: 30,
  greeting: 10,
};

/** Game minutes before the same trigger can fire again. Some fire once ever (their key says what for). */
export const COOLDOWN_MINUTES = 12 * 60;

export interface Opening {
  trigger: InitiativeTrigger;
  /** Cooldown key: the trigger, or "trigger:thing" for once-only openings. */
  key: string;
  /** Fires at most once ever (keyed by the thing), not on a cooldown. */
  once?: boolean;
  priority: number;
  /** What the NPC is told, ending with what to say. */
  event: string;
}

function ready(state: NpcState, key: string, now: number, once = false): boolean {
  const last = state.initiative[key];
  if (last === undefined) return true;
  return !once && now - last >= COOLDOWN_MINUTES;
}

/**
 * Every opening this NPC has right now, best first. Read-only: firing one
 * (fireOpening) records the cooldown and does any side effect (calling in a favour).
 */
export function openingsFor(persona: NpcPersona, state: NpcState, world: WorldSnapshot): Opening[] {
  if (state.outcome || state.inCombat) return [];
  const now = absoluteMinute(world);
  const player = world.player;
  const out: Opening[] = [];
  const add = (o: Omit<Opening, "priority">) => {
    if (ready(state, o.key, now, o.once)) out.push({ ...o, priority: PRIORITY[o.trigger] });
  };

  // A guard who knows the player is wanted brings it up first (N7).
  if (isGuard(persona) && bountyOf(player) > 0) {
    add({ trigger: "crime", key: `crime:${bountyOf(player)}`, once: true, event: `${describeWanted(persona, player)} Tell them so, now.` });
  }
  // A revenge goal acted on as a confrontation (director/revenge.ts): they have it out with the player.
  const revenge = state.goals.find((g) => g.kind === "revenge" && g.plan === "confront" && g.acted !== undefined);
  if (revenge) {
    add({ trigger: "confront", key: `confront:${revenge.acted}`, once: true, event: `${player.name} is here, and you've been brooding on what they did (${revenge.reason}). Confront them about it, angrily.` });
  }
  const order = state.commission;
  if (order?.status === "ready" && order.late) {
    add({ trigger: "apology", key: `apology:${order.commitment}`, once: true, event: `You finished their ${order.item} late. Apologise before they say anything, and tell them you'll take ${LATE_DISCOUNT}% off.` });
  }
  const loan = openCommitments(player.commitments, persona.id).find((c) => c.kind === "repay_loan" && c.due - now <= 24 * 60);
  if (loan) {
    add({ trigger: "promise_due", key: "promise_due", event: `${player.name} owes you ${formatMoney(loan.amount ?? 0)}, ${loan.due < now ? "and it's overdue" : `due by ${formatMinute(loan.due, world.day)}`}. Remind them.` });
  }
  if (holdsGrudge(state, world.day)) {
    add({ trigger: "grudge", key: "grudge", event: `${player.name} just showed up, and you hold a grudge: ${state.grudge!.reason}. Let them know you haven't forgotten.` });
  } else if (fearOf(state, player) >= 50) {
    add({ trigger: "fear", key: "fear", event: `${player.name} just showed up, and they frighten you. Say something nervous.` });
  }
  if (state.owedFavours.some((f) => !f.quest && world.day - f.day >= CALL_IN_AFTER_DAYS)) {
    add({ trigger: "favour", key: "favour", event: "favour" }); // the job is made when it fires (fireOpening)
  }
  const mine = player.quests.active.filter((q) => q.giverId === persona.id && (q.acceptedDay ?? world.day) < world.day);
  if (mine.length > 0) {
    const q = mine[0]!;
    const done = questProgress(player, q).done;
    add({
      trigger: "quest_followup",
      key: `quest_followup:${q.id}`,
      event: done
        ? `${player.name} seems to have what you asked for ("${q.title}"). Ask them to hand it over.`
        : `${player.name} took your job "${q.title}" (${describeObjective(q)}) on an earlier day. Ask how it's going, in a few words.`,
    });
  }
  const warned = (player.warnedBy ?? []).includes(persona.name) && world.lastRaidDay !== undefined && world.day - world.lastRaidDay <= 1;
  if (warned) {
    add({ trigger: "news", key: `news:raid:${world.lastRaidDay}`, once: true, event: `You promised to warn ${player.name} of danger: bandits raided the village. Warn them to keep off the mine road.` });
  } else if (state.metBefore && townEventsOn(world).length > 0) {
    const what = townEventsOn(world)[0] === "market" ? "it's market day" : townEventsOn(world)[0] === "festival" ? "it's the midsummer festival tonight" : "there was a bandit raid";
    add({ trigger: "news", key: `news:${world.day}`, once: true, event: `You have news for ${player.name}: ${what}. Mention it.` });
  }
  const need = state.questBoard.find((q) => !q.favour && !player.quests.active.some((a) => a.id === q.id) && state.relationship >= q.minTrust);
  if (need && state.metBefore) {
    add({ trigger: "need", key: "need", event: `You're short of ${need.objective.type === "deliver" ? need.objective.item : "help"} for your work. Mention you'd pay for help.` });
  }
  if (!state.metBefore) {
    const place = placeOf(persona, state, world);
    add({
      trigger: "greeting",
      key: "greeting",
      once: true,
      event: `A stranger just walked into ${place && place !== "home" ? PLACE_NAMES[place] : "your place"}. Greet them, in your own way.`,
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** The best opening this NPC has, or null. */
export function initiativeFor(persona: NpcPersona, state: NpcState, world: WorldSnapshot): Opening | null {
  return openingsFor(persona, state, world)[0] ?? null;
}

/**
 * Fire an opening: record the cooldown and do its side effect. Returns the event
 * line for the model (calling in a favour makes the job first, so the line names it).
 */
export function fireOpening(persona: NpcPersona, state: NpcState, world: WorldSnapshot, opening: Opening): string {
  state.initiative[opening.key] = absoluteMinute(world);
  if (opening.trigger === "favour") {
    const job = callInFavour(persona, state, world.day);
    if (!job || job.objective.type !== "deliver") return `${world.player.name} owes you a favour. Remind them.`;
    return `${world.player.name} owes you a favour, and you're calling it in: you want ${job.objective.qty} ${job.objective.item}. Ask them for it. (It's on your job board as "${job.title}".)`;
  }
  return opening.event;
}

/** Of several NPCs in a scene, the one who speaks first (highest priority), if any. */
export function pickOpener<T extends { opening: Opening | null }>(candidates: T[]): T | null {
  return candidates.filter((c) => c.opening).sort((a, b) => b.opening!.priority - a.opening!.priority)[0] ?? null;
}
