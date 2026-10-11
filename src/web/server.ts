import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { absoluteHour, absoluteMinute, advanceMinutes, advanceTime, formatTime } from "../game/clock.js";
import { countItem } from "../game/crafting.js";
import {
  type Creature,
  creatureAmbush,
  creatureBeatsPlayer,
  type CreatureRound,
  creatureStats,
  creatureTurn,
  fightCreature,
  fleeCreature,
  isNotable,
  loadCreatureTemplates,
  passCreatureTime,
} from "../game/creatures.js";
import { DEMO_SPAWNS } from "../world/world.js";
import { passVillageNights } from "../game/underworld.js";
import { DeathRegistry } from "../game/deaths.js";
import { rankForLevel, xpToNextLevel } from "../game/levels.js";
import { importDeaths, loadWorld, newWorld, saveWorld, type SavedWorld } from "../game/save.js";
import {
  DEFAULT_SESSION_HOURS,
  feePerHour,
  hoursToNextLevel,
  MAX_SESSION_HOURS,
  parseSkill,
  quoteTraining,
  TRUST_FOR_TIER,
  teachableSkills,
  trustCap,
} from "../game/training.js";
import { applySpawnRules, badSpawnRules, denKey, loadSpawnRules } from "../game/spawning.js";
import { describeObjective, findQuest, questProgress, recordCreatureDefeat } from "../game/quests.js";
import { OllamaProvider } from "../llm/ollama.js";
import { isSmith, notForSaleReason, npcPrice } from "../npc/actions.js";
import {
  armorValue,
  equip,
  equippedWeapon,
  gearLimit,
  isBroken,
  playerGearRank,
  playerSlots,
  repairCost,
  type Slot,
  slotFor,
  SLOTS,
  slotsUsed,
  unequip,
} from "../game/gear.js";
import { NpcAgent } from "../npc/NpcAgent.js";
import { npcSlots, statsOf } from "../npc/state.js";
import { ageOn, atPeak, growthStatus, isReady, xpToNextTier } from "../game/life.js";
import { teachCap } from "../game/training.js";
import { TITLES } from "../game/titles.js";
import { speciesOf } from "../world/species.js";
import { parsePersona } from "../npc/personaSchema.js";
import { SKILLS, skillLevel, TIERS } from "../npc/skills.js";
import type { NpcPersona, TurnResult } from "../npc/types.js";
import {
  BUILDINGS,
  CREATURE_DENS,
  distance,
  isSolid,
  MAP_H,
  MAP_W,
  MINUTES_PER_STEP,
  NPC_SPOTS,
  PLACE_SPOTS,
  placeAtTile,
  PLAYER_START,
  TALK_RANGE,
  TILES,
} from "./map.js";
import { formatMoney } from "../game/money.js";
import { passVillage } from "../game/village.js";
import { currentPlan, describePlan, PLACE_NAMES, PLACE_NEARBY, type PlaceId, workplaceOf } from "../game/schedule.js";
import { Scene, sceneTurn } from "../game/scene.js";
import { describeNpcAppearance, describePlayerAppearance } from "../npc/appearance.js";
import { journalByNpc } from "../game/journal.js";
import { FAVOUR_KINDS, type FavourKind, loanDue } from "../game/favours.js";
import { quoteCommission, balanceDue } from "../game/commissions.js";
import { tradeRecipes } from "../game/crafting.js";
import { todayInfo, describeToday } from "../game/events-calendar.js";
import { fearOf, friendshipOf, holdsGrudge, respectOf } from "../npc/relationship.js";
import { strongestEmotion } from "../npc/emotions.js";
import { OFFERED_SERVICES } from "../game/services.js";

const PORT = Number(process.env.PORT ?? 3000);
const WEB_DIR = fileURLToPath(new URL("../../web/", import.meta.url));
const NPC_DIR = new URL("../data/npcs/", import.meta.url);

// ---- Game setup (same data and rules as the CLI) ----

const ids = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const personas: Record<string, NpcPersona> = Object.fromEntries(
  ids.map((id) => [id, parsePersona(JSON.parse(readFileSync(new URL(`${id}.json`, NPC_DIR), "utf8")), `${id}.json`)]),
);
for (const id of ids) if (!NPC_SPOTS[id]) throw new Error(`NPC "${id}" has no spot on the map (src/web/map.ts).`);

const creatureTemplates = loadCreatureTemplates();
const spawnRules = loadSpawnRules();
const badRules = badSpawnRules(spawnRules, creatureTemplates, Object.keys(CREATURE_DENS));
if (badRules.length > 0) throw new Error(`src/data/spawns.json: ${badRules.join("; ")}`);
const llm = new OllamaProvider();
const deaths = new DeathRegistry(config.deathsFile);
let world: SavedWorld;
let agents: Record<string, NpcAgent>;
/** NPCs who ran off and will be back, by the game hour they return. Not saved. */
const awayUntil: Record<string, number> = {};
/** The creature the player is fighting, if any. Not saved: a restart ends the fight. */
let engaged: string | null = null;
/** Creatures that won't jump the player again until this game minute (after an escape). Not saved. */
const calmUntil: Record<string, number> = {};
/** Game minutes a creature leaves you be after you get away from it. */
const CALM_MINUTES = 30;
let llmReady = false;
let llmError = "";

