import type { InteractionKind } from "@millbrook/shared";
import type { EventKind } from "../events.js";
import type { Activity, PlaceId } from "../schedule.js";

/**
 * N38: NPCs as living players. One action menu for talkers, townsfolk and (through the same `apply`) the player. Each hour (talkers in the
 * player's place) or day (townsfolk) a person scores every option they have from what they need, want, feel, owe and are like; the pick is
 * a weighted roll whose spread their temperament sets; what they pick is done through the normal systems and leaves an event whose reason
 * is the top parts of the score. Code chooses; the model only narrates.
 */
export type Grain = "hour" | "day";

/** One concrete thing a person could do. */
export interface Option {
  action: string;
  /** Another person's id. */
  target?: string;
  place?: PlaceId;
  item?: string;
}

/** A named part of a score: `["grudge vs Odo", 0.4]`. The parts are the reason. */
export type Part = [string, number];

export interface Scored {
  score: number;
  parts: Part[];
}

/** What a person feels about another one present, the four axes folded to what choosing needs. */
export interface Other {
  id: string;
  name: string;
  /** Where they are this hour (talkers); a townsperson's whole place counts as one. */
  place: PlaceId;
  /** Standing (CLASS_RANK for townsfolk; talkers by their file's class or tier). */
  rank: number;
  /** What they hold against them (open grievances summed, 0..1.5). */
  hate: number;
  trust: number;
  affection: number;
  fear: number;
  /** Nobody may do violence to them (isProtected). */
  protected: boolean;
  /** Has coin or goods worth taking. */
  carries: boolean;
  /** Not married, of an age, and not kin. */
  suitable: boolean;
  /** Belongs to the chooser's faction. */
  sameFaction: boolean;
  /** Keeps a stall or a bar: someone to buy a meal or a drink from. */
  sells: boolean;
  /** Sour enough with their lot to listen to a recruiter. */
  restless: boolean;
}

export interface Temperament {
  bravery: number;
  temper: number;
  honesty: number;
  sociability: number;
  forgiveness: number;
  greed: number;
  ambition: number;
}

/** What a revenge goal says (outlook.goal on a row, an avenge goal for a talker). */
export interface AvengeGoal {
  target: string;
  plan: "ambush" | "confront" | "rumour" | "refuse";
  strength: number;
  reason: string;
  cause?: string;
}

export interface ChoiceCtx {
  who: string;
  name: string;
  kind: "talker" | "townsperson";
  grain: Grain;
  day: number;
  hour: number;
  site: string;
  /** Where they would be this hour by their schedule. */
  habit: { activity: Activity; place: PlaceId; why?: string };
  /** Where they work, and where they eat out. */
  workPlace: PlaceId;
  eatPlace: PlaceId;
  rank: number;
  traits: Temperament;
  /** 0 (fine) .. 1 (starving / dead on their feet). */
  hunger: number;
  fatigue: number;
  /** -3 (miserable) .. 3 (content). */
  mood: number;
  money: number;
  broke: boolean;
  /** Goods they could sell. */
  stock: number;
  festival: boolean;
  storm: boolean;
  /** The others who are about this hour (or this day: in their place), awake and out. */
  present: Other[];
  /** People they hold something against who are not about (a rumour can be told of them). */
  absent: Other[];
  /** Places other people are gathered, most first, for gossip and buying. */
  gatherings: Array<{ place: PlaceId; count: number }>;
  goal?: AvengeGoal;
  /** Where the faction they belong to is looking for people. */
  recruiter: boolean;
  /** Wants to leave (a `move` goal on their outlook). */
  wantsToLeave: boolean;
  /** Violent actions allowed at all (config.choice.violence). */
  violence: boolean;
  /** When each action was last chosen (absolute hour for the hour grain, day for the day grain), for cooldowns. */
  last: Record<string, number>;
  /** The last non-habit action and how many times in a row. */
  streak: { action: string; n: number } | null;
  /** Violent deeds already done in this place this hour/day (caps). */
  fights: { place: number; hour: number };
  /** Only these actions exist (tests, the proto rollout). */
  only?: readonly string[];
}

/** What a chosen action did to the world, through the host. */
export interface Deed {
  kind: EventKind;
  /** A kind of exchange from N37: its table sets the feelings, the grievance and the event (this deed's own numbers add to them). */
  interaction?: InteractionKind;
  actor: string;
  target?: string;
  details: string;
  importance: number;
  /** The score parts that made them do it. */
  why: Part[];
  /** The grievance or need behind it (event ids or refs). */
  causedBy?: string[];
  /** How the target now sees the actor, and the actor the target. */
  onTarget?: Partial<Record<"trust" | "affection" | "respect" | "fear", number>>;
  onActor?: Partial<Record<"trust" | "affection" | "respect" | "fear", number>>;
  /** The grievance this leaves the target against the actor. */
  grievance?: number;
  /** The share of the actor's own open grievances against the target that this settles (revenge, an apology). */
  settles?: number;
  /** Who else saw it. */
  witnesses?: string[];
  /** Coin that changes hands, to the actor (negative: loses it). */
  coin?: number;
  /** The target is hurt: hit points lost by a talker (a knock-out never kills), or left unsaid for a townsperson. */
  harm?: number;
  /** Tell others (rumours): the lie told, who hears it. */
  rumour?: { text: string; hearers: string[] };
  /** A new member of the actor's faction. */
  recruit?: boolean;
  /** They mean to leave the place (a move goal on a townsperson's outlook). */
  leave?: boolean;
  /** The target is knocked senseless for a while (talkers): never killed. */
  knockOut?: boolean;
  /** The target is the one who comes off worse (a fight): the actor takes the harm instead. */
  lost?: boolean;
}

/** How a chosen action reaches the world. A talker's host writes to the world and the talkers' states; a townsperson's to the database. */
export interface ChoiceHost {
  seed: number;
  /** Do a deed: events, feelings, grievances, goods. Returns the event's id. */
  deed(d: Deed): string | undefined;
  /** Settle a revenge goal: it has been acted on. */
  finishGoal(who: string): void;
  /** Roll for the deed from the actor's stream (a chance that must not change other rolls). */
  roll(key: string): number;
}

export interface ActionDef {
  id: string;
  grain: Grain | "both";
  who: "talker" | "townsfolk" | "both";
  violent?: true;
  /** Cooldown between two picks by the same person, in hours (hour grain) or days (day grain). */
  cooldown?: number;
  /** The schedule activities this action stands for: the habit bonus goes to it. */
  habit?: readonly Activity[];
  available(ctx: ChoiceCtx): Option[];
  score(ctx: ChoiceCtx, o: Option): Scored;
  /** Do it. Returns the plan the person follows this hour (talkers) instead of the schedule's, if it changes. */
  apply(ctx: ChoiceCtx, o: Option, why: Part[], host: ChoiceHost): Applied | void;
}

export interface Applied {
  plan?: { activity: Activity; place: PlaceId; why: string };
  /** What the crowd shows a townsperson doing today (day grain): where they go and to whom. */
  intent?: { kind: string; target?: string; place?: PlaceId };
  /** Sell this hour instead of making things. */
  sell?: boolean;
  /** A purchase to make at the place (food, drink). */
  buy?: boolean;
}

/** One scored option, as logged. */
export type Ranked = Option & Scored;

export interface ChoiceLog {
  who: string;
  name: string;
  day: number;
  hour: number;
  grain: Grain;
  options: Ranked[];
  picked: number;
  T: number;
  roll: number;
  habit: boolean;
}
