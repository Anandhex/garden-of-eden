import { effectiveGreed } from "./debts.js";
import { remember } from "../npc/memory.js";
import { adjust, fearOf, holdsGrudge, respectOf, setGrudge } from "../npc/relationship.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { recordEvent } from "./events.js";
import { formatMoney } from "./money.js";
import { payDebts } from "./debts.js";
import { isTooHurtToWork } from "./healing.js";
import { provokeLimit } from "../npc/traits.js";
import { attack, type Rng } from "./dice.js";
import { equippedWeapon, soak, wearGear } from "./gear.js";
import { tierDamageBonus } from "./items.js";
import { skillLevel } from "../npc/skills.js";
import { npcSkills, statsOf } from "../npc/state.js";

/**
 * Companions (N8.2): hire an NPC to come with you. They offer when trust or
 * respect is high enough, for a daily wage set in code (offer, then confirm). A
 * companion follows the player between places (game/schedule.ts), fights beside them
 * (their blows are rolled in code), and has **loyalty**: it rises with pay and good
 * treatment, falls when they go unpaid or are put in danger, and traits shape both.
 * Two unpaid days and they walk off; if they fear the player more than they trust
 * them, they turn on them. Their own needs still apply: they eat and sleep.
 */
export interface CompanionState {
  hiredDay: number;
  /** Copper a day. */
  wage: number;
  /** 0..100. Below LEAVE_LOYALTY they go. */
  loyalty: number;
  unpaidDays: number;
  lastPaidDay: number;
}

export const START_LOYALTY = 50;
export const LEAVE_LOYALTY = 15;
/** Days without pay before they walk off. */
export const MAX_UNPAID_DAYS = 2;
export const PAID_LOYALTY = 4;
export const UNPAID_LOYALTY = -15;
export const DANGER_LOYALTY = -6;
/** Trust or respect needed to be offered a hire, unless the NPC file says otherwise. */
export const HIRE_TRUST = 30;

/** Does the player's line sound like asking someone to come along? Gates offer_companionship. */
export function isHireTalk(line: string): boolean {
  return /\b(come with me|join me|travel with|hire you|hire|sell(?:sword)?|bodyguard|escort me|watch my back|companion|follow me|fight (?:with|beside) me)\b/i.test(line);
}

/** The wage this NPC asks a day: their file's wage, more from the greedy who don't trust you. */
export function wageFor(persona: NpcPersona, state: NpcState): number {
  const base = persona.hire?.wage ?? 0;
  const trustShare = Math.max(0, Math.min(100, state.relationship)) / 100;
  return Math.round(base * (1 + 0.5 * effectiveGreed(persona, state) * (1 - trustShare)));
}

export interface HireQuote {
  ok: boolean;
  message: string;
  wage: number;
}

/** Would they come along, and for what? Read-only. */
export function quoteHire(persona: NpcPersona, state: NpcState, world: WorldSnapshot): HireQuote {
  const no = (message: string): HireQuote => ({ ok: false, message, wage: 0 });
  if (!persona.hire) return no(`${persona.name} has a trade to keep; they won't leave it.`);
  if (state.companion) return no(`${persona.name} is already with you.`);
  if (state.outcome || state.inCombat || state.dormant) return no(`${persona.name} is in no state for that.`);
  if (holdsGrudge(state, world.day)) return no(`${persona.name} won't go anywhere with you while they hold a grudge.`);
  if (isTooHurtToWork(persona, state)) return no(`${persona.name} is too badly hurt to come along.`);
  const trustOk = state.relationship >= (persona.hire.minTrust ?? HIRE_TRUST);
  const respectOk = respectOf(state, world.player) >= (persona.hire.minRespect ?? HIRE_TRUST);
  if (!trustOk && !respectOk) return no(`${persona.name} doesn't know you well enough to follow you anywhere.`);
  const wage = wageFor(persona, state);
  return { ok: true, wage, message: `${formatMoney(wage)} a day, paid each midnight` };
}

