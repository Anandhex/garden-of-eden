import { config } from "../../config.js";
import { jail, pardonOf, trialsDay, tryCase } from "./trial.js";
import { WALK_PACE } from "@millbrook/shared";
import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import { streamFor, type Rng } from "../dice.js";
import { killPerson } from "../people/index.js";
import { recordLifeEvent } from "../people/events.js";
import { mint, transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import type { Realm } from "../realm/types.js";
import { roadDataOf } from "../road/generateRoads.js";
import { departureOn, launch } from "../road/journeys.js";
import { shortest } from "../road/paths.js";
import { crimes, sentence, SENTENCE_WORDS, type Accused, type Sentence } from "./sentence.js";

/**
 * Carrying out sentences (N26J steps 1–2): on the player, and on any person of the table, the same way. A fine goes to the
 * place's treasury; the lock-up and the stocks cost time and face (the stocks are seen by everyone, and talked of); a
 * flogging hurts; banishment keeps them out of the place until it ends (a townsperson walks away to the nearest other
 * place); hanging is for the worst crimes where the custom allows, and never for the player (who comes back from death:
 * N26J decision 5), who gets the worst setback instead. Each day the place's head hears the crimes that were seen there.
 */

/** Events that are crimes when someone saw them, and the crime each is. */
export const CRIME_EVENTS: Record<string, string> = { "theft-caught": "petty_theft", theft: "stealing_crops", attacked: "assault", killed: "killing", bribe: "bribery" };

/** Hours a lock-up day, and the stocks, cost the player. */
export const LOCKUP_HOURS_A_DAY = 24;
export const STOCKS_HOURS = 10;

export interface PlayerSentence {
  sentence: Sentence;
  lines: string[];
  /** Hours the caller lets pass (the lock-up, the stocks). */
  hours: number;
}

/** The player is sentenced at `place` for `crime`, and it's carried out. */
export function sentencePlayer(realm: Realm, player: PlayerState, crime: string, place: string, day: number, rng: Rng, opts: { fled?: boolean } = {}): PlayerSentence {
  const priors = (player.sentences ?? []).filter((x) => x.place === place).length;
  let s = sentence(realm, { kind: "player", id: "player", name: player.name, priors, ...(opts.fled ? { fled: true } : {}) }, crime, place, day, rng);
  const lines: string[] = [];
  let hours = 0;
  const where = realm.settlements[place]?.name ?? "the place";
  // A fine you can't pay is days in the lock-up instead.
  if (s.kind === "fine" && player.money < (s.amount ?? 0)) s = { ...s, kind: "lockup", until: day + 1, why: `${s.why}; there was no coin to pay a fine` };
  switch (s.kind) {
    case "fine":
      transfer(realm, "player", `s:${place}`, s.amount!, `a fine for ${crimes()[crime]?.words ?? crime}`, player, day);
      lines.push(`You're fined ${s.amount} copper, paid to ${where}.`);
      break;
    case "lockup":
      hours = Math.max(1, (s.until ?? day + 1) - day) * LOCKUP_HOURS_A_DAY;
      lines.push(`You're locked up in ${where}'s cell for ${hours / 24} day${hours > 24 ? "s" : ""}.`);
      break;
    case "stocks":
      hours = STOCKS_HOURS;
      player.renown = Math.max(0, (player.renown ?? 0) - 2);
      lines.push(`You spend the day in the stocks in ${where}, and everyone who passes sees you there.`);
      break;
    case "flogging":
      player.hp = Math.max(1, player.hp - Math.ceil(player.maxHp * 0.35));
      lines.push(`You're flogged in front of ${where}. It'll be a while before you sit easy.`);
      break;
    case "banished":
      (player.banished ??= {})[place] = s.until!;
      lines.push(`You're banished from ${where} until day ${s.until}. The guards will turn you away at the gate.`);
      break;
    case "bounty":
      player.bounty = (player.bounty ?? 0) + (s.amount ?? 0);
      lines.push(`${where} has put a price of ${s.amount} copper on you.`);
      break;
    case "hanging":
      break;
  }
  (player.sentences ??= []).push({ place, day, kind: s.kind, crime });
  tally(realm, `sentence_${s.kind}`);
  realmNews(realm, day, place, "justice", `${player.name} was ${SENTENCE_WORDS[s.kind]} in ${where} for ${crimes()[crime]?.words ?? crime}.`, s.kind === "fine" ? 2 : 3, [player.name, where], { why: s.why });
  return { sentence: s, lines, hours };
}

/** A person of the table is sentenced and it's carried out. Returns the sentence. */
export function sentencePerson(realm: Realm, store: WorldStore, row: PersonRow, crime: string, place: string, day: number, rng: Rng, witnesses: string[] = []): Sentence {
  const priors = store.eventsAbout(row.id, 200).filter((e) => e.kind === "sentence" && e.actor === row.id && e.site === place).length;
  const who: Accused = { kind: "person", id: row.id, name: row.name, priors, cls: row.cls };
  let s = sentence(realm, who, crime, place, day, rng);
  const where = realm.settlements[place]?.name ?? "the place";
  // The crown may pardon the worst sentences (N48 decision 5): a merciful ruler, a name worth sparing.
  const pardoner = config.society.trials && (s.kind === "hanging" || s.kind === "banished") ? pardonOf(realm, row, place, day) : null;
  if (pardoner) {
    recordLifeEvent(realm, store, { kind: "pardon", actor: pardoner.id, target: row.id, site: place, day, key: `${row.id}:pardon`, details: `${pardoner.name} pardoned ${row.name}, who was to be ${SENTENCE_WORDS[s.kind]}`, importance: 5, why: "the crown's mercy" });
    s = { ...s, kind: "lockup", until: day + 2, why: `${s.why}; pardoned by ${pardoner.name}` };
  }
  switch (s.kind) {
    case "fine":
      // Out of their own savings (which the realm's books don't hold), into the treasury.
      mint(realm, `s:${place}`, s.amount ?? 0, `a fine paid by ${row.name}`, undefined, day);
      break;
    case "banished":
      banishPerson(realm, store, row, place, day, rng);
      break;
    case "lockup":
      // In the place's cell until the day (N48): not at work, not at home.
      jail(store, row, s.until ?? day + 1, day, crimes()[crime]?.words ?? crime);
      break;
    case "hanging":
      killPerson(realm, store, row.id, { cause: "execution", day, note: `hanged in ${where} for ${crimes()[crime]?.words ?? crime}` });
      break;
    default:
      break;
  }
  recordLifeEvent(realm, store, { kind: "sentence", actor: row.id, target: s.by, site: place, day, details: `${row.name} was ${SENTENCE_WORDS[s.kind]}${s.amount ? ` (${s.amount} copper)` : ""} for ${crimes()[crime]?.words ?? crime}`, importance: s.kind === "hanging" ? 6 : s.kind === "fine" ? 2 : 3, witnesses, why: s.why });
  tally(realm, `sentence_${s.kind}`);
  if (s.kind !== "fine") realmNews(realm, day, place, "justice", `${row.name} of ${where} was ${SENTENCE_WORDS[s.kind]} for ${crimes()[crime]?.words ?? crime}.`, s.kind === "hanging" ? 6 : 3, [row.name, where], { why: s.why });
  return s;
}

/** Banished: they walk away to the nearest other place, for good (their household stays). */
function banishPerson(realm: Realm, store: WorldStore, row: PersonRow, place: string, day: number, rng: Rng): void {
  const data = roadDataOf(realm);
  const to = (realm.settlements[place]?.roads ?? []).map((id) => realm.settlements[id]).find((x) => x && !x.way && !x.abandoned && !x.fallen);
  const way = to ? shortest(data, place, to.id) : null;
  if (!to || !way) return;
  launch(realm, data, { kind: "migrants", party: [{ person: row.id, name: row.name, role: row.job, gender: row.gender === "female" ? "female" : "male" }], path: way, depart: departureOn(day + 1, rng()), pace: WALK_PACE, move: { from: place, to: to.id, everyone: false }, purpose: `banished from ${realm.settlements[place]?.name}` }, store.people);
}

/** The day's justice at a place: every crime there that someone saw is judged. Returns how many were sentenced. */
export function justiceDay(realm: Realm, store: WorldStore, site: string, day: number): number {
  let n = 0;
  // Cases opened by exposure and accusations (N46, N48), tried and sentenced; jail terms ended.
  n += trialsDay({ realm, store }, site, day, (row, crime, witnesses) => void sentencePerson(realm, store, row, crime, site, day, streamFor(realm.seed, "justice", "case", row.id, day), witnesses));
  for (const e of store.eventsAt(site, day, Object.keys(CRIME_EVENTS))) {
    if (!e.witnesses || e.witnesses.length === 0) continue;
    const crime = CRIME_EVENTS[e.kind]!;
    const rng = streamFor(realm.seed, "justice", e.id);
    for (const id of e.kind === "bribe" ? [e.actor, e.target] : [e.actor]) {
      const row = id ? store.people.get(id) : null;
      if (!row || row.death !== null || row.site !== site) continue;
      // A trial first (N48): the witnesses' words by their class against the accused's, the judge, leverage. Not guilty: let go.
      if (config.society.trials) {
        const witnesses = e.witnesses.map((w) => store.people.get(w)).filter((r): r is PersonRow => !!r && r.death === null);
        const v = tryCase({ realm, store }, { id: `case:${e.id}:${row.id}`, crime, accused: row, witnesses, place: site, day, accuser: e.target ? store.people.get(e.target) : null });
        if (!v.guilty) continue;
      }
      sentencePerson(realm, store, row, crime, site, day, rng, e.witnesses);
      n++;
      // A guard who took a bribe and was seen loses the post (N26J step 2).
      if (e.kind === "bribe" && row.job === "guard") {
        store.people.update(row.id, { job: "labourer" });
        realmNews(realm, day, site, "justice", `${row.name} has been turned out of the watch of ${realm.settlements[site]?.name} for taking a bribe.`, 3, [row.name]);
      }
    }
  }
  return n;
}

/**
 * A bribe (N26J step 2; N26H's gates are where it's offered): it's a crime for both sides, recorded with whoever saw it.
 * If anyone did, the place's head hears of it that day (`justiceDay`); if not, it can still come out later, by gossip.
 */
export function recordBribe(realm: Realm, store: WorldStore, o: { guard: string; briber: string; site: string; day: number; amount: number; witnesses: string[]; what: string }): void {
  recordLifeEvent(realm, store, { kind: "bribe", actor: o.guard, target: o.briber, site: o.site, day: o.day, details: `${store.people.get(o.guard)?.name ?? "a guard"} took ${o.amount} copper to ${o.what}`, importance: 4, witnesses: o.witnesses, why: "coin" });
}
