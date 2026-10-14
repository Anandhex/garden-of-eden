import { config } from "../config.js";
import { record } from "../metrics/timing.js";
import { BudgetedProvider, ModelLedger } from "../llm/budgeted.js";
import type { LLMProvider } from "../llm/provider.js";
import { NpcAgent } from "../npc/NpcAgent.js";
import type { NpcPersona, WorldSnapshot } from "../npc/types.js";
import { BackgroundWork } from "../director/background.js";
import { runChronicle } from "../director/chronicle.js";
import { flavorBoard } from "../director/flavor.js";
import { needsPlan, planDay } from "../director/planning.js";
import { summariseConversation } from "../director/summary.js";
import { absoluteHour, advanceMinutes } from "./clock.js";
import { type Creature, type CreatureTemplate, isNotable, passCreatureTime } from "./creatures.js";
import { reportCrimes, isGuard } from "./crime.js";
import { type Rng, streamFor } from "./dice.js";
import type { Building } from "../web/map.js";
import { onEvent } from "./events.js";
import type { WorldStore } from "./db.js";
import { absorbWitnessed } from "./gossip.js";
import { checkEscorts, recordCreatureDefeat } from "./quests.js";
import type { SavedWorld } from "./save.js";
import { allSpawnRules, ambushers, applySpawnRules, type SpawnRule } from "./spawning.js";
import { rulesFor } from "./realm/spawnrules.js";
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
import { loadTemplates, writeChildWords, type NpcTemplate, type Where } from "../npc/templates.js";
import { type AreaId, currentPlan, type PlaceId } from "./schedule.js";
import type { DirectorLogEntry } from "../director/validator.js";
import { addLore, learnLore, worldLore } from "../npc/knowledge.js";
import { bindActiveSite, creaturesOf, siteIdOf, siteState, type SiteState } from "./site.js";
import { registerTalker, talkerIdsAt, talkerSite } from "./talkers.js";
import { applyStory, deepen, factsFor, fallbackDepth } from "../npc/depth/index.js";
import { LifeReviews, shockFromEvent, shocksFromStep } from "./reviews.js";
import { writeStory } from "../npc/depth/story.js";
import { checkStory } from "../npc/depth/validate.js";
import { catchUp } from "./catchup.js";
import { siteMap } from "../web/sites.js";
import { advanceRealm } from "./realm/day.js";
import { lazySites, liveSites } from "./people/live.js";
import { ensureLivePeople } from "../store/materialise.js";
import { lifeDay } from "./people/world.js";
import { causeFromWords, deathWords, parseDeath } from "./people/death.js";
import { killPerson } from "./people/index.js";
import type { SiteStep } from "./people/step.js";
import { nameFaction } from "./realm/director.js";
import { applyArrivals, pruneArrivals } from "./realm/arrivals.js";
import { postNeedQuests } from "./realm/needs.js";
import { syncTalkers } from "./realm/sync.js";
import { tally } from "./realm/log.js";
import { deliverNews, realmNewsId, RETELL_IMPORTANCE, retellNews, shortName } from "./realm/news.js";
import { ensurePlaceLore, type Thing } from "./realm/lore.js";
import { atWar } from "./realm/economy.js";
import { breedCreatures, castCrowd, nameRisers, personaFor, readyToTalk } from "./realm/rise.js";
import { arrive, setOut, type Trip } from "./realm/travel.js";
import { RoadPlay } from "./road/play.js";
import { parseAway } from "../store/peopleStore.js";
import { journeyOf, pruneJourneys } from "./road/journeys.js";
import { visitorsAt, whereNow } from "./road/presence.js";
import { dueLater } from "./road/situations.js";
import { commitTrack, startRoad } from "./road/walk.js";
import { figureTalkerId, notablePersona, notablesOf } from "./realm/notables.js";
import { homeRoster, parseTownsfolkId, rosterFor, rosterFromStore, townsfolkPersona, townspersonOfRow } from "./realm/townsfolk.js";
import type { CrowdRoster, Townsperson } from "@millbrook/shared";
import { settleHaunts, stockHaunts } from "./realm/haunts.js";
import { killFigure, titled } from "./realm/figures.js";
import { realmNews } from "./realm/log.js";
import type { Figure, RealmNews } from "./realm/types.js";
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
 *
 * No place is special (N25a). Every settlement has the same state (`SiteState`) and the same
 * systems; the player's place runs hour by hour, and any other is caught up when they arrive.
 */
export interface TownOptions {
  /** People to register as talkers of the start town before anything else (tests bring hand-written files; the game passes none). */
  personas?: Record<string, NpcPersona>;
  creatureTemplates: Record<string, CreatureTemplate>;
  world: SavedWorld;
  llm: LLMProvider;
  /** A separate provider for background work, so cancelling it never cuts off a conversation. */
  backgroundLlm?: LLMProvider;
  store?: WorldStore;
  rng?: Rng;
  /** Agents, if the caller made them already (tests). */
  agents?: Record<string, NpcAgent>;
  /** The child template, for children born in play (default: src/data/templates/child.json). */
  childTemplate?: NpcTemplate;
  /**
   * Make a place's notables and the opening quest as it is activated (default true: that is how a world fills with people).
   * False is for tests of one NPC's mechanics, where the town is only the people it was given.
   */
  generate?: boolean;
  /**
   * Have the model write each new talker's story in the background (default: when there is a background model).
   * Code's words stand until it answers, and for any field that fails its checks.
   */
  stories?: boolean;
}

export class Town {
  /** Every talking person's file, by id: the registry (`world.talkers`) as one object. Grows when someone is born or met. */
  readonly personas: Record<string, NpcPersona>;
  /** Every talker's id. Grows when someone is born or met; callers should read it, not copy it. */
  readonly ids: string[];
  readonly agents: Record<string, NpcAgent>;
  readonly templates: Record<string, CreatureTemplate>;
  readonly world: SavedWorld;
  readonly background: BackgroundWork;
  /** Every model call made for this town, by kind and game day (N19). */
  readonly ledger: ModelLedger;
  readonly store?: WorldStore;
  private readonly llm: LLMProvider;
  private readonly bgLlm: LLMProvider;
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
  private readonly stories: boolean;
  private readonly generate: boolean;
  /** Lives that change (N25b): everyone who talks is reviewed every few days and when something big hits them. */
  readonly reviews: LifeReviews;
  /** The open road (N26): walking between places, travellers, situations, camps. */
  readonly road: RoadPlay = new RoadPlay(this);
  private stopShocks: (() => void) | undefined;

