import { config } from "../config.js";
import type { LLMProvider } from "../llm/provider.js";
import { NpcAgent } from "../npc/NpcAgent.js";
import type { NpcPersona, WorldSnapshot } from "../npc/types.js";
import { BackgroundWork } from "../director/background.js";
import { runChronicle } from "../director/chronicle.js";
import { flavorBoard } from "../director/flavor.js";
import { needsPlan, planDay } from "../director/planning.js";
import { summariseConversation } from "../director/summary.js";
import { absoluteHour } from "./clock.js";
import { type Creature, type CreatureTemplate, isNotable, passCreatureTime } from "./creatures.js";
import { reportCrimes, isGuard } from "./crime.js";
import type { DeathRegistry } from "./deaths.js";
import { type Rng, streamFor } from "./dice.js";
import type { Building } from "../web/map.js";
import { onEvent } from "./events.js";
import type { WorldStore } from "./db.js";
import { absorbWitnessed } from "./gossip.js";
import { checkEscorts, recordCreatureDefeat } from "./quests.js";
import type { SavedWorld } from "./save.js";
import { allSpawnRules, ambushers, applySpawnRules, type SpawnRule } from "./spawning.js";
import { deathRipple } from "./succession.js";
import { passVillageNights } from "./underworld.js";
import { passVillage, type VillageMember } from "./village.js";
import { companionsStrike, endangered, type Foe } from "./party.js";
import { statsOf, npcSkills } from "../npc/state.js";
import { skillLevel } from "../npc/skills.js";
import { creatureStats } from "./creatures.js";
import { registerNpcGenders, registerNpcNames } from "../world/names.js";
import { createNpcState } from "../npc/state.js";
import { familyNight, familyOf } from "./family.js";
import { idFor, loadTemplates, writeChildWords, type NpcTemplate } from "../npc/templates.js";
import { type AreaId, currentPlan, type PlaceId } from "./schedule.js";
import { DEMO_SPAWNS } from "../world/world.js";
import type { DirectorLogEntry } from "../director/validator.js";
import { addLore, learnLore } from "../npc/knowledge.js";
import { advanceRealm } from "./realm/day.js";
import { nameFaction } from "./realm/director.js";
import { applyHomeEvents, postNeedQuests, syncCast } from "./realm/home.js";
import { tally } from "./realm/log.js";
import { deliverNews, realmNewsId, realmPlaceLore, RETELL_IMPORTANCE, retellNews } from "./realm/news.js";
import { atWar } from "./realm/economy.js";
import { HOME_ID } from "./realm/generate.js";
import { breedCreatures, castCrowd, nameRisers, personaFor, readyToTalk } from "./realm/rise.js";
import { arrive, setOut, siteOf, type Trip } from "./realm/travel.js";
import { ensurePlaceLore, notablesOf, visitorId, visitorPersona } from "./realm/visitors.js";
import { parseTownsfolkId, rosterFor, rosterFromStore, townsfolkPersona } from "./realm/townsfolk.js";
import type { CrowdRoster, Townsperson } from "@millbrook/shared";
import { settleHaunts, stockHaunts } from "./realm/haunts.js";
import { killFigure, titled } from "./realm/figures.js";
import { realmNews } from "./realm/log.js";
import type { Figure } from "./realm/types.js";
import { ITEM_TIERS } from "./items.js";

const HEAD = new Set(["ruler", "lord", "mayor", "village head", "elder"]);

/**
 * The town as a whole: everything that happens around conversations, shared by the
 * CLI and the browser game so they follow the same rules. It owns the agents and
 * runs time passing (the village, creatures, night raids, spawns), and after each
 * turn the consequences that reach beyond one NPC: witnesses, crimes, deaths and
 * their ripple, escorts arriving, ambushes. It also feeds the world director (the
 * nightly chronicle) and the low-priority background work (plans, summaries,
 * quest flavour), and the long-term store (game/db.ts) when there is one.
 */
export interface TownOptions {
  personas: Record<string, NpcPersona>;
  creatureTemplates: Record<string, CreatureTemplate>;
  spawnRules: SpawnRule[];
  world: SavedWorld;
  llm: LLMProvider;
  /** A separate provider for background work, so cancelling it never cuts off a conversation. */
  backgroundLlm?: LLMProvider;
  store?: WorldStore;
  deaths?: DeathRegistry;
  rng?: Rng;
  /** Agents, if the caller made them already (tests). */
  agents?: Record<string, NpcAgent>;
  /** The child template, for children born in play (default: src/data/templates/child.json). */
  childTemplate?: NpcTemplate;
}