function startGame(fresh: boolean): void {
  world = fresh
    ? newWorld(personas, creatureTemplates)
    : importDeaths(loadWorld(config.saveFile, personas, creatureTemplates), config.deathsFile);
  world.position ??= { ...PLAYER_START };
  for (const key of Object.keys(awayUntil)) delete awayUntil[key];
  engaged = null;
  for (const key of Object.keys(calmUntil)) delete calmUntil[key];
  news.length = 0;
  agents = Object.fromEntries(ids.map((id) => [id, new NpcAgent(personas[id]!, llm, undefined, world.npcStates[id])]));
  for (const id of ids) {
    const state = agents[id]!.state;
    // A fresh server means nobody is mid-conversation: let fled NPCs come back.
    if (state.outcome === "fled" || state.outcome === "player fled") state.outcome = null;
    if (state.outcome !== "dead") state.conversationOver = false;
    if (world.deaths[id] && state.outcome !== "dead") state.outcome = "dead";
  }
  respawn();
  placeCreatures();
  persist();
}

// ---- Creatures on the map ----

/** Spawn rules (game/spawning.ts): groups that just came due turn up, and ended ones move on. Returns news lines. */
function respawn(): string[] {
  return applySpawnRules(spawnRules, creatureTemplates, world.creatures, (world.spawns ??= {}), world, Math.random, new Set(engaged ? [engaged] : []));
}

/** The den a creature roams: its spawn rule's place, else its kind's. */
function denOf(c: Creature) {
  return CREATURE_DENS[denKey(spawnRules, world.spawns ?? {}, c)];
}

/** Creatures that are on the map now: alive, not run off, and with a known den. */
function presentCreatures(): Creature[] {
  return Object.values(world.creatures).filter((c) => !c.outcome && denOf(c) && creatureTemplates[c.template]);
}

function tileTaken(x: number, y: number, except?: Creature): boolean {
  if (isSolid(x, y)) return true;
  if (world.position && world.position.x === x && world.position.y === y) return true;
  if (ids.some((id) => { const at = npcPos(id); return at !== null && at.x === x && at.y === y; })) return true;
  return presentCreatures().some((c) => c !== except && c.pos?.x === x && c.pos?.y === y);
}

/** Give every creature that lacks one (new, or back from running off) a free tile in its den. */
function placeCreatures(): void {
  for (const c of presentCreatures()) {
    const den = denOf(c)!;
    const inDen = c.pos && c.pos.x >= den.x0 && c.pos.x <= den.x1 && c.pos.y >= den.y0 && c.pos.y <= den.y1;
    if (inDen && !tileTaken(c.pos!.x, c.pos!.y, c)) continue;
    const free: Array<{ x: number; y: number }> = [];
    for (let y = den.y0; y <= den.y1; y++) for (let x = den.x0; x <= den.x1; x++) if (!tileTaken(x, y, c)) free.push({ x, y });
    if (free.length > 0) c.pos = free[Math.floor(Math.random() * free.length)]!;
  }
}

/** Creatures roam a step within their den (not the one fighting the player). */
function wander(): void {
  for (const c of presentCreatures()) {
    if (c.uid === engaged || !c.pos || Math.random() < 0.4) continue;
    const den = denOf(c)!;
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)]!;
    const x = c.pos.x + dx!;
    const y = c.pos.y + dy!;
    if (x < den.x0 || x > den.x1 || y < den.y0 || y > den.y1 || tileTaken(x, y, c)) continue;
    c.pos = { x, y };
  }
}

function persist(): void {
  for (const id of ids) world.npcStates[id] = agents[id]!.state;
  saveWorld(config.saveFile, world);
}

async function checkLlm(): Promise<void> {
  try {
    await llm.warmUp();
    llmReady = true;
    llmError = "";
  } catch (err) {
    llmReady = false;
    llmError = `Could not reach Ollama at ${config.ollamaHost}. Is it running? (${(err as Error).message})`;
  }
}

// ---- Time ----

/** Write a death to the permanent record (once). Natural deaths happen while time passes, not only in fights. */
function recordDeath(id: string): void {
  if (world.deaths[id]) return;
  const s = agents[id]!.state;
  deaths.record({ npcId: id, name: personas[id]!.name, day: world.day, hour: world.hour, killedBy: s.deathCause ?? world.player.name });
  world.deaths[id] = deaths.get(id)!;
}

/** Everyone in the village, for the simulation (game/village.ts). */
const members = () => ids.map((id) => ({ id, persona: personas[id]!, state: agents[id]!.state }));

/**
 * Let `hours` pass for the whole village (N6): NPCs live their hours together (meals at
 * the inn, gossip), creatures age, hunt and roam, and at night bandits deal and raid.
 */
function passHours(hours: number): string[] {
  const start = { day: world.day, hour: world.hour };
  const log = passVillage(members(), world, hours, Math.random);
  for (const id of ids) if (agents[id]!.isDead) recordDeath(id);
  // Creatures live by themselves: they age, hunt, duel and grow. Only the big news reaches the player.
  log.push(...passCreatureTime(creatureTemplates, world.creatures, start, hours, Math.random, DEMO_SPAWNS).filter(isNotable));
  // At night: bandits buy weapons on the sly, and may raid a shop.
  log.push(...passVillageNights(creatureTemplates, world.creatures, members(), world, start, hours, Math.random));
  // Spawn rules go by the clock at the end of this stretch.
  log.push(...applySpawnRules(spawnRules, creatureTemplates, world.creatures, (world.spawns ??= {}), world, Math.random, new Set(engaged ? [engaged] : [])));
  placeCreatures();
  wander();
  for (const [id, until] of Object.entries(awayUntil)) {
    if (absoluteHour(world) >= until) {
      delete awayUntil[id];
      if (agents[id]!.state.outcome === "fled") agents[id]!.state.outcome = null;
      log.push(`${personas[id]!.name} is back.`);
    }
  }
  return log;
}

