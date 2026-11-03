import { config } from "../../config.js";
import type { PartyRow } from "../../store/jobStore.js";
import { addGrievance } from "../chatter/grievance.js";
import type { WorldStore } from "../db.js";
import { streamFor, unitFor } from "../dice.js";
import { ITEM_TIERS, type ItemTier } from "../items.js";
import { tierIndex, type Tier } from "../life.js";
import { recordLifeEvent } from "../people/events.js";
import { lose } from "../realm/beasts.js";
import { addDeed, addRenown, figureOvercomes, figurePower, killFigure } from "../realm/figures.js";
import { travelDays } from "../realm/generate.js";
import { payOut, transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import type { Figure, Pack, Realm } from "../realm/types.js";
import { delve, levelPower, packSide } from "../realm/wilds.js";
import { roadDataOf } from "../road/generateRoads.js";
import { departureOn, journeyOf, launch } from "../road/journeys.js";
import { shortest } from "../road/paths.js";
import { gradeIndex, gradeRecord, marketOf, mayTake, recordJob, type GradeChange } from "./grades.js";
import { claim, complete, post, pruneJobs, reopen, resultOf } from "./jobs.js";

/**
 * The market's day (N42 steps 2-6), in the realm's day: what the realm needs becomes jobs on the boards (a pack's cull, a dungeon's
 * delve, their bounties); adventurers form parties; parties choose jobs with N38-style scoring (the coin against their need for it, the
 * danger against their own strength, their grade and their nerve, the road); a party that claims a job walks to it and does it with the
 * code that already runs fights and delves. Success pays, makes names and moves grades; failure sends the job back to the board, and a
 * reckless party above its grade may not come back.
 */
export const MARKET = {
  /** Days a party will go for a job. */
  reach: 2,
  partyMax: 4,
  /** Least score to claim, and the chance a day a party that wants a job claims it. */
  least: 0.2,
  claimChance: 0.6,
  /** Beasts a cull kills. */
  cull: 3,
} as const;

export type PartyRole = "fighter" | "healer" | "scout";

export interface PartyRecord {
  done: number;
  failed: number;
  deaths: number;
  earned: number;
}

export const membersOf = (p: Pick<PartyRow, "members">): string[] => JSON.parse(p.members) as string[];
export const recordOf = (p: Pick<PartyRow, "record">): PartyRecord => JSON.parse(p.record) as PartyRecord;

const isAdventurer = (f: Figure) => f.alive && !f.talks && f.home !== null && (f.role === "adventurer" || f.role === "hunter");

/** What a cull is up against: the few beasts a party runs down (and the pack's leader, if it stands with them), not the whole pack at once. */
export function cullStrength(realm: Realm, p: Pack): number {
  const side = packSide(realm, p);
  const per = p.count > 0 ? (side.strength - side.fighters.reduce((a, f) => a + figurePower(f), 0)) / p.count : 0;
  return per * Math.min(p.count, MARKET.cull + 1) + side.fighters.reduce((a, f) => a + figurePower(f), 0) * 0.5;
}

/** Tier of a dungeon's delve job: deeper is harder. */
export const delveTier = (tier: string, depth: number): ItemTier => ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, ITEM_TIERS.indexOf(tier as ItemTier) + (depth >= 3 ? 1 : 0))]!;

/** What the realm needs posted as jobs: culls of full or bountied packs, delves of dangerous or bountied dungeons (decision 2). */
export function postRealmJobs(realm: Realm, store: WorldStore, day: number): void {
  const live = new Set(store.jobs.list((j) => j.status === "open" || j.status === "held").map((j) => j.target));
  for (const p of Object.values(realm.packs).sort((a, b) => a.id.localeCompare(b.id))) {
    const near = realm.settlements[p.near];
    if (!near || near.abandoned || near.fallen || p.count < 2 || live.has(p.id)) continue;
    if (p.bounty <= 0 && p.count < Math.ceil(p.cap * 0.7)) continue;
    const reward = p.bounty > 0 ? p.bounty : Math.min(150, Math.floor(near.treasury * 0.05));
    if (reward <= 0) continue;
    post(store, { id: `cull:${p.id}:${day}`, site: p.near, kind: "cull", giver: p.bounty > 0 ? null : `s:${p.near}`, title: `Cull the ${p.species === "wolf" ? "wolves" : `${p.species}s`} near ${near.name}`, target: p.id, tier: p.tier, reward, day });
  }
  for (const d of Object.values(realm.dungeons).sort((a, b) => a.id.localeCompare(b.id))) {
    const near = realm.settlements[d.near];
    if (!near || near.abandoned || live.has(d.id) || (d.clearedUntil !== undefined && day < d.clearedUntil)) continue;
    if (d.bounty <= 0 && d.danger < 60) continue;
    const tier = delveTier(d.tier, d.depth);
    const reward = d.bounty > 0 ? d.bounty : Math.min(300, Math.floor(near.treasury * 0.08));
    if (reward <= 0) continue;
    post(store, { id: `delve:${d.id}:${day}`, site: d.near, kind: "delve", giver: d.bounty > 0 ? null : `s:${d.near}`, title: `Clear out ${d.name}`, target: d.id, tier, reward, day });
  }
}

