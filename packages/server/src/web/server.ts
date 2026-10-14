import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
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
import { passVillageNights } from "../game/underworld.js";
import { rankForLevel, xpToNextLevel } from "../game/levels.js";
import { SaveMismatchError, saveWorld, type SavedWorld } from "../game/save.js";
import { openWorld } from "../game/openWorld.js";
import { acquireSaveLock } from "../store/lock.js";
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
import { denKey } from "../game/spawning.js";
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
import { SKILLS, skillLevel, TIERS } from "../npc/skills.js";
import type { NpcPersona, TurnResult } from "../npc/types.js";
import { AREA_WALK_MINUTES, CREATURE_COLORS, distance, MINUTES_PER_STEP, PLAYER_START, spriteColor, TALK_RANGE } from "./map.js";
import { bornAge, bornKids, describeFamily, familyOf, propose, spouseOf } from "../game/family.js";
import { romanceStageFor } from "../npc/relationship.js";
import { formatMoney } from "../game/money.js";
import { passVillage } from "../game/village.js";
import { type AreaId, areaOfPlace, currentPlan, describePlan, PLACE_NAMES, type PlaceId, workplaceOf } from "../game/schedule.js";
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
import { Town } from "../game/town.js";
import { WorldStore } from "../game/db.js";
import { pickEmbedder } from "../game/embeddings.js";
import { OllamaEmbedder } from "../llm/ollama.js";
import { forage, playerCraft } from "../game/gathering.js";
import { destinations } from "../game/realm/travel.js";
import { roadDataOf } from "../game/road/generateRoads.js";
import { shortestWay, WALK_PACE } from "@millbrook/shared";
import { topUp } from "../game/road/needs.js";
import { areaWords, DEN_COLORS, exitTo, exitUnder, PLAIN_VILLAGE, siteMap, type SiteMap } from "./sites.js";
import { ongoing } from "../game/realm/diplomacy.js";
import { realmView } from "../game/realm/view.js";
import { dungeonsInReach, GUILD_FEE, guildRank, inGuild, joinGuild, mouthOf, playerDelve } from "../game/realm/wilds.js";
import { lootBody } from "../game/loot.js";
import { sneak } from "../game/stealth.js";
import { bountyOf, openCrimes, payFine, surrender } from "../game/crime.js";
import { describeStandings, describeFactionView, joinFaction } from "../game/factions.js";
import { describeReputation } from "../game/reputation.js";
import { raiseAttribute } from "../npc/growth.js";
import { ABILITIES, abilitiesFor, parseAbility } from "../game/abilities.js";
import { dismiss } from "../game/party.js";
import { describeStatuses } from "../game/status.js";
import { visibleHealth } from "../game/health.js";
import { describeArcs } from "../npc/arcs.js";
import { CrowdSim, type CrowdDay, WANDER_MINUTES, DEFAULT_VOICE, MAX_SPEAK_CHARS, speakable, type GameEvent, type NewsItem, type NpcView, type Pos, type Snapshot, type StreamEvent } from "@millbrook/shared";
import type { AppliedAction } from "../npc/types.js";
import { ActionQueue } from "./queue.js";
import { captureFrame, turnEvents } from "../game/turnEvents.js";
import { setUpVoice } from "../voice/tts.js";
import { parseTownsfolkId } from "../game/realm/townsfolk.js";
import { weatherOn } from "../game/weather.js";
import { townEventsOn } from "../game/events-calendar.js";
import type { AdminContext } from "../admin/context.js";
import { timed } from "../metrics/timing.js";
import { adminAllowed, handleAdmin, refuseAdmin } from "./routes/admin.js";

const PORT = Number(process.env.PORT ?? 3000);
// The browser game, built by `npm run build` (packages/client). `npm run dev` serves it from Vite instead.
const WEB_DIR = fileURLToPath(new URL("../../../client/dist/", import.meta.url));

// ---- Game setup (same data and rules as the CLI) ----

/** Everyone who talks, by id: made by the game as the player meets them (game/talkers.ts), and kept by the town. Nothing is hand-written. */
let ids: string[] = [];
const personas: Record<string, NpcPersona> = {};
/** An NPC's own spot on the map (where they work), or null when their workplace is on another map (N15). */
const ownSpot = (id: string) => here().npcSpot(id, workplaceOf(personas[id]!));
/** An NPC's sprite colour, wherever they are. */
const npcColor = (id: string) => {
  const sim = parseTownsfolkId(id) ? crowd : null;
  const i = sim?.index.get(id);
  if (sim && i !== undefined) return sim.roster.people[i]!.color;
  return ownSpot(id)?.color ?? spriteColor(id);
};
/** The settlement the player is at (N14), or a plain village when there's no realm. */
const siteInfo = () => (world.realm?.settlements[town.site()] ?? PLAIN_VILLAGE);
/** The map the player is on (N14, N15): the village of the place they're at, or one of its localities. */
const here = (): SiteMap => siteMap(siteInfo(), town.area(), world.realm);
/** Who's about where the player is: the talkers of this place, and whoever travels with them. */
const local = (): string[] => (town.road.onRoad() ? town.road.travellersNear().filter((id) => agents[id]) : town.localIds());

// ---- The townsfolk (N16) ----

/** The simulation of the townsfolk of the village the player is in: one at a time, made again on a new map. */
let crowd: CrowdSim | null = null;
/** The townsfolk of the village the player is in, or null (a locality, no realm). */
function crowdHere(): CrowdSim | null {
  const realm = world.realm;
  if (!realm || town.area() !== "village" || town.road.onRoad()) return null;
  const map = here();
  const roster = town.rosterAt(town.site(), map, world.day);
  if (!roster) return null;
  if (!crowd || crowd.map.id !== map.id || crowd.roster.people !== roster.people) crowd = new CrowdSim({ id: map.id, w: map.w, h: map.h, tiles: map.tiles, buildings: map.buildings, zones: map.zones }, roster);
  else crowd.roster = roster;
  return crowd;
}
/** Today's conditions, for where the townsfolk go. */
const crowdDay = (): CrowdDay => ({ weather: weatherOn(world.day), festival: townEventsOn(world).includes("festival") });
const minuteOfDay = () => world.hour * 60 + (world.minute ?? 0);
/** Where one of the townsfolk is now, or null if they're not of this village. */
function townsfolkAt(id: string) {
  const sim = crowdHere();
  const i = sim?.index.get(id);
  if (!sim || i === undefined) return null;
  return sim.at(sim.roster.people[i]!, world.day, minuteOfDay(), crowdDay());
}
/** Where the townsfolk who were killed or knocked out lie (not saved: after a restart, outside their door). */
const fallen: Record<string, Pos> = {};
/** The NPC the player last spoke to, and when (game minute): they don't wander off mid-conversation. */
let lastTalk: { id: string; minute: number } | null = null;
const TALK_HOLD_MINUTES = 15;

