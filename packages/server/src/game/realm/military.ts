import type { Rng } from "../dice.js";
import { tierIndex, type Tier } from "../life.js";
import { addDeed, addRenown, FIGHTERS, figureOvercomes, figurePower, killFigure, makeFigure, takenNames } from "./figures.js";
import { beastName, epithet } from "./names.js";
import { realmNews, tally } from "./log.js";
import type { Figure, Realm, Settlement } from "./types.js";

/**
 * Fighting in the realm (N13.5), in code: a side is its militia (a share of the
 * people), its walls and barracks, and its named fighters. A fight is one roll
 * weighted by strength; both sides lose people, figures can die, the winners earn
 * XP and renown, and now and then someone from the crowd does something worth a
 * name and becomes a figure (N13.7).
 */

/** Share of a settlement's people who fight for it. */
export const MILITIA_SHARE = 0.08;
/** Chance per fight that a nameless fighter on the winning side earns a name. */
export const HERO_CHANCE = 0.25;

export interface Side {
  name: string;
  /** Raw strength. */
  strength: number;
  /** Named fighters on this side. */
  fighters: Figure[];
  /** Nameless fighters (militia, a pack's beasts): casualties come from these first. */
  men: number;
  /** The settlement whose crowd heroes come from (null: a gang or pack). */
  home: Settlement | null;
  /** Species for heroes from the crowd ("human", "wolf"). */
  species: string;
  /** Rank of the nameless. */
  rank: Tier;
}

/** Named fighters living in a settlement (or a faction's, out in the wild). */
export function fightersOf(realm: Realm, s: Settlement): Figure[] {
  return Object.values(realm.figures).filter((f) => f.alive && !f.talks && f.home === s.id && FIGHTERS.has(f.role));
}

/** How strong a settlement is in defence: men, walls, barracks and its fighters. */
export function settlementSide(realm: Realm, s: Settlement, { defending = true } = {}): Side {
  const men = Math.round(s.population * MILITIA_SHARE * (1 + 0.25 * (s.buildings.barracks ?? 0)));
  const fighters = fightersOf(realm, s);
  const walls = defending ? 1 + 0.3 * (s.buildings.walls ?? 0) : 1;
  const strength = (men * 1.5 + fighters.reduce((a, f) => a + figurePower(f), 0)) * walls;
  return { name: s.name, strength, fighters, men, home: s, species: "human", rank: "G" };
}

/** A gang's strength: its members (all fighters). */
export function gangSide(realm: Realm, factionId: string): Side {
  const f = realm.factions[factionId]!;
  const fighters = f.members.map((m) => realm.figures[m]!).filter((x) => x && x.alive && !x.talks);
  const men = 6 + Math.round(f.wealth / 200);
  return { name: f.name, strength: men * 1.6 + fighters.reduce((a, x) => a + figurePower(x), 0), fighters, men, home: null, species: "human", rank: "F" };
}

export interface FightResult {
  attackerWon: boolean;
  /** Nameless lost on each side. */
  lost: { attackers: number; defenders: number };
  /** Named figures who died. */
  dead: Figure[];
  /** A figure who rose from the crowd. */
  hero: Figure | null;
  lines: string[];
}

/**
 * One fight between two sides. The odds are the strengths' share; both sides lose
 * nameless fighters (the losers more), each named fighter on the losing side may
 * die (more likely the lower their rank against the winners'), the winners overcome
 * a challenge at the losers' best rank. `what`: "the raid on Ashby".
 */
export function fight(realm: Realm, a: Side, d: Side, day: number, rng: Rng, what: string): FightResult {
  const pA = a.strength / Math.max(1, a.strength + d.strength);
  const attackerWon = rng() < pA;
  const [win, lose] = attackerWon ? [a, d] : [d, a];
  const loseShare = 0.15 + rng() * 0.15;
  const winShare = 0.04 + rng() * 0.06;
  const lostLose = Math.min(lose.men, Math.round(lose.men * loseShare));
  const lostWin = Math.min(win.men, Math.round(win.men * winShare));
  const dead: Figure[] = [];
  const lines: string[] = [];
  const bestRank = (s: Side) => s.fighters.reduce<Tier>((best, f) => (tierIndex(f.life.tier as Tier) > tierIndex(best) ? (f.life.tier as Tier) : best), s.rank);
  const winRank = bestRank(win);
  for (const f of lose.fighters) {
    const gap = tierIndex(winRank) - tierIndex(f.life.tier as Tier);
    if (rng() < Math.max(0.03, Math.min(0.5, 0.12 + gap * 0.08))) {
      if (killFigure(realm, f, day, `killed in ${what}`)) {
        dead.push(f);
        lines.push(`${f.name} fell in ${what}.`);
      }
    } else addDeed(f, `survived ${what}`);
  }
  for (const f of win.fighters) {
    if (rng() < 0.04) {
      if (killFigure(realm, f, day, `killed in ${what}`)) {
        dead.push(f);
        lines.push(`${f.name} fell in ${what}, though their side won.`);
      }
      continue;
    }
    lines.push(...figureOvercomes(f, 30, { kind: "fight", rank: bestRank(lose), what: `winning ${what}` }, day));
    addRenown(f, 3);
    addDeed(f, `won ${what}`);
  }
  for (const f of lose.fighters) if (f.alive) figureOvercomes(f, 10, { kind: "survival", rank: "G", what: `surviving ${what}` }, day);
  // Somebody nameless did something worth a name (N13.7).
  let hero: Figure | null = null;
  if (win.men > 0 && rng() < HERO_CHANCE) {
    hero = makeFigure(
      realm,
      rng,
      {
        role: win.species === "human" ? (win.home ? (win.home.kind === "hamlet" || win.home.kind === "village" ? "hunter" : "captain") : "bandit") : "beast",
        home: win.home?.id ?? null,
        tier: win.rank === "G" ? "F" : win.rank,
        age: win.species === "human" ? 18 + Math.floor(rng() * 15) : 3,
        species: win.species,
        renown: 15,
        rose: "crowd",
        superior: win.home?.leader ?? win.fighters[0]?.id ?? null,
      },
      day,
    );
    if (win.species === "human") hero.name = `${hero.name} ${epithet(rng)}`;
    else hero.name = beastName(rng, win.species, takenNames(realm));
    addDeed(hero, `rose from the ranks in ${what}`);
    tally(realm, "risen");
    realmNews(realm, day, win.home?.id ?? null, "risen", `${hero.name} made a name in ${what}.`, 4, [hero.name]);
    lines.push(`${hero.name} made a name for themselves.`);
  }
  tally(realm, "fights");
  return { attackerWon, lost: attackerWon ? { attackers: lostWin, defenders: lostLose } : { attackers: lostLose, defenders: lostWin }, dead, hero, lines };
}

/** Losses come off a settlement's people. */
export function bury(s: Settlement | null, n: number): void {
  if (s) s.population = Math.max(0, s.population - n);
}
