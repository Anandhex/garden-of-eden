import type { PersonRow } from "../../store/peopleStore.js";
import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import { config } from "../../config.js";
import { temperOf } from "../chatter/person.js";
import { addGrievance } from "../chatter/grievance.js";
import { streamFor, unitFor } from "../dice.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { sentencePerson } from "../law/justice.js";
import { travelDays } from "../realm/generate.js";
import { mint } from "../realm/ledger.js";
import { realmNews } from "../realm/log.js";
import { policyAt, setPolicy } from "../realm/policy.js";
import type { Realm } from "../realm/types.js";
import { perDay, seasonDays } from "../weather.js";
import { denOf, guildAt, type DenData, type Rank } from "./guilds.js";

/**
 * Crime at scale (N47 decisions 2, 4–6): a den's thefts in its place each day (a batch: how many from its members, the place's wealth, its
 * guards and any crackdown), each a theft event against a real person (seen by the watch now and then: then it's for the law, N26J/N48);
 * the den's fence sells what was stolen at a markdown to traders from outside (coin comes into the guild: `mint`); smugglers carry goods to
 * places under a curfew or a crackdown where they fetch more, slipping past at night or bribing their way; guards have a price; and when
 * thefts pile up, the crown cracks down (a temporary `crackdown` law) and the watch arrests members.
 */
/** Thefts a member makes a year, before the watch. */
export const THEFTS_A_YEAR = 4;
/** A fence sells this share of what it's worth. */
export const FENCE_SHARE = 0.4;
/** Thefts in a season that make a crown crack down, per thousand people. */
export const CRACKDOWN_AT = 12;
export const CRACKDOWN_DAYS = 12;

const rankOfRow = (r: Pick<PersonRow, "cls">) => CLASS_RANK[r.cls as SocialClass] ?? 2;

/** What a guard needs to look away (N47 decision 5): honesty, loyalty and pay against greed; dearer in a crackdown. In copper. */
export function bribeThreshold(ctx: LifeCtx, guard: PersonRow, day: number): number {
  const t = temperOf(guard);
  const s = ctx.realm.settlements[guard.site];
  const pay = s ? Math.min(2, s.treasury / Math.max(1, s.population) / 2) : 0.5;
  const crack = policyAt(ctx.realm, guard.site, "crackdown", day) === "on" ? 2 : 1;
  // An honest guard has no price at all.
  if (t.honesty > 0.8) return Infinity;
  return Math.round((10 + 60 * t.honesty + 25 * pay - 20 * t.greed) * crack);
}

/** Offer a guard a bribe to look away. Accepted: a bribe event between the two (a secret if nobody saw). Refused: reported, or shaken down. */
export function bribeGuard(ctx: LifeCtx, guard: PersonRow, briber: string, amount: number, what: string, day: number, witnesses: string[] = []): { taken: boolean; reported: boolean; line: string } {
  const need = bribeThreshold(ctx, guard, day);
  const t = temperOf(guard);
  if (amount >= need) {
    recordLifeEvent(ctx.realm, ctx.store, { kind: "bribe", actor: guard.id, target: briber, site: guard.site, day, key: `${guard.id}:${briber}:${what}`, details: `${guard.name} took ${amount} copper to ${what}`, importance: 4, witnesses, why: `wanted ${need}` });
    return { taken: true, reported: false, line: `${guard.name} pockets the coin and looks the other way.` };
  }
  if (t.honesty >= 0.5) {
    recordLifeEvent(ctx.realm, ctx.store, { kind: "crime", actor: briber, target: guard.id, site: guard.site, day, key: `${guard.id}:${briber}:refused`, details: `${guard.name} reported an attempt to bribe them`, importance: 3, witnesses: [guard.id], why: "an honest guard" });
    return { taken: false, reported: true, line: `${guard.name} refuses, and calls for the watch.` };
  }
  return { taken: false, reported: false, line: `${guard.name} laughs: "That? Come back with more."` };
}