const creatureTemplates = loadCreatureTemplates();
const llm = new OllamaProvider();
// The long-term store (SQLite): every event, summaries for recall by meaning, the director's log.
const store = new WorldStore(config.dbFile, await pickEmbedder(new OllamaEmbedder()));
let world: SavedWorld;
let agents: Record<string, NpcAgent>;
let town: Town;
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
/** The tiles the player just walked off, newest first: companions walk in their footsteps. Not saved. */
const trail: Pos[] = [];
const TRAIL_KEPT = 4;
/** Every NPC tool call in the current request, for the attack events (T13). */
let turnActions: AppliedAction[] = [];
// NPC voices (T14): Piper if it's set up, else the browser speaks.
const voice = await setUpVoice(config.voice);

function startGame(fresh: boolean): void {
  // The world and its database come as a pair (N18): a new one starts from an empty database and every place's people are rolled into it.
  const opened = openWorld({ file: config.saveFile, deathsFile: config.deathsFile, templates: creatureTemplates, store, fresh });
  world = opened.world;
  if (opened.notice) console.log(opened.notice);
  world.position ??= { ...PLAYER_START };
  crowd = null;
  lastTalk = null;
  for (const key of Object.keys(fallen)) delete fallen[key];
  for (const key of Object.keys(awayUntil)) delete awayUntil[key];
  engaged = null;
  trail.length = 0;
  for (const key of Object.keys(calmUntil)) delete calmUntil[key];
  news.length = 0;
  town?.close();
  // People met in another world don't belong in this one: the town fills this from the world's own talkers.
  for (const id of Object.keys(personas)) delete personas[id];
  town = new Town({ personas, creatureTemplates, world, llm, backgroundLlm: new OllamaProvider(), store });
  agents = town.agents;
  ids = town.ids;
  // Today's plans, made off-screen in the background (never in the player's way).
  if (config.planning) town.queuePlans();
  for (const id of ids) {
    const state = agents[id]!.state;
    // A fresh server means nobody is mid-conversation: let fled NPCs come back.
    if (state.outcome === "fled" || state.outcome === "player fled") state.outcome = null;
    if (state.outcome !== "dead") state.conversationOver = false;
    if (world.deaths[id] && state.outcome !== "dead") state.outcome = "dead";
  }
  respawn();
  placeCreatures();
  // Maps grow with their places (N16): a position from an older, smaller map may be in a wall now.
  const pos = world.position!;
  if (pos.x < 0 || pos.y < 0 || pos.x >= here().w || pos.y >= here().h || here().isSolid(pos.x, pos.y)) world.position = { ...here().start };
  persist();
}

// ---- Creatures on the map ----

/** Spawn rules (game/spawning.ts): groups that just came due turn up, and ended ones move on. Returns news lines. */
function respawn(): string[] {
  return town.respawn(engaged ? [engaged] : []);
}

/** The den key a creature roams: its own (another place's beasts and outlaws), its spawn rule's place, else its kind's. */
const denKeyOf = (c: Creature) => c.den ?? denKey(town.rules(), town.siteHere().spawns, c);

/** The den a creature roams on the map the player is on, or undefined if it's elsewhere (N15). */
function denOf(c: Creature) {
  return here().dens[denKeyOf(c)];
}

/** A creature by uid: where the player is. */
const creatureById = (uid: string): Creature | undefined => town.creaturesHere()[uid];

/**
 * Creatures that are on the map now: alive, not run off, and with their den on this
 * map: the place's own, with the beasts of its woods and the outlaws of its camp as the
 * realm has them (N15, game/realm/haunts.ts).
 */
function presentCreatures(): Creature[] {
  if (town.road.onRoad()) return [];
  return Object.values(town.creaturesHere()).filter((c) => !c.outcome && (following(c) || denOf(c)) && creatureTemplates[c.template]);
}

/** Creatures following the player (escorts): they don't go back to their den or wander. */
const following = (c: Creature) => town.escorted().has(c.uid);

function tileTaken(x: number, y: number, except?: Creature): boolean {
  if (here().isSolid(x, y)) return true;
  if (world.position && world.position.x === x && world.position.y === y) return true;
  if (local().some((id) => { const at = npcPos(id); return at !== null && at.x === x && at.y === y; })) return true;
  return presentCreatures().some((c) => c !== except && c.pos?.x === x && c.pos?.y === y);
}

/** Give every creature that lacks one (new, or back from running off) a free tile in its den. */
function placeCreatures(): void {
  for (const c of presentCreatures()) {
    if (following(c) && c.pos) continue;
    const den = denOf(c);
    if (!den) continue;
    const inDen = c.pos && c.pos.x >= den.x0 && c.pos.x <= den.x1 && c.pos.y >= den.y0 && c.pos.y <= den.y1;
    if (inDen && !tileTaken(c.pos!.x, c.pos!.y, c)) continue;
    const free: Array<{ x: number; y: number }> = [];
    for (let y = den.y0; y <= den.y1; y++) for (let x = den.x0; x <= den.x1; x++) if (!tileTaken(x, y, c)) free.push({ x, y });
    if (free.length > 0) c.pos = free[Math.floor(Math.random() * free.length)]!; // real time, not simulation: where a beast stands on screen
  }
}

/** Creatures roam a step within their den (not the one fighting the player). Real time, not simulation: the rolls are for the screen only. */
function wander(): void {
  for (const c of presentCreatures()) {
    if (c.uid === engaged || !c.pos || following(c) || Math.random() < 0.4) continue;
    const den = denOf(c);
    if (!den) continue;
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)]!;
    const x = c.pos.x + dx!;
    const y = c.pos.y + dy!;
    if (x < den.x0 || x > den.x1 || y < den.y0 || y > den.y1 || tileTaken(x, y, c)) continue;
    c.pos = { x, y };
  }
}

function persist(): void {
  timed("persist", () => {
    for (const id of ids) world.npcStates[id] = agents[id]!.state;
    saveWorld(config.saveFile, world, store);
  });
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
  town.recordDeath(id);
}

/**
 * Let `hours` pass for the whole village (N6): NPCs live their hours together (meals at
 * the inn, gossip), creatures age, hunt and roam, and at night bandits deal and raid.
 */
function passHours(hours: number): string[] {
  return timed("passHours", () => passHoursNow(hours));
}

function passHoursNow(hours: number): string[] {
  // The village, creatures, the night's dealings and raids, spawns, then the consequences (game/town.ts).
  // What was said becomes memories (SQLite, recalled by meaning).
  for (const id of ids) town.summarise(id);
  const log = town.passHours(hours, { keep: engaged ? [engaged] : [] });
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
  if (awayUntil[id] !== undefined) return null;
  return town.placeOf(id);
}

/**
 * The tile an NPC stands on now: their spot at the place they're at, if that place is
 * on the map the player is on (N15). The dead lie where they fell (their own spot).
 */
