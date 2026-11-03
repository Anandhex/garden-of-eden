import { readFileSync } from "node:fs";
import { z } from "zod";
import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { adjustRel, viewOf } from "../chatter/rel.js";
import { temperOf } from "../chatter/person.js";
import { streamFor, type Rng } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { injure, type InjuryId } from "../health.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import { policyAt } from "../realm/policy.js";
import type { Realm } from "../realm/types.js";
import type { Chapter } from "../law/taken.js";

/**
 * Setbacks instead of game over (N49). Where the player would die or lose everything, one chooser picks what happens from who beat them
 * and where (`data/setbacks/setbacks.json`: outcomes, weights, when each applies): robbed and left (N26J's knockout), taken for ransom (N26J's
 * captive), **sold** to a master where slavery is law, **imprisoned** (N48), **left for dead** and found by someone real, **branded** by a
 * nemesis, or, rarely and only where the rules say, killed: and the player comes back (plans README §5a). Each is a chapter on the player
 * (`player.chapter`) with exits that are mechanics; each leaves marks (`LASTING` injuries, a record, a story people tell).
 */
const OutcomeSchema = z.object({ kind: z.enum(["robbed", "taken", "sold", "imprisoned", "left_for_dead", "branded", "death"]), weight: z.number().min(0), when: z.enum(["worth", "slave_kingdom"]).optional() });
const SetbacksSchema = z.object({ by: z.record(z.string(), z.array(OutcomeSchema)) });
export type SetbackKind = z.infer<typeof OutcomeSchema>["kind"];
export type BeatenBy = "gang" | "slavers" | "guards" | "beasts" | "nemesis" | "nature";

let table: z.infer<typeof SetbacksSchema> | null = null;
export function setbacks(): z.infer<typeof SetbacksSchema> {
  return (table ??= SetbacksSchema.parse(JSON.parse(readFileSync(new URL("../../data/setbacks/setbacks.json", import.meta.url), "utf8"))));
}

export interface Defeat {
  by: BeatenBy;
  /** Who: a gang's faction id, a figure, a pack. */
  holder?: string;
  site: string;
  day: number;
}

const slaveKingdom = (realm: Realm, site: string): boolean => {
  const k = realm.settlements[site]?.kingdom;
  return !!k && !!realm.kingdoms[k]?.laws.slavery;
};
/** The nearest place where slaves are sold (the slave kingdom's capital, or any place of it). */
export function slaveMarket(realm: Realm, from: string): string | null {
  const here = realm.settlements[from];
  const opts = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned && !s.fallen && s.kingdom && realm.kingdoms[s.kingdom]?.laws.slavery);
  if (!here || opts.length === 0) return null;
  return opts.sort((a, b) => Math.hypot(a.pos.x - here.pos.x, a.pos.y - here.pos.y) - Math.hypot(b.pos.x - here.pos.x, b.pos.y - here.pos.y) || a.id.localeCompare(b.id))[0]!.id;
}

/** What happens to a beaten player: one outcome, picked by weight among those that apply. Pure but for the roll. */
export function chooseSetback(realm: Realm, p: PlayerState, d: Defeat, rng: Rng): SetbackKind {
  if (config.playerDefeat === "permadeath" && d.by !== "guards") return "death";
  const list = setbacks().by[d.by] ?? [{ kind: "robbed" as const, weight: 1 }];
  const worth = (p.renown ?? 0) >= 10 || p.money >= 150;
  const ok = list.filter((o) => !o.when || (o.when === "worth" && worth) || (o.when === "slave_kingdom" && (slaveKingdom(realm, d.site) || !!slaveMarket(realm, d.site))));
  // The same slavers don't sell someone twice running without their having got away and come back (`not-a-loop`).
  const last = p.society?.setbacks?.at(-1) as { kind: string; holder?: string; escaped?: boolean } | undefined;
  const fair = ok.filter((o) => !(o.kind === "sold" && last?.kind === "sold" && last.holder === d.holder && !last.escaped));
  const total = fair.reduce((a, o) => a + o.weight, 0);
  let x = rng() * total;
  for (const o of fair) if ((x -= o.weight) <= 0) return o.kind;
  return fair.at(-1)?.kind ?? "robbed";
}

