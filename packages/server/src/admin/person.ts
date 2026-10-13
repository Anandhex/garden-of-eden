import type { AdminCard, AdminHour, AdminPinned, AdminSection } from "@millbrook/shared";
import { CLASS_WORDS, JOB_INFO } from "@millbrook/shared";
import { knowsEvent } from "../game/events.js";
import { ageOn } from "../game/life.js";
import { formatMoney } from "../game/money.js";
import { chainOf, titled } from "../game/realm/figures.js";
import { rankIn } from "../game/realm/factions.js";
import { HOME_ID } from "../game/realm/generate.js";
import { lineageOf } from "../game/people/index.js";
import { deathWords, parseDeath } from "../game/people/death.js";
import { ageFrom } from "../game/people/rules.js";
import { traitsOfRow } from "../game/people/traits.js";
import type { PersonRow } from "../store/peopleStore.js";
import { parseTownsfolkId } from "../game/realm/townsfolk.js";
import type { Figure, Settlement } from "../game/realm/types.js";
import { realmView } from "../game/realm/view.js";
import { currentPlan, describePlan } from "../game/schedule.js";
import { describeRelation } from "../npc/social.js";
import type { NpcPersona, NpcState } from "../npc/types.js";
import type { AdminContext } from "./context.js";
import { events } from "./events.js";
import { classCounts, crowdDay, folkOf, townsperson } from "./folk.js";
import { playerCard } from "./player.js";
import { nameOfRef, parseRef, refOfId } from "./refs.js";

/**
 * Person and place cards (N17). A card is a list of sections (title + rows), not one big
 * typed object, so later phases add sections (ambitions N37, grievances N40, choices N38)
 * without the page changing. A section whose phase isn't built says so: `unavailable: "N38"`.
 *
 * Everything here reads. It never calls a helper that fills in missing fields on the world.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const siteName = (ctx: AdminContext, site: string | null) => (site ? (ctx.world().realm?.settlements[site]?.name ?? site) : null);

/** Rows of the numbers one NPC feels about another. */
const axes = (r: { trust: number; fear: number; respect: number; affection: number }) => `trust ${Math.round(r.trust)}, fear ${Math.round(r.fear)}, respect ${Math.round(r.respect)}, affection ${Math.round(r.affection)}`;

// ---------- the cast (talking NPCs, including people of other places met in play) ----------

