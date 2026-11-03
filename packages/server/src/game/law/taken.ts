import type { PlayerState } from "../../npc/types.js";
import { skillLevel } from "../../npc/skills.js";
import { check, type Rng } from "../dice.js";
import { mint, transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import { figurePower } from "../realm/figures.js";
import { gangSide } from "../realm/military.js";
import type { Realm } from "../realm/types.js";
import { gangMembers } from "../realm/who.js";

/**
 * The player taken (N26J step 3, decisions 5 and 6; a cut of N49's setbacks). When bandits beat the player, one chooser
 * decides: robbed and left, or taken, if the gang has somewhere to hold them (its camp or a stronghold) and they're worth
 * something (renown, coin, or a pair of hands). A taken player is a captive: `player.chapter` limits what they can do (talk,
 * work, wait, plan), and the ways out are mechanics: escape (by night, past the real watch, easier with a watchman bribed),
 * ransom (their own coin, a friend's, or their home place's), rescue (a hero of their home place comes, after some days),
 * working it off, or joining the gang.
 */
export type Exit = "escape" | "ransom" | "rescue" | "labour" | "join";

export interface Chapter {
  /** Held by a gang (N26J), or N49's other setbacks: sold as a slave, in a cell, left for dead and mending, exiled. */
  kind: "captive" | "slave" | "prisoner" | "recovering" | "exiled";
  /** The gang (a faction id). */
  holder: string;
  /** Where they're held. */
  site: string;
  since: number;
  exits: Exit[];
  /** How close the watch is (failed escapes make it closer). */
  watch: number;
  /** A watchman bribed to look away, and the day it holds. */
  bribed?: { who: string; day: number };
  /** Days of labour done. */
  worked: number;
  /** The place they came from, to go home to. */
  home: string;
}

/** Days of labour before the chief lets a useful captive go. */
export const LABOUR_DAYS = 6;
/** Days before a hero of their home place may come for them. */
export const RESCUE_AFTER = 4;

/** The ransom asked for the player: more for the renowned. */
export const ransomOf = (p: PlayerState): number => 100 + 10 * (p.renown ?? 0);

/** The chooser: beaten by a gang's people, is the player robbed and left, or taken? Returns the chapter if taken. */
export function maybeTake(realm: Realm, p: PlayerState, gang: string, home: string, day: number, rng: Rng): { taken: boolean; lines: string[] } {
  const g = realm.factions[gang];
  if (!g || g.dissolved !== undefined || p.chapter) return { taken: false, lines: [] };
  // Somewhere to hold them: a stronghold, or the gang's camp at its seat.
  const stronghold = Object.values(realm.settlements).find((s) => s.fallen?.to === "gang" && s.fallen.id === gang);
  const where = stronghold?.id ?? g.seat;
  if (!where) return { taken: false, lines: [] };
  const worth = (p.renown ?? 0) >= 10 || p.money >= 150 || rng() < 0.35;
  if (!worth) return { taken: false, lines: [] };
  const took = transfer(realm, "player", `f:${gang}`, Math.floor(p.money / 2), "taken from a captive", p, day);
  p.chapter = { kind: "captive", holder: gang, site: where, since: day, exits: ["escape", "ransom", "rescue", "labour", "join"], watch: 0, worked: 0, home };
  p.site = where;
  delete p.road;
  if (stronghold) delete p.area;
  else p.area = "camp";
  tally(realm, "player_taken");
  realmNews(realm, day, where, "captive", `${g.name} have taken ${p.name} captive.`, 6, [p.name, g.name]);
  return { taken: true, lines: [`You come to with your hands bound. ${g.name} have taken you to ${stronghold ? stronghold.name : "their camp"}${took > 0 ? `, and ${took} copper of yours with you` : ""}. (Ways out: escape, ransom, labour, join; or wait to be rescued.)`] };
}

/** May the captive player do this? (They can't walk away.) */
export const isCaptive = (p: PlayerState): boolean => p.chapter?.kind === "captive";
/** Held somewhere they can't walk out of (N49): a captive, a slave, a prisoner. */
export const isHeld = (p: PlayerState): boolean => p.chapter?.kind === "captive" || p.chapter?.kind === "slave" || p.chapter?.kind === "prisoner";

/** The gang member keeping watch tonight (a real one), or null. */
export function watchman(realm: Realm, c: Chapter, day: number): string | null {
  const members = gangMembers(realm, c.holder).filter((f) => f.id !== realm.factions[c.holder]?.leader);
  if (members.length === 0) return null;
  return members[day % members.length]!.id;
}

/** One of the ways out, chosen by the player. */
export function captiveAct(realm: Realm, p: PlayerState, op: Exit | "bribe", day: number, hour: number, rng: Rng, friends: Array<{ name: string; money: number; pay: (n: number) => void }> = []): { ok: boolean; lines: string[]; free: boolean } {
  const c = p.chapter;
  if (!c || c.kind !== "captive") return { ok: false, lines: ["You're nobody's captive."], free: false };
  const g = realm.factions[c.holder];
  const free = (why: string, lines: string[]) => {
    delete p.chapter;
    tally(realm, `player_freed_${why}`);
    realmNews(realm, day, c.home, "captive", `${p.name} is free of ${g?.name ?? "the bandits"} (${why}).`, 5, [p.name]);
    return { ok: true, lines, free: true };
  };
  switch (op) {
    case "bribe": {
      const w = watchman(realm, c, day);
      const f = w ? realm.figures[w] : undefined;
      if (!f) return { ok: false, lines: ["Nobody is on the watch to bribe."], free: false };
      const price = 30 + 20 * c.watch;
      if (p.money < price) return { ok: false, lines: [`${f.name} wants ${price} copper you don't have.`], free: false };
      if (rng() < f.greed * 0.9 + 0.1 - f.loyalty * 0.3) {
        transfer(realm, "player", `p:${f.id}`, price, "a captive's bribe", p, day);
        c.bribed = { who: f.id, day };
        return { ok: true, lines: [`${f.name} takes the ${price} copper: "Tonight. I'll be looking the other way."`], free: false };
      }
      c.watch += 1;
      return { ok: false, lines: [`${f.name} laughs and tells the chief. They watch you closer now.`], free: false };
    }
    case "escape": {
      const night = hour >= 21 || hour < 5;
      const bribed = c.bribed?.day === day;
      const target = 13 + c.watch * 2 - (night ? 4 : 0) - (bribed ? 6 : 0);
      const r = check(rng, p.attributes.agility, target, skillLevel(p.skills, "sneak"));
      if (r.success) return free("escaped", ["You slip your bonds and get away into the dark."]);
      c.watch += 1;
      p.hp = Math.max(1, p.hp - Math.ceil(p.maxHp * 0.25));
      return { ok: false, lines: ["They catch you at the edge of the camp, and beat you for it. The watch is closer now."], free: false };
    }
    case "ransom": {
      const asked = ransomOf(p);
      if (p.money >= asked) {
        transfer(realm, "player", `f:${c.holder}`, asked, "a ransom", p, day);
        return free("ransomed", [`You buy your own freedom for ${asked} copper.`]);
      }
      // A friend who has the coin and cares enough pays it (N38: an action of theirs).
      const friend = friends.find((f) => f.money >= asked);
      if (friend) {
        friend.pay(asked);
        mint(realm, `f:${c.holder}`, asked, "a ransom paid by a friend", undefined, day);
        return free("ransomed", [`Word reaches ${friend.name}, who pays ${asked} copper for you.`]);
      }
      const home = realm.settlements[c.home];
      if (home && (p.renown ?? 0) >= 20 && transfer(realm, `s:${home.id}`, `f:${c.holder}`, asked, `${p.name}'s ransom`, undefined, day) >= asked) return free("ransomed", [`${home.name} pays ${asked} copper for you: they want you back.`]);
      return { ok: false, lines: [`The chief names ${asked} copper. Nobody has sent it yet.`], free: false };
    }
    case "labour": {
      c.worked += 1;
      if (c.worked >= LABOUR_DAYS) return free("worked off", ["The chief says you've earned your keep and sends you off with a kick."]);
      return { ok: true, lines: [`A day of digging the palisade and hauling water (${c.worked} of ${LABOUR_DAYS}).`], free: false };
    }
    case "join": {
      if (!g) return { ok: false, lines: ["There's nobody to join."], free: false };
      (p.factions ??= []).push(g.id);
      return free("joined", [`You swear yourself to ${g.name}. They cut your bonds.`]);
    }
    case "rescue":
      return { ok: false, lines: ["Rescue isn't yours to choose: it comes, or it doesn't."], free: false };
  }
}

/** Each day held: a hero of the player's home place may come for them (a real figure, a real fight). */
export function captiveDay(realm: Realm, p: PlayerState, day: number, rng: Rng): string[] {
  const c = p.chapter;
  if (!c || c.kind !== "captive" || day - c.since < RESCUE_AFTER) return [];
  const hero = Object.values(realm.figures).filter((f) => f.alive && !f.talks && f.home === c.home && (f.role === "adventurer" || f.role === "captain" || f.role === "hunter")).sort((a, b) => b.renown - a.renown || (a.id < b.id ? -1 : 1))[0];
  if (!hero || rng() >= 0.25) return [];
  const g = realm.factions[c.holder];
  const theirs = g ? gangSide(realm, g.id).strength * 0.3 : 1;
  if (rng() < figurePower(hero) / (figurePower(hero) + theirs)) {
    delete p.chapter;
    tally(realm, "player_freed_rescued");
    realmNews(realm, day, c.home, "captive", `${hero.name} of ${realm.settlements[c.home]?.name ?? "home"} rescued ${p.name} from ${g?.name ?? "the bandits"}.`, 6, [hero.name, p.name]);
    return [`${hero.name} comes over the palisade in the night and cuts you free. You're going home.`];
  }
  return [`In the night there's shouting at the edge of the camp: someone came for you and was driven off.`];
}
