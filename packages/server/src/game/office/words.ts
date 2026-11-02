import type { WorldStore } from "../db.js";
import { epithetOf, titled } from "../realm/figures.js";
import type { Figure, Office, Realm } from "../realm/types.js";
import { TITLES, type TitleDef } from "../titles.js";
import { periodsOf } from "./books.js";
import { memberCount, minMembers } from "./members.js";
import { instName, officeOf, officesOf, postWords } from "./posts.js";
import { effective, fame, nameWords } from "./repute.js";
import { voicesOf } from "./support.js";
import { wageOf } from "./treasury.js";

/**
 * Words for offices and names (N69 decision 12): a talker's line about their post, their guild's standing, what people call them and
 * whether their name is good or ill; the admin card's rows. Templated in code; the model only says them in its own words.
 */

/** The figure a talker is (a riser from the crowd, or a figure who talks), if any. */
export function figureOfTalker(realm: Realm, personaId: string, store?: WorldStore): Figure | undefined {
  const row = store?.people.get(personaId);
  if (row?.figure && realm.figures[row.figure]) return realm.figures[row.figure];
  return Object.values(realm.figures).find((f) => f.talks === personaId);
}

/** How their post stands: thin coffers, wages owed. */
function postMood(realm: Realm, o: Office): string {
  const id = o.inst.slice(2);
  const coffer = o.inst.startsWith("s:") ? (realm.settlements[id]?.treasury ?? 0) : (realm.factions[id]?.wealth ?? 0);
  if (o.unpaid > 0) return `; you are owed ${o.unpaid > 1 ? `${o.unpaid} seasons'` : "a season's"} wages`;
  if (coffer < wageOf(realm, o.inst, o.post) * 3 && /treasurer|reeve|quartermaster/.test(o.post)) return "; the coffers are thin, and the head looks to you for it";
  return "";
}

/** A talker's lines about their standing: their post, their faction, what they are called, their name. Null if there is nothing to say. */
export function talkerStanding(realm: Realm | null, store: WorldStore | undefined, personaId: string): string | null {
  if (!realm) return null;
  const row = store?.people.get(personaId) ?? null;
  const fig = figureOfTalker(realm, personaId, store);
  const lines: string[] = [];
  const held = officeOf(realm, fig?.id ?? personaId) ?? officeOf(realm, personaId);
  if (held) lines.push(`You are the ${postWords(realm, held)}${postMood(realm, held)}.`);
  const facId = fig?.faction ?? row?.faction;
  const fac = facId ? realm.factions[facId] : undefined;
  if (fac && fac.dissolved === undefined && fac.kind !== "crown") {
    const n = memberCount(realm, fac);
    const state = fac.charter ? `still gathering members for its charter (${n} of ${fac.charter.need})` : n < minMembers(realm, fac) ? "short of members" : (fac.prestige ?? 0) >= 50 ? "well thought of" : (fac.prestige ?? 0) < 20 ? "of little account" : "of some standing";
    lines.push(`You belong to ${fac.name}, ${state}.`);
  }
  const renown = fig ? effective(fig) : (row?.renown ?? 0);
  const by = fig ? epithetOf(fig) : row?.epithet ? ((TITLES as Record<string, TitleDef>)[row.epithet]?.name ?? null) : null;
  const place = realm.settlements[fig?.home ?? row?.site ?? ""]?.name ?? "these parts";
  if (by) lines.push(`Folk call you ${(fig?.name ?? row?.name ?? "").split(" ")[0]} ${by}.`);
  if (Math.abs(renown) >= 15) lines.push(renown > 0 ? `Your name is ${nameWords(renown)} in ${place}.` : `People curse your name in ${place}: you are ${nameWords(renown)}.`);
  if (fig && (fig.support ?? 0) <= -10) lines.push("Those you lead are turning against you.");
  else if (fig && (fig.support ?? 0) >= 10) lines.push("Those you lead stand behind you.");
  return lines.length > 0 ? lines.join(" ") : null;
}