function npcPos(id: string): { x: number; y: number } | null {
  // On the road (N26): a traveller is where their journey has them, and the dead lie where they fell.
  if (parseTownsfolkId(id) && town.road.onRoad()) return town.whereNow(id) ? town.road.travellerPos(id) : null;
  if (agents[id]!.state.dormant || !local().includes(id)) return null;
  // The townsfolk (N16) are where the crowd's day has them; the fallen lie where they fell.
  if (parseTownsfolkId(id)) {
    const at = townsfolkAt(id);
    if (agents[id]!.isDead || agents[id]!.state.outcome === "unconscious") {
      if (!fallen[id] && at) fallen[id] = { x: at.x, y: at.y };
      return fallen[id] ?? null;
    }
    delete fallen[id];
    return at?.visible ? { x: at.x, y: at.y } : null;
  }
  if (agents[id]!.isDead || agents[id]!.state.outcome === "unconscious") return ownSpot(id);
  const place = npcPlace(id);
  if (!place || !here().places.includes(place)) return null;
  // A companion out with the player walks a step or two behind them (N8.2), in their footsteps.
  const comp = agents[id]!.state.companion && !agents[id]!.state.inCombat && place === world.player.place ? companionSpot(id) : null;
  if (comp) return comp;
  const base = here().spotAt(place, id) ?? (place === workplaceOf(personas[id]!) ? ownSpot(id) : null);
  if (!base) return null;
  // Nobody stands frozen to one tile all day (N16): a step or two about their spot, every few minutes;
  // but not while fighting, or while the player is talking to them.
  const talking = lastTalk?.id === id && absoluteMinute(world) - lastTalk.minute <= TALK_HOLD_MINUTES;
  if (talking || agents[id]!.state.inCombat || agents[id]!.state.companion) return base;
  const k = Math.floor(absoluteMinute(world) / WANDER_MINUTES);
  return here().wanderSpot(place, id, k, (x, y) => (world.position?.x === x && world.position?.y === y) || presentCreatures().some((c) => c.pos?.x === x && c.pos?.y === y)) ?? base;
}

/** Where a companion stands: the nth tile of the player's trail, n by their order in the party. */
function companionSpot(id: string): Pos | null {
  const order = ids.filter((x) => agents[x]!.state.companion && !agents[x]!.isDead).indexOf(id);
  const spot = trail[order];
  if (!spot || (spot.x === world.position!.x && spot.y === world.position!.y)) return null;
  return spot;
}

/** A place's name where the player is, in the words of the place they are in. */
function placeName(place: PlaceId): string {
  if (!world.realm) return PLACE_NAMES[place];
  const area = areaOfPlace(place);
  return area === "village" ? siteMap(siteInfo(), "village", world.realm).placeWords(place).location : areaWords(world.realm, siteInfo(), area).location;
}

/** Why an NPC isn't on the map, for the player, or null if they are. */
function absence(id: string): string | null {
  const a = agents[id]!;
  if (a.isDead || a.state.outcome === "unconscious") return null;
  const folk = parseTownsfolkId(id);
  if (folk) {
    const name = personas[id]!.name;
    // Someone on a journey is on the road, or at an inn or a town they are visiting (N26 Part E).
    const trip = town.whereNow(id);
    if (trip && town.road.onRoad()) return town.road.travellerPos(id) ? null : `${name} has gone on their way.`;
    if (trip && trip.site !== town.site()) return `${name} is ${trip.site ? `in ${world.realm?.settlements[trip.site]?.name ?? "another place"}` : "on the road"}, away from home.`;
    const home = trip ? town.site() : (town.homeSiteOf(id) ?? folk.site);
    const place = world.realm?.settlements[home]?.name ?? "another place";
    if (home !== town.site()) return `${name} is in ${place}, not here.`;
    if (town.area() !== "village") return `${name} is back in ${place}.`;
    const at = townsfolkAt(id);
    if (!at) return `${name} isn't about.`;
    return at.visible ? null : `${name} is indoors (${at.doing}).`;
  }
  if (a.state.dormant) return `${personas[id]!.name} isn't here.`;
  if (!local().includes(id)) {
    const home = town.homeSiteOf(id) ?? town.figureOf(id)?.home;
    const where = home ? (world.realm?.settlements[home]?.name ?? "far away") : "far away";
    return `${personas[id]!.name} is in ${where}, not here.`;
  }
  if (awayUntil[id] !== undefined) return `${personas[id]!.name} has run off.`;
  if (npcPos(id)) return null;
  // Out at one of the localities, or back in the village (N15).
  const place = npcPlace(id);
  if (place && !here().places.includes(place)) return `${personas[id]!.name} is at ${placeName(place)}, not here.`;
  return `${personas[id]!.name} is ${describePlan(currentPlan(a.persona, a.state, world))}.`;
}

/** Scenes by place: who said what lately (game/scene.ts). Not saved. */
const scenes: Record<string, Scene> = {};
const sceneAt = (place: string) => (scenes[place] ??= new Scene(place));

/** NPCs at a place now, as agents. */
function presentAt(place: PlaceId | null): NpcAgent[] {
  return place ? local().filter((id) => npcPlace(id) === place).map((id) => agents[id]!) : [];
}

// ---- Views for the client ----

function npcView(id: string): NpcView {
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
    color: npcColor(id),
    place: dead ? null : plan.place,
    doing: dead ? "dead" : town.road.onRoad() && town.whereNow(id) ? "on the road" : describePlan(plan),
    absent: absence(id),
    look: describeNpcAppearance(persona, s, world),
    friendship: friendshipOf(s),
    fear: fearOf(s, world.player),
    respect: respectOf(s, world.player),
    affection: s.affection,
    knowsYouAs: s.knownName,
    grudge: holdsGrudge(s, world.day) ? s.grudge!.reason : null,
    feeling: feeling ? `${feeling.kind} (${feeling.about})` : null,
    needs: { ...s.needs },
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
            upTo: TIERS[t.upTo]!,
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
    // N7-N12
    unconscious: s.outcome === "unconscious",
    statuses: describeStatuses(s),
    health: visibleHealth(s),
    companion: s.companion ? { wage: s.companion.wage, loyalty: s.companion.loyalty, unpaidDays: s.companion.unpaidDays } : null,
    hire: persona.hire ? persona.hire.wage : null,
    factionView: describeFactionView(persona, world.player),
    arcs: describeArcs(persona, s),
    plan: s.plan && s.plan.day === world.day ? s.plan.intentions : null,
    revenge: s.goals.find((g) => g.kind === "revenge")?.plan ?? null,
    dilemma: (() => {
      const d = (persona.dilemmas ?? []).find((x) => x.id === s.pendingDilemma);
      return d ? { offer: d.offer, options: d.options.map((o) => ({ id: o.id, label: o.label })) } : null;
    })(),
    pendingHire: s.pendingHire,
    pendingCommission: s.pendingCommission,
    guard: persona.guard === true,
    voice: persona.voice ?? DEFAULT_VOICE,
    minor: persona.minor === true,
    // Family (N11.3): spouse, children, parents, talents, in words.
    family: describeFamily(persona, world),
    canPropose: !persona.minor && config.content.romance && persona.romance?.open === true && romanceStageFor(persona, s) >= 3 && !spouseOf(world, id, (x) => x === "player" || !agents[x]?.isDead) && !spouseOf(world, "player", (x) => x === "player" || !agents[x]?.isDead),
  };
}

/** Where the player is, and where the roads go from here (N14). */
function siteView(): Snapshot["site"] {
  const realm = world.realm;
  const s = realm?.settlements[town.site()];
  const map = here();
  const area = { id: map.area, name: map.name, exits: map.exits.map((e) => e.label) };
  if (!realm || !s) return { id: town.site(), name: PLAIN_VILLAGE.name, kind: "village", kingdom: null, destinations: [], area };
  return { id: s.id, name: s.name, kind: s.kind, kingdom: s.kingdom ? (realm.kingdoms[s.kingdom]?.name ?? null) : null, destinations: destinationsOnRoad(realm, s.id), area };
}

