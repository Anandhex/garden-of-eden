import type { QuestTier } from "../game/levels.js";
import type { Life, Tier } from "../game/life.js";
import type { TitleId } from "../game/titles.js";
import type { Equipment } from "../game/gear.js";
import type { NpcStats } from "./stats.js";
import type { Skill, Skills } from "./skills.js";
import type { Attributes } from "./stats.js";
import type { Traits } from "./traits.js";

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
  /** Things the NPC knows and may share. */
  knowledge: string[];
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
  /** Where a shopkeeper keeps stock: a chest or bag with its own slots, on top of their pack (game/gear.ts). */
  storage?: { name: string; slots: number };
  startingInventory: Record<string, number>;
  /** Money (copper) the NPC starts with. Sales and training fees add to it. */
  startingMoney: number;
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

export interface NpcSecret {
  id: string;
  /** If the secret is about a debt, its id: revealing it also says how much is still owed. */
  debt?: string;
  /** A vague hint the model sees once it may reveal the secret, e.g. "a key you forged". */
  about: string;
  /** The secret itself, handed to the model only when revealed. */
  text: string;
}

/** An item the NPC has offered; the sale completes only if the player accepts. */
export interface PendingOffer {
  item: string;
  price: number;
}

/** Dynamic state owned by the game. The model can only change it through actions. */
export interface NpcState {
  mood: Mood;
  /** -100 (enemy) .. 100 (best friend) */
  relationship: number;
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
  text: string;
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
  recentEvents: string[];
  player: PlayerState;
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
  /** Set when the player was killed and config.playerDefeat is "permadeath". The save is over. */
  death?: { day: number; hour: number; killedBy: string };
}

export interface JournalEntry {
  id: string;
  day: number;
  text: string;
}

/** What a quest asks for. Only "deliver" exists for now: it's the one the game can check. */
export interface QuestObjective {
  type: "deliver";
  /** Item name (any tier counts) to bring to the quest giver. */
  item: string;
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
}
