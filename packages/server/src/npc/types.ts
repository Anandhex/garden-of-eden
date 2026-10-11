import type { NpcVoice } from "@millbrook/shared";
import type { QuestTier } from "../game/levels.js";
import type { Life, Tier } from "../game/life.js";
import type { TitleId } from "../game/titles.js";
import type { Equipment } from "../game/gear.js";
import type { NpcStats } from "./stats.js";
import type { Skill, Skills } from "./skills.js";
import type { Attributes } from "./stats.js";
import type { Traits } from "./traits.js";
import type { Certainty } from "./knowledge.js";
import type { Activity, PlaceId, ScheduleBlock } from "../game/schedule.js";
import type { Needs } from "../game/needs.js";
import type { Emotion } from "./emotions.js";
import type { Commitment } from "../game/commitments.js";
import type { Belief } from "../game/deception.js";
import type { FavourKind, OwedFavour } from "../game/favours.js";
import type { Commission } from "../game/commissions.js";
import type { ServiceKind } from "../game/services.js";
import type { GameEvent } from "../game/events.js";
import type { RelationAxes } from "./social.js";
import type { HeardRumour, ReputationFact } from "../game/rumours.js";
import type { Dilemma } from "../game/dilemmas.js";
import type { StatusEffect } from "../game/status.js";
import type { Illness, Injury } from "../game/health.js";
import type { CompanionState } from "../game/party.js";
import type { GrowthChallenge, GrowthState } from "./growth.js";
import type { Arc, ArcProgress } from "./arcs.js";
import type { NpcGoal } from "../director/revenge.js";
import type { Crime } from "../game/crime.js";
import type { LoreEntry } from "./knowledge.js";
import type { SpawnRule } from "../game/spawning.js";
import type { DirectorLogEntry } from "../director/validator.js";
import type { DailyPlan } from "../director/planning.js";
import type { FamilyState } from "../game/family.js";

export const MOODS = ["happy", "neutral", "annoyed", "angry", "afraid", "sad"] as const;
export type Mood = (typeof MOODS)[number];