export class Town {
  /** Every NPC's file: the caller's, plus those born in play (added to the same object). */
  readonly personas: Record<string, NpcPersona>;
  /** Every NPC id. Grows when a child is born; callers should read it, not copy it. */
  readonly ids: string[];
  readonly agents: Record<string, NpcAgent>;
  readonly templates: Record<string, CreatureTemplate>;
  readonly world: SavedWorld;
  readonly background: BackgroundWork;
  readonly store?: WorldStore;
  private readonly fileRules: SpawnRule[];
  private readonly llm: LLMProvider;
  private readonly bgLlm: LLMProvider;
  private readonly deaths?: DeathRegistry;
  /** A fixed die for tests; without one, every system rolls from its own stream (rngFor). */
  private readonly fixedRng?: Rng;
  private unsubscribe: (() => void) | null = null;
  /** Deaths whose ripple has run (once each; deaths before this session already did theirs). */
  private rippled = new Set<string>();
  /** The chronicle runs one at a time. */
  private chronicling: Promise<unknown> | null = null;
  /** Lines from background work (the chronicle's news) for the player, until taken. */
  private news: string[] = [];
  private readonly childTemplate?: NpcTemplate;
  private readonly agentLlm: LLMProvider;

  /**
   * The dice for one system (N18). A fixed die (tests) wins. Otherwise each system rolls from its
   * own stream of the world's seed, so a new roll in one never changes another's: `keys` pin the
   * stream (a day); with none, a counter per system in the save keeps repeated calls apart.
   */
  rngFor(system: string, ...keys: Array<string | number>): Rng {
    if (this.fixedRng) return this.fixedRng;
    if (keys.length > 0) return streamFor(this.world.seed, system, ...keys);
    const rolls = (this.world.rolls ??= {});
    rolls[system] = (rolls[system] ?? 0) + 1;
    return streamFor(this.world.seed, system, "n", rolls[system]!);
  }

  /** The dice for something the player did (a fight round, a sneak, a craft): the same inputs on the same world roll the same. */
  actionRng(): Rng {
    return this.rngFor("action");
  }

  /** News from background work since last asked. */
  takeNews(): string[] {
    const out = this.news;
    this.news = [];
    return out;
  }

  constructor(o: TownOptions) {
    // Children born in play live in the save, and so do grown-up children's files: they're the cast.
    for (const [id, p] of Object.entries(o.world.family?.born ?? {})) o.personas[id] = p;
    // So do people who rose from the crowd to talk (N13.7).
    for (const [id, p] of Object.entries(o.world.risen ?? {})) o.personas[id] = p;
    // The people of other places (N14) aren't the town's cast: not in `ids`, so Millbrook's day doesn't run them.
    for (const id of Object.keys(o.world.visitors ?? {})) delete o.personas[id];
    this.personas = o.personas;
    this.ids = Object.keys(o.personas);
    for (const [id, p] of Object.entries(o.world.visitors ?? {})) this.personas[id] = p;
    this.agentLlm = o.llm;
    try {
      this.childTemplate = o.childTemplate ?? loadTemplates().child;
    } catch {
      this.childTemplate = undefined;
    }
    this.templates = o.creatureTemplates;
    this.fileRules = o.spawnRules;
    this.world = o.world;
    this.llm = o.llm;
    this.bgLlm = o.backgroundLlm ?? o.llm;
    this.store = o.store;
    this.deaths = o.deaths;
    if (o.rng) this.fixedRng = o.rng;
    this.background = new BackgroundWork(() => this.bgLlm.abort?.());
    registerNpcNames(Object.fromEntries(this.ids.map((id) => [id, o.personas[id]!.name])));
    registerNpcGenders(Object.fromEntries(this.ids.map((id) => [id, o.personas[id]!.voice?.gender])));
    this.agents = o.agents ?? Object.fromEntries(this.ids.map((id) => [id, new NpcAgent(o.personas[id]!, o.llm, undefined, o.world.npcStates[id])]));
    for (const id of Object.keys(o.world.visitors ?? {})) this.agents[id] ??= new NpcAgent(this.personas[id]!, o.llm, undefined, o.world.npcStates[id]);
    for (const id of this.ids) this.agents[id] ??= new NpcAgent(o.personas[id]!, o.llm, undefined, o.world.npcStates[id]);
    for (const id of this.ids) {
      if (this.agents[id]!.isDead) this.rippled.add(id);
      if (o.world.deaths[id] && this.agents[id]!.state.outcome !== "dead") this.agents[id]!.state.outcome = "dead";
    }
    this.setUpRealm();
    if (o.store) {
      const store = o.store;
      this.unsubscribe = onEvent((e) => store.archiveEvent(e));
      for (const e of o.world.events ?? []) store.archiveEvent(e);
      // Everyone recalls by meaning: the cast, and the people of other places met before (N15).
      for (const id of [...this.ids, ...this.visitorIds()]) this.hookRecall(id);
    }
  }

  private hookRecall(id: string): void {
    const store = this.store;
    if (store) this.agents[id]!.recall = async (line) => (await store.recall(id, line, 2)).map((r) => `on day ${r.day}, ${r.text}.`);
  }

