import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import { ageFrom, isGrown } from "../people/rules.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { decidePolicy, policyAt, PRESSURES } from "../realm/policy.js";
import type { Realm } from "../realm/types.js";
import { sickPlaces } from "../epidemic/model.js";
import { peekCourt } from "../secrets/court.js";
import { beliefOf } from "../faith/model.js";
import { perDay, seasonDays } from "../weather.js";
import { forbiddenHere, giftCell, giftOf, lawOfSchool, magicOf, peekMagic, rollGift, type Gift } from "./model.js";

/**
 * Magic in a place's day (N51): gifts show in childhood (odd things happen; the household and neighbours know); a village's first gifted
 * grown person is its hedge witch; a witch takes a gifted child as an apprentice (unless the law makes the parents hide it); apprentices
 * learn a rank a season; where a school is burned, the zealous denounce those known to work it (a sorcery case before the law), and a
 * witch condemned is burned.
 */
const SHOWS_A_YEAR = 0.5;

/** A person's gift: their cell if they have one, else what they were born with (rolled from their id, and a parent's gift). */
export function giftLevel(ctx: LifeCtx, r: PersonRow): number {
  const g = giftOf(r);
  if (g) return g.gift;
  const parents = [r.mother, r.father].map((p) => (p ? ctx.store.people.get(p) : null)).filter((x): x is PersonRow => !!x);
  const pg = Math.max(0, ...parents.map((p) => giftOf(p)?.gift ?? 0));
  return rollGift(ctx.realm.seed, r.id, pg);
}

export function magicSiteDay(ctx: LifeCtx, step: Pick<SiteStep, "site">, day: number): { shown: string[]; taken: string[]; hunted: string[] } {
  const out = { shown: [] as string[], taken: [] as string[], hunted: [] as string[] };
  if (!config.society.magic) return out;
  const { realm, store } = ctx;
  const site = step.site;
  const s = realm.settlements[site];
  if (!s) return out;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
  const set = (r: PersonRow, g: Gift) => store.people.update(r.id, { gift: giftCell(g) });

  // ---- Gifts show in childhood ----
  for (const r of rows) {
    if (r.job !== "child" || giftOf(r)?.shown !== undefined) continue;
    const g = giftLevel(ctx, r);
    if (g <= 0 || unitFor(realm.seed, "gift-shows", r.id, day) >= perDay(SHOWS_A_YEAR * g)) continue;
    set(r, { ...(giftOf(r) ?? { gift: g, schools: {} }), gift: g, shown: day });
    const household = rows.filter((x) => x.id !== r.id && (x.home === r.home || x.id === r.mother || x.id === r.father)).map((x) => x.id);
    const neighbours = rows.filter((x) => x.home !== r.home && x.job !== "child").slice(0, 2).map((x) => x.id);
    const e = recordLifeEvent(realm, store, { kind: "gift-shown", actor: r.id, site, day, key: r.id, details: `Odd things happen around ${r.name}: the child has the gift`, importance: 4, witnesses: [...household, ...neighbours] });
    for (const w of [...household, ...neighbours]) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    out.shown.push(r.id);
  }

  // ---- A village's hedge witch ----
  const witch = rows.find((r) => giftOf(r)?.role === "hedge");
  if (!witch && s.kind !== "capital" && s.kind !== "city") {
    const first = rows.filter((r) => r.job !== "child" && isGrown(r.species, ageFrom(r.born_day, day)) && giftLevel(ctx, r) >= 1).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (first) set(first, { ...(giftOf(first) ?? { gift: giftLevel(ctx, first), schools: {} }), schools: { healing: 2, growth: 1, ...(giftOf(first)?.schools ?? {}) }, role: "hedge", shown: giftOf(first)?.shown ?? day });
  }
  const teacher = rows.find((r) => giftOf(r)?.role === "hedge");

  // ---- Apprentices: a gifted child shown and untaught goes to the witch (or the family hides it, where the law would burn it) ----
  for (const r of rows) {
    const g = giftOf(r);
    if (!g || g.shown === undefined || g.teacher || g.hidden || !teacher || teacher.id === r.id) continue;
    if (forbiddenHere(realm, site, "healing", day) || lawOfSchool(realm, site, "growth", day) === "burned") {
      set(r, { ...g, hidden: true });
      continue;
    }
    set(r, { ...g, teacher: teacher.id });
    const e = recordLifeEvent(realm, store, { kind: "apprenticed", actor: r.id, target: teacher.id, site, day, key: `${r.id}:witch`, details: `${teacher.name} the hedge witch took ${r.name} as an apprentice`, importance: 4, witnesses: [teacher.id, ...[r.mother, r.father].filter((x): x is string => !!x)] });
    for (const w of [r.id, teacher.id]) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    out.taken.push(r.id);
  }
  // Apprentices learn: a rank a season in their teacher's schools, as far as their gift and their teacher go.
  if (day % seasonDays() === 0) {
    for (const r of rows) {
      const g = giftOf(r);
      const t = g?.teacher ? store.people.get(g.teacher) : null;
      const tg = t ? giftOf(t) : null;
      if (!g || !tg) continue;
      const schools = { ...g.schools };
      for (const [sc, rank] of Object.entries(tg.schools)) schools[sc] = Math.min(rank, g.gift + 1, (schools[sc] ?? 0) + 1);
      set(r, { ...g, schools });
    }
  }

  // ---- Witch hunts: where a school is burned, those known to work it are denounced ----
  for (const r of rows) {
    const g = giftOf(r);
    if (!g || g.hidden || g.shown === undefined || r.job === "child") continue;
    const burned = Object.keys(g.schools).find((sc) => lawOfSchool(realm, site, sc, day) === "burned");
    if (!burned || store.records.has(`case:sorcery:${r.id}`)) continue;
    const zealot = rows.find((x) => x.id !== r.id && x.job !== "child" && (beliefOf(x)?.devotion ?? 0) >= 0.6);
    if (!zealot || unitFor(realm.seed, "witch-hunt", r.id, day) >= 0.25) continue;
    store.records.put({ id: `case:sorcery:${r.id}`, kind: "case", site, a: zealot.id, b: r.id, since: day, status: "open", ended: null, data: { crime: "sorcery", accused: r.id, accuser: zealot.id, witnesses: [zealot.id, ...rows.filter((x) => x.home === r.home && x.id !== r.id && x.job !== "child").slice(0, 3).map((x) => x.id)] } });
    recordLifeEvent(realm, store, { kind: "witch-hunt", actor: zealot.id, target: r.id, site, day, key: `${r.id}:denounced`, details: `${zealot.name} denounced ${r.name} as a witch`, importance: 5, why: `${burned} magic is burned here` });
    out.hunted.push(r.id);
  }
  // A witch condemned to hang is burned.
  for (const e of store.eventsAt(site, day, ["sentence"])) {
    if (!/sorcery/.test(e.details) || !/hanged/.test(e.details)) continue;
    recordLifeEvent(realm, store, { kind: "witch-hunt", actor: e.actor, site, day, key: `${e.actor}:burned`, details: `${store.people.get(e.actor)?.name ?? "A witch"} was burned as a witch`, importance: 7, why: "sorcery" });
  }
  return out;
}

