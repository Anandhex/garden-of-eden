/**
 * The world views of the web adapter (G7): the flat one in Phaser (world/, G6) and the 2.5D one in Three.js (iso/).
 * Both draw the same frames and turn clicks into the same intents; this is all `main.ts` knows of either. Which one
 * is this browser's setting (viewPref.ts).
 */
import type { Frame, GameEvent } from "@millbrook/shared/view";
import type { Core, FrameChange } from "../../core";
import type { LookPrefs } from "./world/look";

export interface WorldView {
  frame(change: FrameChange, f: Frame | null): void;
  event(e: GameEvent): void;
  speech(npc: string, text: string | null, opts?: { done?: boolean; filler?: boolean }): void;
  setLook(p: Partial<LookPrefs>): LookPrefs;
  readonly lookNow: LookPrefs;
  /** A key the view handles itself (turning the camera); true if it did. */
  key?(key: string): boolean;
  /** A step key pressed on screen ("up" is up the screen) as a step on the grid, for a view whose camera turns. */
  stepFor?(dx: -1 | 0 | 1, dy: -1 | 0 | 1): { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };
}

export { DEFAULT_VIEW, saveViewPref, VIEW_BOX, viewPref, type ViewKind } from "./viewPref";

export type StartView = (parent: HTMLElement, core: Core) => WorldView;
