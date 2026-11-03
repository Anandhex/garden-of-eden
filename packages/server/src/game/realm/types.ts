import { z } from "zod";
import { ITEM_TIERS } from "../items.js";
import { DeathRecordSchema } from "../people/death.js";

/**
 * The wider realm (N13): kingdoms, settlements, the people in them who don't
 * talk (figures), factions and guilds, treaties, wars, beasts and dungeons.
 * Everything here is code and numbers, rolled with the world's RNG a day at a
 * time (game/realm/day.ts). Nobody in the realm costs a model call. Saved as
 * `world.realm` (save v9) and checked by RealmSchema on load.
 */

export const SETTLEMENT_KINDS = ["hamlet", "village", "town", "city", "capital"] as const;
export type SettlementKind = (typeof SETTLEMENT_KINDS)[number];

export const BUILDINGS = ["farms", "market", "walls", "smithy", "inn", "temple", "guildhall", "barracks", "mine", "granary"] as const;
export type BuildingId = (typeof BUILDINGS)[number];

export const TERRAINS = ["valley", "hills", "forest", "plains", "coast", "marsh"] as const;
export type Terrain = (typeof TERRAINS)[number];

export const FACTION_KINDS = ["crown", "guild", "association", "gang", "rebels", "cult", "order"] as const;
export type FactionKind = (typeof FACTION_KINDS)[number];

/** What a guild or association is for. */
export const GUILD_TRADES = ["adventurers", "merchants", "smiths", "thieves", "farmers", "healers", "hunters"] as const;
export type GuildTrade = (typeof GUILD_TRADES)[number];

export const TREATY_KINDS = ["non_aggression", "mutual_defense", "trade", "tribute", "service"] as const;
export type TreatyKind = (typeof TREATY_KINDS)[number];

export const ROLES = [
  "ruler",
  "lord",
  "mayor",
  "village head",
  "elder",
  "noble",
  "captain",
  "merchant",
  "smith",
  "priest",
  "farmer",
  "hunter",
  "adventurer",
  "guildmaster",
  "bandit chief",
  "bandit",
  "rebel",
  "beast",
  // The ordinary folk of any place (the talkers and the crowd on the map).
  "guard",
  "innkeeper",
  "apprentice",
  "child",
  "miner",
  "carter",
  "commoner",
] as const;
export type Role = (typeof ROLES)[number];

const tier = z.enum(ITEM_TIERS);
const unit = z.number().min(0).max(1);
const pos = z.object({ x: z.number(), y: z.number() });

/**
 * A party to a treaty or a war: "k:<kingdom>", "s:<settlement>", "f:<faction>"
 * or "p:<figure>" (a person can swear service to a kingdom, or a pact with a village).
 */
export const PartySchema = z.string().regex(/^[ksfp]:[a-z0-9_-]+$/);
export type Party = z.infer<typeof PartySchema>;

export const LifeSchema = z.object({
  tier,
  potential: tier,
  xp: z.number(),
  bornOnDay: z.number().int(),
  growth: z.object({ maxHp: z.number(), maxMp: z.number(), attributes: z.record(z.string(), z.number()) }),
  stage: z.enum(["young", "adult", "elder", "venerable"]),
  titles: z.array(z.object({ id: z.string(), day: z.number().int() })),
  fightsWon: z.number().int(),
});

/** A venture a figure led or went on (N69): a raid, a war, a takeover, a delve. */
export const VentureSchema = z.object({
  day: z.number().int(),
  kind: z.string(),
  won: z.boolean(),
  /** They called it (not only went). */
  led: z.boolean().optional(),
  /** Their own side lost more than half. */
  routed: z.boolean().optional(),
});
export type Venture = z.infer<typeof VentureSchema>;

/**
 * The facts a figure's repute rests on (N69): days a condition began to hold (`good`, `bad`, `greedy`, `low`: support ≤ −10),
 * days it stopped (`goodLapse`...), and the deeds counted over the last two years (days, newest last).
 */