  /** A new NPC joins the town (a child is born on `day`): an agent, a state, a name. */
  addNpc(persona: NpcPersona, day = this.world.day): NpcAgent {
    const state = this.world.npcStates[persona.id] ?? createNpcState(persona, {}, day);
    this.world.npcStates[persona.id] = state;
    this.personas[persona.id] = persona;
    if (!this.ids.includes(persona.id)) this.ids.push(persona.id);
    this.agents[persona.id] = new NpcAgent(persona, this.agentLlm, undefined, state);
    registerNpcNames({ [persona.id]: persona.name });
    registerNpcGenders({ [persona.id]: persona.voice?.gender });
    this.hookRecall(persona.id);
    return this.agents[persona.id]!;
  }

  /** An NPC's file changed (a child grew up): a new agent on the same state. */
  replaceNpc(persona: NpcPersona): NpcAgent {
    const state = this.agents[persona.id]?.state ?? this.world.npcStates[persona.id];
    this.personas[persona.id] = persona;
    this.agents[persona.id] = new NpcAgent(persona, this.agentLlm, undefined, state);
    this.world.npcStates[persona.id] = this.agents[persona.id]!.state;
    this.hookRecall(persona.id);
    return this.agents[persona.id]!;
  }

  /**
   * The family rules for each midnight passed (game/family.ts): courtships, weddings,
   * children on the way, births (new agents) and growing up (new files). Returns lines.
   */
  familyNights(fromDay: number): string[] {
    const log: string[] = [];
    familyOf(this.world);
    this.world.lore ??= [];
    this.world.newsDays ??= {};
    for (let d = fromDay + 1; d <= this.world.day; d++) {
      const night = familyNight(this.members(), { ...this.world, day: d }, this.rngFor("family", d), this.childTemplate);
      for (const p of night.born) this.addNpc(p, d);
      for (const p of night.changed) {
        this.replaceNpc(p);
        if (p.minor && this.childTemplate && !p.speechStyle.startsWith("A baby")) this.writeChildWords(p.id);
      }
      log.push(...night.log);
    }
    return log;
  }

  // ---- Travel (N14) ----

  /** Where the player is: a realm settlement id (Millbrook by default). */
  site(): string {
    return siteOf(this.world.player);
  }

  /** Is the player in Millbrook? */
  atHome(): boolean {
    return this.site() === HOME_ID;
  }

  /** Where around the settlement the player is (N15): its village, or one of its localities. */
  area(): AreaId {
    return this.world.player.area ?? "village";
  }

  /** The creatures where the player is (N15): Millbrook's own at home; elsewhere, the beasts and outlaws the realm says are about. */
  creaturesHere(): Record<string, Creature> {
    if (this.atHome() || !this.world.realm) return this.world.creatures;
    return (this.world.haunts ??= {})[this.site()] ?? {};
  }

  /** Bring the beasts and outlaws of the place the player is at in line with the realm (game/realm/haunts.ts). */
  stockHaunts(): void {
    const realm = this.world.realm;
    if (!realm || this.atHome()) return;
    stockHaunts(realm, (this.world.haunts ??= {}), this.site(), this.templates, this.world.day, this.rngFor("haunts"), (f) => !!this.personas[visitorId(f.id)]);
  }

  /** After a fight away from home: the dead go back to the realm (a pack one fewer, a bounty share, a named death). Returns lines. */
  settleHaunts(): string[] {
    const realm = this.world.realm;
    if (!realm || this.atHome()) return [];
    return settleHaunts(realm, (this.world.haunts ??= {}), this.site(), this.world.player, this.world.day);
  }

  /** Persona ids of the people of other places (not the town's cast). */
  visitorIds(): string[] {
    return Object.keys(this.world.visitors ?? {});
  }

  /** The figure a visitor NPC stands for. */
  figureOf(id: string): Figure | undefined {
    return Object.values(this.world.realm?.figures ?? {}).find((f) => visitorId(f.id) === id);
  }

  /**
   * Who's about where the player is: in Millbrook, the cast; elsewhere, whoever travels
   * with them and that place's people (the living, and the dead where they fell).
   */
  localIds(): string[] {
    const site = this.site();
    // The townsfolk the player has talked to (N16) are about their village's streets.
    const townsfolk = this.area() === "village" ? this.visitorIds().filter((id) => parseTownsfolkId(id)?.site === site) : [];
    if (this.atHome()) return townsfolk.length > 0 ? [...this.ids, ...townsfolk] : this.ids;
    // A figure who died keeps their home: they lie where they fell.
    const folk = this.visitorIds().filter((id) => !parseTownsfolkId(id) && this.figureOf(id)?.home === site);
    return [...this.companions().map((a) => a.persona.id), ...folk, ...townsfolk];
  }

