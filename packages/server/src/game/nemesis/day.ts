import type { NpcPersona, NpcState, PlayerState } from "../../npc/types.js";
import { addGrievance, hateOn } from "../chatter/grievance.js";
import type { WorldStore } from "../db.js";
import { unitFor } from "../dice.js";
import { follow } from "../follow/follow.js";
import { makeNotable } from "../items/notable.js";
import { recordLifeEvent } from "../people/events.js";
import { addDeed, figureOvercomes, figurePower, makeFigure } from "../realm/figures.js";
import { travelDays } from "../realm/generate.js";
import { realmNews } from "../realm/log.js";
import type { Figure, Realm } from "../realm/types.js";
import { playerPower } from "../realm/wilds.js";
import type { SavedWorld } from "../save.js";
import { siteMap } from "../../web/sites.js";
import { seededRng } from "../dice.js";
import { favouredWeapon, LEAST_GRUDGE, MAX_NEMESES, nemesesOf, strikeEvery, styleOf, templateTaunt, type Nemesis } from "./model.js";

/**
 * A nemesis's life (N44 steps 2-7), a day at a time: who becomes one (the strongest grudge among those who survived the player, at most
 * two), what they learn and how they prepare (a shield against a spear, armour against arrows, men against companions, a watch against a
 * sneak), how they rise (a lieutenant of their gang while N55's ranks aren't built), how they strike at what the player has (hired men to
 * burn the player's room, at most once a season), and how they come to face the player with a taunt from a real meeting. It ends when
 * they die, are won over, or outlast the player.
 */

export interface NemesisHost {
  world: SavedWorld;
  store?: WorldStore | undefined;
  agents: Record<string, { persona: NpcPersona; state: NpcState }>;
  site(): string;
}

const alive = (n: Nemesis) => n.stage === "rising" || n.stage === "striking" || n.stage === "finish";

/** How badly someone wants it (decision 1): grudge × pride × ambition, more for a name. */
export function candidateScore(f: Figure, grudge: number): number {
  const pride = 0.5 + 0.5 * f.bravery;
  return grudge * pride * (0.5 + f.ambition) * (1 + Math.max(0, f.renown) / 100);
}

/** Choose (or add) a nemesis from those who survived the player and hold a grudge (decision 1). */
export function chooseNemesis(h: NemesisHost, day: number): Nemesis | null {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return null;
  const s = nemesesOf(realm);
  const live = s.list.filter(alive);
  if (live.length >= MAX_NEMESES) return null;
  const ranked = Object.keys(s.meetings)
    .filter((who) => !s.list.some((n) => n.who === who))
    .map((who) => ({ f: realm.figures[who], grudge: hateOn(store, who, "player", day) }))
    .filter((x): x is { f: Figure; grudge: number } => !!x.f?.alive && x.grudge >= LEAST_GRUDGE)
    .map((x) => ({ ...x, score: candidateScore(x.f, x.grudge) }))
    .sort((a, b) => b.score - a.score || a.f.id.localeCompare(b.f.id));
  const top = ranked[0];
  if (!top) return null;
  // A second only when far above (decision 1).
  if (live.length === 1 && top.score < 1.5 * candidateScore(realm.figures[live[0]!.who] ?? top.f, hateOn(store, live[0]!.who, "player", day))) return null;
  const ms = s.meetings[top.f.id]!;
  const n: Nemesis = { who: top.f.id, name: top.f.name, since: day, cause: ms[0]?.ref ?? `meeting:${ms[0]?.day ?? day}`, stage: "rising", step: "gather", knows: styleOf(ms), prepared: [], men: [], titles: [], scars: [], struck: [] };
  s.list.push(n);
  // Followed (N34): the player hears of them.
  follow(h.world.player, top.f.id, top.f.name, "nemesis", day, { site: top.f.home, how: "you remember them" });
  addDeed(top.f, `swore revenge on ${h.world.player.name}`);
  return n;
}

/** The counters (decision 3): each a concrete change, made once. */
export function prepare(realm: Realm, store: WorldStore, n: Nemesis, player: PlayerState, day: number): string[] {
  const f = realm.figures[n.who];
  if (!f?.alive) return [];
  const done: string[] = [];
  const add = (what: string, fn: () => void) => {
    if (n.prepared.includes(what)) return;
    fn();
    n.prepared.push(what);
    done.push(what);
  };
  const weapon = favouredWeapon(n.knows);
  // A spear (a long reach) or any two-handed weapon: a shield to turn it.
  if (weapon === "spear" || (n.knows.skills.two_handed ?? 0) > 0)
    add("shield", () => {
      const it = makeNotable(realm, store, { base: "wooden shield", tier: "D", holder: f.id, holderName: f.name, day, how: "given", ...(f.home ? { site: f.home } : {}) });
      f.items = [...(f.items ?? []), it.id];
      addDeed(f, `took up a shield against ${player.name}'s ${weapon ?? "spear"}`);
    });
  // Arrows: armour, and closing quickly.
  if (n.knows.ranged > 0)
    add("armour", () => {
      const it = makeNotable(realm, store, { base: "chain mail", tier: "D", holder: f.id, holderName: f.name, day, how: "given" });
      f.items = [...(f.items ?? []), it.id];
    });
  // Companions: more men (hired: real people, the gang's own).
  if (n.knows.companions > 0)
    add("men", () => {
      const gang = f.faction ? realm.factions[f.faction] : undefined;
      const pool = (gang?.members ?? []).filter((id) => id !== f.id && realm.figures[id]?.alive && !n.men.includes(id));
      n.men.push(...pool.slice(0, 3));
    });
  // Sneaking: watchmen and dogs.
  if (n.knows.sneaks > 0) add("watch", () => addDeed(f, "keeps a watch and dogs now"));
  // And whatever the player fights with, they train against it.
  figureOvercomes(f, 6, { kind: "fight", rank: f.life.tier as never, what: `training against ${player.name}'s ${weapon ?? "ways"}` }, day);
  return done;
}

