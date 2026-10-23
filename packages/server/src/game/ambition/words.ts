import { JOB_INFO, type Job } from "@millbrook/shared";
import { AMBITION_DEFAULTS, type AmbitionRow } from "../../store/careerStore.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { NpcPersona } from "../../npc/types.js";
import type { WorldStore } from "../db.js";
import { streamFor } from "../dice.js";
import type { Realm } from "../realm/types.js";
import { rankOf, shopRoom, placeCareers, type Rank } from "./careers.js";
import { isKind, KINDS, stepWords, topStep, TRADES, wantWords, type AmbitionKind } from "./kinds.js";
import { pickForTalker } from "./pick.js";
import { kingdomLaws } from "../realm/townsfolk.js";
import { ROUTE_WORDS, URGENT_WORDS, urgentOf, type Route, type Urgent } from "./situations.js";

/**
 * How an ambition is put into words (N40): to the person themselves (a talker's situation line, "You want …; Odo is in your way"), by them
 * (what they say when asked what they want and the model is not there to answer), and about them (the admin card). The words are code's;
 * the model only phrases them.
 */
export interface AmbitionView {
  kind: AmbitionKind;
  step: number;
  /** The rung's words ("journeyman"), and the next one's. */
  rung: string;
  next: string | null;
  progress: number;
  /** "the smith" / "the Smiths' Guild" / "Harton" / a person's name. */
  target: string;
  /** People in their way: others after the same seat or the same room, by name. */
  rivals: Array<{ id: string; name: string }>;
  /** Something that stands in the way that is not a person ("there is no room for another forge here"). */
  blocked?: string;
  /** How much they want it now, and how blocked they feel (0..1). */
  strength: number;
  frustration: number;
  route: Route | null;
  /** A hard time pushing it aside, if one does now. */
  urgent: Urgent | null;
  /** For the talker: "You want …". */
  line: string;
  /** Said by them: "I want …". */
  say: string;
}

/** The target in words. */
export function targetWords(realm: Realm | null, store: Pick<WorldStore, "people">, amb: Pick<AmbitionRow, "kind" | "target">): string {
  if (!amb.target) return "";
  switch (amb.kind) {
    case "master_trade":
      return JOB_INFO[amb.target as Job]?.words ?? amb.target;
    case "guild_seat":
      return realm?.factions[amb.target]?.name ?? "the guild";
    case "office":
    case "knighthood":
      return realm?.settlements[amb.target]?.name ?? "the place";
    default:
      return store.people.get(amb.target)?.name ?? amb.target;
  }
}

/** A sentence's worth of what someone wants, said of them ("wants a seat in the Smiths' Guild"). */
export function wantsOf(realm: Realm | null, store: Pick<WorldStore, "people">, amb: Pick<AmbitionRow, "kind" | "target">): string {
  return isKind(amb.kind) ? wantWords(amb.kind, targetWords(realm, store, amb), "wants") : amb.kind;
}

const pct = (n: number) => (n >= 0.95 ? "nearly there" : n >= 0.6 ? "well on the way" : n >= 0.3 ? "about a third of the way" : "only starting");

