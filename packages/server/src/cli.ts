import { readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { argv, stdin, stdout } from "node:process";
import { config } from "./config.js";
import { describeEvent, type EventFrame } from "@millbrook/shared";
import { captureFrame, turnEvents } from "./game/turnEvents.js";
import { advanceMinutes, formatTime } from "./game/clock.js";
import {
  type Creature,
  creatureBeatsPlayer,
  type CreatureTemplate,
  creatureTurn,
  describeCreature,
  fightCreature,
  fleeCreature,
  loadCreatureTemplates,
} from "./game/creatures.js";
import { DeathRegistry, describeDeath } from "./game/deaths.js";
import { importDeaths, loadWorld, newWorld, saveWorld, type SavedWorld } from "./game/save.js";
import { rankForLevel, xpToNextLevel } from "./game/levels.js";
import { titleNames } from "./game/titles.js";
import { restPlayer } from "./game/healing.js";
import { loadSpawnRules } from "./game/spawning.js";
import { describeObjective, questProgress, questRewardMoney, recordCreatureDefeat } from "./game/quests.js";
import { itemLabel } from "./game/items.js";
import {
  DEFAULT_SESSION_HOURS,
  feePerHour,
  hoursToNextLevel,
  parseSkill,
  quoteTraining,
  TRUST_FOR_TIER,
  teachableSkills,
  teachCap,
} from "./game/training.js";
import { OllamaProvider } from "./llm/ollama.js";
import { NpcAgent } from "./npc/NpcAgent.js";
import { repairForPlayer } from "./npc/actions.js";
import { SKILLS, skillLevel, TIERS } from "./npc/skills.js";
import { parsePersona } from "./npc/personaSchema.js";
import { startEncounter, statsOf } from "./npc/state.js";
import type { TurnResult } from "./npc/types.js";
import { formatMoney } from "./game/money.js";
import {
  armorValue,
  describeBurden,
  equip,
  equippedWeapon,
  isBroken,
  playerGearRank,
  playerSlots,
  SLOTS,
  type Slot,
  unequip,
} from "./game/gear.js";
import { describePlan, currentPlan, parsePlace, PLACE_NAMES, PLACE_NEARBY, type PlaceId, PLACES, WALK_MINUTES, workplaceOf } from "./game/schedule.js";
import { addressedByName, Scene, sceneTurn } from "./game/scene.js";
import { describeNpcAppearance, describePlayerAppearance } from "./npc/appearance.js";
import { journalByNpc } from "./game/journal.js";
import { FAVOUR_KINDS, type FavourKind } from "./game/favours.js";
import { initiativeFor, pickOpener } from "./npc/initiative.js";
import { describeToday } from "./game/events-calendar.js";
import { friendshipOf } from "./npc/relationship.js";
import { quoteCommission } from "./game/commissions.js";
import { Town } from "./game/town.js";
import { WorldStore } from "./game/db.js";
import { pickEmbedder } from "./game/embeddings.js";
import { OllamaEmbedder } from "./llm/ollama.js";
import { forage, playerCraft } from "./game/gathering.js";
import { lootBody } from "./game/loot.js";
import { sneak } from "./game/stealth.js";
import { bountyOf, payFine, surrender } from "./game/crime.js";
import { describeStandings, joinFaction, loadFactions } from "./game/factions.js";
import { describeReputation } from "./game/reputation.js";
import { raiseAttribute } from "./npc/growth.js";
import { ABILITIES, abilitiesFor, parseAbility } from "./game/abilities.js";
import { dismiss } from "./game/party.js";
import { creatureAmbush } from "./game/creatures.js";
import { bornAge, familyOf, propose } from "./game/family.js";
import { lintCast } from "./npc/lint.js";

// Pick who to start with: `npm run chat -- pell`. Defaults to brena. You start where they are.
const NPC_DIR = new URL("./data/npcs/", import.meta.url);
const available = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const newGame = argv.includes("--new");
const nameArg = argv.find((arg) => arg.startsWith("--name="))?.slice("--name=".length);
const startId = argv.find((arg) => !arg.startsWith("--") && arg !== argv[0] && arg !== argv[1]) ?? "brena";
if (!available.includes(startId)) {
  console.error(`No NPC "${startId}". Available: ${available.join(", ")}`);
  process.exit(1);
}
// Validate every NPC file up front, so a typo in any of them fails now, not mid-conversation.
const personas = Object.fromEntries(
  available.map((id) => [id, parsePersona(JSON.parse(readFileSync(new URL(`${id}.json`, NPC_DIR), "utf8")), `${id}.json`)]),
);
/** Display names by id, for the journal (children born in play are added as they come). */
// The authoring check (T5): what the schema can't see (the cast as a whole, contradictions).
const lint = lintCast(personas);
if (Object.keys(lint).length > 0) {
  for (const [id, problems] of Object.entries(lint)) console.error(`${id}.json:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
const names = () => Object.fromEntries(Object.entries(personas).map(([id, p]) => [id, p.name]));

// Death is permanent: a dead NPC can't be talked to again, in this run or any later one.
const creatureTemplates = loadCreatureTemplates();
const spawnRules = loadSpawnRules();
const deaths = new DeathRegistry(config.deathsFile);
const world: SavedWorld = newGame
  ? newWorld(personas, creatureTemplates)
  : importDeaths(loadWorld(config.saveFile, personas, creatureTemplates), config.deathsFile);
// With permadeath, a dead player's save is over (config.playerDefeat).
if (world.player.death) {
  const d = world.player.death;
  console.log(`You were killed by ${d.killedBy} on day ${d.day}. This world is over; start a new one with --new.`);
  process.exit(0);
}
// The player's own name: --name=Anand (kept in the save). NPCs only learn it when told (N4.3).
if (nameArg) world.player.name = nameArg;

const llm = new OllamaProvider();
// The long-term store (SQLite): every event, summaries for recall by meaning, the director's log.
const store = new WorldStore(config.dbFile, await pickEmbedder(new OllamaEmbedder()));
if (newGame) store.reset();
const town = new Town({ personas, creatureTemplates, spawnRules, world, llm, backgroundLlm: new OllamaProvider(), store, deaths });
const agents: Record<string, NpcAgent> = town.agents;
for (const id of town.ids) {
  // A new session: however the last encounter ended (they fled, you fled, you were knocked out), it's over.
  startEncounter(agents[id]!.state);
}
/** Who the player is talking to (/to switches). */
let npc = agents[startId]!;
const members = () => town.ids.map((id) => ({ id, persona: personas[id]!, state: agents[id]!.state }));

/** Where the player is. They start where the NPC they picked is (or works). */
world.player.place = placeOfNpc(startId) ?? workplaceOf(personas[startId]!);
if (world.player.place === "home") world.player.place = "square";
let scene = new Scene(world.player.place);
setScene();

function placeOfNpc(id: string): PlaceId | null {
  return town.placeOf(id);
}

/** NPCs here now, awake and alive. */
function present(): NpcAgent[] {
  return town.ids.filter((id) => placeOfNpc(id) === world.player.place).map((id) => agents[id]!);
}

/** The world the NPCs see: this place's description. */
function setScene(): void {
  const place = world.player.place ?? "square";
  world.location = PLACE_NAMES[place];
  world.nearby = PLACE_NEARBY[place];
}

const rl = createInterface({ input: stdin, output: stdout });

console.log(`Loading ${config.model}...`);
try {
  await llm.warmUp();
} catch (err) {
  console.error(`Could not reach Ollama at ${config.ollamaHost}. Is it running? (${(err as Error).message})`);
  process.exit(1);
}
console.log(
  `Commands: /go <place>, /where, /to <npc>, /look [npc|me], /introduce, /give <item|money>, /lie <claim>, /ask <favour> [item], /repay, /retrieve, ` +
    `/commission <item>, /collect, /journal [npc], /quests, /turnin, /wait <hours>, /use <item>, /haggle <words>, /persuade <words>, /intimidate <words>, ` +
    `/attack, /flee, /train <skill> [hours], /skills, /gear, /equip <item>, /unequip <weapon|armor>, /repair <weapon|armor|item>, ` +
    `/creatures, /hunt <creature>, /escape <creature>, /state, /save, /trust <-100..100>, /quit\n` +
    `  Social web: /steal <item>, /sneak, /loot <npc> [item], /choose <option>, /payfine, /surrender, /join <faction>, /factions, /reputation\n` +
    `  Fighting: /subdue, /ability <name>, /dismiss (a companion), /party. Work: /forage, /craft <item>, /raise <attribute>. The world: /chronicle, /family, /propose\n`,
);

/** Write an NPC's death to the permanent record, so quitting (or a crash) can't undo it. */
function recordDeath(id: string): void {
  town.recordDeath(id);
}

/** What happened beyond this conversation: witnesses, crimes, deaths and their ripple, escorts, the chronicle's news. */
function printConsequences(): void {
  for (const line of [...town.consequences(), ...town.takeNews()]) console.log(`  ${line}`);
}

function persist(): void {
  for (const id of town.ids) world.npcStates[id] = agents[id]!.state;
  saveWorld(config.saveFile, world);
}

/** What the player wears and carries. */
function printGear() {
  const p = world.player;
  const rank = playerGearRank(p.level);
  for (const slot of SLOTS) {
    const key = p.equipment?.[slot];
    const state = key ? (isBroken(key) ? " (broken)" : "") : "";
    console.log(`  ${slot.padEnd(7)} ${key ? `${itemLabel(key)}${state}` : "nothing"}`);
  }
  console.log(`  Fighting with ${equippedWeapon(p).name}; armour stops ${armorValue(p)} damage a hit. You can use gear up to tier ${rank} (level ${p.level}).`);
  console.log(`  Pack: ${describeBurden(p.inventory, playerSlots(p))}. ${Object.entries(p.inventory).map(([k, q]) => `${itemLabel(k)} x${q}`).join(", ") || "empty"}`);
}

function printSkills() {
  const { player } = world;
  console.log(`  ${formatTime(world)}`);
  console.log("  Your skills:");
  for (const s of SKILLS) {
    const level = skillLevel(player.skills, s);
    const progress = player.skillProgress[s] ?? 0;
    if (level === 0 && progress === 0) continue;
    const next = level < 5 ? ` (${progress}/${hoursToNextLevel(level)}h to ${TIERS[level + 1]})` : "";
    console.log(`    ${s.padEnd(13)} ${TIERS[level]}${next}`);
  }
  const teachable = teachableSkills(npc.persona, world);
  const cap = teachCap(npc.state, world.player);
  console.log(`  ${npc.persona.name} can teach (trust ${npc.state.relationship}, respect ${npc.state.respect}; teaches up to ${TIERS[cap]} now):`);
  if (teachable.length === 0) console.log("    nothing more");
  for (const t of teachable) {
    const next = skillLevel(world.player.skills, t.skill) + 1;
    const fee = feePerHour(npc.persona, npc.state, next);
    const locked = next > cap ? `, needs trust ${TRUST_FOR_TIER[next]}${next >= 4 ? " and respect" : ""}` : "";
    console.log(`    ${t.skill.padEnd(13)} up to ${TIERS[t.upTo]}, ${formatMoney(fee)}/hour now${locked}`);
  }
}

function printActions(who: NpcAgent, { actions, defeat, titles, spoils }: TurnResult) {
  for (const line of titles ?? []) console.log(`  [title] ${line}`);
  for (const line of spoils ?? []) console.log(`  [spoils] ${line}`);
  for (const a of actions) {
    if ((a.name === "attack_player" || a.name === "use_item") && a.ok) {
      // The message is written for the NPC ("You hit Traveler..."); show it as their move.
      const label = a.name === "use_item" ? "heals" : "attacks";
      console.log(`  [${who.persona.name} ${label}] ${a.message.replace(/^You /, "").replace(/\(rolled[^)]*\)\s*/, "")}`);
      continue;
    }
    console.log(`  [${a.ok ? "ok" : "failed"}${a.lie ? ", lying" : ""}] ${a.name} -> ${a.message}`);
  }
  if (defeat) {
    console.log(`  [defeated] ${defeat.message}`);
    for (const entry of defeat.log) console.log(`  ${entry}`);
  }
}

/** Run one NPC reply, streaming it to the terminal. */
async function npcSays(run: (onText: (delta: string) => void) => Promise<TurnResult>, who: NpcAgent = npc): Promise<TurnResult> {
  let started = false;
  // Background work (plans, summaries, the chronicle) makes way while the NPC talks.
  town.playerActs();
  const result = await run((delta) => {
    if (!started) stdout.write(`${who.persona.name}: `);
    started = true;
    stdout.write(delta);
  }).finally(() => town.resume());
  if (started) stdout.write("\n");
  printActions(who, result);
  return result;
}

const hpLine = () =>
  `  [HP] you ${world.player.hp}/${world.player.maxHp}, ${npc.persona.name} ${npc.state.hp}/${statsOf(npc.persona, npc.state).maxHp}`;

function printQuests() {
  const p = world.player;
  console.log(`  ${formatTime(world)}. You are level ${p.level}, rank ${rankForLevel(p.level)} (${p.xp}/${xpToNextLevel(p.level)} XP), ${formatMoney(p.money)}.`);
  if ((p.titles ?? []).length > 0) console.log(`  Titles: ${titleNames(p.titles!)}.`);
  if (p.quests.active.length === 0) console.log("  No active quests. Ask around for work.");
  for (const q of p.quests.active) {
    const { have, need } = questProgress(p, q);
    console.log(`  [${q.tier}] ${q.title} for ${q.giverName}: ${describeObjective(q)} (${have}/${need}). Reward ${formatMoney(q.reward.money)}.`);
  }
  if (p.quests.completed.length > 0) console.log(`  Completed: ${p.quests.completed.length}`);
}

/** Marriages, courtships, children on the way, and the town's children (N11.3). */
function printFamily() {
  const fam = familyOf(world);
  const name = (id: string) => (id === "player" ? "you" : (personas[id]?.name ?? id));
  const dead = (id: string) => id !== "player" && agents[id]?.isDead;
  if (fam.marriages.length + fam.courting.length + fam.expecting.length + Object.keys(fam.born).length === 0) console.log("  No weddings or births yet.");
  for (const m of fam.marriages) console.log(`  Married: ${name(m.a)} and ${name(m.b)}${m.day > 0 ? ` (day ${m.day})` : ""}${dead(m.a) || dead(m.b) ? " — widowed" : ""}`);
  for (const c of fam.courting) console.log(`  Courting: ${name(c.a)} and ${name(c.b)}, ${c.nights}/${config.family.courtshipNights} nights`);
  for (const e of fam.expecting) console.log(`  Expecting: ${name(e.parents[0])} and ${name(e.parents[1])}, due day ${e.dueDay}`);
  for (const p of Object.values(fam.born).filter((x) => x.bornOnDay !== undefined)) {
    const talents = p.talents?.length ? `; a gift for ${p.talents.join(", ").replaceAll("_", "-")}` : "";
    console.log(`  ${p.name}${agents[p.id]?.isDead ? " (dead)" : ""}: ${bornAge(p, world.day)} years old, child of ${(p.parents ?? []).map(name).join(" and ")}${talents}`);
  }
}

/** Who's where, and what they're doing. */
function printWhere() {
  console.log(`  ${formatTime(world)}. ${describeToday(world)} You are at ${PLACE_NAMES[world.player.place ?? "square"]}.`);
  for (const id of town.ids) {
    const a = agents[id]!;
    if (a.state.dormant) continue;
    if (a.isDead) {
      console.log(`  ${a.persona.name}: dead`);
      continue;
    }
    const busy = a.busyWith(world);
    console.log(`  ${a.persona.name}: ${describePlan(currentPlan(a.persona, a.state, world))}${busy && busy !== "asleep" ? `, busy ${busy}` : ""}`);
  }
}

/** Who's here, and maybe one of them speaks first (N6.3). */
async function arrive(): Promise<void> {
  setScene();
  scene = new Scene(world.player.place ?? "square");
  const here = present();
  console.log(`  You're at ${PLACE_NAMES[world.player.place ?? "square"]}. ${here.length > 0 ? `Here: ${here.map((a) => a.persona.name).join(", ")}.` : "Nobody you know is here."}`);
  for (const a of here) startEncounter(a.state);
  if (here.length > 0 && !here.includes(npc)) npc = here[0]!;
  printConsequences();
  // Men someone hired to settle a score may be lying in wait (N12.2).
  const ambusher = town.ambushAt(world.player.place);
  if (ambusher && !cliEngaged) {
    const t = creatureTemplates[ambusher.template]!;
    cliEngaged = ambusher.uid;
    console.log(`  [ambush] ${ambusher.name} was waiting for you!`);
    const round = creatureAmbush(t, ambusher, world, Math.random);
    for (const entry of round.log) console.log(`  ${entry}`);
    if (round.over === "player down") defeatedByCreature(t, ambusher);
    return;
  }
  await openers();
}

/** At most one NPC here speaks first, if any has a reason (npc/initiative.ts). */
async function openers(): Promise<void> {
  const here = present().filter((a) => !a.busyWith(world) && !a.state.conversationOver);
  const pick = pickOpener(here.map((a) => ({ a, opening: initiativeFor(a.persona, a.state, sceneFor(a)) })));
  if (!pick) return;
  const r = await npcSays((on) => pick.a.speakFirst(sceneFor(pick.a), on).then((t) => t ?? { text: "", actions: [] }), pick.a);
  scene.record(pick.a.persona.name, r.text);
}

/** The world as one NPC here sees it: who else is present. */
function sceneFor(a: NpcAgent): SavedWorld {
  world.present = present().filter((x) => x !== a).map((x) => x.persona.id);
  world.sceneLog = [];
  return world;
}

/**
 * Time passing for the whole village (N6): everyone lives their hours, together;
 * creatures roam; at night bandits deal and raid. Returns the news worth telling.
 */
function passAll(hours: number, { talking }: { talking?: string } = {}): string[] {
  // Whoever the player was talking to: the conversation is over, so it can become memories.
  for (const id of town.ids) town.summarise(id);
  return town.passHours(hours, { ...(talking ? { talkingTo: talking } : {}), keep: cliEngaged ? [cliEngaged] : [] });
}

/** Ask y/n. */
async function yes(question: string): Promise<boolean> {
  return (await rl.question(`  ${question} (y/n) `)).trim().toLowerCase().startsWith("y");
}

async function handleOffer() {
  // The NPC can only offer; a trade, lesson, quest, favour or service happens when the player says yes.
  const dilemma = (npc.persona.dilemmas ?? []).find((d) => d.id === npc.state.pendingDilemma);
  if (dilemma) console.log(`  [choice] ${npc.persona.name} puts it to you. /choose ${dilemma.options.map((o) => `${o.id} (${o.label})`).join(" or /choose ")}`);
  const hire = npc.state.pendingHire;
  if (hire) {
    if (await yes(`Hire ${npc.persona.name} for ${formatMoney(hire.wage)} a day (first day now)? You have ${formatMoney(world.player.money)}.`)) {
      await npcSays(async (onText) => {
        const r = await npc.acceptHire(world, onText);
        console.log(`  [${r.hire.ok ? "hired" : "no deal"}] ${r.hire.message}`);
        return r;
      });
    } else await npcSays((onText) => npc.declineHire(world, onText));
  }
  const order = npc.state.pendingCommission;
  if (order) {
    const quote = quoteCommission(npc.persona, npc.state, world, order);
    if (quote.ok && (await yes(`Order ${quote.message}? You have ${formatMoney(world.player.money)}.`))) {
      await npcSays(async (onText) => {
        const r = await npc.acceptCommissionOffer(world, onText);
        console.log(r.order.ok ? `  [ordered] ${r.order.message}` : `  ${r.order.message}`);
        return r;
      });
    } else await npcSays((onText) => npc.declineCommissionOffer(world, onText));
  }
  const questId = npc.state.pendingQuest;
  const quest = questId ? [...(npc.persona.quests ?? []), ...npc.state.questBoard].find((q) => q.id === questId) : undefined;
  if (quest) {
    if (await yes(`Accept [${quest.tier}] "${quest.title}": ${describeObjective(quest)} for ${formatMoney(questRewardMoney(npc.persona, quest, world))}?`)) {
      await npcSays(async (onText) => {
        const r = await npc.acceptQuest(world, onText, town.findEscortee);
        console.log(r.quest ? `  [quest accepted] ${r.quest}` : "  [quest no longer available]");
        // A defeat quest may bring its quarry out.
        for (const line of respawn()) console.log(`  [quest] ${line}`);
        return r;
      });
    } else await npcSays((onText) => npc.declineQuest(world, onText));
  }

  const lesson = npc.state.pendingTraining;
  if (lesson) {
    if (await yes(`Train ${lesson.skill} for ${lesson.hours}h for ${formatMoney(lesson.cost)}? You have ${formatMoney(world.player.money)}.`)) {
      await npcSays((onText) =>
        npc.acceptTraining(world, onText, (r) =>
          console.log(r.ok ? `  [trained ${r.hoursSpent}h${r.levelsGained ? ", level up!" : ""}] Now: ${formatTime(world)}${r.npcNote ? `\n  [rank] ${r.npcNote}` : ""}` : `  ${r.message}`),
        ),
      );
    } else await npcSays((onText) => npc.declineTraining(world, onText));
  }

  const purchase = npc.state.pendingPurchase;
  if (purchase) {
    if (await yes(`Sell your ${itemLabel(purchase.item)} for ${formatMoney(purchase.price)}?`)) {
      await npcSays(async (onText) => {
        const result = await npc.acceptPurchase(world, onText);
        console.log(`  [${result.sale.ok ? "sold" : "no sale"}] ${result.sale.message} You have ${formatMoney(world.player.money)}.`);
        return result;
      });
    } else await npcSays((onText) => npc.declinePurchase(world, onText));
  }

  const favour = npc.state.pendingFavour;
  if (favour) {
    const what = favour.kind === "lend_gold" ? `a loan of ${formatMoney(favour.amount ?? 0)}` : favour.kind.replace("_", " ");
    if (await yes(`Accept ${npc.persona.name}'s favour (${what})? You'll owe them one.`)) {
      await npcSays(async (onText) => {
        const r = await npc.acceptFavour(world, onText);
        console.log(`  [${r.favour.ok ? "favour" : "no favour"}] ${r.favour.message}`);
        return r;
      });
    } else await npcSays((onText) => npc.declineFavour(world, onText));
  }

  const amends = npc.state.pendingAmends;
  if (amends) {
    if (await yes(`Pay ${formatMoney(amends.fine)} to make amends with ${npc.persona.name}? You have ${formatMoney(world.player.money)}.`)) {
      await npcSays(async (onText) => {
        const r = await npc.acceptAmends(world, onText);
        console.log(`  [${r.amends.ok ? "amends" : "no amends"}] ${r.amends.message}`);
        return r;
      });
    } else await npcSays((onText) => npc.declineAmends(world, onText));
  }

  const service = npc.state.pendingService;
  if (service) {
    const what = service.kind === "lodging" ? "a room for the night" : "having your wounds tended";
    if (await yes(`Pay ${formatMoney(service.price)} for ${what}?`)) {
      const r = await npcSays((onText) => npc.acceptService(world, onText));
      const result = (r as TurnResult & { service?: { ok: boolean; message: string; sleepHours?: number } }).service;
      console.log(`  [${result?.ok ? "service" : "no service"}] ${result?.message ?? ""}`);
      if (result?.ok && result.sleepHours) {
        for (const entry of passAll(result.sleepHours)) console.log(`  ${entry}`);
        console.log(`  You wake at ${formatTime(world)}, rested (${world.player.hp}/${world.player.maxHp} HP).`);
        await arrive();
      }
    } else await npcSays((onText) => npc.declineService(world, onText));
  }

  const offer = npc.state.pendingOffer;
  if (!offer) return;
  if (await yes(`Buy ${itemLabel(offer.item)} for ${formatMoney(offer.price)}?`)) {
    await npcSays(async (onText) => {
      const result = await npc.acceptOffer(world, onText);
      console.log(`  [${result.sale.ok ? "sold" : "no sale"}] ${result.sale.message}`);
      return result;
    });
  } else await npcSays((onText) => npc.declineOffer(world, onText));
}

/** The creature the player is fighting (after /hunt), if any. */
let cliEngaged: string | null = null;
// Creatures due at the start (the market crowd by day, the wolves at night, ...).
respawn();

/**
 * Read the player's line. In a fight they have config.combatTickSeconds to answer;
 * null means time ran out and they let the turn pass.
 */
async function readLine(): Promise<string | null> {
  const fighting = npc.state.inCombat || (cliEngaged !== null && !world.creatures[cliEngaged]?.outcome);
  if (!fighting || config.combatTickSeconds <= 0) return (await rl.question("You: ")).trim();
  const signal = AbortSignal.timeout(config.combatTickSeconds * 1000);
  try {
    return (await rl.question(`You (${config.combatTickSeconds}s): `, { signal })).trim();
  } catch (err) {
    if (!signal.aborted) throw err;
    stdout.write("\n");
    return null;
  }
}

/** Spawn rules (game/spawning.ts) at the current time: groups that just came due turn up, ended ones move on. */
function respawn(): string[] {
  return town.respawn(cliEngaged ? [cliEngaged] : []);
}

/** A creature dropped the player: apply the defeat rule. Returns true if the game is over. */
function defeatedByCreature(t: CreatureTemplate, c: Creature): boolean {
  cliEngaged = null;
  const defeat = creatureBeatsPlayer(t, c, world);
  console.log(`  [defeated] ${defeat.message}`);
  if (defeat.rule === "permadeath") {
    persist();
    console.log("  Game over: this world is finished (start again with --new).");
    return true;
  }
  for (const entry of passAll(defeat.hoursOut)) console.log(`  ${entry}`);
  return false;
}

/** How the encounter with `who` ended, once it has (they died, fled, or knocked you out). */
function reportEnding(who: NpcAgent): void {
  const s = who.state;
  if (who.isDead) {
    recordDeath(who.persona.id);
    console.log(
      s.deathCause === "old age"
        ? `  ${who.persona.name} is gone, taken by old age. They won't be coming back.`
        : `  ${who.persona.name} falls and doesn't get up. They're dead, and they won't be coming back.`,
    );
  } else if (s.outcome === "unconscious") console.log(`  ${who.persona.name} drops, out cold. They'll come round in a few hours. (/loot ${who.persona.id}, if you're that kind.)`);
  else if (s.outcome === "player fled") console.log(`  You get away from ${who.persona.name}.`);
  else if (s.outcome === "fled") console.log(`  ${who.persona.name} runs off into the village.`);
  else if (s.outcome === "knocked out") console.log(`  You come to at ${formatTime(world)}, aching. Rest (/wait) or a salve will heal you.`);
  else if (s.conversationOver) console.log(`  ${who.persona.name} turns away.`);
}

/** Can the player talk to `who` now? Prints why not and returns false if not. */
function canTalkTo(who: NpcAgent): boolean {
  if (who.isDead) {
    const d = world.deaths[who.persona.id] as { name: string; killedBy: string; day: number } | undefined;
    console.log(d ? `  ${d.name} is dead. They ${describeDeath(d).replace(/^was /, "were ")}.` : `  ${who.persona.name} is dead.`);
    return false;
  }
  if (!present().includes(who) && !who.state.inCombat) {
    const plan = currentPlan(who.persona, who.state, world);
    console.log(`  ${who.persona.name} isn't here: they're ${describePlan(plan)}. (/where, /go)`);
    return false;
  }
  if (who.state.conversationOver && !who.state.inCombat) {
    console.log(`  ${who.persona.name} has nothing more to say to you for now. Come back later.`);
    return false;
  }
  const busy = who.busyWith(world);
  if (busy) {
    console.log(`  ${who.persona.name} is ${busy === "asleep" ? "asleep" : `busy ${busy}`}. Try /wait.`);
    return false;
  }
  return true;
}

/** What the last command changed, as typed events (T13): the same ones the browser animates. */
function printEvents(before: EventFrame): void {
  const events = turnEvents(before, captureFrame(world, agents));
  if (events.length > 0) console.log(`  [events] ${events.map((e) => describeEvent(e, (id) => personas[id]?.name ?? world.creatures[id]?.name ?? id)).join(" · ")}`);
}

if (config.planning) town.queuePlans();
await arrive();

let frame: EventFrame | null = null;
while (!world.player.death) {
  if (frame) printEvents(frame);
  let line: string | null;
  try {
    line = await readLine();
  } catch {
    break; // input closed (Ctrl+D)
  }
  frame = captureFrame(world, agents);
  for (const l of town.takeNews()) console.log(`  [news] ${l}`);
  if (line === null) {
    // Too slow: the turn is a no-op for the player, and the opponent strikes.
    console.log("  [too slow] You hesitate.");
    const foe = cliEngaged ? world.creatures[cliEngaged] : undefined;
    const t = foe && creatureTemplates[foe.template];
    if (foe && t) {
      const round = creatureTurn(t, foe, world, Math.random);
      for (const entry of round.log.slice(1)) console.log(`  ${entry}`);
      if (round.over === "player down" && defeatedByCreature(t, foe)) break;
    } else {
      printActions(npc, npc.playerHesitates(world));
      console.log(hpLine());
    }
    persist();
    continue;
  }
  if (!line) continue;
  if (line === "/quit") break;
  if (line === "/save") {
    persist();
    console.log(`  Saved ${config.saveFile}.`);
    continue;
  }
  if (line === "/state") {
    console.log({ npc: npc.state, player: world.player });
    continue;
  }
  const fighting = npc.state.inCombat || (cliEngaged !== null && !world.creatures[cliEngaged]?.outcome);

  if (line.startsWith("/trust")) {
    // Testing shortcut: set trust directly (secrets unlock above 50).
    const value = Number(line.split(/\s+/)[1]);
    if (Number.isFinite(value)) npc.state.relationship = Math.max(-100, Math.min(100, value));
    console.log(`  ${npc.persona.name}'s trust is now ${npc.state.relationship}`);
    continue;
  }

  // ---- Getting around (N6): no model call ----
  if (line === "/where") {
    printWhere();
    continue;
  }
  const go = line.match(/^\/go\s+(.+)$/);
  if (go) {
    const place = parsePlace(go[1]!);
    if (!place || place === "home") {
      console.log(`  Where? Places: ${PLACES.filter((p) => p !== "home").join(", ")}.`);
      continue;
    }
    if (fighting) {
      console.log("  You can't walk away from a fight. Flee or fight on.");
      continue;
    }
    if (place === world.player.place) {
      console.log(`  You're already at ${PLACE_NAMES[place]}.`);
      continue;
    }
    const crossed = (world.minute ?? 0) + WALK_MINUTES >= 60;
    advanceMinutes(world, WALK_MINUTES);
    // Crossing the hour, the village gets its hour too (the clock is put back first: passAll moves it).
    if (crossed) {
      advanceMinutes(world, -60);
      for (const entry of passAll(1)) console.log(`  ${entry}`);
    }
    world.player.place = place;
    await arrive();
    persist();
    continue;
  }
  const to = line.match(/^\/to\s+(.+)$/);
  if (to) {
    const who = addressedByName(to[1]!, Object.values(agents)) ?? agents[to[1]!.trim().toLowerCase()];
    if (!who) {
      console.log(`  Who? ${town.ids.join(", ")}.`);
      continue;
    }
    if (canTalkTo(who)) {
      npc = who;
      console.log(`  You turn to ${who.persona.name}.`);
    }
    continue;
  }
  const look = line.match(/^\/look(?:\s+(.+))?$/);
  if (look) {
    const target = look[1]?.trim();
    if (target === "me" || target === "myself") console.log(`  ${describePlayerAppearance(world.player, world)}`);
    else {
      const who = target ? (addressedByName(target, Object.values(agents)) ?? agents[target.toLowerCase()]) : npc;
      if (!who || (!present().includes(who) && !who.isDead)) console.log("  They aren't here to look at.");
      else console.log(`  ${describeNpcAppearance(who.persona, who.state, world)}`);
    }
    continue;
  }
  const journal = line.match(/^\/journal(?:\s+(.+))?$/);
  if (journal) {
    const who = journal[1] ? (addressedByName(journal[1], Object.values(agents)) ?? agents[journal[1].trim().toLowerCase()]) : undefined;
    const groups = journalByNpc(world.player, names(), who?.persona.id);
    if (groups.length === 0) console.log("  Nothing in your journal yet.");
    for (const g of groups) {
      const a = Object.values(agents).find((x) => x.persona.name === g.who);
      const bond = a ? ` (${friendshipOf(a.state)}, trust ${a.state.relationship})` : "";
      console.log(`  ${g.who}${bond}:`);
      for (const l of g.lines) console.log(`    ${l}`);
    }
    continue;
  }

  if (line === "/creatures") {
    const all = Object.values(world.creatures);
    if (all.length === 0) console.log("  No creatures in this world.");
    for (const c of all) {
      const t = creatureTemplates[c.template];
      console.log(`  ${t ? describeCreature(t, c, world.day) : `${c.name} (unknown kind "${c.template}")`}`);
    }
    continue;
  }

  // Fight a creature, or run from one. All in code: no model call.
  const hunt = line.match(/^\/(hunt|escape)\s+(.+)$/);
  if (hunt) {
    const name = hunt[2]!.trim().toLowerCase();
    const c = Object.values(world.creatures).find((x) => x.name.toLowerCase() === name || x.uid === name);
    const t = c && creatureTemplates[c.template];
    if (!c || !t || c.outcome) {
      console.log("  No such creature around. /creatures lists them.");
      continue;
    }
    if (cliEngaged && cliEngaged !== c.uid && !world.creatures[cliEngaged]?.outcome) {
      console.log(`  You're fighting ${world.creatures[cliEngaged]!.name}. Deal with them first.`);
      continue;
    }
    if (hunt[1] === "escape" && cliEngaged !== c.uid) {
      console.log(`  You're not fighting ${c.name}.`);
      continue;
    }
    cliEngaged = c.uid;
    const round = hunt[1] === "hunt" ? fightCreature(t, c, world, Math.random) : fleeCreature(t, c, world, Math.random);
    for (const entry of round.log) console.log(`  ${entry}`);
    if (hunt[1] === "hunt" && !round.over) for (const entry of town.companionsHit({ creature: c.uid })) console.log(`  [party] ${entry}`);
    if (c.outcome && !round.over) {
      cliEngaged = null;
      persist();
      continue;
    }
    // Killing or routing it counts towards defeat quests for its kind.
    if (round.over === "creature dead" || round.over === "creature fled") {
      for (const entry of recordCreatureDefeat(world.player, c.template)) console.log(`  [quest] ${entry}`);
    }
    if (round.over && round.over !== "player down") cliEngaged = null;
    if (round.over === "player down" && defeatedByCreature(t, c)) break;
    persist();
    continue;
  }

  // Gear and pack: free, no model call.
  if (line === "/gear") {
    printGear();
    continue;
  }
  const equipLine = line.match(/^\/equip\s+(.+)$/);
  if (equipLine) {
    console.log(`  ${equip(world.player, playerGearRank(world.player.level), equipLine[1]!.trim(), "player").message}`);
    persist();
    continue;
  }
  const unequipLine = line.match(/^\/unequip\s+(weapon|armor)$/);
  if (unequipLine) {
    console.log(`  ${unequip(world.player, unequipLine[1] as Slot, playerSlots(world.player)).message}`);
    persist();
    continue;
  }

  if (line === "/quests") {
    printQuests();
    continue;
  }
  const wait = line.match(/^\/wait(?:\s+(\d+))?$/);
  if (wait) {
    if (fighting) {
      console.log("  You can't wait around in the middle of a fight.");
      continue;
    }
    const hours = Math.max(1, Math.min(24, Number(wait[1] ?? 1)));
    const startHour = world.hour;
    const log = passAll(hours);
    const healed = restPlayer(world.player, startHour, hours);
    for (const entry of log) console.log(`  ${entry}`);
    console.log(`  It's now ${formatTime(world)}.${healed > 0 ? ` You rested and healed ${healed} HP (${world.player.hp}/${world.player.maxHp}).` : ""}`);
    await arrive();
    persist();
    continue;
  }
  const use = line.match(/^\/use\s+(.+)$/);
  if (use) {
    // Using your own item is done in code; mid-fight it costs your turn.
    const r = npc.useItem(world, use[1]!.trim());
    console.log(`  ${r.use.message}`);
    printActions(npc, r);
    if (npc.state.inCombat || r.defeat) console.log(hpLine());
    persist();
    continue;
  }
  if (line === "/retrieve") {
    console.log(`  ${npc.retrieve(world).message}`);
    persist();
    continue;
  }

  // ---- The social web, work and growth: no model call (N7-N12) ----
  if (line === "/factions") {
    for (const f of describeStandings(world.player)) console.log(`  ${f.name}: ${f.rank} (standing ${f.standing})${f.member ? ", a member" : ""}`);
    continue;
  }
  if (line === "/reputation") {
    const rep = world.player.reputation;
    console.log(`  The village sees you as ${describeReputation(rep) ?? "nobody in particular"}.${rep ? ` (trust ${rep.trust}, fear ${rep.fear}, respect ${rep.respect}, liking ${rep.affection})` : ""}`);
    if (bountyOf(world.player) > 0) console.log(`  You're wanted: the fine is ${formatMoney(bountyOf(world.player))}. /payfine or /surrender to a guard.`);
    continue;
  }
  const raise = line.match(/^\/raise\s+(\w+)$/);
  if (raise) {
    console.log(`  ${raiseAttribute(world.player, raise[1]!).message}`);
    persist();
    continue;
  }
  const join = line.match(/^\/join\s+(\w+)$/);
  if (join) {
    console.log(`  ${joinFaction(world.player, join[1]!.toLowerCase()).message}`);
    persist();
    continue;
  }
  if (line === "/party") {
    const party = town.companions();
    if (party.length === 0) console.log("  Nobody's travelling with you. Ask someone to come along (some will, for a wage).");
    for (const a of party) console.log(`  ${a.persona.name}: ${formatMoney(a.state.companion!.wage)} a day, loyalty ${a.state.companion!.loyalty}${a.state.companion!.unpaidDays ? `, ${a.state.companion!.unpaidDays} day(s) unpaid` : ""}`);
    continue;
  }
  const dismissLine = line.match(/^\/dismiss(?:\s+(.+))?$/);
  if (dismissLine) {
    const who = dismissLine[1] ? (addressedByName(dismissLine[1], Object.values(agents)) ?? agents[dismissLine[1].trim().toLowerCase()]) : town.companions()[0];
    console.log(who ? `  ${dismiss(who.persona, who.state, world).message}` : "  Nobody's with you.");
    persist();
    continue;
  }
  if (line === "/family") {
    printFamily();
    continue;
  }
  if (line === "/propose") {
    if (fighting) {
      console.log("  Not in the middle of a fight.");
      continue;
    }
    if (!canTalkTo(npc)) continue;
    const r = propose(world, members(), npc.persona.id);
    console.log(`  ${r.message}`);
    // Only a real answer goes to the NPC: a child, or romance switched off, never reaches the model (design rule 7).
    if (r.ok || (!npc.persona.minor && config.content.romance && npc.persona.romance?.open === true)) {
      const said = r.ok
        ? `${world.player.name} asked you to marry them, and you said yes. You are married now. Say how you feel.`
        : `${world.player.name} asked you to marry them. You're not ready for that; let them down in your own way.`;
      await npcSays((onText) => npc.hear(said, sceneFor(npc), onText));
    }
    persist();
    continue;
  }
  if (line === "/chronicle") {
    const log = (world.directorLog ?? []).slice(-10);
    if (log.length === 0) console.log("  The chronicle is empty so far. It's written at midnight.");
    for (const e of log) console.log(`  Day ${e.day} ${e.kind}: ${e.ok ? "accepted" : `rejected (${e.reason})`} ${e.proposal}`);
    const lore = (world.lore ?? []).slice(-5);
    for (const l of lore) console.log(`  - ${l.text}`);
    continue;
  }
  if (line === "/forage" || line.startsWith("/craft")) {
    if (fighting) {
      console.log("  Not in the middle of a fight.");
      continue;
    }
    const craft = line.match(/^\/craft\s+(.+)$/);
    const r = craft ? playerCraft(world.player, craft[1]!, Math.random, world.day) : line === "/forage" ? forage(world.player, Math.random, world.day) : null;
    if (!r) {
      console.log("  Usage: /craft <item>");
      continue;
    }
    console.log(`  ${r.message}`);
    for (const note of r.notes) console.log(`  [quest] ${note}`);
    if (r.ok && r.hours > 0) for (const entry of passAll(r.hours)) console.log(`  ${entry}`);
    persist();
    continue;
  }
  if (line === "/sneak") {
    const watchers = present().filter((a) => !a.busyWith(world)).map((a) => ({ persona: a.persona, state: a.state }));
    console.log(`  ${sneak(world, watchers, Math.random).message}`);
    persist();
    continue;
  }
  const loot = line.match(/^\/loot\s+(\S+)(?:\s+(.+))?$/);
  if (loot) {
    const who = addressedByName(loot[1]!, Object.values(agents)) ?? agents[loot[1]!.toLowerCase()];
    if (!who || (!who.isDead && who.state.outcome !== "unconscious")) {
      console.log("  There's nobody here lying still to rob.");
      continue;
    }
    const witnesses = present().filter((a) => a !== who).map((a) => a.persona.id);
    console.log(`  ${lootBody(who.persona, who.state, world, witnesses, loot[2]?.trim()).message}`);
    printConsequences();
    persist();
    continue;
  }
  if (line === "/payfine" || line === "/surrender") {
    const guard = present().find((a) => a.persona.guard);
    if (!guard) {
      console.log("  There's no guard here to settle with. Corporal Hale keeps the gate.");
      continue;
    }
    if (line === "/payfine") console.log(`  ${payFine(world.player).message}`);
    else {
      const r = surrender(world.player);
      console.log(`  ${r.message}`);
      if (r.ok) for (const entry of passAll(r.hours)) console.log(`  ${entry}`);
    }
    persist();
    continue;
  }

  // Everything below talks to the NPC you're with: they have to be here, awake and free.
  if (line.startsWith("/") && !canTalkTo(npc)) continue;

  // Repairs cost money: show the price and ask first.
  const repairLine = line.match(/^\/repair\s+(.+)$/);
  if (repairLine) {
    const which = repairLine[1]!.trim();
    const quote = repairForPlayer(which, { persona: npc.persona, state: npc.state, world, rng: Math.random }, { quote: true });
    if (!quote.ok) {
      console.log(`  ${quote.message}`);
      continue;
    }
    if (await yes(`${quote.message} You have ${formatMoney(world.player.money)}. Pay?`)) {
      await npcSays((onText) => npc.repair(which, world, onText, (r) => console.log(`  [${r.ok ? "repaired" : "no repair"}] ${r.message}`)));
      persist();
    }
    continue;
  }

  try {
    const who = npc;
    const social = line.match(/^\/(persuade|intimidate)\s+(.+)/);
    const lie = line.match(/^\/lie\s+(.+)/);
    const give = line.match(/^\/give\s+(.+)/);
    const ask = line.match(/^\/ask\s+(\S+)(?:\s+(.+))?/);
    const commission = line.match(/^\/commission\s+(.+)/);
    if (social) {
      const kind = social[1] as "persuade" | "intimidate";
      await npcSays((onText) =>
        npc.attempt(kind, social[2]!, sceneFor(npc), onText, (r) =>
          console.log(r.ok ? `  [${kind} ${r.success ? "succeeded" : "failed"}] ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}` : `  ${r.message}`),
        ),
      );
    } else if (lie) {
      await npcSays((onText) =>
        npc.hearLie(lie[1]!, sceneFor(npc), onText, (r) => console.log(r.ok ? `  [lie ${r.believed ? "believed" : "spotted"}] (${r.roll})` : `  ${r.message}`)),
      );
    } else if (give) {
      await npcSays(async (onText) => {
        const r = await npc.receiveGift(give[1]!.trim(), sceneFor(npc), onText);
        console.log(`  [${r.gift.ok ? "gift" : "no gift"}] ${r.gift.message}`);
        return r;
      });
    } else if (line === "/introduce") {
      await npcSays((onText) => npc.introduceSelf(sceneFor(npc), onText));
    } else if (ask) {
      const kind = ask[1]!.replace("-", "_") as FavourKind;
      if (!FAVOUR_KINDS.includes(kind)) {
        console.log(`  Favours: ${FAVOUR_KINDS.join(", ")} (hide_item takes an item).`);
        continue;
      }
      await npcSays(async (onText) => {
        const r = await npc.askFavour(kind, sceneFor(npc), ask[2]?.trim(), onText);
        console.log(`  [favour ${r.favour.ok ? "offered" : "refused"}] ${r.favour.message}`);
        return r;
      });
    } else if (line === "/repay") {
      await npcSays(async (onText) => {
        const r = await npc.repay(sceneFor(npc), onText);
        console.log(`  ${r.repay.message}`);
        return r;
      });
    } else if (commission) {
      const quote = quoteCommission(npc.persona, npc.state, world, commission[1]!);
      if (!quote.ok) {
        console.log(`  ${quote.message}`);
        continue;
      }
      if (!(await yes(`Order ${quote.message}? You have ${formatMoney(world.player.money)}.`))) continue;
      await npcSays(async (onText) => {
        const r = await npc.commission(commission[1]!, sceneFor(npc), onText);
        console.log(r.order.ok ? `  [ordered] ${r.order.message}` : `  ${r.order.message}`);
        return r;
      });
    } else if (line === "/collect") {
      await npcSays(async (onText) => {
        const r = await npc.collect(sceneFor(npc), onText);
        console.log(`  [${r.collect.ok ? "collected" : "not yet"}] ${r.collect.message}`);
        return r;
      });
    } else if (line.startsWith("/haggle")) {
      const words = line.slice("/haggle".length).trim() || "Can you do better on the price?";
      await npcSays((onText) =>
        npc.haggle(words, sceneFor(npc), onText, (r) =>
          console.log(r.ok ? `  [haggle ${r.success ? "succeeded" : "failed"}] ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}` : `  ${r.message}`),
        ),
      );
    } else if (line === "/skills") {
      printSkills();
      continue;
    } else if (line.startsWith("/train")) {
      const m = line.match(/^\/train\s+(.+?)(?:\s+(\d+))?$/);
      const skill = m ? parseSkill(m[1]!) : null;
      if (!skill) {
        console.log("  Usage: /train <skill> [hours], e.g. /train smithing 4. See /skills.");
        continue;
      }
      const hours = m?.[2] ? Number(m[2]) : DEFAULT_SESSION_HOURS;
      // Training costs money, so show the price and ask first.
      const quote = quoteTraining(npc.persona, npc.state, world, skill, hours);
      if (!quote.ok) {
        console.log(`  ${quote.message}`);
        continue;
      }
      const short = quote.hours < hours ? ` (only ${quote.hours}h: ${quote.endLevel >= quote.cap ? "that's as far as they'll teach" : "that's all you can afford"})` : "";
      if (!(await yes(`${quote.message}${short}. You have ${formatMoney(world.player.money)}. Pay?`))) continue;
      await npcSays((onText) =>
        npc.train(skill, hours, world, onText, (r) =>
          console.log(r.ok ? `  [trained ${r.hoursSpent}h${r.levelsGained ? `, level up!` : ""}] ${r.message.split(". ").slice(1).join(". ")} Now: ${formatTime(world)}${r.npcNote ? `\n  [rank] ${r.npcNote}` : ""}` : `  ${r.message}`),
        ),
      );
    } else if (line === "/turnin") {
      await npcSays(async (onText) => {
        const r = await npc.turnIn(world, onText);
        console.log(r.turnIn.completed.length > 0 ? `  [quest complete] ${r.turnIn.completed.map((q) => q.title).join(", ")}. You are level ${world.player.level}, ${formatMoney(world.player.money)}.` : `  ${r.turnIn.message}`);
        for (const line of r.turnIn.titles ?? []) console.log(`  [title] ${line}`);
        return r;
      });
    } else if (line.startsWith("/steal")) {
      const item = line.slice("/steal".length).trim();
      if (!item) {
        console.log(`  Steal what? ${npc.persona.name} has: ${Object.keys(npc.state.inventory).map(itemLabel).join(", ") || "nothing"}.`);
        continue;
      }
      const witnesses = present().filter((a) => a !== npc && !a.busyWith(world)).map((a) => a.persona.id);
      await npcSays(async (onText) => {
        const r = await npc.steal(item, sceneFor(npc), witnesses, onText);
        console.log(`  [${r.theft.ok ? (r.theft.success ? "stolen" : "caught") : "no"}] ${r.theft.message}`);
        return r;
      });
    } else if (line.startsWith("/choose")) {
      const option = line.slice("/choose".length).trim();
      await npcSays(async (onText) => {
        const r = await npc.chooseDilemma(option, sceneFor(npc), onText);
        console.log(`  [${r.choice.ok ? "chosen" : "no"}] ${r.choice.message}${r.choice.effects.length ? ` (${r.choice.effects.join("; ")})` : ""}`);
        return r;
      });
    } else if (line === "/subdue" || line.startsWith("/ability")) {
      const id = line.startsWith("/ability") ? parseAbility(line.slice("/ability".length)) : null;
      if (line.startsWith("/ability") && !id) {
        const known = abilitiesFor(world.player.skills);
        console.log(`  Abilities you know: ${known.map((a) => `${a.id} (${a.mp} MP: ${a.describe})`).join(", ") || "none yet"}. You have ${world.player.mp ?? 0} MP.`);
        continue;
      }
      await npcSays((onText) =>
        id
          ? npc.ability(id, sceneFor(npc), onText, (r) => console.log(`  [${ABILITIES[id].name}] ${r.message.replace(/\(rolled[^)]*\)\s*/, "")}`))
          : npc.attackedByPlayer(sceneFor(npc), onText, (r) => console.log(`  [subdue] ${r.damage > 0 ? `hit for ${r.damage}` : r.ok ? "missed" : r.message} ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}`), { subdue: true }),
      );
      for (const l of town.companionsHit({ npc: npc.persona.id })) console.log(`  [party] ${l}`);
      console.log(hpLine());
    } else if (line === "/flee") {
      await npcSays((onText) =>
        npc.playerFlees(world, onText, (r) =>
          console.log(r.ok ? `  [flee ${r.escaped ? "succeeded" : "failed"}] ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}` : `  ${r.message}`),
        ),
      );
      if (npc.state.inCombat) console.log(hpLine());
    } else if (line === "/attack") {
      await npcSays((onText) =>
        npc.attackedByPlayer(sceneFor(npc), onText, (r) => console.log(`  [attack] ${r.damage > 0 ? `hit for ${r.damage}` : r.ok ? "missed" : r.message} ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}`)),
      );
      for (const l of town.companionsHit({ npc: npc.persona.id })) console.log(`  [party] ${l}`);
      console.log(hpLine());
    } else if (line.startsWith("/")) {
      console.log("  Unknown command.");
      continue;
    } else {
      // Plain talk: whoever is named (if here) answers, and another may chime in (N6.5).
      const here = present();
      const named = addressedByName(line, here);
      if (named && named !== npc && canTalkTo(named)) npc = named;
      if (!canTalkTo(npc)) continue;
      if (here.length <= 1 || npc.state.inCombat) {
        await npcSays((onText) => npc.respond(line, sceneFor(npc), onText));
      } else {
        let speaker: string | null = null;
        const turn = await sceneTurn(scene, here, npc, line, world, Math.random, (id, delta) => {
          if (speaker !== id) stdout.write(`${speaker ? "\n" : ""}${agents[id]!.persona.name}: `);
          speaker = id;
          stdout.write(delta);
        });
        if (speaker) stdout.write("\n");
        printActions(npc, turn.addressed.result);
        if (turn.interjection) printActions(agents[turn.interjection.id]!, turn.interjection.result);
        if (turn.vouched) console.log(`  [${turn.vouched} put in a good word for you]`);
      }
    }

    if (who.state.inCombat && line !== "/attack" && line !== "/flee") console.log(hpLine());
    if (who.state.outcome || who.state.conversationOver) {
      reportEnding(who);
      if (who.state.outcome === "knocked out") {
        // You come round later; the fight is over. Companions who saw you fall lose heart.
        for (const l of town.companionsEndangered()) console.log(`  ${l}`);
        who.state.outcome = null;
        who.state.conversationOver = false;
      }
    }
    if (!who.state.outcome) await handleOffer();
    printConsequences();
    persist();
  } catch (err) {
    console.error(`\n[error] ${(err as Error).message}`);
  }
}

persist();
if (world.player.death) console.log(`\nYou were killed by ${world.player.death.killedBy}. Game over: this world is finished (start again with --new).`);
else console.log(`\nYou leave Millbrook for now. (${formatTime(world)})`);
rl.close();
