import type { ActiveQuest, NpcPersona, NpcState, PlayerState, QuestDef } from "../../npc/types.js";
import type { JobRow } from "../../store/jobStore.js";
import type { WorldStore } from "../db.js";
import { streamFor } from "../dice.js";
import { recordEvent } from "../events.js";
import { playerGainXp, QUEST_TIER_XP, type QuestTier } from "../levels.js";
import { formatMoney } from "../money.js";
import { questProgress } from "../quests.js";
import { addRenown, figurePower } from "../realm/figures.js";
import { travelDays } from "../realm/generate.js";
import { mint, transfer } from "../realm/ledger.js";
import { lose } from "../realm/beasts.js";
import type { Figure, Realm } from "../realm/types.js";
import { delve, packSide, playerPower } from "../realm/wilds.js";
import type { SavedWorld } from "../save.js";
import { cullStrength, delveTier, membersOf, recordOf } from "./day.js";
import { gradeIndex, gradeRecord, marketOf, mayTake, recordJob } from "./grades.js";
import { boardOf, claim, complete, post, reopen, resultOf } from "./jobs.js";

/**
 * The player on the market (N42 steps 1, 5, 6): the board where they are shows every job and who holds it; the player claims a board job
 * the same way an NPC party does (first come), joins an NPC party for its job and takes a share of the loot, and their grade moves by the
 * same rule. Givers' own quests are jobs too: what the player takes from a giver is held by the player on the market, and a job an NPC
 * party took is gone from the giver's offers, who tells the player when it's done (sync).
 */

export interface MarketHost {
  world: SavedWorld;
  store?: WorldStore | undefined;
  agents: Record<string, { persona: NpcPersona; state: NpcState }>;
  site(): string;
  walkMinutes(minutes: number): string[];
}

export interface Done {
  ok: boolean;
  lines: string[];
}
const no = (line: string): Done => ({ ok: false, lines: [line] });

/** A giver's quest, mirrored as a job on the market (decision 2: `questBoard` entries are rows). */
export function mirrorQuest(realm: Realm, store: WorldStore, site: string, giver: string, q: QuestDef, day: number): JobRow {
  const o = q.objective;
  const pack = o.type === "defeat" ? Object.values(realm.packs).find((p) => p.near === site && p.species === o.creature) : undefined;
  const kind = pack ? "cull" : o.type === "clear" ? "delve" : o.type === "defeat" ? "bounty" : "need";
  return post(store, { id: `q:${giver}:${q.id}`, site, board: giver, kind, giver, title: q.title, target: pack?.id ?? (o.type === "clear" ? o.dungeon : null), tier: q.tier, reward: q.reward.money, day, ...(q.deadlineHours ? { deadline: Math.max(2, Math.ceil(q.deadlineHours / 24)) } : {}), ref: q.id });
}

const partyName = (realm: Realm, store: WorldStore, holder: string | null): string => {
  if (!holder) return "nobody";
  if (holder === "player") return "you";
  if (holder === "others") return "someone else";
  const p = store.jobs.party(holder);
  const lead = p ? realm.figures[p.leader] : undefined;
  return lead ? `${lead.name}'s party` : holder;
};

/**
 * Bring the givers' boards and the market together (decision 9), each time the town's hours pass: a giver's quest an NPC party holds is
 * no longer offered; one they did is paid for from the giver's purse and told to the player; what the player took from a giver is held by
 * the player, and what they finished is done by them; a board job the player finished is paid at the board.
 */
