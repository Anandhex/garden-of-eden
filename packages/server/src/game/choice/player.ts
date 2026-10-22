import { addEmotion } from "../../npc/emotions.js";
import { remember } from "../../npc/memory.js";
import { adjust } from "../../npc/relationship.js";
import { traitsOf } from "../../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../../npc/types.js";
import { EFFECTS } from "../chatter/effects.js";
import { recordEvent, type EventKind } from "../events.js";
import { actionById } from "./registry.js";
import { reasonOf } from "./score.js";
import { rankOfTalker } from "./talker.js";
import type { ChoiceCtx, ChoiceHost, Deed, Other } from "./types.js";

/**
 * The player in the same menu (N38). When the player insults or confronts someone, the action's own `apply` runs with the player as the
 * actor, so the effects and the event are the ones an NPC's choice of the same action has (the same exchange table, the same event kinds
 * and importance). The player does not score or roll: they chose.
 */
export const PLAYER_ACTIONS = ["insult", "confront"] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

/** An event kind the rest of the game already reacts to when the player does it. */
const PLAYER_KIND: Partial<Record<EventKind, EventKind>> = { affront: "insulted", confrontation: "threatened", menace: "threatened" };

export interface PlayerActed {
  ok: boolean;
  message: string;
  event?: string;
}

export function playerMenuAct(action: PlayerAction, persona: NpcPersona, state: NpcState, world: WorldSnapshot): PlayerActed {
  const def = actionById(action);
  if (!def) return { ok: false, message: "You can't do that." };
  const them: Other = {
    id: persona.id,
    name: persona.name,
    place: world.player.place ?? "square",
    rank: rankOfTalker(persona, null),
    hate: 0,
    trust: state.relationship,
    affection: state.affection,
    fear: state.fear,
    protected: false,
    carries: false,
    suitable: false,
    sameFaction: false,
    sells: false,
    restless: false,
  };
  const witnesses = (world.present ?? []).filter((id) => id !== persona.id);
  const ctx: ChoiceCtx = {
    who: "player",
    name: world.player.name,
    kind: "talker",
    grain: "hour",
    day: world.day,
    hour: world.hour,
    site: "",
    habit: { activity: "socialise", place: them.place },
    workPlace: them.place,
    eatPlace: them.place,
    rank: 2,
    traits: { bravery: 0.5, temper: 0.5, honesty: 0.5, sociability: 0.5, forgiveness: 0.5, greed: 0.5, ambition: 0.5 },
    hunger: 0,
    fatigue: 0,
    mood: 0,
    money: world.player.money,
    broke: false,
    stock: 0,
    festival: false,
    storm: false,
    present: [them, ...witnesses.map((id): Other => ({ ...them, id, name: id }))],
    absent: [],
    gatherings: [],
    recruiter: false,
    wantsToLeave: false,
    violence: false,
    last: {},
    streak: null,
    fights: { place: 0, hour: 0 },
  };
  let event: string | undefined;
  let line = "";
  const host: ChoiceHost = {
    seed: 0,
    roll: () => 0.5,
    finishGoal: () => {},
    deed(d: Deed) {
      const fx = d.interaction ? EFFECTS[d.interaction] : null;
      const e = recordEvent(world, { kind: PLAYER_KIND[d.kind] ?? d.kind, actor: "player", target: persona.id, details: d.details.replace(world.player.name, "You"), importance: d.importance + 2, witnesses: [...witnesses], why: reasonOf(d.why), where: world.location });
      event = e.id;
      line = d.details.replace(world.player.name, "You");
      const t = { ...fx?.target, ...d.onTarget };
      for (const axis of ["trust", "affection", "respect", "fear"] as const) if (t[axis]) adjust(state, axis, t[axis]!);
      const traits = traitsOf(persona, state);
      remember(state, { id: `${action}-${world.day}-${world.hour}`, day: world.day, text: `${d.details.replace(world.player.name, "they")}${witnesses.length > 0 ? " in front of others" : ""}`, importance: 5, valence: -1 }, traits);
      addEmotion(state, "resentment", 0.4, `being ${action === "insult" ? "insulted" : "confronted"}${witnesses.length > 0 ? " in front of others" : ""}`, world.day, true);
      return e.id;
    },
  };
  def.apply(ctx, { action, target: persona.id, place: them.place }, [["you chose it", 1]], host);
  return event ? { ok: true, message: `${line}.`, event } : { ok: false, message: "Nothing came of it." };
}
