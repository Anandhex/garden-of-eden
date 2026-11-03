import { interiorOf, interiorWalkable, ITILE, floorTiles, spotFor, type CrowdDay, type CrowdSim, type Furniture, type Household, type Interior } from "@millbrook/shared";
import type { NpcPersona, NpcSecret, PlayerState } from "../../npc/types.js";
import { learnSecret } from "../../npc/secrets.js";
import { skillLevel } from "../../npc/skills.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { GoodsRow } from "../../store/goodsStore.js";
import type { SiteMap } from "../../web/sites.js";
import { alarmRaised } from "../crime.js";
import type { WorldStore } from "../db.js";
import { check, streamFor } from "../dice.js";
import { recordEvent } from "../events.js";
import { itemKey } from "../items.js";
import { formatMoney } from "../money.js";
import { FAMINE } from "../realm/economy.js";
import { figureTalkerId } from "../realm/notables.js";
import type { Realm } from "../realm/types.js";

/**
 * Interiors and homes (N32): every building's door leads inside (`player.inside`), to a map made by the shared generator
 * from the building's kind and its household's class, trade and wealth. The household's people are there when the crowd
 * has them home; what they keep is rolled the first time anyone touches the building (`household_goods`), some of it
 * hidden; a talker with a secret keeps a letter about it. A private home entered uninvited, or any place after it shuts,
 * is trespass: a locked door must be picked, and whoever is inside and awake may see and shout for the guard.
 */

export interface InsideState {
  site: string;
  building: number;
  x: number;
  y: number;
  /** The floor (G7 Part B): absent on the ground floor. */
  floor?: number;
  /** Came in uninvited: trespassing while here. */
  trespass?: boolean;
  /** Hidden slots found by searching. */
  found?: string[];
}

/** What the world needs to give these functions (the server's town, or a test's). */
export interface InsideCtx {
  realm: Realm;
  store: WorldStore;
  player: PlayerState;
  day: number;
  hour: number;
  minute: number;
  seed: number;
  /** The place's village map and its crowd now. */
  map: SiteMap;
  sim: CrowdSim | null;
  crowdDay: CrowdDay;
  /** Talkers by id (personas and how they feel about the player). */
  personas: Record<string, NpcPersona>;
  relationship: (id: string) => number;
  /** The world to record events in (a test may leave it out). */
  world?: object;
}

const RESIDENTIAL = new Set(["house", "manor", "hall", "palace", "castle", "barracks"]);
const CLASS_WEALTH: Record<string, number> = { slave: 0, serf: 0, commoner: 1, artisan: 1, clergy: 1, merchant: 2, gentry: 2, noble: 3, royal: 3 };

/** The living people whose home is a building (not away). */
export function membersOf(store: WorldStore, site: string, building: number): PersonRow[] {
  return (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.home === building && r.death === null && !r.away);
}

/** The talker whose home or seat a building is: its people's talkers, and the head of the place in the hall. */
function talkersOf(c: InsideCtx, building: number, members: PersonRow[]): string[] {
  const out = members.filter((r) => r.persona).map((r) => r.persona!);
  const b = c.map.buildings[building];
  const s = c.realm.settlements[c.map.site];
  if (b && s?.leader && ["hall", "manor", "palace", "castle"].includes(b.kind ?? "")) out.push(figureTalkerId(s.leader));
  return [...new Set(out)];
}

/** Who a building's household is, for the generator: kind, style, class, trade, wealth band. */
export function householdOf(c: InsideCtx, building: number): Household & { members: PersonRow[]; owner: { id: string; name: string } | null } {
  const b = c.map.buildings[building];
  const members = membersOf(c.store, c.map.site, building);
  const adults = members.filter((r) => c.day - r.born_day >= 16 * 48);
  const head = [...adults].sort((a, b) => a.born_day - b.born_day || (a.id < b.id ? -1 : 1))[0];
  const s = c.realm.settlements[c.map.site]!;
  const kind = b?.kind ?? "house";
  const cls = head?.cls ?? (kind === "palace" ? "royal" : kind === "castle" || kind === "manor" || kind === "hall" ? "noble" : kind === "temple" ? "clergy" : "commoner");
  // Better years bring better things; hungry ones bare shelves (N32 decision 3: never the layout).
  const fortune = (s.prosperity >= 70 ? 1 : 0) - (s.prosperity < 30 || s.food < FAMINE ? 1 : 0);
  const wealth = Math.max(0, Math.min(3, (CLASS_WEALTH[cls] ?? 1) + fortune));
  const leader = s.leader ? c.realm.figures[s.leader] : undefined;
  const owner = head ? { id: head.id, name: head.name } : leader && ["hall", "manor", "palace", "castle"].includes(kind) ? { id: figureTalkerId(leader.id), name: leader.name } : null;
  return { kind, ...(b?.style ? { style: b.style } : {}), cls, ...(head?.job ? { trade: head.job } : {}), wealth, members, owner };
}

