import { config } from "../../config.js";
import { seededRng, unitFor } from "../dice.js";
import { addFaction } from "../realm/generate.js";
import { makeFigure } from "../realm/figures.js";
import { REALM_H, REALM_W } from "../realm/generate.js";
import { sign } from "../realm/diplomacy.js";
import { pickStartSite } from "../realm/start.js";
import type { Figure, Kingdom, Realm, Settlement, Terrain } from "../realm/types.js";
import { stanceOf } from "../../world/species.js";

/**
 * The peoples of the realm (N54 Part B). On the realm's first day of them the land is given its other peoples where their habitat fits and
 * humans are thin: a **goblin warren** in the hills near the start town (and an ogre in a cave nearby), an **orc kingdom** in the east, a
 * **dwarf hold** of its own crown in the western hills, a **centaur herd** that moves between four grazings with the seasons, a **dragon**
 * with a lair in the northern peaks. Their places are N13 settlements (`species` on them; their people are a number until a place's people
 * are rolled, and then rows of their species), their kingdoms N13 kingdoms with crowns, rulers and laws, their great beasts figures.
 * Everything from the seed. `realm.society.peoples` remembers what was made and where the lairs are.
 */
export interface PeoplesState {
  made: number;
  warren?: string;
  ogre?: string;
  orcs?: string;
  dwarves?: string;
  herd?: string;
  dragon?: string;
  lairs: Record<string, { x: number; y: number; kind: string }>;
  /** Dragon raids: the last day each dragon burned somewhere. */
  burned: Record<string, number>;
  /** The kingdoms a people asked for help, and the answer. */
  asked: Array<{ day: number; by: string; of: string; ok: boolean; war?: string }>;
  /** Residents of other peoples who came to live in human places (person ids), and whether they can talk. */
  residents: Array<{ id: string; species: string; site: string; clever: boolean; day: number }>;
}

export function peoplesOf(realm: Realm): PeoplesState | undefined {
  return realm.society?.peoples as PeoplesState | undefined;
}

function place(realm: Realm, o: { id: string; name: string; kind: Settlement["kind"]; species: string; pos: { x: number; y: number }; terrain: Terrain; population: number; kingdom?: string | null; buildings?: Settlement["buildings"] }): Settlement {
  const s: Settlement = {
    id: o.id,
    name: o.name,
    kind: o.kind,
    kingdom: o.kingdom ?? null,
    liege: null,
    leader: null,
    pos: { x: Math.round(Math.max(10, Math.min(REALM_W - 10, o.pos.x))), y: Math.round(Math.max(10, Math.min(REALM_H - 10, o.pos.y))) },
    terrain: o.terrain,
    population: o.population,
    houses: Math.max(4, Math.round(o.population / 5)),
    prosperity: 35,
    food: 55,
    treasury: 0,
    buildings: o.buildings ?? {},
    project: null,
    taxRate: 0,
    arrears: 0,
    roads: [],
    species: o.species,
  };
  realm.settlements[s.id] = s;
  return s;
}

function crownFor(realm: Realm, k: Kingdom, ruler: Figure, day: number): void {
  addFaction(realm, { id: k.crown, name: `the Crown of ${k.name}`, kind: "crown", creed: `the rule of ${k.name}`, leader: ruler.id, members: [ruler.id], seat: k.capital, branches: [k.capital], wealth: 3000, founded: day, kingdom: k.id, stances: {} });
  ruler.faction = k.crown;
}

/** A kingdom of another people, with its capital, its crown and its ruler. */
function kingdomOf(realm: Realm, rng: () => number, o: { id: string; name: string; species: string; capital: Settlement; laws: Kingdom["laws"]; color: string }, day: number): Kingdom {
  const k: Kingdom = { id: o.id, name: o.name, capital: o.capital.id, crown: `crown_${o.id}`, ruler: null, color: o.color, opinion: {}, weariness: 0, laws: o.laws, species: o.species };
  realm.kingdoms[k.id] = k;
  o.capital.kingdom = k.id;
  const ruler = makeFigure(realm, rng, { role: "ruler", home: o.capital.id, tier: "B", age: 60, species: o.species }, day);
  k.ruler = ruler.id;
  o.capital.leader = ruler.id;
  crownFor(realm, k, ruler, day);
  // How it sees the realm's other kingdoms, and they it: their peoples' old hatreds and friendships.
  for (const other of Object.values(realm.kingdoms)) {
    if (other.id === k.id) continue;
    const theirs = other.species ?? "human";
    k.opinion[other.id] = Math.max(-100, Math.min(100, stanceOf(o.species, theirs)));
    other.opinion[k.id] = Math.max(-100, Math.min(100, stanceOf(theirs, o.species)));
  }
  return k;
}