export function syncJobs(h: MarketHost): string[] {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return [];
  const lines: string[] = [];
  const p = h.world.player;
  const day = h.world.day;
  for (const job of store.jobs.list((j) => j.ref !== null && j.giver !== null && !!h.agents[j.giver])) {
    const giver = h.agents[job.giver!]!;
    const onBoard = giver.state.questBoard.some((q) => q.id === job.ref);
    const mine = p.quests.active.some((q) => q.id === job.ref);
    if (mine && job.status === "open") claim(store, job.id, "player", day);
    if (p.quests.completed.includes(job.ref!) && job.status !== "done") complete(store, job.id, "player", day, "the player did it");
    if (job.status === "held" && job.holder !== "player" && onBoard) {
      // Someone else has it: the giver stops offering it, and the quarry it would have brought stays away.
      giver.state.questBoard = giver.state.questBoard.filter((q) => q.id !== job.ref);
      const site = h.world.sites?.[job.site];
      if (site) site.rules = site.rules.filter((r) => r.quest !== job.ref);
    }
    if (job.status === "done" && job.holder !== "player" && job.holder !== "others" && !resultOf(job).paid) {
      // The giver pays them, from their own purse (talkers' coin is outside the realm's books: it comes in as new coin).
      const party = store.jobs.party(job.holder!);
      const paid = Math.min(job.reward, giver.state.money);
      giver.state.money -= paid;
      if (party && paid > 0) mint(realm, `p:${party.leader}`, paid, `paid by ${giver.persona.name} for "${job.title}"`, undefined, day);
      store.jobs.putJob({ ...job, result: JSON.stringify({ ...resultOf(job), paid }) });
      giver.state.questBoard = giver.state.questBoard.filter((q) => q.id !== job.ref);
    }
  }
  // Board jobs the player holds: finished ones are paid at the board.
  for (const q of [...p.quests.active]) {
    if (!q.giverId.startsWith("board:")) continue;
    const job = store.jobs.job(q.id);
    if (!job || !questProgress(p, q).done) continue;
    lines.push(...payPlayer(realm, store, p, job, day, 1));
    p.quests.active = p.quests.active.filter((x) => x !== q);
    p.quests.completed.push(q.id);
  }
  return lines;
}

/** A job done by the player (alone or with a party): their pay, their XP, their grade. */
function payPlayer(realm: Realm, store: WorldStore, p: PlayerState, job: JobRow, day: number, share: number): string[] {
  const lines: string[] = [];
  const amount = Math.floor(job.reward * share);
  let paid = 0;
  if (job.giver?.startsWith("s:")) paid = transfer(realm, job.giver, "player", Math.min(amount, realm.settlements[job.giver.slice(2)]?.treasury ?? 0), `the job "${job.title}"`, p, day);
  else if (!job.giver) {
    paid = amount;
    p.money += amount;
  }
  complete(store, job.id, "player", day, "the player did it");
  playerGainXp(p, QUEST_TIER_XP[job.tier as QuestTier] ?? 20);
  p.renown = Math.min(100, (p.renown ?? 0) + 2);
  lines.push(`The job "${job.title}" is done${paid > 0 ? `: ${formatMoney(paid)}` : ""}.`);
  const ch = recordJob(gradeRecord(realm, "player", { player: p, day }), job.tier, true, day);
  if (ch && ch.how !== "trial-set") lines.push(ch.how === "trial" ? `You passed the guild's trial: grade ${ch.to}.` : `The guild makes you grade ${ch.to}.`);
  if (ch?.how === "trial-set") lines.push(`The guild sets you a trial: a ${ch.to ? gradeRecord(realm, "player", { player: p }).trial : ""}-grade job.`);
  return lines;
}

/** Claim a board job (one with no giver's quest behind it): it becomes the player's quest, paid at the board when done. */
export function playerClaim(h: MarketHost, id: string): Done {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return no("There's no board here.");
  const p = h.world.player;
  const job = store.jobs.job(id);
  if (!job || job.site !== h.site()) return no("That job isn't on this board.");
  if (job.status !== "open") return no(`That job is held by ${partyName(realm, store, job.holder)}.`);
  if (job.ref) return no("That's a job to take up with whoever posted it.");
  const g = gradeRecord(realm, "player", { player: p, day: h.world.day });
  if (!mayTake(g.g, job.tier)) return no(`That's a ${job.tier}-grade job; the guild has you at grade ${g.g}.`);
  const objective: QuestDef["objective"] | null =
    job.kind === "cull" && realm.packs[job.target ?? ""] ? { type: "defeat", creature: realm.packs[job.target!]!.species, qty: 3 } : job.kind === "delve" && realm.dungeons[job.target ?? ""] ? { type: "clear", dungeon: job.target!, name: realm.dungeons[job.target!]!.name, qty: 1 } : null;
  if (!objective) return no("There's nothing left to do for that one.");
  if (!claim(store, job.id, "player", h.world.day)) return no("Someone took it first.");
  const q: ActiveQuest = { id: job.id, title: job.title, description: job.title, tier: job.tier as QuestTier, minTrust: 0, objective, reward: { money: job.reward }, giverId: `board:${job.site}`, giverName: "the board", acceptedDay: h.world.day };
  p.quests.active.push(q);
  return { ok: true, lines: [`You take the job "${job.title}" (${formatMoney(job.reward)}). It's yours until day ${job.deadline}.`] };
}

