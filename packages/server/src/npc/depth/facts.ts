import { parseDeath } from "../../game/people/death.js";
import { atWar } from "../../game/realm/economy.js";
import { rankIn } from "../../game/realm/factions.js";
import { chainOf, titled } from "../../game/realm/figures.js";
import { feelingsOf, outlookOf } from "../../game/people/outlook.js";
import type { Figure, Realm, Settlement } from "../../game/realm/types.js";
import { kingdomLaws } from "../../game/realm/townsfolk.js";
import type { GameEvent } from "../../game/events.js";
import type { PeopleStore, PersonRow } from "../../store/peopleStore.js";
import type { NpcPersona } from "../types.js";

/**
 * The facts sheet (N25a step 5a): what is true about a person, gathered by code from the realm, their people row and
 * the event store, as a small structured sheet. It is the only thing the model sees of their history (so it can't
 * invent one), what the validator checks the model's words against, and what the code fallback builds from.
 * Nothing here is random and nothing calls the model.
 */

export interface Relative {
  /** Persona id, when they are a talker. */
  id?: string;
  /** Their townsperson id (a `people` row), when they have one. */
  rowId?: string;
  name: string;
  kind: "spouse" | "parent" | "child" | "sibling";
  alive: boolean;
  /** How they died, in a few words ("killed in a raid", "a beast", "illness"). */
  cause?: string;
  age?: number;
}

