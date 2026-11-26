import { config } from "../../config.js";
import { mint } from "../realm/ledger.js";
import { seededRng, unitFor } from "../dice.js";
import { addFaction } from "../realm/generate.js";
import { makeFigure } from "../realm/figures.js";
import { REALM_H, REALM_W } from "../realm/generate.js";
import { sign } from "../realm/diplomacy.js";
import { pickStartSite } from "../realm/start.js";
import type { Figure, Kingdom, Realm, Settlement, Terrain } from "../realm/types.js";
import { peopleOf, peoplesNotBeasts, stanceOf, type PeopleDef } from "../../world/species.js";

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
  /**
   * The rest of the peoples, placed by habitat (Part B1): each people's settlements, its kingdom if it has one, and its lone great
   * ones (trolls at crossings, minotaurs in their mazes, more dragons). Absent in a realm made before Part B1: it keeps only the first cut.
   */
  placed?: { settlements: Record<string, string[]>; kingdoms: Record<string, string>; figures: Record<string, string[]> };
  /** Part C: what each placed home chose last season, and who last raided a home of another people. */
  intents?: Record<string, { day: number; site: string; intent: string; why: string; target?: string }>;
  raidedBy?: Record<string, { by: string; day: number }>;
}

export function peoplesOf(realm: Realm): PeoplesState | undefined {
  return realm.society?.peoples as PeoplesState | undefined;
}

/**
 * The fields, herds and pens every place of a kind starts with (as a human place of the kind does, realm/generate.ts). Without them a
 * people's home makes less food than it eats: the orc hold, on hills, with no roads for a grain caravan and no coin to buy grain, went
 * hungry from its first year and never recovered (N22's food-band).
 */
const FARMS: Record<Settlement["kind"], number> = { capital: 3, city: 2, town: 2, village: 1, hamlet: 1 };

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
    buildings: { farms: FARMS[o.kind], ...o.buildings },
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
  addFaction(realm, { id: k.crown, name: `the Crown of ${k.name}`, kind: "crown", creed: `the rule of ${k.name}`, leader: ruler.id, members: [ruler.id], seat: k.capital, branches: [k.capital], wealth: 0, founded: day, kingdom: k.id, stances: {} });
  // A new people's crown brings its own hoard into the realm: on the books, so every coin is accounted for.
  mint(realm, `f:${k.crown}`, 3000, `the hoard of ${k.name}`, undefined, day);
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
  placeTheRest(realm, st, day);
  return st;
}

/** Peoples the first cut above already places, and how. */
const FIRST_CUT = new Set(["human", "goblin", "ogre", "orc", "dwarf", "centaur", "dragon", "halfling"]);
/** Peoples who rule a kingdom of their own when they're placed (the stage file: an orc kingdom, a dwarf hold, an elf realm). */
const KINGDOMS: Record<string, { name: string; capital: string; color: string; slavery: boolean }> = {
  elf: { name: "the Realm of Lothmere", capital: "Lothmere", color: "#3f6b4a", slavery: false },
};
/** Settlement names by people, from their own words. */
const PLACE_WORDS: Record<string, string[]> = {
  hobgoblin: ["Varkh Keep", "the Iron Camp", "Drezzan's Hold"],
  hill_giant: ["the Giants' Steading", "Bera's Steading"],
  frost_giant: ["Hrimhall", "the Frost Steading"],
  stone_giant: ["the Deep Steading", "Talus Hall"],
  kobold: ["the Kobold Warren", "the Yipping Tunnels"],
  gnoll: ["the Laughing Band", "the Hyena Band"],
  lizardfolk: ["Sesskar Mire", "the Reed Village"],
  harpy: ["the Harpies' Roost", "Shrike Cliffs"],
};
const SIZE: Record<PeopleDef["living"], { kind: Settlement["kind"]; population: number }> = {
  settled: { kind: "village", population: 90 },
  nomadic: { kind: "hamlet", population: 50 },
  hive: { kind: "village", population: 70 },
  solitary: { kind: "hamlet", population: 0 },
  hoard: { kind: "hamlet", population: 0 },
  wild: { kind: "hamlet", population: 0 },
};

/**
 * N54 Part B1: every other people goes where its habitat fits and humans are thin, from the data alone. A settled or hive people gets a
 * settlement beyond the human place of its terrain that best suits its climate (cold peoples in the north, warm in the south, those under the
 * mountains in the hills); a nomadic people a band with four grazings, one a season; a solitary people a great one with a lair in wild
 * country (a troll at a river crossing, a minotaur in the hills); a people with a kingdom of its own a capital, a crown and a ruler; and
 * a large realm more dragons (1–3 in all). Its own dice stream, so the first cut above is made exactly as before.
 */