/** Give a held job back (a little renown lost): it is open again at once. */
export function playerGiveUp(h: MarketHost, id: string): Done {
  const realm = h.world.realm;
  const store = h.store;
  const job = store?.jobs.job(id);
  if (!realm || !store || !job || job.holder !== "player") return no("You don't hold that job.");
  const p = h.world.player;
  p.quests.active = p.quests.active.filter((q) => q.id !== id && q.id !== job.ref);
  reopen(store, id, h.world.day, "failed", "the player gave it up");
  recordJob(gradeRecord(realm, "player", { player: p }), job.tier, false, h.world.day);
  p.renown = Math.max(0, (p.renown ?? 0) - 1);
  return { ok: true, lines: [`You give up "${job.title}". It's back on the board.`] };
}

/**
 * Go with an NPC party (decision 7: the player can join one, on its leader's terms): the party here takes its job (or the best one in
 * reach) with the player in it, there and then; the loot is split by the party's agreement, the player's share with the rest.
 */
export function playerJoinParty(h: MarketHost, partyId: string): Done {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store) return no("There's nobody to go with.");
  const p = h.world.player;
  const day = h.world.day;
  const party = store.jobs.party(partyId);
  const lead = party ? realm.figures[party.leader] : undefined;
  if (!party || party.disbanded !== null || !lead?.alive) return no("That party is no more.");
  if (lead.home !== h.site() || lead.away) return no(`${lead.name}'s party isn't here.`);
  const ms = membersOf(party).map((id) => realm.figures[id]).filter((f): f is Figure => !!f && f.alive);
  // Their job: the one they hold, else the one they'd most like that the player may go on.
  let job = store.jobs.list((j) => j.status === "held" && j.holder === party.id)[0];
  if (!job) {
    const g = gradeRecord(realm, "player", { player: p, day });
    job = boardOf(store, h.site())
      .concat(store.jobs.list((j) => j.status === "open" && j.site !== h.site() && travelDays(realm, h.site(), j.site) <= 1))
      .filter((j) => j.status === "open" && (j.kind === "cull" || j.kind === "delve") && mayTake(gradeRecord(realm, party.leader).g, j.tier) && mayTake(g.g, j.tier, true))
      .sort((a, b) => b.reward - a.reward || a.id.localeCompare(b.id))[0];
    if (!job || !claim(store, job.id, party.id, day, { arrive: day, withPlayer: true })) return no(`${lead.name} has no job in hand that you could go on.`);
  }
  const lines = [`You go with ${lead.name}'s party: ${job.title}.`];
  lines.push(...h.walkMinutes((travelDays(realm, h.site(), job.site) * 8 + 3) * 60));
  const rng = streamFor(realm.seed, "player-party", job.id, day);
  const ours = ms.reduce((a, f) => a + figurePower(f), 0) + playerPower(p);
  let ok = false;
  if (job.kind === "cull") {
    const pack = realm.packs[job.target ?? ""];
    if (pack && pack.count >= 2) {
      ok = rng() < ours / (ours + cullStrength(realm, pack));
      if (ok) lose(pack, Math.min(3, pack.count - 1), day, `culled by ${lead.name}'s party`, lead.id);
    } else ok = true;
  } else if (job.kind === "delve") {
    const d = realm.dungeons[job.target ?? ""];
    if (d) {
      delve(realm, d, ms, day, rng);
      ok = d.clearedUntil !== undefined && d.clearedUntil > day;
    }
  }
  if (!ok) {
    reopen(store, job.id, day, "failed", `${lead.name}'s party failed, with the player`);
    p.hp = Math.max(1, p.hp - (3 + Math.floor(rng() * 6)));
    recordJob(gradeRecord(realm, "player", { player: p }), job.tier, false, day);
    lines.push("It goes badly. You come back bruised, with nothing to show for it; the job is on the board again.");
    return { ok: true, lines };
  }
  // The pay, split by the party's terms: the player is one more share.
  let paid = 0;
  if (job.giver?.startsWith("s:")) paid = transfer(realm, job.giver, `p:${lead.id}`, Math.min(job.reward, realm.settlements[job.giver.slice(2)]?.treasury ?? 0), `the job "${job.title}"`, undefined, day);
  else if (!job.giver || job.giver.startsWith("p:")) paid = mint(realm, `p:${lead.id}`, job.reward, `the bounty for "${job.title}"`, undefined, day);
  else {
    const giver = h.agents[job.giver];
    paid = giver ? Math.min(job.reward, giver.state.money) : 0;
    if (giver) giver.state.money -= paid;
    if (paid > 0) mint(realm, `p:${lead.id}`, paid, `paid by ${giver!.persona.name}`, undefined, day);
  }
  const heads = ms.length + 1;
  const heavy = party.shares === "leader-heavy";
  const each = Math.floor((heavy ? paid * 0.6 : paid) / heads);
  if (each > 0) transfer(realm, `p:${lead.id}`, "player", each, `the player's share of "${job.title}"`, p, day);
  for (const f of ms) if (f.id !== lead.id && each > 0) transfer(realm, `p:${lead.id}`, `p:${f.id}`, each, `a share of "${job.title}"`, undefined, day);
  complete(store, job.id, party.id, day, `${lead.name}'s party did it, with the player`);
  const rec = recordOf(party);
  rec.done++;
  rec.earned += paid;
  store.jobs.putParty({ ...party, record: JSON.stringify(rec) });
  for (const f of ms) addRenown(f, 2);
  p.renown = Math.min(100, (p.renown ?? 0) + 2);
  playerGainXp(p, Math.floor((QUEST_TIER_XP[job.tier as QuestTier] ?? 20) / 2));
  recordJob(gradeRecord(realm, "player", { player: p }), job.tier, true, day);
  recordEvent(h.world as never, { kind: "job-done", actor: lead.id, target: "player", details: `${lead.name}'s party did the job "${job.title}", with ${p.name} among them`, importance: 4, site: h.site() });
  lines.push(`It's done. ${lead.name} shares out ${formatMoney(paid)}${heavy ? ", keeping the lion's share" : " in equal shares"}: ${formatMoney(each)} is yours.`);
  void delveTier;
  return { ok: true, lines };
}