/** The others after what they want: the same seat's other hopefuls, or the masters of the same trade who already have the shops. */
export function rivalsOf(store: WorldStore, row: PersonRow, amb: AmbitionRow, limit = 3): Array<{ id: string; name: string }> {
  const place = (store.people.loadSite(row.site, "full") as PersonRow[]).filter((r) => r.id !== row.id && r.death === null && r.job !== "child");
  const same = (r: PersonRow) => {
    const a = store.careers.ambitionOf(r.id);
    return a !== null && a.kind === amb.kind && a.target === amb.target && a.step === amb.step;
  };
  let out: PersonRow[] = [];
  if (amb.kind === "guild_seat" || amb.kind === "office") {
    // Whoever holds the next seat now, and the others hoping for it.
    const job = amb.kind === "office" ? "seat:council:" : amb.step === 0 ? `seat:g:${amb.target}:${row.site}:officer` : `seat:g:${amb.target}:${row.site}:master`;
    const holders = store.careers.holdersOf(job).map((h) => store.people.get(h.who)).filter((r): r is PersonRow => !!r && r.death === null && r.site === row.site);
    out = [...holders, ...place.filter(same).sort((a, b) => (store.careers.ambitionOf(b.id)!.progress - store.careers.ambitionOf(a.id)!.progress) || (a.id < b.id ? -1 : 1))];
  } else if (amb.kind === "master_trade" && amb.step >= 2) {
    out = place.filter((r) => r.job === amb.target && r.shop !== null);
  } else if (amb.kind === "revenge" && amb.target) {
    const them = store.people.get(amb.target);
    if (them) out = [them];
  }
  return [...new Map(out.map((r) => [r.id, r])).values()].slice(0, limit).map((r) => ({ id: r.id, name: r.name }));
}