/** Free adventurers of a place form parties (decision 7): by place, strongest first, a fighter leading; scouts are hunters. */
export function formParties(realm: Realm, store: WorldStore, day: number): void {
  const inParty = new Set(store.jobs.partyList((p) => p.disbanded === null).flatMap(membersOf));
  const free = Object.values(realm.figures).filter((f) => isAdventurer(f) && !inParty.has(f.id) && !f.away);
  const byHome = new Map<string, Figure[]>();
  for (const f of free) byHome.set(f.home!, [...(byHome.get(f.home!) ?? []), f]);
  for (const [home, list] of [...byHome].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => figurePower(b) - figurePower(a) || a.id.localeCompare(b.id));
    for (let i = 0; i < list.length; i += MARKET.partyMax) {
      const members = list.slice(i, i + MARKET.partyMax);
      const leader = members.find((f) => f.role === "adventurer") ?? members[0]!;
      const id = `party${++marketOf(realm).next}`;
      const roles = Object.fromEntries(members.map((f) => [f.id, f.role === "hunter" ? "scout" : f.life.tier >= leader.life.tier && f !== leader && f.greed < 0.3 ? "healer" : "fighter"]));
      store.jobs.putParty({ id, leader: leader.id, members: JSON.stringify(members.map((f) => f.id)), roles: JSON.stringify(roles), shares: leader.greed > 0.7 ? "leader-heavy" : "equal", formed: day, disbanded: null, record: JSON.stringify({ done: 0, failed: 0, deaths: 0, earned: 0 } satisfies PartyRecord) });
      void home;
    }
  }
}

const living = (realm: Realm, p: PartyRow): Figure[] => membersOf(p).map((id) => realm.figures[id]).filter((f): f is Figure => !!f && f.alive);
const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** How a party's members feel about a job (decision 4): the parts of the score, named, and whether they may take it at all. */
export function scoreJob(realm: Realm, p: PartyRow, job: { tier: string; reward: number; site: string; kind: string; target: string | null }): { score: number; parts: Array<[string, number]>; allowed: boolean } {
  const ms = living(realm, p);
  const lead = realm.figures[p.leader];
  if (ms.length === 0 || !lead?.home) return { score: -1, parts: [], allowed: false };
  const grade = gradeRecord(realm, lead.id).g;
  const reckless = avg(ms.map((f) => f.bravery)) > 0.75;
  const days = travelDays(realm, lead.home, job.site);
  const ours = ms.reduce((a, f) => a + figurePower(f), 0);
  const theirs = job.kind === "cull" ? (realm.packs[job.target ?? ""] ? cullStrength(realm, realm.packs[job.target!]!) : 1) : job.kind === "delve" ? (realm.dungeons[job.target ?? ""] ? levelPower(realm.dungeons[job.target!]!, realm.dungeons[job.target!]!.depth) * 1.5 : 30) : 10;
  const parts: Array<[string, number]> = [
    ["the coin", (job.reward / 200) * (0.5 + avg(ms.map((f) => f.greed)))],
    ["their strength against it", (ours / (ours + theirs) - 0.5) * (reckless ? 0.3 : 1.2)],
    [`grade ${grade} against ${job.tier}`, (gradeIndex(grade) - gradeIndex(job.tier)) * 0.15],
    ["wanting a name", 0.2 * avg(ms.map((f) => f.ambition))],
    ["the road", -0.15 * days],
  ];
  const rec = gradeRecord(realm, lead.id);
  if (rec.trial && gradeIndex(job.tier) >= gradeIndex(rec.trial)) parts.push(["the guild's trial", 0.4]);
  if (reckless) parts.push(["reckless", 0.25]);
  return { score: parts.reduce((a, [, v]) => a + v, 0), parts, allowed: days <= MARKET.reach && mayTake(grade, job.tier, reckless) };
}

