import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { unitFor } from "../dice.js";
import { festivalOn } from "../events-calendar.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { FAMINE } from "../realm/economy.js";
import { travelDays } from "../realm/generate.js";
import { realmNews } from "../realm/log.js";
import { decidePolicy, policyAt, PRESSURES, setPolicy } from "../realm/policy.js";
import type { Realm } from "../realm/types.js";
import { addSecret, knowSecret } from "../secrets/model.js";
import { perDay, seasonDays } from "../weather.js";
import { beliefCell, beliefOf, ensureFaiths, faithFactions, faithOf, faithOfPlace, peekFaith, tenetById, type Reading } from "./model.js";

/**
 * A place's faith on a day (N50): everyone is given the faith of their place (a share of a cult's seat to the cult), a newborn their
 * mother's; preachers (priests and the devout) convert a listener now and then, the more readily where the listener's lot matches the
 * faith's tenets; missionaries arriving from a cult's seat win their first converts; where the kingdom hunts heresy, the zealous denounce
 * the faithful of other creeds (a heresy case before the law, N48), the cult's shrine is burned, and those who keep the faith keep it in
 * secret (N46).
 */
const PREACH_DAILY = 0.05;
const DENOUNCE_DAILY = 0.04;

/** Is a person's lot the kind a tenet's preachers speak to? */
function listens(r: PersonRow, who: string, mood: Record<string, number> | undefined): boolean {
  switch (who) {
    case "poor":
      return r.cls === "commoner" || r.cls === "serf";
    case "bound":
      return r.cls === "serf" || r.cls === "slave";
    case "afraid":
      return (mood?.fear ?? 0) > 30;
    case "grieving":
      return (mood?.grief ?? 0) > 30;
    case "angry":
      return (mood?.anger ?? 0) > 30;
    default:
      return r.cls === "artisan" || r.cls === "merchant";
  }
}