/** Walking moves the clock a minute at a time; each new hour the village gets an hour of life. */
function walkMinutes(minutes: number): string[] {
  const before = absoluteHour(world);
  advanceMinutes(world, minutes);
  const crossed = absoluteHour(world) - before;
  if (crossed <= 0) return [];
  advanceMinutes(world, -crossed * 60); // passHours moves the clock itself
  return passHours(crossed);
}

/** Where an NPC is (N6), or null when they're not out on the map (asleep, at home, dead or run off). */
function npcPlace(id: string): PlaceId | null {
  const a = agents[id]!;
  if (a.isDead || awayUntil[id] !== undefined) return null;
  const plan = currentPlan(a.persona, a.state, world);
  return plan.activity === "sleep" || plan.place === "home" ? null : plan.place;
}

/** The tile an NPC stands on now: their spot at the place they're at. The dead lie where they fell (their own spot). */
function npcPos(id: string): { x: number; y: number } | null {
  if (agents[id]!.isDead) return NPC_SPOTS[id]!;
  const place = npcPlace(id);
  if (!place) return null;
  return PLACE_SPOTS[place]?.[id] ?? (place === workplaceOf(personas[id]!) ? NPC_SPOTS[id]! : null);
}

/** Why an NPC isn't on the map, for the player, or null if they are. */
function absence(id: string): string | null {
  const a = agents[id]!;
  if (a.isDead) return null;
  if (awayUntil[id] !== undefined) return `${personas[id]!.name} has run off.`;
  if (npcPos(id)) return null;
  return `${personas[id]!.name} is ${describePlan(currentPlan(a.persona, a.state, world))}.`;
}

/** Scenes by place: who said what lately (game/scene.ts). Not saved. */
const scenes: Record<string, Scene> = {};
const sceneAt = (place: string) => (scenes[place] ??= new Scene(place));

/** NPCs at a place now, as agents. */
function presentAt(place: PlaceId | null): NpcAgent[] {
  return place ? ids.filter((id) => npcPlace(id) === place).map((id) => agents[id]!) : [];
}

// ---- Views for the client ----

function npcView(id: string) {
  const persona = personas[id]!;
  const agent = agents[id]!;
  const s = agent.state;
  const spot = npcPos(id);
  const dead = agent.isDead;
  const quests = [...(persona.quests ?? []), ...s.questBoard];
  const byTrust = Math.min(trustCap(s.relationship), teachCap(s, world.player));
  const plan = currentPlan(persona, s, world);
  const feeling = strongestEmotion(s);
  const wares = Object.entries(s.inventory)
    .filter(([, qty]) => qty > 0)
    .map(([item, qty]) => ({ item, qty, price: npcPrice(persona, item) ?? null, reason: notForSaleReason(persona, item) }));
  return {
    id,
    name: persona.name,
    role: persona.role,
    species: speciesOf(persona.species).name.replace(/^an? /, ""),
    age: ageOn(s.life, world.day),
    ageStage: s.life.stage,
    rank: s.life.tier,
    rankXp: Math.floor(s.life.xp),
    rankXpNext: xpToNextTier(s.life.tier),
    potential: s.life.potential,
    atPeak: atPeak(s.life, speciesOf(persona.species)),
    readyToBreakThrough: isReady(s.life, speciesOf(persona.species)),
    growth: growthStatus(s.life, speciesOf(persona.species)),
    titles: s.life.titles.map((t) => TITLES[t.id].name),
    deathCause: s.deathCause,
    gear: { weapon: s.equipment.weapon ?? null, armor: s.equipment.armor ?? null },
    stock: { used: slotsUsed(s.inventory), slots: npcSlots(persona, s), storage: persona.storage?.name ?? null },
    repairs: isSmith(persona),
    x: spot?.x ?? -1,
    y: spot?.y ?? -1,
    color: NPC_SPOTS[id]!.color,
    place: dead ? null : plan.place,
    doing: dead ? "dead" : describePlan(plan),
    absent: absence(id),
    look: describeNpcAppearance(persona, s, world),
    friendship: friendshipOf(s),
    fear: fearOf(s, world.player),
    respect: respectOf(s, world.player),
    affection: s.affection,
    knowsYouAs: s.knownName,
    grudge: holdsGrudge(s, world.day) ? s.grudge!.reason : null,
    feeling: feeling ? `${feeling.kind} (${feeling.about})` : null,
    needs: s.needs,
    makes: tradeRecipes(persona).map((r) => r.output),
    commission: s.commission ? { item: s.commission.item, status: s.commission.status, late: s.commission.late === true, balance: balanceDue(s.commission) } : null,
    loan: loanDue(world.player, id)?.amount ?? null,
    kept: Object.keys(s.keptForPlayer).length > 0,
    services: (persona.services ?? []).filter((x) => OFFERED_SERVICES.includes(x.kind) && x.price !== undefined).map((x) => ({ kind: x.kind, price: x.price })),
    hp: s.hp,
    maxHp: statsOf(persona, s).maxHp,
    mood: s.mood,
    trust: s.relationship,
    dead,
    away: spot === null,
    inCombat: s.inCombat,
    busy: dead ? null : agent.busyWith(world),
    wares,
    teaches: dead
      ? []
      : teachableSkills(persona, world).map((t) => {
          const next = skillLevel(world.player.skills, t.skill) + 1;
          return {
            skill: t.skill,
            upTo: TIERS[t.upTo],
            feePerHour: feePerHour(persona, s, next),
            locked: next > byTrust ? `needs trust ${TRUST_FOR_TIER[next]}` : null,
          };
        }),
    pending: {
      quest: (() => {
        const q = s.pendingQuest ? findQuest(persona, s, s.pendingQuest) : undefined;
        return q ? { title: q.title, tier: q.tier, goal: describeObjective(q), qty: q.objective.qty, money: q.reward.money } : null;
      })(),
      training: s.pendingTraining,
      purchase: s.pendingPurchase,
      offer: s.pendingOffer,
      favour: s.pendingFavour,
      service: s.pendingService,
      amends: s.pendingAmends,
    },
    questCount: quests.length,
  };
}

