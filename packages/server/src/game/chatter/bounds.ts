import type { WorldStore } from "../db.js";
import { config } from "../../config.js";
import { streamFor } from "../dice.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { Realm } from "../realm/types.js";
import type { Bound } from "../road/bounds.js";
import { pickInteraction } from "./pick.js";
import { temperOf } from "./person.js";
import { MAX_RELS } from "./rel.js";
import { weightOn } from "./grievance.js";
import { HOSTILE } from "./types.js";

/**
 * N37's balance bounds (N22 gathers them into one list; until then tests read this). Run once the realm has been going a while.
 *
 * - `insults-rare`: of the exchanges a random pair of grown people would have, under 5% are hostile (a sneer, an insult, a humiliation,
 *   a refusal, a threat), when nobody is in a sour mood. Measured on the real people with no feelings written down, so it is the
 *   picker's own base rate.
 * - `grievances-settle`: of the grievances more than a year old, most (60%) are settled or have faded to under half their weight.
 * - `revenge-bounded`: revenge carried out in a place in a season is a small share of its people (under 2%, and at least 3 allowed).
 * - `relationships-bounded`: nobody keeps more than MAX_RELS views.
 */
export function checkChatterBounds(realm: Realm, store: Pick<WorldStore, "social" | "people" | "dumpTable">, day = realm.day, sample = 2000): Bound[] {
  const out: Bound[] = [];
  // The picker's base rate on real pairs.
  const rows = (store.people.loadSite(
    Object.values(realm.settlements)
      .filter((s) => !s.way && !s.abandoned && store.people.count(s.id) > 30)
      .sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1))[0]?.id ?? "",
    "full",
  ) as PersonRow[]).filter((r) => r.job !== "child" && !r.away);
  if (rows.length >= 4) {
    const rng = streamFor(realm.seed, "chatter-bounds");
    let hostile = 0;
    for (let i = 0; i < sample; i++) {
      const x = rows[Math.floor(rng() * rows.length)]!;
      let y = rows[Math.floor(rng() * rows.length)]!;
      if (y === x) y = rows[(rows.indexOf(x) + 1) % rows.length]!;
      const zero = { trust: 0, affection: 0, respect: 0, fear: 0 };
      const tx = { ...temperOf(x), mood: 0 };
      const ty = { ...temperOf(y), mood: 0 };
      const picked = pickInteraction({ x: { row: x, t: tx }, y: { row: y, t: ty }, viewXofY: zero, viewYofX: zero, hateXofY: 0, hateYofX: 0, kin: false, witnesses: 0, drink: false, bowing: true }, rng);
      if (HOSTILE.has(picked.kind)) hostile++;
    }
    out.push({ name: "insults-rare", ok: hostile / sample < 0.05, detail: `${hostile} of ${sample} sampled exchanges were hostile (${((100 * hostile) / sample).toFixed(1)}%)` });
  } else out.push({ name: "insults-rare", ok: true, detail: "no place big enough to sample" });

  const old = store.social.grievancesBefore(day - config.daysPerYear);
  const gone = old.filter((g) => g.settled !== null || weightOn(g, day) < g.weight / 2).length;
  out.push({ name: "grievances-settle", ok: old.length < 20 || gone / old.length >= 0.6, detail: `${gone} of ${old.length} grievances over a year old are settled or have faded by half` });

  const season = Math.max(1, Math.floor(config.daysPerYear / 4));
  const revenge = store.dumpTable("events").filter((e) => String(e.id).includes("vendetta:") && Number(e.day) > day - season);
  const bySite = new Map<string, number>();
  for (const e of revenge) bySite.set(String(e.site), (bySite.get(String(e.site)) ?? 0) + (String(e.kind) === "new-goal" ? 0 : 1));
  let worst = "";
  let over = 0;
  for (const [site, n] of bySite) {
    const cap = Math.max(3, Math.floor(0.02 * store.people.livingCount(site)));
    if (n > cap) {
      over++;
      worst = `${site}: ${n} (cap ${cap})`;
    }
  }
  out.push({ name: "revenge-bounded", ok: over === 0, detail: over === 0 ? `most revenge in one place this season: ${Math.max(0, ...bySite.values())}` : `over the cap in ${over} places, e.g. ${worst}` });

  const most = store.social.mostRels();
  out.push({ name: "relationships-bounded", ok: most <= MAX_RELS, detail: `most views held by one person: ${most} (cap ${MAX_RELS}); ${store.social.relTotal()} rows` });
  return out;
}