export const ReputeSchema = z.object({
  good: z.number().int().optional(),
  bad: z.number().int().optional(),
  greedy: z.number().int().optional(),
  low: z.number().int().optional(),
  lapse: z.record(z.string(), z.number().int()).optional(),
  broke: z.number().int().optional(),
  sacked: z.number().int().optional(),
  weakRaids: z.array(z.number().int()).optional(),
  built: z.array(z.number().int()).optional(),
  punished: z.number().int().optional(),
  generous: z.number().int().optional(),
  caught: z.number().int().optional(),
  took: z.number().int().optional(),
  /** Factions they have had their joining renown from (once each). */
  joined: z.array(z.string()).optional(),
  /** Tax periods of dues unpaid in a row. */
  owes: z.number().int().optional(),
  /** The last season's prosperity of the place they head (for the Greedy). */
  was: z.number().optional(),
});
export type Repute = z.infer<typeof ReputeSchema>;

export const FigureSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  /** "female" / "male": for ruler titles (king or queen) and pronouns in news. */
  gender: z.enum(["female", "male"]),
  species: z.string().min(1),
  role: z.enum(ROLES),
  /** Where they live (settlement id), or null for those out in the wild (beasts, outlaws). */
  home: z.string().nullable(),
  /** Rank, age, XP and titles: the same rules as everyone (game/life.ts). */
  life: LifeSchema,
  /** The traits that matter in the realm. */
  ambition: unit,
  loyalty: unit,
  greed: unit,
  bravery: unit,
  /**
   * Their name, -100..100 (N69): famed above zero, infamous below, unknown near it. Deeds and their followers move it; how
   * widely they are known is its size (`fame` in game/office/repute.ts). Heirs and splits go by it.
   */
  renown: z.number().min(-100).max(100),
  /** Their own coin (copper): loot, wages, shares. */
  wealth: z.number().int().min(0),
  faction: z.string().nullable(),
  /** Who they answer to (a figure id): the hierarchy from a hamlet's elder to the crown. */
  superior: z.string().nullable(),
  /** Parents (figure ids), for heirs. */
  parents: z.array(z.string()).optional(),
  alive: z.boolean(),
  deathDay: z.number().int().optional(),
  deathCause: z.string().optional(),
  /** How they died, typed (N25): `deathCause` keeps the words. */
  death: DeathRecordSchema.optional(),
  /** The townsperson (a `people` id) they rose from, when they were born or lived as one (N25). */
  person: z.string().optional(),
  /** Deeds, newest last (short): "beat the raiders of Ashby", "cleared the Sunken Vault". */
  deeds: z.array(z.string()).default([]),
  /** Rose from the crowd: a creature's uid (a map the player was on) or "crowd". */
  rose: z.string().optional(),
  /** Became a talking NPC (their persona id). */
  talks: z.string().optional(),
  /** Day they came into the realm's record. */
  since: z.number().int(),
  /** The journey they are on (N26 Part E): an adventurer bound for a dungeon is not at home to be picked again. */
  away: z.string().optional(),
  /** What their followers make of them (N69, game/office/support.ts), -20..20: recomputed each season. */
  support: z.number().min(-20).max(20).optional(),
  /** The ventures they led (N69, game/office/ventures.ts), the last six. */
  ventures: z.array(VentureSchema).optional(),
  /** What their name rests on (N69): the facts epithets are awarded from (game/office/epithets.ts). */
  repute: ReputeSchema.optional(),
  /** The notable items they carry (N43: ids in the `notable_items` table), not their whole kit. */
  items: z.array(z.string()).optional(),
});
export type Figure = z.infer<typeof FigureSchema>;

export const ProjectSchema = z.object({ building: z.enum(BUILDINGS), done: z.number().int(), cost: z.number().int() });

