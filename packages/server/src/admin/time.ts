import type { AdminTimeRequest, AdminTimeResponse } from "@millbrook/shared";
import { logDecision } from "../director/validator.js";
import type { AdminContext } from "./context.js";
import { clockOf } from "./overview.js";

/**
 * The time controls (N17): the one thing the admin view changes. Pause stops the game's
 * clock from running on its own; a step or a fast-forward lets time pass exactly as if
 * the player had waited (the same queue, the same `passHours`). Each use is written to the
 * director's log as an `admin-time` entry, so the event stream shows it.
 */

/** Most days one fast-forward call runs. */
export const MAX_FAST_DAYS = 30;

const note = (ctx: AdminContext, what: string): void => {
  const world = ctx.world();
  logDecision(world, { day: world.day, kind: "admin-time", ok: true, reason: "admin time control", proposal: what }, (e) => ctx.store?.logDirector(e));
};

export async function timeControl(ctx: AdminContext, req: AdminTimeRequest): Promise<AdminTimeResponse> {
  const time = ctx.time;
  const fail = (message: string): AdminTimeResponse => ({ ok: false, message, clock: clockOf(ctx), advanced: 0 });
  if (!time) return fail("Time controls aren't available here.");
  switch (req.action) {
    case "pause":
      time.setPaused(true);
      note(ctx, "paused the clock");
      return { ok: true, message: "Paused: time no longer runs on its own.", clock: clockOf(ctx), advanced: 0 };
    case "resume":
      time.setPaused(false);
      note(ctx, "resumed the clock");
      return { ok: true, message: "Running.", clock: clockOf(ctx), advanced: 0 };
    case "step-hour":
    case "step-day": {
      const hours = req.action === "step-hour" ? 1 : 24;
      await time.advance(hours);
      note(ctx, `stepped ${hours === 1 ? "an hour" : "a day"}`);
      return { ok: true, message: `Stepped ${hours === 1 ? "an hour" : "a day"}.`, clock: clockOf(ctx), advanced: hours };
    }
    case "fast": {
      const days = Math.max(1, Math.min(MAX_FAST_DAYS, Math.floor(req.days ?? 1)));
      for (let d = 0; d < days; d++) await time.advance(24);
      note(ctx, `fast-forwarded ${days} day${days > 1 ? "s" : ""}`);
      return { ok: true, message: `Fast-forwarded ${days} day${days > 1 ? "s" : ""}.`, clock: clockOf(ctx), advanced: days };
    }
    default:
      return fail("Unknown time action.");
  }
}
