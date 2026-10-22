import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { eventRef } from "../gossip/refs.js";
import { learn } from "../gossip/knowledge.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { EFFECTS, AMENDS_SHARE } from "./effects.js";
import { addGrievance, easeGrievances } from "./grievance.js";
import { temperOf } from "./person.js";
import { adjustRel } from "./rel.js";
import type { Interaction, InteractionKind } from "./types.js";

/**
 * Making an exchange real (N37): both people's views of each other change, a wrong leaves the wronged a grievance, a notable exchange is
 * an event, and the people who saw it (and the two of them) now know of it, so the gossip of N33 carries it on.
 */
const WHERE: Record<string, string> = { inn: " at the inn", market: " in the market", temple: " at the temple", work: " at work", household: " at home" };

export function describeInteraction(kind: InteractionKind, a: string, b: string, venue?: string, many = false): string {
  const at = venue ? (WHERE[venue] ?? "") : "";
  switch (kind) {
    case "sneer":
      return `${a} sneered at ${b}${at}`;
    case "insult":
      return `${a} insulted ${b}${at}`;
    case "humiliate":
      return `${a} humiliated ${b}${many ? " in front of everyone" : ""}${at}`;
    case "refuse_bow":
      return `${a} would not bow to ${b}${at}`;
    case "refuse_order":
      return `${a} refused to do as ${b} ordered${at}`;
    case "threaten":
      return `${a} threatened ${b}${at}`;
    case "apologise":
      return `${a} apologised to ${b}${at}`;
    default:
      return `${a} spoke with ${b}${at}`;
  }
}

/** How hard a wrong lands on the wronged: pride feels it most, and a slight from someone beneath you cuts deeper than one from above. */
export function sting(target: PersonRow, actor: PersonRow): number {
  const t = temperOf(target);
  const ra = CLASS_RANK[actor.cls as SocialClass] ?? 2;
  const upward = ra < t.rank ? 1 + 0.1 * Math.min(4, t.rank - ra) : 1;
  return (0.7 + 0.8 * t.pride) * upward;
}

export interface Applied {
  interaction: Interaction;
  /** The grievance it left, if any (its weight). */
  grievance: number;
}

/**
 * Apply one exchange. `slot` makes its event id unique among the same pair's exchanges of a day. Returns what came of it (and the
 * interaction with its event), or null if either of them is gone.
 */
export function applyInteraction(ctx: LifeCtx, it: Interaction, slot: string | number): Applied | null {
  const { store, realm } = ctx;
  const a = store.people.get(it.a);
  const b = store.people.get(it.b);
  if (!a || !b || a.death !== null || b.death !== null) return null;
  const fx = EFFECTS[it.kind];
  adjustRel(store, it.b, it.a, fx.target, it.day);
  adjustRel(store, it.a, it.b, fx.actor, it.day);
  let event: string | undefined;
  let grievance = 0;
  if (fx.event) {
    const witnesses = it.witnesses.filter((w) => w !== it.a && w !== it.b);
    const e = recordLifeEvent(realm, store, {
      kind: fx.event.kind,
      actor: it.a,
      target: it.b,
      site: it.site,
      day: it.day,
      details: describeInteraction(it.kind, a.name, b.name, it.venue, witnesses.length >= 3),
      importance: fx.event.importance + (it.kind === "humiliate" && witnesses.length >= 3 ? 1 : 0),
      key: `${it.a}>${it.b}:${slot}`,
      ...(it.minute >= 0 ? { hour: Math.floor(it.minute / 60) } : {}),
      witnesses,
    });
    event = e.id;
    const ref = eventRef(e.id);
    // Those who saw it, and the two of them, now know of it.
    if (config.gossip) for (const who of [it.a, it.b, ...witnesses]) learn(ctx, who, ref, { day: it.day, source: "saw", accuracy: 1 });
    if (fx.grievance > 0) {
      const g = addGrievance(store, { who: it.b, against: it.a, cause: ref, weight: fx.grievance * sting(b, a), day: it.day });
      grievance = g?.weight ?? 0;
    }
  }
  if (it.kind === "apologise") easeGrievances(store, it.b, it.a, AMENDS_SHARE, it.day);
  return { interaction: { ...it, ...(event ? { event } : {}) }, grievance };
}