function snapshot() {
  const p = world.player;
  return {
    llm: { ready: llmReady, error: llmError },
    map: { w: MAP_W, h: MAP_H, tiles: TILES, buildings: BUILDINGS, talkRange: TALK_RANGE },
    time: { text: formatTime(world), day: world.day, hour: world.hour, minute: world.minute ?? 0, timeOfDay: world.timeOfDay, today: describeToday(world), ...todayInfo(world) },
    position: world.position,
    player: {
      name: p.name,
      money: p.money,
      hp: p.hp,
      maxHp: p.maxHp,
      level: p.level,
      rank: rankForLevel(p.level),
      titles: (p.titles ?? []).map((t) => TITLES[t.id].name),
      xp: p.xp,
      xpNext: xpToNextLevel(p.level),
      gear: Object.fromEntries(
        SLOTS.map((slot) => {
          const key = p.equipment?.[slot];
          return [slot, key ? { item: key, broken: isBroken(key), repairCost: repairCost(key) } : null];
        }),
      ),
      fightingWith: equippedWeapon(p).name,
      armorValue: armorValue(p),
      gearTier: playerGearRank(p.level),
      pack: { used: slotsUsed(p.inventory), slots: playerSlots(p) },
      items: Object.entries(p.inventory)
        .filter(([, qty]) => qty > 0)
        .map(([item, qty]) => ({
          item,
          qty,
          slot: slotFor(item),
          needs: slotFor(item) ? gearLimit(playerGearRank(p.level), item, "player") : null,
          repairCost: slotFor(item) ? repairCost(item) : 0,
        })),
      attributes: p.attributes,
      inventory: p.inventory,
      skills: SKILLS.map((s) => {
        const level = skillLevel(p.skills, s);
        return { skill: s, level, tier: TIERS[level], progress: p.skillProgress[s] ?? 0, needed: level < 5 ? hoursToNextLevel(level) : 0 };
      }).filter((s) => s.level > 0 || s.progress > 0),
      quests: p.quests.active.map((q) => ({
        title: q.title,
        tier: q.tier,
        giver: q.giverName,
        // What to bring, or what to beat: "iron ore", "bandits".
        item: q.objective.type === "deliver" ? q.objective.item : describeObjective(q).replace(/^kill or drive off \d+ /, ""),
        qty: q.objective.qty,
        have: questProgress(p, q).have,
        money: q.reward.money,
      })),
      completed: p.quests.completed.length,
      journal: journalByNpc(p, Object.fromEntries(ids.map((id) => [id, personas[id]!.name]))),
      look: describePlayerAppearance(p, world),
      place: p.place ?? null,
    },
    npcs: ids.map(npcView),
    creatures: presentCreatures()
      .filter((c) => c.pos)
      .map((c) => {
        const t = creatureTemplates[c.template]!;
        const species = speciesOf(t.species);
        return {
          uid: c.uid,
          name: c.name,
          kind: t.id,
          x: c.pos!.x,
          y: c.pos!.y,
          color: CREATURE_DENS[c.template]?.color ?? denOf(c)!.color,
          hp: c.hp,
          maxHp: creatureStats(t, c).maxHp,
          rank: c.life.tier,
          age: ageOn(c.life, world.day),
          growth: growthStatus(c.life, species),
          titles: c.life.titles.map((x) => TITLES[x.id].name),
          aggressive: t.aggressive,
          engaged: c.uid === engaged,
        };
      }),
    engaged,
    fight: (() => {
      const left = secondsToAct();
      return left === null ? null : { secondsLeft: Math.round(left * 10) / 10, tick: config.combatTickSeconds };
    })(),
    news: news.slice(-20),
  };
}

// ---- Actions ----

type Emit = (event: Record<string, unknown>) => void;

const rollOf = (message: string) => message.match(/\(rolled[^)]*\)/)?.[0] ?? "";

function npcInRange(id: string): string | null {
  if (agents[id]!.isDead) return `${personas[id]!.name} is dead.`;
  const away = absence(id);
  if (away) return away;
  if (distance(world.position!, npcPos(id)!) > TALK_RANGE) return `You are too far from ${personas[id]!.name}.`;
  return null;
}

/** The conversation happens where the NPC is: that place's description, and who else is there. */
function setScene(id: string): void {
  const place = npcPlace(id) ?? "square";
  world.player.place = place;
  world.location = place === workplaceOf(personas[id]!) ? NPC_SPOTS[id]!.location : PLACE_NAMES[place];
  world.nearby = place === workplaceOf(personas[id]!) ? NPC_SPOTS[id]!.nearby : PLACE_NEARBY[place];
  world.present = presentAt(place).filter((a) => a.persona.id !== id).map((a) => a.persona.id);
  world.sceneLog = sceneAt(place).linesFor(personas[id]!.name);
}

/** One NPC reply, streamed. Records everything the NPC did as events. */
async function npcSpeaks(id: string, emit: Emit, run: (agent: NpcAgent, onText: (delta: string) => void) => Promise<TurnResult>) {
  const agent = agents[id]!;
  const result = await run(agent, (delta) => emit({ t: "text", npc: id, delta }));
  reportTurn(id, result, emit);
}

