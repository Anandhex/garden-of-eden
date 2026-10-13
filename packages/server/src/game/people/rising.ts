import type { SocialClass } from "@millbrook/shared";
import { CLASS_RANK } from "@millbrook/shared";
import { config } from "../../config.js";
import { ITEM_TIERS } from "../items.js";
import { streamFor } from "../dice.js";
import { addDeed, addRenown, killFigure, makeFigure } from "../realm/figures.js";
import { realmNews, tally } from "../realm/log.js";
import type { Figure } from "../realm/types.js";
import { killPerson } from "./index.js";
import type { LifeCtx, SiteStep } from "./step.js";
import { traitsOfRow } from "./traits.js";

/**
 * Rising (N25, generalising N13.6): a young person of promise becomes a realm figure, and a figure who makes
 * enough of a name becomes a talking NPC (game/town.ts `promoteRisers`, with their parents named in their file).
 * Promise is their `potential` (rolled at birth from both parents) and a notable house: a family above the
 * commons, or a parent who is a figure or already talks. The rest is luck, a few in a hundred.
 * Both links are kept: `people.figure`, `figure.person`. Their deaths are one death.
 */
const LUCK = 0.01;

/** Those who came of age today may rise. Returns the figures made. */
export function riseDay(ctx: LifeCtx, step: SiteStep, day: number): Figure[] {
  const { realm, store } = ctx;
  const made: Figure[] = [];
  for (const id of step.grownUp) {
    const r = store.people.get(id);
    if (!r || r.death !== null || r.figure) continue;
    const rng = streamFor(realm.seed, "rise", id, day);
    const traits = traitsOfRow(r);
    const parents = [r.mother, r.father].map((p) => (p ? store.people.get(p) : null));
    const notableHouse = CLASS_RANK[r.cls as SocialClass] >= 3 || parents.some((p) => p && (p.figure || p.persona));
    const promise = ITEM_TIERS.indexOf(traits.potential) >= 2;
    const roll = rng();
    if (!((promise && notableHouse && roll < 0.35) || roll < LUCK)) continue;
    const fig = makeFigure(
      realm,
      rng,
      {
        role: "commoner",
        home: r.site,
        tier: "F",
        potential: traits.potential,
        age: Math.floor((day - r.born_day) / config.daysPerYear),
        gender: r.gender === "female" ? "female" : "male",
        name: r.name,
        faction: r.faction,
        renown: 12,
        rose: `born:${id}`,
        parents: parents.flatMap((p) => (p?.figure ? [p.figure] : [])),
      },
      day,
    );
    // Named by the person, not by a counter, so it is the same whenever the day is worked out (lazy catch-up).
    delete realm.figures[fig.id];
    realm.next--;
    fig.id = `fig-b-${id}`;
    realm.figures[fig.id] = fig;
    fig.person = id;
    addDeed(fig, `grew up in ${realm.settlements[r.site]?.name ?? "the realm"}`);
    store.people.update(id, { figure: fig.id });
    tally(realm, "born_risen");
    realmNews(realm, day, r.site, "risen", `${r.name}, born in ${realm.settlements[r.site]?.name ?? "the realm"}, is a young person worth watching.`, 3, [r.name]);
    made.push(fig);
  }
  return made;
}

/** Each year on their birthday a figure who grew up as a townsperson makes more of a name; and a death on either side is both. */
export function syncRisen(ctx: LifeCtx, day: number): void {
  const { realm, store } = ctx;
  for (const f of Object.values(realm.figures)) {
    if (!f.person) continue;
    const row = store.people.get(f.person);
    if (!row) continue;
    if (f.alive && row.death !== null) killFigure(realm, f, day, "died", {});
    else if (!f.alive && row.death === null) killPerson(realm, store, row.id, { cause: f.death?.cause ?? "accident", day, ...(f.death?.note ? { note: f.death.note } : {}) });
    else if (f.alive && day > row.born_day && (day - row.born_day) % config.daysPerYear === 0) {
      const rng = streamFor(realm.seed, "renown", f.id, day);
      addRenown(f, 4 + Math.floor(rng() * 9));
      addDeed(f, "made a name in their town");
    }
  }
}