export function interiorAt(c: InsideCtx, building: number): Interior {
  return interiorOf(c.seed, c.map.site, building, householdOf(c, building));
}

/** Who is inside a building now, and where: from the crowd (asleep in their beds, eating at the table, at work). */
export function peopleInside(c: InsideCtx, building: number, int = interiorAt(c, building)): Array<{ id: string; name: string; doing: string; x: number; y: number; floor: number; cls: string; job: string }> {
  if (!c.sim) return [];
  const at = c.sim.all(c.day, c.hour * 60 + c.minute, c.crowdDay);
  const out: Array<{ id: string; name: string; doing: string; x: number; y: number; floor: number; cls: string; job: string }> = [];
  at.forEach((p, i) => {
    if (p.inside !== building) return;
    const who = c.sim!.roster.people[i]!;
    const spot = spotFor(int, p.doing, out.length);
    out.push({ id: who.id, name: who.name, doing: p.doing, ...spot, cls: who.cls, job: who.job });
  });
  return out;
}

/** Is a building a private home (only its household, and those they let in)? */
export const isPrivate = (kind: string): boolean => RESIDENTIAL.has(kind);

/** Is a place open to anyone now (an inn always, a temple by day, a shop in working hours)? */
export function openNow(kind: string, hour: number): boolean {
  if (kind === "inn") return true;
  if (kind === "temple") return hour >= 6 && hour < 21;
  return hour >= 7 && hour < 19;
}

/**
 * Is the door locked now? A hovel never; a merchant's, a gentleman's or a lord's always; anyone else's at night and when
 * nobody's in. A place of business is locked when it shuts.
 */
export function lockedNow(h: Household, hour: number, anyoneIn: boolean): boolean {
  if (!isPrivate(h.kind)) return !openNow(h.kind, hour);
  if (h.style === "hovel" || h.cls === "slave" || h.cls === "serf") return false;
  if (h.style === "merchant" || ["merchant", "gentry", "noble", "royal"].includes(h.cls ?? "")) return true;
  return hour >= 22 || hour < 6 || !anyoneIn;
}

/** Let in: a household member whose talker likes the player enough, or someone they're with. */
function invited(c: InsideCtx, building: number, members: PersonRow[]): boolean {
  return talkersOf(c, building, members).some((id) => c.relationship(id) >= 40);
}

export interface EnterResult {
  ok: boolean;
  lines: string[];
  locked?: boolean;
  inside?: InsideState;
}

/**
 * Go in by a building's door. `pick`: try the lock. Entering a home uninvited, or a shop after it shuts, is trespass; then
 * anyone inside and awake (or a light sleeper) may see the player, and the alarm is raised.
 */
export function enter(c: InsideCtx, building: number, pick = false): EnterResult {
  const b = c.map.buildings[building];
  if (!b) return { ok: false, lines: ["There's no door there."] };
  const h = householdOf(c, building);
  const int = interiorOf(c.seed, c.map.site, building, h);
  const people = peopleInside(c, building, int);
  const mine = (c.player.home?.site === c.map.site && c.player.home.building === building) || false;
  const welcome = mine || invited(c, building, h.members);
  const name = b.name || (h.owner ? `${h.owner.name}'s house` : "the house");
  if (!welcome && lockedNow(h, c.hour, people.length > 0)) {
    if (!pick) return { ok: false, locked: true, lines: [`The door of ${name} is locked.`] };
    const rng = streamFor(c.seed, "lock", c.map.site, building, c.day, c.hour);
    const hard = 11 + 2 * h.wealth;
    const r = check(rng, c.player.attributes.agility, hard, 2 * skillLevel(c.player.skills, "lockpicking"));
    if (!r.success) {
      const lines = [`You work at the lock of ${name}; it won't give.`];
      // A rattled lock wakes the house.
      const heard = notice(c, building, people, 0.5);
      if (heard) lines.push(...alarm(c, building, h, heard, "trying the door"));
      return { ok: false, locked: true, lines };
    }
  }
  const trespass = !welcome && (isPrivate(h.kind) || !openNow(h.kind, c.hour));
  const inside: InsideState = { site: c.map.site, building, x: int.door.x, y: int.door.y - 1, ...(trespass ? { trespass: true } : {}) };
  c.player.inside = inside;
  const lines = [describe(name, h, people)];
  if (trespass) {
    const seen = notice(c, building, people, 1);
    if (seen) lines.push(...alarm(c, building, h, seen, "in the house"));
  }
  return { ok: true, lines, inside };
}

