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
import type { Rng } from "./dice.js";
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
import { loadTemplates, writeChildWords, type NpcTemplate } from "../npc/templates.js";
import { currentPlan, type PlaceId } from "./schedule.js";
import { DEMO_SPAWNS } from "../world/world.js";
import type { DirectorLogEntry } from "../director/validator.js";

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
  private readonly rng: Rng;
  private unsubscribe: (() => void) | null = null;
  /** Deaths whose ripple has run (once each; deaths before this session already did theirs). */
  private rippled = new Set<string>();
  /** The chronicle runs one at a time. */
  private chronicling: Promise<unknown> | null = null;
  /** Lines from background work (the chronicle's news) for the player, until taken. */
  private news: string[] = [];
  private readonly childTemplate?: NpcTemplate;
  private readonly agentLlm: LLMProvider;

  /** News from background work since last asked. */
  takeNews(): string[] {
    const out = this.news;
    this.news = [];
    return out;
  }

  constructor(o: TownOptions) {
    // Children born in play live in the save, and so do grown-up children's files: they're the cast.
    for (const [id, p] of Object.entries(o.world.family?.born ?? {})) o.personas[id] = p;
    this.personas = o.personas;
    this.ids = Object.keys(o.personas);
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
    this.rng = o.rng ?? Math.random;
    this.background = new BackgroundWork(() => this.bgLlm.abort?.());
    registerNpcNames(Object.fromEntries(this.ids.map((id) => [id, o.personas[id]!.name])));
    registerNpcGenders(Object.fromEntries(this.ids.map((id) => [id, o.personas[id]!.voice?.gender])));
    this.agents = o.agents ?? Object.fromEntries(this.ids.map((id) => [id, new NpcAgent(o.personas[id]!, o.llm, undefined, o.world.npcStates[id])]));
    for (const id of this.ids) this.agents[id] ??= new NpcAgent(o.personas[id]!, o.llm, undefined, o.world.npcStates[id]);
    for (const id of this.ids) {
      if (this.agents[id]!.isDead) this.rippled.add(id);
      if (o.world.deaths[id] && this.agents[id]!.state.outcome !== "dead") this.agents[id]!.state.outcome = "dead";
    }
    if (o.store) {
      const store = o.store;
      this.unsubscribe = onEvent((e) => store.archiveEvent(e));
      for (const e of o.world.events ?? []) store.archiveEvent(e);
      for (const id of this.ids) this.hookRecall(id);
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
      const night = familyNight(this.members(), { ...this.world, day: d }, this.rng, this.childTemplate);
      for (const p of night.born) this.addNpc(p, d);
      for (const p of night.changed) {
        this.replaceNpc(p);
        if (p.minor && this.childTemplate && !p.speechStyle.startsWith("A baby")) this.writeChildWords(p.id);
      }
      log.push(...night.log);
    }
    return log;
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
    return applySpawnRules(this.rules(), this.templates, this.world.creatures, (this.world.spawns ??= {}), this.world, this.rng, new Set(keep));
  }

  /** Where an NPC is now (null when they're not out: asleep, at home, dead, away). */
  placeOf(id: string): PlaceId | null {
    const a = this.agents[id]!;
    if (a.isDead || a.state.dormant || a.state.outcome === "unconscious") return null;
    const plan = currentPlan(a.persona, a.state, this.world);
    return plan.activity === "sleep" || plan.place === "home" ? null : plan.place;
  }

  /** NPCs at a place, awake and alive. */
  presentAt(place: PlaceId | null | undefined): NpcAgent[] {
    return place ? this.ids.filter((id) => this.placeOf(id) === place).map((id) => this.agents[id]!) : [];
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
    const log = passVillage(this.members(), this.world, hours, this.rng, talkingTo ? { talkingTo } : {});
    log.push(...passCreatureTime(this.templates, this.world.creatures, start, hours, this.rng, DEMO_SPAWNS).filter(isNotable));
    log.push(...passVillageNights(this.templates, this.world.creatures, this.members(), this.world, start, hours, this.rng));
    log.push(...this.respawn(keep));
    if (this.world.day > start.day) log.push(...this.familyNights(start.day));
    log.push(...this.consequences());
    if (this.world.day > start.day) this.newDay(start.day);
    return log;
  }

  /**
   * After any turn: witnesses remember, guards learn of crimes, deaths are recorded
   * and ripple out, escorts arrive. Returns lines for the player.
   */
  consequences(): string[] {
    const log: string[] = [];
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
      const c = this.world.creatures[target.creature];
      const t = c && this.templates[c.template];
      if (c && t) {
        const st = creatureStats(t, c);
        foe = { name: c.name, hp: () => c.hp, setHp: (h) => (c.hp = h), agility: st.attributes.agility, evasion: skillLevel(t.skills, "evasion"), holder: c, spare: false };
      }
    }
    if (!foe) return [];
    const log = companionsStrike(comps, foe, this.rng);
    if (target.creature) {
      const c = this.world.creatures[target.creature];
      if (c && c.hp <= 0 && !c.outcome) {
        c.outcome = "dead";
        c.deathCause = this.world.player.name;
        log.push(`${c.name} falls.`, ...recordCreatureDefeat(this.world.player, c.template));
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
    const run = async () => {
      await this.chronicling;
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

  /** Each NPC whose plan is out of date gets one short planning call, in the background. */
  queuePlans(): void {
    for (const id of this.ids) {
      const a = this.agents[id]!;
      if (!needsPlan(a.state, this.world.day)) continue;
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
