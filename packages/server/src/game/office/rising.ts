import { config } from "../../config.js";
import type { WorldStore } from "../db.js";
import { streamFor } from "../dice.js";
import { traitsOfRow } from "../people/traits.js";
import { addDeed, makeFigure } from "../realm/figures.js";
import { tally } from "../realm/log.js";
import { recordLifeEvent } from "../people/events.js";
import type { Figure, Realm, Role } from "../realm/types.js";
import type { TitleId } from "../titles.js";
import { TITLES } from "../titles.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { officeOf } from "./posts.js";

/**
 * Rising by renown, good or bad (N69 decision 10). Besides coming of age (people/rising.ts), a townsperson becomes a realm figure when
 * their name is known (fame, |renown|, reaches `RISE_FAME`), when they earn an epithet, or when they are appointed to a post above a
 * village's (a town's treasurer is someone the realm knows of). The figure keeps the row's renown, office and epithet, and both links
 * (`people.figure`, `figure.person`), as risers have now. Called only in the place's own day (it changes the row).
 */
export const RISE_FAME = 25;

/** The figure's role from their work and post. */
function roleOf(row: Pick<PersonRow, "job">, post: string | undefined): Role {
  if (post === "captain" || post === "marshal" || post === "lieutenant") return "captain";
  if (post === "constable") return "guard";
  const byJob: Record<string, Role> = { merchant: "merchant", stallholder: "merchant", smith: "smith", priest: "priest", farmer: "farmer", hunter: "hunter", adventurer: "adventurer", guard: "guard", innkeeper: "innkeeper", miner: "miner", noble: "noble", knight: "captain", apprentice: "apprentice" };
  return byJob[row.job] ?? "commoner";
}

/** A townsperson rises to a figure now. Returns the figure (or the one they already are), or null if they can't (dead, gone). */
export function raiseRow(realm: Realm, store: WorldStore, rowId: string, day: number, why: string): Figure | null {
  const r = store.people.get(rowId);
  if (!r || r.death !== null) return null;
  if (r.figure) return realm.figures[r.figure] ?? null;
  const id = `fig-b-${r.id}`;
  if (realm.figures[id]) return null;
  const rng = streamFor(realm.seed, "rise", r.id, day);
  const traits = traitsOfRow(r);
  const held = officeOf(realm, r.id);
  const fig = makeFigure(
    realm,
    rng,
    {
      role: roleOf(r, held?.post),
      home: r.site,
      tier: (r.skill ?? 0) >= 4 ? "E" : "F",
      potential: traits.potential,
      age: Math.floor((day - r.born_day) / config.daysPerYear),
      gender: r.gender === "female" ? "female" : "male",
      name: r.name,
      faction: r.faction,
      renown: Math.max(-100, Math.min(100, r.renown ?? 0)),
      wealth: 0,
      rose: `repute:${r.id}`,
    },
    day,
  );
  // Named by the person, not by a counter, so it is the same whenever the day is worked out.
  delete realm.figures[fig.id];
  realm.next--;
  fig.id = id;
  realm.figures[id] = fig;
  fig.person = r.id;
  fig.ambition = traits.ambition;
  fig.loyalty = traits.loyalty;
  fig.greed = traits.greed;
  fig.bravery = traits.bravery;
  if (r.faction && realm.factions[r.faction] && !realm.factions[r.faction]!.members.includes(id)) {
    realm.factions[r.faction]!.members.push(id);
    realm.factions[r.faction]!.rows = Math.max(0, (realm.factions[r.faction]!.rows ?? 0) - 1);
  }
  if (r.epithet && r.epithet in TITLES) fig.life.titles.push({ id: r.epithet as TitleId, day });
  if (held) {
    held.holder = id;
    delete held.row;
  }
  addDeed(fig, why);
  store.people.update(r.id, { figure: id });
  tally(realm, "repute_risen");
  placeEvent(realm, store, { kind: "made-a-name", actor: r.id, site: r.site, day, details: `${r.name} of ${realm.settlements[r.site]?.name ?? "the realm"} is a name people know now: ${why}`, importance: 4, key: `rise:${r.id}`, why });
  return fig;
}

/**
 * What happens in a place's own day is told as the place's event, not realm news (N69): realm news takes the realm's id counter and is
 * carried by travellers from the day it is made, so news made when a lazy place is worked out later would not be the daily place's.
 * Gossip carries the event from those who saw it, as it does a shop opened or a seat won.
 */
export function placeEvent(realm: Realm, store: WorldStore, e: { kind: "appointed" | "caught-stealing" | "made-a-name"; actor: string; target?: string; site: string; day: number; details: string; importance: number; key: string; why?: string; witnesses?: string[] }): void {
  recordLifeEvent(realm, store, { kind: e.kind, actor: e.actor, target: e.target ?? "", site: e.site, day: e.day, details: e.details, importance: e.importance, key: e.key, ...(e.why ? { why: e.why } : {}), ...(e.witnesses ? { witnesses: e.witnesses } : {}) });
}
