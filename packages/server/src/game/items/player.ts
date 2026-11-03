import { addEmotion } from "../../npc/emotions.js";
import { remember } from "../../npc/memory.js";
import { adjust } from "../../npc/relationship.js";
import type { NpcPersona, NpcState, PlayerState } from "../../npc/types.js";
import type { WorldStore } from "../db.js";
import { recordEvent } from "../events.js";
import { notableIdOf, parseItem } from "../items.js";
import { playerLearns } from "../playerKnowledge.js";
import { fame as figureFame } from "../office/repute.js";
import type { Creature } from "../creatures.js";
import type { Realm } from "../realm/types.js";
import type { SavedWorld } from "../save.js";
import { becomeNotable, historyOf, itemDeed, itemName, keyOf, legendOf, moveItem, notableOnMaking, notableRef, notablesIn, recognise, type HistoryEntry } from "./notable.js";

/**
 * The player and items with a history (N43): gear good enough is notable the moment it is theirs; what a slain figure carried is the
 * player's to take; a renowned foe slain gives the player's weapon a deed (and in time a name); people who know an item the player
 * carries recognise it, a stolen one gives away whose it was, and kin want an heirloom back; bards sing of famous items in the inns.
 */

export interface ItemsHost {
  world: SavedWorld;
  store?: WorldStore | undefined;
  agents: Record<string, { persona: NpcPersona; state: NpcState }>;
  presentAt(place: SavedWorld["player"]["place"]): Array<{ persona: NpcPersona; state: NpcState }>;
  meetPerson(id: string): string | null;
  site(): string;
}

/** A claim someone made on an item the player carries (decision 6): who, what they said, and what they want. */
export interface ItemClaim {
  who: string;
  item: string;
  line: string;
  /** They want it back (kin of a holder it was taken from), or they only know it (a guard who heard of the theft). */
  wants: boolean;
  day: number;
  done?: boolean;
}

const keysOf = (p: PlayerState): string[] => [...Object.keys(p.inventory).filter((k) => (p.inventory[k] ?? 0) > 0), ...Object.values(p.equipment ?? {}).filter((k): k is string => !!k)];

/** Gear the player has that should be notable is made so: tier B or above (a masterwork or a commission raises it there). */
export function notableSweep(h: ItemsHost): void {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return;
  const p = h.world.player;
  const rekey = (from: string, to: string) => {
    if (from === to) return;
    if (p.inventory[from]) {
      p.inventory[to] = (p.inventory[to] ?? 0) + 1;
      p.inventory[from]! -= 1;
      if (p.inventory[from]! <= 0) delete p.inventory[from];
    }
    for (const [slot, k] of Object.entries(p.equipment ?? {})) if (k === from) (p.equipment as Record<string, string>)[slot] = to;
  };
  for (const k of keysOf(p)) {
    const it = parseItem(k);
    if (!it || it.id || (!it.def.weapon && !it.def.armor) || !notableOnMaking(it.tier)) continue;
    const stolen = (p.stolen ?? []).find((s) => parseItem(s.item)?.name === it.name);
    const key = becomeNotable(realm, store, k, { holder: "player", holderName: p.name, day: h.world.day, site: h.site(), how: stolen ? "stolen" : "given", ...(stolen ? { before: [{ who: stolen.from, day: stolen.day }] } : {}) });
    rekey(k, key);
    playerLearns(p, notableRef(notableIdOf(key)!), "saw", h.world.day);
  }
}

/**
 * The player slew someone of the realm (decision 3, 5): what they carried is the player's to take (looted, with its history), and a
 * renowned foe gives the player's weapon a deed (it becomes notable if it wasn't) and maybe a name. Returns lines.
 */