/** Parties take jobs (decision 4): each open job, in id order, to the free party that wants it most, if it wants it enough. */
export function claimJobs(realm: Realm, store: WorldStore, day: number): void {
  const busy = new Set(store.jobs.list((j) => j.status === "held").map((j) => j.holder));
  const parties = store.jobs.partyList((p) => p.disbanded === null && !busy.has(p.id)).filter((p) => living(realm, p).length > 0 && living(realm, p).every((f) => !f.away));
  for (const job of store.jobs.list((j) => j.status === "open" && (j.kind === "cull" || j.kind === "delve"))) {
    let best: { p: PartyRow; score: number; parts: Array<[string, number]> } | null = null;
    for (const p of parties) {
      if (busy.has(p.id)) continue;
      const s = scoreJob(realm, p, job);
      if (!s.allowed || s.score < MARKET.least) continue;
      if (!best || s.score > best.score || (s.score === best.score && p.id < best.p.id)) best = { p, score: s.score, parts: s.parts };
    }
    if (!best || unitFor(realm.seed, "claim", job.id, best.p.id, day) >= MARKET.claimChance) continue;
    const lead = realm.figures[best.p.leader]!;
    const ms = living(realm, best.p);
    let arrive = day + 1;
    let journey: string | undefined;
    if (lead.home !== job.site) {
      const way = shortest(roadDataOf(realm), lead.home!, job.site);
      const j = way ? launch(realm, roadDataOf(realm), { kind: "adventurers", party: ms.map((f) => ({ person: f.id, name: f.name, role: "adventurer", gender: f.gender })), path: way, depart: departureOn(day + 1, 0.2), purpose: `going to ${job.title.toLowerCase()}`, guards: ms.length }) : null;
      if (!j) continue;
      for (const f of ms) f.away = j.id;
      journey = j.id;
      arrive = Math.floor(j.arrive / 1440) + 2;
    }
    if (!claim(store, job.id, best.p.id, day, { arrive, ...(journey ? { journey } : {}), why: best.parts.filter(([, v]) => Math.abs(v) >= 0.05).map(([k, v]) => `${k} ${v.toFixed(2)}`) })) continue;
    busy.add(best.p.id);
    recordLifeEvent(realm, store, { kind: "job-claimed", actor: lead.id, site: job.site, day, key: job.id, details: `${lead.name}'s party took the job: ${job.title}`, importance: 3, why: best.parts.map(([k]) => k).slice(0, 3).join(", ") });
    tally(realm, "jobs_claimed");
  }
}

export interface JobOutcome {
  job: string;
  party: string;
  ok: boolean;
  deaths: string[];
  changes: Array<GradeChange & { who: string }>;
}

