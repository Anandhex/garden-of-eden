import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { seededRng, unitFor } from "../dice.js";
import { declareWar, damageBuilding, raid, sign, treatiesBetween, warOf } from "../realm/diplomacy.js";
import { addDeed, addRenown } from "../realm/figures.js";
import { transfer } from "../realm/ledger.js";
import { realmNews } from "../realm/log.js";
import { casualty, type Side } from "../realm/military.js";
import { policyAt } from "../realm/policy.js";
import type { Realm, Settlement } from "../realm/types.js";
import type { LifeCtx } from "../people/step.js";
import { recordLifeEvent } from "../people/events.js";
import { seasonDays } from "../weather.js";
import { peopleOf } from "../../world/species.js";
import { generatePeoples, peoplesOf, type PeoplesState } from "./generate.js";
import { siteMap } from "../../web/sites.js";

/**
 * The peoples' realm day (N54 Parts B–D): the centaur herd moves to the season's grazing; the goblins raid toward the start town's mine
 * road, the ogre fighting for them; an old hatred becomes a war between the orc kingdom and the dwarf hold, and the dwarves ask a human
 * crown for help (accepted where the crown likes the dwarves or hates the orcs); the dragon wakes every few seasons, burns a hamlet near its
 * peaks, and demands tribute that the hamlet's head pays (a `tribute` treaty to the dragon). Every choice has its reason in the news.
 */
const DRAGON_EVERY = 3;
const nearest = (realm: Realm, at: { x: number; y: number }, ok: (s: Settlement) => boolean): Settlement | undefined =>
  Object.values(realm.settlements).filter(ok).sort((a, b) => Math.hypot(a.pos.x - at.x, a.pos.y - at.y) - Math.hypot(b.pos.x - at.x, b.pos.y - at.y) || a.id.localeCompare(b.id))[0];

