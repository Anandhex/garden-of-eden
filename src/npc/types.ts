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
  /** A grudge blocks trade and training until it fades or the player makes amends (npc/relationship.ts). */
  grudge: { reason: string; day: number; until: number } | null;
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
  outcome: "fled" | "dead" | "player fled" | "knocked out" | "killed player" | null;
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
  attributes: Attributes;
  skills: Skills;
  /** Training hours put toward the next level of each skill. */
  skillProgress: Partial<Record<Skill, number>>;
  /** Character level, raised by XP from quests. Gates which quest tiers they can take. */
  level: number;
  /** XP toward the next level. */
  xp: number;
  quests: { active: ActiveQuest[]; completed: string[] };
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

/** What a quest asks for. Only "deliver" exists for now: it's the one the game can check. */
export type QuestObjective = DeliverObjective | DefeatObjective;

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
}

export interface ActiveQuest extends QuestDef {
  giverId: string;
  giverName: string;
  /** Day the player took it (the giver asks after it on a later day: npc/initiative.ts). */
  acceptedDay?: number;
  /** Creatures beaten so far, for a defeat objective. */
  progress?: number;
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
}