  /** Everyone who lives in a place (N18): read from the database when the town has one, else rolled by the generator. */
  rosterAt(site: string, map: { id: string; buildings: Building[]; zones: Array<{ id: string }> }, day = this.world.day, opts: { readOnly?: boolean } = {}): CrowdRoster | null {
    const realm = this.world.realm;
    if (!realm) return null;
    // The admin view only looks: a place with no rows yet is shown as the generator would roll it, and nothing is written.
    if (this.store && !(opts.readOnly && this.store.people.count(site) === 0)) return rosterFromStore(this.store.people, realm, site, map, day);
    return rosterFor(realm, site, map, day);
  }

  /**
   * One of the townsfolk becomes a talking NPC (N16): the player spoke to them. Their
   * file (realm/townsfolk.ts) is kept in the save with the people of other places, so
   * they remember the player next time. Returns their id, or null if no file could be made.
   */
  meetTownsperson(roster: CrowdRoster, p: Townsperson): string | null {
    if (this.personas[p.id] && this.agents[p.id]) return p.id;
    let templates: Record<string, NpcTemplate>;
    try {
      templates = loadTemplates();
    } catch {
      return null;
    }
    const persona = townsfolkPersona(this.world.realm ?? null, roster, p, templates);
    if (!persona) return null;
    (this.world.visitors ??= {})[persona.id] = persona;
    this.personas[persona.id] = persona;
    this.store?.people.update(p.id, { persona: persona.id });
    const state = this.world.npcStates[persona.id] ?? createNpcState(persona, {}, this.world.day);
    this.world.npcStates[persona.id] = state;
    this.agents[persona.id] = new NpcAgent(persona, this.agentLlm, undefined, state);
    registerNpcNames({ [persona.id]: persona.name });
    registerNpcGenders({ [persona.id]: persona.voice?.gender });
    this.hookRecall(persona.id);
    return persona.id;
  }

  /** Make talking NPCs of a place's head and best-known people (once each), and its lore. Returns their ids. */
  meetPeopleOf(site: string): string[] {
    const realm = this.world.realm;
    if (!realm || site === HOME_ID) return [];
    let templates: Record<string, NpcTemplate>;
    try {
      templates = loadTemplates();
    } catch {
      return [];
    }
    const out: string[] = [];
    // The place's lore first: their files may know it.
    ensurePlaceLore(realm, this.world, site, []);
    for (const f of notablesOf(realm, site)) {
      const id = visitorId(f.id);
      if (!this.personas[id]) {
        const p = visitorPersona(realm, f, templates, this.world.day);
        if (!p) continue;
        (this.world.visitors ??= {})[id] = p;
        this.personas[id] = p;
        const state = this.world.npcStates[id] ?? createNpcState(p, {}, this.world.day);
        state.life = structuredClone(f.life) as typeof state.life;
        this.world.npcStates[id] = state;
        this.agents[id] = new NpcAgent(p, this.agentLlm, undefined, state);
        registerNpcNames({ [id]: p.name });
        registerNpcGenders({ [id]: p.voice?.gender });
        this.hookRecall(id);
      }
      out.push(id);
    }
    ensurePlaceLore(realm, this.world, site, out.map((id) => ({ id, persona: this.personas[id]!, state: this.agents[id]!.state })));
    return out;
  }

  /** Strength of whoever travels with the player, for fights on the road. */
  companionPower(): number {
    return this.companions().reduce((a, c) => a + 6 + 4 * ITEM_TIERS.indexOf(c.state.life.tier), 0);
  }

  /**
   * Set out for a place (N14): the route and what happens on the road. The caller then
   * lets `hours` pass (the whole world lives them) and calls arriveAt().
   */
  setOutFor(to: string): Trip {
    const realm = this.world.realm;
    if (!realm) return { ok: false, lines: ["There's no wider realm in this world."], hours: 0 };
    if (this.ids.some((id) => this.agents[id]!.state.inCombat && !this.agents[id]!.isDead)) return { ok: false, lines: ["Not in the middle of a fight."], hours: 0 };
    return setOut(realm, this.world.player, to, this.world.day, this.rngFor("travel"), this.companionPower());
  }

  /** The player arrives: they're at the gate of the new place, and its people are about. Returns lines. */
  arriveAt(to: string): string[] {
    const realm = this.world.realm;
    const s = realm?.settlements[to];
    if (!realm || !s) return [];
    arrive(this.world.player, s.id);
    this.world.player.place = "gate";
    if (s.id === HOME_ID) return [`You're back in Millbrook.`];
    const folk = this.meetPeopleOf(s.id);
    this.stockHaunts();
    const head = s.leader ? realm.figures[s.leader] : undefined;
    return [`You reach ${s.name}, a ${s.kind}${s.kingdom ? ` of ${realm.kingdoms[s.kingdom]?.name}` : ""} of about ${s.population} people${head ? `, under ${titled(head)}` : ""}.`, ...(folk.length > 0 ? [`About the place: ${folk.map((id) => this.personas[id]!.name).join(", ")}.`] : [])];
  }