/** Static, authored data loaded from src/data/npcs/*.json. */
export interface NpcPersona {
  id: string;
  name: string;
  role: string;
  /** A key of SPECIES (world/species.ts). Defaults to "human". */
  species?: string;
  /** Age in years at the start of a new world. They age from there (config.daysPerYear). */
  age: number;
  /** Rank at the start of a new world, G to SSS. They grow from there (game/life.ts). */
  tier: Tier;
  /**
   * Highest rank this NPC can ever reach (capped by species). Equal to `tier`
   * means they're at their peak and will never grow.
   */
  potential: Tier;
  personality: string[];
  /**
   * 0 (fair) to 1 (money-hungry). Marks up training fees when trust is low:
   * at trust 0 a greed-1 NPC charges double. Should match the personality.
   */
  greed: number;
  /** Greed once every debt is paid off (defaults to `greed`). Desperate NPCs ease up. */
  greedWhenDebtFree?: number;
  /** Personality traits, 0 to 1. Missing ones default to 0.5. See traits.ts for the rules they drive. */
  traits?: Partial<Traits>;
  speechStyle: string;
  fallbackLine?: string;
  /** Short lines said while the model is slow to answer ("Hmm."), picked at random (G2). */
  fillerLines?: string[];
  /** How the NPC sounds when spoken aloud (T14). Defaults to DEFAULT_VOICE. */
  voice?: NpcVoice;
  backstory: string;
  goals: string[];
  /**
   * Which world lore (src/data/world.json) the NPC knows, and how sure they are, by
   * scope: an exact id, "x.*" or "*". The most specific scope wins. See npc/knowledge.ts.
   */
  knows: Record<string, Certainty>;
  /**
   * Guarded knowledge. Never put in the prompt: the model only learns a secret
   * through the reveal_secret tool, which the game offers only at high trust.
   */
  secrets: NpcSecret[];
  /** HP/MP maximums and attributes (strength, agility, ...). See stats.ts. */
  stats: NpcStats;
  /** Skill proficiencies, 0 (untrained) to 5 (master). Unlisted skills are 0. See skills.ts. */
  skills: Skills;
  /** The one skill this NPC will train others in. Defaults to their best skill. */
  teaches?: Skill;
  /** Highest quest tier this NPC ever gives. Not every NPC has high-level work. */
  maxQuestTier: QuestTier;
  /** Quests written for this NPC. More are made from their needs as play goes on. */
  quests?: QuestDef[];
  /** What the NPC fights with: an item name from ITEMS (game/items.ts) that is a weapon, at or below their rank. */
  weapon: string;
  /** Armour they wear, if any: an item from ITEMS with `armor`, at or below their rank. */
  armor?: string;
  /** Keeps the peace: joins the defence when bandits raid a shop (game/underworld.ts). */
  guard?: boolean;
  /** Killed by the player, they drop their pack and purse for the player to take (NpcAgent). Off for shopkeepers. */
  dropsOnDeath?: boolean;
  /** Where a shopkeeper keeps stock: a chest or bag with its own slots, on top of their pack (game/gear.ts). */
  storage?: { name: string; slots: number };
  startingInventory: Record<string, number>;
  /** Money (copper) the NPC starts with. Sales and training fees add to it. */
  startingMoney: number;
  /** What they look like: build, age, clothes. Visible state (wounds, soot, weapons) is added in code (npc/appearance.ts). */
  appearance?: string;
  /** Habits that show up as situation lines when their condition holds (npc/quirks.ts). */
  quirks?: Quirk[];
  /** Things they're afraid of: a mention or sighting frightens them (npc/triggers.ts). */
  fears?: Trigger[];
  /** Things they love: a mention warms them, and a gift of one is worth more than gold (npc/triggers.ts). */
  loves?: Trigger[];
  /** A child. Never offered romance, and follows config.content.minorsCanBeAttacked (design rule 7). */
  minor?: boolean;
  /** Romance is opt-in per NPC and per player (config.content.romance). Never on a minor. */
  romance?: RomanceRules;
  /** Where they are at each hour (game/schedule.ts). Missing: work 6-20 at home, supper, sleep 21-6. */
  schedule?: ScheduleBlock[];
  /** One rule-based thing they do reliably (game/signature.ts). */
  signature?: Signature;
  /** Services they sell (game/services.ts), on top of goods. */
  services?: ServiceDef[];
  /** Items the NPC will buy from the player. Each must be in ITEMS (game/items.ts). */
  buys: string[];
  /** Money the NPC owes. They pay it down with money above `reserveMoney` whenever they earn. */
  debts?: NpcDebt[];
  /** Money (copper) kept back for running their business before paying debts. Default 2 gold. */
  reserveMoney?: number;
  /**
   * Price in copper for each kind of item the NPC sells, at that item's base tier
   * (keyed by plain name). Other tiers scale by TIER_VALUE_STEP.
   */
  prices: Record<string, number>;
  /** How they feel about other NPCs at the start, by NPC id (npc/social.ts). Unlisted: strangers. */
  relationships?: Record<string, Partial<RelationAxes>>;
  /** What folk say about this NPC, true or not (game/rumours.ts). Others pass it on through gossip. */
  reputationFacts?: ReputationFact[];
  /** Choices this NPC puts to the player, each with a cost (game/dilemmas.ts). */
  dilemmas?: Dilemma[];
  /** The faction they belong to (src/data/factions/*.json). */
  faction?: string;
  /** Who takes over their place and trade when they die (game/succession.ts): another NPC file's id. */
  successor?: string;
  /** Set on a successor: they stay out of the world until this NPC dies. */
  successorOf?: string;
  /** Hire them to come along (game/party.ts): wage per day in copper, and what it takes. */
  hire?: { wage: number; minTrust?: number; minRespect?: number };
  /** Challenges that make them grow (npc/growth.ts), checked in code. */
  growth?: GrowthChallenge[];
  /** Personal goal arcs with stages (npc/arcs.ts). */
  arcs?: Arc[];
  /** Injuries they start with (game/health.ts ids), e.g. a burned hand. */
  injuries?: string[];
  /** Married at the start of a new world (game/family.ts): another NPC file's id, who names them back. */
  spouse?: string;
  /** Their parents (game/family.ts): NPC ids, or "player". Kin never court each other. */
  parents?: string[];
  /** Skills that run in the family: they learn them faster (npc/growth.ts). */
  talents?: Skill[];
  /** Skill tiers a child born in play comes into when they grow up, from their parents (game/family.ts). */
  inherited?: Partial<Record<Skill, number>>;
  /** The template the NPC was made from (npc/templates.ts), if any. */
  template?: string;
  /** Born in play on this day (game/family.ts): their file lives in the save, not in src/data/npcs. */
  bornOnDay?: number;
}

