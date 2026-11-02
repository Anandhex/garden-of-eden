import { CLASS_RANK, type SocialClass } from "../crowd.js";

/**
 * Districts, access and buildings to scale (N26H). Every settlement is made of districts fitting its size: a hamlet is a
 * green and its farmsteads; a capital has a palace ward, a noble quarter, merchant streets, the market, craft lanes, the
 * temple close, docks and slums. Every district and building has an access level, and one function (`canEnter`)
 * decides who may go in, the same for the player and every NPC, with the ways round it: rank, a relationship, an
 * invitation, a summons, work there, a quest's writ, a bribe, or sneaking.
 */
export const DISTRICT_KINDS = ["green", "farmsteads", "street", "manor", "market", "high_street", "craft", "temple_close", "poor_end", "castle", "gate", "noble", "guild", "docks", "barracks", "slums", "foreign", "palace", "cathedral"] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

export type AccessLevel = "open" | "day" | "ranked" | "members" | "private" | "guarded";

export interface Access {
  level: AccessLevel;
  /** For "ranked": this class or higher may go in. */
  minClass?: SocialClass;
  /** For "members": who belongs (a faction, a job, a household ref). */
  members?: string;
  /** For "day": open these hours [from, to). */
  hours?: [number, number];
}

export interface District {
  id: string;
  kind: DistrictKind;
  name: string;
  access: Access;
}

/** Which districts a place has (N26H decision 1), by its kind and what it has built. */
export interface PlaceShape {
  kind: string;
  name: string;
  buildings: Partial<Record<string, number>>;
  terrain: string;
  /** Its lord sits here (a castle or a manor). */
  seat: boolean;
}

const NAMES: Record<DistrictKind, (n: string) => string> = {
  green: (n) => `${n} green`,
  farmsteads: () => "the farmsteads",
  street: () => "the street",
  manor: () => "the manor",
  market: () => "the market square",
  high_street: () => "the high street",
  craft: () => "the craft lanes",
  temple_close: () => "the temple close",
  poor_end: () => "the poor end",
  castle: () => "the castle",
  gate: () => "the gate and its inns",
  noble: () => "the noble quarter",
  guild: () => "the guild quarter",
  docks: () => "the docks",
  barracks: () => "the barracks",
  slums: () => "the slums",
  foreign: () => "the foreigners' street",
  palace: () => "the palace ward",
  cathedral: () => "the cathedral close",
};

export const DISTRICT_ACCESS: Record<DistrictKind, Access> = {
  green: { level: "open" },
  farmsteads: { level: "open" },
  street: { level: "open" },
  manor: { level: "guarded" },
  market: { level: "open" },
  high_street: { level: "open" },
  craft: { level: "open" },
  temple_close: { level: "day", hours: [6, 21] },
  poor_end: { level: "open" },
  castle: { level: "guarded" },
  gate: { level: "open" },
  noble: { level: "ranked", minClass: "gentry" },
  guild: { level: "day", hours: [7, 20] },
  docks: { level: "open" },
  barracks: { level: "members", members: "job:guard" },
  slums: { level: "open" },
  foreign: { level: "open" },
  palace: { level: "guarded" },
  cathedral: { level: "day", hours: [6, 21] },
};

export function districtsOf(p: PlaceShape): District[] {
  const lvl = (b: string) => p.buildings[b] ?? 0;
  const kinds: DistrictKind[] = [];
  switch (p.kind) {
    case "hamlet":
      kinds.push("green", "farmsteads");
      break;
    case "village":
      kinds.push("green", "street", "farmsteads");
      if (p.seat) kinds.push("manor");
      break;
    case "town":
      kinds.push("market", "high_street", "craft", "gate", "poor_end");
      if (lvl("temple") > 0) kinds.push("temple_close");
      if (p.seat) kinds.push("castle");
      break;
    default: {
      // Cities and the capital.
      kinds.push("market", "high_street", "craft", "gate", "noble", "guild", "slums", "foreign");
      if (lvl("temple") > 0) kinds.push("temple_close");
      if (lvl("barracks") > 0) kinds.push("barracks");
      if (p.terrain === "coast" || p.terrain === "marsh") kinds.push("docks");
      if (p.kind === "capital") kinds.push("palace", "cathedral");
      else kinds.push("castle");
    }
  }
  return kinds.map((k) => ({ id: `d:${k}`, kind: k, name: NAMES[k](p.name), access: DISTRICT_ACCESS[k] }));
}

/** Where people live (N26H decision 4): the district a class and job put them in, among those the place has. */
export function homeDistrict(districts: District[], cls: SocialClass, job: string): DistrictKind {
  const has = new Set(districts.map((d) => d.kind));
  const first = (...ks: DistrictKind[]) => ks.find((k) => has.has(k)) ?? districts[0]!.kind;
  if (cls === "royal") return first("palace", "castle", "noble", "manor", "street", "green");
  if (cls === "noble") return first("noble", "castle", "manor", "high_street", "street", "green");
  if (cls === "gentry") return first("noble", "high_street", "manor", "street", "green");
  if (job === "guard" || job === "knight" || job === "sellsword") return first("barracks", "gate", "castle", "street", "green");
  if (cls === "clergy") return first("cathedral", "temple_close", "street", "green");
  if (cls === "merchant") return first("high_street", "market", "street", "green");
  if (cls === "artisan") return first("craft", "market", "street", "green");
  if (cls === "slave" || cls === "serf") return first("slums", "poor_end", "farmsteads", "street", "green");
  if (job === "farmer" || job === "labourer") return first("farmsteads", "poor_end", "slums", "street", "green");
  return first("poor_end", "craft", "street", "green");
}