/** The places the roads lead to, with the walk to each by the real road (N26): hours of walking, not the old straight-line days. */
function destinationsOnRoad(realm: NonNullable<typeof world.realm>, from: string) {
  const data = roadDataOf(realm);
  return destinations(realm, from).map((d) => {
    const w = shortestWay(data, from, d.id);
    return w ? { ...d, hours: Math.max(1, Math.round(w.tiles / WALK_PACE / 60)) } : d;
  });
}

function snapshot(): Snapshot {
  // The chronicle's news, from background work, joins the feed.
  for (const text of town.takeNews()) pushNews({ t: "system", text });
  const p = world.player;
  const roadView = town.road.view();
  return {
    llm: { ready: llmReady, error: llmError },
    map: roadView
      ? { id: "road", name: roadView.where, w: 1, h: 1, tiles: [["path"]], buildings: [], talkRange: TALK_RANGE, exits: [], zones: [] }
      : { id: here().id, name: here().name, w: here().w, h: here().h, tiles: here().tiles, buildings: here().buildings, talkRange: TALK_RANGE, exits: here().exits.map((e) => ({ x: e.x, y: e.y, label: e.label })), zones: here().zones },
    crowd: (() => {
      const sim = crowdHere();
      if (!sim) return null;
      const told = town.toldLately();
      return { map: sim.map.id, count: sim.roster.people.length, day: crowdDay(), ...(told.length > 0 ? { told } : {}) };
    })(),
    timeFlowSeconds: config.timeFlowSeconds,
    site: siteView(),
    time: { text: formatTime(world), day: world.day, hour: world.hour, minute: world.minute ?? 0, timeOfDay: world.timeOfDay, today: describeToday(world), ...todayInfo(world) },
    position: roadView && p.road ? { x: p.road.x, y: p.road.y } : world.position!,
    road: roadView,
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
        return { skill: s, level, tier: TIERS[level]!, progress: p.skillProgress[s] ?? 0, needed: level < 5 ? hoursToNextLevel(level) : 0 };
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
      // N7-N12
      mp: p.mp ?? 0,
      maxMp: p.maxMp ?? 0,
      attributePoints: p.attributePoints ?? 0,
      abilities: abilitiesFor(p.skills).map((a) => ({ id: a.id, name: a.name, mp: a.mp, describe: a.describe })),
      statuses: describeStatuses(p),
      health: visibleHealth(p),
      reputation: { ...(p.reputation ?? { trust: 0, fear: 0, respect: 0, affection: 0 }), words: describeReputation(p.reputation) },
      bounty: bountyOf(p),
      crimes: openCrimes(p).map((c) => `${c.kind} (${c.victimName})`),
      factions: describeStandings(p),
      failed: (p.quests.failed ?? []).length,
      party: town.companions().map((a) => a.persona.name),
    },
    chronicle: { lore: (world.lore ?? []).slice(-8).map((l) => l.text), log: (world.directorLog ?? []).slice(-8) },
    family: familyLines(),
    realm: world.realm ? { day: world.realm.day, latest: world.realm.news.filter((n) => town.siteHere().newsSeen.includes(n.id)).at(-1)?.text ?? null, wars: ongoing(world.realm).length } : null,
    adventurer: {
      member: inGuild(p),
      fee: GUILD_FEE,
      renown: p.renown ?? 0,
      rank: guildRank(p),
      dungeons: world.realm
        ? dungeonsInReach(world.realm, town.site()).map((d) => ({
            id: d.id,
            name: d.name,
            tier: d.tier,
            depth: d.depth,
            danger: Math.round(d.danger),
            cleared: d.clearedUntil !== undefined && world.day < d.clearedUntil,
            bounty: d.bounty,
            here: d.near === town.site() && town.area() === "mine",
            mouth: mouthOf(world.realm!, d),
          }))
        : [],
    },
    npcs: local().filter((id) => !agents[id]!.state.dormant).map(npcView),
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
          color: CREATURE_COLORS[c.template] ?? DEN_COLORS[denKeyOf(c)] ?? "#8a8f96",
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
    queue: queue.length,
  };
}

/** The town's marriages, courtships, children on the way and children born in play, in words (N11.3). */
function familyLines(): string[] {
  const fam = familyOf(world);
  const name = (id: string) => (id === "player" ? "you" : (personas[id]?.name ?? id));
  const dead = (id: string) => id !== "player" && agents[id]?.isDead;
  return [
    ...fam.marriages.map((m) => `${name(m.a)} and ${name(m.b)} are married${dead(m.a) || dead(m.b) ? " (widowed)" : ""}.`),
    ...fam.courting.map((c) => `${name(c.a)} and ${name(c.b)} are walking out together.`),
    ...fam.expecting.map((e) => `${name(e.parents[0])} and ${name(e.parents[1])} are expecting a child (due day ${e.dueDay}).`),
    ...bornKids(world).map((p) => `${p.name}, ${bornAge(p, world.day)}, child of ${(p.parents ?? []).map(name).join(" and ")}${p.talents?.length ? `: a gift for ${p.talents.join(", ").replaceAll("_", "-")}` : ""}${agents[p.id]?.isDead ? " (dead)" : ""}.`),
  ];
}

// ---- Actions ----

type Emit = (event: StreamEvent) => void;

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
  if (town.road.onRoad() && parseTownsfolkId(id)) {
    world.location = `the open road: ${personas[id]!.role}`;
    world.nearby = ["the road", "a milestone"];
    world.present = [];
    world.sceneLog = [];
    return;
  }
  const place = npcPlace(id) ?? "square";
  world.player.place = place;
  const words = here().placeWords(place);
  const own = place === workplaceOf(personas[id]!) ? ownSpot(id) : null;
  world.location = own?.location ?? words.location;
  world.nearby = own?.nearby ?? words.nearby;
  world.present = presentAt(place).filter((a) => a.persona.id !== id).map((a) => a.persona.id);
  world.sceneLog = sceneAt(place).linesFor(personas[id]!.name);
}