// ---- The realm's day: laws after a plague, court wizards and their divinations, battle mages ----

export function magicRealmDay(realm: Realm, day: number): void {
  if (!config.society.magic) return;
  const st = magicOf(realm);
  // After a plague, a pious and harsh ruler blames the hedge craft: it is burned; a merciful one licenses healers all the more.
  if (day % 6 === 0) {
    for (const site of sickPlaces(realm)) {
      const k = realm.settlements[site]?.kingdom;
      if (!k) continue;
      decidePolicy(realm, k, "magic:beast", day, `plague:${site}:${Math.floor(day / seasonDays())}`, { burned: 0.6, banned: 0.3 }, `after the plague in ${realm.settlements[site]!.name}, witches were blamed`);
    }
  }
  // A court wizard for each crown: a figure of the capital with the gift, made a mage of divination.
  for (const k of Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id))) {
    if (k.fallen) continue;
    const have = Object.entries(st.mages).find(([id, m]) => m.role === "court" && m.kingdom === k.id && realm.figures[id]?.alive);
    if (!have) {
      const f = Object.values(realm.figures).filter((x) => x.alive && x.home === k.capital && !x.talks && x.id !== k.ruler && ["noble", "priest", "merchant", "elder"].includes(x.role) && !st.mages[x.id]).sort((a, b) => unitFor(realm.seed, "wizard", a.id) - unitFor(realm.seed, "wizard", b.id))[0];
      if (f) st.mages[f.id] = { schools: { divination: 3, warding: 2 }, role: "court", kingdom: k.id };
      continue;
    }
    // A divination a season: what the wizard foresees comes from the truth (a war being planned against the realm, a land in turmoil), seen dimly.
    if (day % seasonDays() !== 3) continue;
    const [wid] = have;
    const plans = peekCourt(realm)?.plans.filter((p) => p.against === k.id && !p.done) ?? [];
    const sick = sickPlaces(realm).filter((s) => realm.settlements[s]?.kingdom === k.id);
    const seen = unitFor(realm.seed, "divine", wid, day) < 0.75;
    const means = plans.length > 0 && seen ? "war" : sick.length > 0 && seen ? "purge" : "peace";
    const why = means === "war" ? `${realm.kingdoms[plans[0]!.k]?.name ?? "a neighbour"} means war` : means === "purge" ? "a sickness spreading in the land" : "quiet seasons";
    st.divinations.push({ kingdom: k.id, wizard: wid, means, why, day });
  }
  // Battle mages: a gifted fighter in a town with barracks.
  if (day % seasonDays() === 0) {
    for (const s of Object.values(realm.settlements).filter((x) => (x.buildings.barracks ?? 0) > 0).sort((a, b) => a.id.localeCompare(b.id))) {
      if (Object.entries(st.mages).some(([id, m]) => m.role === "battle" && realm.figures[id]?.alive && realm.figures[id]?.home === s.id)) continue;
      const f = Object.values(realm.figures).filter((x) => x.alive && x.home === s.id && (x.role === "captain" || x.role === "adventurer") && !st.mages[x.id] && rollGift(realm.seed, x.id) >= 1).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (f) st.mages[f.id] = { schools: { fire: 2, warding: 1 }, role: "battle", kingdom: s.kingdom ?? undefined };
    }
  }
  st.divinations = st.divinations.filter((d) => day - d.day < 4 * seasonDays());
}

const MEANS: Record<string, Record<string, Record<string, number>>> = {
  levy: { war: { heavy: 0.8 }, peace: { light: 0.4 } },
  unrest: { purge: { repress: 0.5 }, peace: { concede: 0.4 } },
  heresy: { purge: { persecute: 0.4 } },
};

// A court wizard's divination weighs on the ruler (N51 decision 7), like the seer's reading.
PRESSURES.push((realm, kingdom, key, day) => {
  const d = peekMagic(realm)?.divinations.filter((x) => x.kingdom === kingdom && day - x.day <= seasonDays()).at(-1);
  const p = d ? MEANS[key]?.[d.means] : undefined;
  if (!d || !p) return null;
  return { pressures: p, why: `after ${realm.figures[d.wizard]?.name ?? "the court wizard"}'s divination foresaw ${d.means} (${d.why})` };
});

export { policyAt };
