import type { AdminSection } from "@millbrook/shared";
import { weightOn } from "../game/chatter/grievance.js";
import { feelings } from "../game/chatter/rel.js";
import type { PersonRow } from "../store/peopleStore.js";
import type { AdminContext } from "./context.js";

/**
 * Who a person feels what about, and what they hold against whom (N37): the strongest relationships first, then their grievances (open
 * ones with what they weigh now, settled ones with the day), each with the event behind it. The revenge they want is in the Outlook
 * section, with its plan.
 */
const MOST_SHOWN = 8;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}`;

export function socialSections(ctx: AdminContext, row: PersonRow): AdminSection[] {
  if (!ctx.store) return [];
  const store = ctx.store;
  const day = ctx.world().day;
  const name = (id: string) => store.people.get(id)?.name ?? id;
  const rels = store.social
    .relsOf(row.id)
    .map((r) => ({ r, v: feelings(r, day) }))
    .sort((a, b) => Math.abs(b.v.trust) + Math.abs(b.v.affection) + Math.abs(b.v.respect) + Math.abs(b.v.fear) - (Math.abs(a.v.trust) + Math.abs(a.v.affection) + Math.abs(a.v.respect) + Math.abs(a.v.fear)) || (a.r.b < b.r.b ? -1 : 1));
  const out: AdminSection[] = [];
  if (rels.length > 0) {
    out.push({
      title: "Relationships",
      rows: rels.slice(0, MOST_SHOWN).map(({ r, v }): [string, string, string] => [name(r.b), `trust ${signed(v.trust)}, affection ${signed(v.affection)}, respect ${signed(v.respect)}, fear ${signed(v.fear)} (last changed day ${r.since})`, `town:${r.b}`]),
    });
  }
  const gs = store.social.grievancesOf(row.id);
  const against = store.social.openAgainst(row.id);
  if (gs.length > 0 || against.length > 0) {
    const rows: Array<[string, string, string?]> = [];
    for (const g of gs) {
      const why = g.cause_ref.startsWith("e:") ? (store.eventById(g.cause_ref.slice(2))?.details ?? g.cause_ref) : g.cause_ref.startsWith("d:") ? `${name(g.cause_ref.slice(2))} died` : g.cause_ref;
      rows.push([`Holds against ${name(g.against)}`, g.settled === null ? `${pct(weightOn(g, day))} now (${pct(g.weight)} on day ${g.since}): ${why}` : `settled on day ${g.settled}: ${why}`, `town:${g.against}`]);
    }
    for (const g of against) rows.push([`${name(g.who)} holds against them`, `${pct(weightOn(g, day))} now, since day ${g.since}`, `town:${g.who}`]);
    out.push({ title: "Grievances", rows });
  }
  return out;
}