  /**
   * Walking moves the clock a minute at a time; each new hour the place gets an hour of life. (The web server has
   * its own, which also moves the creatures on screen; this one is for callers with no screen.)
   */
  walkMinutes(minutes: number): string[] {
    const before = absoluteHour(this.world);
    advanceMinutes(this.world, minutes);
    const crossed = absoluteHour(this.world) - before;
    if (crossed <= 0) return [];
    advanceMinutes(this.world, -crossed * 60); // passHours moves the clock itself
    return this.passHours(crossed);
  }

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
    const world = o.world;
    this.generate = o.generate !== false;
    this.stories = o.stories ?? o.backgroundLlm !== undefined;
    // A saved world forwards "today in town" to the player's place; one built by hand gets the same.
    if (!Object.getOwnPropertyDescriptor(world, "recentEvents")?.get) bindActiveSite(world);
    // Hand-written files brought by the caller are the start town's people, once.
    for (const p of Object.values(o.personas ?? {})) if (!world.talkers?.[p.id]) registerTalker(world, p, world.startSite ?? siteIdOf(world));
    // Everyone who talks: one registry, whoever made them.
    this.personas = o.personas ?? {};
    for (const [id, t] of Object.entries(world.talkers ?? {})) this.personas[id] = t.persona;
    for (const id of Object.keys(this.personas)) if (!world.talkers?.[id]) delete this.personas[id];
    this.ids = Object.keys(this.personas);
    // Every model call goes through the budget (N19): one ledger, counted by kind and game day.
    this.ledger = new ModelLedger(() => world.day, o.store ? (c) => o.store!.logModelCall(c) : undefined);
    const llm = new BudgetedProvider(o.llm, this.ledger);
    this.agentLlm = llm;
    try {
      this.childTemplate = o.childTemplate ?? loadTemplates().child;
    } catch {
      this.childTemplate = undefined;
    }
    this.templates = o.creatureTemplates;
    this.world = world;
    this.llm = llm;
    this.bgLlm = o.backgroundLlm ? new BudgetedProvider(o.backgroundLlm, this.ledger) : llm;
    this.store = o.store;
    if (o.rng) this.fixedRng = o.rng;
    this.background = new BackgroundWork(() => this.bgLlm.abort?.(), { avgMs: (k) => this.ledger.avgMs(k), onDrop: (j) => this.ledger.recordDropped(j.kind) });
    registerNpcNames(Object.fromEntries(this.ids.map((id) => [id, this.personas[id]!.name])));
    registerNpcGenders(Object.fromEntries(this.ids.map((id) => [id, this.personas[id]!.voice?.gender])));
    this.agents = o.agents ?? {};
    for (const id of this.ids) this.agents[id] ??= new NpcAgent(this.personas[id]!, llm, undefined, world.npcStates[id]);
    this.reviews = new LifeReviews({
      world,
      store: o.store,
      personas: this.personas,
      agents: this.agents as never,
      background: this.background,
      bgLlm: this.bgLlm,
      site: () => this.site(),
      companionIds: () => this.companions().map((a) => a.persona.id),
      replaceNpc: (p) => this.replaceNpc(p),
      modelOn: () => config.review.model && config.director,
    });
    if (config.review.enabled) {
      const kingdomOf = (site: string) => world.realm?.settlements[site]?.kingdom ?? null;
      this.stopShocks = onEvent((e) => {
        // The listeners are global: only this world's own events (the one just recorded) count.
        if (world.events?.at(-1) !== e) return;
        const shock = shockFromEvent(e, kingdomOf);
        if (shock) this.reviews.shock(shock);
      });
    }
    for (const id of this.ids) {
      if (this.agents[id]!.isDead) this.rippled.add(id);
      if (world.deaths[id] && this.agents[id]!.state.outcome !== "dead") this.agents[id]!.state.outcome = "dead";
    }
    this.setUpRealm();
    if (o.store) {
      const store = o.store;
      this.unsubscribe = onEvent((e) => (world.events?.at(-1) === e ? store.archiveEvent(e) : undefined));
      for (const e of world.events ?? []) store.archiveEvent(e);
      // Everyone recalls by meaning.
      for (const id of this.ids) this.hookRecall(id);
    }
  }

  private hookRecall(id: string): void {
    const store = this.store;
    if (store) this.agents[id]!.recall = async (line) => (await store.recall(id, line, 2)).map((r) => `on day ${r.day}, ${r.text}.`);
  }

  /** A new talker joins the registry and the town: a file, an agent, a state, a name. */
  private enrol(persona: NpcPersona, site: string, day = this.world.day): NpcAgent {
    const isNew = !this.world.talkers?.[persona.id];
    let writeIt = false;
    // A new talker gets their depth at once from code (N25a step 5): secrets, fears, loves, dilemmas and arcs from their real history.
    if (isNew && this.generate) {
      registerTalker(this.world, persona, site);
      const { persona: deep, sheet } = deepen({ realm: this.world.realm ?? null, people: this.store?.people ?? null, events: this.world.events ?? [], day, talkers: this.world.talkers ?? {} }, persona, this.world.seed);
      persona = deep;
      writeIt = this.stories && config.director;
      // Kin who already talk feel for them too.
      for (const r of sheet.family) {
        const kin = r.id ? this.agents[r.id] : undefined;
        const axes = persona.relationships?.[r.id ?? ""];
        if (kin && axes) kin.state.npcRelations[persona.id] ??= { trust: 0, fear: 0, respect: 0, affection: 0, ...axes };
      }
    }
    registerTalker(this.world, persona, site);
    this.personas[persona.id] = persona;
    if (!this.ids.includes(persona.id)) this.ids.push(persona.id);
    const state = this.world.npcStates[persona.id] ?? createNpcState(persona, {}, day);
    this.world.npcStates[persona.id] = state;
    this.agents[persona.id] = new NpcAgent(persona, this.agentLlm, undefined, state);
    registerNpcNames({ [persona.id]: persona.name });
    registerNpcGenders({ [persona.id]: persona.voice?.gender });
    this.hookRecall(persona.id);
    if (writeIt) {
      this.storyTries.set(persona.id, 1);
      this.queueStory(persona.id);
    }
    return this.agents[persona.id]!;
  }

  /** Stories asked for more than once this session, so one the model never gives isn't asked for for ever. */
  private storyTries = new Map<string, number>();

  /**
   * A story that was shed from a long queue (a new town's notables are many, and the model takes about a minute each) is asked for
   * again, a few a day, the player's place first. Code's words stand meanwhile.
   */
  private queueMissingStories(max = 3): void {
    if (!this.stories || !config.director) return;
    const here = this.site();
    const missing = Object.entries(this.world.talkers ?? {})
      .filter(([id, t]) => !t.written && this.agents[id] && !this.agents[id]!.isDead && (this.storyTries.get(id) ?? 0) < 3)
      .sort((a, b) => Number(b[1].site === here) - Number(a[1].site === here) || a[0].localeCompare(b[0]))
      .slice(0, max);
    for (const [id] of missing) {
      this.storyTries.set(id, (this.storyTries.get(id) ?? 0) + 1);
      this.queueStory(id);
    }
  }

  /** In the background: the model writes a new talker's story and depth from their facts; code checks it field by field (npc/depth). */
  private queueStory(id: string): void {
    this.background.add({
      key: `persona-story:${id}`,
      kind: "persona-story",
      run: async () => {
        const p = this.personas[id];
        const agent = this.agents[id];
        if (!p || !agent || agent.isDead || this.world.talkers?.[id]?.written) return;
        const ctx = { realm: this.world.realm ?? null, people: this.store?.people ?? null, events: this.world.events ?? [], day: this.world.day, talkers: this.world.talkers ?? {} };
        const sheet = factsFor(ctx, p);
        const story = await writeStory(this.bgLlm, sheet, p);
        // The talker may have gone, or been written, while the model thought.
        if (!story || !this.personas[id] || this.world.talkers?.[id]?.written) return;
        const rng = streamFor(this.world.seed, "depth-story", id);
        const { depth, accepted, rejected } = checkStory(story, sheet, p, fallbackDepth(sheet, p, this.world.day, rng), this.world.day, rng);
        const next = applyStory(this.personas[id]!, depth, accepted, agent.state);
        this.replaceNpc(next);
        const t = this.world.talkers?.[id];
        if (t) t.written = { day: this.world.day, fields: accepted, rejected };
      },
    });
  }

  /** A new NPC joins the town (a child is born on `day`): an agent, a state, a name. They belong to the place they were born in (or the player's). */
  addNpc(persona: NpcPersona, day = this.world.day, site = this.world.talkers?.[persona.id]?.site ?? this.site()): NpcAgent {
    return this.enrol(persona, site, day);
  }

  /** An NPC's file changed (a child grew up, the model wrote their story): a new agent on the same state. */
  replaceNpc(persona: NpcPersona): NpcAgent {
    const state = this.agents[persona.id]?.state ?? this.world.npcStates[persona.id];
    registerTalker(this.world, persona, talkerSite(this.world, persona.id) ?? this.site());
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
    const site = this.site();
    const place = { site, name: this.world.realm?.settlements[site]?.name ?? "the village" };
    for (let d = fromDay + 1; d <= this.world.day; d++) {
      const night = familyNight(this.members(), { ...this.world, day: d }, this.rngFor("family", d), this.childTemplate, place);
      for (const p of night.born) this.addNpc(p, d, site);
      for (const p of night.changed) {
        this.replaceNpc(p);
        if (p.minor && this.childTemplate && !p.speechStyle.startsWith("A baby")) this.writeChildWords(p.id);
      }
      log.push(...night.log);
    }
    return log;
  }

  // ---- Where the player is (N14, N25a) ----

  /** The realm settlement the player is in. Nothing else is special. */
  site(): string {
    return siteIdOf(this.world);
  }

  /** Where around the settlement the player is (N15): its village, or one of its localities. */
  area(): AreaId {
    return this.world.player.area ?? "village";
  }

  /** The state of the place the player is in (its creatures, spawn rules, news, raid day). */
  siteHere(): SiteState {
    return siteState(this.world, this.site());
  }

  /** The creatures where the player is: the beasts, outlaws and crowd of the place's maps. */
  creaturesHere(): Record<string, Creature> {
    return creaturesOf(this.world, this.site());
  }

  /** Bring the beasts and outlaws of the place the player is at in line with the realm (game/realm/haunts.ts). */
  stockHaunts(): void {
    const realm = this.world.realm;
    if (!realm) return;
    stockHaunts(realm, this.creaturesHere(), this.site(), this.templates, this.world.day, this.rngFor("haunts", this.site(), this.world.day), (f) => !!f.talks && !!this.personas[f.talks]);
  }

  /** After a fight: the dead go back to the realm (a pack one fewer, a bounty share, a named death). Returns lines. */
  settleHaunts(): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    return settleHaunts(realm, this.creaturesHere(), this.site(), this.world.player, this.world.day);
  }

  /** The place a talker lives in now: their row says (people move and are born), else the registry. */
  homeSiteOf(id: string): string | null {
    return this.store?.people.get(id)?.site ?? talkerSite(this.world, id) ?? parseTownsfolkId(id)?.site ?? null;
  }

  /** The figure a talker stands for. */
  figureOf(id: string): Figure | undefined {
    return Object.values(this.world.realm?.figures ?? {}).find((f) => f.talks === id);
  }

  /** Persona ids of the talkers who belong to a place. */
  talkersAt(site: string): string[] {
    return talkerIdsAt(this.world, site).filter((id) => this.agents[id]);
  }

  /**
   * Who's about where the player is: the talkers of this place (the townsfolk the player has spoken to only in
   * its village), and whoever travels with them.
   */
  localIds(): string[] {
    const site = this.site();
    const village = this.area() === "village";
    const here = [...this.talkersAt(site).filter((id) => (village || !parseTownsfolkId(id)) && !this.whereNow(id)), ...(village ? this.visitingTalkers(site) : [])];
    const companions = this.companions().map((a) => a.persona.id);
    return [...new Set([...here, ...companions])];
  }

  /** Everyone who lives in a place (N18): read from the database when the town has one, else rolled by the generator. */
  rosterAt(site: string, map: { id: string; buildings: Building[]; zones: Array<{ id: string }> }, day = this.world.day, opts: { readOnly?: boolean } = {}): CrowdRoster | null {
    const realm = this.world.realm;
    if (!realm) return null;
    // The admin view only looks: a place with no rows yet is shown as the generator would roll it, and nothing is written.
    if (this.store && !(opts.readOnly && this.store.people.count(site) === 0)) return rosterFromStore(this.store.people, realm, site, map, day, (day - 1) * 1440 + this.world.hour * 60 + (this.world.minute ?? 0));
    return rosterFor(realm, site, map, day);
  }

  private whereIs(site: string): Where {
    const s = this.world.realm?.settlements[site];
    const kingdom = s?.kingdom ? this.world.realm?.kingdoms[s.kingdom]?.name : undefined;
    return { place: s?.name ?? "the village", kind: s?.kind ?? "village", ...(kingdom ? { kingdom } : {}) };
  }

  /**
   * One of the townsfolk becomes a talking NPC (N16): the player spoke to them. Their
   * file (realm/townsfolk.ts) is kept in the registry with everyone who talks, so
   * they remember the player next time. Returns their id, or null if no file could be made.
   */
  meetTownsperson(roster: CrowdRoster, p: Townsperson): string | null {
    if (this.personas[p.id] && this.agents[p.id]) return p.id;
    // A visitor's file is of their own place, not the one they are visiting.
    const home = this.store?.people.get(p.id)?.site;
    if (home && home !== roster.site && this.world.realm) roster = homeRoster(this.world.realm, home, this.world.day) ?? roster;
    let templates: Record<string, NpcTemplate>;
    try {
      templates = loadTemplates();
    } catch {
      return null;
    }
    const persona = townsfolkPersona(this.world.realm ?? null, roster, p, templates);
    if (!persona) return null;
    this.enrol(persona, roster.site);
    this.store?.people.update(p.id, { persona: persona.id });
    return persona.id;
  }

  /** The buildings of a place's village map, and who keeps them, for its lore. */
  private thingsOf(site: string, folk: string[]): Thing[] {
    const realm = this.world.realm;
    const s = realm?.settlements[site];
    if (!realm || !s) return [];
    const keeper = (kind: "inn" | "smithy") => {
      const want = kind === "inn" ? (x: NpcPersona) => x.template === "innkeeper" || /inn/i.test(x.role) : (x: NpcPersona) => x.template === "smith" || (x.skills.smithing ?? 0) >= 3;
      const id = folk.find((i) => this.personas[i] && want(this.personas[i]!));
      return id ? this.personas[id]!.name : undefined;
    };
    const kinds: Record<string, Thing["kind"]> = { inn: "inn", smithy: "smithy", temple: "temple", hall: "hall", palace: "hall", market: "market" };
    const out: Thing[] = [];
    for (const b of siteMap(s, "village", realm).buildings) {
      const kind = kinds[b.kind ?? ""];
      if (!kind) continue;
      const k = kind === "inn" || kind === "smithy" ? keeper(kind) : undefined;
      out.push({ kind, name: b.name, ...(k ? { keeper: k } : {}) });
    }
    return out;
  }

  /** Make talking NPCs of a place's head and best-known people (once each), and its lore. Returns the new ones' ids. */
  meetNotables(site: string, announce = false): string[] {
    const realm = this.world.realm;
    if (!realm || !realm.settlements[site]) return [];
    let templates: Record<string, NpcTemplate>;
    try {
      templates = loadTemplates();
    } catch {
      return [];
    }
    // The place's lore first: its folk's files say what they know of it, and the schema checks that the lore is there.
    ensurePlaceLore(realm, this.world, site, this.talkersAt(site).map((id) => ({ state: this.agents[id]!.state })));
    const made: string[] = [];
    for (const f of this.generate ? notablesOf(realm, site) : []) {
      const id = figureTalkerId(f.id);
      if (this.personas[id]) {
        f.talks = id;
        continue;
      }
      const persona = notablePersona(realm, f, templates, this.world.day, id);
      if (!persona) continue;
      const agent = this.enrol(persona, site);
      agent.state.life = structuredClone(f.life) as typeof agent.state.life;
      f.talks = id;
      made.push(id);
    }
    const folk = this.talkersAt(site);
    ensurePlaceLore(realm, this.world, site, folk.map((id) => ({ state: this.agents[id]!.state })), this.thingsOf(site, folk));
    return announce ? made.map((id) => `${this.personas[id]!.name}, ${this.personas[id]!.role}, is about now.`) : made;
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

  /**
   * Someone on the road is a person of the `people` table (N26 Part E): when the player speaks to one they become a talker like any
   * townsperson (the same file, kept in the registry under their home place), who remembers the player. What their journey carries,
   * they know. Returns their id, or null if they are nobody's or no file could be made.
   */
  meetPerson(id: string): string | null {
    if (this.personas[id] && this.agents[id]) return id;
    const realm = this.world.realm;
    const row = this.store?.people.get(id);
    if (!realm || !row || row.death !== null) return null;
    const roster = homeRoster(realm, row.site, this.world.day);
    if (!roster) return null;
    const got = this.meetTownsperson(roster, townspersonOfRow(row, realm, this.world.day, 0, 0));
    const agent = got ? this.agents[got] : undefined;
    const away = parseAway(row.away);
    const j = away ? journeyOf(realm, away.journey) : undefined;
    if (agent) for (const c of j?.carries ?? []) {
      const n = realm.news.find((x) => x.id === c.id);
      if (n) this.learnNews(agent.state, n);
    }
    return got;
  }

  /** Where someone on a journey is now: a place (a town they visit, an inn), or the open road; null for someone at home. */
  whereNow(id: string): { site: string | null; journey: string; state: string } | null {
    const realm = this.world.realm;
    return realm && this.store ? whereNow(this.store.people, realm, id, this.road.minute()) : null;
  }

  /** Talkers of other places who are visiting this one now (the crowd has them too). */
  visitingTalkers(site: string): string[] {
    const realm = this.world.realm;
    if (!realm || !this.store) return [];
    const minute = this.road.minute();
    if (this.visitMemo && this.visitMemo.site === site && this.visitMemo.minute === minute && this.visitMemo.rev === this.store.people.pending) return this.visitMemo.ids;
    const ids = visitorsAt(this.store.people, realm, site, minute).filter((v) => !v.home && this.agents[v.row.id]).map((v) => v.row.id);
    this.visitMemo = { site, minute, rev: this.store.people.pending, ids };
    return ids;
  }
  private visitMemo: { site: string; minute: number; rev: number; ids: string[] } | null = null;

  /** A line for the player's feed, from something that happened away from the screen. */
  tell(line: string): void {
    this.news.push(line);
  }

  /** A traveller learns a piece of realm news as the carrier of it: it becomes lore, and they know it for certain. */
  learnNews(state: NpcAgent["state"], n: RealmNews): void {
    const id = realmNewsId(n);
    if (!worldLore().byId.has(id)) addLore(this.world, { id, kind: "news", name: shortName(n.text), aliases: [], keywords: ["news", "realm", "travellers"], text: n.text, event: true });
    learnLore(state, id, "certain");
  }

  /**
   * The player walks out of the west gate onto the open road (N26). `site` stays the place they left (their world's
   * "today" is that place's own state) until they arrive somewhere. Returns lines.
   */
  leaveByRoad(toward?: string): string[] {
    const realm = this.world.realm;
    const here = realm?.settlements[this.site()];
    if (!realm || !here) return ["There's no road out of here."];
    const state = startRoad(realm, this.world.player, here.id, toward);
    if (!state) return [`There's no road out of ${here.name}.`];
    const dest = toward ? realm.settlements[toward] : undefined;
    return [dest ? `You leave ${here.name} on the road toward ${dest.name}.` : `You leave ${here.name} by the open road.`];
  }

  /** The player arrives: they're at the gate of the new place, and its people are about. Returns lines. */
  arriveAt(to: string): string[] {
    const realm = this.world.realm;
    const s = realm?.settlements[to];
    if (!realm || !s) return [];
    const from = this.site();
    if (from !== to) this.deactivate(from);
    // Off the open road (N26): the stretch they walked is written down, and they are no longer on it.
    commitTrack(realm, this.world.player);
    delete this.world.player.road;
    arrive(this.world.player, s.id);
    this.world.player.place = "gate";
    const been = siteState(this.world, s.id).visited === true;
    const lines = this.activate(s.id);
    const folk = this.localIds().filter((id) => !this.agents[id]!.state.companion && !parseTownsfolkId(id));
    if (been) return [`You're back in ${s.name}.`, ...lines];
    const head = s.leader ? realm.figures[s.leader] : undefined;
    return [
      `You reach ${s.name}, a ${s.kind}${s.kingdom ? ` of ${realm.kingdoms[s.kingdom]?.name}` : ""} of about ${s.population} people${head ? `, under ${titled(head)}` : ""}.`,
      ...(folk.length > 0 ? [`About the place: ${folk.map((id) => this.personas[id]!.name).join(", ")}.`] : []),
      ...lines,
    ];
  }

  // ---- Activating a place (N25a decision 3) ----

  /** The player leaves a place: it freezes where it is (its people, creatures and news wait for them). */
  private deactivate(site: string): void {
    siteState(this.world, site).lastActive = absoluteHour(this.world);
  }

  /**
   * A place becomes the player's. It is caught up on the days it was frozen: its people eat, sleep and heal,
   * its news arrives, what the realm sent it happens or leaves its mark, its creatures are stocked from what the
   * realm says is there, and its talkers are the ones met so far plus its notables. Returns lines.
   */
  private activate(site: string): string[] {
    const realm = this.world.realm;
    const log: string[] = [];
    if (!realm || !realm.settlements[site]) return log;
    const state = siteState(this.world, site);
    const away = state.lastActive !== undefined ? Math.floor((absoluteHour(this.world) - state.lastActive) / 24) : 0;
    this.meetNotables(site);
    const folk = this.talkersAt(site).filter((id) => !parseTownsfolkId(id)).map((id) => ({ id, persona: this.personas[id]!, state: this.agents[id]!.state }));
    if (away >= 1) catchUp(folk, away);
    syncTalkers(realm, folk, site, this.world.day);
    this.world.atWar = atWar(realm, realm.settlements[site]!);
    log.push(...applyArrivals(realm, this.world, site, folk, Object.keys(this.templates)));
    log.push(...deliverNews(realm, this.world, site, folk));
    this.stockHaunts();
    castCrowd(realm, this.creaturesHere(), this.world.day, site);
    // A new game's first day: the head of the place has work, even if nothing is pressing yet.
    if (this.generate && !state.visited && this.world.day <= 1) log.push(...postNeedQuests(realm, this.world, site, folk, { opening: true }));
    else log.push(...postNeedQuests(realm, this.world, site, folk));
    state.visited = true;
    state.lastActive = undefined;
    // The people there think over the time away: one review each, however many cycles were missed.
    if (config.review.enabled && away >= 1) this.reviews.arrive(site);
    return log;
  }

  /** Realm deaths reach the talkers, and the player's killings reach the realm. Returns lines. */
  private syncTalkerDeaths(): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    const log: string[] = [];
    for (const id of this.ids) {
      const f = this.figureOf(id);
      const a = this.agents[id];
      // A talking townsperson and their row are one person (N25): whichever died first, both are dead.
      if (a && !f && this.store && parseTownsfolkId(id)) {
        const row = this.store.people.get(id);
        if (row && a.isDead && row.death === null) {
          const cause = a.state.deathCause ?? this.world.player.name;
          const byPlayer = cause === this.world.player.name;
          killPerson(realm, this.store, id, { cause: byPlayer ? "murder" : causeFromWords(cause), day: this.world.day, hour: this.world.hour, ...(byPlayer ? { killer: "player" } : {}), note: cause });
        } else if (row && row.death !== null && !a.isDead) {
          const rec = parseDeath(row.death);
          a.state.outcome = "dead";
          a.state.deathCause = rec ? (rec.cause === "old-age" ? "old age" : (rec.note ?? rec.cause)) : "unknown";
        }
        continue;
      }
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

  /** The player's place at the start of a session: its people, lore and creatures, ready. */
  private setUpRealm(): void {
    const realm = this.world.realm;
    if (!realm) return;
    this.activate(this.site());
  }

  /**
   * Each midnight passed, for the realm (N13): the place's creatures breed and the
   * ones that rose get names; the realm lives its day; what it sends the place
   * happens on the map; news that has travelled far enough arrives; its needs
   * go on the boards; and anyone who rose far enough starts to talk. Returns lines.
   */
  realmNights(fromDay: number): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    const log: string[] = [];
    const site = this.site();
    for (let d = fromDay + 1; d <= this.world.day; d++) {
      log.push(...breedCreatures(this.templates, this.creaturesHere(), d, this.rngFor("breed", d)));
      log.push(...nameRisers(realm, this.templates, this.creaturesHere(), d, this.rngFor("risers", d), site));
      syncTalkers(realm, this.members(), site, d);
      const before = Object.keys(realm.factions);
      // Where the people are rows (N25) they live their own days after the realm's; elsewhere the realm counts heads.
      const live = this.store ? liveSites(realm, this.world.startSite) : new Set<string>();
      advanceRealm(realm, d, this.fixedRng, { live });
      if (this.store && live.size > 0) this.livesDay(d, live);
      // The road (N26): journeys, trips and news are part of everyone's day (people/world.ts); the ones that are done are dropped.
      pruneJourneys(realm, d * 1440);
      for (const line of dueLater(this, d)) this.tell(line);
      this.world.atWar = atWar(realm, realm.settlements[site]!);
      log.push(...applyArrivals(realm, this.world, site, this.members(), Object.keys(this.templates)));
      const before2 = new Set(siteState(this.world, site).newsSeen);
      log.push(...deliverNews(realm, this.world, site, this.members()));
      // Big news from away, retold by the model in the background (code's words stand if it fails).
      if (config.director) {
        for (const n of realm.news.filter((x) => siteState(this.world, site).newsSeen.includes(x.id) && !before2.has(x.id) && x.importance >= RETELL_IMPORTANCE && x.at !== site)) {
          this.background.add({ key: `retell:${n.id}`, kind: "retell", run: async () => void (await retellNews(this.bgLlm, realm, this.world, realmNewsId(n))) });
        }
      }
      log.push(...postNeedQuests(realm, this.world, site, this.members()));
      log.push(...this.promoteRisers(d));
      log.push(...this.meetNotables(site, true));
      pruneArrivals(realm, d);
      // New factions get their words from the model, in the background (code's names stand if it fails).
      if (config.director) for (const id of Object.keys(realm.factions).filter((x) => !before.includes(x))) this.background.add({ key: `faction-name:${id}`, kind: "faction-name", run: async () => void (await nameFaction(this.bgLlm, realm, id)) });
    }
    return log;
  }

  /** Lives the player would see happen here today, with the hour they happen (full detail: the place the player is in). */
  private lifeNews: Array<{ day: number; hour: number; site: string; text: string }> = [];

  /**
   * Everyone's day (N25), after the realm's: births, deaths, weddings and moves among the townsfolk of every live
   * place. The player's place is worked out first, with its events kept to show at their hour; a talking townsperson
   * who died is dead as a talking NPC too.
   */
  private livesDay(day: number, live: ReadonlySet<string>): void {
    const realm = this.world.realm!;
    const here = this.site();
    ensureLivePeople(realm, this.store!.people, live, day);
    const result = lifeDay({ realm, store: this.store! }, day, { live, lazy: lazySites(), watched: new Set([here]) });
    for (const step of result.steps) {
      if (step.day !== day) continue;
      this.afterSiteStep(step, step.site === here);
    }
  }

  private afterSiteStep(step: SiteStep, watched: boolean): void {
    // What the day did to families and to the place: the talkers it touches hard enough are reviewed today (N25b).
    if (config.review.enabled && this.store && this.world.realm) {
      const realm = this.world.realm;
      for (const shock of shocksFromStep(step, this.store, (s) => realm.settlements[s]?.kingdom ?? null, realm.settlements[step.site]?.name ?? step.site)) this.reviews.shock(shock);
    }
    for (const p of step.deaths) {
      if (!p.persona) continue;
      const a = this.agents[p.persona];
      if (a && !a.isDead) {
        a.state.outcome = "dead";
        a.state.deathCause = p.record.cause === "old-age" ? "old age" : deathWords(p.record).replace(/^(of|in|to|on|by) /, "");
        this.rippled.add(p.persona);
        this.recordDeath(p.persona);
      }
    }
    if (!watched) return;
    for (const e of step.events) {
      if (e.kind === "birth" || e.kind === "death" || e.kind === "marriage") this.lifeNews.push({ day: e.day, hour: e.hour, site: step.site, text: e.details });
    }
    if (this.lifeNews.length > 200) this.lifeNews.splice(0, this.lifeNews.length - 200);
  }

  /** The lives that have happened where the player is by now (their hour has come), once each. */
  takeLifeNews(): string[] {
    const now = this.world.day * 24 + this.world.hour;
    const here = this.site();
    const due = this.lifeNews.filter((n) => n.site === here && n.day * 24 + n.hour <= now);
    this.lifeNews = this.lifeNews.filter((n) => !due.includes(n)).filter((n) => n.day * 24 + n.hour > now - 24 * 3);
    return due.map((n) => `${n.text}.`);
  }

  /** People of the place who rose far enough become talking NPCs (N13.7), while there's room. */
  private promoteRisers(day: number): string[] {
    const realm = this.world.realm;
    if (!realm) return [];
    const site = this.site();
    // Everyone who has made enough of a name talks: there is no cap (the cast's limit of 14 is for births).
    const ready = readyToTalk(realm, this.creaturesHere(), site);
    if (ready.length === 0) return [];
    let templates: Record<string, NpcTemplate>;
    try {
      templates = loadTemplates();
    } catch {
      return [];
    }
    const log: string[] = [];
    for (const f of ready) {
      const home = f.home ?? site;
      const away = home !== site;
      const persona = personaFor(f, templates, day, this.rngFor("rise", f.id), this.ids, this.whereIs(home));
      if (!persona) continue;
      // One who grew up as a townsperson (N25) keeps both links, and their parents are named in their file.
      const row = f.person && this.store ? this.store.people.get(f.person) : null;
      if (row && this.store) {
        const kin = [row.mother, row.father].filter((x): x is string => !!x).map((x) => this.store!.people.get(x)?.persona ?? x);
        if (kin.length > 0) persona.parents = kin;
        this.store.people.update(row.id, { persona: persona.id });
      }
      // Off the map as a creature; into the world as a person.
      const creatures = this.creaturesHere();
      for (const [uid, c] of Object.entries(creatures)) if (c.figure === f.id) delete creatures[uid];
      for (const out of Object.values(this.siteHere().spawns)) out.uids = out.uids.filter((uid) => creatures[uid]);
      const agent = this.enrol(persona, home, day);
      agent.state.life = structuredClone(f.life) as typeof agent.state.life;
      f.talks = persona.id;
      f.name = persona.name;
      addLore(this.world, { id: `people.${persona.id}`, kind: "person", name: persona.name, aliases: [persona.name.split(" ")[0]!], keywords: [], npc: persona.id, text: `${persona.name}, ${persona.role}. Folk know the name now: ${f.deeds.slice(-2).join("; ") || "they made a name for themselves"}.` });
      if (!away) for (const m of this.members()) if (m.id !== persona.id) learnLore(m.state, `people.${persona.id}`, "rumour");
      tally(realm, "promoted");
      log.push(away ? `Word reaches you that ${persona.name}, ${persona.role} of ${realm.settlements[home]?.name ?? "another place"}, has made a name.` : `${persona.name} (${persona.role}) has made enough of a name that folk stop to talk with them.`);
    }
    return log;
  }

  /** In the background: the model writes a child's words when they start talking (template words stand if it fails). */
  private writeChildWords(id: string): void {
    const t = this.childTemplate;
    if (!t) return;
    const parents = (this.personas[id]!.parents ?? []).map((p) => (p === "player" ? this.world.player.name : (this.personas[p]?.name ?? p))).join(" and ");
    const where = this.whereIs(talkerSite(this.world, id) ?? this.site());
    this.background.add({
      key: `child-words:${id}`,
      kind: "child-words",
      run: async () => {
        const p = this.personas[id];
        if (!p?.minor) return;
        const words = await writeChildWords(this.bgLlm, t, p, parents, where);
        if (!words || !this.personas[id]?.minor) return;
        const next = { ...this.personas[id]!, ...words, backstory: `${p.backstory.split(". ")[0]}. ${words.backstory}` };
        this.replaceNpc(next);
      },
    });
  }

  close(): void {
    this.stopShocks?.();
    this.unsubscribe?.();
  }

  /** The talkers of the player's place, and the companions who travel with them: the people who live the place's day hour by hour. */
  members(): VillageMember[] {
    const site = this.site();
    return this.ids
      .filter((id) => !parseTownsfolkId(id) && (talkerSite(this.world, id) === site || this.agents[id]!.state.companion))
      .map((id) => ({ id, persona: this.personas[id]!, state: this.agents[id]!.state }));
  }

  /** The talkers of one place, whether or not the player is there. */
  membersOf(site: string): VillageMember[] {
    return this.ids.filter((id) => !parseTownsfolkId(id) && talkerSite(this.world, id) === site).map((id) => ({ id, persona: this.personas[id]!, state: this.agents[id]!.state }));
  }

  /** Spawn rules in play here: the ones the realm makes for the place, plus those made during play (director quests, ambushes). */
  rules(): SpawnRule[] {
    return allSpawnRules(rulesFor(this.world.realm, this.site()), this.siteHere(), this.world.day);
  }

  /** Creatures due now turn up, ended groups move on. `keep`: creatures in a fight. */
  respawn(keep: string[] = []): string[] {
    return applySpawnRules(this.rules(), this.templates, this.creaturesHere(), this.siteHere().spawns, this.world, this.rngFor("spawn"), new Set(keep));
  }

  /** Where an NPC is now (null when they're not out: asleep, at home, dead, away). */
  placeOf(id: string): PlaceId | null {
    const a = this.agents[id]!;
    if (a.isDead || a.state.dormant || a.state.outcome === "unconscious") return null;
    // Away from where they belong, a companion is wherever the player is; the rest of that place isn't here.
    if (talkerSite(this.world, id) !== this.site()) return a.state.companion ? (this.world.player.place ?? "square") : null;
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
  passHours(hours: number, opts: { talkingTo?: string; keep?: string[] } = {}): string[] {
    const t0 = performance.now();
    try {
      return this.passHoursNow(hours, opts);
    } finally {
      // The budget is for one game hour (N19): a long wait counts as that many.
      if (hours > 0) record("passHour", (performance.now() - t0) / hours);
    }
  }

  private passHoursNow(hours: number, { talkingTo, keep = [] }: { talkingTo?: string; keep?: string[] }): string[] {
    const start = { day: this.world.day, hour: this.world.hour };
    const site = this.site();
    const log = passVillage(this.members(), this.world, hours, this.rngFor("village"), talkingTo ? { talkingTo } : {});
    log.push(...passCreatureTime(this.templates, this.creaturesHere(), start, hours, this.rngFor("creatures")).filter(isNotable));
    log.push(...passVillageNights(this.templates, this.creaturesHere(), this.members(), this.world, start, hours, this.rngFor("nights")));
    if (this.world.realm) log.push(...castCrowd(this.world.realm, this.creaturesHere(), this.world.day, site));
    log.push(...this.respawn(keep));
    if (this.world.day > start.day) log.push(...this.familyNights(start.day));
    if (this.world.day > start.day) log.push(...this.realmNights(start.day));
    // The realm's packs and gangs grow and thin as the days pass: the beasts and outlaws on the map follow.
    this.stockHaunts();
    log.push(...this.takeLifeNews());
    log.push(...this.consequences());
    if (this.world.day > start.day) this.newDay(start.day);
    return log;
  }

  /**
   * After any turn: witnesses remember, guards learn of crimes, deaths are recorded
   * and ripple out, escorts arrive. Returns lines for the player.
   */
  consequences(): string[] {
    const log: string[] = this.syncTalkerDeaths();
    absorbWitnessed(this.members(), this.world);
    for (const id of this.ids) {
      const a = this.agents[id]!;
      if (!a.isDead || this.rippled.has(id)) continue;
      this.rippled.add(id);
      this.recordDeath(id);
      const cause = a.state.deathCause;
      const byPlayer = cause === this.world.player.name;
      // Murder in the dark still comes out: the town knows who was last seen fighting them.
      const home = talkerSite(this.world, id);
      const kin = home && home !== this.site() ? this.membersOf(home) : this.members();
      const ripple = deathRipple(kin, this.world, id, cause === "old age" ? null : byPlayer ? "player" : (cause ?? null), byPlayer);
      log.push(...ripple.log);
      if (ripple.successor) this.agents[ripple.successor]!.state.dormant = false;
    }
    // After deaths: a killing everyone now knows of reaches the guard too.
    const guards = this.members().filter((m) => isGuard(m.persona) && !this.agents[m.id]!.isDead).map((m) => m.id);
    log.push(...reportCrimes(this.world, this.personas, guards));
    log.push(...checkEscorts(this.world.player, (who) => this.isAlive(who)));
    return log;
  }

  /** For escort quests: a living creature of this kind (its uid), or the NPC id itself. */
  findEscortee = (who: string): string | null => {
    if (this.agents[who]) return who;
    return Object.values(this.creaturesHere()).find((c) => c.template === who && !c.outcome)?.uid ?? null;
  };

  /** Uids of creatures being escorted now (they follow the player, not their den). */
  escorted(): Set<string> {
    return new Set(this.world.player.quests.active.flatMap((q) => (q.objective.type === "escort" && q.escortee ? [q.escortee] : [])));
  }

  private isAlive(who: string): boolean {
    const c = this.creaturesHere()[who];
    if (c) return !c.outcome;
    const a = this.agents[who];
    return a ? !a.isDead : false;
  }

  /** Write a death to the permanent record, once (the world's `deaths`; people rows keep their own, N25). */
  recordDeath(id: string): void {
    if (this.world.deaths[id]) return;
    const a = this.agents[id]!;
    const killedBy = a.state.deathCause ?? this.world.player.name;
    this.world.deaths[id] = { npcId: id, name: a.persona.name, day: this.world.day, hour: this.world.hour, killedBy, cause: killedBy === this.world.player.name ? ("murder" as const) : causeFromWords(killedBy), site: this.homeSiteOf(id) ?? this.figureOf(id)?.home ?? this.site() };
  }

  /** The player arrives somewhere: anyone lying in wait jumps them. Returns the ambusher, if any. */
  ambushAt(place: PlaceId | undefined): Creature | null {
    if (!place) return null;
    const lying = ambushers(this.rules(), this.siteHere().spawns, this.creaturesHere());
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
      const c = this.creaturesHere()[target.creature];
      const t = c && this.templates[c.template];
      if (c && t) {
        const st = creatureStats(t, c);
        foe = { name: c.name, hp: () => c.hp, setHp: (h) => (c.hp = h), agility: st.attributes.agility, evasion: skillLevel(t.skills, "evasion"), holder: c, spare: false };
      }
    }
    if (!foe) return [];
    const log = companionsStrike(comps, foe, this.rngFor("companions"));
    if (target.creature) {
      const c = this.creaturesHere()[target.creature];
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
    if (config.review.enabled) this.reviews.newDay();
    this.queueMissingStories();
    if (config.director) this.chronicle(ended);
    if (config.planning) this.queuePlans();
    for (const m of this.members()) {
      const a = this.agents[m.id]!;
      if (a.isDead || a.state.dormant) continue;
      this.background.add({ key: `flavor:${m.id}`, kind: "quest-flavor", run: async () => void (await flavorBoard(this.bgLlm, a.persona, a.state.questBoard, [this.world.player.name])) });
    }
  }

  /** Run the nightly chronicle for `day` (in the background: it never holds up the player). */
  chronicle(day: number): Promise<unknown> {
    const sink = (e: DirectorLogEntry) => this.store?.logDirector(e);
    // The one before, taken now: read when the job runs, it could be this one (waiting on itself).
    const before = this.chronicling;
    const members = this.members();
    const run = async () => {
      await before;
      return runChronicle({ llm: this.bgLlm, world: this.world, personas: this.personas, states: Object.fromEntries(members.map((m) => [m.id, m.state])), creatures: this.templates, sink }, day);
    };
    const p = new Promise((resolve) =>
      this.background.add({
        key: `chronicle:${day}`,
        kind: "chronicle",
        // Shed from a long queue: the night goes unchronicled, and whoever waits on it (or the next night) isn't left waiting.
        fallback: () => resolve({ log: [], accepted: [], rejected: [] }),
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

  /** Each NPC whose plan is out of date gets one short planning call, in the background: the people of the player's place. */
  queuePlans(): void {
    for (const id of new Set([...this.members().map((m) => m.id), ...this.localIds()])) {
      const a = this.agents[id]!;
      // The townsfolk (N16) live by the crowd's day, not a planned one: no model call for them.
      if (parseTownsfolkId(id) || !needsPlan(a.state, this.world.day)) continue;
      this.background.add({ key: `plan:${id}`, kind: "plan", run: async () => void (needsPlan(a.state, this.world.day) && (await planDay(this.bgLlm, a.persona, a.state, this.world, Object.values(this.personas).map((p) => p.name)))) });
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
      kind: "summary",
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
