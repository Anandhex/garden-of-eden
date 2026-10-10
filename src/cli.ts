import { readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { argv, stdin, stdout } from "node:process";
import { config } from "./config.js";
import { formatTime } from "./game/clock.js";
import {
  type Creature,
  creatureBeatsPlayer,
  type CreatureTemplate,
  creatureTurn,
  describeCreature,
  fightCreature,
  fleeCreature,
  isNotable,
  loadCreatureTemplates,
  passCreatureTime,
} from "./game/creatures.js";
import { DEMO_SPAWNS } from "./world/world.js";
import { DeathRegistry, describeDeath } from "./game/deaths.js";
import { importDeaths, loadWorld, newWorld, saveWorld, type SavedWorld } from "./game/save.js";
import { rankForLevel, xpToNextLevel } from "./game/levels.js";
import { titleNames } from "./game/titles.js";
import { countItem } from "./game/crafting.js";
import { restPlayer } from "./game/healing.js";
import { questRewardMoney } from "./game/quests.js";
import { itemLabel } from "./game/items.js";
import {
  DEFAULT_SESSION_HOURS,
  feePerHour,
  hoursToNextLevel,
  parseSkill,
  quoteTraining,
  TRUST_FOR_TIER,
  teachableSkills,
  trustCap,
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

// Pick the NPC: `npm run chat -- pell`. Defaults to brena.
const NPC_DIR = new URL("./data/npcs/", import.meta.url);
const available = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const newGame = argv.includes("--new");
const npcId = argv.find((arg) => !arg.startsWith("--") && arg !== argv[0] && arg !== argv[1]) ?? "brena";
if (!available.includes(npcId)) {
  console.error(`No NPC "${npcId}". Available: ${available.join(", ")}`);
  process.exit(1);
}
// Validate every NPC file up front, so a typo in any of them fails now, not mid-conversation.
const personas = Object.fromEntries(
  available.map((id) => [id, parsePersona(JSON.parse(readFileSync(new URL(`${id}.json`, NPC_DIR), "utf8")), `${id}.json`)]),
);
const persona = personas[npcId]!;

// Death is permanent: a dead NPC can't be talked to again, in this run or any later one.
const creatureTemplates = loadCreatureTemplates();
let world: SavedWorld = newGame
  ? newWorld(personas, creatureTemplates)
  : importDeaths(loadWorld(config.saveFile, personas, creatureTemplates), config.deathsFile);
const deaths = new DeathRegistry(config.deathsFile);
// With permadeath, a dead player's save is over (config.playerDefeat).
if (world.player.death) {
  const d = world.player.death;
  console.log(`You were killed by ${d.killedBy} on day ${d.day}. This world is over; start a new one with --new.`);
  process.exit(0);
}
const death = world.deaths[npcId] as { name: string; killedBy: string; day: number } | undefined;
if (death) {
  console.log(`${death.name} is dead. They ${describeDeath(death).replace(/^was /, "were ")}, and nothing brings them back.`);
  process.exit(0);
}

const llm = new OllamaProvider();
const npc = new NpcAgent(persona, llm, undefined, world.npcStates[npcId]);
// A new encounter: however the last one ended (they fled, you fled, you were knocked out), it's over.
startEncounter(npc.state);
const rl = createInterface({ input: stdin, output: stdout });

console.log(`Loading ${config.model}...`);
try {
  await llm.warmUp();
} catch (err) {
  console.error(`Could not reach Ollama at ${config.ollamaHost}. Is it running? (${(err as Error).message})`);
  process.exit(1);
}
console.log(`Talking to ${npc.persona.name}.`);
console.log(
  `Commands: /quests, /turnin, /wait <hours>, /use <item>, /haggle <words>, /persuade <words>, /intimidate <words>, /attack, /flee, /train <skill> [hours], /skills, /gear, /equip <item>, /unequip <weapon|armor>, /repair <weapon|armor|item>, /creatures, /hunt <creature>, /escape <creature>, /state, /save, /trust <-100..100>, /quit\n`,
);

/** Write the NPC's death to the permanent record, so quitting (or a crash) can't undo it. */
function recordDeath(): void {
  deaths.record({ npcId, name: npc.persona.name, day: world.day, hour: world.hour, killedBy: npc.state.deathCause ?? world.player.name });
  world.deaths[npcId] = deaths.get(npcId)!;
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
  const byTrust = trustCap(npc.state.relationship);
  console.log(`  ${npc.persona.name} can teach (trust ${npc.state.relationship}, teaches up to ${TIERS[byTrust]} at this trust):`);
  if (teachable.length === 0) console.log("    nothing more");
  for (const t of teachable) {
    const next = skillLevel(world.player.skills, t.skill) + 1;
    const fee = feePerHour(npc.persona, npc.state, next);
    const locked = next > byTrust ? `, needs trust ${TRUST_FOR_TIER[next]}` : "";
    console.log(`    ${t.skill.padEnd(13)} up to ${TIERS[t.upTo]}, ${formatMoney(fee)}/hour now${locked}`);
  }
}

function printActions({ actions, defeat, titles }: TurnResult) {
  for (const line of titles ?? []) console.log(`  [title] ${line}`);
  for (const a of actions) {
    if ((a.name === "attack_player" || a.name === "use_item") && a.ok) {
      // The message is written for the NPC ("You hit Traveler..."); show it as their move.
      const label = a.name === "use_item" ? "heals" : "attacks";
      console.log(`  [${npc.persona.name} ${label}] ${a.message.replace(/^You /, "").replace(/\(rolled[^)]*\)\s*/, "")}`);
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
async function npcSays(run: (onText: (delta: string) => void) => Promise<TurnResult>): Promise<void> {
  let started = false;
  const result = await run((delta) => {
    if (!started) stdout.write(`${npc.persona.name}: `);
    started = true;
    stdout.write(delta);
  });
  if (started) stdout.write("\n");
  printActions(result);
}

const hpLine = () =>
  `  [HP] you ${world.player.hp}/${world.player.maxHp}, ${npc.persona.name} ${npc.state.hp}/${statsOf(npc.persona, npc.state).maxHp}`;

function printQuests() {
  const p = world.player;
  console.log(`  ${formatTime(world)}. You are level ${p.level}, rank ${rankForLevel(p.level)} (${p.xp}/${xpToNextLevel(p.level)} XP), ${formatMoney(p.money)}.`);
  if ((p.titles ?? []).length > 0) console.log(`  Titles: ${titleNames(p.titles!)}.`);
  if (p.quests.active.length === 0) console.log("  No active quests. Ask around for work.");
  for (const q of p.quests.active) {
    const have = countItem(p.inventory, q.objective.item);
    console.log(`  [${q.tier}] ${q.title} for ${q.giverName}: bring ${q.objective.qty} ${q.objective.item} (have ${have}). Reward ${formatMoney(q.reward.money)}.`);
  }
  if (p.quests.completed.length > 0) console.log(`  Completed: ${p.quests.completed.length}`);
}

async function handleOffer() {
  // The NPC can only offer; a trade, lesson or quest happens when the player says yes.
  const questId = npc.state.pendingQuest;
  const quest = questId ? [...(npc.persona.quests ?? []), ...npc.state.questBoard].find((q) => q.id === questId) : undefined;
  if (quest) {
    const answer = (
      await rl.question(
        `  Accept [${quest.tier}] "${quest.title}": bring ${quest.objective.qty} ${quest.objective.item} for ${formatMoney(questRewardMoney(npc.persona, quest))}? (y/n) `,
      )
    ).trim().toLowerCase();
    if (answer.startsWith("y")) {
      await npcSays(async (onText) => {
        const r = await npc.acceptQuest(world, onText);
        console.log(r.quest ? `  [quest accepted] ${r.quest}` : "  [quest no longer available]");
        return r;
      });
    } else {
      await npcSays((onText) => npc.declineQuest(world, onText));
    }
  }

  const lesson = npc.state.pendingTraining;
  if (lesson) {
    const answer = (
      await rl.question(`  Train ${lesson.skill} for ${lesson.hours}h for ${formatMoney(lesson.cost)}? You have ${formatMoney(world.player.money)}. (y/n) `)
    ).trim().toLowerCase();
    if (answer.startsWith("y")) {
      await npcSays((onText) =>
        npc.acceptTraining(world, onText, (r) =>
          console.log(r.ok ? `  [trained ${r.hoursSpent}h${r.levelsGained ? ", level up!" : ""}] Now: ${formatTime(world)}${r.npcNote ? `\n  [rank] ${r.npcNote}` : ""}` : `  ${r.message}`),
        ),
      );
    } else {
      await npcSays((onText) => npc.declineTraining(world, onText));
    }
  }

  const purchase = npc.state.pendingPurchase;
  if (purchase) {
    const answer = (await rl.question(`  Sell your ${itemLabel(purchase.item)} for ${formatMoney(purchase.price)}? (y/n) `)).trim().toLowerCase();
    if (answer.startsWith("y")) {
      await npcSays(async (onText) => {
        const result = await npc.acceptPurchase(world, onText);
        console.log(`  [${result.sale.ok ? "sold" : "no sale"}] ${result.sale.message} You have ${formatMoney(world.player.money)}.`);
        return result;
      });
    } else {
      await npcSays((onText) => npc.declinePurchase(world, onText));
    }
  }

  const offer = npc.state.pendingOffer;
  if (!offer) return;
  const answer = (await rl.question(`  Buy ${itemLabel(offer.item)} for ${formatMoney(offer.price)}? (y/n) `)).trim().toLowerCase();
  if (answer.startsWith("y")) {
    await npcSays(async (onText) => {
      const result = await npc.acceptOffer(world, onText);
      console.log(`  [${result.sale.ok ? "sold" : "no sale"}] ${result.sale.message}`);
      return result;
    });
  } else {
    await npcSays((onText) => npc.declineOffer(world, onText));
  }
}

/** The creature the player is fighting (after /hunt), if any. */
let cliEngaged: string | null = null;

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

/** A creature dropped the player: apply the defeat rule. Returns true if the game is over. */
function defeatedByCreature(t: CreatureTemplate, c: Creature): boolean {
  cliEngaged = null;
  const defeat = creatureBeatsPlayer(t, c, world);
  console.log(`  [defeated] ${defeat.message}`);
  if (defeat.rule === "permadeath") {
    saveWorld(config.saveFile, world);
    console.log("  Game over: this world is finished (start again with --new).");
    return true;
  }
  const start = { day: world.day, hour: world.hour };
  for (const entry of npc.wait(world, defeat.hoursOut)) console.log(`  ${entry}`);
  passCreatureTime(creatureTemplates, world.creatures, start, defeat.hoursOut, Math.random, DEMO_SPAWNS);
  return false;
}

while (!npc.state.conversationOver && !world.player.death) {
  let line: string | null;
  try {
    line = await readLine();
  } catch {
    break; // input closed (Ctrl+D)
  }
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
      printActions(npc.playerHesitates(world));
      console.log(hpLine());
    }
    world.npcStates[npcId] = npc.state;
    saveWorld(config.saveFile, world);
    continue;
  }
  if (!line) continue;
  if (line === "/quit") {
    world.npcStates[npcId] = npc.state;
    saveWorld(config.saveFile, world);
    break;
  }
  if (line === "/save") {
    world.npcStates[npcId] = npc.state;
    saveWorld(config.saveFile, world);
    console.log(`  Saved ${config.saveFile}.`);
    continue;
  }
  if (line === "/state") {
    console.log({ npc: npc.state, player: world.player });
    continue;
  }

  if (line.startsWith("/trust")) {
    // Testing shortcut: set trust directly (secrets unlock above 50).
    const value = Number(line.split(/\s+/)[1]);
    if (Number.isFinite(value)) npc.state.relationship = Math.max(-100, Math.min(100, value));
    console.log(`  trust is now ${npc.state.relationship}`);
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
    if (round.over && round.over !== "player down") cliEngaged = null;
    if (round.over === "player down" && defeatedByCreature(t, c)) break;
    world.npcStates[npcId] = npc.state;
    saveWorld(config.saveFile, world);
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
    saveWorld(config.saveFile, world);
    continue;
  }
  const unequipLine = line.match(/^\/unequip\s+(weapon|armor)$/);
  if (unequipLine) {
    console.log(`  ${unequip(world.player, unequipLine[1] as Slot, playerSlots(world.player)).message}`);
    saveWorld(config.saveFile, world);
    continue;
  }

  if (line === "/quests") {
    printQuests();
    continue;
  }
  const wait = line.match(/^\/wait(?:\s+(\d+))?$/);
  if (wait) {
    if (npc.state.inCombat || (cliEngaged !== null && !world.creatures[cliEngaged]?.outcome)) {
      console.log("  You can't wait around in the middle of a fight.");
      continue;
    }
    const hours = Math.max(1, Math.min(24, Number(wait[1] ?? 1)));
    const startHour = world.hour;
    const start = { day: world.day, hour: world.hour };
    const log = npc.wait(world, hours);
    const news = passCreatureTime(creatureTemplates, world.creatures, start, hours, Math.random, DEMO_SPAWNS);
    log.push(...news.filter(isNotable));
    const healed = restPlayer(world.player, startHour, hours);
    for (const entry of log) console.log(`  ${entry}`);
    console.log(`  It's now ${formatTime(world)}.${healed > 0 ? ` You rested and healed ${healed} HP (${world.player.hp}/${world.player.maxHp}).` : ""}`);
    if (npc.isDead) {
      recordDeath();
      world.npcStates[npcId] = npc.state;
      saveWorld(config.saveFile, world);
      break;
    }
    world.npcStates[npcId] = npc.state;
    saveWorld(config.saveFile, world);
    continue;
  }
  const use = line.match(/^\/use\s+(.+)$/);
  if (use) {
    // Using your own item is done in code; mid-fight it costs your turn.
    const r = npc.useItem(world, use[1]!.trim());
    console.log(`  ${r.use.message}`);
    printActions(r);
    if (npc.state.inCombat || r.defeat) console.log(hpLine());
    world.npcStates[npcId] = npc.state;
    saveWorld(config.saveFile, world);
    continue;
  }
  // A busy NPC can't be interacted with (free commands above still work).
  const busy = npc.busyWith(world);
  if (busy) {
    console.log(`  ${npc.persona.name} is busy ${busy}. Try /wait.`);
    continue;
  }

  // Repairs cost money: show the price and ask first.
  const repairLine = line.match(/^\/repair\s+(.+)$/);
  if (repairLine) {
    const which = repairLine[1]!.trim();
    const quote = repairForPlayer(which, { persona: npc.persona, state: npc.state, world, rng: Math.random }, { quote: true });
    if (!quote.ok) {
      console.log(`  ${quote.message}`);
      continue;
    }
    const yes = (await rl.question(`  ${quote.message} You have ${formatMoney(world.player.money)}. Pay? (y/n) `)).trim().toLowerCase();
    if (yes.startsWith("y")) {
      await npcSays((onText) => npc.repair(which, world, onText, (r) => console.log(`  [${r.ok ? "repaired" : "no repair"}] ${r.message}`)));
      world.npcStates[npcId] = npc.state;
      saveWorld(config.saveFile, world);
    }
    continue;
  }

  try {
    const social = line.match(/^\/(persuade|intimidate)\s+(.+)/);
    if (social) {
      const kind = social[1] as "persuade" | "intimidate";
      await npcSays((onText) =>
        npc.attempt(kind, social[2]!, world, onText, (r) =>
          console.log(r.ok ? `  [${kind} ${r.success ? "succeeded" : "failed"}] ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}` : `  ${r.message}`),
        ),
      );
    } else if (line.startsWith("/haggle")) {
      const words = line.slice("/haggle".length).trim() || "Can you do better on the price?";
      await npcSays((onText) =>
        npc.haggle(words, world, onText, (r) =>
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
      const pay = (await rl.question(`  ${quote.message}${short}. You have ${world.player.money}. Pay? (y/n) `)).trim().toLowerCase();
      if (!pay.startsWith("y")) continue;
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
    } else if (line === "/flee") {
      await npcSays((onText) =>
        npc.playerFlees(world, onText, (r) =>
          console.log(r.ok ? `  [flee ${r.escaped ? "succeeded" : "failed"}] ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}` : `  ${r.message}`),
        ),
      );
      if (npc.state.inCombat) console.log(hpLine());
    } else if (line === "/attack") {
      await npcSays((onText) =>
        npc.attackedByPlayer(world, onText, (r) => console.log(`  [attack] ${r.damage > 0 ? `hit for ${r.damage}` : "missed"} ${r.message.match(/\(rolled[^)]*\)/)?.[0] ?? ""}`)),
      );
      console.log(hpLine());
    } else if (line.startsWith("/")) {
      console.log("  Unknown command.");
      continue;
    } else {
      await npcSays((onText) => npc.respond(line, world, onText));
    }

    // Record a death straight away, so quitting (or a crash) can't undo it.
    if (npc.isDead) recordDeath();
    if (npc.state.inCombat && line !== "/attack" && line !== "/flee") console.log(hpLine());
    await handleOffer();
    world.npcStates[npcId] = npc.state;
    saveWorld(config.saveFile, world);
  } catch (err) {
    console.error(`\n[error] ${(err as Error).message}`);
  }
}

world.npcStates[npcId] = npc.state;
saveWorld(config.saveFile, world);
if (world.player.death) console.log(`\n${npc.persona.name} has killed you. Game over: this world is finished (start again with --new).`);
else if (npc.isDead) {
  recordDeath();
  console.log(
    npc.state.deathCause === "old age"
      ? `\n${npc.persona.name} is gone, taken by old age. They won't be coming back.`
      : `\n${npc.persona.name} falls and doesn't get up. They're dead, and they won't be coming back.`,
  );
} else if (npc.state.outcome === "player fled") console.log(`\nYou get away from ${npc.persona.name}.`);
else if (npc.state.outcome === "fled") console.log(`\n${npc.persona.name} runs off into the village.`);
else if (npc.state.outcome === "knocked out") {
  console.log(`\nYou come to at ${formatTime(world)}, aching. Rest (/wait) or a salve will heal you.`);
}
else console.log(`\n${npc.persona.name} goes back to work.`);
rl.close();