export const SettlementSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  kind: z.enum(SETTLEMENT_KINDS),
  kingdom: z.string().nullable(),
  /** The settlement this one pays taxes to (a village to its town, a town to its city...). Null: the crown's seat, or free. */
  liege: z.string().nullable(),
  /** Its head (a figure id): elder, village head, mayor, lord, king or queen. */
  leader: z.string().nullable(),
  pos,
  terrain: z.enum(TERRAINS),
  /** People living there. While its people live (N25) this is a count of them, kept up to date after each day's step. */
  population: z.number().int().min(0),
  /** Houses on its map (game/realm/houses.ts): fixed when the realm is made, more only when the place builds them. */
  houses: z.number().int().min(1).optional(),
  /** 0..100: how well people live. */
  prosperity: z.number().min(0).max(100),
  /** 0..100: how full the granaries are. */
  food: z.number().min(0).max(100),
  /** Copper in the settlement's coffers. */
  treasury: z.number().int().min(0),
  buildings: z.partialRecord(z.enum(BUILDINGS), z.number().int().min(0).max(5)),
  project: ProjectSchema.nullable(),
  /** Share of the treasury paid to the liege every tax day. */
  taxRate: z.number().min(0).max(0.6),
  /** Tax days missed in a row. */
  arrears: z.number().int().min(0),
  /** Last day it was raided, by anyone. */
  lastRaided: z.number().int().optional(),
  /** Day it became free of its liege (broke away), if it did. */
  freeSince: z.number().int().optional(),
  abandoned: z.boolean().optional(),
  /** Roads to other settlements (ids). A waystation has none: it stands beside the road it is on. */
  roads: z.array(z.string()),
  /** Its map's scale (N26H): fixed the first time its map is made, with room for half as many houses again, so homes never move. */
  mapScale: z.number().optional(),
  /** What stood when its map was first made (N26H): the map is laid out from this, so later building never moves anyone's home. */
  mapFrozen: z.object({ buildings: z.partialRecord(z.enum(BUILDINGS), z.number().int().min(0).max(5)), seat: z.boolean(), kind: z.enum(SETTLEMENT_KINDS).optional() }).optional(),
  /** A waystation inn (N26): a hamlet beside a road, `t` tiles along it. */
  way: z.object({ road: z.string(), t: z.number() }).optional(),
  /**
   * The mine watch (N26F decision 13): guards posted on the road to the place's working mine, and sellswords hired when its own
   * guards are too few. `level` 0 (one at the post), 1 (the full watch), 2 (more than it has: hired swords).
   */
  watch: z
    .object({
      guards: z.array(z.string()),
      hired: z.array(z.object({ person: z.string(), from: z.string(), wage: z.number().int(), since: z.number().int(), until: z.number().int() })),
      level: z.number().int().min(0).max(2),
      checked: z.number().int(),
    })
    .optional(),
  /**
   * Its fields (N26G): how many plots its land is cut into (cleared land is never lost; more is cleared as the place grows and
   * its farms rise), and whether its food is its fields' harvest (set by the day's field work; otherwise the old formula).
   */
  fields: z.object({ plots: z.number().int().min(0), kept: z.boolean(), since: z.number().int() }).optional(),
  /** Overrun and held (N26I): by a pack (a lair) or a gang (a stronghold), since `day`. Not abandoned: held. */
  fallen: z.object({ to: z.enum(["pack", "gang"]), id: z.string(), day: z.number().int(), how: z.string() }).optional(),
  /** Who it pays tribute to (N26I): a stronghold's gang id, how much a tribute day, the last day paid, and when it refused. */
  tribute: z.record(z.string(), z.object({ amount: z.number().int(), last: z.number().int(), refused: z.number().int().optional() })).optional(),
  /** Retaken and left empty (N26I): the day; resettled by those who fled it, or a ruin after a year. */
  ruinSince: z.number().int().optional(),
  /** A stronghold's own stores (N26I): what the gang holding it has laid by. */
  stores: z.object({ food: z.number(), coin: z.number().int().min(0), goods: z.record(z.string(), z.number()), livestock: z.record(z.string(), z.number()) }).optional(),
  /**
   * This year's harvest (N30, game/realm/harvest.ts): food brought in from the land (`got`) against what fair weather would
   * have brought (`could`), judged on the first day of winter (`yield`, and `share` of what it could be). `last`: last year's.
   */
  /**
   * The mood of the place (N36, game/mood/model.ts): grief, fear, anger, joy, hope and unease, 0..100, and today's strongest
   * causes; `moodWar`: whether it was at war yesterday (a war begun is a shock).
   */
  mood: z.record(z.string(), z.any()).optional(),
  moodWar: z.boolean().optional(),
  /** A mood standing high since a day without a fresh shock of its kind (N36's bound). */
  moodHigh: z.object({ kind: z.string(), since: z.number().int() }).optional(),
  /** The first day of the hunger it is in now (stores under the famine line), for N30's `no-permanent-famine`. */
  hungrySince: z.number().int().optional(),
  harvest: z
    .object({
      year: z.number().int(),
      got: z.number(),
      could: z.number(),
      yield: z.enum(["poor", "normal", "good"]).optional(),
      share: z.number().optional(),
      last: z.enum(["poor", "normal", "good"]).optional(),
      /** Stores just after the harvest (the first day of winter) and at the end of winter: N30's `harvest-matters`. */
      after: z.number().optional(),
      end: z.number().optional(),
    })
    .optional(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const KingdomSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  capital: z.string(),
  /** Its crown faction. */
  crown: z.string(),
  ruler: z.string().nullable(),
  color: z.string(),
  /** How it feels about other kingdoms, -100..100: raids, broken treaties and wars move it. */
  opinion: z.record(z.string(), z.number().min(-100).max(100)),
  /** War weariness, 0..100. */
  weariness: z.number().min(0).max(100),
  /** What the crown allows (N16): serfs bound to the land, or slaves, or neither. Set when the realm is made. */
  laws: z.object({ slavery: z.boolean(), serfdom: z.boolean() }).default({ slavery: false, serfdom: false }),
  fallen: z.boolean().optional(),
});
export type Kingdom = z.infer<typeof KingdomSchema>;

