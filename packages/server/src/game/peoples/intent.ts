import { seededRng, unitFor } from "../dice.js";
import { declareWar, raid, sign, treatiesBetween, warOf } from "../realm/diplomacy.js";
import { realmNews } from "../realm/log.js";
import type { Side } from "../realm/military.js";
import type { Kingdom, Realm, Settlement } from "../realm/types.js";
import { seasonDays } from "../weather.js";
import { peopleOf, stanceOf, type PeopleDef } from "../../world/species.js";
import type { PeoplesState } from "./generate.js";

/**
 * N54 Part C: relations and intentions for every people placed by Part B, from their data alone. (The first cut's goblins, orcs, dwarves,
 * herd and dragon keep their own rules in day.ts, unchanged.)
 *
 * - **C1, alliances of convenience** (on the first day of each year): a people's place takes a lone great beast near it into its service
 *   when it likes that beast's kind (goblins and an ogre, hobgoblins and a troll); a crown of a people that likes giants hires the nearest
 *   giants' steading, with pay (orcs and giants); a place of a people that fears its neighbours seeks the protection of the strongest crown
 *   near that is friendly to it (`mutual_defense`).
 * - **C2, intentions** (one day a season, a place at a time): each place of another people picks what it wants this season by its
 *   temperament and its plight: **raid** (fierce and greedy, or hungry), **trade** (sociable, and a neighbour it doesn't hate), **hoard**
 *   (greedy and settled: it builds), or **be left alone**; and **revenge** for the last raid on it. Every choice is in the news with its
 *   reason, and kept in `realm.society.peoples.intents` (the last of each place).
 * - **Old hatreds between crowns of peoples** (beyond the orcs and dwarves): two crowns whose peoples' stances are -60 or worse go to war
 *   now and then, and the weaker asks a human crown for help, as the dwarves do.
 */
