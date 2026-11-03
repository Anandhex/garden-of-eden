import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { Rec } from "../../store/recordStore.js";
import { addGrievance } from "../chatter/grievance.js";
import { adjustRel, credenceOf, viewOf } from "../chatter/rel.js";
import { temperOf } from "../chatter/person.js";
import { streamFor, unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { sociability } from "../gossip/venues.js";
import { openPlayerCase } from "../law/player.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { transfer } from "../realm/ledger.js";

/**
 * Shaping what people believe (N52). A **planted rumour** is a fabrication: a record (kind "fabrication") of a claim about a subject that
 * isn't true, who planted it and with whom, and a gossip ref (`r:<id>`) that spreads by N33's rules like anything else: worth telling by
 * how juicy the claim is, drifting in the telling (the wrong one of the family, the grain money for the tax money, worse each time).
 * Believed (accuracy ≥ 0.5), it moves how people see its subject; believed by enough in a place, the watch **investigates**, walking the
 * tellers back toward whoever first said it. Reached, the one who made it up faces the subject's grudge and a slander case.
 */
export const CLAIM_WEIGHT: Record<string, number> = { stole: 6, cheats: 4, affair: 5, plots: 7, heretic: 6, spy: 7, sick: 4, broke: 3, hoards: 6 };
/** A place's watch looks into a crime claim once this share of its grown people believe it. */
export const INVESTIGATE_SHARE = 0.25;
/** Each hop back up the trail is found with this chance (a friend of the teller may shield them). */
export const HOP = 0.75;

export interface FabricationData {
  subject: string;
  subjectName: string;
  claim: string;
  detail?: string;
  /** Who made it up ("player" or a person), and the first one told. */
  by: string;
  first: string;
  weight: number;
  /** Believers already moved (so feelings shift once a person). */
  moved?: string[];
  investigated?: { day: number; by: string; found?: string; hops: number; shielded?: string };
}
export type Fabrication = Rec<FabricationData>;
export const rumourRef = (id: string): string => `r:${id}`;

/** Make up a rumour and tell it to someone. Their belief: their credence of the teller, against what they know of the subject. */
export function plant(ctx: LifeCtx, o: { by: string; byName: string; listener: PersonRow; subject: string; subjectName: string; claim: string; detail?: string; site: string; day: number; key?: string }): Fabrication {
  const id = `fab:${o.by}:${o.subject}:${o.claim}:${o.key ?? o.day}`;
  const rec: Fabrication = { id, kind: "fabrication", site: o.site, a: o.by, b: o.subject, since: o.day, status: "spreading", ended: null, data: { subject: o.subject, subjectName: o.subjectName, claim: o.claim, ...(o.detail ? { detail: o.detail } : {}), by: o.by, first: o.listener.id, weight: CLAIM_WEIGHT[o.claim] ?? 4 } };
  ctx.store.records.put(rec);
  // How much they believe it: who's telling, and how far it fits what they think of the subject.
  const trusts = credenceOf(ctx.store, o.listener.id, o.by, o.day, 0.6);
  const fond = viewOf(ctx.store, o.listener.id, o.subject, o.day);
  const fits = 1 - Math.max(0, fond.trust + fond.affection) / 200;
  learn(ctx, o.listener.id, rumourRef(id), { day: o.day, source: o.by, accuracy: Math.max(0.2, Math.min(1, trusts * fits + 0.2)) });
  return rec;
}

/** The player whispers a rumour to someone: the talk menu's "tell them that…". */
export function playerPlants(ctx: LifeCtx, p: PlayerState, listener: PersonRow, subject: { id: string; name: string }, claim: string, day: number, detail?: string): string[] {
  plant(ctx, { by: "player", byName: p.name, listener, subject: subject.id, subjectName: subject.name, claim, ...(detail ? { detail } : {}), site: listener.site, day });
  const eager = sociability(listener.id) > 0.6 ? " Their eyes light up: this one will be told before nightfall." : "";
  return [`You tell ${listener.name}, quietly, that ${subject.name} ${claim === "stole" ? `stole ${detail ?? "the tax money"}` : claim === "hoards" ? "is hoarding grain" : `${claim}`}.${eager}`];
}

/** Who in a place believes a rumour now. */
export function believers(ctx: LifeCtx, id: string): string[] {
  return ctx.store.knowledge.holders(rumourRef(id)).filter((k) => k.accuracy >= 0.5).map((k) => k.who).sort();
}

/**
 * A place's rumours on a day: believers think less of the subject (once each); a faction rumoured against loses others' regard; a crime
 * claim believed by enough brings the watch to investigate, walking the tellers back toward its maker.
 */
export function rumoursDay(ctx: LifeCtx, site: string, day: number, player?: PlayerState): string[] {
  const { realm, store } = ctx;
  const events: string[] = [];
  const grown = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.job !== "child");
  for (const f of store.records.open<FabricationData>("fabrication", (x) => x.site === site)) {
    const who = believers(ctx, f.id);
    const moved = new Set(f.data.moved ?? []);
    for (const b of who) {
      if (moved.has(b)) continue;
      adjustRel(store, b, f.data.subject, { trust: -12, respect: -10 }, day);
      // Members of a faction rumoured against: other factions think less of it (N52 decision 7).
      const fac = realm.factions[f.data.subject];
      const mine = store.people.get(b)?.faction;
      if (fac && mine && mine !== fac.id && realm.factions[mine]) realm.factions[mine]!.stances[fac.id] = Math.max(-100, (realm.factions[mine]!.stances[fac.id] ?? 0) - 1);
      moved.add(b);
    }
    if (moved.size !== (f.data.moved ?? []).length) store.records.patch<FabricationData>(f.id, { data: { moved: [...moved] } });
    // Forgotten: nobody holds it any more.
    if (store.knowledge.holders(rumourRef(f.id)).length === 0 && day - f.since > 6) {
      store.records.end(f.id, day, "forgotten");
      continue;
    }
    // The watch looks into it.
    if (f.data.investigated || !["stole", "plots", "spy", "hoards", "cheats"].includes(f.data.claim)) continue;
    if (who.length < Math.max(3, INVESTIGATE_SHARE * grown.length)) continue;
    const captain = grown.find((r) => r.job === "guard") ?? grown[0];
    if (!captain) continue;
    const found = walkTrail(ctx, f, who, day);
    store.records.patch<FabricationData>(f.id, { data: { investigated: { day, by: captain.id, hops: found.hops, ...(found.origin ? { found: found.origin } : {}), ...(found.shielded ? { shielded: found.shielded } : {}) } } });
    const e = recordLifeEvent(realm, store, { kind: "investigation", actor: captain.id, target: f.data.subject, site, day, key: f.id, details: `${captain.name} of the watch looked into the talk that ${f.data.subjectName} ${f.data.claim === "stole" ? "stole " + (f.data.detail ?? "the tax money") : f.data.claim}${found.origin ? `, and traced it to ${found.origin === "player" ? (player?.name ?? "a stranger") : (store.people.get(found.origin)?.name ?? "someone")}` : ", and could not say who started it"}`, importance: 5 });
    events.push(e.id);
    if (!found.origin) continue;
    // Found out: the subject's grudge, and the law's case.
    addGrievance(store, { who: f.data.subject, against: found.origin, cause: `r:${f.id}`, weight: 1.2, day });
    if (found.origin === "player") openPlayerCase(ctx, player ?? null, "slander", site, day, [captain.id]);
    else if (found.origin !== "player") store.records.put({ id: `case:slander:${f.id}`, kind: "case", site, a: f.data.subject, b: found.origin, since: day, status: "open", ended: null, data: { crime: "slander", accused: found.origin, accuser: f.data.subject, witnesses: [captain.id] } });
  }
  return events;
}