/** One NPC reply, streamed. Records everything the NPC did as events. */
async function npcSpeaks(id: string, emit: Emit, run: (agent: NpcAgent, onText: (delta: string) => void) => Promise<TurnResult>) {
  const agent = agents[id]!;
  // G2 timeout budget: if the model hasn't said a word in time, fill the wait with a short line.
  let spoke = false;
  const timer = config.fillerAfterMs > 0 && llmReady ? setTimeout(() => !spoke && emit({ t: "filler", npc: id, text: fillerLine(personas[id]!) }), config.fillerAfterMs) : null;
  try {
    const result = await run(agent, (delta) => {
      spoke = true;
      emit({ t: "text", npc: id, delta });
    });
    reportTurn(id, result, emit);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const GENERIC_FILLERS = ["Hmm.", "Well...", "Let me think."];
const fillerLine = (p: NpcPersona) => {
  const lines = p.fillerLines ?? GENERIC_FILLERS;
  return lines[Math.floor(Math.random() * lines.length)]!; // real time, not simulation: a flavour line
};

/** What the NPC did in a turn (and any titles the player earned), as events. */
function reportTurn(id: string, result: TurnResult, emit: Emit): void {
  const name = personas[id]!.name;
  turnActions.push(...result.actions);
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

  // ---- Growth, work, factions: no model call (N7-N12) ----
  if (action === "raise") return void emit({ t: "note", kind: "action", text: raiseAttribute(world.player, String(body.attribute ?? "")).message });
  if (action === "join") return void emit({ t: "note", kind: "action", text: joinFaction(world.player, String(body.faction ?? "")).message });
  // The wider realm (N13.6): the adventurers' guild and the dungeon by the mine.
  // Travel (N14): the road to another place. The world lives the hours it takes.
  if (action === "travel") {
    if (currentFight()) return void emit({ t: "system", text: "Not in the middle of a fight." });
    // The road is walked now (N26): this sets where the player is bound, and sees them out of the gate.
    const lines = town.road.setDestination(String(body.to ?? ""), leaveByRoad);
    for (const text of lines.lines) emit({ t: "note", kind: lines.ok ? "action" : "fail", text });
    engaged = null;
    return;
  }
  if (action === "joinguild") {
    if (!world.realm) return void emit({ t: "system", text: "There's no wider realm in this world." });
    const r = joinGuild(world.realm, world.player);
    return void emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.message });
  }
  if (action === "delve") {
    if (!world.realm) return void emit({ t: "system", text: "There's no wider realm in this world." });
    if (currentFight()) return void emit({ t: "system", text: "Not in the middle of a fight." });
    const r = playerDelve(world.realm, world.player, String(body.dungeon ?? ""), world.day, town.actionRng());
    for (const text of r.lines) emit({ t: "note", kind: r.ok ? "combat" : "fail", text });
    if (r.ok) for (const line of passHours(r.hours)) emit({ t: "system", text: line });
    return;
  }
  if (action === "dismiss") {
    const a = agents[String(body.npc ?? "")] ?? town.companions()[0];
    return void emit({ t: "note", kind: "action", text: a ? dismiss(a.persona, a.state, world).message : "Nobody's with you." });
  }
  if (action === "forage" || action === "craft") {
    if (currentFight()) return void emit({ t: "system", text: "Not in the middle of a fight." });
    const r = action === "craft" ? playerCraft(world.player, String(body.item ?? ""), town.actionRng(), world.day) : forage(world.player, town.actionRng(), world.day);
    emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.message });
    for (const text of r.notes) emit({ t: "note", kind: "quest", text });
    if (r.ok && r.hours > 0) for (const line of passHours(r.hours)) emit({ t: "system", text: line });
    return;
  }
  if (action === "sneak") {
    const here = town.presentAt(world.player.place).filter((a) => !a.busyWith(world) && distance(world.position!, npcPos(a.persona.id) ?? { x: -99, y: -99 }) <= TALK_RANGE * 4);
    return void emit({ t: "note", kind: "roll", text: sneak(world, here.map((a) => ({ persona: a.persona, state: a.state })), town.actionRng()).message });
  }
  if (action === "loot") {
    const a = agents[String(body.npc ?? "")];
    if (!a || (!a.isDead && a.state.outcome !== "unconscious")) return void emit({ t: "system", text: "There's nobody lying still to rob." });
    const lying = npcPos(a.persona.id);
    if (!lying || distance(world.position!, lying) > TALK_RANGE) return void emit({ t: "system", text: `You are too far from ${a.persona.name}.` });
    const witnesses = town.presentAt(world.player.place).filter((x) => x !== a).map((x) => x.persona.id);
    emit({ t: "note", kind: "action", text: lootBody(a.persona, a.state, world, witnesses, body.item ? String(body.item) : undefined).message });
    for (const text of town.consequences()) emit({ t: "system", text });
    return;
  }

  // The open road (N26): what the player does there that isn't a step.
  if (action === "situation") {
    const r = town.road.choose(String(body.choice ?? ""));
    for (const text of r.lines) emit({ t: "note", kind: r.ok ? "action" : "fail", text });
    for (const text of town.consequences()) emit({ t: "system", text });
    return;
  }
  if (action === "camp" || (action === "wait" && town.road.onRoad())) {
    if (currentFight()) return void emit({ t: "system", text: "Not in the middle of a fight." });
    for (const text of town.road.camp(action === "wait" ? Math.max(1, Math.min(12, Math.floor(Number(body.hours ?? 1)))) : undefined)) emit({ t: "note", kind: "action", text });
    emit({ t: "system", text: `It's ${formatTime(world)}.` });
    return;
  }
  if (action === "fasttravel") {
    if (currentFight()) return void emit({ t: "system", text: "Not in the middle of a fight." });
    for (const text of town.road.fast()) emit({ t: "note", kind: "action", text });
    if (!town.road.onRoad()) {
      world.position = { ...here().start };
      placeCreatures();
    }
    emit({ t: "system", text: `It's ${formatTime(world)}.` });
    return;
  }
  if (action === "coach") {
    const r = town.road.coach(String(body.to ?? ""));
    for (const text of r.lines) emit({ t: "note", kind: r.ok ? "action" : "fail", text });
    if (r.ok) {
      world.position = { ...here().start };
      placeCreatures();
    }
    return;
  }
  if (action === "joinjourney" || action === "rob") {
    if (currentFight()) return void emit({ t: "system", text: "Not in the middle of a fight." });
    const journey = String(body.journey ?? "");
    const r = action === "rob" ? town.road.rob(journey) : town.road.travelWith(journey);
    for (const text of r.lines) emit({ t: "note", kind: r.ok ? "action" : "fail", text });
    if (r.ok && !town.road.onRoad()) {
      world.position = { ...here().start };
      placeCreatures();
    }
    return;
  }
  if (action === "roadplace") {
    for (const text of town.road.usePlace(String(body.place ?? ""), String(body.op ?? ""))) emit({ t: "note", kind: "action", text });
    return;
  }
  if (action === "eat") return void emit({ t: "note", kind: "action", text: town.road.eat(String(body.item ?? ""))[0]! });
  if (action === "drink") return void emit({ t: "note", kind: "action", text: town.road.drinkHere()[0]! });
  if (action === "mount") {
    const op = String(body.op ?? "");
    if (op !== "buy" && op !== "sell" && op !== "feed" && op !== "treat") return void emit({ t: "system", text: "Buy, sell, feed or treat." });
    return void emit({ t: "note", kind: "action", text: town.road.mount(op, String(body.kind ?? body.item ?? ""))[0]! });
  }

  if (action === "wait") {
    const fighting = Object.values(agents).some((a) => a.state.inCombat) || (engaged !== null && creatureById(engaged) !== undefined && !creatureById(engaged)!.outcome);
    if (fighting) return void emit({ t: "system", text: "You can't wait around in the middle of a fight." });
    const hours = Math.max(1, Math.min(24, Math.floor(Number(body.hours ?? 1))));
    for (const line of passHours(hours)) emit({ t: "system", text: line });
    emit({ t: "system", text: `Time passes. It's now ${formatTime(world)}.` });
    return;
  }

  // One of the townsfolk (N16): they become a talking NPC the first time the player speaks to them.
  if (!agents[id] && parseTownsfolkId(id)) {
    const sim = crowdHere();
    const i = sim?.index.get(id);
    if (sim && i !== undefined) town.meetTownsperson(sim.roster, sim.roster.people[i]!);
  }
  // Someone on the road (N26 Part E): a person of the table, they become a talking NPC the first time the player speaks to them.
  if (!agents[id] && town.road.onRoad() && parseTownsfolkId(id)) town.meetPerson(id);
  const agent = agents[id];
  if (!agent) return void emit({ t: "error", text: "Unknown character." });
  const name = personas[id]!.name;
  lastTalk = { id, minute: absoluteMinute(world) };

  if (action === "open") {
    const problem = npcInRange(id);
    if (problem) return void emit({ t: "system", text: problem });
    // A new conversation starts fresh unless a fight is still going.
    if (!agent.state.inCombat && agent.state.outcome !== "dead") {
      agent.state.conversationOver = false;
      agent.state.outcome = null;
    }
    setScene(id);
    // What they know of the wider world, now (N33): the townsfolk they talked to, the travellers who passed.
    town.syncTalker(id);
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
      const turn = await sceneTurn(sceneAt(place!), here, agent, text, world, town.actionRng(), (who, delta) => emit({ t: "text", npc: who, delta }));
      reportTurn(id, turn.addressed.result, emit);
      if (turn.interjection) reportTurn(turn.interjection.id, turn.interjection.result, emit);
      if (turn.vouched) emit({ t: "note", kind: "action", text: `${turn.vouched} put in a good word for you.` });
      break;
    }
    case "introduce":
      await npcSpeaks(id, emit, (a, on) => a.introduceSelf(world, on));
      break;
    case "propose": {
      const r = propose(world, town.members(), id);
      emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.message });
      // Only a real answer reaches the model: never a child's, nor with romance off (design rule 7).
      if (r.ok || (!agent.persona.minor && config.content.romance && agent.persona.romance?.open === true)) {
        const said = r.ok
          ? `${p.name} asked you to marry them, and you said yes. You are married now. Say how you feel.`
          : `${p.name} asked you to marry them. You're not ready for that; let them down in your own way.`;
        await npcSpeaks(id, emit, (a, on) => a.hear(said, world, on));
      }
      break;
    }
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
      for (const text of town.companionsHit({ npc: id })) emit({ t: "note", kind: "combat", text });
      break;
    case "flee":
      await npcSpeaks(id, emit, (a, on) =>
        a.playerFlees(world, on, (r) => emit({ t: "note", kind: "roll", text: r.ok ? `flee ${r.escaped ? "succeeded" : "failed"} ${rollOf(r.message)}` : r.message })),
      );
      break;
    case "steal": {
      const item = String(body.item ?? "");
      const witnesses = town.presentAt(npcPlace(id)).filter((a) => a !== agent && !a.busyWith(world)).map((a) => a.persona.id);
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.steal(item, world, witnesses, on);
        emit({ t: "note", kind: r.theft.ok ? (r.theft.success ? "action" : "fail") : "fail", text: r.theft.message });
        return r;
      });
      break;
    }
    case "choose":
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.chooseDilemma(String(body.option ?? ""), world, on);
        emit({ t: "note", kind: r.choice.ok ? "action" : "fail", text: `${r.choice.message}${r.choice.effects.length ? ` (${r.choice.effects.join("; ")})` : ""}` });
        return r;
      });
      break;
    case "subdue":
      await npcSpeaks(id, emit, (a, on) =>
        a.attackedByPlayer(world, on, (r) => emit({ t: "note", kind: "combat", text: `You ${r.damage > 0 ? `hit for ${r.damage}, pulling your blows` : "miss"} ${rollOf(r.message)}` }), { subdue: true }),
      );
      for (const text of town.companionsHit({ npc: id })) emit({ t: "note", kind: "combat", text });
      break;
    case "ability": {
      const ability = parseAbility(String(body.ability ?? ""));
      if (!ability) return void emit({ t: "system", text: "Unknown ability." });
      await npcSpeaks(id, emit, (a, on) => a.ability(ability, world, on, (r) => emit({ t: "note", kind: r.ok ? "combat" : "fail", text: `${ABILITIES[ability].name}: ${r.message.replace(/\(rolled[^)]*\)\s*/, "")}` })));
      for (const text of town.companionsHit({ npc: id })) emit({ t: "note", kind: "combat", text });
      break;
    }
    case "payfine":
    case "surrender": {
      if (!personas[id]!.guard) {
        const watch = local().map((x) => personas[x]!).find((x) => x.guard && !agents[x.id]!.isDead);
        return void emit({ t: "system", text: `${name} isn't the guard.${watch ? ` ${watch.name} keeps the gate.` : " Find the guard."}` });
      }
      if (action === "payfine") emit({ t: "note", kind: "action", text: payFine(p).message });
      else {
        const r = surrender(p);
        emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.message });
        if (r.ok) for (const line of passHours(r.hours)) emit({ t: "system", text: line });
      }
      break;
    }
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
          const r = await a.acceptQuest(world, on, town.findEscortee);
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
      else if (kind === "hire")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineHire(world, on);
          const r = await a.acceptHire(world, on);
          emit({ t: "note", kind: r.hire.ok ? "action" : "fail", text: r.hire.message });
          return r;
        });
      else if (kind === "commission")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineCommissionOffer(world, on);
          const r = await a.acceptCommissionOffer(world, on);
          emit({ t: "note", kind: r.order.ok ? "action" : "fail", text: r.order.ok ? `Ordered: ${r.order.message}` : r.order.message });
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
          // A bed (N26): the road's weariness is gone.
          topUp(world.player, absoluteMinute(world), 95);
          if (world.player.roadNeeds) world.player.roadNeeds.rest = 100;
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
  // What reaches beyond this conversation: witnesses, crimes, deaths and their ripple, escorts (game/town.ts).
  for (const text of [...town.consequences(), ...town.takeNews()]) emit({ t: "system", text });

  if (agent.isDead) {
    recordDeath(id);
    const text =
      s.deathCause === "old age"
        ? `${name} is gone, taken by old age. They won't be coming back.`
        : `${name} falls and doesn't get up. They're dead, and they won't be coming back.`;
    emit({ t: "ended", npc: id, text });
  } else if (s.outcome === "unconscious") {
    emit({ t: "ended", npc: id, text: `${name} drops, out cold. They'll come round in a few hours.` });
  } else if (s.outcome === "knocked out") {
    for (const text of town.companionsEndangered()) emit({ t: "system", text });
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
  const foe = engaged ? creatureById(engaged) : undefined;
  if (foe && !foe.outcome) {
    return { ok: false, log: [], reason: `You're fighting ${foe.name}. Fight (F) or run (R).` };
  }
  engaged = null;
  if (town.road.onRoad()) return roadMove(dx, dy);
  if (here().isSolid(nx, ny)) return { ok: false, log: [] };
  // Companions step aside (they're walking behind you); anyone else is in the way.
  if (local().some((id) => { const at = npcPos(id); return !agents[id]!.state.companion && at !== null && at.x === nx && at.y === ny; })) return { ok: false, log: [] };
  if (presentCreatures().some((c) => c.pos?.x === nx && c.pos?.y === ny)) return { ok: false, log: [] };
  const from = { x: pos.x, y: pos.y };
  trail.unshift(from);
  trail.length = Math.min(trail.length, TRAIL_KEPT);
  pos.x = nx;
  pos.y = ny;
  // Off the edge of the map: on to the next area (N15).
  const exit = exitUnder(here(), pos);
  if (exit?.to === "realm") return { ok: true, log: leaveByRoad() };
  if (exit) return { ok: true, log: enterArea(exit.to as AreaId) };
  world.player.place = here().placeAtTile(pos) as PlaceId;
  // Whoever the player is escorting walks a step behind them (N9 escort quests).
  for (const q of world.player.quests.active) {
    const c = q.objective.type === "escort" && q.escortee ? town.creaturesHere()[q.escortee] : undefined;
    if (c && !c.outcome) c.pos = from;
  }
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
    log.push(...afterCreatureRound(lurker, creatureAmbush(creatureTemplates[lurker.template]!, lurker, world, town.actionRng())));
  }
  return { ok: true, log };
}