function describe(name: string, h: Household, people: Array<{ name: string; doing: string }>): string {
  const feel = h.wealth >= 3 ? "Rich hangings, good oak, a fire well laid." : h.wealth === 2 ? "Solid furniture, swept floors." : h.wealth === 1 ? "Plain and clean." : "Bare boards, straw, the smell of smoke.";
  const who = people.length === 0 ? "Nobody's in." : `${people.slice(0, 3).map((p) => `${p.name.split(" ")[0]} (${p.doing})`).join(", ")}${people.length > 3 ? ` and ${people.length - 3} more` : ""}.`;
  return `You step into ${name}. ${feel} ${who}`;
}

/**
 * Does anyone inside see the intruder? Each awake person has a chance (less if the player is sneaking and good at it); a
 * sleeper wakes now and then. Servants and slaves are the watchful ones. Returns who saw, or null.
 */
export function notice(c: InsideCtx, building: number, people: Array<{ id: string; name: string; doing: string; cls: string; job?: string }>, scale: number): { id: string; name: string } | null {
  const sneak = c.player.sneaking ? 0.1 * skillLevel(c.player.skills, "sneak") + 0.15 : 0;
  const rng = streamFor(c.seed, "notice", c.map.site, building, c.day, c.hour, c.minute);
  const watchful = (p: { cls: string; job?: string }) => p.job === "servant" || p.cls === "slave";
  const order = [...people].sort((a, b) => Number(watchful(b)) - Number(watchful(a)));
  for (const p of order) {
    const awake = p.doing !== "asleep";
    const chance = (awake ? (watchful(p) ? 0.8 : 0.6) : 0.15) * scale - sneak;
    if (rng() < chance) return { id: p.id, name: p.name };
  }
  return null;
}

/** Someone saw: they shout, the guard is called, the trespass (or theft) is a crime on the record. */
function alarm(c: InsideCtx, building: number, h: { owner: { id: string; name: string } | null }, who: { id: string; name: string }, what: string, kind: "trespass" | "theft" = "trespass", fine?: number): string[] {
  const ev = recordEvent((c.world ?? { events: [], day: c.day, hour: c.hour, player: c.player }) as never, {
    kind: kind === "theft" ? "theft-caught" : "trespass",
    actor: "player",
    target: h.owner?.id ?? who.id,
    details: `${kind === "theft" ? "caught stealing" : "found"} ${what}${fine ? ` worth ${fine}c` : ""}`,
    importance: 4,
    why: "seen by someone in the house",
    witnesses: [who.id],
    site: c.map.site,
  });
  alarmRaised(c.player, kind, h.owner ?? who, ev.id, c.day, fine);
  return [`${who.name} sees you ${what} and shouts for the guard!`];
}

/**
 * One step inside; the door (on the ground floor) leads out, the stairs to the other floor. Returns `out: true` when the
 * player walks out.
 */
export function stepInside(c: InsideCtx, dx: number, dy: number): { ok: boolean; out?: boolean; lines: string[] } {
  const ins = c.player.inside;
  if (!ins) return { ok: false, lines: [] };
  const int = interiorAt(c, ins.building);
  const floor = ins.floor ?? 0;
  const nx = ins.x + dx;
  const ny = ins.y + dy;
  if (floor === 0 && nx === int.door.x && ny === int.door.y) {
    delete c.player.inside;
    return { ok: true, out: true, lines: [] };
  }
  if (!interiorWalkable(int, nx, ny, floor)) return { ok: false, lines: [] };
  if (peopleInside(c, ins.building, int).some((p) => p.floor === floor && p.x === nx && p.y === ny)) return { ok: false, lines: [] };
  ins.x = nx;
  ins.y = ny;
  // Onto the stairs: up or down to the same tile of the other floor.
  if (int.floors > 1 && floorTiles(int, floor)[ny * int.w + nx] === ITILE.stairs) {
    if (floor === 0) ins.floor = 1;
    else delete ins.floor;
    return { ok: true, lines: [floor === 0 ? "You go up the stairs." : "You go down the stairs."] };
  }
  return { ok: true, lines: [] };
}