/**
 * Walk a rumour's tellers back (N52 decision 5): from a believer to whoever told them, hop by hop, each hop found by chance; a teller fond
 * of the one who told them shields them. Reaching the first one told, they name its maker unless they shield them too.
 */
export function walkTrail(ctx: LifeCtx, f: Fabrication, from: string[], day: number): { origin: string | null; hops: number; shielded?: string } {
  const { realm, store } = ctx;
  const rng = streamFor(realm.seed, "trail", f.id, day);
  let at = from.find((b) => b !== f.data.first) ?? from[0]!;
  let hops = 0;
  for (let guard = 0; guard < 40; guard++) {
    const row = store.knowledge.get(at, rumourRef(f.id));
    const told = row?.source ?? null;
    if (!told) return { origin: null, hops };
    if (told === f.data.by) {
      // The first one told: do they name the maker?
      const fond = viewOf(store, at, told, day).affection;
      if (fond >= 40 || rng() > 0.8) return { origin: null, hops, shielded: at };
      return { origin: told, hops: hops + 1 };
    }
    if (viewOf(store, at, told, day).affection >= 40) return { origin: null, hops, shielded: at };
    if (rng() > HOP) return { origin: null, hops };
    at = told;
    hops++;
  }
  return { origin: null, hops };
}

// ---- Paid voices and framing (N52 decisions 4, 6) ----