/** One step on the open road (N26): the world lives the game minutes it takes, and a gate ahead is a place reached. */
function roadMove(dx: number, dy: number): { ok: boolean; log: string[]; reason?: string } {
  const r = town.road.step(dx, dy, walkMinutes);
  if (r.entered) {
    trail.length = 0;
    world.position = { ...here().start };
    placeCreatures();
  }
  return { ok: r.ok, log: r.log, ...(r.reason ? { reason: r.reason } : {}) };
}

/** The player walks out of the west gate (N26): the open road, toward where they were bound if they said. */
function leaveByRoad(toward?: string): string[] {
  trail.length = 0;
  crowd = null;
  return town.leaveByRoad(toward);
}

/**
 * The player walks from one area of the place to the next (N15): from the village up
 * the road, out to the camp or the mine, into the woods, and back. They come in at
 * the edge they came from; the walk takes a while, and the world lives it.
 */
function enterArea(to: AreaId): string[] {
  const from = town.area();
  if (to === "village") delete world.player.area;
  else world.player.area = to;
  const map = here();
  const back = exitTo(map, from);
  world.position = back ? { ...back.inward } : { ...map.start };
  world.player.place = map.placeAtTile(world.position);
  trail.length = 0;
  // Whoever is being escorted comes along, a step behind.
  for (const c of Object.values(town.creaturesHere())) if (following(c)) delete c.pos;
  const log = [to === "village" ? `You walk back into ${map.name}.` : `You walk out to ${map.name.replace(/^The /, "the ")}.`];
  log.push(...walkMinutes(AREA_WALK_MINUTES));
  town.stockHaunts();
  placeCreatures();
  return log;
}