/** What the NPC did in a turn (and any titles the player earned), as events. */
function reportTurn(id: string, result: TurnResult, emit: Emit): void {
  const name = personas[id]!.name;
  for (const a of result.actions) {
    if (a.name === "attack_player" && a.ok) emit({ t: "note", kind: "combat", text: `${name} attacks. ${a.message.replace(/^You /, "").replace(/\(rolled[^)]*\)\s*/, "")}` });
    else emit({ t: "note", kind: a.ok ? "action" : "fail", text: `${a.name}: ${a.message}` });
  }
  for (const line of result.titles ?? []) emit({ t: "note", kind: "quest", text: line });
  for (const line of result.spoils ?? []) emit({ t: "note", kind: "action", text: line });
}

async function act(body: Record<string, unknown>, emit: Emit): Promise<void> {
  const action = String(body.action ?? "");
  const text = String(body.text ?? "").trim().slice(0, 500);
  const id = String(body.npc ?? "");

  if (action === "hunt" || action === "escape") return creatureAction(action, String(body.creature ?? ""), emit);
  if (action === "equip" || action === "unequip") {
    if (currentFight()) return void emit({ t: "system", text: "Not in the middle of a fight." });
    const p = world.player;
    const r =
      action === "equip"
        ? equip(p, playerGearRank(p.level), String(body.item ?? ""), "player")
        : unequip(p, (String(body.slot) === "armor" ? "armor" : "weapon") as Slot, playerSlots(p));
    return void emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.message });
  }

  if (action === "wait") {
    const fighting = Object.values(agents).some((a) => a.state.inCombat) || (engaged !== null && !world.creatures[engaged]?.outcome);
    if (fighting) return void emit({ t: "system", text: "You can't wait around in the middle of a fight." });
    const hours = Math.max(1, Math.min(24, Math.floor(Number(body.hours ?? 1))));
    for (const line of passHours(hours)) emit({ t: "system", text: line });
    emit({ t: "system", text: `Time passes. It's now ${formatTime(world)}.` });
    return;
  }

  const agent = agents[id];
  if (!agent) return void emit({ t: "error", text: "Unknown character." });
  const name = personas[id]!.name;

  if (action === "open") {
    const problem = npcInRange(id);
    if (problem) return void emit({ t: "system", text: problem });
    // A new conversation starts fresh unless a fight is still going.
    if (!agent.state.inCombat && agent.state.outcome !== "dead") {
      agent.state.conversationOver = false;
      agent.state.outcome = null;
    }
    setScene(id);
    emit({ t: "opened", npc: id });
    // They may speak first (N6.3): a job they gave you, a promise due, a greeting.
    if (!agent.state.inCombat && !agent.busyWith(world) && llmReady) {
      const first = await agent.speakFirst(world, (delta) => emit({ t: "text", npc: id, delta }));
      if (first) {
        sceneAt(npcPlace(id) ?? "square").record(personas[id]!.name, first.text);
        reportTurn(id, first, emit);
      }
    }
    return;
  }

  if (action === "look") {
    const problem = npcInRange(id);
    if (problem) return void emit({ t: "system", text: problem });
    return void emit({ t: "note", kind: "action", text: describeNpcAppearance(agent.persona, agent.state, world) });
  }

  const problem = npcInRange(id);
  if (problem) return void emit({ t: "system", text: problem });
  setScene(id);

  // A busy NPC can't be interacted with. Turning in quests and waiting are free.
  const busy = agent.busyWith(world);
  if (busy) return void emit({ t: "system", text: `${name} is busy ${busy}. Try waiting.` });
  if (agent.state.conversationOver) return void emit({ t: "ended", npc: id, text: `${name} has nothing more to say.` });

  const p = world.player;
  switch (action) {
    case "say": {
      if (!text) return;
      // A group scene (N6.5): others here may chime in, at most one a turn.
      const place = npcPlace(id);
      const here = presentAt(place).filter((a) => distance(world.position!, npcPos(a.persona.id)!) <= TALK_RANGE * 3);
      if (here.length <= 1 || agent.state.inCombat) {
        await npcSpeaks(id, emit, (a, on) => a.respond(text, world, on));
        sceneAt(place ?? "square").record(p.name, text);
        break;
      }
      const turn = await sceneTurn(sceneAt(place!), here, agent, text, world, Math.random, (who, delta) => emit({ t: "text", npc: who, delta }));
      reportTurn(id, turn.addressed.result, emit);
      if (turn.interjection) reportTurn(turn.interjection.id, turn.interjection.result, emit);
      if (turn.vouched) emit({ t: "note", kind: "action", text: `${turn.vouched} put in a good word for you.` });
      break;
    }
    case "introduce":
      await npcSpeaks(id, emit, (a, on) => a.introduceSelf(world, on));
      break;
    case "lie":
      if (!text) return void emit({ t: "system", text: "Say what you claim." });
      await npcSpeaks(id, emit, (a, on) =>
        a.hearLie(text, world, on, (r) => emit({ t: "note", kind: "roll", text: r.ok ? `Lie ${r.believed ? "believed" : "spotted"} (${r.roll})` : r.message })),
      );
      break;
    case "give":
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.receiveGift(String(body.what ?? text), world, on);
        emit({ t: "note", kind: r.gift.ok ? "action" : "fail", text: r.gift.message });
        return r;
      });
      break;
    case "ask": {
      const kind = String(body.favour ?? "") as FavourKind;
      if (!FAVOUR_KINDS.includes(kind)) return void emit({ t: "system", text: "Unknown favour." });
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.askFavour(kind, world, body.item ? String(body.item) : undefined, on);
        emit({ t: "note", kind: r.favour.ok ? "action" : "fail", text: r.favour.ok ? `Offered: ${r.favour.message}` : r.favour.message });
        return r;
      });
      break;
    }
    case "repay":
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.repay(world, on);
        emit({ t: "note", kind: r.repay.ok ? "action" : "fail", text: r.repay.message });
        return r;
      });
      break;
    case "retrieve": {
      const r = agent.retrieve(world);
      emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.message });
      break;
    }
    case "commission": {
      const item = String(body.item ?? "");
      const quote = quoteCommission(agent.persona, agent.state, world, item);
      if (!quote.ok || !body.confirm) return void emit({ t: "quote", kind: "commission", ok: quote.ok, text: quote.message, item });
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.commission(item, world, on);
        emit({ t: "note", kind: r.order.ok ? "action" : "fail", text: r.order.ok ? `Ordered: ${r.order.message}` : r.order.message });
        return r;
      });
      break;
    }
    case "collect":
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.collect(world, on);
        emit({ t: "note", kind: r.collect.ok ? "action" : "fail", text: r.collect.message });
        return r;
      });
      break;
    case "persuade":
    case "intimidate": {
      const kind = action;
      await npcSpeaks(id, emit, (a, on) =>
        a.attempt(kind, text || (kind === "persuade" ? "Please, hear me out." : "You'd better listen."), world, on, (r) =>
          emit({ t: "note", kind: "roll", text: r.ok ? `${kind} ${r.success ? "succeeded" : "failed"} ${rollOf(r.message)}` : r.message }),
        ),
      );
      break;
    }
    case "haggle":
      await npcSpeaks(id, emit, (a, on) =>
        a.haggle(text || "Can you do better on the price?", world, on, (r) =>
          emit({ t: "note", kind: "roll", text: r.ok ? `haggle ${r.success ? "succeeded" : "failed"} ${rollOf(r.message)}` : r.message }),
        ),
      );
      break;
    case "attack":
      await npcSpeaks(id, emit, (a, on) =>
        a.attackedByPlayer(world, on, (r) => emit({ t: "note", kind: "combat", text: `You ${r.damage > 0 ? `hit for ${r.damage}` : "miss"} ${rollOf(r.message)}` })),
      );
      break;
    case "flee":
      await npcSpeaks(id, emit, (a, on) =>
        a.playerFlees(world, on, (r) => emit({ t: "note", kind: "roll", text: r.ok ? `flee ${r.escaped ? "succeeded" : "failed"} ${rollOf(r.message)}` : r.message })),
      );
      break;
    case "turnin":
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.turnIn(world, on);
        emit({
          t: "note",
          kind: r.turnIn.completed.length > 0 ? "quest" : "fail",
          text: r.turnIn.completed.length > 0 ? `Quest complete: ${r.turnIn.completed.map((q) => q.title).join(", ")}. You are level ${p.level}, ${formatMoney(p.money)}.${(r.turnIn.titles ?? []).map((l) => ` ${l}`).join("")}` : r.turnIn.message,
        });
        return r;
      });
      break;
    case "repair": {
      const which = String(body.which ?? "");
      await npcSpeaks(id, emit, (a, on) =>
        a.repair(which, world, on, (r) => emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.ok ? `Repaired for ${formatMoney(r.cost)}.` : r.message })),
      );
      break;
    }
    case "train": {
      const skill = parseSkill(String(body.skill ?? ""));
      const hours = Math.max(1, Math.min(MAX_SESSION_HOURS, Math.floor(Number(body.hours ?? DEFAULT_SESSION_HOURS))));
      if (!skill) return void emit({ t: "system", text: "Unknown skill." });
      const quote = quoteTraining(personas[id]!, agent.state, world, skill, hours);
      if (!quote.ok) return void emit({ t: "system", text: quote.message });
      await npcSpeaks(id, emit, (a, on) =>
        a.train(skill, hours, world, on, (r) =>
          emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.ok ? `Trained ${r.hoursSpent}h${r.levelsGained ? ", level up!" : ""}. Now ${formatTime(world)}.${r.npcNote ? ` ${r.npcNote}` : ""}` : r.message }),
        ),
      );
      break;
    }
    case "accept":
    case "decline": {
      const yes = action === "accept";
      const kind = String(body.kind ?? "");
      if (kind === "quest")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineQuest(world, on);
          const r = await a.acceptQuest(world, on);
          emit({ t: "note", kind: "quest", text: r.quest ? `Quest accepted: ${r.quest}` : "That job is no longer available." });
          // A defeat quest may bring its quarry out (spawn rules).
          for (const text of respawn()) emit({ t: "note", kind: "quest", text });
          placeCreatures();
          return r;
        });
      else if (kind === "training")
        await npcSpeaks(id, emit, (a, on) =>
          yes
            ? a.acceptTraining(world, on, (r) => emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.ok ? `Trained ${r.hoursSpent}h${r.levelsGained ? ", level up!" : ""}. Now ${formatTime(world)}.` : r.message }))
            : a.declineTraining(world, on),
        );
      else if (kind === "purchase")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declinePurchase(world, on);
          const r = await a.acceptPurchase(world, on);
          emit({ t: "note", kind: r.sale.ok ? "action" : "fail", text: `${r.sale.message} You have ${formatMoney(p.money)}.` });
          return r;
        });
      else if (kind === "offer")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineOffer(world, on);
          const r = await a.acceptOffer(world, on);
          emit({ t: "note", kind: r.sale.ok ? "action" : "fail", text: r.sale.message });
          return r;
        });
      else if (kind === "favour")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineFavour(world, on);
          const r = await a.acceptFavour(world, on);
          emit({ t: "note", kind: r.favour.ok ? "action" : "fail", text: r.favour.message });
          return r;
        });
      else if (kind === "amends")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineAmends(world, on);
          const r = await a.acceptAmends(world, on);
          emit({ t: "note", kind: r.amends.ok ? "action" : "fail", text: r.amends.message });
          return r;
        });
      else if (kind === "service") {
        let sleep = 0;
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineService(world, on);
          const r = await a.acceptService(world, on);
          emit({ t: "note", kind: r.service.ok ? "action" : "fail", text: r.service.message });
          sleep = r.service.sleepHours ?? 0;
          return r;
        });
        // A room for the night: the village lives on while you sleep.
        if (sleep > 0) {
          for (const line of passHours(sleep)) emit({ t: "system", text: line });
          emit({ t: "ended", npc: id, text: `You wake at ${formatTime(world)}, rested (${p.hp}/${p.maxHp} HP).` });
        }
      }
      break;
    }
    default:
      return void emit({ t: "error", text: `Unknown action "${action}".` });
  }

  afterTurn(id, emit);
}