/** The power of a nemesis with what they prepared, against what the player is (decision 3, and the not-unbeatable bound). */
export function nemesisPower(realm: Realm, n: Nemesis, player?: PlayerState): number {
  const f = realm.figures[n.who];
  if (!f) return 0;
  const raw = figurePower(f) + (n.prepared.includes("shield") ? 4 : 0) + (n.prepared.includes("armour") ? 4 : 0) + n.men.filter((id) => realm.figures[id]?.alive).length * 3;
  return player ? Math.min(raw, playerPower(player) * 2) : raw;
}

/** Rising (decision 4): after a season of gathering, a rank: their gang's lieutenant (N55's sergeant later). */
export function rise(realm: Realm, store: WorldStore, n: Nemesis, player: PlayerState, day: number): string | null {
  const f = realm.figures[n.who];
  if (!f?.alive || n.rank || day - n.since < strikeEvery()) return null;
  const gang = f.faction ? realm.factions[f.faction] : undefined;
  if (gang && gang.dissolved === undefined) {
    // The grudge drives them: they push past the others to the chief's right hand.
    gang.members = [gang.leader, f.id, ...gang.members.filter((m) => m !== f.id && m !== gang.leader)].filter((m): m is string => !!m);
    n.rank = gang.leader === f.id ? `chief of ${gang.name}` : `lieutenant of ${gang.name}`;
  } else n.rank = "a captain of sellswords";
  n.titles.push(n.rank);
  n.step = "rise";
  addDeed(f, `rose to ${n.rank}`);
  recordLifeEvent(realm, store, { kind: "promoted", actor: f.id, site: f.home ?? player.site ?? "", day, key: `nemesis-rise:${f.id}`, details: `${f.name}, whom ${player.name} let go, is ${n.rank} now`, importance: 4 });
  // The player can see it coming: the news goes round (and those who follow them hear it).
  realmNews(realm, day, f.home ?? player.site ?? null, "nemesis", `They say ${f.name}, the one ${player.name} let go, is ${n.rank} now.`, 4, [f.name], { people: [f.id] });
  return n.rank;
}

/** Striking off-screen (decision 5), at most once a season: hired men burn the player's room (their home, until N66, the inn they stay at). */
export function strike(realm: Realm, store: WorldStore, n: Nemesis, player: PlayerState, day: number): string | null {
  const f = realm.figures[n.who];
  if (!f?.alive || !n.rank) return null;
  if (n.lastStrike !== undefined && day - n.lastStrike < strikeEvery()) return null;
  const site = player.home?.site ?? player.site;
  const s = site ? realm.settlements[site] : undefined;
  if (!s) return null;
  const map = siteMap(s, "village", realm);
  const building = player.home && player.home.site === s.id ? player.home.building : map.buildings.findIndex((b) => b.kind === "inn");
  const b = building >= 0 ? map.buildings[building] : undefined;
  if (!b) return null;
  const what = player.home ? `${player.name}'s house in ${s.name}` : `${player.name}'s room at the inn in ${s.name}`;
  const men = n.men.length > 0 ? n.men : (f.faction ? realm.factions[f.faction]?.members ?? [] : []).filter((id) => id !== f.id).slice(0, 2);
  const e = recordLifeEvent(realm, store, { kind: "revenge", actor: f.id, target: "player", site: s.id, day, key: `nemesis-strike:${f.id}:${day}`, details: `${f.name}'s hired men${men.length ? ` (${men.map((id) => realm.figures[id]?.name ?? id).join(", ")})` : ""} set fire to ${what}`, importance: 6, why: `revenge on ${player.name}` });
  store.marks.add({ id: `nemesis-burn:${s.id}:${day}`, site: s.id, kind: "burned", x: b.x, y: b.y, w: b.w, h: b.h, building, ref: e.id, label: `burned by ${f.name}'s men`, since: day, ends: day + 12, data: null });
  realmNews(realm, day, s.id, "nemesis", `A fire in ${s.name}: ${what} burned, and men in ${f.name}'s pay were seen running from it.`, 5, [s.name, f.name], { people: [f.id] });
  n.lastStrike = day;
  n.struck.push({ day, what: `burned ${what}`, site: s.id });
  n.stage = "striking";
  n.step = "strike";
  return what;
}