export const RealmFactionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  kind: z.enum(FACTION_KINDS),
  trade: z.enum(GUILD_TRADES).optional(),
  /** What they stand for, a few words. */
  creed: z.string(),
  leader: z.string().nullable(),
  members: z.array(z.string()),
  /** The settlement they're run from. */
  seat: z.string().nullable(),
  /** Settlements with a branch (guild hall, hideout, chapter). */
  branches: z.array(z.string()),
  wealth: z.number().int().min(0),
  founded: z.number().int(),
  /** The faction it split from. */
  parent: z.string().optional(),
  /** The kingdom, for a crown. */
  kingdom: z.string().optional(),
  /** How it feels about other factions, -100..100. */
  stances: z.record(z.string(), z.number().min(-100).max(100)),
  /** The model wrote its name and creed (director), over code's fallback. */
  named: z.boolean().optional(),
  dissolved: z.number().int().optional(),
  /** 0..100 (N69, game/office/prestige.ts): what belonging to it does for a member's name. */
  prestige: z.number().min(0).max(100).optional(),
  /** While it gathers members (N69, game/office/charter.ts): chartered once `need` have pledged, or it fails at `until`. */
  charter: z.object({ until: z.number().int(), need: z.number().int() }).optional(),
  /** The share of a member's earnings it takes (N69): dues. */
  dues: z.number().min(0).max(0.2).optional(),
  /** The day it fell under its minimum of members (N69); folded after a season. */
  belowMin: z.number().int().optional(),
  /** Townsfolk sworn to it (N69): counted from the people table each day (risers are counted as figures). */
  rows: z.number().int().min(0).optional(),
  /** Its deeds' weight on its prestige (N69), -30..30, fading a season at a time. */
  glory: z.number().optional(),
  /** Shaken by a defeat (N69): until this day a lieutenant is likelier to break away, and its members pay less. */
  shaken: z.number().int().optional(),
  /** Folded into another (N69): its townsfolk follow. */
  mergedInto: z.string().optional(),
});
export type RealmFaction = z.infer<typeof RealmFactionSchema>;

export const TreatySchema = z.object({
  id: z.string(),
  kind: z.enum(TREATY_KINDS),
  a: PartySchema,
  b: PartySchema,
  since: z.number().int(),
  until: z.number().int(),
  /** Tribute: copper a pays b each tax day. Service: wage b pays a. */
  amount: z.number().int().optional(),
  broken: z.object({ by: PartySchema, day: z.number().int() }).optional(),
  why: z.string(),
});
export type Treaty = z.infer<typeof TreatySchema>;