/** Remember a setback on the player (for `not-a-loop` and the story). */
function note(p: PlayerState, kind: string, d: Defeat, extra: Record<string, unknown> = {}): void {
  p.society ??= {};
  (p.society.setbacks ??= []).push({ kind, day: d.day, site: d.site, ...(d.holder ? { holder: d.holder } : {}), ...extra });
}

/** A lasting mark. */
export function mark(p: PlayerState, id: InjuryId, day: number): void {
  injure(p as never, id, day);
  p.society ??= {};
  p.society.marks = [...new Set([...(p.society.marks ?? []), id])];
}

/**
 * Sold (N49 decision 5): taken to the nearest slave market and bought by a master there (a real person of the place: the richest who keeps
 * slaves), branded, and set to a slave's day. Returns the chapter, or null where there is no market to sell them in.
 */
export function sell(ctx: LifeCtx, p: PlayerState, d: Defeat): { chapter: Chapter; master: PersonRow; lines: string[] } | null {
  const { realm, store } = ctx;
  const market = slaveMarket(realm, d.site);
  if (!market) return null;
  const rows = (store.people.loadSite(market, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
  const master = rows.filter((r) => ["noble", "gentry", "merchant"].includes(r.cls)).sort((a, b) => rows.filter((x) => x.master_id === b.id).length - rows.filter((x) => x.master_id === a.id).length || a.id.localeCompare(b.id))[0];
  if (!master) return null;
  const price = 80 + 5 * (p.attributes?.strength ?? 10);
  if (d.holder && realm.factions[d.holder]) transfer(realm, "player", `f:${d.holder}`, Math.floor(p.money / 2), "taken from one they sold", p, d.day);
  const chapter: Chapter = { kind: "slave", holder: master.id, site: market, since: d.day, exits: ["escape", "ransom", "labour"], watch: 0.3, worked: 0, home: p.site ?? d.site };
  p.chapter = chapter;
  p.society ??= {};
  p.society.cls = "slave";
  mark(p, "brand", d.day);
  note(p, "sold", d, { master: master.id, price });
  tally(realm, "player_sold");
  realmNews(realm, d.day, market, "setback", `A stranger was sold at ${realm.settlements[market]?.name}'s market to ${master.name}.`, 3, [master.name]);
  return { chapter, master, lines: [`You come to in chains. Days later, at ${realm.settlements[market]?.name}'s market, ${master.name} buys you for ${price} copper.`, "A brand is put to your shoulder."] };
}

/** Left for dead (by beasts, the wilds): found by someone real (a hunter or herbalist of the nearest place), with a lasting mark. */
export function leftForDead(ctx: LifeCtx, p: PlayerState, d: Defeat, rng: Rng): { finder: PersonRow | null; lines: string[] } {
  const { realm, store } = ctx;
  const rows = (store.people.loadSite(d.site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && r.job !== "child");
  const finder = rows.find((r) => ["hunter", "herbalist", "woodcutter", "farmer"].includes(r.job)) ?? rows[0] ?? null;
  p.hp = Math.max(1, Math.ceil(p.maxHp * 0.15));
  const m: InjuryId = (["scar", "limp", "lost_eye"] as const)[Math.floor(rng() * 3)]!;
  mark(p, m, d.day);
  p.chapter = { kind: "recovering", holder: finder?.id ?? "", site: d.site, since: d.day, exits: ["labour"], watch: 0, worked: 0, home: p.site ?? d.site };
  note(p, "left_for_dead", d, { finder: finder?.id });
  if (finder) adjustRel(store, finder.id, "player", { affection: 10 }, d.day);
  return { finder, lines: [`You lie where you fell until ${finder ? `${finder.name}, a ${finder.job},` : "someone"} finds you and carries you in.`, `You'll carry ${m === "scar" ? "a scar" : m === "limp" ? "a limp" : "one eye fewer"} from it for good.`] };
}

/**
 * Escape from slavery with another slave's help (N49 decision 5; N59 gives NPC slaves the same run): someone held by the same master who
 * trusts the player (befriended: affection ≥ 25) and holds a grudge against the master knows the way. A check against the watch, the master's
 * temper and whether the helper comes. Out, the player runs for a place where slavery isn't law (the free kingdom shelters runaways by its
 * `runaways` law), and from there home.
 */
export function helperFor(ctx: LifeCtx, p: PlayerState, day: number): PersonRow | null {
  const c = p.chapter;
  if (c?.kind !== "slave") return null;
  const slaves = (ctx.store.people.loadSite(c.site, "full") as PersonRow[]).filter((r) => r.death === null && r.cls === "slave" && r.master_id === c.holder);
  return slaves.find((r) => viewOf(ctx.store, r.id, "player", day).affection >= 25 && ctx.store.social.openBetween(r.id, c.holder).length > 0) ?? null;
}

/** A day of work at the master's beside the other slaves: the player befriends one (affection grows), and a cruel master's lash leaves marks. */
export function slaveDay(ctx: LifeCtx, p: PlayerState, day: number): string[] {
  const c = p.chapter;
  if (c?.kind !== "slave") return [];
  const { store } = ctx;
  const slaves = (store.people.loadSite(c.site, "full") as PersonRow[]).filter((r) => r.death === null && r.cls === "slave").sort((a, b) => a.id.localeCompare(b.id));
  c.worked += 1;
  const near = slaves.filter((r) => r.master_id === c.holder).concat(slaves.filter((r) => r.master_id !== c.holder)).slice(0, 4);
  for (const r of near) adjustRel(store, r.id, "player", { affection: 6, trust: 4 }, day);
  const master = store.people.get(c.holder);
  if (master && temperOf(master).temper > 0.7 && streamFor(ctx.realm.seed, "lash", day)() < 0.2) {
    mark(p, "scar", day);
    return [`${master.name}'s overseer takes the lash to you.`];
  }
  return [`A day's work for ${master?.name ?? "your master"}. The others start to talk to you.`];
}

export function escapeSlavery(ctx: LifeCtx, p: PlayerState, day: number, rng: Rng): { ok: boolean; lines: string[]; to?: string } {
  const { realm, store } = ctx;
  const c = p.chapter;
  if (c?.kind !== "slave") return { ok: false, lines: ["You're nobody's slave."] };
  const helper = helperFor(ctx, p, day);
  const master = store.people.get(c.holder);
  const chance = 0.15 + (helper ? 0.55 : 0) - (master ? temperOf(master).bravery * 0.1 : 0) - c.watch * 0.2;
  if (rng() >= chance) {
    c.watch = Math.min(1, c.watch + 0.3);
    if (master) mark(p, "scar", day);
    return { ok: false, lines: [helper ? `You run with ${helper.name}, but the dogs find you by dawn. You're flogged and watched closer.` : "You try alone and are caught before the walls. They flog you."] };
  }
  // To a place where slavery isn't law, and the free kingdom shelters runaways unless its law sends them back.
  const here = realm.settlements[c.site]!;
  const free = Object.values(realm.settlements)
    .filter((s) => !s.way && !s.abandoned && !s.fallen && s.kingdom && !realm.kingdoms[s.kingdom]?.laws.slavery)
    .filter((s) => policyAt(realm, s.id, `runaways:${here.kingdom}`, day) !== "return")
    .sort((a, b) => Math.hypot(a.pos.x - here.pos.x, a.pos.y - here.pos.y) - Math.hypot(b.pos.x - here.pos.x, b.pos.y - here.pos.y) || a.id.localeCompare(b.id))[0];
  const home = c.home;
  delete p.chapter;
  p.society ??= {};
  p.society.cls = "commoner";
  const last = (p.society.setbacks ?? []).at(-1);
  if (last) last.escaped = day;
  if (helper) {
    // The helper runs too: they leave with the player (N59 makes their own runs).
    store.people.update(helper.id, { origin: JSON.stringify({ site: c.site, day, why: "ran from their master with a stranger" }) });
    adjustRel(store, helper.id, "player", { affection: 20, trust: 20 }, day);
  }
  if (master) recordLifeEvent(realm, store, { kind: "runaway", actor: "player", target: master.id, site: c.site, day, key: `player:${day}`, details: `${p.name} ran from ${master.name}${helper ? ` with ${helper.name}'s help` : ""}`, importance: 5, witnesses: helper ? [helper.id] : [] });
  tally(realm, "player_escaped_slavery");
  return { ok: true, to: free?.id ?? home, lines: [`${helper ? `${helper.name} knows the way through the drains.` : "You find a gap in the wall."} By the third night you're across the border${free ? ` at ${free.name}` : ""}. From there, home.`] };
}

/**
 * Coming home after a setback (N49 decision 6, step 5): the story goes ahead of the player. An event at home, seen by those who greet them
 * (what gossip carries on), says where they've been, with the marks it left.
 */
export function comeHome(ctx: LifeCtx, p: PlayerState, home: string, day: number): string[] {
  const { realm, store } = ctx;
  const last = (p.society?.setbacks ?? []).at(-1) as { kind: string; site: string; master?: string } | undefined;
  if (!last) return [];
  const rows = (store.people.loadSite(home, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && r.job !== "child").sort((a, b) => a.id.localeCompare(b.id));
  const greeters = rows.slice(0, 6);
  const where = realm.settlements[last.site]?.name ?? "far away";
  const marks = (p.society?.marks ?? []) as string[];
  const story = last.kind === "sold" ? `${p.name} was sold as a slave at ${where} and got away${marks.includes("brand") ? ", and bears the brand" : ""}` : last.kind === "left_for_dead" ? `${p.name} was left for dead near ${where} and lived` : `${p.name} came back from ${where}`;
  const e = recordLifeEvent(realm, store, { kind: "story-turn", actor: "player", site: home, day, key: `player:home:${last.kind}:${day}`, details: story, importance: 6, witnesses: greeters.map((g) => g.id) });
  for (const g of greeters) learn(ctx, g.id, eventRef(e.id), { day, source: "saw", accuracy: 1 });
  p.society ??= {};
  p.society.story = { event: e.id, text: story, day };
  return [`People stop you in the street: they've heard. "${story}."`];
}

/**
 * Death, and coming back (plans README §5a): a day later where they last slept (or at a temple), at low HP; what they carried lies where
 * they fell (a record of kind "pack": theirs to recover, anyone's to take); those who saw it say they came back from the dead.
 */
export function dieAndReturn(ctx: LifeCtx, p: PlayerState, d: Defeat, witnesses: string[]): { wakeAt: string; lines: string[] } {
  const { realm, store } = ctx;
  const wakeAt = (p.society?.slept as string | undefined) ?? p.site ?? d.site;
  const items = { ...(p.inventory ?? {}) };
  const money = p.money;
  store.records.put({ id: `pack:player:${d.day}`, kind: "pack", site: d.site, a: "player", b: null, since: d.day, status: "lying", ended: null, data: { items, money } });
  p.inventory = {};
  p.money = 0;
  p.hp = Math.max(1, Math.ceil(p.maxHp * 0.1));
  note(p, "death", d, { wakeAt });
  const e = recordLifeEvent(realm, store, { kind: "story-turn", actor: "player", site: d.site, day: d.day + 1, key: `player:returned:${d.day}`, details: `${p.name} was seen to die, and came back from the dead`, importance: 7, witnesses });
  for (const w of witnesses) learn(ctx, w, eventRef(e.id), { day: d.day + 1, source: "saw", accuracy: 1 });
  tally(realm, "player_returned");
  return { wakeAt, lines: ["Darkness.", `You wake a day later in ${realm.settlements[wakeAt]?.name ?? "the place you last slept"}, weak as a newborn. What you carried lies where you fell.`] };
}

/** Pick up the pack left where the player fell, if it's still there. */
export function recoverPack(ctx: LifeCtx, p: PlayerState, site: string, day: number): string[] {
  const pack = ctx.store.records.open<{ items: Record<string, number>; money: number }>("pack", (r) => r.a === "player" && r.site === site)[0];
  if (!pack) return ["Nothing of yours lies here."];
  for (const [k, n] of Object.entries(pack.data.items)) (p.inventory as Record<string, number>)[k] = ((p.inventory as Record<string, number>)[k] ?? 0) + n;
  p.money += pack.data.money;
  ctx.store.records.end(pack.id, day, "recovered");
  return ["You find your things where you fell, and take them back."];
}
