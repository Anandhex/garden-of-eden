import type { Rng } from "../dice.js";
import type { FactionKind, GuildTrade } from "./types.js";

/**
 * Names for the realm, rolled in code from word lists (no model call), so a seed
 * always gives the same realm. The director may later rename a faction it founded
 * (game/realm/director.ts), through the invented-name check.
 */
/** "wolves", "bears", "giant spiders". */
export function plural(species: string): string {
  return ({ wolf: "wolves", spider: "giant spiders" } as Record<string, string>)[species] ?? `${species}s`;
}

export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

const PLACE_START = ["Ash", "Bram", "Cold", "Dun", "Elm", "Fen", "Gold", "Har", "Iron", "Kings", "Lark", "Marl", "North", "Oak", "Pen", "Red", "Salt", "Thorn", "Wil", "Wych", "Stone", "Ral", "Brook", "Hollow", "Ember", "Frost", "Grey", "High", "Low", "Mist"];
const PLACE_END = ["by", "ford", "ham", "ton", "wick", "stead", "mere", "field", "dale", "holm", "cross", "well", "bridge", "gate", "moor", "hurst", "combe", "wold", "fell", "haven"];
const KINGDOM_A = ["Aldmar", "Corveth", "Valdren", "Estmere", "Kaldor", "Oswen", "Thessaly", "Rhovan", "Brannoch", "Seldwyn"];

const FEMALE = ["Ada", "Bess", "Cora", "Della", "Edda", "Fen", "Gwen", "Hild", "Isa", "Joan", "Kit", "Lene", "Maud", "Nell", "Orla", "Rosa", "Sela", "Tilda", "Una", "Vera", "Wynn", "Yara", "Ilse", "Marta", "Agna", "Elin", "Sabe", "Rhea", "Mira", "Petra"];
const MALE = ["Aldo", "Bran", "Cole", "Dain", "Edric", "Finn", "Gar", "Hob", "Ivo", "Jory", "Kell", "Lorn", "Mott", "Ned", "Osric", "Piers", "Quill", "Rolf", "Sten", "Tam", "Ulf", "Varn", "Wat", "Yorick", "Dunstan", "Garrick", "Hamon", "Leof", "Merek", "Odo"];
const FAMILY = ["Ashdown", "Barrow", "Cotter", "Dunmore", "Fairweather", "Greaves", "Hallam", "Ingle", "Kestrel", "Lowe", "Marsh", "Nettle", "Orme", "Pike", "Quarry", "Reed", "Sallow", "Thatcher", "Underhill", "Vane", "Wainwright", "Yew", "Brook", "Carver", "Fletcher", "Mason", "Tanner", "Weaver", "Cooper", "Holt"];

const BEAST_NAMES: Record<string, string[]> = {
  wolf: ["Greyfang", "Ashpelt", "Nightmaw", "Ironjaw", "Frostfang", "Scar", "Old Howler", "Redmuzzle", "Shadowhide", "Torn-Ear"],
  bear: ["Old Grizzle", "Stonepaw", "Barrelback", "Mossback", "the Black Bear of the Fells", "Rendclaw"],
  boar: ["Tuskbreaker", "Bristleback", "the Red Boar", "Gorehide", "Mudking"],
  spider: ["the Widow", "Silkmother", "Eightlegs", "the Weaver Below"],
  horse: ["Thunder", "Ashmane", "Swift", "Old Dapple"],
};
const EPITHETS = ["the Bold", "the Red", "the Grim", "Ironhand", "the Wolf", "Quickblade", "the Lucky", "the Tall", "Oathkeeper", "the Fox", "Stonearm", "the Young", "Halfhand", "the Hammer", "Brightspear"];

const DUNGEON_A = ["the Sunken", "the Old", "the Drowned", "the Hollow", "the Whispering", "the Black", "the Broken", "the Deep", "the Forgotten", "the Burning"];
const DUNGEON_B = ["Vault", "Barrow", "Crypt", "Halls", "Mine", "Warren", "Keep", "Catacombs", "Pit", "Shrine"];

const GUILD_NAMES: Record<GuildTrade, string[]> = {
  adventurers: ["the Adventurers' Guild", "the Lantern Company", "the Delvers' Lodge", "the Free Blades"],
  merchants: ["the Merchants' League", "the Guild of the Scales", "the Coin Road Company", "the Free Traders"],
  smiths: ["the Hammer Guild", "the Brotherhood of the Anvil", "the Smiths' Hall"],
  thieves: ["the Quiet Hands", "the Rat Kings", "the Shadow Guild"],
  farmers: ["the Ploughmen's Association", "the Grain Moot", "the Harvest Fellowship"],
  healers: ["the Healers' Circle", "the Order of the Green Hand", "the Sisters of Mercy"],
  hunters: ["the Hunters' Lodge", "the Wardens of the Wood", "the Trackers' Fellowship"],
};
const GANG_NAMES = ["Red Hand", "Black Dogs", "Crows", "Broken Crowns", "Wolves of the Road", "Ditch Kings", "Grey Cloaks", "Iron Teeth", "Night Riders"];
const REBEL_NAMES = ["the Free Folk of {place}", "the {place} Uprising", "the Commons of {place}", "the Unbowed", "the Ploughshare League"];
const CULT_NAMES = ["the Children of the Ember", "the Pale Watchers", "the Seekers of the Deep", "the Circle of the Moon"];
const ORDER_NAMES = ["the Knights of the {place} Gate", "the Order of the Silver Road", "the Shield of {kingdom}", "the Wardens of {place}"];