/** A den's day of thefts and fencing. Returns how many thefts and fenced. */
export function crimeDay(ctx: LifeCtx, site: string, day: number): { thefts: number; caught: number; fenced: number } {
  const { realm, store } = ctx;
  const out = { thefts: 0, caught: 0, fenced: 0 };
  const den = denOf(store, site);
  if (!den || den.ended !== null) return out;
  const guild = realm.factions[den.data.guild];
  if (!guild || guild.dissolved !== undefined) return out;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
  const members = rows.filter((r) => r.faction === guild.id && !r.captive);
  const guards = rows.filter((r) => r.job === "guard");
  const victims = rows.filter((r) => r.faction !== guild.id && r.job !== "child" && rankOfRow(r) >= 2);
  if (members.length === 0 || victims.length === 0) return out;
  const crack = policyAt(realm, site, "crackdown", day) === "on";
  const prosperity = (realm.settlements[site]?.prosperity ?? 50) / 50;
  const watch = Math.min(0.6, (guards.length / Math.max(1, rows.length)) * 8 + (crack ? 0.2 : 0));
  const rng = streamFor(realm.seed, "thefts", site, day);
  let stash = den.data.stash;
  for (const m of members.sort((a, b) => a.id.localeCompare(b.id))) {
    const rank = den.data.ranks[m.id] ?? "footpad";
    if (rank === "fence") continue;
    if (rng() >= perDay(THEFTS_A_YEAR) * (crack ? 0.5 : 1)) continue;
    // A mark: the better off, more often.
    const v = victims[Math.floor(rng() * victims.length)]!;
    const take = Math.round((5 + 8 * rankOfRow(v)) * prosperity * (rank === "master thief" ? 2 : 1));
    const seen = rng() < watch;
    const guard = guards[Math.floor(rng() * Math.max(1, guards.length))];
    if (seen && guard) {
      recordLifeEvent(realm, store, { kind: "theft-caught", actor: m.id, target: v.id, site, day, key: `${m.id}:${v.id}:theft`, details: `${m.name} was caught lifting ${v.name}'s purse`, importance: 4, witnesses: [guard.id], why: `a ${rank} of ${guild.name}` });
      out.caught++;
    } else {
      recordLifeEvent(realm, store, { kind: "theft", actor: m.id, target: v.id, site, day, key: `${m.id}:${v.id}:theft`, details: `${m.name} lifted ${take} copper's worth from ${v.name}`, importance: 3, why: `a ${rank} of ${guild.name}` });
      addGrievance(store, { who: v.id, against: m.id, cause: `theft:${day}`, weight: 0.05, day });
      stash += take;
      out.thefts++;
    }
  }
  // The fence sells what's piled up, a few days at a time, to traders from outside.
  const fence = members.find((m) => den.data.ranks[m.id] === "fence");
  let coin = den.data.coin;
  let fenced = den.data.fenced;
  if (fence && stash >= 30 && day % 3 === 0) {
    const got = Math.round(stash * FENCE_SHARE * (crack ? 0.7 : 1));
    mint(realm, `f:${guild.id}`, got, `stolen goods fenced in ${realm.settlements[site]?.name}`, undefined, day);
    recordLifeEvent(realm, store, { kind: "fenced", actor: fence.id, site, day, key: `${den.id}:fence`, details: `${fence.name} sold ${stash} copper's worth of stolen goods for ${got}`, importance: 2, why: `the fence of ${guild.name}` });
    coin += got;
    fenced += stash;
    stash = 0;
    out.fenced++;
  }
  store.records.patch<DenData>(den.id, { data: { stash, coin, fenced, thefts: den.data.thefts + out.thefts, heat: Math.min(1, den.data.heat + 0.03 * (out.thefts + 2 * out.caught)) } });
  return out;
}

/**
 * Arrests in a crackdown (N47 decision 6): while the crown's `crackdown` law stands, the watch takes members by rank and heat; each goes
 * before the law (N26J's sentence: lockup, fine, flogging...). The guild holds a grudge against whoever informed.
 */
export function arrestsDay(ctx: LifeCtx, site: string, day: number): string[] {
  const { realm, store } = ctx;
  const den = denOf(store, site);
  if (!den || den.ended !== null || policyAt(realm, site, "crackdown", day) !== "on") return [];
  const guild = realm.factions[den.data.guild];
  if (!guild) return [];
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.faction === guild.id && !r.away);
  const out: string[] = [];
  for (const m of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    const rank = den.data.ranks[m.id] ?? "footpad";
    const p = (rank === "footpad" ? 0.06 : rank === "cutpurse" ? 0.05 : 0.03) * (0.5 + den.data.heat);
    if (unitFor(realm.seed, "arrest", m.id, day) >= p) continue;
    recordLifeEvent(realm, store, { kind: "crackdown", actor: m.id, site, day, key: `${m.id}:arrest`, details: `${m.name} of ${guild.name} was taken by the watch in the crackdown`, importance: 4, why: "the crackdown" });
    sentencePerson(realm, store, m, "petty_theft", site, day, streamFor(realm.seed, "arrest-sentence", m.id, day));
    store.people.update(m.id, { faction: null });
    out.push(m.id);
  }
  if (out.length > 0) store.records.patch<DenData>(den.id, { data: { arrests: den.data.arrests + out.length, heat: Math.max(0, den.data.heat - 0.1 * out.length) } });
  return out;
}

/**
 * The realm's day: a crown whose places suffer a run of thefts cracks down for a while (a temporary law, news with the count as the why).
 * Reads the dens' theft counts (records), so it needs the store.
 */