export function peoplesRealmDay(realm: Realm, day: number): void {
  if (!config.society.peoples) return;
  const st = generatePeoples(realm, day);
  if (!st) return;
  const rng = seededRng(Math.floor(unitFor(realm.seed, "peoples-day", day) * 2 ** 31));
  // ---- The herd moves with the seasons ----
  const herd = st.herd ? realm.settlements[st.herd] : undefined;
  if (herd?.nomadic && day % seasonDays() === 0) {
    herd.nomadic.at = (herd.nomadic.at + 1) % herd.nomadic.route.length;
    herd.pos = { ...herd.nomadic.route[herd.nomadic.at]! };
    realmNews(realm, day, herd.id, "peoples", `${herd.name} has moved on to its ${["spring", "summer", "autumn", "winter"][herd.nomadic.at % 4]} grazing.`, 2, [herd.name], { why: "the season turned" });
  }
  // ---- The goblins raid, a season at a time ----
  const warren = st.warren ? realm.settlements[st.warren] : undefined;
  if (warren && day % seasonDays() === 5 && warren.population >= 20 && unitFor(realm.seed, "warren-raid", day) < 0.7) {
    const target = nearest(realm, warren.pos, (s) => !s.species && !s.way && !s.abandoned && !s.fallen);
    if (target) {
      const ogre = st.ogre ? realm.figures[st.ogre] : undefined;
      const fighters = [warren.leader ? realm.figures[warren.leader] : undefined, ogre?.alive && treatiesBetween(realm, [`s:${warren.id}`], [`p:${ogre.id}`], day, ["service"]).length > 0 ? ogre : undefined].filter((f): f is NonNullable<typeof f> => !!f && f.alive);
      const men = Math.round(warren.population / 3);
      const side: Side = { name: `the goblins of ${warren.name}`, strength: men * 1.1 + fighters.length * 25, fighters, men, home: warren, species: "goblin", rank: "F" };
      realmNews(realm, day, target.id, "raid", `Goblins out of ${warren.name}${ogre && fighters.includes(ogre) ? `, with ${ogre.name} the ogre,` : ""} fell on the mine road of ${target.name}.`, 5, [target.name], { why: "goblins are greedy and the mine is near" });
      raid(realm, side, `s:${warren.id}`, target, day, rng, "goblins after the mine's iron");
    }
  }
  // ---- An old hatred: the orcs and the dwarves ----
  const orcs = st.orcs ? realm.kingdoms[st.orcs] : undefined;
  const dwarves = st.dwarves ? realm.kingdoms[st.dwarves] : undefined;
  if (orcs && dwarves && !orcs.fallen && !dwarves.fallen && day % seasonDays() === 7 && !warOf(realm, `k:${orcs.id}`) && !warOf(realm, `k:${dwarves.id}`) && (orcs.opinion[dwarves.id] ?? 0) <= -40 && unitFor(realm.seed, "orc-war", day) < 0.6) {
    const w = declareWar(realm, [`k:${orcs.id}`], [`k:${dwarves.id}`], day, "an old hatred between orcs and dwarves");
    // The dwarves seek help from a human crown: the one that likes them best, which says yes if it likes the dwarves or hates the orcs.
    const crowns = Object.values(realm.kingdoms).filter((k) => !k.species && !k.fallen).sort((a, b) => (b.opinion[dwarves.id] ?? 0) - (a.opinion[dwarves.id] ?? 0) || a.id.localeCompare(b.id));
    const asked = crowns[0];
    if (asked) {
      const ok = (asked.opinion[dwarves.id] ?? 0) >= 10 || (asked.opinion[orcs.id] ?? 0) <= -20;
      st.asked.push({ day, by: dwarves.id, of: asked.id, ok, war: w.id });
      if (ok) {
        sign(realm, "mutual_defense", `k:${dwarves.id}`, `k:${asked.id}`, day, 4 * seasonDays(), `the dwarves asked ${asked.name} for help against the orcs`);
        if (!w.defenders.includes(`k:${asked.id}`)) w.defenders.push(`k:${asked.id}`);
      }
      realmNews(realm, day, asked.capital, "war", `${dwarves.name} asked ${asked.name} for help against ${orcs.name}; ${asked.name} ${ok ? "answered the call" : "refused"}.`, 7, [], { why: ok ? "an old friendship with the dwarves" : "no quarrel with the orcs worth a war" });
    }
  }
  // ---- The dragon wakes ----
  const dragon = st.dragon ? realm.figures[st.dragon] : undefined;
  const lair = dragon ? st.lairs[dragon.id] : undefined;
  if (dragon?.alive && lair && day % seasonDays() === 9 && day - (st.burned[dragon.id] ?? -999) >= DRAGON_EVERY * seasonDays()) dragonWakes(realm, st, dragon.id, lair, day, rng);
}

/** The dragon burns a hamlet near its peaks and demands tribute; the head pays from the treasury (or the hamlet is burned again). */
export function dragonWakes(realm: Realm, st: PeoplesState, dragonId: string, lair: { x: number; y: number }, day: number, rng: () => number): string | null {
  const dragon = realm.figures[dragonId]!;
  const s = nearest(realm, lair, (x) => !x.species && !x.way && !x.abandoned && (x.kind === "hamlet" || x.kind === "village"));
  if (!s) return null;
  st.burned[dragonId] = day;
  const dead = Math.max(1, Math.round(s.population * 0.06));
  casualty(realm, s, "raid", dead, `dragon:${day}:${s.id}`, day, dragonId);
  damageBuilding(s, rng);
  damageBuilding(s, rng);
  s.lastRaided = day;
  s.prosperity = Math.max(0, s.prosperity - 15);
  addRenown(dragon, 5);
  addDeed(dragon, `burned ${s.name}`);
  realmNews(realm, day, s.id, "dragon", `${dragon.name} the dragon came down from the peaks and burned ${s.name}; ${dead} died in the fire.`, 9, [dragon.name, s.name], { why: "a dragon's hunger for gold" });
  // Tribute, every tax day, or it comes back.
  const amount = Math.max(20, Math.round(s.population * 0.6));
  sign(realm, "tribute", `s:${s.id}`, `p:${dragon.id}`, day, 8 * seasonDays(), `${dragon.name} demanded tribute of ${s.name}`, amount);
  const head = s.leader ? realm.figures[s.leader] : undefined;
  const paid = transfer(realm, `s:${s.id}`, `p:${dragon.id}`, amount, `tribute to ${dragon.name} the dragon`, undefined, day);
  realmNews(realm, day, s.id, "dragon", paid > 0 ? `${head ? head.name : "The head"} of ${s.name} paid ${dragon.name} ${paid} copper in tribute.` : `${s.name} could not pay ${dragon.name}'s tribute.`, 7, [dragon.name, s.name], { why: "fear of the fire" });
  return s.id;
}