export const SECRET_KINDS = ["debt", "crime", "hidden_tie", "past", "witnessed", "loss", "vice"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** Something that could be a secret because it is true: the fact behind it, and who already knows. */
export interface SecretCandidate {
  id: string;
  kind: SecretKind;
  /** The fact, in a sentence that names only people on the sheet. */
  fact: string;
  /** A person the secret concerns (their name), for the crime and witnessed kinds. */
  subject?: string;
  /** Who it is owed to, for a debt. */
  creditor?: string;
  /** Persona ids that already know. */
  knownBy: string[];
}

export interface FactsSheet {
  id: string;
  name: string;
  age: number;
  gender: string;
  role: string;
  /** What they do, by template: smith, innkeeper, guard, merchant, farmer, child, bandit. */
  job: string;
  cls: string;
  site: string;
  siteName: string;
  siteKind: string;
  kingdom?: string;
  /** The head of their place, with a title. */
  lord?: string;
  /** "serf" / "slave" / "free": how their kingdom's law holds them. */
  law: "free" | "serf" | "slave";
  faction?: { name: string; rank: string; kind: string };
  master?: string;
  /** Copper, and what they own against what they need. */
  wealth: number;
  family: Relative[];
  deeds: string[];
  /** The place's conditions that touch them ("a raid on day 40", "a poor harvest", "the kingdom is at war"). */
  conditions: string[];
  /** Other people of their place worth naming: name and what they do. */
  neighbours: Array<{ id?: string; name: string; job: string }>;
  /** Events they were part of: what happened, in a line. */
  history: string[];
  /** How they have come to feel, from the reviews of their life before they talked (game/people/outlook.ts): "they have little trust in the lord". */
  feelings: string[];
  secrets: SecretCandidate[];
  /** Every proper name the words may use. */
  names: string[];
}

export interface FactsCtx {
  realm?: Realm | null;
  people?: Pick<PeopleStore, "get" | "childrenOf"> | null;
  events?: readonly GameEvent[];
  day: number;
  /** The registry of talking people: persona id → place and persona. */
  talkers: Record<string, { site: string; persona: NpcPersona }>;
}

const CAUSE_WORDS: Record<string, string> = {
  "old-age": "old age",
  illness: "an illness",
  famine: "hunger",
  battle: "a battle",
  siege: "a siege",
  raid: "a raid",
  execution: "the gallows",
  murder: "murder",
  beast: "a beast",
  accident: "an accident",
  childbirth: "childbirth",
  missing: "going missing",
};

/** A row's death in words, or undefined while they live. */
function causeOf(row: PersonRow): string | undefined {
  const d = parseDeath(row.death);
  return d ? (CAUSE_WORDS[d.cause] ?? d.cause) : undefined;
}

const firstWord = (name: string) => name.split(" ")[0]!;

function figureFor(realm: Realm | null | undefined, persona: NpcPersona): Figure | undefined {
  if (!realm) return undefined;
  return Object.values(realm.figures).find((f) => f.talks === persona.id) ?? realm.figures[persona.id.replace(/^f_/, "").replace(/_/g, "-")] ?? Object.values(realm.figures).find((f) => `f_${f.id.replace(/[^a-z0-9]/g, "_")}` === persona.id);
}

/** What `people` knows of their family. */
function familyOf(ctx: FactsCtx, row: PersonRow | null, f: Figure | undefined): Relative[] {
  const out: Relative[] = [];
  const people = ctx.people;
  const personaOf = (rowId: string, name: string) => Object.values(ctx.talkers).find((t) => t.persona.id === rowId || t.persona.name === name)?.persona.id;
  const add = (r: PersonRow | null, kind: Relative["kind"]) => {
    if (!r) return;
    const cause = causeOf(r);
    const talker = r.persona ?? personaOf(r.id, r.name);
    out.push({ ...(talker ? { id: talker } : {}), rowId: r.id, name: r.name, kind, alive: !cause && !r.death, ...(cause ? { cause } : {}), age: Math.max(0, Math.floor((ctx.day - r.born_day) / 365)) });
  };
  if (row && people) {
    add(row.spouse ? people.get(row.spouse) : null, "spouse");
    for (const p of [row.mother, row.father]) add(p ? people.get(p) : null, "parent");
    for (const c of people.childrenOf(row.id)) add(c, "child");
    for (const parent of [row.mother, row.father]) {
      if (!parent) continue;
      for (const s of people.childrenOf(parent)) if (s.id !== row.id && !out.some((o) => o.name === s.name)) add(s, "sibling");
    }
  } else if (f && ctx.realm) {
    for (const p of f.parents ?? []) {
      const par = ctx.realm.figures[p];
      if (par) out.push({ name: par.name, kind: "parent", alive: par.alive, ...(par.alive ? {} : { cause: par.deathCause ?? "age" }) });
    }
    for (const kid of Object.values(ctx.realm.figures)) if (kid.parents?.includes(f.id)) out.push({ name: kid.name, kind: "child", alive: kid.alive, ...(kid.alive ? {} : { cause: kid.deathCause ?? "age" }) });
  }
  return out.slice(0, 8);
}

function conditionsOf(realm: Realm | null | undefined, s: Settlement | undefined, day: number): string[] {
  if (!realm || !s) return [];
  const out: string[] = [];
  if (s.lastRaided !== undefined && day - s.lastRaided < 60) out.push(`${s.name} was raided ${day - s.lastRaided < 2 ? "lately" : `${day - s.lastRaided} days ago`}`);
  if (s.food < 30) out.push(`the granaries of ${s.name} are nearly empty`);
  else if (s.food > 80) out.push(`a good harvest fills the granaries of ${s.name}`);
  if (s.prosperity < 30) out.push(`times are hard in ${s.name}`);
  if (s.arrears > 0) out.push(`${s.name} is behind on its taxes`);
  if (atWar(realm, s)) out.push(`the kingdom is at war`);
  return out;
}

/** Facts of the person that could be a secret, from the data alone. */
function secretCandidates(sheet: Omit<FactsSheet, "secrets" | "names">, persona: NpcPersona, row: PersonRow | null, f: Figure | undefined, ctx: FactsCtx): SecretCandidate[] {
  const out: SecretCandidate[] = [];
  const add = (c: Omit<SecretCandidate, "id">) => out.push({ id: `${c.kind}${out.filter((o) => o.kind === c.kind).length + 1}`, ...c });
  const honest = persona.traits?.honesty ?? 0.5;
  // A debt: a trader who is poor against what the trade costs, owing the head of their place or the guild.
  const trade = ["smith", "innkeeper", "merchant"].includes(sheet.job);
  const creditor = sheet.lord ?? sheet.faction?.name;
  if (trade && creditor && persona.startingMoney < 1500) add({ kind: "debt", fact: `${persona.name} owes ${creditor} more than the business has earned`, creditor, knownBy: [] });
  // A hidden tie: an honest trade, a gang's coin.
  if (sheet.faction?.kind === "gang" && persona.template !== "bandit") add({ kind: "hidden_tie", fact: `${persona.name} is a member of ${sheet.faction.name} and lives as ${sheet.job}`, knownBy: [] });
  // A crime in the record: a deed that is no credit to them.
  const crime = sheet.deeds.find((d) => /\b(stole|robbed|raided|killed|burned|smuggled|poached)\b/i.test(d));
  if (crime) add({ kind: "crime", fact: `${persona.name} ${crime}`, knownBy: [] });
  // A past they'd hide: born in bondage, or risen from nothing.
  if (sheet.law === "slave" || sheet.cls === "slave") add({ kind: "past", fact: `${persona.name} was born a slave`, knownBy: [] });
  else if (f?.rose) add({ kind: "past", fact: `${persona.name} came from nothing and was never anyone's heir`, knownBy: [] });
  // Something they saw and kept quiet about: a theft or a killing with them as a witness, in the event store.
  const seen = (ctx.events ?? []).find((e) => (e.kind === "theft" || e.kind === "crime" || e.kind === "killed") && e.witnesses?.includes(persona.id) && e.actor !== persona.id);
  if (seen) add({ kind: "witnessed", fact: `${persona.name} saw this and told no one: ${seen.details}`, subject: ctx.talkers[seen.actor]?.persona.name, knownBy: seen.knownBy ?? [] });
  // A loss they don't speak of.
  const lost = sheet.family.find((r) => !r.alive && r.cause);
  if (lost) add({ kind: "loss", fact: `${persona.name} lost ${lost.kind === "spouse" ? "their spouse" : `a ${lost.kind}`}, ${lost.name}, to ${lost.cause}`, subject: lost.name, knownBy: [] });
  // A weakness of character, from the numbers: a dishonest trader cheats; a wanting one skims.
  if (trade && honest < 0.4) add({ kind: "vice", fact: `${persona.name} shortchanges customers when no one is counting`, knownBy: [] });
  else if (honest < 0.3) add({ kind: "vice", fact: `${persona.name} takes what isn't theirs when no one is looking`, knownBy: [] });
  void row;
  return out;
}

/** Everything true about a person. */
export function factsFor(ctx: FactsCtx, persona: NpcPersona): FactsSheet {
  const realm = ctx.realm ?? null;
  const talker = ctx.talkers[persona.id];
  const f = figureFor(realm, persona);
  const row = ctx.people ? (ctx.people.get(persona.id) ?? (f?.person ? ctx.people.get(f.person) : null)) : null;
  const site = talker?.site ?? f?.home ?? row?.site ?? "";
  const s = realm?.settlements[site];
  const kingdom = s?.kingdom ? realm?.kingdoms[s.kingdom] : undefined;
  const head = s?.leader ? realm?.figures[s.leader] : undefined;
  const fac = f?.faction ? realm?.factions[f.faction] : row?.faction ? realm?.factions[row.faction] : undefined;
  const laws = kingdomLaws(realm as Realm, s?.kingdom ?? null);
  const cls = row?.cls ?? (f ? "commoner" : "commoner");
  const law: FactsSheet["law"] = cls === "slave" ? "slave" : cls === "serf" ? "serf" : "free";
  void laws;
  const mine = (e: GameEvent) => e.actor === persona.id || e.target === persona.id;
  const history = (ctx.events ?? []).filter(mine).sort((a, b) => b.importance - a.importance).slice(0, 5).map((e) => `day ${e.day}: ${e.details}`);
  const neighbours = Object.values(ctx.talkers)
    .filter((t) => t.site === site && t.persona.id !== persona.id)
    .slice(0, 8)
    .map((t) => ({ id: t.persona.id, name: t.persona.name, job: t.persona.template ?? "townsperson" }));
  const base: Omit<FactsSheet, "secrets" | "names"> = {
    id: persona.id,
    name: persona.name,
    age: persona.age,
    gender: persona.voice?.gender ?? f?.gender ?? row?.gender ?? "female",
    role: persona.role,
    job: persona.template ?? "townsperson",
    cls,
    site,
    siteName: s?.name ?? "their town",
    siteKind: s?.kind ?? "village",
    ...(kingdom ? { kingdom: kingdom.name } : {}),
    ...(head && head.id !== f?.id ? { lord: titled(head) } : {}),
    law,
    ...(fac && f ? { faction: { name: fac.name, rank: rankIn(realm as Realm, fac, f.id), kind: fac.kind } } : fac ? { faction: { name: fac.name, rank: "member", kind: fac.kind } } : {}),
    ...(row?.master ? { master: row.master } : f && realm ? (() => { const sup = chainOf(realm, f.id)[0]; return sup ? { master: titled(sup) } : {}; })() : {}),
    wealth: f?.wealth ?? persona.startingMoney,
    family: familyOf(ctx, row, f),
    deeds: f?.deeds.slice(-4) ?? [],
    conditions: conditionsOf(realm, s, ctx.day),
    neighbours,
    history,
    feelings: row?.outlook ? feelingsOf(outlookOf(row), head && head.id !== f?.id ? titled(head) : undefined) : [],
  };
  const secrets = secretCandidates(base, persona, row, f, ctx);
  const names = new Set<string>([persona.name, base.siteName, ...(base.kingdom ? [base.kingdom] : []), ...(base.lord ? [base.lord] : []), ...(base.master ? [base.master] : []), ...(base.faction ? [base.faction.name] : []), ...base.family.map((r) => r.name), ...neighbours.map((n) => n.name), ...secrets.flatMap((c) => [c.subject, c.creditor].filter(Boolean) as string[])]);
  for (const n of [...names]) names.add(firstWord(n));
  return { ...base, secrets, names: [...names] };
}
