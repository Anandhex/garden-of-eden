/**
 * A busy stretch of game days against the model budget (N19): how long the background queue
 * gets, how long each kind of job waits, what is dropped (and in what order), and how fast the
 * player's conversation starts while all that is queued.
 *
 *   npm run bench:busy                       # a week in virtual time, with a stand-in model as slow as the real one (G3)
 *   npm run bench:busy -- --days 30 --slow 3 # a month, with a model three times slower: watch flavour get dropped
 *   npm run bench:busy -- --extra quest-flavor=40,plan=30   # push the queue with extra jobs every day
 *   npm run bench:busy -- --live             # the real model (Ollama), one compressed day: needs `ollama serve`
 *
 * Exits 1 if the player's first word is slower than the target, a protected kind (talk, summary) was dropped,
 * or a kind went over its cap. The stand-in's numbers come from budgets.ts and G3's measurements.
 */
import { budgets, CALL_KINDS, PROTECTED_KINDS, type CallKind } from "../src/budgets.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { type BusyReport, runBusy, simulateBusy } from "../src/metrics/busy.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const days = Number(value("days", flag("live") ? "1" : "7"));
const slow = Number(value("slow", "1"));
const extra: Partial<Record<CallKind, number>> = {};
for (const part of value("extra", "").split(",").filter(Boolean)) {
  const [k, n] = part.split("=");
  if (!CALL_KINDS.includes(k as CallKind)) throw new Error(`Unknown kind "${k}". Kinds: ${CALL_KINDS.join(", ")}`);
  extra[k as CallKind] = Number(n);
}

let report: BusyReport;
if (flag("live")) {
  // One game day squeezed into a couple of minutes of real time: the same jobs, the real model.
  const dayMs = Number(value("day-seconds", "150")) * 1000;
  const start = Date.now();
  const bgModel = new OllamaProvider();
  const talkModel = new OllamaProvider();
  console.log(`Live: one compressed day of ${dayMs / 1000} s against ${process.env.NPC_MODEL ?? "the configured model"}. Warming up...`);
  await talkModel.warmUp();
  report = await runBusy(
    { now: () => Date.now() - start, advanceTo: (t) => new Promise((r) => setTimeout(r, Math.max(0, t - (Date.now() - start)))), talk: talkModel, background: bgModel },
    { days, dayMs, talksPerDay: Number(value("talks", "4")), planners: Number(value("planners", "8")), flavours: 4, extra },
  );
} else {
  report = await simulateBusy({ days, slow, extra });
}

const pad = (v: string | number, n: number) => String(v).padStart(n);
console.log(`\n${report.days} game day${report.days === 1 ? "" : "s"} (${(report.elapsedMs / 1000 / 60).toFixed(0)} min ${flag("live") ? "of real time" : "of virtual time"}), model ${slow === 1 ? "at the measured speed" : `${slow}x slower`}.\n`);
console.log(`${"kind".padEnd(14)}${pad("calls", 7)}${pad("cap/day", 9)}${pad("peak/day", 10)}${pad("capped", 8)}${pad("shed", 6)}${pad("avg wait", 10)}${pad("max wait", 10)}`);
for (const k of CALL_KINDS) {
  const r = report.kinds[k];
  const cap = budgets.model.perGameDay[k];
  console.log(`${k.padEnd(14)}${pad(r.calls, 7)}${pad(Number.isFinite(cap) ? cap : "none", 9)}${pad(report.peakPerDay[k], 10)}${pad(r.capped, 8)}${pad(r.shed, 6)}${pad(`${r.waitMs.avg} ms`, 10)}${pad(`${r.waitMs.max} ms`, 10)}`);
}
console.log(`\nQueue: longest ${report.queue.maxLength} jobs, worst estimated wait ${(report.queue.maxEstimatedWaitMs / 1000).toFixed(1)} s (limit ${budgets.model.maxQueueWaitMs / 1000} s).`);
console.log(`Player's first word: average ${report.firstTokenMs.avg} ms, worst ${report.firstTokenMs.max} ms over ${report.firstTokenMs.samples} talks (target ${budgets.model.talkFirstTokenMs} ms).`);

const problems: string[] = [];
if (report.firstTokenMs.max > budgets.model.talkFirstTokenMs) problems.push(`the player's first word took ${report.firstTokenMs.max} ms, past the ${budgets.model.talkFirstTokenMs} ms target`);
for (const k of PROTECTED_KINDS) if (report.kinds[k].shed > 0) problems.push(`${k} jobs were dropped for being busy`);
for (const k of CALL_KINDS) if (Number.isFinite(budgets.model.perGameDay[k]) && report.peakPerDay[k] > budgets.model.perGameDay[k]) problems.push(`${k} went over its cap (${report.peakPerDay[k]} > ${budgets.model.perGameDay[k]})`);
if (problems.length > 0) {
  console.error(`\nOver budget:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nEvery budget holds.");
