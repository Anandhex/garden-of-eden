import { findCreature } from "../game/site.js";
import type { AdminCardKind } from "@millbrook/shared";
import { titled } from "../game/realm/figures.js";
import { parseTownsfolkId } from "../game/realm/townsfolk.js";
import type { AdminContext } from "./context.js";
import { townsperson } from "./folk.js";

/**
 * One way to name a person for the admin view (plans README section 6): a ref is
 * `player`, `cast:<id>`, `figure:<id>`, `town:<id>`, `beast:<uid>` or `place:<id>`.
 * The cast, realm figures and townsfolk keep their own ids and stores; refs just say which.
 */

export interface ParsedRef {
  kind: AdminCardKind;
  id: string;
}

const PREFIX: Record<string, AdminCardKind> = { cast: "cast", figure: "figure", town: "townsperson", beast: "beast", place: "place" };

export function parseRef(ref: string): ParsedRef | null {
  if (ref === "player") return { kind: "player", id: "player" };
  const at = ref.indexOf(":");
  const kind = at > 0 ? PREFIX[ref.slice(0, at)] : undefined;
  return kind ? { kind, id: ref.slice(at + 1) } : null;
}

export const refFor = (kind: AdminCardKind, id: string): string => (kind === "player" ? "player" : `${Object.entries(PREFIX).find(([, k]) => k === kind)![0]}:${id}`);

/** The ref for an id as events write it (an actor or target): the player, a cast member, a townsperson, a figure or a creature. */
export function refOfId(ctx: AdminContext, raw: string): string | null {
  if (!raw) return null;
  if (raw === "player") return "player";
  const world = ctx.world();
  if (parseTownsfolkId(raw)) return `town:${raw}`;
  if (world.realm?.figures[raw]) return `figure:${raw}`;
  if (world.npcStates[raw] || ctx.town().personas[raw]) return `cast:${raw}`;
  if (findCreature(world, raw)) return `beast:${raw}`;
  return null;
}

/** The settlement a person belongs to, where that's known. */
export function siteOfRef(ctx: AdminContext, ref: string): string | null {
  const p = parseRef(ref);
  const world = ctx.world();
  if (!p) return null;
  switch (p.kind) {
    case "player":
      return world.player.site ?? null;
    case "place":
      return p.id;
    case "figure":
      return world.realm?.figures[p.id]?.home ?? null;
    case "townsperson":
      return ctx.town().homeSiteOf(p.id);
    case "cast": {
      if (parseTownsfolkId(p.id)) return ctx.town().homeSiteOf(p.id);
      const f = ctx.town().figureOf(p.id);
      return ctx.town().homeSiteOf(p.id) ?? f?.home ?? null;
    }
    case "beast":
      return findCreature(world, p.id)?.site ?? null;
  }
}

/** A person's name from their ref, or the ref itself if they can't be found. */
export function nameOfRef(ctx: AdminContext, ref: string): string {
  const p = parseRef(ref);
  const world = ctx.world();
  if (!p) return ref;
  switch (p.kind) {
    case "player":
      return world.player.name;
    case "place":
      return world.realm?.settlements[p.id]?.name ?? p.id;
    case "figure": {
      const f = world.realm?.figures[p.id];
      return f ? titled(f) : p.id;
    }
    case "cast":
      return ctx.town().personas[p.id]?.name ?? p.id;
    case "townsperson": {
      const persona = ctx.town().personas[p.id];
      if (persona) return persona.name;
      const site = ctx.town().homeSiteOf(p.id);
      return (site && townsperson(ctx, site, p.id)?.person.name) ?? ctx.town().store?.people.get(p.id)?.name ?? p.id;
    }
    case "beast":
      return findCreature(world, p.id)?.creature.name ?? p.id;
  }
}
