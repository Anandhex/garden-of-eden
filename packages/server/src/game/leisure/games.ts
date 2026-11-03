import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { SKILLS, type Skill } from "../../npc/skills.js";
import { ATTRIBUTES, type Attribute } from "../../npc/stats.js";
import { modifier, rollDie, type Rng } from "../dice.js";

/**
 * Games and contests as data (N41 decision 1): data/games/*.json says who plays where, how many, for what stakes, what wins (a skill,
 * an attribute and dice), how one cheats and is caught, and how it can hurt. One resolver (`resolveGame`) plays any of them for any
 * entrants, townsfolk, talkers or the player alike, from the dice it is given; the model only writes the banter.
 */

export const GAME_KINDS = ["table", "contest", "race", "joust", "dance", "show"] as const;

export const GameSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  kind: z.enum(GAME_KINDS),
  where: z.array(z.enum(["inn", "square", "field", "lists"])).min(1),
  players: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  stake: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
  resolve: z.object({
    skill: z.enum(SKILLS).optional(),
    attribute: z.enum(ATTRIBUTES),
    dice: z.enum(["d20", "2d6", "cards"]),
    rounds: z.number().int().min(1).max(8),
    cheat: z.object({ skill: z.enum(SKILLS), attribute: z.enum(ATTRIBUTES), against: z.literal("perception") }).optional(),
  }),
  risk: z.object({ injury: z.number().min(0).max(1), death: z.number().min(0).max(0.2) }).optional(),
  /** Renown for the winner and for a place (second, third). */
  renown: z.tuple([z.number(), z.number()]),
  who: z.object({ classes: z.array(z.string()).optional(), minAge: z.number().int().optional(), cultures: z.array(z.string()).optional() }),
});
export type GameDef = z.infer<typeof GameSchema>;

const DIR = new URL("../../data/games/", import.meta.url);
let loaded: GameDef[] | null = null;

