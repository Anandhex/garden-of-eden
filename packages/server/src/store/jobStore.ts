import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * The shared quest market (N42): every job on every board, and the parties that take them. A few hundred rows across the realm at most;
 * read once and kept in memory, written straight through (inside the caller's transaction when there is one).
 */
export type JobStatus = "open" | "held" | "done" | "failed" | "expired";

export interface JobRow {
  id: string;
  /** Where the work is. */
  site: string;
  /** Where it is posted: a place's notice board (`board:<site>`), its guild hall (`hall:<site>`), or a giver in person (their persona id). */
  board: string;
  /** cull, delve, bounty, escort, delivery, rescue, survey, contest, need. */
  kind: string;
  /** Who posted it and pays (a persona id, `s:<site>` for a place's treasury, a figure id), or null for a standing bounty. */
  giver: string | null;
  title: string;
  /** What it is about: a pack id, a dungeon id, a person, a place. */
  target: string | null;
  tier: string;
  reward: number;
  posted: number;
  deadline: number;
  /** A party id, "player", or null while open. */
  holder: string | null;
  claimed_day: number | null;
  status: JobStatus;
  /** JSON: when the holder arrives, how it ended, who did it. */
  result: string | null;
  /** The giver's quest it mirrors (`rq_beasts_3`), or a trial's member. */
  ref: string | null;
}

export interface PartyRow {
  id: string;
  leader: string;
  /** JSON string[]: figure ids (and "player" while they travel with one). */
  members: string;
  /** JSON Record<member, "fighter" | "healer" | "scout">. */
  roles: string;
  /** "equal" | "leader-heavy" | "by-role". */
  shares: string;
  formed: number;
  disbanded: number | null;
  /** JSON { done, failed, deaths, earned }. */
  record: string;
}

export class JobStore {
  private readonly statements = new Map<string, StatementSync>();
  private jobs: Map<string, JobRow> | null = null;
  private parties: Map<string, PartyRow> | null = null;

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.jobs = null;
    this.parties = null;
  }

  private allJobs(): Map<string, JobRow> {
    return (this.jobs ??= new Map((this.sql("SELECT * FROM jobs ORDER BY id").all() as unknown as JobRow[]).map((r) => [r.id, { ...r }])));
  }

  private allParties(): Map<string, PartyRow> {
    return (this.parties ??= new Map((this.sql("SELECT * FROM parties ORDER BY id").all() as unknown as PartyRow[]).map((r) => [r.id, { ...r }])));
  }

  job(id: string): JobRow | undefined {
    return this.allJobs().get(id);
  }

  /** Every job, in id order. */
  list(filter?: (j: JobRow) => boolean): JobRow[] {
    const out = [...this.allJobs().values()];
    return filter ? out.filter(filter) : out;
  }

  putJob(j: JobRow): void {
    this.allJobs().set(j.id, { ...j });
    this.sql("INSERT OR REPLACE INTO jobs (id, site, board, kind, giver, title, target, tier, reward, posted, deadline, holder, claimed_day, status, result, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(j.id, j.site, j.board, j.kind, j.giver, j.title, j.target, j.tier, j.reward, j.posted, j.deadline, j.holder, j.claimed_day, j.status, j.result, j.ref);
  }

  removeJob(id: string): void {
    this.allJobs().delete(id);
    this.sql("DELETE FROM jobs WHERE id = ?").run(id);
  }

  party(id: string): PartyRow | undefined {
    return this.allParties().get(id);
  }

  partyList(filter?: (p: PartyRow) => boolean): PartyRow[] {
    const out = [...this.allParties().values()];
    return filter ? out.filter(filter) : out;
  }

  putParty(p: PartyRow): void {
    this.allParties().set(p.id, { ...p });
    this.sql("INSERT OR REPLACE INTO parties (id, leader, members, roles, shares, formed, disbanded, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(p.id, p.leader, p.members, p.roles, p.shares, p.formed, p.disbanded, p.record);
  }
}