export interface NpcDebt {
  id: string;
  /** Who it's owed to, e.g. "the mayor". */
  creditor: string;
  amount: number;
}

/**
 * What breaks a cover story: an item the player carries, a fact they've learned
 * (another NPC's secret, as "npc.secret"), or a won /persuade or /intimidate today.
 */
export type BreakCondition = { item: string } | { fact: string } | { check: "persuade" | "intimidate" };

export interface NpcSecret {
  id: string;
  /** The lie they tell instead, until the truth is forced out (npc/secrets.ts). */
  cover?: string;
  /** Any one of these breaks the cover story. */
  breaksWith?: BreakCondition[];
  /** Words in the player's line that bring the subject up (shows the cover story as a situation line). */
  keywords?: string[];
  /** If the secret is about a debt, its id: revealing it also says how much is still owed. */
  debt?: string;
  /** A vague hint the model sees once it may reveal the secret, e.g. "a key you forged". */
  about: string;
  /** The secret itself, handed to the model only when revealed. */
  text: string;
}

/** A code condition for a quirk: every field given must hold (npc/quirks.ts). */
export interface QuirkWhen {
  /** What they're doing now (game/schedule.ts). */
  activity?: Activity[];
  /** Where they are now. */
  place?: PlaceId[];
  /** Words in the player's line. */
  topic?: string[];
  /** NPC ids that must be at the same place. */
  nearby?: string[];
  mood?: Mood[];
  /** Hours of the day, from inclusive to exclusive (wraps past midnight). */
  hours?: [number, number];
  /** Below half HP. */
  hurt?: boolean;
}

export interface Quirk {
  when: QuirkWhen;
  /** The situation line, written to the NPC: "You drop your voice whenever money comes up." */
  line: string;
}

/** A person, item, topic or place an NPC reacts to strongly. */
export interface Trigger {
  /** How it's named in situation lines and the journal: "the mayor", "stew". */
  name: string;
  /** Lower-case words that count as a mention. */
  words: string[];
  /** An item (by name) that counts: carried or given by the player. */
  item?: string;
  /** For items: lowest tier that counts ("a well-made blade" is C or better). */
  minTier?: string;
  /** An NPC id that counts when present. */
  npc?: string;
}

export interface RomanceRules {
  open: boolean;
  /** Affection and trust needed for each step (npc/relationship.ts). */
  minAffection?: number;
  minTrust?: number;
}

export type SignatureTrigger = "good_work_day" | "trusted_regular";
export type SignatureEffect = "masterwork" | "hidden_stock";

export interface Signature {
  trigger: SignatureTrigger;
  effect: SignatureEffect;
  /** For hidden_stock: items (keys or names) kept back for trusted regulars. */
  items?: string[];
  /** For trusted_regular: trust needed. */
  minTrust?: number;
  /** How the model narrates it: "a masterwork", "the good salve under the bar". */
  describe: string;
}

export interface ServiceDef {
  kind: ServiceKind;
  /** Price in copper. Repairs and training price themselves in code. */
  price?: number;
}