/** Deaths, knockouts and runaways: the consequences that outlive one reply. */
function afterTurn(id: string, emit: Emit): void {
  const agent = agents[id]!;
  const name = personas[id]!.name;
  const s = agent.state;

  if (agent.isDead) {
    recordDeath(id);
    const text =
      s.deathCause === "old age"
        ? `${name} is gone, taken by old age. They won't be coming back.`
        : `${name} falls and doesn't get up. They're dead, and they won't be coming back.`;
    emit({ t: "ended", npc: id, text });
  } else if (s.outcome === "knocked out") {
    // Same as the CLI: you come round hours later, healed, and the fight is over.
    for (const line of passHours(config.knockoutRecoveryHours)) emit({ t: "system", text: line });
    world.player.hp = world.player.maxHp;
    s.inCombat = false;
    s.outcome = null;
    s.conversationOver = false;
    emit({ t: "ended", npc: id, text: `You were knocked out. You wake after ${config.knockoutRecoveryHours} hours of rest. It is now ${formatTime(world)}.` });
  } else if (s.outcome === "player fled") {
    s.outcome = null;
    s.conversationOver = false;
    emit({ t: "ended", npc: id, text: `You get away from ${name}.` });
  } else if (s.outcome === "fled") {
    awayUntil[id] = absoluteHour(world) + 2;
    emit({ t: "ended", npc: id, text: `${name} runs off into the village.` });
  } else if (s.conversationOver) {
    emit({ t: "ended", npc: id, text: `${name} goes back to work.` });
  }
}

