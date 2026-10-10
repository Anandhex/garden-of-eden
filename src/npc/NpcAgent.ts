import { config } from "../config.js";
import type { ChatMessage, LLMProvider } from "../llm/provider.js";
import { applyAction, parseAction, toolsFor } from "./actions.js";
import { buildSystemPrompt } from "./persona.js";
import type {
  AppliedAction,
  NpcPersona,
  NpcState,
  TurnResult,
  WorldSnapshot,
} from "./types.js";

export class NpcAgent {
  readonly state: NpcState;
  private readonly system: string;
  /** The conversation so far (without the system prompt). */
  private history: ChatMessage[] = [];

  constructor(
    readonly persona: NpcPersona,
    private readonly llm: LLMProvider,
  ) {
    this.state = {
      mood: "neutral",
      relationship: 0,
      inventory: { ...persona.startingInventory },
      following: false,
      conversationOver: false,
    };
    this.system = buildSystemPrompt(persona);
  }

  /** Per-turn context. Changing state goes here, not in the system prompt. */
  private buildTurnMessage(playerLine: string, world: WorldSnapshot): string {
    // TODO(Step 5): include mood, relationship, inventory with prices, location,
    // time of day, recent events, and the player's gold, e.g. as a <world_state> JSON block.
    void world;
    return playerLine;
  }

  /**
   * Run one player turn: get the NPC's reply, apply any actions it takes,
   * and loop until it has said something.
   */
  async respond(
    playerLine: string,
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
  ): Promise<TurnResult> {
    this.history.push({
      role: "user",
      content: this.buildTurnMessage(playerLine, world),
    });

    let text = "";
    const actions: AppliedAction[] = [];

    for (let step = 0; step < config.maxStepsPerTurn; step++) {
      const result = await this.llm.chat(
        {
          system: this.system,
          messages: this.history,
          tools: toolsFor(this.state, world),
        },
        (delta) => {
          text += delta;
          onText(delta);
        },
      );
      this.history.push({
        role: "assistant",
        content: result.text,
        toolCalls: result.toolCalls,
      });

      // TODO(Step 2): push the assistant reply into history:
      //   { role: "assistant", content: result.text, toolCalls: result.toolCalls }
      //
      // TODO(Step 6): if result.toolCalls is empty, break: the NPC is done talking.
      //   Otherwise, for each call:
      //     const parsed = parseAction(call.name, call.arguments)
      //     const outcome = parsed.ok ? applyAction(parsed, this.state, world)
      //                               : { ok: false, message: `Invalid action: ${parsed.error}` }
      //     record it in `actions`, and push { role: "tool", toolName: call.name, content: outcome.message }
      //   Then loop again so the NPC can speak about what happened.
      //   (Small models often call a tool with no text; the next round produces the line.)
      void result;
      void parseAction;
      void applyAction;
      break;
    }

    return { text, actions };
  }
}