export function faithSiteDay(ctx: LifeCtx, step: Pick<SiteStep, "site" | "births">, day: number): { converted: string[]; denounced: string[] } {
  const out = { converted: [] as string[], denounced: [] as string[] };
  if (!config.society.belief) return out;
  const { realm, store } = ctx;
  const site = step.site;
  const st = peekFaith(realm);
  if (!st || Object.keys(st.faiths).length === 0) return out;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null);
  const home = faithOfPlace(realm, site);
  const cultHere = faithFactions(realm).find((f) => f.kind === "cult" && f.seat === site);
  // ---- Everyone has a faith ----
  for (const r of rows) {
    if (r.faith) continue;
    const mother = r.mother ? store.people.get(r.mother) : null;
    const mb = mother ? beliefOf(mother) : null;
    const u = unitFor(realm.seed, "faith", r.id);
    const faith = mb?.faith ?? (cultHere && u < 0.15 ? cultHere.id : home);
    if (!faith) continue;
    store.people.update(r.id, { faith: beliefCell(faith, mb ? mb.devotion * 0.8 + 0.1 : 0.25 + 0.6 * unitFor(realm.seed, "devotion", r.id)) });
  }
  const now = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
  const mood = realm.settlements[site]?.mood as Record<string, number> | undefined;
  const persecutes = policyAt(realm, site, "heresy", day) === "persecute";
  const state = policyAt(realm, site, "state_faith", day);

  // ---- Missionaries arriving: their first converts ----
  for (const m of st.missions.filter((x) => !x.done && x.to === site && x.arrives <= day)) {
    m.done = true;
    const open = now.filter((r) => r.job !== "child" && (beliefOf(r)?.devotion ?? 0) < 0.5 && beliefOf(r)?.faith !== m.faith).sort((a, b) => unitFor(realm.seed, "mission", m.faith, a.id) - unitFor(realm.seed, "mission", m.faith, b.id)).slice(0, 3);
    for (const r of open) convert(ctx, r, m.faith, m.who, site, day, out.converted, "a missionary from afar");
  }

  // ---- Preaching ----
  const preachers = now.filter((r) => r.job !== "child" && (beliefOf(r)?.devotion ?? 0) >= 0.7 && (r.job === "priest" || r.job === "acolyte" || r.cls === "clergy" || st.faiths[beliefOf(r)!.faith] !== undefined));
  for (const p of preachers) {
    const b = beliefOf(p)!;
    const f = st.faiths[b.faith];
    if (!f) continue;
    const hunted = persecutes && state !== b.faith;
    if (unitFor(realm.seed, "preach", p.id, day) >= PREACH_DAILY * (hunted ? 0.4 : 1)) continue;
    const pool = now.filter((r) => r.id !== p.id && r.job !== "child" && beliefOf(r)?.faith !== b.faith);
    if (pool.length === 0) continue;
    const r = pool[Math.floor(unitFor(realm.seed, "listener", p.id, day) * pool.length)]!;
    const theirs = beliefOf(r)?.devotion ?? 0.3;
    const match = f.tenets.some((t) => listens(r, tenetById(t)?.listens ?? "", mood)) ? 1.6 : 1;
    if (unitFor(realm.seed, "converts", p.id, r.id, day) < (1 - theirs) * 0.5 * match) convert(ctx, r, b.faith, p.id, site, day, out.converted, `${p.name} preached the creed of ${realm.factions[b.faith]?.name ?? "their faith"}`);
  }

  // ---- A cult's seat sends a missionary to a place near, a season at a time ----
  if (cultHere && day % seasonDays() === 0) {
    const believers = now.filter((r) => beliefOf(r)?.faith === cultHere.id && r.job !== "child");
    const near = (realm.settlements[site]?.roads ?? []).map((id) => realm.settlements[id]).filter((s) => s && !s.way && !s.abandoned).sort((a, b) => a!.id.localeCompare(b!.id));
    const to = near[Math.floor(unitFor(realm.seed, "mission-to", site, day) * near.length)];
    const who = believers.sort((a, b) => (beliefOf(b)?.devotion ?? 0) - (beliefOf(a)?.devotion ?? 0) || a.id.localeCompare(b.id))[0];
    if (to && who && !st.missions.some((m) => m.faith === cultHere.id && m.to === to.id && !m.done)) st.missions.push({ faith: cultHere.id, who: who.id, from: site, to: to.id, arrives: day + Math.max(1, travelDays(realm, site, to.id)) });
  }

  // ---- Heresy hunted ----
  if (persecutes && state && state !== "none") {
    const heretics = now.filter((r) => r.job !== "child" && beliefOf(r) && beliefOf(r)!.faith !== state);
    const zealots = now.filter((r) => beliefOf(r)?.faith === state && (beliefOf(r)?.devotion ?? 0) >= 0.7);
    for (const h of heretics) {
      // They keep it secret now.
      const sec = addSecret(store, { site, day, key: `${h.id}:${beliefOf(h)!.faith}`, data: { what: "cult", about: h.id, text: `${h.name} keeps the forbidden faith of ${realm.factions[beliefOf(h)!.faith]?.name ?? "a cult"}`, weight: 6 } });
      knowSecret(ctx, h.id, sec.id, day, "did");
      const z = zealots[Math.floor(unitFor(realm.seed, "zealot", h.id, day) * zealots.length)];
      if (!z || unitFor(realm.seed, "denounce", h.id, day) >= DENOUNCE_DAILY) continue;
      const id = `case:heresy:${h.id}:${day}`;
      store.records.put({ id, kind: "case", site, a: z.id, b: h.id, since: day, status: "open", ended: null, data: { crime: "heresy", accused: h.id, accuser: z.id, witnesses: [z.id] } });
      recordLifeEvent(realm, store, { kind: "persecution", actor: z.id, target: h.id, site, day, key: id, details: `${z.name} denounced ${h.name} for heresy`, importance: 4, why: "the crown hunts heresy" });
      out.denounced.push(h.id);
    }
    // The shrine of a cult seated here is burned, once a season.
    if (cultHere && cultHere.id !== state && day % seasonDays() === 1 && zealots.length > 0) {
      const e = recordLifeEvent(realm, store, { kind: "persecution", actor: zealots[0]!.id, site, day, key: `shrine:${cultHere.id}:${day}`, details: `The shrine of ${cultHere.name} was burned`, importance: 6, witnesses: zealots.slice(0, 4).map((z) => z.id), why: "heresy" });
      for (const z of zealots.slice(0, 4)) learn(ctx, z.id, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    }
  }
  return out;
}

function convert(ctx: LifeCtx, r: PersonRow, faith: string, by: string, site: string, day: number, out: string[], why: string): void {
  ctx.store.people.update(r.id, { faith: beliefCell(faith, 0.5 + 0.3 * unitFor(ctx.realm.seed, "zeal", r.id, day)) });
  const e = recordLifeEvent(ctx.realm, ctx.store, { kind: "conversion", actor: r.id, target: by, site, day, key: `${r.id}:${faith}`, details: `${r.name} took up the faith of ${ctx.realm.factions[faith]?.name ?? "a new creed"}`, importance: 2, why, witnesses: [by] });
  learn(ctx, r.id, eventRef(e.id), { day, source: "did", accuracy: 1 });
  out.push(r.id);
}

// ---- The realm's day: faiths, state faiths, omens and their readings, blame, festival pilgrims ----

/** The court seer of a kingdom: a priest of its state faith living at its capital, else any priest there. */
export function seerOf(realm: Realm, k: string): { id: string; name: string } | null {
  const cap = realm.kingdoms[k]?.capital;
  const f = Object.values(realm.figures).filter((x) => x.alive && x.home === cap && x.role === "priest").sort((a, b) => b.renown - a.renown || a.id.localeCompare(b.id))[0];
  return f ? { id: f.id, name: f.name } : { id: `seer:${k}`, name: `the court seer of ${realm.kingdoms[k]?.name ?? "the kingdom"}` };
}

const OMENS_A_YEAR = 2;