export const BattleSchema = z.object({ day: z.number().int(), at: z.string(), winner: z.enum(["attackers", "defenders"]), losses: z.number().int(), text: z.string() });

export const WarSchema = z.object({
  id: z.string(),
  attackers: z.array(PartySchema),
  defenders: z.array(PartySchema),
  cause: z.string(),
  start: z.number().int(),
  /** -100 (defenders winning) .. 100 (attackers winning). */
  score: z.number().min(-100).max(100),
  battles: z.array(BattleSchema),
  end: z.number().int().optional(),
  outcome: z.string().optional(),
  /** Which side won, once it's over (N36: a victory gladdens the winners' places). */
  winner: z.enum(["attackers", "defenders", "none"]).optional(),
});
export type War = z.infer<typeof WarSchema>;

export const DungeonSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  near: z.string(),
  pos,
  tier,
  /** Levels deep. */
  depth: z.number().int().min(1).max(6),
  /** 0..100: how much lives in it. Grows while nobody clears it; past 80, things come out. */
  danger: z.number().min(0).max(100),
  /** Copper of treasure inside. */
  treasure: z.number().int().min(0),
  clearedUntil: z.number().int().optional(),
  /** Copper the director or a settlement put up for clearing it. */
  bounty: z.number().int().min(0),
  delves: z.number().int().min(0),
});
export type Dungeon = z.infer<typeof DungeonSchema>;

export const PackSchema = z.object({
  id: z.string(),
  species: z.string(),
  /** The settlement whose woods and fields it roams. */
  near: z.string(),
  count: z.number().int().min(0),
  /** How many the land can feed. */
  cap: z.number().int().min(1),
  tier,
  /** A named leader of the pack (a figure), if one has risen. */
  alpha: z.string().nullable(),
  /** Copper put up for culling it. */
  bounty: z.number().int().min(0),
  lastAttack: z.number().int().optional(),
  /**
   * What happened to it since its beasts were last brought in line (N26F decision 14, game/realm/beasts.ts): births and losses,
   * with how, so the day's sync knows which rows to add and which to kill. Cleared by the sync.
   */
  log: z.array(z.object({ day: z.number().int(), born: z.number().int().optional(), lost: z.number().int().optional(), how: z.string(), by: z.string().optional(), victim: z.object({ who: z.string(), name: z.string() }).optional() })).optional(),
});
export type Pack = z.infer<typeof PackSchema>;

export const RealmNewsSchema = z.object({
  id: z.string(),
  day: z.number().int(),
  text: z.string(),
  /** Where it happened (settlement id): each place hears it after the days a traveller takes from there (`reachesAt`). */
  at: z.string().nullable(),
  kind: z.string(),
  /** 1..10. */
  importance: z.number().min(1).max(10),
  /** Names in it that the lore should know (for the invented-name check). */
  names: z.array(z.string()).optional(),
  /** Figures in it (figure ids), filled when it is written, so the admin view needn't match names in text (N17). */
  people: z.array(z.string()).optional(),
  /** The reason behind it, when a choice made it happen: a war's cause, a split's grievance, how a head was picked (N17). */
  why: z.string().optional(),
});
export type RealmNews = z.infer<typeof RealmNewsSchema>;

/** Something the realm sends to a place's own map: raiders tonight, beasts, refugees, a tax collector. */
export const ArrivalSchema = z.object({
  day: z.number().int(),
  kind: z.enum(["raid", "beasts", "refugees", "war_levy", "caravan"]),
  /** Raiders or beasts: how many come; refugees: how many arrive. */
  count: z.number().int().min(0),
  /** Who: a settlement, faction or pack name. */
  by: z.string(),
  /** The raiders by name (N26F step 0b): realm figure ids, the fighters who went. */
  who: z.array(z.string()).optional(),
  /** The settlement the raiders came from, when they are its people (rows picked when the place applies it). */
  from: z.string().optional(),
  /** The place applied it (game/realm/arrivals.ts). */
  done: z.boolean().optional(),
});
export type Arrival = z.infer<typeof ArrivalSchema>;