function placeTheRest(realm: Realm, st: PeoplesState, day: number): void {
  const rng = seededRng(Math.floor(unitFor(realm.seed, "peoples-placed") * 2 ** 31));
  const placed: NonNullable<PeoplesState["placed"]> = { settlements: {}, kingdoms: {}, figures: {} };
  st.placed = placed;
  const humans = Object.values(realm.settlements).filter((s) => !s.way && !s.species).sort((a, b) => a.id.localeCompare(b.id));
  if (humans.length === 0) return;
  const taken = Object.values(realm.settlements).map((s) => s.pos);
  const free = (x: number, y: number) => taken.every((p) => Math.hypot(p.x - x, p.y - y) >= 14);
  /** The human place of a fitting terrain best suited to the people's climate, used as an anchor; then a free spot beyond it. */
  const anchorFor = (p: PeopleDef): Settlement => {
    const fits = humans.filter((s) => p.habitat.includes(s.terrain));
    const pool = fits.length > 0 ? fits : humans;
    const score = (s: Settlement) => (p.climate === "cold" ? s.pos.y : p.climate === "warm" ? -s.pos.y : 0) + (p.underMountain && s.terrain !== "hills" ? 1000 : 0) + rng() * 40;
    return pool.map((s) => ({ s, k: score(s) })).sort((a, b) => a.k - b.k || a.s.id.localeCompare(b.s.id))[0]!.s;
  };
  const spotNear = (at: { x: number; y: number }, dist: number) => {
    for (let i = 0; i < 24; i++) {
      const a = rng() * Math.PI * 2;
      const x = Math.round(Math.max(10, Math.min(REALM_W - 10, at.x + Math.cos(a) * dist)));
      const y = Math.round(Math.max(10, Math.min(REALM_H - 10, at.y + Math.sin(a) * dist)));
      if (free(x, y)) return { x, y };
    }
    return { x: Math.round(at.x + dist), y: Math.round(at.y) };
  };
  const nameOf = (p: PeopleDef) => {
    const ns = p.names ?? [];
    return ns.length > 0 ? ns[Math.floor(rng() * ns.length)] : undefined;
  };
  // A people that worships dragons (kobolds) digs in near the first dragon's peaks.
  const firstLair = st.dragon ? st.lairs[st.dragon] : undefined;
  for (const p of peoplesNotBeasts()) {
    if (FIRST_CUT.has(p.id)) continue;
    const nearDragon = firstLair && stanceOf(p.id, "dragon") >= 60 ? humans.slice().sort((a, b) => Math.hypot(a.pos.x - firstLair.x, a.pos.y - firstLair.y) - Math.hypot(b.pos.x - firstLair.x, b.pos.y - firstLair.y) || a.id.localeCompare(b.id))[0] : undefined;
    const anchor = nearDragon ?? anchorFor(p);
    if (p.living === "solitary" || p.living === "hoard") {
      const f = makeFigure(realm, rng, { role: "beast", home: null, tier: p.body.maxTier === "S" ? "C" : "D", age: Math.round(p.body.adultAge * 1.5), species: p.id, ...(nameOf(p) ? { name: nameOf(p) } : {}) }, day);
      const at = spotNear(anchor.pos, 22);
      st.lairs[f.id] = { x: at.x, y: at.y, kind: p.id === "troll" ? "bridge" : p.underMountain || anchor.terrain === "hills" ? "cave" : "den" };
      (placed.figures[p.id] ??= []).push(f.id);
      continue;
    }
    const size = SIZE[p.living];
    const at = spotNear(anchor.pos, 26 + rng() * 14);
    taken.push(at);
    const words = PLACE_WORDS[p.id] ?? [KINGDOMS[p.id]?.capital ?? `the ${p.name.replace(/^(an?|one of the) /, "")} village`];
    const name = words[Math.floor(rng() * words.length)]!;
    const k = KINGDOMS[p.id];
    const s = place(realm, { id: `${p.id}_${anchor.id}`, name, kind: k ? "town" : size.kind, species: p.id, pos: at, terrain: p.habitat.includes(anchor.terrain) ? anchor.terrain : p.habitat[0]!, population: k ? 400 : size.population, ...(p.underMountain ? { buildings: { mine: 2 } } : {}) });
    (placed.settlements[p.id] ??= []).push(s.id);
    if (k) {
      const kg = kingdomOf(realm, rng, { id: `k_${p.id}`, name: k.name, species: p.id, capital: s, laws: { slavery: k.slavery, serfdom: false }, color: k.color }, day);
      placed.kingdoms[p.id] = kg.id;
    } else {
      const head = makeFigure(realm, rng, { role: p.temperament.aggression >= 0.7 ? "bandit chief" : "elder", home: s.id, tier: "D", age: Math.round(p.body.adultAge * 2), species: p.id, ...(nameOf(p) ? { name: nameOf(p) } : {}) }, day);
      s.leader = head.id;
    }
    if (p.living === "nomadic") {
      const r = 50 + Math.round(rng() * 20);
      s.nomadic = { route: [0, 1, 2, 3].map((i) => ({ x: Math.round(Math.max(10, Math.min(REALM_W - 10, at.x + Math.cos((i * Math.PI) / 2) * r))), y: Math.round(Math.max(10, Math.min(REALM_H - 10, at.y + Math.sin((i * Math.PI) / 2) * r))) })), at: 0 };
      s.pos = { ...s.nomadic.route[0]! };
    }
  }
  // More dragons in a large realm (the overview's default: 1–3 in all), each in its own peaks, far from the first.
  const extra = humans.length >= 60 ? 2 : humans.length >= 35 ? 1 : 0;
  const dragonDef = peopleOf("dragon");
  for (let i = 0; i < extra && dragonDef; i++) {
    const f = makeFigure(realm, rng, { role: "beast", home: null, tier: "S", potential: "SSS", age: 250 + Math.round(rng() * 300), species: "dragon", renown: 60, wealth: 3000, ...(nameOf(dragonDef) ? { name: nameOf(dragonDef) } : {}) }, day);
    const others = Object.values(st.lairs);
    const lair = [0, 1, 2, 3, 4, 5].map(() => ({ x: Math.round(REALM_W * (0.1 + 0.8 * rng())), y: Math.round(10 + rng() * 60) })).sort((a, b) => Math.min(...others.map((o) => Math.hypot(o.x - b.x, o.y - b.y))) - Math.min(...others.map((o) => Math.hypot(o.x - a.x, o.y - a.y))))[0]!;
    st.lairs[f.id] = { ...lair, kind: "peak" };
    (placed.figures.dragon ??= []).push(f.id);
  }
}
