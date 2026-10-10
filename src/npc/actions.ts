import { z } from "zod";
import type { ToolDef } from "../llm/provider.js";
import { MOODS, type NpcState, type WorldSnapshot } from "./types.js";

/**
 * NPC actions are model *proposals*. The game validates and applies them,
 * then reports the result back so the NPC can react.
 *
 * Lessons from testing qwen3:4b-instruct on this machine:
 * - Offer only the tools that make sense right now (see toolsFor). With a free
 *   `give_item` tool offered, the model "sold" a dagger by giving it away.
 * - Restrict `item` to an enum of what's actually in stock.
 * - Write descriptions that say WHEN to use the tool.
 */

export const changeMoodArgs = z.object({ mood: z.enum(MOODS) });

// TODO(Step 6): add sellItemArgs. Build its `item` enum from the NPC's current
// inventory, e.g. a function sellItemArgs(itemsInStock: [string, ...string[]]).

/** The tools to offer the model this turn, based on the current state. */
export function toolsFor(state: NpcState, world: WorldSnapshot): ToolDef[] {
  void world;
  const tools: ToolDef[] = [
    {
      name: "change_mood",
      description: "Call this whenever the player's words affect how you feel (insults, compliments, threats).",
      parameters: z.toJSONSchema(changeMoodArgs),
    },
  ];

  // TODO(Step 6): if the NPC has anything in stock, add `sell_item`:
  //   description: "Complete a sale: the player pays you gold and you hand over one item.
  //                 Use whenever the player buys something."
  void state;

  return tools;
}

export type ParsedAction =
  | { ok: true; name: "change_mood"; args: z.infer<typeof changeMoodArgs> }
  // TODO(Step 6): | { ok: true; name: "sell_item"; args: ... }
  | { ok: false; error: string };

/** Validate a raw tool call from the model. Never throws. */
export function parseAction(name: string, args: unknown): ParsedAction {
  // TODO(Step 6): look up the schema by name and use schema.safeParse(args).
  // Return { ok: false, error } for unknown tools or bad arguments
  // (z.prettifyError(result.error) gives a readable message to send back to the model).
  void name;
  void args;
  return { ok: false, error: "TODO: parseAction not implemented" };
}

/**
 * Apply a validated action to game state. Mutates `state` and `world.player`.
 * Return a short message for the model, e.g. "Sold dagger for 15 gold."
 * or "Traveler only has 10 gold." (ok: false).
 */
export function applyAction(
  action: Extract<ParsedAction, { ok: true }>,
  state: NpcState,
  world: WorldSnapshot,
): { ok: boolean; message: string } {
  switch (action.name) {
    case "change_mood":
      state.mood = action.args.mood;
      return { ok: true, message: `Your mood is now ${action.args.mood}.` };

    // TODO(Step 6): case "sell_item":
    //   - fail if the NPC doesn't have the item
    //   - fail if the price is below the persona's price (no bargains for now)
    //   - fail if the player can't afford it
    //   - otherwise move gold and the item
  }
  void world;
}