/** An item the NPC has offered; the sale completes only if the player accepts. */
export interface PendingOffer {
  item: string;
  price: number;
}

/** Dynamic state owned by the game. The model can only change it through actions. */
export interface NpcState {
  mood: Mood;
  /** Hours the mood has lasted away from the player. Past MOOD_HOURS it drifts back to their baseline (npc/emotions.ts). */
  moodHours: number;
  /** Trust in the player: -100 (enemy) .. 100 (complete). Named before the other axes existed. */
  relationship: number;
  /** How scared of the player they are, 0..100 (npc/relationship.ts). */
  fear: number;
  /** How highly they rate the player, -100..100. */
  respect: number;
  /** How much they like the player, -100..100 (friendship and romance). */
  affection: number;
  /** Romance stage reached (0 = none). Only ever above 0 when the content rules allow it. */
  romanceStage: number;
  /** The name they know the player by, and how they learned it (npc/names.ts). */
  knownName: string | null;
  nameSource: { how: "told" | "rumour"; from?: string } | null;
  /** True once they've talked with the player. */
  metBefore: boolean;
  /** Day they last talked with the player. */
  lastMetDay: number | null;
  /** The most notable thing about the player they've already remarked on this encounter (npc/appearance.ts). */
  noticed: string | null;
  /** Days they won a check against the player's pressure ("persuade"/"intimidate"): breaks cover stories that day. */
  wonCheckDay: Partial<Record<"persuade" | "intimidate", number>>;
  /** A grudge blocks trade and training until it fades or the player makes amends (npc/relationship.ts). A blood grudge can't be bought off. */
  grudge: { reason: string; day: number; until: number; blood?: boolean } | null;
  /** The fine the NPC named to settle a grudge; settled only if the player pays. */
  pendingAmends: { fine: number } | null;
  /** Lasting feelings: pride, grief, resentment... (npc/emotions.ts). */
  emotions: Emotion[];
  /** What the player told them that they believed (game/deception.ts). */
  beliefs: Belief[];
  /** Promises the NPC made (game/commitments.ts). */
  commitments: Commitment[];
  /** Favours the player owes this NPC (game/favours.ts). */
  owedFavours: OwedFavour[];
  /** A favour the NPC offered; granted only if the player accepts. */
  pendingFavour: { kind: FavourKind; amount?: number; item?: string; due?: number } | null;
  /** Items the NPC is keeping safe for the player (the hide_item favour). */
  keptForPlayer: Record<string, number>;
  /** A service the NPC offered; done only if the player accepts (game/services.ts). */
  pendingService: { kind: ServiceKind; price: number } | null;
  /** Something the player ordered (game/commissions.ts). */
  commission: Commission | null;
  /** Hunger and energy (game/needs.ts). */
  needs: Needs;
  /** What they're doing and where, for the hour `at` (absolute hour; game/schedule.ts). Null until an hour passes. */
  activity: { activity: Activity; place: PlaceId; why?: string; at: number } | null;
  /** Until when (absolute minute) they're tipsy after an evening at the inn. */
  tipsyUntil: number | null;
  /** Day of a "good work day" (game/signature.ts): the next thing they make is a masterwork. */
  goodDay: number | null;
  /** Last time (absolute minute) each kind of opening line fired (npc/initiative.ts). */
  initiative: Record<string, number>;
  /** Fears and loves already reacted to, by name → day (once a day each). */
  triggerDay: Record<string, number>;
  /** Day of the last gift the player gave them. */
  lastGiftReceivedDay: number | null;
  /** Day another NPC's good word last raised their trust (scene vouching, the vouch favour). */
  vouchedDay: Record<string, number>;
  /** Current health, 0..stats.maxHp. */
  hp: number;
  /** Current mana, 0..stats.maxMp. */
  mp: number;
  inventory: Record<string, number>;
  /** The NPC's purse. Money the player pays (sales, training) ends up here, in copper. */
  money: number;
  conversationOver: boolean;
  pendingOffer: PendingOffer | null;
  /** An offer the NPC made to buy something from the player; completes only if the player accepts. */
  pendingPurchase: PendingOffer | null;
  /** Training the NPC offered; happens (and is paid for) only if the player accepts. */
  pendingTraining: { skill: Skill; hours: number; cost: number } | null;
  /** Ids of secrets already told to the player. */
  revealedSecrets: string[];
  /** Money (copper) still owed on each debt, by debt id. */
  debts: Record<string, number>;
  /** Mean comments in a row that annoyed or angered the NPC. Resets when they calm down. */
  provocations: number;
  /** True once anyone has attacked. */
  inCombat: boolean;
  /** Percent off list prices the NPC will accept (from a successful persuasion or intimidation). */
  discountPct: number;
  /** Haggles the player has lost since the last sale. Each makes the next harder. */
  failedHaggles: number;
  /** Failed /persuade and /intimidate attempts today. Each raises the next target; at the limit they're refused. */
  socialFailures: Record<"persuade" | "intimidate", number>;
  /** The in-game day socialFailures counts for. A new day resets them. */
  socialFailureDay: number;
  /** Secrets a dishonest NPC lied about, by secret id → day. They stick to the lie for the rest of that day. */
  secretLies: Record<string, number>;
  /** Day of the last gift (give_item). At most one a day. */
  lastGiftDay: number | null;
  /**
   * How the conversation ended early. "dead" is permanent: see game/deaths.ts.
   * "knocked out" / "killed player": the NPC beat the player (config.playerDefeat).
   */
  outcome: "fled" | "dead" | "player fled" | "knocked out" | "killed player" | "unconscious" | null;
  /** What happened in the last exchange of blows, shown to the NPC during a fight. */
  lastCombatNote: string | null;
  /** Code-authored facts that survive the encounter and save/load. */
  memories: NpcMemory[];
  /** Quests made from the NPC's needs (e.g. low on iron ore). Written quests are in the persona. */
  questBoard: QuestDef[];
  /** A quest the NPC offered; the player accepts or declines. */
  pendingQuest: string | null;
  /** What the NPC is busy making, if anything. Busy NPCs can't be talked to. */
  job: CraftJob | null;
  /** Rank, XP, age and growth (game/life.ts). */
  life: Life;
  /** What they wear and wield (game/gear.ts). Starts as the persona's weapon and armour. */
  equipment: Equipment;
  /** Why they died, if they did: "old age", or who killed them. */
  deathCause: string | null;
  /** How they feel about other NPCs, by id (npc/social.ts). */
  npcRelations: Record<string, RelationAxes>;
  /** Rumours they've heard about others, by rumour key (game/rumours.ts). */
  rumours: Record<string, HeardRumour>;
  /** A dilemma they put to the player, waiting for /choose (game/dilemmas.ts). */
  pendingDilemma: string | null;
  /** Dilemmas already settled: id → the option chosen. */
  dilemmasDone: Record<string, string>;
  /** Bleeding, stunned, weakened... (game/status.ts). */
  statuses: StatusEffect[];
  /** Lasting injuries (game/health.ts). */
  injuries: Injury[];
  illness: Illness | null;
  /** Knocked out (subdued) until this absolute minute. */
  unconsciousUntil: number | null;
  /** Hired to follow the player (game/party.ts). */
  companion: CompanionState | null;
  /** A hire they offered: done only if the player accepts. */
  pendingHire: { wage: number } | null;
  /** A commission they offered on a trade turn (offer_commission): ordered only if the player accepts. */
  pendingCommission: string | null;
  /** Growth on top of the file: skill XP and tiers, attributes, trait drift (npc/growth.ts). */
  growth: GrowthState;
  /** Where they are in each personal arc (npc/arcs.ts). */
  arcs: Record<string, ArcProgress>;
  /** Goals that come from what happened to them: revenge (director/revenge.ts). */
  goals: NpcGoal[];
  /** Today's plans, made off-screen (director/planning.ts). Flavour only: code never acts on them. */
  plan: DailyPlan | null;
  /** A successor waiting in the wings (persona.successorOf): not in the world yet. */
  dormant: boolean;
  /** Turns of the current fight so far (combat styles open with a war cry: game/abilities.ts). */
  fightRound?: number;
  /** Lore learned in play, on top of the file's `knows` (npc/knowledge.ts): told, overheard or witnessed. */
  learned: Record<string, Certainty>;
}