function move(dx: number, dy: number): { ok: boolean; log: string[]; reason?: string } {
  const pos = world.position!;
  const nx = pos.x + Math.sign(dx);
  const ny = pos.y + Math.sign(dy);
  if (Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, log: [], reason: "One step at a time." };
  if (Object.values(agents).some((a) => a.state.inCombat && !a.isDead)) return { ok: false, log: [], reason: "You can't walk away from a fight. Flee or fight on." };
  if (engaged && world.creatures[engaged] && !world.creatures[engaged]!.outcome) {
    return { ok: false, log: [], reason: `You're fighting ${world.creatures[engaged]!.name}. Fight (F) or run (R).` };
  }
  engaged = null;
  if (isSolid(nx, ny)) return { ok: false, log: [] };
  if (ids.some((id) => { const at = npcPos(id); return at !== null && at.x === nx && at.y === ny; })) return { ok: false, log: [] };
  if (presentCreatures().some((c) => c.pos?.x === nx && c.pos?.y === ny)) return { ok: false, log: [] };
  pos.x = nx;
  pos.y = ny;
  world.player.place = placeAtTile(pos) as PlaceId;
  const log = walkMinutes(MINUTES_PER_STEP);
  // Wolves and bandits jump anyone who comes close.
  const lurker = presentCreatures().find(
    (c) =>
      creatureTemplates[c.template]!.aggressive &&
      c.pos &&
      distance(pos, c.pos) <= TALK_RANGE &&
      (calmUntil[c.uid] ?? -1) <= absoluteMinute(world),
  );
  if (lurker) {
    engaged = lurker.uid;
    log.push(...afterCreatureRound(lurker, creatureAmbush(creatureTemplates[lurker.template]!, lurker, world, Math.random)));
  }
  return { ok: true, log };
}

/** What a creature fight round means for the game: end the fight, or knock the player out. Returns lines for the player. */
function afterCreatureRound(c: Creature, round: CreatureRound): string[] {
  const log = [...round.log];
  // Killing or routing it counts towards defeat quests for its kind.
  if (round.over === "creature dead" || round.over === "creature fled") log.push(...recordCreatureDefeat(world.player, c.template));
  if (round.over === "player fled") calmUntil[c.uid] = absoluteMinute(world) + CALM_MINUTES;
  if (round.over && round.over !== "player down") engaged = null;
  if (round.over === "player down") {
    engaged = null;
    const defeat = creatureBeatsPlayer(creatureTemplates[c.template]!, c, world);
    log.push(defeat.message);
    if (defeat.hoursOut > 0) log.push(...passHours(defeat.hoursOut));
  }
  return log;
}

/** The player attacks a creature next to them, or tries to get away from one. No model involved. */
function creatureAction(action: "hunt" | "escape", uid: string, emit: Emit): void {
  const c = world.creatures[uid];
  const t = c && creatureTemplates[c.template];
  if (!c || !t || c.outcome || !c.pos) return void emit({ t: "system", text: "There's nothing there to fight." });
  if (distance(world.position!, c.pos) > TALK_RANGE) return void emit({ t: "system", text: `You are too far from ${c.name}.` });
  if (action === "escape" && engaged !== uid) return void emit({ t: "system", text: `You're not fighting ${c.name}.` });
  engaged = uid;
  const round = action === "hunt" ? fightCreature(t, c, world, Math.random) : fleeCreature(t, c, world, Math.random);
  const lines = afterCreatureRound(c, round);
  lines.push(...walkMinutes(config.turnMinutes.fight));
  // Notes land once in the side feed when no conversation is open.
  for (const text of lines) emit({ t: "note", kind: "combat", text });
}