/** What a creature fight round means for the game: end the fight, or knock the player out. Returns lines for the player. */
function afterCreatureRound(c: Creature, round: CreatureRound): string[] {
  const log = [...round.log];
  // Killing or routing it counts towards defeat quests for its kind.
  if (round.over === "creature dead" || round.over === "creature fled") log.push(...recordCreatureDefeat(world.player, c.template));
  if (round.over === "player fled") calmUntil[c.uid] = absoluteMinute(world) + CALM_MINUTES;
  if (round.over && round.over !== "player down") engaged = null;
  // The dead and the fled go back to the realm (N15).
  if (round.over) log.push(...town.settleHaunts());
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
  const c = creatureById(uid);
  const t = c && creatureTemplates[c.template];
  if (!c || !t || c.outcome || !c.pos) return void emit({ t: "system", text: "There's nothing there to fight." });
  if (distance(world.position!, c.pos) > TALK_RANGE) return void emit({ t: "system", text: `You are too far from ${c.name}.` });
  if (action === "escape" && engaged !== uid) return void emit({ t: "system", text: `You're not fighting ${c.name}.` });
  engaged = uid;
  const round = action === "hunt" ? fightCreature(t, c, world, town.actionRng()) : fleeCreature(t, c, world, town.actionRng());
  const lines = afterCreatureRound(c, round);
  if (action === "hunt" && !round.over) {
    lines.push(...town.companionsHit({ creature: uid }));
    if (c.outcome) engaged = null;
  }
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
let lastPlayerAction = Date.now(); // real time, not simulation: the combat clock
let newsId = 0;
const news: NewsItem[] = [];
const NEWS_KEPT = 50;

function pushNews(event: StreamEvent & { npc?: string }): void {
  news.push({ ...event, id: ++newsId } as NewsItem);
  if (news.length > NEWS_KEPT) news.shift();
}

/** Who the player is fighting: an NPC id, a creature uid, or null. */
function currentFight(): { npc: string } | { creature: string } | null {
  const npc = local().find((id) => agents[id]!.state.inCombat && !agents[id]!.isDead);
  if (npc) return { npc };
  const foe = engaged ? creatureById(engaged) : undefined;
  if (engaged && foe && !foe.outcome) return { creature: engaged };
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
  if (!fight || queue.busy || queue.length > 0 || config.combatTickSeconds <= 0) return;
  if (Date.now() - lastPlayerAction < config.combatTickSeconds * 1000) return;
  lastPlayerAction = Date.now();
  const before = captureFrame(world, agents);
  turnActions = [];
  if ("npc" in fight) {
    pushNews({ t: "note", kind: "combat", npc: fight.npc, text: "You hesitate." });
    const emit: Emit = (event) => pushNews({ npc: fight.npc, ...event });
    reportTurn(fight.npc, agents[fight.npc]!.playerHesitates(world), emit);
    afterTurn(fight.npc, emit);
    for (const event of turnEvents(before, captureFrame(world, agents), { npc: fight.npc, actions: turnActions })) pushNews({ t: "event", event });
  } else {
    const c = creatureById(fight.creature)!;
    const lines = afterCreatureRound(c, creatureTurn(creatureTemplates[c.template]!, c, world, town.actionRng()));
    lines.push(...walkMinutes(config.turnMinutes.fight));
    for (const text of lines) pushNews({ t: "note", kind: "combat", text });
  }
  persist();
}

setInterval(combatTick, 250);

// ---- HTTP ----

/** One thing at a time: a model reply must finish before the next action starts. Later ones wait in line (G1). */
const queue = new ActionQueue(config.maxQueuedRequests);

// ---- The admin view (N17): read-only, and the clock ----

/** Paused from the admin view: the game's clock stops running on its own (POST /api/tick does nothing). Not saved. */
let adminPaused = false;
const adminCtx: AdminContext = {
  world: () => world,
  town: () => town,
  store,
  queueLength: () => queue.length,
  time: {
    paused: () => adminPaused,
    setPaused: (paused) => void (adminPaused = paused),
    // The same code and the same queue as the player waiting (act "wait").
    advance: (hours) =>
      queue.run(() => {
        const log = passHours(hours);
        persist();
        return log;
      }),
  },
};

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
  ".png": "image/png",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

function serveStatic(url: string, res: ServerResponse): void {
  const path = url === "/" ? "/index.html" : decodeURIComponent(url);
  const file = normalize(join(WEB_DIR, path));
  if (!existsSync(join(WEB_DIR, "index.html"))) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("The browser game isn't built yet. Run `npm run web` (builds it, then starts the server) or `npm run dev`.");
    return;
  }
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
      if (!llmReady && !queue.busy && !polling) await checkLlm();
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

    // The admin page and its data (N17): this machine only; nothing under /api/admin changes the game except the clock.
    if (req.method === "GET" && (url === "/admin" || url === "/admin/" || url === "/admin.html")) return adminAllowed(req) ? serveStatic("/admin.html", res) : void refuseAdmin(res);
    if (await handleAdmin(req, res, adminCtx)) return;

    if (req.method === "GET" && url === "/api/voice") return json(res, 200, voice.info);
    // The land between places (N26): the roads, rivers and places the browser makes its chunks from (fetched once).
    if (req.method === "GET" && url === "/api/road/coach") {
      const q = town.road.coachQuote(new URL(req.url!, "http://x").searchParams.get("to") ?? "");
      return json(res, 200, { ok: q.ok, message: q.message, price: q.price });
    }
    if (req.method === "GET" && url === "/api/road/journeys") return json(res, 200, town.road.journeysForClient());
    if (req.method === "GET" && url === "/api/road/data") return json(res, 200, world.realm ? roadDataOf(world.realm) : null);
    // Everyone who lives on the map the player is on (N16): fetched once per map; where they are is worked out from the clock.
    if (req.method === "GET" && url === "/api/crowd") return json(res, 200, crowdHere()?.roster ?? null);
    if (req.method === "GET" && url === "/api/realm") return json(res, 200, world.realm ? realmView(world.realm, { here: town.site(), heard: (id) => town.siteHere().newsSeen.includes(id) }) : null);

    if (req.method === "POST" && url === "/api/speak") {
      // Speech runs beside the action queue: Piper is its own process, and a line already said can't change the game.
      const body = await readBody(req);
      const persona = personas[String(body.npc ?? "")];
      const text = speakable(String(body.text ?? "")).slice(0, MAX_SPEAK_CHARS);
      if (!voice.tts) return json(res, 404, { error: voice.info.note });
      if (!persona || !text) return json(res, 400, { error: "Unknown NPC or nothing to say." });
      const audio = await voice.tts.synthesize(text, persona.voice ?? DEFAULT_VOICE);
      res.writeHead(200, { "content-type": "audio/wav", "content-length": audio.length, "cache-control": "no-store" });
      return void res.end(audio);
    }

    if (req.method === "POST" && url === "/api/tick" && (queue.busy || queue.length > 0)) return json(res, 200, { ok: false, log: [], events: [], state: null });
    if (req.method === "POST" && (url === "/api/move" || url === "/api/new" || url === "/api/act") && queue.length >= config.maxQueuedRequests) {
      return json(res, 429, { ok: false, reason: "Too much going on at once. Try again in a moment." });
    }

    if (req.method === "POST" && url === "/api/move") {
      const body = await readBody(req);
      const result = await queue.run(() => {
        lastPlayerAction = Date.now();
        const before = captureFrame(world, agents);
        const r = move(Number(body.dx ?? 0), Number(body.dy ?? 0));
        if (r.ok) persist();
        const events: GameEvent[] = turnEvents(before, captureFrame(world, agents));
        return { ...r, events, state: snapshot() };
      });
      return json(res, 200, result);
    }

    // A minute passes while the player stands about (N16), so the townsfolk keep moving.
    if (req.method === "POST" && url === "/api/tick") {
      const result = await queue.run(() => {
        const fighting = Object.values(agents).some((a) => a.state.inCombat && !a.isDead) || (engaged !== null && !!creatureById(engaged) && !creatureById(engaged)!.outcome);
        if (fighting || config.timeFlowSeconds === 0 || adminPaused) return { ok: false, log: [], events: [], state: snapshot() };
        const before = captureFrame(world, agents);
        const hour = absoluteHour(world);
        const log = walkMinutes(1);
        if (!town.road.onRoad()) wander();
        if (absoluteHour(world) !== hour || (world.minute ?? 0) % 10 === 0) persist();
        return { ok: true, log, events: turnEvents(before, captureFrame(world, agents)), state: snapshot() };
      });
      return json(res, 200, result);
    }

    if (req.method === "POST" && url === "/api/new") {
      const state = await queue.run(() => {
        startGame(true);
        return snapshot();
      });
      return json(res, 200, { state });
    }

    if (req.method === "POST" && url === "/api/act") {
      const body = await readBody(req);
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      const emit: Emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      await queue.run(
        async () => {
          town.playerActs(); // background work (plans, summaries, the chronicle) makes way
          lastPlayerAction = Date.now(); // acting (or a reply streaming) uses up the turn's clock
          const before = captureFrame(world, agents);
          turnActions = [];
          try {
            // Waiting, opening a chat and fighting creatures need no model.
            const offline = ["travel", "wait", "open", "hunt", "escape", "equip", "unequip", "look", "retrieve", "raise", "join", "dismiss", "forage", "craft", "sneak", "loot", "payfine", "surrender", "joinguild", "delve", "situation", "camp", "fasttravel", "coach", "joinjourney", "rob", "roadplace", "eat", "drink", "mount"].includes(String(body.action));
            if (!llmReady && !offline) await checkLlm();
            if (!llmReady && !offline) emit({ t: "error", text: llmError });
            else await act(body, emit);
            persist();
          } catch (err) {
            emit({ t: "error", text: (err as Error).message });
          } finally {
            // What happened, for the screen to animate (T13).
            const npc = typeof body.npc === "string" && agents[body.npc] ? body.npc : undefined;
            for (const event of turnEvents(before, captureFrame(world, agents), { npc, playerAction: String(body.action ?? ""), actions: turnActions })) emit({ t: "event", event });
            town.resume();
            lastPlayerAction = Date.now(); // the clock for the next turn starts once the reply is done
            emit({ t: "done", state: snapshot() });
            res.end();
          }
        },
        (position) => emit({ t: "queued", position }),
      );
      return;
    }

    if (req.method === "GET") return serveStatic(url, res);
    res.writeHead(405).end();
  } catch (err) {
    if (!res.headersSent) json(res, 500, { error: (err as Error).message });
    else res.end();
  }
});

// One writer at a time: the save file and the database go together (N18).
acquireSaveLock(config.saveFile);
try {
  startGame(process.argv.includes("--new"));
} catch (err) {
  if (!(err instanceof SaveMismatchError)) throw err;
  console.error(err.message);
  process.exit(1);
}
server.listen(PORT, "127.0.0.1", () => {
  console.log(`The game is open at http://localhost:${PORT}`);
});
console.log(`Voices: ${voice.info.note}`);
console.log(`Loading ${config.model}...`);
await checkLlm();
console.log(llmReady ? "Model ready." : `Warning: ${llmError}\nThe map works, but NPCs can't talk until Ollama is running.`);
