import type { PersonRow } from "../../store/peopleStore.js";
import type { Rec } from "../../store/recordStore.js";
import { addGrievance } from "../chatter/grievance.js";
import { viewOf, warmth } from "../chatter/rel.js";
import { unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { lawAt } from "./estate.js";

/**
 * Disputes between heirs (N45 decision 4): when the law and the family disagree. A child passed over by the law who wanted the thing (their
 * ambition was the shop, and they are the better at the trade), a favourite passed over by a will, a second wife against the first wife's
 * children. The lawful heir holds it while the dispute stands; after a few days the head of the place decides (by the law, the claimants'
 * standing and skill, and how the head feels about each: N48's court takes over where there is one), or the two settle (one buys the other
 * out) when they still like each other. The loser holds a large grievance against the winner, and the family's split is news in the place.
 */
export const DISPUTE_DAYS = 3;
/** A loser's grudge against the winner. */
export const LOSER_GRUDGE = 0.9;

export interface DisputeData {
  of: string;
  ofName: string;
  /** What is fought over: "shop:<trade>", "land", "purse". */
  part: string;
  claimants: string[];
  /** Who the law gives it to (holding it while it stands). */
  lawful: string;
  /** Why the other claims it. */
  claim?: string;
  /** The shop's building, for a shop. */
  lot?: number | null;
  figures?: boolean;
  amount?: number;
  winner?: string;
  how?: string;
  heard?: string;
}

export type Dispute = Rec<DisputeData>;

/**
 * Should passing a shop to `heir` be disputed, and by whom? A rival is another of the dead's children who works the same trade and who
 * either wanted to master it (N40's `master_trade` ambition) and is the better hand, or (under a will) was the eldest and was passed over.
 */
export function rivalFor(ctx: LifeCtx, dead: PersonRow, heir: PersonRow, candidates: readonly PersonRow[], trade: string): { rival: PersonRow; claim: string } | null {
  const law = lawAt(ctx.realm, dead.site, heir.stepped_day);
  const kids = new Set(ctx.store.people.childrenOf(dead.id).map((c) => c.id));
  for (const c of candidates) {
    if (c.id === heir.id || !kids.has(c.id)) continue;
    const amb = ctx.store.careers.ambitionOf(c.id);
    const wanted = amb?.kind === "master_trade" && (amb.target === trade || amb.target === null);
    if (wanted && (c.skill ?? 0) > (heir.skill ?? 0)) return { rival: c, claim: `${c.name} wanted the ${trade}'s trade and is the better hand at it` };
    if (law === "chosen" && c.born_day < heir.born_day) return { rival: c, claim: `${c.name} is the eldest, and the will passed them over` };
  }
  return null;
}

/** Record a dispute over a shop. The id is from the dead and the part, so a place worked out later makes the same one. */
export function openDispute(ctx: LifeCtx, o: { dead: PersonRow; heir: PersonRow; rival: PersonRow; part: string; claim: string; lot: number | null; day: number }): Dispute {
  const id = `dispute:${o.dead.id}:${o.part}`;
  const have = ctx.store.records.get<DisputeData>(id);
  if (have) return have;
  const rec: Dispute = {
    id,
    kind: "dispute",
    site: o.dead.site,
    a: o.heir.id,
    b: o.rival.id,
    since: o.day,
    status: "open",
    ended: null,
    data: { of: o.dead.id, ofName: o.dead.name, part: o.part, claimants: [o.heir.id, o.rival.id], lawful: o.heir.id, claim: o.claim, lot: o.lot },
  };
  ctx.store.records.put(rec);
  const e = recordLifeEvent(ctx.realm, ctx.store, {
    kind: "dispute",
    actor: o.rival.id,
    target: o.heir.id,
    site: o.dead.site,
    day: o.day,
    key: id,
    details: `${o.rival.name} disputes ${o.heir.name}'s claim to the ${o.part.replace("shop:", "")} of ${o.dead.name}`,
    importance: 4,
    why: o.claim,
    witnesses: householdOf(ctx, o.dead),
  });
  for (const w of e.witnesses ?? []) learn(ctx, w, eventRef(e.id), { day: o.day, source: "saw", accuracy: 1 });
  ctx.store.records.patch<DisputeData>(id, { data: { heard: e.id } });
  return ctx.store.records.get<DisputeData>(id)!;
}

/** The household and close kin of someone (who knows what the family fights over). */
function householdOf(ctx: LifeCtx, r: PersonRow): string[] {
  const rows = ctx.store.people.loadSite(r.site, "full") as PersonRow[];
  return rows.filter((x) => x.death === null && x.id !== r.id && (x.home === r.home || x.mother === r.id || x.father === r.id || x.id === r.spouse)).map((x) => x.id).sort();
}

/**
 * Today's open disputes in a place, settled or decided once they have stood long enough. `onShop` moves a shop to the winner (N40's books).
 * Returns the disputes ended today.
 */
export function disputesDay(ctx: LifeCtx, site: string, day: number, moveShop: (from: PersonRow, to: PersonRow, d: Dispute) => void): Dispute[] {
  const { realm, store } = ctx;
  const out: Dispute[] = [];
  for (const d of store.records.open<DisputeData>("dispute", (x) => x.site === site && !x.data.figures)) {
    if (day - d.since < DISPUTE_DAYS) continue;
    const [aId, bId] = d.data.claimants as [string, string];
    const a = store.people.get(aId);
    const b = store.people.get(bId);
    if (!a || !b || a.death !== null || b.death !== null) {
      store.records.end(d.id, day, "lapsed", { winner: a && a.death === null ? a.id : b && b.death === null ? b.id : "", how: "a claimant died" });
      continue;
    }
    // They may still settle it between them: one buys the other out.
    const fond = Math.min(viewOf(store, a.id, b.id, day).affection, viewOf(store, b.id, a.id, day).affection);
    let winner: PersonRow;
    let how: string;
    if (fond >= 25) {
      winner = a;
      how = `settled between them: ${b.name} was bought out`;
    } else {
      // The head of the place decides: the law, skill, how they stand with the head, and the head's own dice.
      const head = realm.settlements[site]?.leader ?? null;
      const score = (x: PersonRow) => (x.id === d.data.lawful ? 0.6 : 0) + 0.15 * (x.skill ?? 0) + (head ? warmth(viewOf(store, head, x.id, day)) / 60 : 0) + (x.renown ?? 0) / 100 + 0.5 * unitFor(realm.seed, "dispute", d.id, x.id);
      winner = score(a) >= score(b) ? a : b;
      how = `the head of the place ruled for ${winner.name}`;
    }
    const loser = winner.id === a.id ? b : a;
    if (winner.id !== d.data.lawful) moveShop(a, winner, d);
    addGrievance(store, { who: loser.id, against: winner.id, cause: `dispute:${d.id}`, weight: how.startsWith("settled") ? 0.3 : LOSER_GRUDGE, day });
    const e = recordLifeEvent(realm, store, {
      kind: "dispute",
      actor: winner.id,
      target: loser.id,
      site,
      day,
      key: `${d.id}:end`,
      details: `${winner.name} won the ${d.data.part.replace("shop:", "")} of ${d.data.ofName} from ${loser.name}: ${how}`,
      importance: 5,
      why: how,
      causedBy: d.data.heard ? [d.data.heard] : [],
      witnesses: [winner.id, loser.id],
    });
    for (const w of [winner.id, loser.id]) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    store.records.end(d.id, day, how.startsWith("settled") ? "settled" : "decided", { winner: winner.id, how });
    out.push(store.records.get<DisputeData>(d.id)!);
  }
  return out;
}