/** The view of someone's ambition, with the words for each audience. */
export function viewOf(realm: Realm | null, store: WorldStore, who: string, amb: AmbitionRow, row: PersonRow | null, day = realm?.day ?? 0): AmbitionView | null {
  if (!isKind(amb.kind)) return null;
  const kind = amb.kind;
  const target = targetWords(realm, store, amb);
  const top = topStep(kind);
  const rung = stepWords(kind, amb.step);
  const next = amb.step < top ? stepWords(kind, amb.step + 1) : null;
  const rivals = row ? rivalsOf(store, row, amb) : [];
  let blocked: string | undefined;
  if (row && realm && kind === "master_trade" && amb.step === 2 && realm.settlements[row.site]) {
    const place = placeCareers(realm, row.site, store.people.loadSite(row.site, "full") as PersonRow[], store.careers, kingdomLaws(realm, realm.settlements[row.site]!.kingdom));
    if (shopRoom(place, amb.target ?? "") <= 0) blocked = `there is no room for another ${TRADES[amb.target as keyof typeof TRADES]?.shop ?? "shop"} in ${realm.settlements[row.site]!.name}`;
  }
  const want = wantWords(kind, target, "want");
  const first = (n: string) => n.split(" ")[0]!;
  const inWay = rivals.length > 0 && kind !== "quiet_life" ? ` ${rivals.map((r) => first(r.name)).join(" and ")} ${rivals.length === 1 ? "is" : "are"} in your way.` : "";
  const where = kind === "quiet_life" ? "" : next ? ` You are ${article(rung)} now, ${pct(amb.progress)} to ${next}.` : "";
  const route = (amb.route as Route | null) ?? null;
  const urgent = urgentOf(amb, day);
  const how = route && route !== "custom" && kind !== "quiet_life" ? ` You mean to get there by ${ROUTE_WORDS[route]}.` : "";
  const mood = kind === "quiet_life" ? "" : amb.frustration >= 0.5 ? " You are losing patience with waiting." : amb.strength < 0.3 ? " Your heart is less in it than it was." : amb.strength >= 0.85 ? " You want it badly." : "";
  const now = urgent ? ` Right now, though, nothing matters but ${URGENT_WORDS[urgent.kind]} (${urgent.why}).` : "";
  const line = `What you want from life: ${want}.${where}${how}${inWay}${blocked ? ` But ${blocked}.` : ""}${mood}${now}`;
  const mine = (t: string) => t.replace(/\byour\b/g, "my").replace(/\byou\b/g, "me");
  const say = urgent
    ? `What I want? Right now, only ${mine(URGENT_WORDS[urgent.kind])}. ${kind === "quiet_life" ? "" : `When that's past, ${mine(want)}.`}`.trim()
    : kind === "quiet_life"
      ? "Me? Nothing much. A quiet life, my days as they are."
      : `What I want? ${cap(mine(want))}.${rivals.length > 0 ? ` ${first(rivals[0]!.name)} stands in my way.` : ""}${amb.frustration >= 0.5 ? " And I am sick of waiting." : ""}`;
  return { kind, step: amb.step, rung, next, progress: amb.progress, target, rivals, ...(blocked ? { blocked } : {}), strength: amb.strength, frustration: amb.frustration, route, urgent, line, say };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (rung: string) => (/^(a |an |the |tenants|bound|free|content|saving|trading)/.test(rung) ? rung : `${/^[aeiou]/.test(rung) ? "an" : "a"} ${rung}`);

/**
 * A talker's ambition: their row's (the career day keeps it), or for a talker with no row (a notable of the realm) one picked from their
 * persona the first time it is asked for and kept in the table under their persona id.
 */
export function talkerAmbition(realm: Realm | null, store: WorldStore, persona: NpcPersona, site: string, day: number): AmbitionView | null {
  const row = store.people.get(persona.id);
  let amb = store.careers.ambitionOf(persona.id);
  if (!amb && !row) {
    const p = pickForTalker(persona, site, streamFor(realm?.seed ?? 0, "ambition", persona.id, day));
    amb = { who: persona.id, kind: p.kind, target: p.target, progress: 0, since: day, step: p.step, ...AMBITION_DEFAULTS };
    store.careers.setAmbition(amb);
  }
  return amb ? viewOf(realm, store, persona.id, amb, row, day) : null;
}

/** "a journeyman smith of Harton": the role a talker from the crowd has, by their rank in their trade. */
export function careerRole(row: PersonRow, rank: Rank | null, place: string): string | null {
  const trade = JOB_INFO[row.job as Job]?.words;
  if (!trade) return null;
  if (row.job === "apprentice") return `an apprentice of ${place}`;
  if (!rank || !(row.job in TRADES)) return null;
  return `a ${rank} ${trade} of ${place}`;
}

/** The admin card's rows: the ambition, its ladder (the rung reached marked), progress, rivals and the career so far. */
export function ambitionRows(realm: Realm | null, store: WorldStore, who: string): Array<[string, string, string?]> {
  const amb = store.careers.ambitionOf(who);
  const row = store.people.get(who);
  const rows: Array<[string, string, string?]> = [];
  if (amb && isKind(amb.kind)) {
    const v = viewOf(realm, store, who, amb, row)!;
    const ladder = KINDS[amb.kind].ladder.map((r, i) => (i === amb.step ? `[${r}]` : r)).join(" → ");
    rows.push(["Wants", wantsOf(realm, store, amb)], ["Ladder", ladder]);
    if (v.next) rows.push(["Progress", `${Math.round(amb.progress * 100)}% toward ${v.next}`]);
    rows.push(["Since", `day ${amb.since}`], ["Strength", `${Math.round(amb.strength * 100)}% (how much they want it now)`], ["Frustration", `${Math.round(amb.frustration * 100)}%`]);
    if (v.route) rows.push(["Route", ROUTE_WORDS[v.route].replace(/\byour\b/g, "their")]);
    if (v.urgent) rows.push(["Urgent", `${URGENT_WORDS[v.urgent.kind].replace(/\byour\b/g, "their")} (${v.urgent.why}), until day ${v.urgent.until}`]);
    for (const r of v.rivals) rows.push(["Rival", r.name, r.id.startsWith("t_") ? `town:${r.id}` : undefined]);
    if (v.blocked) rows.push(["In the way", v.blocked]);
  }
  if (row) {
    rows.push(["Skill", row.skill === null ? "not yet worked out" : `${row.skill} of 5`]);
    const rank = row.skill === null ? null : rankOf(row, store.careers.openJobs(who));
    if (rank) rows.push(["Rank", rank]);
    if (row.shop !== null) rows.push(["Shop", `building ${row.shop}`]);
  }
  for (const j of store.careers.history(who).slice(-12)) rows.push(["Career", `${j.job.replace(/^seat:/, "seat ")} at ${realm?.settlements[j.site]?.name ?? j.site}, day ${j.from_day}${j.to_day !== null ? ` to ${j.to_day}` : " to now"}`]);
  return rows;
}