export type Intent = "raid" | "trade" | "hoard" | "alone" | "revenge";
export interface IntentRec {
  day: number;
  site: string;
  intent: Intent;
  why: string;
  target?: string;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const live = (s: Settlement | undefined): s is Settlement => !!s && !s.abandoned && !s.fallen && !s.way;
const REACH = 150;

/** The places of other peoples that Part B placed (not the first cut's), in id order. */
export function placedHomes(realm: Realm, st: PeoplesState): Settlement[] {
  return Object.values(st.placed?.settlements ?? {})
    .flat()
    .map((id) => realm.settlements[id])
    .filter(live)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** C1: alliances of convenience, re-made each year while both sides stand. */
export function alliancesDay(realm: Realm, st: PeoplesState, day: number): string[] {
  const made: string[] = [];
  const year = 4 * seasonDays();
  const beasts = Object.entries(st.placed?.figures ?? {}).flatMap(([sp, ids]) => (sp === "dragon" ? [] : ids.map((id) => ({ sp, id }))));
  for (const s of placedHomes(realm, st)) {
    const p = peopleOf(s.species!)!;
    // A beast in their service: the nearest lone one of a kind they like, within reach.
    const near = beasts
      .filter((b) => realm.figures[b.id]?.alive && st.lairs[b.id] && stanceOf(p.id, b.sp) >= 0 && stanceOf(b.sp, p.id) >= -20 && dist(st.lairs[b.id]!, s.pos) <= REACH)
      .sort((a, b) => dist(st.lairs[a.id]!, s.pos) - dist(st.lairs[b.id]!, s.pos) || a.id.localeCompare(b.id))[0];
    if (near && p.temperament.aggression >= 0.5 && treatiesBetween(realm, [`s:${s.id}`], [`p:${near.id}`], day, ["service"]).length === 0) {
      sign(realm, "service", `s:${s.id}`, `p:${near.id}`, day, year, `${s.name} feeds ${realm.figures[near.id]!.name}, and it fights for them`, 10);
      realmNews(realm, day, s.id, "peoples", `${s.name} has taken ${realm.figures[near.id]!.name} into its service.`, 4, [s.name], { why: `${plural(p)} and ${near.sp}s get on, and a beast that big is worth feeding` });
      made.push(`service:${s.id}:${near.id}`);
    }
    // A fearful people seeks a strong friend: the strongest crown within reach whose people like them.
    if (p.temperament.xenophobia < 0.6 && p.temperament.aggression < 0.6) {
      const friend = Object.values(realm.kingdoms)
        .filter((k) => !k.fallen && k.species !== p.id && stanceOf(k.species ?? "human", p.id) >= 0 && realm.settlements[k.capital] && dist(realm.settlements[k.capital]!.pos, s.pos) <= REACH * 2.5)
        .sort((a, b) => crownStrength(realm, b) - crownStrength(realm, a) || a.id.localeCompare(b.id))[0];
      if (friend && treatiesBetween(realm, [`s:${s.id}`], [`k:${friend.id}`], day, ["mutual_defense"]).length === 0 && (s.lastRaided !== undefined || unitFor(realm.seed, "seek-friend", s.id, day) < 0.3)) {
        sign(realm, "mutual_defense", `s:${s.id}`, `k:${friend.id}`, day, year, `${s.name} sought the protection of ${friend.name}`);
        realmNews(realm, day, s.id, "peoples", `${s.name} has put itself under the protection of ${friend.name}.`, 4, [s.name], { why: s.lastRaided !== undefined ? "it was raided, and is weak" : "it is weak, and has friends there" });
        made.push(`defense:${s.id}:${friend.id}`);
      }
    }
  }
  // Crowns of peoples hire the giants they like (orcs and hill giants), with pay.
  for (const k of Object.values(realm.kingdoms).filter((x) => x.species && !x.fallen).sort((a, b) => a.id.localeCompare(b.id))) {
    const cap = realm.settlements[k.capital];
    if (!cap) continue;
    const steading = placedHomes(realm, st)
      .filter((s) => s.species!.endsWith("_giant") && stanceOf(k.species!, s.species!) >= 20 && stanceOf(s.species!, k.species!) >= -10 && dist(s.pos, cap.pos) <= REACH * 4)
      .sort((a, b) => dist(a.pos, cap.pos) - dist(b.pos, cap.pos) || a.id.localeCompare(b.id))[0];
    if (steading && treatiesBetween(realm, [`k:${k.id}`], [`s:${steading.id}`], day, ["service"]).length === 0) {
      sign(realm, "service", `s:${steading.id}`, `k:${k.id}`, day, year, `${k.name} pays ${steading.name} to fight for it`, 40);
      realmNews(realm, day, k.capital, "peoples", `${k.name} has hired the giants of ${steading.name}.`, 5, [steading.name], { why: `${plural(peopleOf(k.species!)!)} and giants have long fought side by side` });
      made.push(`hire:${k.id}:${steading.id}`);
    }
  }
  return made;
}

function crownStrength(realm: Realm, k: Kingdom): number {
  return Object.values(realm.settlements).filter((s) => s.kingdom === k.id && !s.way && !s.abandoned).reduce((a, s) => a + s.population, 0);
}

const plural = (p: PeopleDef) => {
  const w = p.name.replace(/^(an?|one of the) /, "");
  return w.endsWith("folk") ? w : w.endsWith("f") ? `${w.slice(0, -1)}ves` : `${w}s`;
};

/** C2: what one place of another people wants this season, and why. Pure: the same place, day and realm give the same answer. */
export function intentionOf(realm: Realm, s: Settlement, day: number): IntentRec {
  const p = peopleOf(s.species!)!;
  const t = p.temperament;
  const u = (k: string) => unitFor(realm.seed, "intent", k, s.id, day);
  const scores: Array<{ intent: Intent; score: number; why: string }> = [
    { intent: "raid", score: t.aggression * 0.6 + t.greed * 0.4 + (s.food < 30 ? 0.4 : 0) - 0.35 + u("raid") * 0.3, why: s.food < 30 ? "hunger" : `${plural(p)} are fierce and greedy` },
    { intent: "trade", score: t.sociability * 0.6 + (1 - t.xenophobia) * 0.4 - 0.2 + u("trade") * 0.3, why: "they are at peace and have hides and ore to sell" },
    { intent: "hoard", score: (p.living === "settled" || p.living === "hive" ? t.greed * 0.6 : 0) - 0.1 + u("hoard") * 0.3, why: "they would rather build up their hold" },
    { intent: "alone", score: t.xenophobia * 0.5 + (1 - t.sociability) * 0.3 - 0.15 + u("alone") * 0.3, why: `${plural(p)} keep to themselves` },
  ];
  const wronged = raidedBy(realm, s, day);
  if (wronged && t.aggression >= 0.4) scores.push({ intent: "revenge", score: 0.5 + t.aggression * 0.5, why: "they were raided, and remember it" });
  const best = scores.sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent))[0]!;
  return { day, site: s.id, intent: best.intent, why: best.why };
}