  /** Realm deaths reach the people of other places, and the player's killings reach the realm. Returns lines. */
  private syncVisitors(): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    const log: string[] = [];
    for (const id of this.visitorIds()) {
      const f = this.figureOf(id);
      const a = this.agents[id];
      if (!f || !a) continue;
      if (!f.alive && !a.isDead) {
        a.state.outcome = "dead";
        a.state.deathCause = f.deathCause ?? "unknown";
      } else if (f.alive && a.isDead) {
        const cause = a.state.deathCause ?? this.world.player.name;
        const s = f.home ? realm.settlements[f.home] : undefined;
        killFigure(realm, f, this.world.day, `killed by ${cause}`);
        realmNews(realm, this.world.day, f.home, "death", `${titled(f)}${s ? ` of ${s.name}` : ""} was killed by ${cause}.`, HEAD.has(f.role) ? 8 : 5, [f.name, cause], { why: `killed by ${cause}` });
        log.push(`Word will spread that ${f.name} is dead.`);
      } else if (f.alive) {
        f.life = structuredClone(a.state.life) as Figure["life"];
      }
    }
    return log;
  }

  // ---- The wider realm (N13) ----

  /** The realm's figures for the cast, and the lore of the places around Millbrook. Once, at start. */
  private setUpRealm(): void {
    const realm = this.world.realm;
    if (!realm) return;
    this.meetHomeNotables(this.world.day);
    syncCast(realm, this.members(), this.world.day);
    if (!(this.world.lore ?? []).some((e) => e.id.startsWith("realm.place_"))) realmPlaceLore(realm, this.world, this.members());
    castCrowd(realm, this.world.creatures, this.world.day);
    // Away from home (N14): the people of where the player is, about (made again if the save lost them).
    if (!this.atHome()) {
      this.meetPeopleOf(this.site());
      this.stockHaunts();
    }
  }

  /**
   * Each midnight passed, for the realm (N13): Millbrook's creatures breed and the
   * ones that rose get names; the realm lives its day; what it sends Millbrook
   * happens on the map; news that has travelled far enough arrives; Millbrook's
   * needs go on the boards; and anyone who rose far enough starts to talk. Returns lines.
   */
  realmNights(fromDay: number): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    const log: string[] = [];
    for (let d = fromDay + 1; d <= this.world.day; d++) {
      log.push(...breedCreatures(this.templates, this.world.creatures, d, this.rngFor("breed", d)));
      log.push(...nameRisers(realm, this.templates, this.world.creatures, d, this.rngFor("risers", d)));
      syncCast(realm, this.members(), d);
      const before = Object.keys(realm.factions);
      advanceRealm(realm, d, this.fixedRng);
      this.world.atWar = atWar(realm, realm.settlements[HOME_ID]!);
      log.push(...applyHomeEvents(realm, this.world, this.members(), Object.keys(this.templates)));
      const before2 = new Set(realm.news.filter((n) => n.delivered).map((n) => n.id));
      log.push(...deliverNews(realm, this.world, this.members()));
      // Big news from away, retold by the model in the background (code's words stand if it fails).
      if (config.director) {
        for (const n of realm.news.filter((x) => x.delivered && !before2.has(x.id) && x.importance >= RETELL_IMPORTANCE && x.at !== HOME_ID)) {
          this.background.add({ key: `retell:${n.id}`, run: async () => void (await retellNews(this.bgLlm, realm, this.world, realmNewsId(n))) });
        }
      }
      log.push(...postNeedQuests(realm, this.world, this.members()));
      log.push(...this.promoteRisers(d));
      log.push(...this.meetHomeNotables(d, true));
      // New factions get their words from the model, in the background (code's names stand if it fails).
      if (config.director) for (const id of Object.keys(realm.factions).filter((x) => !before.includes(x))) this.background.add({ key: `faction-name:${id}`, run: async () => void (await nameFaction(this.bgLlm, realm, id)) });
    }
    return log;
  }

  /**
   * Millbrook's own notables from the realm talk (N15): its head, the guard captain,
   * and whoever of note the realm puts there later (a new mayor after the old one
   * dies). Each is made like the people of other places (realm/visitors.ts), from a
   * template by their role, and joins the cast: they live Millbrook's day, gossip and
   * remember. Their files are kept in the save with the risen (`world.risen`). Returns lines.
   */
  private meetHomeNotables(day: number, announce = false): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    const folk = notablesOf(realm, HOME_ID);
    if (folk.length === 0) return [];
    let templates: Record<string, NpcTemplate>;
    try {
      templates = loadTemplates();
    } catch {
      return [];
    }
    const log: string[] = [];
    for (const f of folk) {
      const persona = visitorPersona(realm, f, templates, day, idFor(f.name, [...this.ids, ...this.visitorIds()]));
      if (!persona) continue;
      (this.world.risen ??= {})[persona.id] = persona;
      const agent = this.addNpc(persona, day);
      agent.state.life = structuredClone(f.life) as typeof agent.state.life;
      f.talks = persona.id;
      // A newcomer to the post is news; the ones there from the start are simply about.
      if (announce) log.push(`${persona.name}, ${persona.role}, is about the village now.`);
    }
    return log;
  }

  /** People of Millbrook who rose far enough become talking NPCs (N13.7), one a night, while there's room. */
  private promoteRisers(day: number): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    const alive = this.ids.filter((id) => !this.agents[id]!.isDead && !this.agents[id]!.state.dormant).length;
    if (alive >= config.family.maxPopulation) return [];
    const f = readyToTalk(realm, this.world.creatures)[0];
    if (!f) return [];
    let templates: Record<string, NpcTemplate>;
    try {
      templates = loadTemplates();
    } catch {
      return [];
    }
    const persona = personaFor(f, templates, day, this.rngFor("rise", f.id), this.ids);
    if (!persona) return [];
    // Off the map as a creature; into the cast as a person.
    for (const [uid, c] of Object.entries(this.world.creatures)) if (c.figure === f.id) delete this.world.creatures[uid];
    for (const out of Object.values(this.world.spawns ?? {})) out.uids = out.uids.filter((uid) => this.world.creatures[uid]);
    (this.world.risen ??= {})[persona.id] = persona;
    const agent = this.addNpc(persona, day);
    agent.state.life = structuredClone(f.life) as typeof agent.state.life;
    f.talks = persona.id;
    f.name = persona.name;
    addLore(this.world, { id: `people.${persona.id}`, kind: "person", name: persona.name, aliases: [persona.name.split(" ")[0]!], keywords: [], npc: persona.id, text: `${persona.name}, ${persona.role}. Folk know the name now: ${f.deeds.slice(-2).join("; ") || "they made a name for themselves"}.` });
    for (const m of this.members()) if (m.id !== persona.id) learnLore(m.state, `people.${persona.id}`, "rumour");
    tally(realm, "promoted");
    return [`${persona.name} (${persona.role}) has made enough of a name that folk stop to talk with them.`];
  }

  /** In the background: the model writes a child's words when they start talking (template words stand if it fails). */
  private writeChildWords(id: string): void {
    const t = this.childTemplate;
    if (!t) return;
    const parents = (this.personas[id]!.parents ?? []).map((p) => (p === "player" ? this.world.player.name : (this.personas[p]?.name ?? p))).join(" and ");
    this.background.add({
      key: `child-words:${id}`,
      run: async () => {
        const p = this.personas[id];
        if (!p?.minor) return;
        const words = await writeChildWords(this.bgLlm, t, p, parents);
        if (!words || !this.personas[id]?.minor) return;
        const next = { ...this.personas[id]!, ...words, backstory: `${p.backstory.split(". ")[0]}. ${words.backstory}` };
        familyOf(this.world).born[id] = next;
        this.replaceNpc(next);
      },
    });
  }

  close(): void {
    this.unsubscribe?.();
  }

  members(): VillageMember[] {
    return this.ids.map((id) => ({ id, persona: this.personas[id]!, state: this.agents[id]!.state }));
  }

  /** Spawn rules in play: the file's plus those made during play (director quests, ambushes). */
  rules(): SpawnRule[] {
    return allSpawnRules(this.fileRules, this.world);
  }

  /** Creatures due now turn up, ended groups move on. `keep`: creatures in a fight. */
  respawn(keep: string[] = []): string[] {
    return applySpawnRules(this.rules(), this.templates, this.world.creatures, (this.world.spawns ??= {}), this.world, this.rngFor("spawn"), new Set(keep));
  }

  /** Where an NPC is now (null when they're not out: asleep, at home, dead, away). */
  placeOf(id: string): PlaceId | null {
    const a = this.agents[id]!;
    if (a.isDead || a.state.dormant || a.state.outcome === "unconscious") return null;
    // Away from Millbrook (N14), a companion is wherever the player is; the rest of the cast isn't here.
    if (!this.atHome() && this.ids.includes(id)) return a.state.companion ? (this.world.player.place ?? "square") : null;
    const plan = currentPlan(a.persona, a.state, this.world);
    return plan.activity === "sleep" || plan.place === "home" ? null : plan.place;
  }

  /** NPCs at a place, awake and alive. */
  presentAt(place: PlaceId | null | undefined): NpcAgent[] {
    return place ? this.localIds().filter((id) => this.placeOf(id) === place).map((id) => this.agents[id]!) : [];
  }

  /** Companions travelling with the player now. */
  companions(): NpcAgent[] {
    return this.ids.map((id) => this.agents[id]!).filter((a) => a.state.companion && !a.isDead);
  }

  /**
   * Let `hours` pass for everyone: the village, creatures, the night's dealings and
   * raids, spawns; then the consequences. If midnight passed, the director's chronicle
   * and the day's plans are queued. Returns lines worth telling the player.
   */
  passHours(hours: number, { talkingTo, keep = [] }: { talkingTo?: string; keep?: string[] } = {}): string[] {
    const start = { day: this.world.day, hour: this.world.hour };
    const log = passVillage(this.members(), this.world, hours, this.rngFor("village"), talkingTo ? { talkingTo } : {});
    log.push(...passCreatureTime(this.templates, this.world.creatures, start, hours, this.rngFor("creatures"), DEMO_SPAWNS).filter(isNotable));
    log.push(...passVillageNights(this.templates, this.world.creatures, this.members(), this.world, start, hours, this.rngFor("nights")));
    if (this.world.realm) log.push(...castCrowd(this.world.realm, this.world.creatures, this.world.day));
    log.push(...this.respawn(keep));
    if (this.world.realm) castCrowd(this.world.realm, this.world.creatures, this.world.day);
    if (this.world.day > start.day) log.push(...this.familyNights(start.day));
    if (this.world.day > start.day) log.push(...this.realmNights(start.day));
    log.push(...this.consequences());
    if (this.world.day > start.day) this.newDay(start.day);
    return log;
  }

  /**
   * After any turn: witnesses remember, guards learn of crimes, deaths are recorded
   * and ripple out, escorts arrive. Returns lines for the player.
   */
  consequences(): string[] {
    const log: string[] = this.syncVisitors();
    absorbWitnessed(this.members(), this.world);
    for (const id of this.ids) {
      const a = this.agents[id]!;
      if (!a.isDead || this.rippled.has(id)) continue;
      this.rippled.add(id);
      this.recordDeath(id);
      const cause = a.state.deathCause;
      const byPlayer = cause === this.world.player.name;
      // Murder in the dark still comes out: the town knows who was last seen fighting them.
      const ripple = deathRipple(this.members(), this.world, id, cause === "old age" ? null : byPlayer ? "player" : (cause ?? null), byPlayer);
      log.push(...ripple.log);
      if (ripple.successor) this.agents[ripple.successor]!.state.dormant = false;
    }
    // After deaths: a killing everyone now knows of reaches the guard too.
    const guards = this.ids.filter((id) => isGuard(this.personas[id]!) && !this.agents[id]!.isDead);
    log.push(...reportCrimes(this.world, this.personas, guards));
    log.push(...checkEscorts(this.world.player, (who) => this.isAlive(who)));
    return log;
  }

  /** For escort quests: a living creature of this kind (its uid), or the NPC id itself. */
  findEscortee = (who: string): string | null => {
    if (this.agents[who]) return who;
    return Object.values(this.world.creatures).find((c) => c.template === who && !c.outcome)?.uid ?? null;
  };

  /** Uids of creatures being escorted now (they follow the player, not their den). */
  escorted(): Set<string> {
    return new Set(this.world.player.quests.active.flatMap((q) => (q.objective.type === "escort" && q.escortee ? [q.escortee] : [])));
  }

  private isAlive(who: string): boolean {
    const c = this.world.creatures[who];
    if (c) return !c.outcome;
    const a = this.agents[who];
    return a ? !a.isDead : false;
  }

  /** Write a death to the permanent record, once. */
  recordDeath(id: string): void {
    if (this.world.deaths[id]) return;
    const a = this.agents[id]!;
    const record = { npcId: id, name: a.persona.name, day: this.world.day, hour: this.world.hour, killedBy: a.state.deathCause ?? this.world.player.name };
    this.deaths?.record(record);
    this.world.deaths[id] = this.deaths?.get(id) ?? record;
  }

  /** The player arrives somewhere: anyone lying in wait jumps them. Returns the ambusher, if any. */
  ambushAt(place: PlaceId | undefined): Creature | null {
    if (!place) return null;
    const lying = ambushers(this.rules(), this.world.spawns ?? {}, this.world.creatures);
    // Hired men wait on the roads; they'll catch the player out of doors.
    return ["gate", "square", "camp"].includes(place) ? (lying[0] ?? null) : null;
  }

  /** Companions strike the player's foe in a fight round. Returns lines. */
  companionsHit(target: { npc?: string; creature?: string }): string[] {
    const comps = this.companions().filter((c) => this.placeOf(c.persona.id) === this.world.player.place || this.world.player.place === undefined).map((a) => ({ persona: a.persona, state: a.state }));
    if (comps.length === 0) return [];
    let foe: Foe | null = null;
    if (target.npc) {
      const a = this.agents[target.npc]!;
      const st = statsOf(a.persona, a.state);
      foe = { name: a.persona.name, hp: () => a.state.hp, setHp: (h) => (a.state.hp = h), agility: st.attributes.agility, evasion: skillLevel(npcSkills(a.persona, a.state), "evasion"), holder: a.state, spare: true };
    } else if (target.creature) {
      const c = this.creaturesHere()[target.creature] ?? this.world.creatures[target.creature];
      const t = c && this.templates[c.template];
      if (c && t) {
        const st = creatureStats(t, c);
        foe = { name: c.name, hp: () => c.hp, setHp: (h) => (c.hp = h), agility: st.attributes.agility, evasion: skillLevel(t.skills, "evasion"), holder: c, spare: false };
      }
    }
    if (!foe) return [];
    const log = companionsStrike(comps, foe, this.rngFor("companions"));
    if (target.creature) {
      const c = this.creaturesHere()[target.creature] ?? this.world.creatures[target.creature];
      if (c && c.hp <= 0 && !c.outcome) {
        c.outcome = "dead";
        c.deathCause = this.world.player.name;
        log.push(`${c.name} falls.`, ...recordCreatureDefeat(this.world.player, c.template), ...this.settleHaunts());
      }
    }
    return log;
  }

  /** A fight went badly (the player was knocked out): companions who were there lose heart. */
  companionsEndangered(): string[] {
    return this.companions().flatMap((a) => endangered(a.persona, a.state, this.world));
  }

  // ---- The director and background work ----

  /** A new day began: queue the chronicle for the day that ended, today's plans, and quest write-ups. */
  private newDay(ended: number): void {
    if (config.director) this.chronicle(ended);
    if (config.planning) this.queuePlans();
    for (const id of this.ids) {
      const a = this.agents[id]!;
      if (a.isDead || a.state.dormant) continue;
      this.background.add({ key: `flavor:${id}`, run: async () => void (await flavorBoard(this.bgLlm, a.persona, a.state.questBoard, [this.world.player.name])) });
    }
  }

  /** Run the nightly chronicle for `day` (in the background: it never holds up the player). */
  chronicle(day: number): Promise<unknown> {
    const sink = (e: DirectorLogEntry) => this.store?.logDirector(e);
    // The one before, taken now: read when the job runs, it could be this one (waiting on itself).
    const before = this.chronicling;
    const run = async () => {
      await before;
      return runChronicle({ llm: this.bgLlm, world: this.world, personas: this.personas, states: Object.fromEntries(this.ids.map((id) => [id, this.agents[id]!.state])), creatures: this.templates, sink }, day);
    };
    const p = new Promise((resolve) =>
      this.background.add({
        key: `chronicle:${day}`,
        run: async () => {
          const result = await run();
          this.news.push(...result.log);
          resolve(result);
        },
      }),
    );
    this.chronicling = p;
    return p;
  }

  /** Each NPC whose plan is out of date gets one short planning call, in the background: the cast, and the people about where the player is. */
  queuePlans(): void {
    for (const id of new Set([...this.ids, ...this.localIds()])) {
      const a = this.agents[id]!;
      // The townsfolk (N16) live by the crowd's day, not a planned one: no model call for them.
      if (parseTownsfolkId(id) || !needsPlan(a.state, this.world.day)) continue;
      this.background.add({ key: `plan:${id}`, run: async () => void (needsPlan(a.state, this.world.day) && (await planDay(this.bgLlm, a.persona, a.state, this.world, Object.values(this.personas).map((p) => p.name)))) });
    }
  }

  /**
   * A conversation ended (the player left, or time passed): summarise what wasn't
   * summarised yet into memories, and keep them in the long-term store for recall.
   */
  summarise(id: string): void {
    if (!config.summaries) return;
    const a = this.agents[id]!;
    if (a.pendingTranscript < 4) return;
    const transcript = a.takeTranscript();
    const day = this.world.day;
    this.background.add({
      key: `summary:${id}:${day}:${absoluteHour(this.world)}`,
      run: async () => {
        const out = await summariseConversation(this.bgLlm, a.persona, a.state, transcript, this.world.player.name, day);
        if (!out || !this.store) return;
        for (const f of out.facts) await this.store.addMemory(id, day, "summary", f.text, f.importance);
      },
    });
  }

  /** The player is about to act: background work makes way. Call resume() when the reply is done. */
  playerActs(): void {
    this.background.pause();
  }

  resume(): void {
    this.background.resume();
  }

  /** The world as one NPC sees it at the player's place: who else is here. */
  sceneFor(agent: NpcAgent): WorldSnapshot {
    this.world.present = this.presentAt(this.world.player.place).filter((x) => x !== agent).map((x) => x.persona.id);
    return this.world;
  }
}