export function afterPlayerKill(h: ItemsHost, dead: Array<{ figure: string; name: string }>): string[] {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return [];
  const p = h.world.player;
  const lines: string[] = [];
  for (const d of dead) {
    // What they carried: the realm's day queued it (killFigure); the player takes it now.
    for (const drop of (realm.drops ?? []).filter((x) => x.from === d.figure)) {
      const row = moveItem(store, drop.item, "player", "looted", h.world.day, { name: p.name, from: d.name, site: h.site() });
      if (!row) continue;
      const key = keyOf(row);
      p.inventory[key] = (p.inventory[key] ?? 0) + 1;
      playerLearns(p, notableRef(row.id), "saw", h.world.day, { text: `taken from ${d.name}` });
      lines.push(`You take ${row.name ? `${row.name}, ${row.base === "iron sword" ? "a sword" : `a ${row.base}`},` : `a fine ${row.base}`} from ${d.name}.`);
    }
    realm.drops = (realm.drops ?? []).filter((x) => x.from !== d.figure);
    // A deed for the weapon in hand.
    const f = realm.figures[d.figure];
    const renown = f ? Math.max(f.renown, figureFame(f)) : 0;
    if (renown < 15) continue;
    const weapon = p.equipment?.weapon;
    if (!weapon || !parseItem(weapon)) continue;
    const key = becomeNotable(realm, store, weapon, { holder: "player", holderName: p.name, day: h.world.day, site: h.site(), how: "given" });
    if (key !== weapon) p.equipment!.weapon = key;
    const id = notableIdOf(key)!;
    const got = itemDeed(realm, store, id, { day: h.world.day, who: "player", whoName: p.name, what: `slew ${d.name}`, renown, site: h.site(), slain: d.name });
    playerLearns(p, notableRef(id), "saw", h.world.day);
    if (got?.named) lines.push(`Folk will call your ${got.row.base} ${got.row.name} for this.`);
  }
  return lines;
}

/**
 * Those at the player's place look at what the player carries (decision 6): someone who knows an item recognises it; a stolen one tells
 * them whose it was; kin of a holder it was taken from want it back. Each claim is made once (in `world.itemClaims`), and is what the
 * person says first when the player next talks to them. Returns lines for the feed (someone staring).
 */
export function recogniseHere(h: ItemsHost): string[] {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store || h.world.player.road) return [];
  const p = h.world.player;
  const items = notablesIn(store, keysOf(p));
  if (items.length === 0) return [];
  const claims = (h.world.itemClaims ??= []);
  const lines: string[] = [];
  for (const a of h.presentAt(p.place)) {
    const row = store.people.get(a.persona.id);
    if (!row) continue;
    for (const it of items) {
      if (claims.some((c) => c.who === a.persona.id && c.item === it.id)) continue;
      const r = recognise({ realm, store }, it.id, row.id, h.world.day);
      if (!r.knows || (!r.stolenFrom && !r.kin)) continue;
      const wants = !!r.kin;
      claims.push({ who: a.persona.id, item: it.id, line: r.line!, wants, day: h.world.day });
      playerLearns(p, notableRef(it.id), "told", h.world.day, { from: a.persona.id, text: r.line! });
      recordEvent(h.world as never, { kind: "rumour", actor: a.persona.id, target: "player", details: `${a.persona.name} knew ${itemName(it)} on ${p.name}: ${r.line}`, importance: 4, why: "an item with a history", site: h.site() });
      lines.push(`${a.persona.name} stares at ${itemName(it)}.`);
    }
  }
  return lines;
}

/** Give an item to someone who claims it (the family's reclaim, answered): theirs again, and grateful. */
export function giveBack(h: ItemsHost, itemId: string, to: string): { ok: boolean; lines: string[] } {
  const realm = h.world.realm;
  const store = h.store;
  const p = h.world.player;
  const claim = (h.world.itemClaims ?? []).find((c) => c.item === itemId && c.who === to && !c.done);
  const it = store?.notables.get(itemId);
  if (!realm || !store || !claim || !it || it.holder !== "player") return { ok: false, lines: ["You've nothing of theirs."] };
  const key = keysOf(p).find((k) => notableIdOf(k) === itemId)!;
  if (p.inventory[key]) delete p.inventory[key];
  for (const [slot, k] of Object.entries(p.equipment ?? {})) if (k === key) delete (p.equipment as Record<string, string | undefined>)[slot];
  moveItem(store, itemId, to, "given", h.world.day, { name: h.agents[to]?.persona.name ?? to, from: p.name, site: h.site() });
  claim.done = true;
  const st = h.agents[to]?.state;
  if (st) {
    adjust(st, "trust", 25);
    adjust(st, "affection", 20);
    addEmotion(st, "gratitude", 0.8, `getting ${itemName(it)} back`, h.world.day, true);
    remember(st, { id: `gave-back-${itemId}`, day: h.world.day, text: `the stranger gave me back ${itemName(it)}`, importance: 8, valence: 1 });
  }
  recordEvent(h.world as never, { kind: "gift", actor: "player", target: to, details: `${p.name} gave ${itemName(it)} back to ${h.agents[to]?.persona.name ?? "its family"}`, importance: 5, site: h.site() });
  return { ok: true, lines: [`You hand ${itemName(it)} back. ${h.agents[to]?.persona.name ?? "They"} can't speak for a moment.`] };
}