/** The NPC offers (offer_companionship): the hire waits for the player's yes. */
export function offerHire(persona: NpcPersona, state: NpcState, world: WorldSnapshot): HireQuote {
  const q = quoteHire(persona, state, world);
  if (q.ok) state.pendingHire = { wage: q.wage };
  return q;
}

/** The player accepted: the first day's wage is paid now. */
export function acceptHire(persona: NpcPersona, state: NpcState, world: WorldSnapshot): { ok: boolean; message: string } {
  const offer = state.pendingHire;
  state.pendingHire = null;
  if (!offer) return { ok: false, message: "There's no offer to accept." };
  const q = quoteHire(persona, state, world);
  if (!q.ok) return { ok: false, message: q.message };
  if (world.player.money < offer.wage) return { ok: false, message: `The first day's wage is ${formatMoney(offer.wage)}; you have ${formatMoney(world.player.money)}.` };
  world.player.money -= offer.wage;
  state.money += offer.wage;
  payDebts(persona, state);
  state.companion = { hiredDay: world.day, wage: offer.wage, loyalty: START_LOYALTY, unpaidDays: 0, lastPaidDay: world.day };
  recordEvent(world, { kind: "hired", actor: "player", target: persona.id, details: formatMoney(offer.wage), importance: 4 });
  remember(state, { id: `hired-${world.day}`, day: world.day, text: `they hired you to come with them for ${formatMoney(offer.wage)} a day`, importance: 4, valence: 1 }, traitsOf(persona, state));
  return { ok: true, message: `${persona.name} will come with you for ${formatMoney(offer.wage)} a day. Paid the first day.` };
}

/** Let them go (/dismiss): they head back to their own life, on good terms. */
export function dismiss(persona: NpcPersona, state: NpcState, world: WorldSnapshot): { ok: boolean; message: string } {
  if (!state.companion) return { ok: false, message: `${persona.name} isn't with you.` };
  state.companion = null;
  return { ok: true, message: `${persona.name} heads back to ${persona.role.replace(/^(the|a|an) /, "their place as ")}.` };
}

/**
 * Midnight: wages are due. Paid, loyalty rises (the generous less impressed by coin,
 * the greedy more); unpaid, it falls, and after MAX_UNPAID_DAYS they leave. Low
 * loyalty sends them off too. Returns log lines.
 */
export function payWages(companions: Array<{ id: string; persona: NpcPersona; state: NpcState }>, world: WorldSnapshot): string[] {
  const log: string[] = [];
  const player = world.player;
  for (const c of companions) {
    const comp = c.state.companion;
    if (!comp || c.state.outcome === "dead") continue;
    const greed = effectiveGreed(c.persona, c.state);
    if (player.money >= comp.wage) {
      player.money -= comp.wage;
      c.state.money += comp.wage;
      payDebts(c.persona, c.state);
      comp.unpaidDays = 0;
      comp.lastPaidDay = world.day;
      comp.loyalty = Math.min(100, comp.loyalty + PAID_LOYALTY + Math.round(2 * greed));
      log.push(`You paid ${c.persona.name} ${formatMoney(comp.wage)}.`);
    } else {
      comp.unpaidDays += 1;
      comp.loyalty = Math.max(0, comp.loyalty + UNPAID_LOYALTY - Math.round(10 * greed));
      log.push(`You couldn't pay ${c.persona.name} (${formatMoney(comp.wage)} owed).`);
    }
    if (comp.unpaidDays >= MAX_UNPAID_DAYS || comp.loyalty < LEAVE_LOYALTY) log.push(...leave(c.persona, c.state, world, comp.unpaidDays >= MAX_UNPAID_DAYS ? "unpaid" : "disloyal"));
  }
  return log;
}

/**
 * They leave. If they fear the player more than they trust them, they don't just
 * go: they turn on them (a grudge, and their patience is gone).
 */
