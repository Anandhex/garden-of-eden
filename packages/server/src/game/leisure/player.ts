import { config } from "../../config.js";
import { addEmotion } from "../../npc/emotions.js";
import { remember } from "../../npc/memory.js";
import type { NpcPersona, NpcState, PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { applyInteraction } from "../chatter/apply.js";
import { addGrievance, easeGrievances } from "../chatter/grievance.js";
import { temperOf } from "../chatter/person.js";
import { adjustRel } from "../chatter/rel.js";
import type { WorldStore } from "../db.js";
import { streamFor, unitFor } from "../dice.js";
import { recordEvent } from "../events.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { formatMoney } from "../money.js";
import { NEUTRAL_DAY, type SiteDay } from "../people/conditions.js";
import { mint, transfer } from "../realm/ledger.js";
import type { Realm } from "../realm/types.js";
import type { SavedWorld } from "../save.js";
import { contestGames, contestOn, entrantsFor, holdGame } from "./contests.js";
import { leisureOf, logResult } from "./events.js";
import { gameById, resolveGame, type Entrant } from "./games.js";
import { playScore, rowEntrant } from "./people.js";
import { TABLE_GAMES } from "./tavern.js";

/**
 * The player at play (N41 step 5): a game at the inn (stake, play, cheat if they dare), a contest day's games (enter, or bet on someone),
 * a contest day paid for, an entrant paid to lose, and a beaten rival's rematch. Every game is the one resolver's; what comes of it runs
 * on the normal systems: coin, renown, a grievance against the player for a cheat caught, a rival who wants another go.
 */

export interface LeisureHost {
  world: SavedWorld;
  store?: WorldStore | undefined;
  agents: Record<string, { persona: NpcPersona; state: NpcState }>;
  meetPerson(id: string): string | null;
  site(): string;
}

export interface Rival {
  who: string;
  name: string;
  game: string;
  day: number;
  /** The rematch was played (and who won it). */
  rematch?: { day: number; won: boolean };
}

export interface Done {
  ok: boolean;
  lines: string[];
}

const no = (line: string): Done => ({ ok: false, lines: [line] });

/** What the player brings to a game: their own attributes and skills. */
export function playerEntrant(p: PlayerState, cheats = false): Entrant {
  return { id: "player", name: p.name, attrs: { ...p.attributes }, skills: { ...p.skills }, ...(cheats ? { cheats: true } : {}) };
}

const here = (h: LeisureHost) => {
  const realm = h.world.realm;
  const store = h.store;
  return realm && store ? { realm, store, site: h.site(), day: h.world.day } : null;
};

const evening = (hour: number) => hour >= 18 || hour <= 1;

/** The people at the inn who'd sit down with a stranger tonight: the keenest by their own score, a few. */
function tableMates(realm: Realm, store: WorldStore, site: string, day: number, n: number): PersonRow[] {
  const sd = store.people.siteDay<SiteDay>(site, day) ?? NEUTRAL_DAY;
  return (store.people.loadSite(site, "full") as PersonRow[])
    .filter((r) => r.death === null && !r.away && !r.captive)
    .map((r) => ({ r, s: playScore(r, day, sd) }))
    .filter((x) => x.s > 0.3)
    .sort((a, b) => b.s - a.s || (a.r.id < b.r.id ? -1 : 1))
    .slice(0, n)
    .map((x) => x.r);
}

/** A game at the inn (evenings): `game` one of the table games, a stake, and whether to cheat. */
export function playerGamble(h: LeisureHost, o: { game?: string; stake?: number; cheat?: boolean }): Done {
  const at = here(h);
  if (!at) return no("There's nobody to play with here.");
  const { realm, store, site, day } = at;
  const p = h.world.player;
  const s = realm.settlements[site];
  if (!s || (s.buildings.inn ?? 0) === 0) return no("There's no inn here.");
  if (p.place !== "inn") return no("Games are played at the inn.");
  if (!evening(h.world.hour)) return no("The tables fill up in the evening.");
  const game = gameById(o.game && (TABLE_GAMES as readonly string[]).includes(o.game) ? o.game : "dice");
  const stake = Math.max(game.stake?.[0] ?? 1, Math.min(game.stake?.[1] ?? 10, Math.floor(o.stake ?? game.stake?.[0] ?? 5)));
  if (p.money < stake) return no(`You need ${formatMoney(stake)} to sit down.`);
  const n = Math.max(1, Math.min(3, game.players[1] - 1));
  const tries = (p.leisure?.games ?? 0) + 1;
  const mates = tableMates(realm, store, site, day, 6).filter((_, i) => (i + tries) % 2 === 0 || i < n).slice(0, n);
  if (mates.length < game.players[0] - 1) return no("Nobody wants a game tonight.");
  p.leisure = { ...(p.leisure ?? {}), games: tries };
  const watchers = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => (r.job === "innkeeper" || r.job === "server") && r.death === null).map((r) => ({ id: r.id, perception: rowEntrant(r, day).attrs.perception ?? 10, gambling: 1 }));
  const rng = streamFor(realm.seed, "player-game", day, h.world.hour, tries);
  const played = resolveGame(game, [playerEntrant(p, !!o.cheat && !!game.resolve.cheat), ...mates.map((r) => rowEntrant(r, day))], rng, watchers);
  const name = (id: string) => (id === "player" ? "you" : (store.people.get(id)?.name ?? "someone"));
  const lines = [`You sit down to ${game.name} with ${mates.map((r) => r.name).join(" and ")} for ${formatMoney(stake)} a hand.`];
  const caught = played.cheats.find((c) => c.caught);
  const seen = [...mates.map((r) => r.id), ...watchers.map((w) => w.id)];
  if (caught?.who === "player") {
    // Caught: the table turns on them, and the town will hear of it.
    const by = caught.by!;
    const e = recordEvent(h.world as never, { kind: "cheat-caught", actor: by, target: "player", details: `${name(by)} caught ${p.name} cheating at ${game.name} at the inn`, importance: 5, witnesses: seen, why: `${game.name} at the inn`, site });
    if (config.gossip) for (const id of seen) learn({ realm, store }, id, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    p.money = Math.max(0, p.money - stake);
    for (const r of mates) {
      addGrievance(store, { who: r.id, against: "player", cause: eventRef(e.id), weight: 0.45, day });
      adjustRel(store, r.id, "player", { trust: -25, respect: -10 }, day);
    }
    const rep = (p.reputation ??= { trust: 0, fear: 0, respect: 0, affection: 0 });
    rep.trust = Math.max(-100, rep.trust - 5);
    lines.push(`${name(by)} grabs your wrist: "Cheat!" The table goes quiet. You lose your stake, and the room's good opinion.`);
    const hottest = mates.map((r) => ({ r, t: temperOf(r).temper })).sort((a, b) => b.t - a.t)[0];
    if (hottest && rng() < 0.3 + 0.6 * hottest.t) {
      const hurt = 2 + Math.floor(rng() * 4);
      p.hp = Math.max(1, p.hp - hurt);
      lines.push(`${hottest.r.name} comes over the table at you; you take a few knocks before it's broken up (${hurt} hurt).`);
    }
    return { ok: true, lines };
  }
  if (caught) {
    // Someone else was caught: their stake and the player's are safe, and the cheat is shamed.
    const cheat = store.people.get(caught.who);
    if (cheat && caught.by && caught.by !== "player") applyInteraction({ realm, store }, { a: caught.by, b: cheat.id, kind: "humiliate", day, minute: h.world.hour * 60, site, witnesses: ["player", ...seen].filter((x) => x !== caught.by && x !== cheat.id && x !== "player"), venue: "inn" }, `player-table:${tries}`);
    if (cheat && caught.by === "player") adjustRel(store, cheat.id, "player", { fear: 8, affection: -12 }, day);
    lines.push(`${caught.by === "player" ? "You catch" : `${name(caught.by!)} catches`} ${cheat?.name ?? "someone"} palming a die. The game breaks up, and the stakes go back.`);
    return { ok: true, lines };
  }
  if (played.winner === "player") {
    const won = stake * mates.length;
    p.money += won;
    lines.push(`You take the pot: ${formatMoney(won)}.`);
  } else {
    p.money = Math.max(0, p.money - stake);
    lines.push(`${name(played.winner ?? mates[0]!.id)} takes the pot. You're ${formatMoney(stake)} down.`);
  }
  return { ok: true, lines };
}

/** What's on today at a contest day where the player is, and whether each game is still to be held. */
export function contestToday(h: LeisureHost): Array<{ game: string; name: string; held: boolean; favourite: { id: string; name: string } | null }> {
  const at = here(h);
  if (!at || !contestOn(at.realm, at.site, at.day)) return [];
  const rows = (at.store.people.loadSite(at.site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive);
  const done = leisureOf(at.realm).done;
  return contestGames(at.realm, at.site, rows).map((g) => {
    const best = entrantsFor(at.realm, g, rows, at.site, at.day)
      .map((r) => ({ r, s: rowEntrant(r, at.day) }))
      .sort((a, b) => (b.s.skills[g.resolve.skill ?? "unarmed"] ?? 0) - (a.s.skills[g.resolve.skill ?? "unarmed"] ?? 0) || (b.s.attrs[g.resolve.attribute] ?? 10) - (a.s.attrs[g.resolve.attribute] ?? 10))[0];
    return { game: g.id, name: g.name, held: !!done[`${at.site}:${at.day}:${g.id}`], favourite: best ? { id: best.r.id, name: best.r.name } : null };
  });
}

/**
 * The player at a contest day's game (morning to mid-afternoon, in the square): `enter` to compete, and/or a bet on someone. The game is
 * held there and then with everyone who came for it. A win pays the prize and renown; a proud runner-up becomes a rival.
 */
export function playerContest(h: LeisureHost, o: { game: string; enter?: boolean; bet?: { on: string; stake: number } }): Done {
  const at = here(h);
  if (!at) return no("There's no contest here.");
  const { realm, store, site, day } = at;
  const p = h.world.player;
  if (!contestOn(realm, site, day)) return no("There's no contest day here today.");
  if (p.place !== "square") return no("The contests are in the square.");
  if (h.world.hour < 9 || h.world.hour > 16) return no("The contests are held from mid-morning to the afternoon.");
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive);
  const g = contestGames(realm, site, rows).find((x) => x.id === o.game);
  if (!g) return no("That isn't one of today's contests.");
  if (leisureOf(realm).done[`${site}:${day}:${g.id}`]) return no(`${g.name[0]!.toUpperCase()}${g.name.slice(1)} is over for today.`);
  if (o.bet && (o.bet.stake <= 0 || p.money < o.bet.stake)) return no("You can't cover that bet.");
  const rigged = leisureOf(realm).rigged?.[`${site}:${day}:${g.id}`];
  const res = holdGame({ realm, store }, site, day, g, rows, { game: g.id, entrant: playerEntrant(p), ...(o.bet ? { bet: o.bet } : {}) }, o.enter !== false, rigged);
  const name = (id: string) => (id === "player" ? "you" : (store.people.get(id)?.name ?? "someone"));
  const lines: string[] = [];
  if (res.order.length === 0) return { ok: true, lines: [`Too few came for ${g.name}; it isn't held.`] };
  lines.push(`${g.name[0]!.toUpperCase()}${g.name.slice(1)}: ${res.order.slice(0, 4).map(name).join(", ")}${res.order.length > 4 ? `, and ${res.order.length - 4} more` : ""}.`);
  logResult(realm, { id: `contest:${site}:${day}:${g.id}`, kind: "contest_day", site, day, games: [res], deaths: [], ...(o.enter !== false ? { player: { game: g.id, place: res.order.indexOf("player") + 1, of: res.order.length } } : {}) });
  if (o.bet) {
    const won = res.winner === o.bet.on;
    const odds = Math.max(1, Math.floor(res.entrants.length / 2));
    p.money = Math.max(0, p.money + (won ? o.bet.stake * odds : -o.bet.stake));
    lines.push(won ? `Your bet on ${name(o.bet.on)} comes in: ${formatMoney(o.bet.stake * odds)}.` : `Your bet on ${name(o.bet.on)} is lost.`);
  }
  if (o.enter === false) return { ok: true, lines };
  const place = res.order.indexOf("player") + 1;
  if (res.winner === "player") {
    const s = realm.settlements[site]!;
    const prize = Math.min({ village: 15, town: 40, city: 80, capital: 120 }[s.kind as "village"] ?? 10, s.treasury);
    if (prize > 0) transfer(realm, `s:${site}`, "player", prize, `the ${g.name} prize`, p, day);
    p.renown = Math.min(100, (p.renown ?? 0) + g.renown[0]);
    lines.push(`You win ${g.name}!${prize > 0 ? ` The prize: ${formatMoney(prize)}.` : ""}`);
    // A proud runner-up beaten in front of everyone wants another go (decision 7: the rematch).
    const second = res.order[1] ? store.people.get(res.order[1]) : null;
    if (second && second.id !== "player") {
      addGrievance(store, { who: second.id, against: "player", cause: res.event ? eventRef(res.event) : `contest:${g.id}`, weight: 0.25, day });
      if (temperOf(second).pride > 0.35) makeRival(h, second, g.id, day);
    }
  } else lines.push(`You come ${ordinal(place)} of ${res.order.length}.`);
  return { ok: true, lines };
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** A beaten rival: they become someone who talks (and remembers), and want a rematch. */
function makeRival(h: LeisureHost, row: PersonRow, game: string, day: number): void {
  const p = h.world.player;
  const rivals = (p.leisure ??= {}).rivals ?? [];
  if (!rivals.some((r) => r.who === row.id && !r.rematch)) rivals.push({ who: row.id, name: row.name, game, day });
  p.leisure.rivals = rivals.slice(-8);
  const id = h.meetPerson(row.id);
  const st = id ? h.agents[id]?.state : undefined;
  if (st) {
    remember(st, { id: `beaten-${game}-${day}`, day, text: `the stranger beat me at ${gameById(game).name} in front of everyone`, importance: 6, valence: -1 });
    addEmotion(st, "embarrassment", 0.5, `losing at ${gameById(game).name}`, day, true);
  }
}

/** A rival's rematch (they asked; the player accepts): one against one, at the same game. */
export function playerRematch(h: LeisureHost, who: string): Done {
  const at = here(h);
  if (!at) return no("Not here.");
  const p = h.world.player;
  const rival = (p.leisure?.rivals ?? []).find((r) => r.who === who && !r.rematch);
  if (!rival) return no("Nobody here wants a rematch with you.");
  const row = at.store.people.get(who);
  if (!row || row.death !== null || row.site !== at.site || row.away) return no(`${rival.name} isn't here.`);
  const g = gameById(rival.game);
  const played = resolveGame(g, [playerEntrant(p), rowEntrant(row, at.day)], streamFor(at.realm.seed, "rematch", who, at.day));
  const won = played.winner === "player";
  rival.rematch = { day: at.day, won };
  const e = recordEvent(h.world as never, { kind: "challenge", actor: who, target: "player", details: `${row.name} challenged ${p.name} to a rematch at ${g.name}, and ${won ? "lost again" : "won"}`, importance: 4, why: `beaten at ${g.name} on day ${rival.day}`, site: at.site });
  if (won) {
    addGrievance(at.store, { who, against: "player", cause: eventRef(e.id), weight: 0.2, day: at.day });
    p.renown = Math.min(100, (p.renown ?? 0) + 2);
  } else {
    easeGrievances(at.store, who, "player", 1, at.day);
    adjustRel(at.store, who, "player", { respect: 10, affection: 5 }, at.day);
  }
  return { ok: true, lines: [won ? `You beat ${row.name} again at ${g.name}. They take it badly.` : `${row.name} beats you at ${g.name}, and grins: honour is satisfied.`] };
}

/** The player pays the head of the place to hold a contest day tomorrow (the coin goes into its treasury). */
export function playerOrganise(h: LeisureHost, cost = 60): Done {
  const at = here(h);
  if (!at) return no("Not here.");
  const p = h.world.player;
  const s = at.realm.settlements[at.site];
  if (!s || s.kind === "hamlet") return no("A hamlet has nobody to hold a contest day.");
  if (p.money < cost) return no(`It would cost ${formatMoney(cost)} in prizes.`);
  const day = at.day + 1;
  const l = leisureOf(at.realm);
  if (l.events.some((e) => e.kind === "contest_day" && e.site === at.site && e.day === day)) return no("There's a contest day here tomorrow already.");
  p.money -= cost;
  mint(at.realm, `s:${at.site}`, cost, "a contest day paid for by a stranger", p, at.day);
  l.events.push({ id: `contest:${at.site}:${day}`, kind: "contest_day", site: at.site, day, why: "paid for by a stranger", prize: cost, announced: at.day, entrants: [], journeys: [], byPlayer: true });
  return { ok: true, lines: [`The head of the place takes your ${formatMoney(cost)}: there will be contests in the square tomorrow.`] };
}

/** The player pays an entrant to lose (rigging). The judges may see it: then it's the player's shame, and the entrant's. */
export function playerRig(h: LeisureHost, o: { game: string; who: string; bribe?: number }): Done {
  const at = here(h);
  if (!at) return no("Not here.");
  const p = h.world.player;
  const bribe = Math.max(10, o.bribe ?? 20);
  if (p.money < bribe) return no(`You'd need ${formatMoney(bribe)}.`);
  const row = at.store.people.get(o.who);
  if (!row || row.site !== at.site || row.death !== null) return no("They aren't here.");
  if (temperOf(row).honesty > 0.7) {
    adjustRel(at.store, row.id, "player", { trust: -15, respect: -10 }, at.day);
    return no(`${row.name} won't take it, and looks at you differently now.`);
  }
  p.money -= bribe;
  const l = leisureOf(at.realm);
  (l.rigged ??= {})[`${at.site}:${at.day}:${o.game}`] = row.id;
  const seen = unitFor(at.realm.seed, "rig", row.id, at.day) < 0.2;
  if (seen) {
    recordEvent(h.world as never, { kind: "bribe", actor: "player", target: row.id, details: `${p.name} was seen paying ${row.name} to throw ${gameById(o.game).name}`, importance: 4, site: at.site });
    const rep = (p.reputation ??= { trust: 0, fear: 0, respect: 0, affection: 0 });
    rep.trust = Math.max(-100, rep.trust - 6);
    return { ok: true, lines: [`${row.name} pockets the coin, but someone saw it change hands.`] };
  }
  return { ok: true, lines: [`${row.name} pockets the coin without a word.`] };
}

/** What the player can do for fun where they are (the client's "Games and contests" section). */
export function leisureView(h: LeisureHost): import("@millbrook/shared").LeisureView | null {
  const at = here(h);
  if (!at || h.world.player.road || h.world.player.area !== undefined) return null;
  const s = at.realm.settlements[at.site];
  if (!s) return null;
  const p = h.world.player;
  return {
    inn: (s.buildings.inn ?? 0) > 0,
    atInn: p.place === "inn",
    evening: evening(h.world.hour),
    tables: TABLE_GAMES.map((id) => ({ id, name: gameById(id).name, stake: gameById(id).stake?.[0] ?? 1, cheat: !!gameById(id).resolve.cheat })),
    contest: contestToday(h),
    inSquare: p.place === "square",
    rivals: (p.leisure?.rivals ?? []).filter((r) => !r.rematch).map((r) => ({ id: r.who, name: r.name, game: gameById(r.game).name, here: at.store.people.get(r.who)?.site === at.site })),
    organise: s.kind === "hamlet" ? null : 60,
  };
}