/**
 * Residents of other peoples (N54 decision 7): a place whose kingdom has a goblin warren near and lets goblins live in its outer quarters
 * (`species:goblin` welcome or limited) takes in one a season from the warren (the warren is a goblin less: nobody is made up). Some can
 * talk with anyone (the people's clever share). Where a kingdom keeps a people only as slaves, any of them there is a slave.
 */
export function residentsSiteDay(ctx: LifeCtx, site: string, day: number): string | null {
  if (!config.society.peoples) return null;
  const { realm, store } = ctx;
  const st = peoplesOf(realm);
  const s = realm.settlements[site];
  if (!st || !s || s.species || s.way || !s.kingdom) return null;
  // Where a people may only be slaves, those here are.
  for (const r of store.people.loadSite(site, "full") as PersonRow[]) {
    if (r.death !== null || r.species === "human" || r.cls === "slave") continue;
    if (policyAt(realm, site, `species:${r.species}`, day) === "slaves_only") store.people.update(r.id, { cls: "slave", job: "slave" });
  }
  if (day % seasonDays() !== 4) return null;
  const warren = st.warren ? realm.settlements[st.warren] : undefined;
  if (!warren || warren.population < 10) return null;
  const law = policyAt(realm, site, "species:goblin", day);
  if (law !== "welcome" && law !== "limited") return null;
  // Only the places near enough to the warren.
  if (Math.hypot(warren.pos.x - s.pos.x, warren.pos.y - s.pos.y) > 220) return null;
  if (st.residents.filter((x) => x.site === site).length >= 2) return null;
  const map = siteMap(s, "village", realm);
  const outer = map.buildings.map((b, i) => ({ b, i })).filter((o) => o.b.kind === "house" && !["d:noble", "d:castle", "d:palace", "d:manor", "d:high_street"].includes(o.b.district ?? ""));
  const home = outer[Math.floor(unitFor(realm.seed, "goblin-home", site, day) * outer.length)]?.i ?? null;
  const seq = store.people.seq(site);
  const id = `t_${site}_${seq.next_id}`;
  const gender = unitFor(realm.seed, "goblin-gender", id) < 0.5 ? "female" : "male";
  const clever = unitFor(realm.seed, "clever", id) < Math.max(0.05, peopleOf("goblin")?.cleverShare ?? 0.05) * 6;
  const names = ["Snikk", "Grizzle", "Nob", "Wix", "Skab", "Mott", "Gobbet", "Rikket"];
  const name = `${names[Math.floor(unitFor(realm.seed, "goblin-name", id) * names.length)]!} of ${warren.name.replace(/^the /, "")}`;
  store.people.add({ id, site, n: seq.next_n, name, gender, species: "goblin", born_day: day - 14 * config.daysPerYear, cls: "commoner", job: "labourer", home, work: null, master: null, master_id: null, faction: null, mother: null, father: null, spouse: null, figure: null, persona: null, traits: null, death: null, expecting: null, last_birth: null, stepped_day: day, outlook: null, away: null, skill: null, shop: null, origin: JSON.stringify({ site: warren.id, day, why: "came from the warren to live among people" }), rev: 0 });
  store.people.setSeq(site, { next_id: seq.next_id + 1, next_n: seq.next_n + 1 });
  warren.population -= 1;
  st.residents.push({ id, species: "goblin", site, clever, day });
  recordLifeEvent(realm, store, { kind: "migration", actor: id, site, day, details: `${name}, a goblin${clever ? " with a quick tongue" : ""}, came from ${warren.name} to live in the outer quarter of ${s.name}`, importance: 3, why: law === "welcome" ? "goblins are welcome here" : "goblins may live in the outer quarters here" });
  return id;
}