export function generatePeoples(realm: Realm, day: number): PeoplesState | undefined {
  if (!config.society.peoples) return undefined;
  const soc = (realm.society ??= {});
  if (soc.peoples) return soc.peoples as PeoplesState;
  const st: PeoplesState = { made: day, lairs: {}, burned: {}, asked: [], residents: [] };
  soc.peoples = st;
  const rng = seededRng(Math.floor(unitFor(realm.seed, "peoples") * 2 ** 31));
  const all = Object.values(realm.settlements).filter((s) => !s.way).sort((a, b) => a.id.localeCompare(b.id));
  const start = realm.settlements[pickStartSite(realm, realm.seed)]!;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---- A goblin warren in the hills near the start town, and an ogre in a cave beyond ----
  const hills = all.filter((s) => s.terrain === "hills").sort((a, b) => dist(a.pos, start.pos) - dist(b.pos, start.pos))[0] ?? start;
  const warren = place(realm, { id: `warren_${hills.id}`, name: `the ${hills.name} Warren`, kind: "village", species: "goblin", pos: { x: hills.pos.x + 18, y: hills.pos.y - 12 }, terrain: "hills", population: 80 });
  const chief = makeFigure(realm, rng, { role: "bandit chief", home: warren.id, tier: "D", age: 20, species: "goblin" }, day);
  warren.leader = chief.id;
  st.warren = warren.id;
  const ogre = makeFigure(realm, rng, { role: "beast", home: null, tier: "C", age: 40, species: "ogre" }, day);
  st.ogre = ogre.id;
  st.lairs[ogre.id] = { x: warren.pos.x + 10, y: warren.pos.y - 8, kind: "cave" };

  // ---- An orc kingdom in the east ----
  const east = Math.max(...all.map((s) => s.pos.x));
  const orcCap = place(realm, { id: "orc_hold", name: "Gharrak", kind: "town", species: "orc", pos: { x: Math.min(REALM_W - 15, east + 40), y: REALM_H * 0.5 + (rng() - 0.5) * 120 }, terrain: "hills", population: 500, buildings: { walls: 2, barracks: 2, smithy: 1 } });
  const orcs = kingdomOf(realm, rng, { id: "k_orcs", name: "the Orc Dominion", species: "orc", capital: orcCap, laws: { slavery: true, serfdom: false }, color: "#6b3a2a" }, day);
  st.orcs = orcs.id;

  // ---- A dwarf hold in the western hills ----
  const west = Math.min(...all.map((s) => s.pos.x));
  const hold = place(realm, { id: "dwarf_hold", name: "Khazdun", kind: "town", species: "dwarf", pos: { x: Math.max(15, west - 40), y: REALM_H * 0.45 + (rng() - 0.5) * 120 }, terrain: "hills", population: 420, buildings: { walls: 3, mine: 3, smithy: 3 } });
  const dwarves = kingdomOf(realm, rng, { id: "k_dwarves", name: "the Hold of Khazdun", species: "dwarf", capital: hold, laws: { slavery: false, serfdom: false }, color: "#5a5a6a" }, day);
  st.dwarves = dwarves.id;

  // ---- A centaur herd on the plains: four grazings, one a season ----
  const plains = all.filter((s) => s.terrain === "plains").sort((a, b) => a.id.localeCompare(b.id))[0] ?? all[0]!;
  const route = [0, 1, 2, 3].map((i) => ({ x: Math.round(plains.pos.x + Math.cos((i * Math.PI) / 2) * 60), y: Math.round(plains.pos.y + Math.sin((i * Math.PI) / 2) * 60) }));
  const herd = place(realm, { id: "centaur_herd", name: "the Windmane Herd", kind: "hamlet", species: "centaur", pos: route[0]!, terrain: "plains", population: 60 });
  herd.nomadic = { route, at: 0 };
  st.herd = herd.id;

  // ---- A dragon in the northern peaks ----
  const north = Math.min(...all.map((s) => s.pos.y));
  const dragon = makeFigure(realm, rng, { role: "beast", home: null, tier: "S", potential: "SSS", age: 400, species: "dragon", renown: 70, wealth: 4000 }, day);
  st.dragon = dragon.id;
  st.lairs[dragon.id] = { x: Math.round(REALM_W * (0.3 + 0.4 * rng())), y: Math.max(8, north - 30), kind: "peak" };

  // The goblins' pact with the ogre: they feed it, it fights for them.
  sign(realm, "service", `s:${warren.id}`, `p:${ogre.id}`, day, 8 * 48, "the goblins of the warren feed the ogre, and it fights for them", 10);
  return st;
}