/** A voice for hire: a bard at the inn, a priest at the temple, a crier (with the head's leave). Their price and whether they'll do it. */
export function payVoice(ctx: LifeCtx, p: PlayerState, kind: "bard" | "priest" | "crier", voice: PersonRow, f: { subject: string; subjectName: string; claim: string; detail?: string }, site: string, day: number): string[] {
  const t = temperOf(voice);
  const price = kind === "crier" ? 80 : kind === "priest" ? 50 : 25;
  // A priest won't preach against their own; an honest voice won't sell a lie.
  if (t.honesty > 0.75) return [`${voice.name} won't say what they don't know to be true.`];
  if (kind === "priest" && voice.faction && voice.faction === ctx.store.people.get(f.subject)?.faction) return [`${voice.name} won't preach against their own.`];
  if (p.money < price) return [`${voice.name} wants ${price} copper.`];
  transfer(ctx.realm, "player", `s:${site}`, price, `paid ${voice.name} for a ${kind === "bard" ? "song" : kind === "priest" ? "sermon" : "proclamation"}`, p, day);
  const fab = plant(ctx, { by: "player", byName: p.name, listener: voice, ...f, site, day, key: `${kind}:${day}` });
  // Everyone at the venue hears it at once: the inn's evening, the temple's faithful, the whole place for a crier.
  const rows = (ctx.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.job !== "child" && r.id !== voice.id);
  const reach = kind === "crier" ? rows : rows.filter((r) => unitFor(ctx.realm.seed, "venue", kind, r.id, day) < (kind === "bard" ? 0.15 : 0.25));
  for (const r of reach) learn(ctx, r.id, rumourRef(fab.id), { day, source: voice.id, accuracy: kind === "priest" ? 0.75 : kind === "crier" ? 0.85 : 0.6 });
  recordLifeEvent(ctx.realm, ctx.store, { kind: "commissioned", actor: "player", target: voice.id, site, day, key: fab.id, details: `${voice.name} ${kind === "bard" ? "sang a new song" : kind === "priest" ? "preached a sermon" : "cried a proclamation"} about ${f.subjectName}`, importance: 3 });
  return [`${voice.name} takes your coin. By evening ${reach.length} have heard it.`];
}

/**
 * Framing (N52 decision 4): goods hidden in the target's house and a witness who swears to it. The witness weighs it (coin, a grudge
 * against the target, honesty, fear of being caught); a case opens against the target with the planted evidence, and a bribed witness
 * whose bribe comes out turns it on the one who framed.
 */
export function frame(ctx: LifeCtx, p: PlayerState, target: PersonRow, witness: PersonRow, bribe: number, day: number): { ok: boolean; lines: string[]; caseId?: string } {
  const t = temperOf(witness);
  const grudge = ctx.store.social.openBetween(witness.id, target.id).length > 0 ? 0.3 : 0;
  const willing = (bribe / 100) * (0.5 + t.greed) + grudge - t.honesty * 0.8;
  if (willing < 0.2) return { ok: false, lines: [`${witness.name} won't swear to it.`] };
  if (p.money < bribe) return { ok: false, lines: ["You haven't the coin."] };
  // Into the witness's own pocket (townsfolk have no purse the realm keeps: the coin leaves the books with the player's).
  p.money -= bribe;
  const id = `case:framed:${target.id}:${day}`;
  ctx.store.records.put({ id, kind: "case", site: target.site, a: witness.id, b: target.id, since: day, status: "open", ended: null, data: { crime: "theft", accused: target.id, accuser: witness.id, witnesses: [witness.id], planted: true, framedBy: "player", bribe } });
  recordLifeEvent(ctx.realm, ctx.store, { kind: "framed", actor: "player", target: target.id, site: target.site, day, key: id, details: `Stolen goods were found in ${target.name}'s house, and ${witness.name} swore to seeing them taken`, importance: 4 });
  // The bribe can come out: the witness is not over-honest, but not a good liar either.
  if (unitFor(ctx.realm.seed, "bribe-out", id) < 0.2 + t.honesty * 0.3) {
    ctx.store.records.end(id, day, "turned");
    openPlayerCase(ctx, p, "slander", target.site, day, [witness.id]);
    addGrievance(ctx.store, { who: target.id, against: "player", cause: `framed:${id}`, weight: 1.2, day });
    return { ok: false, lines: [`${witness.name} breaks down before the head and tells who paid them. The case turns on you.`], caseId: id };
  }
  return { ok: true, lines: [`${witness.name} swears to it. There's a case against ${target.name} now.`], caseId: id };
}