/**
 * Facing the player again (decision 6): when the player is within a day of them, after they have struck, they come with their men
 * (staged like N39's first hour: they really travel, never appear from nowhere) and open with a taunt from a real meeting.
 */
export function approach(h: NemesisHost, n: Nemesis, day: number): string | null {
  const realm = h.world.realm;
  const f = realm?.figures[n.who];
  const site = h.site();
  if (!realm || !f?.alive || n.stage !== "striking" || n.faced !== undefined) return null;
  if (travelDays(realm, f.home ?? site, site) > 1) return null;
  const st = h.world.sites?.[site];
  if (!st) return null;
  const who = [f, ...n.men.map((id) => realm.figures[id]).filter((x): x is Figure => !!x?.alive)].map((x) => ({ name: x.name, figure: x.id }));
  st.rules.push({ id: `nemesis_${f.id}_${day}`, creature: "bandit", count: who.length, place: "gate_road", who, ambush: true, untilDay: day + 2 });
  n.taunt = templateTaunt(realm, nemesesOf(realm).meetings[n.who] ?? [], h.world.player.name);
  n.faced = day;
  n.stage = "finish";
  n.step = "finish";
  return n.taunt;
}

/** How it ends (decision 7): dead for good, won over, or outlasting the player (their heir is N66's). */
export function endings(h: NemesisHost, day: number): void {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return;
  for (const n of nemesesOf(realm).list.filter(alive)) {
    const f = realm.figures[n.who];
    if (!f?.alive) n.stage = "dead";
    else if (hateOn(store, n.who, "player", day) < 0.1) n.stage = "won_over";
    else if (h.world.player.death) n.stage = "outlasted";
  }
}

/** A nemesis's day: chosen, prepared, risen, striking, facing. Returns lines for the player (what they hear). */
export function nemesisDay(h: NemesisHost, day: number): string[] {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return [];
  const lines: string[] = [];
  endings(h, day);
  const chosen = chooseNemesis(h, day);
  if (chosen) lines.push(`You have the feeling ${chosen.name} hasn't forgotten you.`);
  for (const n of nemesesOf(realm).list.filter(alive)) {
    prepare(realm, store, n, h.world.player, day);
    rise(realm, store, n, h.world.player, day);
    if (n.rank && unitFor(realm.seed, "nemesis-strike", n.who, day) < 0.5) strike(realm, store, n, h.world.player, day);
    const t = approach(h, n, day);
    if (t) lines.push(`${n.name} is coming for you, with men at their back.`, `${n.name}: "${t}"`);
  }
  return lines;
}

/**
 * A beaten foe who got away (decision 1's "survived a meeting", step 1's `spared`): their meeting is recorded, the humiliation is a
 * grudge, and an outlaw with no name the realm knows is made a figure of their gang so they persist (never a creature that despawns).
 */
export function survivedPlayer(h: NemesisHost, o: { figure?: string; name: string; gang?: string | null; outcome: "spared" | "fled"; companions: number; site: string; day: number }): string | null {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return null;
  let id = o.figure;
  if (!id || !realm.figures[id]) {
    const f = makeFigure(realm, seededRng(realm.next + 13), { role: "bandit", home: null, tier: "E", age: 25, name: o.name }, o.day);
    if (o.gang && realm.factions[o.gang]) {
      f.faction = o.gang;
      realm.factions[o.gang]!.members.push(f.id);
    }
    id = f.id;
  }
  const p = h.world.player;
  const e = recordLifeEvent(realm, store, { kind: "spared", actor: "player", target: id, site: o.site, day: o.day, key: `spared:${id}:${o.day}`, details: o.outcome === "spared" ? `${p.name} beat ${o.name} and let them go` : `${o.name} ran from ${p.name}, beaten`, importance: 3 });
  addGrievance(store, { who: id, against: "player", cause: `e:${e.id}`, weight: 0.6, day: o.day });
  const m = { day: o.day, site: o.site, kind: "fight" as const, outcome: o.outcome, playerUsed: { ...usedWeapon(p), abilities: [], companions: o.companions, tricks: p.sneaking ? ["sneak"] : [] }, ref: e.id };
  const s = nemesesOf(realm);
  s.meetings[id] = [...(s.meetings[id] ?? []), m].slice(-12);
  const n = s.list.find((x) => x.who === id && alive(x));
  if (n) {
    n.knows = styleOf(s.meetings[id]!);
    n.scars.push(`a scar from day ${o.day}`);
    addGrievance(store, { who: id, against: "player", cause: `e:${e.id}`, weight: 0.2, day: o.day });
  }
  return id;
}

function usedWeapon(p: PlayerState): { weapon?: string; skill?: string } {
  const key = p.equipment?.weapon;
  const m = key ? /^(.*?)\s*\[/.exec(key) : null;
  const name = m?.[1] ?? (key ? key : "fists");
  const skill = name === "spear" ? "two_handed" : name === "bow" ? "archery" : name === "fists" ? "unarmed" : name === "cudgel" || name.includes("hammer") ? "blunt" : "one_handed";
  return { weapon: name, skill };
}