export function crackdownsDay(realm: Realm, store: LifeCtx["store"] | undefined, day: number): void {
  if (!config.society.underworld || !store || day % seasonDays() !== 0) return;
  const counts = new Map<string, { thefts: number; pop: number }>();
  for (const den of store.records.open<DenData>("den")) {
    const s = den.site ? realm.settlements[den.site] : undefined;
    if (!s?.kingdom) continue;
    const seasonThefts = den.data.thefts - ((den.data as DenData & { lastCount?: number }).lastCount ?? 0);
    store.records.patch(den.id, { data: { lastCount: den.data.thefts } });
    const c = counts.get(s.kingdom) ?? { thefts: 0, pop: 0 };
    c.thefts += seasonThefts;
    c.pop += s.population;
    counts.set(s.kingdom, c);
  }
  for (const [k, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const per = (c.thefts / Math.max(1, c.pop)) * 1000;
    if (per < CRACKDOWN_AT) continue;
    const ch = setPolicy(realm, k, "crackdown", "on", day, `${c.thefts} thefts in its towns this season`, day + CRACKDOWN_DAYS);
    if (ch) realm.stats.crackdowns = (realm.stats.crackdowns ?? 0) + 1;
  }
}

/**
 * Smuggling (N47 decision 4): a den with coin sends goods to a place under a curfew or a crackdown, where they fetch more. At night past the
 * curfew, a roll against the patrols (dearer under a crackdown); a guard at the gate may be bribed. A record each run (kind "smuggle").
 */
export function smuggleDay(ctx: LifeCtx, site: string, day: number): string | null {
  const { realm, store } = ctx;
  const den = denOf(store, site);
  if (!den || den.ended !== null || (den.data.lastSmuggle !== undefined && day - den.data.lastSmuggle < 6)) return null;
  const guild = realm.factions[den.data.guild];
  if (!guild) return null;
  // Where goods are dear: a place under a curfew or a crackdown, near.
  const to = (realm.settlements[site]?.roads ?? [])
    .map((id) => realm.settlements[id])
    .filter((s) => s && !s.way && !s.abandoned && (policyAt(realm, s.id, "curfew", day) === "dusk" || policyAt(realm, s.id, "crackdown", day) === "on"))
    .sort((a, b) => a!.id.localeCompare(b!.id))[0];
  if (!to) return null;
  const members = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.faction === guild.id && !r.away && den.data.ranks[r.id] !== "fence");
  const runner = members.sort((a, b) => a.id.localeCompare(b.id))[Math.floor(unitFor(realm.seed, "runner", site, day) * members.length)];
  if (!runner) return null;
  const cargo = 40 + Math.round(60 * unitFor(realm.seed, "cargo", site, day));
  const id = `smuggle:${site}:${day}`;
  const arrives = day + Math.max(1, travelDays(realm, site, to.id));
  store.records.put({ id, kind: "smuggle", site, a: runner.id, b: to.id, since: day, status: "on the road", ended: null, data: { guild: guild.id, from: site, to: to.id, cargo, arrives, curfew: policyAt(realm, to.id, "curfew", day) === "dusk" } });
  store.records.patch<DenData>(den.id, { data: { lastSmuggle: day } });
  return id;
}

/** Smuggling runs that reach their place today: slip past, bribe past, or are caught. */
export function smuggleArrivals(ctx: LifeCtx, day: number): Array<{ id: string; how: string }> {
  const { realm, store } = ctx;
  const out: Array<{ id: string; how: string }> = [];
  for (const run of store.records.open<{ guild: string; from: string; to: string; cargo: number; arrives: number; curfew: boolean }>("smuggle")) {
    if (run.data.arrives > day) continue;
    const runner = run.a ? store.people.get(run.a) : null;
    const to = realm.settlements[run.data.to];
    if (!runner || runner.death !== null || !to) {
      store.records.end(run.id, day, "lost");
      continue;
    }
    const crack = policyAt(realm, to.id, "crackdown", day) === "on";
    const curfew = policyAt(realm, to.id, "curfew", day) === "dusk";
    const rng = streamFor(realm.seed, "smuggle", run.id);
    const guard = (store.people.loadSite(to.id, "full") as PersonRow[]).filter((r) => r.death === null && r.job === "guard").sort((a, b) => a.id.localeCompare(b.id))[Math.floor(rng() * 4)];
    let how: string;
    if (rng() < 0.55 + 0.1 * (temperOf(runner).bravery - 0.5) - (crack ? 0.2 : 0)) how = curfew ? "slipped past the curfew at night" : "slipped past the watch";
    else if (guard && bribeGuard({ realm, store }, guard, runner.id, 30 + Math.round(run.data.cargo / 3), "let smuggled goods past", day).taken) how = `bribed ${guard.name} at the gate`;
    else how = "caught by the watch";
    if (how.startsWith("caught")) {
      if (guard) recordLifeEvent(realm, store, { kind: "crime", actor: runner.id, target: guard.id, site: to.id, day, key: `${run.id}:caught`, details: `${runner.name} was caught smuggling goods into ${to.name}`, importance: 3, witnesses: [guard.id] });
    } else {
      mint(realm, `f:${run.data.guild}`, Math.round(run.data.cargo * (curfew || crack ? 1.6 : 1.1)), `smuggled goods sold in ${to.name}`, undefined, day);
      if (curfew) realmNews(realm, day, to.id, "smuggling", `Goods came into ${to.name} by night, past the curfew.`, 2, [to.name], { why: how });
    }
    store.records.end(run.id, day, how.startsWith("caught") ? "caught" : "delivered", { how });
    out.push({ id: run.id, how });
  }
  return out;
}

export { guildAt };
export type { Rank };