export function faithRealmDay(realm: Realm, day: number): void {
  if (!config.society.belief) return;
  const st = faithOf(realm);
  if (Object.keys(st.faiths).length === 0 || day % seasonDays() === 0) ensureFaiths(realm, day);
  // Each kingdom's state faith is its church, written down quietly the first time.
  for (const k of Object.values(realm.kingdoms)) {
    if (k.fallen || (k.policy?.state_faith && k.policy.state_faith.value !== "none")) continue;
    const church = faithFactions(realm).find((f) => f.kind === "order" && f.seat && realm.settlements[f.seat]?.kingdom === k.id);
    if (church) setPolicy(realm, k.id, "state_faith", church.id, day, `the faith of ${k.name}`, undefined, { quiet: true });
  }
  // ---- Omens ----
  if (unitFor(realm.seed, "omen", day) < perDay(OMENS_A_YEAR)) {
    const kinds = ["a comet in the west", "an eclipse of the sun", "a two-headed calf", "crows flying south in spring", "a bleeding statue"];
    const kind = kinds[Math.floor(unitFor(realm.seed, "omen-kind", day) * kinds.length)]!;
    const places = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned).sort((a, b) => a.id.localeCompare(b.id));
    const at = kind.startsWith("a comet") || kind.startsWith("an eclipse") ? null : places[Math.floor(unitFor(realm.seed, "omen-at", day) * places.length)]!.id;
    const omen = { id: `om${st.next++}`, day, kind, at, text: `${kind[0]!.toUpperCase()}${kind.slice(1)}${at ? ` at ${realm.settlements[at]!.name}` : ""}` };
    st.omens.push(omen);
    realmNews(realm, day, at, "omen", `An omen: ${omen.text}.`, 5, [], { why: "the heavens" });
    readOmen(realm, omen.id, day);
  }
  // ---- Blame: a hungry place's ruler looks for whom to blame: a cult with a foothold there ----
  if (day % 6 === 0) {
    for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!s.kingdom || s.food >= FAMINE || s.way) continue;
      const cult = faithFactions(realm).find((f) => f.kind === "cult" && (f.seat === s.id || f.branches.includes(s.id)));
      if (!cult || policyAt(realm, s.id, "heresy", day) === "persecute") continue;
      const blamed = `${cult.name} blamed for the hunger in ${s.name}`;
      if (realm.news.some((n) => n.text.includes(blamed))) continue;
      realmNews(realm, day, s.id, "faith", `${cult.name} is blamed for the hunger in ${s.name}.`, 4, [cult.name, s.name], { why: "a scapegoat in a crisis" });
      decidePolicy(realm, s.kingdom, "heresy", day, `blame:${cult.id}`, { persecute: 0.5 }, `${cult.name} was blamed for the hunger in ${s.name}`);
    }
  }
  // Keep the record short.
  st.omens = st.omens.slice(-24);
  st.readings = st.readings.filter((r) => day - r.day < 4 * seasonDays());
  st.missions = st.missions.filter((m) => !m.done || day - m.arrives < seasonDays());
}

/** Each court's seer reads an omen in their faith's interest (a table: the faith's first tenet says what it means). */
export function readOmen(realm: Realm, omenId: string, day: number): Reading[] {
  const st = faithOf(realm);
  const out: Reading[] = [];
  for (const k of Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id))) {
    if (k.fallen) continue;
    const faith = policyAt(realm, k.capital, "state_faith", day);
    const f = st.faiths[faith];
    const seer = seerOf(realm, k.id)!;
    const means = f ? (tenetById(f.tenets[0]!)?.reading ?? "repent") : "repent";
    const r: Reading = { omen: omenId, means, seer: seer.id, faith: f ? faith : null, kingdom: k.id, day };
    st.readings.push(r);
    out.push(r);
  }
  return out;
}

/** What a reading means for each law, as pressure on the ruler's choice. */
const MEANS: Record<string, Record<string, Record<string, number>>> = {
  unrest: { purge: { repress: 0.7 }, peace: { concede: 0.7 }, uprising: { concede: 0.4 }, order: { repress: 0.5 }, war: { repress: 0.3 } },
  heresy: { purge: { persecute: 0.7 }, peace: { tolerate: 0.6 }, repent: { persecute: 0.3 } },
  levy: { war: { heavy: 0.7 }, peace: { light: 0.5 } },
  punishments: { purge: { harsh: 0.5 }, peace: { lenient: 0.5 }, order: { harsh: 0.3 } },
};

// The court seer's latest reading weighs on the ruler's decisions (N50 decision 6), by how pious the ruler is.
PRESSURES.push((realm, kingdom, key, day) => {
  const st = peekFaith(realm);
  const r = st?.readings.filter((x) => x.kingdom === kingdom && day - x.day <= seasonDays()).at(-1);
  const p = r ? MEANS[key]?.[r.means] : undefined;
  if (!r || !p) return null;
  const omen = st!.omens.find((o) => o.id === r.omen);
  const seer = realm.figures[r.seer]?.name ?? `the court seer`;
  return { pressures: p, why: `after ${seer} read ${omen ? omen.kind : "the omen"} as a sign of ${r.means}` };
});

/** On a faith's festival, the devout of the places near its holy site go there as pilgrims (N50 decision 7). */
export const isFaithFestival = (day: number): boolean => festivalOn(day) !== null;