/** Parties that reached their job do it (decision 5): the cull is a fight with the pack, the delve is `delve`. */
export function resolveJobs(realm: Realm, store: WorldStore, day: number): JobOutcome[] {
  const out: JobOutcome[] = [];
  for (const job of store.jobs.list((j) => j.status === "held" && j.holder !== null && j.holder.startsWith("party"))) {
    const r = resultOf(job);
    if (Number(r.arrive ?? day) > day) continue;
    const party = store.jobs.party(job.holder!);
    const ms = party ? living(realm, party) : [];
    for (const f of ms) if (f.away === r.journey) delete f.away;
    if (r.journey) {
      const j = journeyOf(realm, String(r.journey));
      if (j) (j as { closed?: boolean }).closed = true;
    }
    if (!party || ms.length === 0) {
      reopen(store, job.id, day, "failed", "the party was gone");
      continue;
    }
    const lead = realm.figures[party.leader] ?? ms[0]!;
    const rng = streamFor(realm.seed, "job", job.id, day);
    const res: JobOutcome = { job: job.id, party: party.id, ok: false, deaths: [], changes: [] };
    if (job.kind === "cull") {
      const p = realm.packs[job.target ?? ""];
      if (!p || p.count < 2) {
        // Someone else saw to it (a hunter on their own, the place's own men): done, but not by them.
        complete(store, job.id, "others", day, "the beasts were gone when they got there");
        out.push({ ...res, ok: true });
        continue;
      }
      const ours = ms.reduce((a, f) => a + figurePower(f), 0);
      const theirs = cullStrength(realm, p);
      res.ok = rng() < ours / (ours + theirs);
      if (res.ok) {
        lose(p, Math.min(MARKET.cull, p.count - 1), day, `culled by ${lead.name}'s party`, lead.id);
        tally(realm, "culled", Math.min(MARKET.cull, p.count - 1));
        // A standing bounty is paid out to the party's leader, through the books (the pack's bounty is coin the realm holds).
        if (p.bounty > 0) p.bounty -= payOut(realm, `p:${lead.id}`, p.bounty, `pack ${p.id}`, undefined, day);
        for (const f of ms) figureOvercomes(f, 10, { kind: "hunt", rank: p.tier as Tier, what: `culling the ${p.species}s` }, day);
      } else {
        for (const f of ms) {
          const gap = tierIndex(p.tier as Tier) - tierIndex(f.life.tier as Tier);
          if (rng() < Math.max(0.03, Math.min(0.8, 0.08 + gap * 0.14)) && killFigure(realm, f, day, `killed by the ${p.species}s near ${realm.settlements[p.near]?.name ?? "the wild"}`)) res.deaths.push(f.id);
        }
      }
    } else if (job.kind === "delve") {
      const d = realm.dungeons[job.target ?? ""];
      if (!d || (d.clearedUntil !== undefined && day < d.clearedUntil)) {
        complete(store, job.id, "others", day, "it had been cleared before they got there");
        out.push({ ...res, ok: true });
        continue;
      }
      const before = new Set(ms.filter((f) => f.alive).map((f) => f.id));
      delve(realm, d, ms, day, rng);
      res.ok = d.clearedUntil !== undefined && d.clearedUntil > day;
      for (const id of before) if (!realm.figures[id]?.alive) res.deaths.push(id);
    }
    finish(realm, store, job.id, party, res, day);
    out.push(res);
  }
  return out;
}

