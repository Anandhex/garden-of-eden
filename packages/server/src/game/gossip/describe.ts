import { CLASS_RANK, hashStr, type SocialClass } from "@millbrook/shared";
import type { LifeCtx } from "../people/step.js";
import { deathWords, parseDeath, type DeathCause } from "../people/death.js";
import { parseRef } from "./refs.js";

/**
 * What a person would say of a thing they know (N33): the truth stays where it is (the news record, the person's death record, the
 * event) and only the telling changes. A retelling can change one detail, picked by seed, as a small whole number: `variant` is
 * `field × 16 + alt` (0 is the thing as it happened). The same variant renders the same words every time.
 */
export const FIELDS = ["truth", "who", "where", "how many", "why"] as const;
export type Field = 1 | 2 | 3 | 4;

export const fieldOf = (variant: number): number => Math.floor(variant / 16);
export const altOf = (variant: number): number => variant % 16;
export const variantOf = (field: Field, alt: number): number => field * 16 + (alt % 16);

const firstName = (name: string) => name.split(" ")[0] ?? name;

/** Causes folk mistake for one another, so a distorted death is believable. */
const MISTAKEN: Partial<Record<DeathCause, DeathCause[]>> = {
  "old-age": ["illness", "accident"],
  illness: ["famine", "old-age", "murder"],
  famine: ["illness", "old-age"],
  battle: ["raid", "murder", "siege"],
  siege: ["battle", "famine"],
  raid: ["battle", "murder", "beast"],
  execution: ["murder"],
  murder: ["accident", "execution", "illness"],
  beast: ["raid", "accident"],
  accident: ["murder", "illness", "beast"],
  childbirth: ["illness"],
};

const figureLists = new WeakMap<object, { n: number; list: Array<LifeCtx["realm"]["figures"][string]>; names: Set<string> }>();
/** The realm's figures in id order (kept until one is added or lost: sorting them for every retelling is the daily cost of gossip). */
function figuresOf(ctx: LifeCtx) {
  const figs = ctx.realm.figures;
  const n = Object.keys(figs).length;
  let held = figureLists.get(figs);
  if (!held || held.n !== n) {
    const list = Object.values(figs).sort((a, b) => (a.id < b.id ? -1 : 1));
    figureLists.set(figs, (held = { n, list, names: new Set(list.map((f) => f.name)) }));
  }
  return held;
}
const sortedFigures = (ctx: LifeCtx) => figuresOf(ctx).list;

/** The settlement next door that a story might be confused with, by alt. */
function neighbour(ctx: LifeCtx, site: string, alt: number): string | null {
  const s = ctx.realm.settlements[site];
  const near = (s?.roads ?? []).filter((id) => ctx.realm.settlements[id] && !ctx.realm.settlements[id]!.way).sort();
  return near.length > 0 ? (ctx.realm.settlements[near[alt % near.length]!]?.name ?? null) : null;
}

/** Which details of a thing a retelling could get wrong. */
export function fieldsOf(ctx: LifeCtx, ref: string): Field[] {
  const r = parseRef(ref);
  if (!r) return [];
  const out: Field[] = [];
  if (r.kind === "n") {
    const n = ctx.realm.news.find((x) => x.id === r.id);
    if (!n) return [];
    if ((n.names ?? []).some((name) => n.text.includes(name) && figuresOf(ctx).names.has(name))) out.push(1);
    if (n.at && ctx.realm.settlements[n.at] && n.text.includes(ctx.realm.settlements[n.at]!.name) && neighbour(ctx, n.at, 0)) out.push(2);
    if (/\b\d+\b/.test(n.text)) out.push(3);
    return out;
  }
  if (r.kind === "d") {
    const row = ctx.store.people.get(r.id);
    if (!row) return [];
    const rec = parseDeath(row.death);
    if (row.spouse || row.mother || row.father) out.push(1);
    if (rec?.site && neighbour(ctx, rec.site, 0)) out.push(2);
    if (rec && MISTAKEN[rec.cause]) out.push(4);
    return out;
  }
  // A made-up rumour (N52) drifts like any: the wrong one of the family, the thing it was about.
  if (r.kind === "r") {
    const f = ctx.store.records?.get(r.id)?.data as { subject?: string; claim?: string } | undefined;
    if (!f) return [];
    const row = f.subject ? ctx.store.people.get(f.subject) : null;
    if (row && (row.spouse || row.mother || row.father)) out.push(1);
    if (f.claim === "stole") out.push(2);
    out.push(4);
    return out;
  }
  return [];
}

/** What a person with this version would say, or null for a thing that is gone. */
export function describeKnown(ctx: LifeCtx, ref: string, accuracy: number, variant: number): string | null {
  const r = parseRef(ref);
  if (!r) return null;
  const field = fieldOf(variant);
  const alt = altOf(variant);
  let text: string | null = null;
  if (r.kind === "n") text = describeNews(ctx, r.id, field, alt);
  else if (r.kind === "d") text = describeDeath(ctx, r.id, field, alt);
  else if (r.kind === "e") text = describeEvent(ctx, r.id);
  else if (r.kind === "i") text = describeItem(ctx, r.id);
  else if (r.kind === "r") text = describeRumour(ctx, r.id, field, alt);
  // A secret they know (N46): what it says, never passed on by gossip by itself.
  else if (r.kind === "s") text = (ctx.store.records?.get(r.id)?.data as { text?: string } | undefined)?.text ?? null;
  if (!text) return null;
  return accuracy < 0.5 ? `${text} (or so folk say)` : text;
}

