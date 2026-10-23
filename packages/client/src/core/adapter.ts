/**
 * What an engine adapter implements (G5). The core holds the connection and the latest frame and UI; the adapter
 * draws them and turns the player's keys and clicks into intents with `core.send`. A Unity or Unreal adapter is
 * this same shape in C# or C++ (protocol/ADAPTERS.md).
 */
import type { Frame, GameEvent, PromptMsg, SpeechMsg, UiModel } from "@millbrook/shared/view";
import type { Core } from "./index";
import type { FrameChange } from "./mirror";

export interface EngineAdapter {
  start(core: Core): void;
  frame(f: Frame, changed: FrameChange): void;
  event(e: GameEvent): void;
  speech(s: SpeechMsg): void;
  ui(u: UiModel, changed: Array<keyof UiModel>): void;
  /** New lines at the end of the feed (they are in `ui.feed` too). */
  feed(lines: UiModel["feed"]["lines"]): void;
  prompt(p: PromptMsg): void;
  /** Connected, reconnecting, replaced by another window, or a problem to show. */
  status(s: ConnectionStatus): void;
}

export type ConnectionStatus = { state: "open" } | { state: "connecting"; attempt: number } | { state: "replaced" } | { state: "error"; text: string } | { state: "replay"; done: boolean };