// ---------- goods ----------

/** What a slot of a household holds, rolled once from the class, trade and wealth (and a talker's secrets as letters). */
function rollGoods(c: InsideCtx, building: number, int: Interior, h: ReturnType<typeof householdOf>): Array<Omit<GoodsRow, "site" | "building">> {
  const rng = streamFor(c.seed, "goods", c.map.site, building);
  const out: Array<Omit<GoodsRow, "site" | "building">> = [];
  const owner = h.owner?.id ?? null;
  const add = (f: Furniture, item: string, qty: number, ref: string | null = null) => qty > 0 && out.push({ slot: f.slot!.id, item, qty, hidden: f.slot!.hidden ? 1 : 0, owner, ref });
  const wares: Record<string, string[]> = { smith: ["horseshoe", "iron ore"], weaver: ["wool"], tailor: ["wool"], baker: ["bread loaf"], innkeeper: ["ale", "stew"], herbalist: ["willow bark", "yarrow"], fisher: ["trout", "eel"], farmer: ["turnips", "eggs"], hunter: ["rabbit pelt", "hare meat"] };
  for (const f of int.furniture.filter((x) => x.slot)) {
    const w = h.wealth;
    if (f.slot!.hidden) add(f, "coin", Math.round((5 + rng() * 30) * (w + 1) ** 2));
    else if (f.kind === "strongbox") add(f, "coin", Math.round((20 + rng() * 60) * (w + 1)));
    else if (f.kind === "chest") (add(f, "wool", rng() < 0.5 ? 1 : 0), add(f, "coin", Math.round(rng() * 6 * (w + 1))));
    else if (f.kind === "shelf" || f.kind === "rack") for (const item of wares[h.trade ?? ""] ?? ["bread loaf"]) add(f, item, Math.round(rng() * (2 + w * 2)));
    else if (f.kind === "barrel") add(f, h.kind === "inn" ? "ale" : "turnips", 2 + Math.round(rng() * 4));
  }
  // A talker of the house with a secret keeps a letter about it, hidden (N32 decision 5).
  const hidden = int.furniture.filter((x) => x.slot?.hidden);
  for (const id of talkersOf(c, building, h.members)) {
    const p = c.personas[id];
    const secret = p?.secrets?.[0];
    if (!p || !secret || hidden.length === 0) continue;
    out.push({ slot: hidden[0]!.slot!.id, item: "letter", qty: 1, hidden: 1, owner: id, ref: `secret:${id}:${secret.id}` });
  }
  return out;
}

/** A building's goods, rolled and stored the first time they're needed. */
export function goodsOf(c: InsideCtx, building: number): GoodsRow[] {
  const had = c.store.goods.of(c.map.site, building);
  if (had) return had.filter((r) => r.slot !== "_");
  const h = householdOf(c, building);
  c.store.goods.put(c.map.site, building, rollGoods(c, building, interiorOf(c.seed, c.map.site, building, h), h));
  return (c.store.goods.of(c.map.site, building) ?? []).filter((r) => r.slot !== "_");
}

/** The piece of furniture next to the player that keeps things. */
function slotNear(c: InsideCtx, int: Interior): Furniture | undefined {
  const ins = c.player.inside!;
  return int.furniture.find((f) => f.slot && (f.floor ?? 0) === (ins.floor ?? 0) && Math.abs(f.x - ins.x) + Math.abs(f.y - ins.y) <= 1);
}

const words = (r: GoodsRow) => (r.item === "coin" ? formatMoney(r.qty) : r.item === "letter" ? "a folded letter" : `${r.qty} ${r.item}`);

/**
 * Look in the furniture beside the player: what's in plain sight in it, and with a careful search (a perception check)
 * what's hidden (coin under a board, letters at the back of a drawer).
 */