/** Every game file, checked (`npm run check-npcs` runs this too). */
export function loadGames(dir: URL = DIR): GameDef[] {
  if (loaded && dir === DIR) return loaded;
  const out: GameDef[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const r = GameSchema.safeParse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    if (!r.success) throw new Error(`${f} is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    if (r.data.id !== f.replace(/\.json$/, "")) throw new Error(`${f}: the id is "${r.data.id}", which should be the file's name.`);
    if (r.data.players[0] > r.data.players[1]) throw new Error(`${f}: players [min, max] is backwards.`);
    out.push(r.data);
  }
  if (dir === DIR) loaded = out;
  return out;
}

export const gameById = (id: string): GameDef => {
  const g = loadGames().find((x) => x.id === id);
  if (!g) throw new Error(`No game "${id}".`);
  return g;
};

/** Someone at the table or in the lists: what the resolver reads. */
export interface Entrant {
  id: string;
  name: string;
  skills: Partial<Record<Skill, number>>;
  attrs: Partial<Record<Attribute, number>>;
  /** They mean to cheat if the game allows it. */
  cheats?: boolean;
}

/** Someone watching who might see a cheat: their perception and how well they know the game. */
export interface Watcher {
  id: string;
  perception: number;
  gambling: number;
}

export interface Played {
  game: string;
  /** Each round's score per entrant. */
  rounds: Array<Record<string, number>>;
  totals: Record<string, number>;
  /** Best first; a caught cheat is last. */
  order: string[];
  winner: string | null;
  /** Each cheat tried: who, whether it was caught, and by whom (an entrant or a watcher). */
  cheats: Array<{ who: string; caught: boolean; by?: string; round: number }>;
  injuries: string[];
  deaths: string[];
}

const attr = (e: Entrant, a: Attribute) => e.attrs[a] ?? 10;
const skill = (e: Entrant, s: Skill | undefined) => (s ? (e.skills[s] ?? 0) : 0);

function roll(rng: Rng, dice: GameDef["resolve"]["dice"]): number {
  if (dice === "2d6") return rollDie(rng, 6) + rollDie(rng, 6) + 4; // 6..16, the same middle as a d20
  if (dice === "cards") return Math.max(rollDie(rng, 20), rollDie(rng, 20)) - 3; // a hand: the better of two, less the house
  return rollDie(rng, 20);
}

/** How hard a cheat is to spot: their sleight roll. */
const CHEAT_DC = 12;
/** What a cheat that works adds to a round. */
const CHEAT_GAIN = 5;
/** How much a player at the table must beat a cheat's roll by to notice (they're watching their own hand). */
const TABLE_MARGIN = 4;

/**
 * Play a game (decision 2). Each round every entrant rolls the game's dice plus their attribute's modifier and twice their skill; a
 * cheat rolls sleight against a set mark to add to it, and each watcher (and each other player) rolls perception and their feel for
 * the game against the cheat's roll: one who beats it catches them, and a caught cheat forfeits. Contact games roll an injury for
 * each loser of a round, and a death on a bad injury. Deterministic from `rng`.
 */
export function resolveGame(game: GameDef, entrants: Entrant[], rng: Rng, watchers: Watcher[] = []): Played {
  const r = game.resolve;
  const out: Played = { game: game.id, rounds: [], totals: Object.fromEntries(entrants.map((e) => [e.id, 0])), order: [], winner: null, cheats: [], injuries: [], deaths: [] };
  const out_ = new Set<string>();
  // A cheat tries it once a game, in a round of their choosing (drawn first, so it doesn't move the other rolls).
  const cheatRound = Object.fromEntries(entrants.filter((e) => e.cheats && r.cheat).map((e) => [e.id, Math.floor(rng() * r.rounds)]));
  for (let round = 0; round < r.rounds; round++) {
    const scores: Record<string, number> = {};
    for (const e of entrants) {
      if (out_.has(e.id)) continue;
      let s = roll(rng, r.dice) + modifier(attr(e, r.attribute)) + 2 * skill(e, r.skill);
      if (cheatRound[e.id] === round && r.cheat) {
        const sleight = rollDie(rng, 20) + modifier(attr(e, r.cheat.attribute)) + 2 * skill(e, r.cheat.skill);
        if (sleight >= CHEAT_DC) s += CHEAT_GAIN;
        // Those who watch for it (the inn's people, a sharp-eyed onlooker) see it against the cheat's roll; the others at the table,
        // minding their own hands, only if they beat it by a margin.
        const eyes: Array<Watcher & { margin: number }> = [...watchers.map((w) => ({ ...w, margin: 0 })), ...entrants.filter((x) => x.id !== e.id).map((x) => ({ id: x.id, perception: attr(x, "perception"), gambling: skill(x, "gambling"), margin: TABLE_MARGIN }))];
        const by = eyes.find((w) => rollDie(rng, 20) + modifier(w.perception) + 2 * w.gambling > sleight + w.margin);
        out.cheats.push({ who: e.id, caught: !!by, ...(by ? { by: by.id } : {}), round });
        if (by) {
          out_.add(e.id);
          continue;
        }
      }
      scores[e.id] = s;
      out.totals[e.id]! += s;
    }
    out.rounds.push(scores);
    // In a contact game the round's losers may be hurt, and a bad hurt can kill.
    if (game.risk && game.risk.injury > 0) {
      const best = Math.max(...Object.values(scores));
      for (const [id, s] of Object.entries(scores)) {
        if (s >= best || out.injuries.includes(id)) continue;
        if (rng() < game.risk.injury) {
          out.injuries.push(id);
          if (rng() < game.risk.death / game.risk.injury) out.deaths.push(id);
        }
      }
    }
  }
  const standing = entrants.filter((e) => !out_.has(e.id) && !out.deaths.includes(e.id)).map((e) => e.id);
  standing.sort((a, b) => out.totals[b]! - out.totals[a]! || (a < b ? -1 : 1));
  out.order = [...standing, ...entrants.filter((e) => out.deaths.includes(e.id)).map((e) => e.id), ...entrants.filter((e) => out_.has(e.id)).map((e) => e.id)];
  out.winner = standing[0] ?? null;
  return out;
}