export interface NpcMemory {
  id: string;
  day: number;
  /**
   * What they remember. Memories with an `importance` are written without a time
   * ("they insulted your forge") and get one when recalled ("Yesterday, ...").
   */
  text: string;
  /** 1-10. Fades with time; bad memories fade at the NPC's forgiveness (npc/memory.ts). Missing: an old memory, shown as it is. */
  importance?: number;
  /** -1 bad, 0 neutral, 1 good (for the player). */
  valence?: -1 | 0 | 1;
  /** Who told them, if they only heard it (gossip). */
  heardFrom?: string;
  /** The event it's about (game/events.ts), so gossip and the director can tell it's the same thing. */
  event?: string;
  /** Recalled from a conversation summary (director/summary.ts), not a code event: colour only. */
  summary?: boolean;
}

/** What the NPC can perceive right now. Rebuilt every turn by the game. */
export interface WorldSnapshot {
  /** Game clock. Use advanceTime() (game/clock.ts) to move it; it keeps timeOfDay in sync. */
  day: number;
  hour: number;
  /** Minutes within the current hour. Older callers may omit this and mean :00. */
  minute?: number;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  location: string;
  nearby: string[];
  /** Today's events, as lore ids (src/data/world.json). Every NPC hears of them. */
  recentEvents: string[];
  player: PlayerState;
  /** Other NPCs (ids) at the same place as this conversation (game/scene.ts). */
  present?: string[];
  /** What was just said in the scene by others, newest last (game/scene.ts). */
  sceneLog?: string[];
  /** Everything meaningful that happened, written by code (game/events.ts). */
  events?: GameEvent[];
  /** The day of the last bandit raid (game/underworld.ts): a raid day for the town calendar. */
  lastRaidDay?: number;
  /** Lore that grew during play (director/chronicle.ts), merged with src/data/world.json. */
  lore?: LoreEntry[];
  /** Day each news id in recentEvents arrived, so news can expire. */
  newsDays?: Record<string, number>;
  /** Spawn rules made during play (director quests, hired ambushes), on top of src/data/spawns.json. */
  extraSpawnRules?: SpawnRule[];
  /** What the director proposed and whether code accepted it (the last few; the rest is in the database). */
  directorLog?: DirectorLogEntry[];
  /** The last day the nightly chronicle ran for. */
  chronicleDay?: number;
  /** Marriages, courtships, children on the way and NPCs born in play (game/family.ts). */
  family?: FamilyState;
  /** Who has died, by NPC id (the permanent record). Set on saved worlds. */
  deaths?: Record<string, unknown>;
}