/** What follows a job: pay, renown, grades, the party's record and whether it holds together, the giver told. */
function finish(realm: Realm, store: WorldStore, jobId: string, party: PartyRow, res: JobOutcome, day: number): void {
  const job = store.jobs.job(jobId)!;
  const ms = living(realm, party);
  const lead = realm.figures[party.leader];
  const rec = recordOf(party);
  rec.deaths += res.deaths.length;
  if (res.ok) {
    rec.done++;
    // The giver pays: a place from its treasury, a standing bounty from the realm's books; a talker giver pays when the player's town sees to it (sync.ts).
    let paid = 0;
    if (job.giver?.startsWith("s:")) paid = transfer(realm, job.giver, `p:${party.leader}`, Math.min(job.reward, realm.settlements[job.giver.slice(2)]?.treasury ?? 0), `the job "${job.title}"`, undefined, day);
    // Loot split by the party's agreement.
    if (paid > 0 && ms.length > 1) {
      const heavy = party.shares === "leader-heavy";
      const each = Math.floor((heavy ? paid * 0.6 : paid) / ms.length);
      for (const f of ms) if (f.id !== party.leader) transfer(realm, `p:${party.leader}`, `p:${f.id}`, each, `a share of "${job.title}"`, undefined, day);
      // A leader who keeps the lion's share loses a greedy member's goodwill.
      if (heavy && config.chatter) for (const f of ms.filter((x) => x.id !== party.leader && x.greed > 0.6)) addGrievance(store, { who: f.id, against: party.leader, cause: `job:${job.id}`, weight: 0.3, day });
    }
    rec.earned += paid;
    complete(store, jobId, party.id, day, `${lead?.name ?? "a party"}'s party did it`);
    for (const f of ms) {
      addRenown(f, 3);
      addDeed(f, `${job.kind === "cull" ? "culled" : "delved"} for ${job.title.toLowerCase()}`);
    }
    recordLifeEvent(realm, store, { kind: "job-done", actor: party.leader, site: job.site, day, key: job.id, details: `${lead?.name ?? "A party"}'s party did the job: ${job.title}`, importance: 4 });
    if (job.ref && job.giver && !job.giver.startsWith("s:")) marketOf(realm).told[job.giver] = [...(marketOf(realm).told[job.giver] ?? []), { job: job.id, text: `${lead?.name ?? "Someone"}'s lot saw to it: ${job.title.toLowerCase()}. Paid them myself.`, day }].slice(-4);
    tally(realm, "jobs_done");
  } else {
    rec.failed++;
    const still = job.kind === "cull" ? !!realm.packs[job.target ?? ""] : true;
    reopen(store, jobId, day, "failed", `${lead?.name ?? "a party"}'s party failed${res.deaths.length ? `, and ${res.deaths.length} died` : ""}`, still);
    recordLifeEvent(realm, store, { kind: "job-failed", actor: party.leader, site: job.site, day, key: job.id, details: `${lead?.name ?? "A party"}'s party failed at the job: ${job.title}${res.deaths.length ? `; ${res.deaths.map((id) => realm.figures[id]?.name).join(" and ")} did not come back` : ""}`, importance: 4 + res.deaths.length });
    if (res.deaths.length) realmNews(realm, day, job.site, "adventurers", `${res.deaths.map((id) => realm.figures[id]?.name).join(" and ")} died ${job.kind === "cull" ? "hunting" : "in"} ${job.title.replace(/^(Cull|Clear out) /, "").replace(/^the /, "the ")}; the job is on the board again.`, 4, res.deaths.map((id) => realm.figures[id]?.name ?? "").filter(Boolean));
    tally(realm, "jobs_failed");
  }
  // Grades (decision 6): every member who lived, by the same rule.
  for (const f of membersOf(party).map((id) => realm.figures[id]).filter((x): x is Figure => !!x && x.alive)) {
    const g = gradeRecord(realm, f.id, { day });
    const ch = recordJob(g, job.tier, res.ok, day);
    if (!ch || ch.how === "trial-set") continue;
    res.changes.push({ ...ch, who: f.id });
    recordLifeEvent(realm, store, { kind: "promoted", actor: f.id, site: f.home ?? job.site, day, key: `grade:${f.id}`, details: ch.how === "demoted" ? `${f.name} was put down to grade ${ch.to} by the guild after failing again` : ch.how === "trial" ? `${f.name} passed the guild's trial and was made grade ${ch.to}` : `${f.name} was made grade ${ch.to} for jobs done`, importance: ch.how === "trial" ? 5 : 3 });
    if (ch.how === "trial" && gradeIndex(ch.to) >= gradeIndex("B")) realmNews(realm, day, f.home ?? job.site, "adventurers", `${f.name} passed the guild's trial and is an adventurer of grade ${ch.to} now.`, 4, [f.name]);
  }
  // A party breaks up over a death, or after failing too often.
  const left = living(realm, party);
  const breaks = left.length === 0 || (res.deaths.length > 0 && unitFor(realm.seed, "party-breaks", party.id, day) < 0.5) || (rec.failed >= 3 && rec.failed > rec.done * 2);
  store.jobs.putParty({ ...party, members: JSON.stringify(left.map((f) => f.id)), record: JSON.stringify(rec), ...(breaks ? { disbanded: day } : {}), ...(left.length > 0 && !left.some((f) => f.id === party.leader) ? { leader: left[0]!.id } : {}) });
  if (breaks && left.length > 0) recordLifeEvent(realm, store, { kind: "companion-left", actor: left[0]!.id, site: job.site, day, key: `breakup:${party.id}`, details: `${lead?.name ?? "The"}'s party broke up${res.deaths.length ? " after they buried their own" : " after one failure too many"}`, importance: 2 });
}

/** Held jobs past their deadline go back on the board (decision 3). */
export function expireJobs(realm: Realm, store: WorldStore, day: number): void {
  for (const j of store.jobs.list((x) => (x.status === "held" || x.status === "open") && x.deadline < day)) {
    if (j.status === "open") {
      // Nobody took it in time: it stays up while what it was for is still there, or is taken down.
      const still = j.kind === "cull" ? (realm.packs[j.target ?? ""]?.count ?? 0) >= 2 : j.kind === "delve" ? !!realm.dungeons[j.target ?? ""] : true;
      if (still) store.jobs.putJob({ ...j, deadline: day + 6 });
      else reopen(store, j.id, day, "expired", "nobody took it, and it is not needed now", false);
      continue;
    }
    if (j.holder === "player") continue;
    reopen(store, j.id, day, "expired", "they ran out of time");
  }
}

/** The market's whole day. */
export function marketDay(realm: Realm, store: WorldStore, day: number): JobOutcome[] {
  postRealmJobs(realm, store, day);
  expireJobs(realm, store, day);
  formParties(realm, store, day);
  const out = resolveJobs(realm, store, day);
  claimJobs(realm, store, day);
  pruneJobs(store, day);
  return out;
}