/**
 * A bard's song in the inns (decision 5 and N68's hook; the template until N68): the most famous named item whose deeds were done in this
 * kingdom, sung with its holder's last fight.
 */
export function bardSong(realm: Realm, store: Pick<WorldStore, "notables" | "people">, site: string): string | null {
  const kingdom = realm.settlements[site]?.kingdom ?? null;
  const nameOf = (id: string) => store.people.get(id)?.name ?? realm.figures[id]?.name ?? (id === "player" ? "a stranger" : id);
  const sung = store.notables
    .list((r) => !!r.name && r.fame >= 20)
    .filter((r) => historyOf(r).some((e) => e.kind === "used" && (!e.site || realm.settlements[e.site]?.kingdom === kingdom)))
    .sort((a, b) => b.fame - a.fame || a.id.localeCompare(b.id))[0];
  if (!sung) return null;
  const h = historyOf(sung);
  const fall = h.find((e) => e.kind === "looted" || e.kind === "stolen");
  const owner = fall ? [...h.slice(0, h.indexOf(fall))].reverse().find((e) => e.kind !== "used" && e.kind !== "named") : undefined;
  if (owner && fall) return `A bard at the inn sings of ${owner.name ?? nameOf(owner.who)}'s last fight, and of ${sung.name}, torn from ${owner.name?.split(" ")[0] ?? "his"} hand by ${fall.name ?? nameOf(fall.who)}.`;
  return `A bard at the inn sings of ${sung.name}: ${legendOf(sung, nameOf)}`;
}

/** What the player knows of an item's history (decision 8): from when they first saw it, and what they were told of it. */
export function knownHistory(store: Pick<WorldStore, "notables" | "people">, realm: Realm, p: PlayerState, id: string): string[] {
  const it = store.notables.get(id);
  const known = p.known?.[notableRef(id)];
  if (!it || !known) return [];
  const nameOf = (who: string) => (who === "player" ? "you" : (store.people.get(who)?.name ?? realm.figures[who]?.name ?? who));
  const seen = historyOf(it).filter((e) => e.day >= known.day || e.who === "player");
  const told = Object.entries(p.known ?? {}).filter(([ref]) => ref === notableRef(id)).flatMap(([, k]) => (k.text ? [`You were told: ${k.text}`] : []));
  return [...told, ...seen.map((e: HistoryEntry) => `Day ${e.day}: ${e.kind}${e.what ? ` (${e.what})` : ""}, ${e.name ?? nameOf(e.who)}`)];
}

/** The figure-backed creatures that just died, for afterPlayerKill. */
export function deadFigures(creatures: Record<string, Creature>): Array<{ figure: string; name: string }> {
  return Object.values(creatures).filter((c) => c.outcome === "dead" && c.figure && !c.packId).map((c) => ({ figure: c.figure!, name: c.name }));
}

/** The player's things with a history, as far as they know them, and who has a claim on them (the client's section). */
export function itemsView(h: ItemsHost): import("@millbrook/shared").NotableView[] {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return [];
  const p = h.world.player;
  return notablesIn(store, keysOf(p)).map((it) => ({
    id: it.id,
    name: itemName(it),
    base: it.base,
    tier: it.tier,
    history: knownHistory(store, realm, p, it.id),
    claims: (h.world.itemClaims ?? []).filter((c) => c.item === it.id && !c.done).map((c) => ({ who: c.who, name: h.agents[c.who]?.persona.name ?? c.who, line: c.line, wants: c.wants })),
  }));
}