function castSections(ctx: AdminContext, id: string, persona: NpcPersona, state: NpcState): AdminSection[] {
  const world = ctx.world();
  const out: AdminSection[] = [];
  const dead = state.outcome === "dead";
  const plan = currentPlan(persona, state, world);

  out.push({
    title: "Right now",
    rows: [
      ["Doing", dead ? `dead${state.deathCause ? ` (${state.deathCause})` : ""}` : describePlan(plan)],
      ["Mood", state.mood],
      ["Health", `${Math.round(state.hp)} hp`],
      ["Purse", formatMoney(state.money)],
      ["Rank", `${state.life.tier}, ${state.life.stage}, age ${ageOn(state.life, world.day)}`],
      ...(state.companion ? [["With the player", "hired as a companion"] as [string, string]] : []),
      ...(state.inCombat ? [["Fighting", "yes"] as [string, string]] : []),
    ],
  });

  out.push({
    title: "Needs and emotions",
    rows: [
      ["Hunger", `${Math.round(state.needs.hunger)} / 100`],
      ["Energy", `${Math.round(state.needs.energy)} / 100`],
      ...state.emotions.map((e): [string, string] => [e.kind, `${pct(e.strength)} about ${e.about}${e.aboutPlayer ? " (the player)" : ""}, since day ${e.since}`]),
    ],
  });

  const goalRows: Array<[string, string]> = [
    ...persona.goals.map((g): [string, string] => ["Wants", g]),
    ...state.goals.map((g): [string, string] => [cap(g.kind), `${g.plan} against the player: ${g.reason} (${pct(g.strength)}, since day ${g.day}${g.acted ? `, acted day ${g.acted}` : ""})`]),
  ];
  if (state.grudge) goalRows.push(["Grudge", `${state.grudge.reason} (since day ${state.grudge.day}${state.grudge.blood ? ", blood" : `, until day ${state.grudge.until}`})`]);
  out.push({ title: "Goals and grudges", rows: goalRows });

  const others = Object.entries(state.npcRelations)
    .map(([other, r]) => ({ other, r, w: Math.abs(r.trust) + Math.abs(r.fear) + Math.abs(r.respect) + Math.abs(r.affection) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 10);
  out.push({
    title: "Relationships",
    rows: [
      ["The player", state.metBefore ? `${axes({ trust: state.relationship, fear: state.fear, respect: state.respect, affection: state.affection })}${state.knownName ? `; knows them as ${state.knownName}` : ""}` : "never met", "player"],
      ...others.map(({ other, r }): [string, string, string?] => {
        const ref = refOfId(ctx, other);
        return [ref ? nameOfRef(ctx, ref) : other, describeRelation(r) ?? axes(r), ref ?? undefined];
      }),
    ],
  });

  const rumours = Object.values(state.rumours);
  const known = (world.events ?? []).filter((e) => knowsEvent(e, id)).slice(-8).reverse();
  out.push({
    title: "What they know or believe",
    rows: [
      ...rumours.map((r): [string, string] => [`Rumour about ${r.about === "player" ? "the player" : (nameOfRefId(ctx, r.about))}`, `${r.text} (${r.truth}, ${pct(r.accuracy)} sure${r.heardFrom ? `, from ${r.heardFrom}` : ""}, day ${r.day})`]),
      ...state.beliefs.map((b): [string, string] => ["Believes the player", `${b.claim}${b.foundOut ? " (but found out it was a lie)" : ""}, day ${b.day}`]),
      ...known.map((e): [string, string] => [`Knows of (day ${e.day})`, `${e.kind}: ${e.details}`]),
      ["Lore learned in play", String(Object.keys(state.learned).length)],
    ],
  });

  const family = world.family;
  const spouse = (family?.marriages ?? []).map((m) => (m.a === id ? m.b : m.b === id ? m.a : null)).find((x) => x);
  const children = Object.values({ ...(family?.born ?? {}), ...ctx.town().personas }).filter((p) => p.parents?.includes(id));
  const kin: Array<[string, string, string?]> = [];
  if (spouse) kin.push(["Spouse", spouse === "player" ? world.player.name : nameOfRefId(ctx, spouse), spouse === "player" ? "player" : (refOfId(ctx, spouse) ?? undefined)]);
  for (const p of persona.parents ?? []) kin.push(["Parent", p === "player" ? world.player.name : nameOfRefId(ctx, p), p === "player" ? "player" : (refOfId(ctx, p) ?? undefined)]);
  for (const c of children) kin.push(["Child", c.name, refOfId(ctx, c.id) ?? undefined]);
  for (const c of family?.courting ?? []) if (c.a === id || c.b === id) kin.push(["Courting", nameOfRefId(ctx, c.a === id ? c.b : c.a), refOfId(ctx, c.a === id ? c.b : c.a) ?? undefined]);
  for (const x of family?.expecting ?? []) if (x.parents.includes(id)) kin.push(["Expecting", `a child due day ${x.dueDay}`]);
  out.push({ title: "Family", rows: kin });

  const timeline = ctx.store?.eventsAbout(id, 200) ?? (world.events ?? []).filter((e) => e.actor === id || e.target === id);
  out.push({
    title: "Timeline",
    rows: timeline.slice(-25).reverse().map((e): [string, string] => [`Day ${e.day}, ${String(e.hour).padStart(2, "0")}:00`, `${e.kind}: ${e.details}${e.why ? ` (why: ${e.why})` : ""}`]),
  });
  out.push({ title: "Ambitions and choices", unavailable: "N37 and N38: what they want in life and what they chose, with the options they weighed" });
  return out;
}

const nameOfRefId = (ctx: AdminContext, raw: string): string => {
  const ref = refOfId(ctx, raw);
  return ref ? nameOfRef(ctx, ref) : raw;
};

function castCard(ctx: AdminContext, id: string): AdminCard | null {
  const persona = ctx.town().personas[id];
  const state = ctx.town().agents[id]?.state ?? ctx.world().npcStates[id];
  if (!persona || !state) return null;
  const world = ctx.world();
  const dead = state.outcome === "dead";
  const figure = ctx.town().figureOf(id);
  const t = parseTownsfolkId(id);
  const site = t ? t.site : figure ? figure.home : HOME_ID;
  const sections = castSections(ctx, id, persona, state);
  if (figure) sections.push({ title: "In the realm", rows: [["Realm figure", titled(figure), `figure:${figure.id}`]] });
  return {
    ref: `cast:${id}`,
    kind: "cast",
    name: persona.name,
    subtitle: `${persona.role}${site ? ` of ${siteName(ctx, site)}` : ""}`,
    alive: !dead,
    site,
    siteName: siteName(ctx, site),
    doing: dead ? "dead" : describePlan(currentPlan(persona, state, world)),
    sections,
    ...(site ? { follow: { site, id: "" } } : {}),
  };
}

// ---------- realm figures ----------

function figureCard(ctx: AdminContext, id: string): AdminCard | null {
  const world = ctx.world();
  const realm = world.realm;
  const f: Figure | undefined = realm?.figures[id];
  if (!realm || !f) return null;
  const fac = f.faction ? realm.factions[f.faction] : undefined;
  const chain = chainOf(realm, f.id);
  const home = f.home ? realm.settlements[f.home] : undefined;
  const sections: AdminSection[] = [
    {
      title: "Right now",
      rows: [
        ["Status", f.alive ? "alive" : `dead on day ${f.deathDay ?? "?"} (${f.deathCause ?? "unknown"})`],
        ["Role", f.role],
        ["Home", home?.name ?? "the wilds", home ? `place:${home.id}` : undefined],
        ["Rank", `${f.life.tier} (potential ${f.life.potential}), ${f.life.stage}, age ${ageOn(f.life, world.day)}`],
        ["Renown", String(f.renown)],
        ["Coin", formatMoney(f.wealth)],
      ],
    },
    {
      title: "Standing",
      rows: [
        ["Faction", fac ? `${fac.name} (${rankIn(realm, fac, f.id)})` : "none"],
        ...chain.map((c, i): [string, string, string] => [i === 0 ? "Answers to" : "then", titled(c), `figure:${c.id}`]),
        ...(f.talks ? ([["Talks", "a talking NPC now", `cast:${f.talks}`]] as Array<[string, string, string]>) : []),
      ],
    },
    {
      title: "Nature",
      rows: [
        ["Ambition", pct(f.ambition)],
        ["Loyalty", pct(f.loyalty)],
        ["Greed", pct(f.greed)],
        ["Bravery", pct(f.bravery)],
      ],
    },
    { title: "Deeds", rows: f.deeds.map((d): [string, string] => ["", d]) },
    {
      title: "Family",
      rows: (f.parents ?? []).map((p): [string, string, string?] => ["Parent", realm.figures[p] ? titled(realm.figures[p]!) : p, realm.figures[p] ? `figure:${p}` : undefined]).concat(
        Object.values(realm.figures)
          .filter((c) => c.parents?.includes(f.id))
          .map((c): [string, string, string?] => ["Child", titled(c), `figure:${c.id}`]),
      ),
    },
    {
      title: "Timeline",
      rows: events(ctx, { person: `figure:${f.id}`, limit: 25 }).events.map((e): [string, string] => [`Day ${e.day}`, `${e.text}${e.why ? ` (why: ${e.why})` : ""}`]),
    },
    { title: "Needs, emotions, ambitions, choices", unavailable: "N25 gives the realm's people lives; N37 and N38 give them wants and choices" },
  ];
  return { ref: `figure:${id}`, kind: f.role === "beast" ? "beast" : "figure", name: f.name, subtitle: `${titled(f)}, ${f.role}${home ? ` of ${home.name}` : ""}`, alive: f.alive, site: f.home, siteName: home?.name ?? null, doing: f.alive ? (f.deeds.at(-1) ?? "going about their life") : "dead", sections };
}

// ---------- townsfolk ----------

function buildingName(map: { buildings: Array<{ name: string; kind?: string }> }, i: number | undefined): string | null {
  const b = i === undefined ? undefined : map.buildings[i];
  return b ? (b.name || b.kind || "a building") : null;
}

/** A townsperson's life as the database has it (N25): when they were born, how they died, who they came from and who came from them. */
function lifeSections(ctx: AdminContext, row: PersonRow): AdminSection[] {
  const world = ctx.world();
  const store = ctx.town().store;
  if (!store) return [];
  const realm = world.realm;
  const rec = parseDeath(row.death);
  const traits = traitsOfRow(row);
  const link = (r: PersonRow | null): [string, string, string?] | null => (r ? [r.death === null ? "alive" : "dead", `${r.name}, ${ageFrom(r.born_day, rec?.day ?? world.day)}`, `town:${r.id}`] : null);
  const kin = lineageOf(store.people, row);
  const rows: Array<[string, string, string?]> = [];
  const add = (label: string, r: PersonRow | null) => {
    const l = link(r);
    if (l) rows.push([label, l[1] + (r!.death !== null ? " (dead)" : ""), l[2]]);
  };
  add("Mother", kin.mother);
  add("Father", kin.father);
  add("Spouse", kin.spouse);
  for (const c of kin.children) add("Child", c);
  for (const sb of kin.siblings) add("Sibling", sb);
  const life: Array<[string, string, string?]> = [
    ["Born", `day ${row.born_day}${row.mother ? " in play" : " (one of the first people)"}, age ${ageFrom(row.born_day, rec?.day ?? world.day)}${rec ? " at death" : ""}`],
    ["Potential", `${traits.potential} (ambition ${traits.ambition}, bravery ${traits.bravery}, greed ${traits.greed}, loyalty ${traits.loyalty})`],
  ];
  if (row.expecting) life.push(["Expecting", `a child, due day ${(JSON.parse(row.expecting) as { due: number }).due}`]);
  if (rec) life.push(["Died", `${deathWords(rec)} on day ${rec.day}${rec.hour !== undefined ? ` at ${rec.hour}:00` : ""}${rec.site && realm?.settlements[rec.site] ? ` in ${realm.settlements[rec.site]!.name}` : ""}${rec.killer ? `, by ${rec.killer}` : ""}`, rec.site ? `place:${rec.site}` : undefined], ["Cause", rec.cause + (rec.event ? ` (${rec.event})` : "")]);
  const out: AdminSection[] = [{ title: "Life", rows: life }];
  out.push(rows.length > 0 ? { title: "Family", rows } : { title: "Family", unavailable: "no kin recorded: one of the first people of their place, unmarried and childless" });
  const fig = row.figure ? realm?.figures[row.figure] : undefined;
  if (fig) out.push({ title: "In the realm", rows: [["Realm figure", titled(fig), `figure:${fig.id}`]] });
  return out;
}

function townspersonCard(ctx: AdminContext, id: string): AdminCard | null {
  const t = parseTownsfolkId(id);
  if (!t) return null;
  const row = ctx.town().store?.people.get(id) ?? null;
  const gone = row && row.death !== null ? row : null;
  // Someone who has died is no longer on the map: their card is their life.
  if (gone) {
    const place = ctx.world().realm?.settlements[gone.site];
    return { ref: `town:${id}`, kind: "townsperson", name: gone.name, subtitle: `${gone.cls} ${gone.job}${place ? ` of ${place.name}` : ""} (dead)`, alive: false, site: gone.site, siteName: place?.name ?? null, doing: "dead", sections: lifeSections(ctx, gone), follow: { site: gone.site, id: "" } };
  }
  const found = townsperson(ctx, ctx.town().homeSiteOf(id) ?? t.site, id);
  const world = ctx.world();
  const persona = ctx.town().personas[id];
  const state = ctx.town().agents[id]?.state ?? world.npcStates[id];
  if (!found) return persona && state ? { ...castCard(ctx, id)!, kind: "townsperson", ref: `town:${id}` } : null;
  const { folk, person } = found;
  const d = crowdDay(ctx);
  const minute = world.hour * 60 + (world.minute ?? 0);
  const now = folk.sim.at(person, world.day, minute, d);
  const day: AdminHour[] = [];
  for (let h = 0; h < 24; h++) {
    const at = folk.sim.at(person, world.day, h * 60, d);
    day.push({ hour: h, doing: at.doing, x: at.x, y: at.y, visible: at.visible, inside: at.inside !== undefined ? buildingName(folk.map, at.inside) : null });
  }
  const workIndex = /^front:(\d+)$/.exec(person.work)?.[1];
  const siteId = ctx.town().homeSiteOf(id) ?? t.site;
  const place = world.realm!.settlements[siteId]!;
  const sections: AdminSection[] = [
    {
      title: "Right now",
      rows: [
        ["Doing", now.visible ? now.doing : `${now.doing}${now.inside !== undefined ? ` (in ${buildingName(folk.map, now.inside)})` : " (out of sight)"}`],
        ["On the map", `${now.x}, ${now.y}${now.visible ? "" : " (indoors)"}`],
        ["Class", `${CLASS_WORDS[person.cls]}`],
        ["Job", JOB_INFO[person.job]?.words ?? person.job],
        ["Age", String(person.age)],
      ],
    },
    {
      title: "Where they belong",
      rows: [
        ["Settlement", place.name, `place:${place.id}`],
        ["Lives in", buildingName(folk.map, person.home) ?? "the streets"],
        ["Works", workIndex !== undefined ? (buildingName(folk.map, Number(workIndex)) ?? person.work) : person.work.replace(/^zone:|^out:/, "")],
        ["Faction", person.factionName ?? "none"],
        ...(person.master ? ([["Belongs to / serves", person.master, person.masterId ? `town:${person.masterId}` : undefined]] as Array<[string, string, string?]>) : []),
      ],
    },
    ...(row ? lifeSections(ctx, row) : []),
    { title: "Needs, emotions, goals", unavailable: "N25: townsfolk get needs, feelings and lives of their own" },
  ];
  if (persona && state) sections.push(...castSections(ctx, id, persona, state));
  return {
    ref: `town:${id}`,
    kind: "townsperson",
    name: person.name,
    subtitle: `${CLASS_WORDS[person.cls]} ${JOB_INFO[person.job]?.words ?? person.job} of ${place.name}`,
    alive: state?.outcome !== "dead",
    site: siteId,
    siteName: place.name,
    doing: now.doing,
    sections,
    day,
    rolledOn: world.day,
    follow: { site: siteId, id },
  };
}

// ---------- beasts ----------

function beastCard(ctx: AdminContext, uid: string): AdminCard | null {
  const world = ctx.world();
  const c = world.creatures[uid] ?? Object.values(world.haunts ?? {}).map((g) => g[uid]).find(Boolean);
  if (!c) return figureCard(ctx, uid);
  const near = Object.entries(world.haunts ?? {}).find(([, g]) => g[uid])?.[0] ?? HOME_ID;
  return {
    ref: `beast:${uid}`,
    kind: "beast",
    name: c.name,
    subtitle: `${c.template} near ${siteName(ctx, near)}`,
    alive: c.outcome === null,
    site: near,
    siteName: siteName(ctx, near),
    doing: c.outcome === "dead" ? `dead (${c.deathCause ?? "unknown"})` : c.outcome === "fled" ? "run off" : "roaming",
    sections: [
      {
        title: "Right now",
        rows: [
          ["Kind", c.template],
          ["Health", `${Math.round(c.hp)} hp`],
          ["Rank", `${c.life.tier}, ${c.life.stage}`],
          ["Where", c.den ?? "its den"],
          ...(c.figure ? ([["Realm figure", "has made a name", `figure:${c.figure}`]] as Array<[string, string, string]>) : []),
          ...(c.packId ? ([["Pack", c.packId]] as Array<[string, string]>) : []),
        ],
      },
    ],
  };
}

// ---------- places ----------

function settlementRows(ctx: AdminContext, s: Settlement): Array<[string, string, string?]> {
  const realm = ctx.world().realm!;
  const view = realmView(realm).settlements.find((x) => x.id === s.id);
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  const liege = s.liege ? realm.settlements[s.liege] : undefined;
  return [
    ["Kind", `${s.abandoned ? "abandoned " : ""}${s.kind}${s.kingdom ? ` of ${realm.kingdoms[s.kingdom]?.name}` : ", free"}`],
    ["People", String(s.population)],
    ["Prosperity", String(Math.round(s.prosperity))],
    ["Food", String(Math.round(s.food))],
    ["Coffers", formatMoney(s.treasury)],
    ["Head", lead ? titled(lead) : "no one", lead ? `figure:${lead.id}` : undefined],
    ["Pays taxes to", liege ? `${liege.name} (${Math.round(s.taxRate * 100)}%${s.arrears > 0 ? `, ${s.arrears} days behind` : ""})` : "no one", liege ? `place:${liege.id}` : undefined],
    ["Buildings", Object.entries(s.buildings).filter(([, l]) => (l ?? 0) > 0).map(([b, l]) => `${b} ${l}`).join(", ") || "none"],
    ["Now", [view?.atWar ? "at war" : "", view?.raided ? "raided lately" : "", s.project ? `building ${s.project.building}` : ""].filter(Boolean).join(", ") || "quiet"],
  ];
}

function placeCard(ctx: AdminContext, id: string): AdminCard | null {
  const world = ctx.world();
  const realm = world.realm;
  const s = realm?.settlements[id];
  if (!realm || !s) return null;
  const classes = classCounts(ctx, id);
  const residents = Object.values(realm.figures)
    .filter((f) => f.alive && f.home === id && f.role !== "beast")
    .sort((a, b) => b.renown - a.renown)
    .slice(0, 12);
  const factions = Object.values(realm.factions).filter((f) => !f.dissolved && (f.seat === id || f.branches.includes(id)));
  return {
    ref: `place:${id}`,
    kind: "place",
    name: s.name,
    subtitle: `${s.kind}${s.kingdom ? ` of ${realm.kingdoms[s.kingdom]?.name}` : ""}`,
    alive: !s.abandoned,
    site: id,
    siteName: s.name,
    doing: s.abandoned ? "abandoned" : "going about its days",
    sections: [
      { title: "The place", rows: settlementRows(ctx, s) },
      { title: "People by class", rows: Object.entries(classes ?? {}).map(([c, n]): [string, string] => [c, String(n)]) },
      { title: "Notable people", rows: residents.map((f): [string, string, string] => [titled(f), `${f.role}, rank ${f.life.tier}, renown ${f.renown}`, `figure:${f.id}`]) },
      { title: "Factions here", rows: factions.map((f): [string, string] => [f.name, `${f.kind}${f.seat === id ? ", seated here" : ", a branch"}`]) },
      { title: "Lately", rows: events(ctx, { site: id, limit: 15 }).events.map((e): [string, string] => [`Day ${e.day}`, `${e.text}${e.why ? ` (why: ${e.why})` : ""}`]) },
    ],
  };
}

// ---------- entry points ----------

/** The card for any ref, or null if nothing is there any more. */
export function card(ctx: AdminContext, ref: string): AdminCard | null {
  const p = parseRef(ref);
  if (!p) return null;
  switch (p.kind) {
    case "player":
      return playerCard(ctx);
    case "cast":
      return parseTownsfolkId(p.id) ? townspersonCard(ctx, p.id) : castCard(ctx, p.id);
    case "figure":
      return figureCard(ctx, p.id);
    case "townsperson":
      return townspersonCard(ctx, p.id);
    case "beast":
      return beastCard(ctx, p.id);
    case "place":
      return placeCard(ctx, p.id);
  }
}

/** The settlement map and crowd to draw for a follow view. */
export function crowdOf(ctx: AdminContext, site: string) {
  const folk = folkOf(ctx, site);
  if (!folk) return null;
  const world = ctx.world();
  return { site, name: world.realm!.settlements[site]!.name, map: { id: folk.map.id, w: folk.map.w, h: folk.map.h, tiles: folk.map.tiles, buildings: folk.map.buildings, zones: folk.map.zones }, roster: folk.roster, day: crowdDay(ctx) };
}

/** Cards for a list of pinned refs, and the player's view when the player is pinned. */
export function pinned(ctx: AdminContext, refs: string[]): Omit<AdminPinned, "player"> {
  const cards: AdminCard[] = [];
  const missing: string[] = [];
  for (const ref of refs.slice(0, 20)) {
    const c = card(ctx, ref);
    if (c) cards.push(c);
    else missing.push(ref);
  }
  return { cards, missing };
}
