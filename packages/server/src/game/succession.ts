import { addEmotion } from "../npc/emotions.js";
import { addLore, learnLore } from "../npc/knowledge.js";
import { remember } from "../npc/memory.js";
import { adjust, AFFECTION } from "../npc/relationship.js";
import { isEnemy, isFriend, relationTo } from "../npc/social.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { learnEvent, recordEvent } from "./events.js";
import { townLearns } from "./reputation.js";
import { note } from "./journal.js";
import { formatMoney } from "./money.js";
import { itemLabel } from "./items.js";

/**
 * Death has consequences (N7) and the town goes on (N7.4).
 *
 * When an NPC dies, code works out the ripple: the player's jobs for them fail,
 * their job board is gone, everyone hears the news, friends grieve, and if the
 * player killed them, friends (and whoever learns of it) turn against the player.
 *
 * An NPC can name a `successor`: an apprentice or relative with their own NPC file
 * and `successorOf`, who stays out of the world until then. The successor takes over
 * the place and trade, part of the stock and purse, and the unfinished need quests,
 * and remembers how the predecessor died. If the player was the killer, the
 * successor holds a blood grudge: no trade, no amends. With no successor named,
 * their eldest grown child (game/family.ts) inherits instead; with neither, the gap
 * is news, and a need for the town.
 */