function describeNews(ctx: LifeCtx, id: string, field: number, alt: number): string | null {
  const n = ctx.realm.news.find((x) => x.id === id);
  if (!n) return null;
  let text = n.text;
  if (field === 1) {
    const name = (n.names ?? []).find((nm) => n.text.includes(nm) && sortedFigures(ctx).some((f) => f.name === nm));
    const others = sortedFigures(ctx).filter((f) => f.name !== name && !n.text.includes(f.name));
    const other = others.length > 0 ? others[(alt + hashStr(id)) % others.length] : undefined;
    if (name && other) text = text.split(name).join(other.name);
  } else if (field === 2 && n.at && ctx.realm.settlements[n.at]) {
    const swap = neighbour(ctx, n.at, alt);
    if (swap) text = text.split(ctx.realm.settlements[n.at]!.name).join(swap);
  } else if (field === 3) {
    // The number grows or shrinks in the telling.
    text = text.replace(/\b\d+\b/, (m) => String(Math.max(1, alt % 2 === 0 ? Number(m) * 2 : Math.ceil(Number(m) / 2) + (alt % 3))));
  }
  return text;
}

function describeDeath(ctx: LifeCtx, id: string, field: number, alt: number): string | null {
  const row = ctx.store.people.get(id);
  if (!row) return null;
  const rec = parseDeath(row.death);
  if (!rec) return null;
  let who = row.name;
  let cause: DeathCause = rec.cause;
  let site = rec.site;
  if (field === 1) {
    // The wrong one of the family: told as the spouse, or a parent, who died.
    const kin = [row.spouse, row.mother, row.father].filter((x): x is string => !!x);
    const other = kin.length > 0 ? ctx.store.people.get(kin[alt % kin.length]!) : null;
    if (other) who = other.name;
  } else if (field === 4) {
    const alts = MISTAKEN[rec.cause];
    if (alts && alts.length > 0) cause = alts[alt % alts.length]!;
  } else if (field === 2 && rec.site) {
    const swapped = neighbour(ctx, rec.site, alt);
    if (swapped) return `${who} died ${deathWords({ cause, ...(rec.note ? { note: rec.note } : {}) })} at ${swapped}`;
  }
  const where = site && site !== row.site ? ` at ${ctx.realm.settlements[site]?.name ?? "a place far off"}` : "";
  const rank = CLASS_RANK[row.cls as SocialClass] ?? 2;
  const title = row.job && row.job !== "child" && rank < 5 ? `, the ${row.job},` : "";
  return `${who}${field === 1 ? "" : title} died ${deathWords({ cause, ...(rec.note ? { note: rec.note } : {}) })}${where}`;
}

/** A notable item as someone who knows it would speak of it (N43): its name, and who has it last they heard. */
function describeItem(ctx: LifeCtx, id: string): string | null {
  const it = ctx.store.notables?.get(id);
  if (!it) return null;
  const h = JSON.parse(it.history) as Array<{ who: string; name?: string; kind: string }>;
  const last = [...h].reverse().find((e) => e.kind !== "used" && e.kind !== "named");
  const who = last ? (last.name ?? ctx.store.people.get(last.who)?.name ?? ctx.realm.figures[last.who]?.name) : undefined;
  return `${it.name ?? `a fine ${it.base}`}${who ? ` is ${last!.kind === "stolen" || last!.kind === "looted" ? "in the hands of" : "held by"} ${who}` : " is lost"}`;
}

function describeEvent(ctx: LifeCtx, id: string): string | null {
  return ctx.store.eventById(id)?.details ?? null;
}

/** The first word a person says it with, for a short line: "heard that". */
export const heardThat = (text: string, from?: string): string => `${from ? `${firstName(from)} says` : "Folk say"} ${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** What was stolen, as the telling has it. */
const LOOT = ["the tax money", "the grain money", "the church plate", "the well fund", "the market dues"];
/** How a made-up claim is said, by claim, and by how it grows (field 4). */
const CLAIMS: Record<string, [string, string]> = {
  stole: ["{who} stole {what}", "{who} has been stealing {what} for years"],
  cheats: ["{who} cheats at the scales", "{who} cheats everyone who deals with them"],
  affair: ["{who} is carrying on behind their spouse's back", "{who} has a lover in every street"],
  plots: ["{who} plots against the head of the place", "{who} plots with outlaws against the place"],
  heretic: ["{who} keeps a forbidden faith", "{who} worships something dark"],
  spy: ["{who} is a spy for another crown", "{who} sells the place's secrets abroad"],
  sick: ["{who} is sick with something catching", "{who} is dying of the plague"],
  broke: ["{who} is broke", "{who} owes money to everyone"],
  hoards: ["{who} is hoarding grain", "{who} is hoarding grain while children go hungry"],
};

/** A made-up rumour as a person who heard it would tell it (N52): its claim about its subject, drifted by the version they have. */
function describeRumour(ctx: LifeCtx, id: string, field: number, alt: number): string | null {
  const f = ctx.store.records?.get(id)?.data as { subject?: string; subjectName?: string; claim?: string; detail?: string } | undefined;
  if (!f?.claim) return null;
  let who = f.subjectName ?? "someone";
  if (field === 1 && f.subject) {
    const row = ctx.store.people.get(f.subject);
    const kin = row ? [row.spouse, row.mother, row.father].filter((x): x is string => !!x) : [];
    const other = kin.length > 0 ? ctx.store.people.get(kin[alt % kin.length]!) : null;
    if (other) who = other.name;
  }
  const what = field === 2 ? LOOT[(alt + 1) % LOOT.length]! : (f.detail ?? LOOT[0]!);
  const [plain, worse] = CLAIMS[f.claim] ?? ["{who} is not what they seem", "{who} is not what they seem"];
  return (field === 4 ? worse : plain).replace("{who}", who).replace("{what}", what);
}