export interface AppliedAction {
  name: string;
  args: unknown;
  ok: boolean;
  message: string;
  /** Set when a dishonest NPC lied instead of revealing a secret (reveal_secret). */
  lie?: boolean;
}

export interface TurnResult {
  text: string;
  actions: AppliedAction[];
  /** Set when the NPC couldn't be talked to because it's busy (e.g. "forging a dagger until 16:00"). */
  busy?: string;
  /** Set when the player dropped to 0 HP this turn. */
  defeat?: DefeatResult;
  /** Titles the player earned this turn, as lines for them. */
  titles?: string[];
  /** What the player took from an NPC they killed (persona.dropsOnDeath), as lines for them. */
  spoils?: string[];
  /** The model couldn't be reached: the NPC said its fallback line, and nothing else happened. */
  fallback?: boolean;
}

/** What happened when the player lost a fight (config.playerDefeat). */
export interface DefeatResult {
  rule: "knockout" | "permadeath";
  /** Money (copper) the NPC took from the player. */
  moneyTaken: number;
  /** Hours the player was out cold. */
  hoursOut: number;
  /** What the NPC did meanwhile (passTime). */
  log: string[];
  /** For the player. */
  message: string;
}

export interface PlayerState {
  name: string;
  money: number;
  inventory: Record<string, number>;
  hp: number;
  maxHp: number;
  /** Mana for abilities (game/abilities.ts). Older saves have none: they get a pool on load. */
  mp?: number;
  maxMp?: number;
  attributes: Attributes;
  skills: Skills;
  /** Training hours put toward the next level of each skill. */
  skillProgress: Partial<Record<Skill, number>>;
  /** Character level, raised by XP from quests. Gates which quest tiers they can take. */
  level: number;
  /** XP toward the next level. */
  xp: number;
  quests: { active: ActiveQuest[]; completed: string[]; failed?: string[] };
  /** What they wear and wield (game/gear.ts). Optional for older saves. */
  equipment?: Equipment;
  /** Titles earned by deeds (game/titles.ts). Their bonuses are already in `attributes`. */
  titles?: Array<{ id: TitleId; day: number }>;
  /** Fights won (the opponent died, ran or begged), for the Veteran title. */
  fightsWon?: number;
  journal?: JournalEntry[];
  /** Things the player has learned that can break cover stories: "pell.hale_cellar" (npc/secrets.ts). */
  facts?: string[];
  /** The player's own promises, like repaying a loan (game/commitments.ts). */
  commitments?: Commitment[];
  /** Where the player is (game/schedule.ts). CLI: /go. Browser: from the map. */
  place?: PlaceId;
  /** Absolute minute the player last drew blood with their weapon (npc/appearance.ts). */
  bloodiedAt?: number;
  /** NPCs who vouched for the player (the vouch favour), by id. */
  vouchedBy?: string[];
  /** NPCs who promised to warn the player of danger (the warn_me favour), by id. */
  warnedBy?: string[];
  /** Set when the player was killed and config.playerDefeat is "permadeath". The save is over. */
  death?: { day: number; hour: number; killedBy: string };
  /** How the town sees the player, built from what people saw and heard (game/reputation.ts). */
  reputation?: { trust: number; fear: number; respect: number; affection: number };
  /** Copper the guard wants for crimes they know of (game/crime.ts). */
  bounty?: number;
  crimes?: Crime[];
  /** Standing with each faction, -100..100 (game/factions.ts), and the ones they joined. */
  standing?: Record<string, number>;
  factions?: string[];
  /** Goods the player stole, and from whom (game/stealth.ts). Selling them back is risky. */
  stolen?: Array<{ item: string; from: string; day: number }>;
  /** Sneaking at a place until this absolute minute (game/stealth.ts). */
  sneaking?: { place: string; until: number } | null;
  statuses?: StatusEffect[];
  injuries?: Injury[];
  illness?: Illness | null;
  /** Unspent points from levelling up: /raise <attribute> (N9). */
  attributePoints?: number;
  /** Skill practice from use, toward a trial (npc/growth.ts): skill → points. */
  skillUse?: Partial<Record<Skill, number>>;
  /** Things the player made (/craft), by item name with the best tier, for craft quests. */
  crafted?: Array<{ item: string; tier: string; day: number }>;
  /** Items gathered (/forage, /hunt) by place, for gather quests. */
  gathered?: Array<{ item: string; place: string; day: number }>;
}