/** Admin rows for a figure: renown (signed, with fame), support, epithets and why, ventures, their post. */
export function figureRepute(realm: Realm, f: Figure): Array<[string, string, string?]> {
  const rows: Array<[string, string, string?]> = [];
  rows.push(["Renown", `${f.renown} (${nameWords(f.renown)}; fame ${fame(f)})`]);
  if (f.support !== undefined) rows.push(["Support", `${f.support >= 0 ? "+" : ""}${f.support} (effective renown ${effective(f)})`]);
  const reps = f.life.titles.filter((t) => (TITLES as Record<string, TitleDef>)[t.id]?.kind === "repute");
  for (const t of reps) {
    const def = (TITLES as Record<string, TitleDef>)[t.id]!;
    rows.push(["Called", `${def.name}, since day ${t.day}${def.forLife ? " (for life)" : ""}`, def.description]);
  }
  for (const v of (f.ventures ?? []).slice().reverse()) rows.push(["Venture", `day ${v.day}: ${v.kind}, ${v.won ? "won" : "lost"}${v.led ? " (led)" : ""}${v.routed ? ", routed" : ""}`]);
  const held = officeOf(realm, f.id);
  if (held) rows.push(["Office", postWords(realm, held), `${held.inst.startsWith("s:") ? "place" : "faction"}:${held.inst.slice(2)}`]);
  return rows;
}

/** The top supporters and detractors of a leader, from their followers' regard (for the admin card). */
export function supportRows(realm: Realm, f: Figure, day: number, store?: WorldStore): Array<[string, string, string?]> {
  const voices = voicesOf(realm, f, day, store).sort((a, b) => b.regard * b.weight - a.regard * a.weight);
  const name = (id: string): [string, string] => (realm.figures[id] ? [realm.figures[id]!.name, `figure:${id}`] : [store?.people.get(id)?.name ?? id, `person:${id}`]);
  const rows: Array<[string, string, string?]> = [];
  for (const v of voices.slice(0, 3).filter((x) => x.regard > 0.05)) rows.push(["Supporter", `${name(v.who)[0]} (regard ${v.regard.toFixed(2)})`, name(v.who)[1]]);
  for (const v of voices.slice(-3).reverse().filter((x) => x.regard < -0.05)) rows.push(["Detractor", `${name(v.who)[0]} (regard ${v.regard.toFixed(2)})`, name(v.who)[1]]);
  return rows;
}

/** The offices of a place or faction and who holds them (for the admin card). */
export function officeRows(realm: Realm, inst: string, store?: WorldStore): Array<[string, string, string?]> {
  const rows: Array<[string, string, string?]> = [];
  for (const o of officesOf(realm, inst)) {
    const who = o.holder === "crowd" ? "one of its people (unnamed: its people are a count)" : o.holder === "townsfolk" ? "left to its townsfolk (named in its own day)" : o.holder ? (o.row ? (store?.people.get(o.holder)?.name ?? o.name ?? o.holder) : realm.figures[o.holder] ? titled(realm.figures[o.holder]!) : o.holder) : `empty since day ${o.vacant ?? o.since}`;
    const named = o.holder && o.holder !== "crowd" && o.holder !== "townsfolk";
    const link = named ? (o.row ? `person:${o.holder}` : `figure:${o.holder}`) : undefined;
    const bits = named ? `, skill ${Math.round(o.skill * 100)}%, since day ${o.since}${o.unpaid ? `, ${o.unpaid} unpaid` : ""}${o.skim > 0 ? `, skims ${(o.skim * 100).toFixed(1)}% (took ${o.took})` : ""}` : "";
    rows.push([postWords(realm, o).split(" of ")[0]!, `${who}${bits}`, link]);
  }
  return rows;
}

/** The books by period, the truth (with what was stolen marked), newest first. */
export function bookRows(realm: Realm, inst: string): Array<[string, string]> {
  return periodsOf(realm, inst, true)
    .slice()
    .reverse()
    .map((p) => {
      const total = Object.values(p.lines).reduce((a, b) => a + b, 0);
      const parts = Object.entries(p.lines)
        .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
        .map(([k, v]) => `${k === "stolen" ? "STOLEN" : k} ${v >= 0 ? "+" : ""}${Math.round(v)}`);
      return [`to day ${p.day}`, `${total >= 0 ? "+" : ""}${Math.round(total)}: ${parts.join(", ")}`];
    });
}

/** "Hollin", "the Smiths' Guild". */
export { instName };
