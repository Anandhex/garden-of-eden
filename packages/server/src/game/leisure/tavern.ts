import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { addGrievance } from "../chatter/grievance.js";
import { temperOf } from "../chatter/person.js";
import { adjustRel } from "../chatter/rel.js";
import { streamFor, unitFor, type Rng } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { NEUTRAL_DAY, type SiteDay } from "../people/conditions.js";
import { recordLifeEvent } from "../people/events.js";
import { tally } from "../realm/log.js";
import type { LifeCtx } from "../people/step.js";
import { loadGames, resolveGame, type GameDef, type Played, type Watcher } from "./games.js";
import { playScore, rowEntrant, wouldCheat } from "./people.js";

/**
 * Tavern nights (N41 step 2): every evening at every inn, those who feel like a game (N38's `play` score) sit down at a few tables of
 * dice, cards, knucklebones, arm-wrestling, drinking or darts. Each table is played by the one resolver. A cheat caught is humiliated
 * by whoever caught them (an N37 exchange), the cheated hold it against them, and a hot temper turns it into a fight (with violence on;
 * otherwise a confrontation). A heavy loss sours a sore loser. All of it is events that those at the inn saw, so gossip carries it.
 *
 * Pure in `(seed, the place's rows, the day's conditions, the day)`: a place worked out later has the same nights. The player's place
 * plays its night when the evening comes while the player is there (town.ts), the rest in the day's step.
 */
export const TAVERN = {
  /** Tables an inn holds for each level of it. */
  tablesPerLevel: 3,
  /** Score above which someone might sit down, and the share of that score that is their chance. */
  least: 0.35,
  chance: 0.45,
  /** Hour the tables are played (for events and for the player's place). */
  hour: 20,
} as const;

export const TABLE_GAMES = ["dice", "cards", "knucklebones", "arm_wrestling", "drinking", "darts"] as const;

export interface Table {
  game: string;
  players: string[];
  played: Played;
  /** The cheat caught and the one who caught them. */
  caught?: { cheat: string; by: string };
  /** Caught cheating turned to blows, or (violence off) to a confrontation. */
  fight?: { a: string; b: string; violent: boolean };
  events: string[];
}

export interface Night {
  site: string;
  day: number;
  tables: Table[];
}

/** What the player sees of a night's tables (at the inn), or hears of one (a brawl, from anywhere in the place). */
export function tavernLines(store: Pick<LifeCtx["store"], "people">, night: Night, atInn: boolean): string[] {
  const name = (id: string) => store.people.get(id)?.name ?? "someone";
  const out: string[] = [];
  for (const t of night.tables) {
    const g = loadGames().find((x) => x.id === t.game)!;
    if (atInn) {
      out.push(`At a table, ${t.players.map(name).join(", ")} sit down to ${g.name}${t.played.winner && !t.caught ? `; ${name(t.played.winner)} takes the pot` : ""}.`);
      if (t.caught) out.push(`${name(t.caught.by)} catches ${name(t.caught.cheat)} cheating at ${g.name}!`);
    }
    if (t.fight) out.push(t.fight.violent ? `${atInn ? "" : "From the inn, shouting: "}${name(t.fight.a)} goes for ${name(t.fight.b)} across the table, and a fight breaks out.` : `${atInn ? "" : "From the inn, raised voices: "}${name(t.fight.a)} has it out with ${name(t.fight.b)} over the cheating.`);
  }
  return out;
}

/** Who the inn's watchers are: those who work there (they know a cheat when they see one). */
function innWatchers(rows: PersonRow[]): Watcher[] {
  return rows.filter((r) => r.job === "innkeeper" || r.job === "server").map((r) => ({ id: r.id, perception: rowEntrant(r, 0).attrs.perception ?? 10, gambling: 1 }));
}

export function tavernNight(ctx: LifeCtx, site: string, day: number): Night {
  const { realm, store } = ctx;
  const out: Night = { site, day, tables: [] };
  const s = realm.settlements[site];
  const inns = s?.buildings.inn ?? 0;
  if (!s || inns === 0 || s.fallen || s.abandoned) return out;
  const sd = store.people.siteDay<SiteDay>(site, day) ?? NEUTRAL_DAY;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive);
  const rng = streamFor(realm.seed, "tavern", site, day);
  for (let i = 0; i < 3; i++) rng();
  // Who comes to play tonight: by their own score, in id order, each with their own chance.
  const keen = rows
    .map((r) => ({ r, score: playScore(r, day, sd) }))
    .filter((x) => x.score >= TAVERN.least && unitFor(realm.seed, "tavern-go", x.r.id, day) < x.score * TAVERN.chance)
    .sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1))
    .slice(0, inns * TAVERN.tablesPerLevel * 4)
    .map((x) => x.r)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  // Shuffle by the night's stream, then seat them table by table.
  for (let i = keen.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [keen[i], keen[j]] = [keen[j]!, keen[i]!];
  }
  const games = TABLE_GAMES.map((id) => loadGames().find((g) => g.id === id)!).filter(Boolean);
  const watchers = innWatchers(rows);
  let at = 0;
  for (let t = 0; t < inns * TAVERN.tablesPerLevel && keen.length - at >= 2; t++) {
    const game = games[Math.floor(rng() * games.length)]!;
    const n = Math.min(keen.length - at, game.players[0] + Math.floor(rng() * (Math.min(game.players[1], 4) - game.players[0] + 1)));
    if (n < game.players[0]) break;
    const players = keen.slice(at, at + n);
    at += n;
    out.tables.push(playTable(ctx, site, day, game, players, watchers.filter((w) => !players.some((p) => p.id === w.id)), streamFor(realm.seed, "game", site, day, t)));
  }
  return out;
}