export function placeName(rng: Rng, taken: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const n = pick(rng, PLACE_START) + pick(rng, PLACE_END);
    if (!taken.has(n)) {
      taken.add(n);
      return n;
    }
  }
  const n = `${pick(rng, PLACE_START)}${pick(rng, PLACE_END)} ${taken.size}`;
  taken.add(n);
  return n;
}

export function kingdomName(rng: Rng, taken: Set<string>): string {
  const free = KINGDOM_A.filter((k) => !taken.has(k));
  const n = free.length > 0 ? pick(rng, free) : `${pick(rng, PLACE_START)}mark`;
  taken.add(n);
  return n;
}

/** A first name, for a child born into a family that already has its second one. */
export function givenName(rng: Rng, gender: "female" | "male"): string {
  return pick(rng, gender === "female" ? FEMALE : MALE);
}

export function personName(rng: Rng, gender: "female" | "male", taken: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const n = `${pick(rng, gender === "female" ? FEMALE : MALE)} ${pick(rng, FAMILY)}`;
    if (!taken.has(n)) {
      taken.add(n);
      return n;
    }
  }
  const n = `${pick(rng, gender === "female" ? FEMALE : MALE)} ${pick(rng, FAMILY)} ${pick(rng, EPITHETS)}`;
  taken.add(n);
  return n;
}

/** A name for a beast that rose to lead its kind ("Greyfang"). */
export function beastName(rng: Rng, species: string, taken: Set<string>): string {
  const list = BEAST_NAMES[species] ?? [`the Great ${species[0]!.toUpperCase()}${species.slice(1)}`];
  const free = list.filter((n) => !taken.has(n));
  const n = free.length > 0 ? pick(rng, free) : `${pick(rng, list)} ${pick(rng, ["the Second", "the Younger", "of the North", "the Third"])}`;
  taken.add(n);
  return n;
}

export const epithet = (rng: Rng) => pick(rng, EPITHETS);

export function dungeonName(rng: Rng, taken: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const n = `${pick(rng, DUNGEON_A)} ${pick(rng, DUNGEON_B)}`;
    if (!taken.has(n)) {
      taken.add(n);
      return n;
    }
  }
  return `${pick(rng, DUNGEON_A)} ${pick(rng, DUNGEON_B)} ${taken.size}`;
}

/** A faction's name, from its kind and where it's from. Code's fallback; the director may rewrite it. */
export function factionName(rng: Rng, kind: FactionKind, ctx: { place: string; kingdom: string; trade?: GuildTrade; leader?: string }, taken: Set<string>): string {
  const fill = (s: string) => s.replace("{place}", ctx.place).replace("{kingdom}", ctx.kingdom);
  let options: string[];
  switch (kind) {
    case "crown":
      options = [`the Crown of ${ctx.kingdom}`];
      break;
    case "guild":
    case "association":
      options = (GUILD_NAMES[ctx.trade ?? "merchants"] ?? []).map((n) => `${n} of ${ctx.place}`).concat(GUILD_NAMES[ctx.trade ?? "merchants"] ?? []);
      break;
    case "gang":
      options = GANG_NAMES.map((n) => `the ${n}`);
      break;
    case "rebels":
      options = REBEL_NAMES.map(fill);
      break;
    case "cult":
      options = CULT_NAMES;
      break;
    case "order":
      options = ORDER_NAMES.map(fill);
      break;
  }
  const free = options.filter((n) => !taken.has(n));
  const n = free.length > 0 ? pick(rng, free) : `${pick(rng, options)} of ${ctx.place}`;
  const out = taken.has(n) ? `${n} (${ctx.leader ?? ctx.place})` : n;
  taken.add(out);
  return out;
}

/** "the True Red Hand", "the New Merchants' League": a faction that split off. */
export function splinterName(rng: Rng, parent: string, leader: string, taken: Set<string>): string {
  const base = parent.replace(/^the /, "");
  const options = [`the True ${base}`, `the New ${base}`, `${leader.split(" ")[0]}'s ${base}`, `the Free ${base}`, `the Reformed ${base}`];
  const free = options.filter((n) => !taken.has(n));
  const n = free.length > 0 ? pick(rng, free) : `${options[0]} (${leader})`;
  taken.add(n);
  return n;
}

export const COLORS = ["#b5763f", "#4f6fa0", "#7a9b57", "#a0607a", "#8a6fb5", "#b59a3f"];