export interface JournalEntry {
  id: string;
  day: number;
  text: string;
  /** The NPC it's about (persona id), for /journal <npc>. */
  npc?: string;
  /** What kind of note: "secret", "love", "fear", "promise", "name", "quest", "lie", "rumour". */
  kind?: string;
}

/** What a quest asks for. Each type has one checker in code (game/quests.ts). */
export type QuestObjective = DeliverObjective | DefeatObjective | DefeatNpcObjective | GatherObjective | CraftObjective | TalkToObjective | EscortObjective;

/** Win against (or subdue) a named NPC. */
export interface DefeatNpcObjective {
  type: "defeat_npc";
  npc: string;
  qty: 1;
}

/** Gather items yourself (/forage, /hunt) at a place, then bring them. */
export interface GatherObjective {
  type: "gather";
  item: string;
  qty: number;
  place: string;
}

/** Make an item yourself (/craft), at least this tier, and bring it. */
export interface CraftObjective {
  type: "craft";
  item: string;
  qty: number;
  minTier: string;
}

/** Carry a message to another NPC: done when you talk to them. */
export interface TalkToObjective {
  type: "talk_to";
  npc: string;
  /** What to tell them, in the giver's words. */
  message: string;
  qty: 1;
}

/** Bring someone (an NPC id or a creature kind) safely to a place, by a deadline. */
export interface EscortObjective {
  type: "escort";
  who: string;
  to: string;
  qty: 1;
}