/** C2: the season's intentions, acted on. Returns what each place chose. */
export function intentionsDay(realm: Realm, st: PeoplesState, day: number): IntentRec[] {
  const out: IntentRec[] = [];
  const intents = (st.intents ??= {});
  for (const s of placedHomes(realm, st)) {
    if (s.population < 20) continue;
    const rec = intentionOf(realm, s, day);
    const p = peopleOf(s.species!)!;
    const rng = seededRng(Math.floor(unitFor(realm.seed, "intent-act", s.id, day) * 2 ** 31));
    if (rec.intent === "raid" || rec.intent === "revenge") {
      const target =
        rec.intent === "revenge"
          ? raidedBy(realm, s, day)
          : Object.values(realm.settlements)
              .filter((x) => live(x) && x.species !== s.species && dist(x.pos, s.pos) <= REACH && stanceOf(p.id, x.species ?? "human") < 20 && treatiesBetween(realm, [`s:${s.id}`], [`s:${x.id}`, ...(x.kingdom ? [`k:${x.kingdom}` as const] : [])], day, ["non_aggression", "trade", "mutual_defense"]).length === 0)
              .sort((a, b) => dist(a.pos, s.pos) - dist(b.pos, s.pos) || a.id.localeCompare(b.id))[0];
      if (target && !warOf(realm, `s:${s.id}`)) {
        rec.target = target.id;
        const lead = s.leader ? realm.figures[s.leader] : undefined;
        const allies = realm.treaties.filter((tr) => tr.kind === "service" && tr.a === `s:${s.id}` && tr.b.startsWith("p:") && !tr.broken && tr.until >= day).map((tr) => realm.figures[tr.b.slice(2)]).filter((f) => !!f?.alive);
        const men = Math.round(s.population / 4);
        const side: Side = { name: `the ${plural(p)} of ${s.name.replace(/^the /, "")}`, strength: men * (1 + peopleOf(s.species!)!.body.strength / 20) + allies.length * 25 + (lead?.alive ? 15 : 0), fighters: [...(lead?.alive ? [lead] : []), ...allies.map((f) => f!)], men, home: s, species: s.species!, rank: "E" };
        realmNews(realm, day, target.id, "raid", `${plural(p)[0]!.toUpperCase()}${plural(p).slice(1)} out of ${s.name} fell on ${target.name}${allies.length ? `, with ${allies.map((f) => f!.name).join(" and ")},` : ""}.`, 5, [s.name, target.name], { why: rec.why });
        raid(realm, side, `s:${s.id}`, target, day, rng, rec.why);
        noteRaid(st, target.id, s.id, day);
      } else rec.intent = "alone";
    } else if (rec.intent === "trade") {
      const partner = Object.values(realm.settlements)
        .filter((x) => live(x) && x.id !== s.id && dist(x.pos, s.pos) <= REACH && stanceOf(p.id, x.species ?? "human") > -40 && stanceOf(x.species ?? "human", p.id) > -40)
        .sort((a, b) => dist(a.pos, s.pos) - dist(b.pos, s.pos) || a.id.localeCompare(b.id))[0];
      if (partner) {
        rec.target = partner.id;
        sign(realm, "trade", `s:${s.id}`, `s:${partner.id}`, day, seasonDays() * 2, `${s.name} and ${partner.name} trade`);
        realmNews(realm, day, partner.id, "trade", `Traders from ${s.name} came to ${partner.name}.`, 1, [s.name, partner.name], { why: rec.why });
      } else rec.intent = "alone";
    } else if (rec.intent === "hoard") {
      s.prosperity = Math.min(100, s.prosperity + 2);
    }
    intents[s.id] = rec;
    out.push(rec);
  }
  return out;
}