/** One table's game and what came of it. */
function playTable(ctx: LifeCtx, site: string, day: number, game: GameDef, players: PersonRow[], watchers: Watcher[], rng: Rng): Table {
  const { realm, store } = ctx;
  const entrants = players.map((r) => ({ ...rowEntrant(r, day), ...(game.resolve.cheat && wouldCheat(r) ? { cheats: true } : {}) }));
  const played = resolveGame(game, entrants, rng, watchers);
  if (played.cheats.length > 0) {
    tally(realm, "cheats_tried", played.cheats.length);
    tally(realm, "cheats_caught", played.cheats.filter((c) => c.caught).length);
  }
  const table: Table = { game: game.id, players: players.map((p) => p.id), played, events: [] };
  const byId = new Map(players.map((p) => [p.id, p]));
  const seen = [...players.map((p) => p.id), ...watchers.map((w) => w.id)];
  const know = (ref: string, who: string[]) => {
    if (config.gossip) for (const id of who) learn(ctx, id, ref, { day, source: "saw", accuracy: 1 });
  };
  const caught = played.cheats.find((c) => c.caught);
  if (caught && caught.by) {
    const cheat = byId.get(caught.who)!;
    const by = caught.by;
    table.caught = { cheat: cheat.id, by };
    const byName = byId.get(by)?.name ?? store.people.get(by)?.name ?? "someone";
    const e = recordLifeEvent(realm, store, { kind: "cheat-caught", actor: by, target: cheat.id, site, day, hour: TAVERN.hour, key: `cheat:${cheat.id}:${game.id}`, details: `${byName} caught ${cheat.name} cheating at ${game.name} at the inn`, importance: 1, witnesses: seen.filter((id) => id !== by && id !== cheat.id), why: `${game.name} at the inn` });
    table.events.push(e.id);
    // Those it happened to know it; the rest of the table remembers it as a grudge, and it goes round from there. (Everyone at every
    // table learning it would have the inn's nights crowd out what a town has to tell.)
    know(eventRef(e.id), [by, cheat.id]);
    // Shown up in front of the table: the cheat thinks the less of whoever caught them, and everyone cheated holds it against the cheat.
    // (Not N37's humiliation, with its grudge and its weighty event: a cheat caught at some inn every night would fill the realm's
    // revenge and its gossip.)
    if (config.chatter && store.people.get(by)) adjustRel(store, cheat.id, by, { affection: -8, fear: 3 }, day);
    for (const p of players) {
      if (p.id === cheat.id || !config.chatter) continue;
      addGrievance(store, { who: p.id, against: cheat.id, cause: eventRef(e.id), weight: 0.2, day });
      adjustRel(store, p.id, cheat.id, { trust: -25, respect: -10 }, day);
    }
    // The hottest of the cheated may go for them.
    const hottest = players.filter((p) => p.id !== cheat.id).map((p) => ({ p, t: temperOf(p).temper })).sort((a, b) => b.t - a.t || (a.p.id < b.p.id ? -1 : 1))[0];
    if (hottest && rng() < 0.25 + 0.6 * hottest.t) {
      const violent = config.choice.violence;
      table.fight = { a: hottest.p.id, b: cheat.id, violent };
      const f = recordLifeEvent(realm, store, {
        kind: violent ? "npc-fight" : "confrontation",
        actor: hottest.p.id,
        target: cheat.id,
        site,
        day,
        hour: TAVERN.hour,
        key: `brawl:${cheat.id}:${game.id}`,
        details: violent ? `${hottest.p.name} went for ${cheat.name} across the table over the cheating; a fight broke out at the inn` : `${hottest.p.name} had it out with ${cheat.name} over the cheating, in front of the whole inn`,
        importance: violent ? 2 : 1,
        witnesses: seen.filter((id) => id !== hottest.p.id && id !== cheat.id),
        causedBy: [e.id],
        why: "caught cheating at the table",
      });
      table.events.push(f.id);
      know(eventRef(f.id), [hottest.p.id, cheat.id]);
      if (config.chatter) {
        addGrievance(store, { who: cheat.id, against: hottest.p.id, cause: eventRef(f.id), weight: 0.2, day });
        adjustRel(store, cheat.id, hottest.p.id, { fear: violent ? 15 : 5, affection: -10 }, day);
      }
    }
  } else if (played.winner && game.stake && game.stake[1] >= 20 && players.length >= 2) {
    // A heavy loss: the sore loser of a high-stakes table remembers who took their coin.
    const loser = byId.get(played.order.at(-1)!);
    const winner = byId.get(played.winner);
    if (loser && winner && loser.id !== winner.id && temperOf(loser).temper > 0.7 && rng() < 0.5) {
      const e = recordLifeEvent(realm, store, { kind: "gamble", actor: loser.id, target: winner.id, site, day, hour: TAVERN.hour, key: `lost:${loser.id}:${game.id}`, details: `${loser.name} lost heavily to ${winner.name} at ${game.name}, and took it badly`, importance: 1, witnesses: seen.filter((id) => id !== loser.id && id !== winner.id), why: "a heavy loss at the table" });
      table.events.push(e.id);
      if (config.chatter) addGrievance(store, { who: loser.id, against: winner.id, cause: eventRef(e.id), weight: 0.15, day });
    }
  }
  for (const id of played.injuries) {
    const r = byId.get(id);
    if (!r) continue;
    const e = recordLifeEvent(realm, store, { kind: "injury", actor: id, site, day, hour: TAVERN.hour, key: `hurt:${id}:${game.id}`, details: `${r.name} was hurt at ${game.name} at the inn`, importance: 1 });
    table.events.push(e.id);
  }
  return table;
}