export function leave(persona: NpcPersona, state: NpcState, world: WorldSnapshot, why: "unpaid" | "disloyal" | "danger"): string[] {
  state.companion = null;
  const t = traitsOf(persona, state);
  const reason = why === "unpaid" ? "they didn't pay you" : why === "danger" ? "they led you into danger" : "you'd had enough of them";
  remember(state, { id: `left-${world.day}`, day: world.day, text: `you left their service: ${reason}`, importance: 6, valence: -1 }, t);
  adjust(state, "trust", why === "unpaid" ? -15 : -5);
  recordEvent(world, { kind: "companion-left", actor: persona.id, target: "player", details: why, importance: 5, witnesses: [] });
  if (fearOf(state, world.player) > Math.max(0, state.relationship)) {
    setGrudge(state, t, reason, world.day);
    state.mood = "angry";
    state.provocations = provokeLimit(t);
    return [`${persona.name} walks off, and turns on you: ${reason}.`];
  }
  return [`${persona.name} walks off: ${reason}.`];
}

/** A fight put them in danger (hurt below half): loyalty falls, less for the brave. */
export function endangered(persona: NpcPersona, state: NpcState, world: WorldSnapshot): string[] {
  const comp = state.companion;
  if (!comp) return [];
  comp.loyalty = Math.max(0, comp.loyalty + Math.round(DANGER_LOYALTY * (1.5 - traitsOf(persona, state).bravery)));
  return comp.loyalty < LEAVE_LOYALTY ? leave(persona, state, world, "danger") : [];
}

/** Good treatment (a gift, a quest done together): loyalty rises. */
export function treatWell(state: NpcState, amount = 5): void {
  if (state.companion) state.companion.loyalty = Math.min(100, state.companion.loyalty + amount);
}

/** For the companion's situation: "You're travelling with them as a hired companion (loyalty: steady)." */
export function describeCompanion(state: NpcState, playerName: string): string | null {
  const c = state.companion;
  if (!c) return null;
  const word = c.loyalty >= 75 ? "devoted" : c.loyalty >= 45 ? "steady" : c.loyalty >= 25 ? "wavering" : "close to leaving";
  const unpaid = c.unpaidDays > 0 ? ` ${playerName} owes you ${c.unpaidDays} day${c.unpaidDays > 1 ? "s'" : "'s"} wages.` : "";
  return `You're travelling with ${playerName} as a hired companion; your loyalty is ${word}.${unpaid}`;
}

/** What a companion can hit: an NPC's state or a creature, through accessors. */
export interface Foe {
  name: string;
  hp: () => number;
  setHp: (hp: number) => void;
  agility: number;
  evasion: number;
  holder: { equipment?: { weapon?: string; armor?: string } };
  /** Townsfolk aren't killed by a companion: they hold back at 1 HP and leave it to the player. */
  spare: boolean;
}

/**
 * Companions fight beside the player (N8.2): each one at the player's side strikes the
 * foe once a round, rolled in code with their own stats and gear. Returns lines.
 */
export function companionsStrike(companions: Array<{ persona: NpcPersona; state: NpcState }>, foe: Foe, rng: Rng): string[] {
  const log: string[] = [];
  for (const c of companions) {
    if (!c.state.companion || c.state.outcome || foe.hp() <= 0) continue;
    const stats = statsOf(c.persona, c.state);
    const weapon = equippedWeapon(c.state);
    const hit = attack(rng, { strength: stats.attributes.strength, weaponSkill: skillLevel(npcSkills(c.persona, c.state), weapon.skill) }, { agility: foe.agility, evasion: foe.evasion }, weapon.die, tierDamageBonus(weapon.tier));
    if (!hit.success) {
      log.push(`${c.persona.name} swings at ${foe.name} and misses.`);
      continue;
    }
    const damage = soak(hit.damage, foe.holder);
    const floor = foe.spare ? 1 : 0;
    foe.setHp(Math.max(floor, foe.hp() - damage));
    wearGear(c.state, "weapon");
    log.push(`${c.persona.name} hits ${foe.name} for ${damage}.`);
  }
  return log;
}