/**
 * Someone's people died (N25): a raid, a battle, a pack's attack. The fight rolls how many; the day's life
 * step picks who, by cause, so a raid kills the guards and the unlucky and a beast kills the farmers.
 */
export const CasualtyOrderSchema = z.object({
  site: z.string(),
  cause: z.enum(["battle", "siege", "raid", "beast"]),
  count: z.number().int().min(1),
  /** A ref for the event that did it ("raid:34:ashby"), which picks the dead and goes on their records. */
  event: z.string(),
  killer: z.string().optional(),
  day: z.number().int(),
});
export type CasualtyOrder = z.infer<typeof CasualtyOrderSchema>;

/**
 * A post in a place or a faction (N69, game/office/posts.ts), keyed `<inst>|<post>`: who holds it (a figure id, or a `people` id when `row`),
 * since when, what they are worth at it, wages owed, and what they skim (hidden: the true books show it, the public ones don't).
 */
export const OfficeSchema = z.object({
  inst: z.string(),
  post: z.string(),
  holder: z.string().nullable(),
  row: z.boolean().optional(),
  name: z.string().optional(),
  since: z.number().int(),
  /** 0..1: how good they are at it. */
  skill: z.number().min(0).max(1),
  /** Share of income they skim, 0..0.05 (0: honest). */
  skim: z.number().min(0).max(0.05),
  took: z.number().int().min(0),
  unpaid: z.number().int().min(0),
  /** When it fell empty. */
  vacant: z.number().int().optional(),
  /**
   * Held by one of a living place's townsfolk (N69): the realm's numbers read such a post at an ordinary hand's skill (0.5), whoever it
   * is, so a place worked out later moves them the same. Its holder is `townsfolk` until the place's own day names who.
   */
  town: z.boolean().optional(),
});
export type Office = z.infer<typeof OfficeSchema>;

/** One tax period of an institution's books (N69): the period's lines summed, signed copper, closed on `day`. */
export const PeriodSchema = z.object({ day: z.number().int(), lines: z.record(z.string(), z.number()) });
export type Period = z.infer<typeof PeriodSchema>;

export const DirectorPushSchema = z.object({ day: z.number().int(), kind: z.string(), target: z.string(), reason: z.string(), ok: z.boolean() });
export type DirectorPush = z.infer<typeof DirectorPushSchema>;

