import { absoluteMinute, formatMinute } from "./clock.js";
import { recordEvent } from "./events.js";
import { note } from "./journal.js";
import { formatMoney } from "./money.js";
import { addEmotion } from "../npc/emotions.js";
import { remember } from "../npc/memory.js";
import { adjust } from "../npc/relationship.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";

/**
 * Promises and commitments (N5.5). Created by game actions only (a commission is due,
 * a loan must be repaid, a favour is owed), never by parsing the model's words.
 * Keeping one raises trust and respect; breaking one costs trust, and the NPC
 * remembers. NPC promises live in the NPC's state; the player's in theirs.
 * Each one is settled exactly once (status leaves "open").
 */
export type CommitmentKind = "commission" | "repay_loan";

export interface Commitment {
  id: string;
  kind: CommitmentKind;
  /** What was promised, in words: "an iron sword", "3 gold". */
  what: string;
  /** Absolute game minute it's due by. */
  due: number;
  /** Who owes it: "player" or an NPC id. */
  owner: string;
  /** Who it's owed to. */
  toWhom: string;
  /** Money involved (a loan), in copper. */
  amount?: number;
  status: "open" | "kept" | "broken";
  /** Set when an NPC's promise was settled late (they owe an apology: npc/initiative.ts). */
  late?: boolean;
}

/** Hours before the due time that a promise counts as "due soon" (a situation line). */
export const DUE_SOON_HOURS = 6;
/** Trust and respect for a kept promise; trust lost for a broken one. */
export const KEPT = { trust: 5, respect: 3 } as const;
export const BROKEN_TRUST = 15;
/** Discount (percent) an NPC gives when their own promise ran late. */
export const LATE_DISCOUNT = 20;

let counter = 0;

/** Make a promise. Returns it. */
export function promise(list: Commitment[], c: Omit<Commitment, "id" | "status">): Commitment {
  const full: Commitment = { ...c, id: `${c.kind}-${c.owner}-${++counter}-${c.due}`, status: "open" };
  list.push(full);
  return full;
}

/** Open promises in a list (optionally only those to someone). */
export function openCommitments(list: Commitment[] | undefined, toWhom?: string): Commitment[] {
  return (list ?? []).filter((c) => c.status === "open" && (!toWhom || c.toWhom === toWhom));
}

/**
 * The player kept (or broke, if late) a promise to an NPC: settle it once, with its
 * effect on that NPC. Returns a line for the player.
 */
export function settlePlayerPromise(persona: NpcPersona, state: NpcState, c: Commitment, world: WorldSnapshot): string {
  if (c.status !== "open") return "";
  const now = absoluteMinute(world);
  const onTime = now <= c.due;
  c.status = onTime ? "kept" : "broken";
  if (onTime) {
    adjust(state, "trust", KEPT.trust);
    adjust(state, "respect", KEPT.respect);
    remember(state, { id: `kept-${c.id}`, day: world.day, text: `they kept their word: ${c.what}, on time`, importance: 4, valence: 1 }, traitsOf(persona, state));
  } else {
    adjust(state, "trust", -Math.round(BROKEN_TRUST / 2)); // late is better than never
  }
  recordEvent(world, { kind: onTime ? "promise-kept" : "promise-broken", actor: "player", target: persona.id, details: c.what, importance: onTime ? 4 : 5 });
  note(world.player, { id: `promise:${c.id}`, day: world.day, npc: persona.id, kind: "promise", text: `You ${onTime ? "kept" : "were late with"} your promise to ${persona.name}: ${c.what}.` });
  return onTime ? `You kept your word to ${persona.name}.` : `You were late, but ${persona.name} has it now.`;
}

/**
 * Time has passed: the player's promises to this NPC that are now overdue are broken.
 * Effects apply once. Returns lines for the log.
 */
export function checkPlayerPromises(persona: NpcPersona, state: NpcState, player: PlayerState, world: Pick<WorldSnapshot, "day" | "hour" | "minute" | "location" | "events">): string[] {
  const log: string[] = [];
  const now = absoluteMinute(world);
  for (const c of openCommitments(player.commitments, persona.id)) {
    if (now <= c.due) continue;
    c.status = "broken";
    adjust(state, "trust", -BROKEN_TRUST);
    adjust(state, "respect", -5);
    remember(state, { id: `broken-${c.id}`, day: world.day, text: `they broke their word: ${c.what} was due and never came`, importance: 7, valence: -1 }, traitsOf(persona, state));
    addEmotion(state, "resentment", 0.5, `them breaking their word (${c.what})`, world.day, true);
    recordEvent(world, { kind: "promise-broken", actor: "player", target: persona.id, details: c.what, importance: 7 });
    note(player, { id: `promise:${c.id}`, day: world.day, npc: persona.id, kind: "promise", text: `You broke your promise to ${persona.name}: ${c.what}.` });
    log.push(`You missed the deadline for ${persona.name}: ${c.what}. They won't forget it.`);
  }
  return log;
}

/**
 * The NPC finished something they promised. On time: a little trust. Late: it's
 * marked late, trust dips, and they owe the player an apology and a discount.
 */
export function settleNpcPromise(persona: NpcPersona, state: NpcState, c: Commitment, world: Pick<WorldSnapshot, "day" | "hour" | "minute" | "location" | "events">): void {
  if (c.status !== "open") return;
  const late = absoluteMinute(world) > c.due;
  c.status = late ? "broken" : "kept";
  if (late) {
    c.late = true;
    adjust(state, "trust", -2);
    addEmotion(state, "embarrassment", 0.4, `being late with ${c.what}`, world.day, true);
  }
  recordEvent(world, { kind: late ? "promise-broken" : "promise-kept", actor: persona.id, target: c.toWhom, details: c.what, importance: late ? 4 : 2 });
}

/** The situation line for promises due soon or overdue between the NPC and the player. Null if none. */
export function describeDue(persona: NpcPersona, state: NpcState, player: PlayerState, world: Pick<WorldSnapshot, "day" | "hour" | "minute">): string | null {
  const now = absoluteMinute(world);
  const soon = (c: Commitment) => c.due - now <= DUE_SOON_HOURS * 60;
  const when = (c: Commitment) => (c.due < now ? "and it's overdue" : `by ${formatMinute(c.due, world.day)}`);
  // Commissions have their own line (game/commissions.ts).
  const mine = openCommitments(state.commitments, "player").filter((c) => c.kind !== "commission" && soon(c))[0];
  if (mine) return `You promised them ${mine.what} ${when(mine)}.`;
  const theirs = openCommitments(player.commitments, persona.id).filter(soon)[0];
  if (theirs) return `They promised you ${theirs.what}${theirs.amount ? ` (${formatMoney(theirs.amount)})` : ""} ${when(theirs)}.`;
  return null;
}