// ---- Who may go in ----

export const WAYS_IN = ["rank", "relation", "invite", "summons", "work", "writ", "bribe", "sneak"] as const;
export type WayIn = (typeof WAYS_IN)[number];

/** Who is at a gate or door: what `canEnter` needs to know of them. */
export interface Entrant {
  cls: SocialClass;
  job: string;
  /** Factions, guilds, offices, the household they belong to (refs as `members` says them). */
  belongs: string[];
  /** Documents they carry: a summons or a writ, for a place and a day. */
  papers: Array<{ kind: "summons" | "writ" | "pass"; to: string; day: number }>;
  /** For a home: how the household feels about them, -100..100 (absent: strangers). */
  warmth?: number;
  /** Escorted by someone who may go in. */
  escort?: boolean;
  /** Living or working there. */
  lives?: boolean;
  works?: boolean;
}

/** A district, a compound or a door being entered. */
export interface Entry {
  id: string;
  name: string;
  access: Access;
}

export interface Verdict {
  ok: boolean;
  /** How they got in, or why not. */
  why: string;
  /** What would get them in instead. */
  unless: WayIn[];
}

/** May this one go in now (`hour` of the day `day`)? The same rule for the player and everyone. */
export function canEnter(who: Entrant, e: Entry, day: number, hour: number): Verdict {
  const a = e.access;
  if (who.lives) return { ok: true, why: "it's home", unless: [] };
  if (who.works) return { ok: true, why: "work there", unless: [] };
  if (who.escort) return { ok: true, why: "brought in by someone who may", unless: [] };
  const paper = who.papers.find((p) => p.to === e.id && p.day === day);
  if (paper && (paper.kind === "summons" || paper.kind === "writ" || paper.kind === "pass")) return { ok: true, why: `a ${paper.kind} for today`, unless: [] };
  switch (a.level) {
    case "open":
      return { ok: true, why: "open to all", unless: [] };
    case "day": {
      const [from, to] = a.hours ?? [6, 21];
      return hour >= from && hour < to ? { ok: true, why: "open by day", unless: [] } : { ok: false, why: `${e.name} is shut until ${from}:00`, unless: ["work", "invite", "sneak"] };
    }
    case "ranked":
      if (CLASS_RANK[who.cls] >= CLASS_RANK[a.minClass ?? "gentry"]) return { ok: true, why: "rank", unless: [] };
      return { ok: false, why: `${e.name} is for ${a.minClass ?? "gentry"} and above, or those with business there`, unless: ["work", "invite", "summons", "writ", "bribe", "sneak"] };
    case "members":
      if (a.members && who.belongs.includes(a.members)) return { ok: true, why: "one of them", unless: [] };
      if (a.members?.startsWith("job:") && who.job === a.members.slice(4)) return { ok: true, why: "one of them", unless: [] };
      return { ok: false, why: `${e.name} is for its own people`, unless: ["work", "invite", "bribe", "sneak"] };
    case "private": {
      const w = who.warmth;
      if (w !== undefined && (w >= 40 || (w >= 15 && hour >= 7 && hour < 20))) return { ok: true, why: w >= 40 ? "kin or a friend" : "known to them, by day", unless: [] };
      return { ok: false, why: `nobody in ${e.name} knows you well enough to let you in`, unless: ["relation", "invite", "sneak"] };
    }
    case "guarded":
      if (CLASS_RANK[who.cls] >= CLASS_RANK["noble"] && e.id.includes("castle")) return { ok: true, why: "rank", unless: [] };
      return { ok: false, why: `the guards at ${e.name} let nobody through without leave`, unless: ["summons", "writ", "invite", "bribe", "sneak"] };
  }
}

/**
 * Buildings to scale (N26H decision 3), in tiles on a place's map (a tile is about 2 m). Big buildings are compounds: a wall,
 * a gate, a yard and the building. N26H's tests check the ratios: a palace is ten times a cottage and more, a hall five.
 */
export const FOOTPRINT: Record<string, { w: number; h: number; compound?: { w: number; h: number } }> = {
  hovel: { w: 3, h: 2 },
  cottage: { w: 4, h: 3 },
  craft: { w: 5, h: 4 },
  merchant: { w: 6, h: 5 },
  inn: { w: 8, h: 6 },
  hall: { w: 10, h: 8 },
  guildhall: { w: 10, h: 8 },
  temple: { w: 8, h: 12 },
  cathedral: { w: 14, h: 24 },
  barracks: { w: 10, h: 8 },
  manor: { w: 10, h: 8, compound: { w: 16, h: 14 } },
  castle: { w: 12, h: 12, compound: { w: 30, h: 24 } },
  palace: { w: 30, h: 20, compound: { w: 40, h: 30 } },
  smithy: { w: 5, h: 4 },
  market: { w: 6, h: 5 },
  granary: { w: 6, h: 5 },
};

/** The house a class lives in. */
export function houseFor(cls: SocialClass): "hovel" | "cottage" | "craft" | "merchant" | "manor" {
  if (cls === "slave" || cls === "serf") return "hovel";
  if (cls === "artisan") return "craft";
  if (cls === "merchant") return "merchant";
  if (cls === "gentry" || cls === "noble" || cls === "royal") return "manor";
  return "cottage";
}