// ---- The combat clock ----

/**
 * In a fight the player has config.combatTickSeconds to act. If they don't, the
 * turn is a no-op for them and the opponent strikes (in code, no model). What
 * happens goes into `news`, which the client polls during fights.
 */
let lastPlayerAction = Date.now();
let newsId = 0;
const news: Array<Record<string, unknown> & { id: number }> = [];
const NEWS_KEPT = 50;

function pushNews(event: Record<string, unknown>): void {
  news.push({ ...event, id: ++newsId });
  if (news.length > NEWS_KEPT) news.shift();
}

/** Who the player is fighting: an NPC id, a creature uid, or null. */
function currentFight(): { npc: string } | { creature: string } | null {
  const npc = ids.find((id) => agents[id]!.state.inCombat && !agents[id]!.isDead);
  if (npc) return { npc };
  if (engaged && world.creatures[engaged] && !world.creatures[engaged]!.outcome) return { creature: engaged };
  return null;
}

/** Seconds the player has left to act in the current fight, or null when there's no clock. */
function secondsToAct(): number | null {
  if (config.combatTickSeconds <= 0 || !currentFight()) return null;
  return Math.max(0, config.combatTickSeconds - (Date.now() - lastPlayerAction) / 1000);
}

/** The player didn't act in time: their turn passes and the opponent strikes. */
function combatTick(): void {
  const fight = currentFight();
  if (!fight || working || config.combatTickSeconds <= 0) return;
  if (Date.now() - lastPlayerAction < config.combatTickSeconds * 1000) return;
  lastPlayerAction = Date.now();
  if ("npc" in fight) {
    pushNews({ t: "note", kind: "combat", npc: fight.npc, text: "You hesitate." });
    const emit: Emit = (event) => pushNews({ npc: fight.npc, ...event });
    reportTurn(fight.npc, agents[fight.npc]!.playerHesitates(world), emit);
    afterTurn(fight.npc, emit);
  } else {
    const c = world.creatures[fight.creature]!;
    const lines = afterCreatureRound(c, creatureTurn(creatureTemplates[c.template]!, c, world, Math.random));
    lines.push(...walkMinutes(config.turnMinutes.fight));
    for (const text of lines) pushNews({ t: "note", kind: "combat", text });
  }
  persist();
}

setInterval(combatTick, 250);

// ---- HTTP ----

/** One thing at a time: a model reply must finish before the next action starts. */
let working = false;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) reject(new Error("Body too large."));
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(url: string, res: ServerResponse): void {
  const path = url === "/" ? "/index.html" : decodeURIComponent(url);
  const file = normalize(join(WEB_DIR, path));
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0]!;
  try {
    if (req.method === "GET" && url === "/api/state") {
      // Fight polling (?poll=1) skips the model check so it stays fast.
      const polling = new URL(req.url!, "http://x").searchParams.has("poll");
      if (!llmReady && !working && !polling) await checkLlm();
      return json(res, 200, snapshot());
    }

    if (req.method === "GET" && url === "/api/quote") {
      const q = new URL(req.url!, "http://x").searchParams;
      const id = q.get("npc") ?? "";
      const skill = parseSkill(q.get("skill") ?? "");
      if (!personas[id] || !skill) return json(res, 400, { ok: false, message: "Unknown NPC or skill." });
      const hours = Math.max(1, Math.min(MAX_SESSION_HOURS, Number(q.get("hours") ?? DEFAULT_SESSION_HOURS)));
      const quote = quoteTraining(personas[id]!, agents[id]!.state, world, skill, hours);
      return json(res, 200, { ...quote, money: world.player.money });
    }

    if (req.method === "POST" && url === "/api/move") {
      if (working) return json(res, 409, { ok: false, reason: "Busy." });
      lastPlayerAction = Date.now();
      const body = await readBody(req);
      const result = move(Number(body.dx ?? 0), Number(body.dy ?? 0));
      if (result.ok) persist();
      return json(res, 200, { ...result, state: snapshot() });
    }

    if (req.method === "POST" && url === "/api/new") {
      if (working) return json(res, 409, { ok: false, reason: "Busy." });
      startGame(true);
      return json(res, 200, { state: snapshot() });
    }

    if (req.method === "POST" && url === "/api/act") {
      if (working) return json(res, 409, { error: "Another action is still running." });
      const body = await readBody(req);
      working = true;
      lastPlayerAction = Date.now(); // acting (or a reply streaming) uses up the turn's clock
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      const emit: Emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      try {
        // Waiting, opening a chat and fighting creatures need no model.
        const offline = ["wait", "open", "hunt", "escape", "equip", "unequip", "look", "retrieve"].includes(String(body.action));
        if (!llmReady && !offline) await checkLlm();
        if (!llmReady && !offline) emit({ t: "error", text: llmError });
        else await act(body, emit);
        persist();
      } catch (err) {
        emit({ t: "error", text: (err as Error).message });
      } finally {
        working = false;
        lastPlayerAction = Date.now(); // the clock for the next turn starts once the reply is done
        emit({ t: "done", state: snapshot() });
        res.end();
      }
      return;
    }

    if (req.method === "GET") return serveStatic(url, res);
    res.writeHead(405).end();
  } catch (err) {
    if (!res.headersSent) json(res, 500, { error: (err as Error).message });
    else res.end();
  }
});

startGame(process.argv.includes("--new"));
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Millbrook is open at http://localhost:${PORT}`);
});
console.log(`Loading ${config.model}...`);
await checkLlm();
console.log(llmReady ? "Model ready." : `Warning: ${llmError}\nThe map works, but NPCs can't talk until Ollama is running.`);