/** What the player sees at the board where they are, and the parties about (the client's "The board" section). */
export function boardView(h: MarketHost): import("@millbrook/shared").BoardView | null {
  const realm = h.world.realm;
  const store = h.store;
  if (!realm || !store || h.world.player.road) return null;
  const site = h.site();
  const p = h.world.player;
  const g = gradeRecord(realm, "player", { player: p });
  const jobs = boardOf(store, site).map((j) => ({ id: j.id, title: j.title, tier: j.tier, reward: j.reward, status: j.status, holder: partyName(realm, store, j.holder), mine: j.holder === "player", claimable: j.status === "open" && !j.ref && mayTake(g.g, j.tier), byGiver: !!j.ref }));
  const recent = store.jobs.list((j) => j.site === site && j.status === "done" && Number(resultOf(j).day ?? 0) >= h.world.day - 6).map((j) => ({ title: j.title, by: partyName(realm, store, j.holder) }));
  const parties = store.jobs
    .partyList((x) => x.disbanded === null)
    .filter((x) => realm.figures[x.leader]?.home === site && realm.figures[x.leader]?.alive)
    .map((x) => {
      const lead = realm.figures[x.leader]!;
      const held = store.jobs.list((j) => j.status === "held" && j.holder === x.id)[0];
      return { id: x.id, leader: lead.name, members: membersOf(x).map((id) => realm.figures[id]?.name ?? id), grade: gradeRecord(realm, lead.id).g, job: held?.title ?? null, here: !lead.away, record: recordOf(x) };
    });
  return { grade: g.g, done: g.total.done, trial: g.trial ?? null, jobs, recent, parties };
}

void marketOf;
void gradeIndex;
