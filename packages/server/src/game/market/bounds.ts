import type { WorldStore } from "../db.js";
import type { Realm } from "../realm/types.js";
import { gradeRecord } from "./grades.js";

/**
 * N42's balance bounds, at the end of a long run: most jobs end (done or expired) rather than sit held past their deadlines; adventurers
 * die sometimes but not all; their grades spread out; and a place with a board usually has something open.
 */
export function checkMarketBounds(realm: Realm, store: Pick<WorldStore, "jobs">): Array<{ name: string; ok: boolean; detail: string }> {
  const day = realm.day;
  const jobs = store.jobs.list();
  const stuck = jobs.filter((j) => j.status === "held" && j.deadline < day - 2).length;
  const done = realm.stats.jobs_done ?? 0;
  const failed = realm.stats.jobs_failed ?? 0;
  const adv = Object.values(realm.figures).filter((f) => f.role === "adventurer" || f.role === "hunter");
  const dead = adv.filter((f) => !f.alive).length;
  const grades = new Set(adv.filter((f) => f.alive).map((f) => gradeRecord(realm, f.id).g));
  const boards = new Set(jobs.map((j) => j.site));
  const open = new Set(jobs.filter((j) => j.status === "open").map((j) => j.site));
  return [
    { name: "jobs-get-done", ok: stuck <= Math.max(2, jobs.length * 0.1), detail: `${done} done, ${failed} failed, ${stuck} held past their deadline` },
    { name: "adventurer-deaths", ok: adv.length === 0 || dead < adv.length * 0.8, detail: `${dead} of ${adv.length} adventurers and hunters dead` },
    { name: "grades-spread", ok: adv.length < 6 || grades.size >= 2, detail: `grades held: ${[...grades].sort().join(", ")}` },
    { name: "player-gets-jobs", ok: boards.size === 0 || open.size >= Math.ceil(boards.size * 0.3), detail: `${open.size} of ${boards.size} places with a board have work open` },
  ];
}