export function search(c: InsideCtx): string[] {
  const ins = c.player.inside;
  if (!ins) return ["You're not inside anywhere."];
  const int = interiorAt(c, ins.building);
  const f = slotNear(c, int);
  if (!f) return ["There's nothing here to look in."];
  const goods = goodsOf(c, ins.building).filter((r) => r.slot === f.slot!.id);
  if (f.slot!.hidden && !(ins.found ?? []).includes(f.slot!.id)) {
    const r = check(streamFor(c.seed, "search", c.map.site, ins.building, f.slot!.id, c.day), c.player.attributes.perception, 12);
    if (!r.success) return [`You go through the ${f.kind}. Nothing.`];
    (ins.found ??= []).push(f.slot!.id);
    if (goods.length === 0) return [`A loose board behind the ${f.kind}, and nothing under it.`];
    return [`Behind the ${f.kind}, hidden: ${goods.map(words).join(", ")}.`];
  }
  return goods.length > 0 ? [`In the ${f.kind}: ${goods.map(words).join(", ")}.`] : [`The ${f.kind} is empty.`];
}

/** What the player can see to take beside them (hidden things only once found). */
export function takeable(c: InsideCtx): Array<{ slot: string; item: string; qty: number; words: string }> {
  const ins = c.player.inside;
  if (!ins) return [];
  const int = interiorAt(c, ins.building);
  const f = slotNear(c, int);
  if (!f) return [];
  if (f.slot!.hidden && !(ins.found ?? []).includes(f.slot!.id)) return [];
  const goods = c.store.goods.of(c.map.site, ins.building);
  if (!goods) return [];
  return goods.filter((r) => r.slot === f.slot!.id).map((r) => ({ slot: r.slot, item: r.item, qty: r.qty, words: words(r) }));
}

/**
 * Take something: it's the player's now. A letter is read on the spot (its secret learned). Taking what isn't theirs is
 * theft, a crime if anyone inside sees.
 */
export function take(c: InsideCtx, slot: string, item: string): string[] {
  const ins = c.player.inside;
  if (!ins) return ["You're not inside anywhere."];
  const there = takeable(c).find((x) => x.slot === slot && x.item === item);
  if (!there) return ["That's not within reach."];
  const row = c.store.goods.of(c.map.site, ins.building)!.find((r) => r.slot === slot && r.item === item)!;
  const ref = row.ref;
  const owner = row.owner;
  const n = c.store.goods.take(c.map.site, ins.building, slot, item, item === "coin" ? there.qty : 1);
  if (n <= 0) return ["It's gone."];
  const lines: string[] = [];
  if (item === "coin") {
    c.player.money += n;
    lines.push(`You take ${formatMoney(n)}.`);
  } else if (item === "letter" && ref) {
    lines.push(...readLetter(c, ref));
  } else {
    const k = itemKey(item);
    c.player.inventory[k] = (c.player.inventory[k] ?? 0) + n;
    lines.push(`You take ${n} ${item}.`);
  }
  const mine = c.player.home?.site === c.map.site && c.player.home.building === ins.building;
  if (owner && !mine) {
    const h = householdOf(c, ins.building);
    const seen = notice(c, ins.building, peopleInside(c, ins.building), 0.8);
    if (seen) lines.push(...alarm(c, ins.building, h, seen, `taking ${item === "coin" ? "their coin" : `the ${item}`}`, "theft", item === "coin" ? n : 20));
  }
  return lines;
}

/** Read a letter with a secret's ref: the player knows the secret now. */
export function readLetter(c: InsideCtx, ref: string): string[] {
  const [, id, sid] = ref.split(":");
  const p = id ? c.personas[id] : undefined;
  const secret: NpcSecret | undefined = p?.secrets.find((s) => s.id === sid);
  if (!p || !secret) return ["A letter, but the ink has run; you can't make it out."];
  learnSecret(p, secret, c.player, c.day);
  return [`You unfold the letter and read it. It's ${p.name}'s: ${secret.text}`];
}

/** N32's bound: goods rows only for touched buildings (`goods-bounded`). */
export function checkGoodsBounds(store: WorldStore, cap = 400): Array<{ name: string; ok: boolean; detail: string }> {
  const n = store.goods.touched();
  return [{ name: "goods-bounded", ok: n <= cap, detail: `${n} buildings' goods kept` }];
}