export interface DeliverObjective {
  type: "deliver";
  /** Item name (any tier counts) to bring to the quest giver. */
  item: string;
  qty: number;
}

/** Kill or drive off `qty` creatures of a kind (a template id, e.g. "bandit"), then report back. */
export interface DefeatObjective {
  type: "defeat";
  creature: string;
  qty: number;
}

export interface QuestReward {
  money: number;
  /** Defaults to the tier's XP (QUEST_TIER_XP). */
  xp?: number;
  /** Extra trust with the giver. Defaults to 5. */
  trust?: number;
}

/** A quest an NPC can give: written in their file, or made from their needs. */
export interface QuestDef {
  id: string;
  /** Hidden until the NPC respects the player this much (npc/relationship.ts). High tiers need respect too. */
  minRespect?: number;
  /** A favour being returned (game/favours.ts): finishing it clears what the player owes. */
  favour?: boolean;
  title: string;
  /** Why the NPC wants it, in their terms. Shown to the model, not as a quest log. */
  description: string;
  tier: QuestTier;
  /** Hidden until the NPC trusts the player this much. */
  minTrust: number;
  objective: QuestObjective;
  reward: QuestReward;
  /** Quests that must be finished first (a chain). */
  requires?: string[];
  /** Hours from taking it to the deadline. Failing costs trust and respect. */
  deadlineHours?: number;
  /** An injury of the giver's (game/health.ts) this quest's delivery heals. */
  cures?: string;
  /** Only offered with at least this standing with the giver's faction (game/factions.ts). */
  minStanding?: number;
  /** Proposed by the world director (director/chronicle.ts) and checked by code. */
  director?: boolean;
  /** Written by the model (title and description) over a template (director/flavor.ts). */
  flavored?: boolean;
}

export interface ActiveQuest extends QuestDef {
  giverId: string;
  giverName: string;
  /** Day the player took it (the giver asks after it on a later day: npc/initiative.ts). */
  acceptedDay?: number;
  /** Creatures beaten so far, for a defeat objective; things made or gathered, messages carried. */
  progress?: number;
  /** Absolute minute it must be done by (deadlineHours). */
  due?: number;
  /** For escort: the uid of the creature (or the NPC id) being escorted. */
  escortee?: string;
}

/** Something an NPC is making. Inputs are used when it starts; output arrives when it ends. */
export interface CraftJob {
  recipeId: string;
  /** Item key of what comes out, e.g. "iron sword [B]" (tier rolled at the start). */
  output: string;
  qty: number;
  /** Absolute game minute it finishes (see absoluteMinute in game/clock.ts). */
  until: number;
  /** "forging a dagger", for messages. */
  doing: string;
  /** Made for the player's order (game/commissions.ts): set aside when done, not sold. */
  forCommission?: boolean;
  /** Tier steps the inputs added (better ore, better sword: N10). */
  inputBonus?: number;
}