export const RealmSchema = z.object({
  seed: z.number().int(),
  /** The last day simulated. */
  day: z.number().int(),
  kingdoms: z.record(z.string(), KingdomSchema),
  settlements: z.record(z.string(), SettlementSchema),
  figures: z.record(z.string(), FigureSchema),
  factions: z.record(z.string(), RealmFactionSchema),
  treaties: z.array(TreatySchema),
  wars: z.array(WarSchema),
  dungeons: z.record(z.string(), DungeonSchema),
  packs: z.record(z.string(), PackSchema),
  news: z.array(RealmNewsSchema),
  director: z.array(DirectorPushSchema),
  /** What the realm sends to places' own maps, by place, until the place applies it (game/realm/arrivals.ts). */
  arrivals: z.record(z.string(), z.array(ArrivalSchema)).default({}),
  /** Running counter for ids. */
  next: z.number().int(),
  /** Counts of what happened, for the sim and tests. */
  stats: z.record(z.string(), z.number().int()),
  /** Deaths ordered by fights, waiting for the day's life step (N25). */
  casualties: z.array(CasualtyOrderSchema).default([]),
  /** The director's cooldowns: "kind:target" → the day it may push that again. */
  cooldowns: z.record(z.string(), z.number().int()).default({}),
  /** Everyone on a journey on the open road (N26, game/road/journeys.ts): real people of the `people` table, a formula of time each. */
  journeys: z.array(z.record(z.string(), z.unknown())).default([]),
  /** The counter for journey ids. */
  nextJourney: z.number().int().default(0),
  /**
   * What each place knows of the realm's news (N26 Part E): place → news id → [the day it first heard, the place it was
   * told from, the journey that brought it ("" where it happened)]. Realm-wide, so places the player has never seen hear
   * and pass news on all the same (game/road/exchange.ts).
   */
  heard: z.record(z.string(), z.record(z.string(), z.tuple([z.number().int(), z.string(), z.string()]))).default({}),
  /** Tax coin on its way up the chain (N26 Part E): taken from the payer on tax day, handed over when the lord's clerk arrives (game/road/trips/officials.ts) or, with nobody to carry it, a day later. */
  transit: z.array(z.object({ from: z.string(), to: z.string(), amount: z.number().int(), day: z.number().int(), journey: z.string().optional() })).default([]),
  /**
   * The coin book (plans README section 24, game/realm/ledger.ts): what was minted into the realm and sunk out of it since it
   * began, and the newest ledger lines. Coin is otherwise only moved.
   */
  /** Places broken by an attack today, waiting for the day's people step to see them fall (N26I). */
  falls: z.array(z.object({ site: z.string(), to: z.enum(["pack", "gang"]), id: z.string(), day: z.number().int(), how: z.string() })).default([]),
  coin: z
    .object({
      minted: z.number(),
      sunk: z.number(),
      lines: z.array(z.object({ day: z.number().int(), from: z.string(), to: z.string(), amount: z.number(), why: z.string() })),
    })
    .default({ minted: 0, sunk: 0, lines: [] }),
  /** Letters on their way, carried by travellers (N34, game/follow/letters.ts). */
  letters: z.array(z.any()).optional(),
  /** Fairs, contest days and tournaments announced and held (N41, game/leisure/events.ts): what is coming, and what came of it. */
  leisure: z.any().optional(),
  /** The shared quest market's parties and adventurer grades of realm figures (N42, game/market/). */
  market: z.any().optional(),
  /** Notable items dropped by the dead of the realm's own day, for the people's day to hand on (N43, game/items/notable.ts). */
  drops: z.array(z.object({ item: z.string(), from: z.string(), to: z.string().nullable(), day: z.number().int(), how: z.string(), site: z.string().nullable() })).optional(),
  /** Nemeses of the player (N44, game/nemesis/): who, why, what they know of the player and what they plan. */
  nemeses: z.any().optional(),
  /** Finds in the wilds the player reported to a place's head (N27, game/road/wildPlaces.ts): N63 turns them into mines and expeditions. */
  finds: z.array(z.object({ poi: z.string(), kind: z.string(), name: z.string(), reportedTo: z.string(), day: z.number().int(), paid: z.number().int() })).optional(),
  /** Every post and who holds it (N69, game/office/): `<inst>|<post>` → the office. Heads of places and factions are their `leader`. */
  offices: z.record(z.string(), OfficeSchema).default({}),
  /** Each institution's books by tax period (N69, game/office/treasury.ts), the newest last. */
  books: z.record(z.string(), z.array(PeriodSchema)).default({}),
  /**
   * What the realm's rules did to townsfolk that only the people table can hold (N69): renown to add, grievances to bear. Applied by each
   * place's own day (game/office/day.ts `officesSiteDay`), so a place worked out later gets them on the same day of its life.
   */
  owed: z
    .object({
      /** Renown owed to a townsperson of `site`, from the realm's yearly rules. */
      renown: z.array(z.object({ who: z.string(), site: z.string(), day: z.number().int(), n: z.number() })).default([]),
      /** A grudge: borne by `who`, or by the families of `site`'s dead whose death's event matches one of `causes`. */
      grievances: z.array(z.object({ site: z.string(), day: z.number().int(), who: z.string().optional(), causes: z.array(z.string()).default([]), against: z.string(), cause: z.string(), weight: z.number() })).default([]),
    })
    .optional(),
});
export type Realm = z.infer<typeof RealmSchema>;

/** Population at which a settlement counts as each kind (capitals are set, not grown into). */
export const KIND_POPULATION: Record<Exclude<SettlementKind, "capital">, number> = { hamlet: 0, village: 60, town: 450, city: 1600 };