/** Raids on places of other peoples, by whom (st.raidedBy), so a wronged people can take revenge. */
export function noteRaid(st: PeoplesState, target: string, by: string, day: number): void {
  const log = (st.raidedBy ??= {});
  log[target] = { by, day };
}

/** Who raided this place in the last two seasons: their place, if it still stands within reach. */
function raidedBy(realm: Realm, s: Settlement, day: number): Settlement | undefined {
  const st = realm.society?.peoples as PeoplesState | undefined;
  const r = st?.raidedBy?.[s.id];
  if (!r || day - r.day > seasonDays() * 2) return undefined;
  const t = realm.settlements[r.by];
  return live(t) && dist(t.pos, s.pos) <= REACH * 1.5 ? t : undefined;
}

/**
 * Old hatreds between crowns of peoples other than the orcs and dwarves (C2): once a year, two such crowns whose peoples' stances are -60
 * or worse, neither at war, go to war on a roll; the defender asks the human crown that likes it best for help.
 */
export function hatredsDay(realm: Realm, st: PeoplesState, day: number): string | null {
  const ks = Object.values(realm.kingdoms).filter((k) => k.species && !k.fallen && k.id !== st.orcs && k.id !== st.dwarves).sort((a, b) => a.id.localeCompare(b.id));
  const all = Object.values(realm.kingdoms).filter((k) => k.species && !k.fallen).sort((a, b) => a.id.localeCompare(b.id));
  for (const a of ks) {
    for (const b of all) {
      if (a.id === b.id || warOf(realm, `k:${a.id}`) || warOf(realm, `k:${b.id}`)) continue;
      const hate = Math.min(stanceOf(a.species!, b.species!), stanceOf(b.species!, a.species!));
      if (hate > -60 || unitFor(realm.seed, "people-hatred", a.id, b.id, day) >= 0.35) continue;
      const [att, def] = peopleOf(a.species!)!.temperament.aggression >= peopleOf(b.species!)!.temperament.aggression ? [a, b] : [b, a];
      const w = declareWar(realm, [`k:${att.id}`], [`k:${def.id}`], day, `an old hatred between ${plural(peopleOf(att.species!)!)} and ${plural(peopleOf(def.species!)!)}`);
      const crown = Object.values(realm.kingdoms).filter((k) => !k.species && !k.fallen).sort((x, y) => (y.opinion[def.id] ?? 0) - (x.opinion[def.id] ?? 0) || x.id.localeCompare(y.id))[0];
      if (crown) {
        const ok = (crown.opinion[def.id] ?? 0) >= 10 || (crown.opinion[att.id] ?? 0) <= -20;
        st.asked.push({ day, by: def.id, of: crown.id, ok, war: w.id });
        if (ok) {
          sign(realm, "mutual_defense", `k:${def.id}`, `k:${crown.id}`, day, 4 * seasonDays(), `${def.name} asked ${crown.name} for help against ${att.name}`);
          if (!w.defenders.includes(`k:${crown.id}`)) w.defenders.push(`k:${crown.id}`);
        }
        realmNews(realm, day, crown.capital, "war", `${def.name} asked ${crown.name} for help against ${att.name}; ${crown.name} ${ok ? "answered the call" : "refused"}.`, 7, [], { why: ok ? `an old friendship with ${def.name}` : "no quarrel worth a war" });
      }
      return w.id;
    }
  }
  return null;
}