export interface Member {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Share of the predecessor's stock and purse the successor inherits (the rest went to the funeral, debts, and looters). */
export const INHERIT_SHARE = 0.75;
/** A blood grudge lasts this many days: for all practical purposes, for good. */
export const BLOOD_GRUDGE_DAYS = 10_000;

export interface Ripple {
  log: string[];
  failedQuests: string[];
  successor: string | null;
}

/**
 * The ripple of a death. `killer` is "player", another being's name, or null (old
 * age). `knownKiller`: whether people know who did it (witnessed). Safe to call
 * once per death (the caller checks); returns lines for the player.
 */
export function deathRipple(members: Member[], world: WorldSnapshot, deadId: string, killer: string | null, knownKiller = true): Ripple {
  const dead = members.find((m) => m.id === deadId);
  if (!dead) return { log: [], failedQuests: [], successor: null };
  const player = world.player;
  const log: string[] = [];
  const name = dead.persona.name;
  const byPlayer = killer === "player";

  // The player's jobs for them can't be finished.
  const failed = player.quests.active.filter((q) => q.giverId === deadId);
  for (const q of failed) {
    player.quests.active = player.quests.active.filter((a) => a !== q);
    (player.quests.failed ??= []).push(q.id);
    note(player, { id: `quest:${q.id}`, day: world.day, npc: deadId, kind: "quest", text: `"${q.title}" can't be finished: ${name} is dead.` });
    recordEvent(world, { kind: "quest-failed", actor: "player", target: deadId, details: q.title, importance: 3, witnesses: [] });
  }
  if (failed.length > 0) log.push(`With ${name} gone, your job${failed.length > 1 ? "s" : ""} for them can't be finished: ${failed.map((q) => q.title).join(", ")}.`);

  // The news: a death everyone hears of, and a dynamic lore entry for it.
  const how = killer === null ? "of old age" : byPlayer ? (knownKiller ? `at the hands of ${player.name}` : "violently; nobody saw who did it") : `at the hands of ${killer}`;
  const newsId = `news.death_${deadId}`;
  addLore(world, { id: newsId, kind: "news", name: `the death of ${name}`, aliases: [], keywords: ["death", "dead", "died", "killed", "funeral"], text: `${name} died ${how}.`, event: true });
  if (!world.recentEvents.includes(newsId)) world.recentEvents.push(newsId);
  (world.newsDays ??= {})[newsId] = world.day;

  // A killing that comes out: everyone knows who did it (the guard included: game/crime.ts).
  const killing = byPlayer && knownKiller ? (world.events ?? []).find((e) => e.kind === "killed" && e.target === deadId) : undefined;
  for (const m of members) {
    if (m.id === deadId || m.state.outcome === "dead") continue;
    learnLore(m.state, newsId, "certain");
    if (killing && learnEvent(killing, m.id)) townLearns(player, killing);
    const t = traitsOf(m.persona, m.state);
    const friend = isFriend(m.state, deadId);
    if (friend) {
      addEmotion(m.state, "grief", 0.8, `${name}'s death`, world.day);
      if (byPlayer && knownKiller) {
        adjust(m.state, "trust", -40);
        adjust(m.state, "affection", AFFECTION.attack);
        adjust(m.state, "fear", 15);
        addEmotion(m.state, "resentment", 0.8, `them killing ${name}`, world.day, true);
        m.state.grudge = { reason: `they killed ${name}, your friend`, day: world.day, until: world.day + 30, blood: relationTo(m.state, deadId).affection >= 60 };
      }
    } else if (isEnemy(m.state, deadId)) {
      addEmotion(m.state, "joy", 0.2, `${name} being gone`, world.day);
    }
    if (byPlayer && knownKiller) {
      adjust(m.state, "fear", 10);
      remember(m.state, { id: `death-${deadId}`, day: world.day, text: `they killed ${name}`, importance: 9, valence: -1, ...(killing ? { event: killing.id } : {}) }, t);
    } else {
      remember(m.state, { id: `death-${deadId}`, day: world.day, text: `${name} died ${how}`, importance: friend ? 7 : 4, valence: 0 }, t);
    }
  }

  // Their work dies with them, unless someone takes it on.
  const board = dead.state.questBoard;
  dead.state.questBoard = [];
  // A named successor first; else a grown child (N11.3), the eldest, takes on the trade.
  const heir =
    (dead.persona.successor ? members.find((m) => m.id === dead.persona.successor && m.state.dormant) : undefined) ??
    members
      .filter((m) => m.persona.parents?.includes(deadId) && !m.persona.minor && m.state.outcome !== "dead" && !m.state.dormant)
      .sort((a, b) => (a.persona.bornOnDay ?? 0) - (b.persona.bornOnDay ?? 0))[0];
  if (heir) log.push(...takeOver(dead, heir, world, killer, knownKiller, board));
  else log.push(`${name} has no one to take over. ${dead.persona.role[0]!.toUpperCase()}${dead.persona.role.slice(1)} stands empty.`);
  return { log, failedQuests: failed.map((q) => q.id), successor: heir?.id ?? null };
}

/** The successor wakes into the world and takes over. Returns log lines. */
export function takeOver(dead: Member, heir: Member, world: WorldSnapshot, killer: string | null, knownKiller: boolean, board = dead.state.questBoard): string[] {
  const s = heir.state;
  s.dormant = false;
  const taken: string[] = [];
  for (const [key, qty] of Object.entries(dead.state.inventory)) {
    const share = Math.floor(qty * INHERIT_SHARE);
    if (share <= 0) continue;
    dead.state.inventory[key] = qty - share;
    if (dead.state.inventory[key] === 0) delete dead.state.inventory[key];
    s.inventory[key] = (s.inventory[key] ?? 0) + share;
    taken.push(`${itemLabel(key)} x${share}`);
  }
  const money = Math.floor(dead.state.money * INHERIT_SHARE);
  dead.state.money -= money;
  s.money += money;
  // Unfinished need quests carry over; written ones were the predecessor's own.
  s.questBoard = [...s.questBoard, ...board.filter((q) => q.id.startsWith("need_") || q.director)];
  // They know how it happened: gossip has spread it.
  const t = traitsOf(heir.persona, s);
  const name = dead.persona.name;
  const byPlayer = killer === "player";
  remember(s, { id: `predecessor-${dead.id}`, day: world.day, text: `${name} died ${killer === null ? "of old age" : byPlayer && knownKiller ? `at ${world.player.name}'s hands` : "violently"}, and you took over`, importance: 9, valence: byPlayer && knownKiller ? -1 : 0 }, t);
  addEmotion(s, "grief", 0.9, `${name}'s death`, world.day);
  if (byPlayer && knownKiller) {
    s.relationship = -60;
    s.affection = -60;
    s.fear = Math.max(s.fear, 30);
    s.grudge = { reason: `they killed ${name}`, day: world.day, until: world.day + BLOOD_GRUDGE_DAYS, blood: true };
    addEmotion(s, "resentment", 1, `them killing ${name}`, world.day, true);
  }
  recordEvent(world, { kind: "succession", actor: heir.id, target: dead.id, details: `${heir.persona.name} took over from ${name}`, importance: 6, witnesses: [] });
  return [
    `${heir.persona.name} takes over from ${name}${taken.length > 0 ? `, with ${taken.join(", ")}` : ""}${money > 0 ? ` and ${formatMoney(money)}` : ""}.`,
  ];
}

/** Successors waiting in the wings: their files exist, but they aren't in the world yet. */
export function isDormant(state: Pick<NpcState, "dormant">): boolean {
  return state.dormant === true;
}
