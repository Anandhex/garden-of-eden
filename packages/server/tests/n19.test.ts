/**
 * N19: performance and model-call budgets. Every model call has a kind and a cap per game
 * day; over the cap a call doesn't happen and its caller uses template words. The background
 * queue runs the most protected kind first and sheds flavour when it is too long. Tick, frame
 * and queue numbers live in src/budgets.ts and are checked here, in `sim:realm --check` and in
 * `bench:busy`. Tests run with the model off or faked; times are checked against PERF_SLACK.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgets, CALL_KINDS, kindRank, perfSlack, tickBudgets, type CallKind } from "../src/budgets.js";
import { config } from "../src/config.js";
import { BackgroundWork } from "../src/director/background.js";
import { structured } from "../src/director/structured.js";
import { WorldStore } from "../src/game/db.js";
import { worldHash } from "../src/game/hash.js";
import { advanceRealm } from "../src/game/realm/day.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { BudgetedProvider, CallDropped, ModelLedger } from "../src/llm/budgeted.js";
import { health } from "../src/admin/health.js";
import type { AdminContext } from "../src/admin/context.js";
import { checkBudgets } from "../src/metrics/budget.js";
import { SimModel, VirtualClock, defaultLatency, simulateBusy } from "../src/metrics/busy.js";
import { resetTimings, snapshot } from "../src/metrics/timing.js";
import { FakeProvider, makeTown, say } from "./helpers.js";

const caps = { ...budgets.model.perGameDay };
const wait = { ...budgets.model };
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
  resetTimings();
});
afterEach(() => {
  Object.assign(budgets.model.perGameDay, caps);
  budgets.model.maxQueueWaitMs = wait.maxQueueWaitMs;
});

const Word = z.object({ word: z.string() });
const json = (word: string) => say(JSON.stringify({ word }));
const ask = (llm: BudgetedProvider, kind: CallKind) => structured(llm, Word, { kind, system: "s", prompt: "p" });

describe("N19.1 kinds, caps and fallbacks", () => {
  it("lists the kinds most protected first, with a cap for each (talk has none)", () => {
    expect(CALL_KINDS[0]).toBe("talk");
    expect(CALL_KINDS[1]).toBe("summary");
    expect(kindRank("plan")).toBeLessThan(kindRank("quest-flavor"));
    for (const k of CALL_KINDS) expect(k in budgets.model.perGameDay).toBe(true);
    expect(Number.isFinite(budgets.model.perGameDay.talk)).toBe(false);
  });

  it("with a cap of 1 retell a day, the second retell that day gets no model call and is logged as dropped", async () => {
    budgets.model.perGameDay.retell = 1;
    let day = 1;
    const ledger = new ModelLedger(() => day);
    const fake = new FakeProvider([json("a"), json("b"), json("c")]);
    const llm = new BudgetedProvider(fake, ledger);
    expect(await ask(llm, "retell")).toEqual({ word: "a" });
    expect(await ask(llm, "retell")).toBeNull();
    expect(fake.requests).toHaveLength(1);
    expect(ledger.recent().filter((c) => c.dropped)).toEqual([expect.objectContaining({ kind: "retell", day: 1, dropped: true })]);
    // Another kind has its own cap; the next game day starts the count again.
    expect(await ask(llm, "plan")).toEqual({ word: "b" });
    day = 2;
    expect(await ask(llm, "retell")).toEqual({ word: "c" });
    expect(ledger.rows().find((r) => r.kind === "retell")).toMatchObject({ callsToday: 1, cap: 1, droppedToday: 0, droppedTotal: 1 });
  });

  it("each kind's cap drops the next call of that kind", async () => {
    for (const kind of CALL_KINDS.filter((k) => k !== "talk")) {
      budgets.model.perGameDay[kind] = 2;
      const llm = new BudgetedProvider(new FakeProvider([json("1"), json("2"), json("3")]), new ModelLedger(() => 1));
      expect(await ask(llm, kind), kind).not.toBeNull();
      expect(await ask(llm, kind), kind).not.toBeNull();
      expect(await ask(llm, kind), kind).toBeNull();
    }
  });

  it("talk is never dropped, whatever else has been spent", async () => {
    for (const k of CALL_KINDS) budgets.model.perGameDay[k] = 0;
    budgets.model.perGameDay.talk = Infinity;
    const llm = new BudgetedProvider(new FakeProvider([say("Hello.")]), new ModelLedger(() => 1));
    const r = await llm.chat({ kind: "talk", system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(r.text).toBe("Hello.");
  });

  it("a retry is logged but doesn't count against the cap", async () => {
    budgets.model.perGameDay.plan = 1;
    const ledger = new ModelLedger(() => 1);
    const llm = new BudgetedProvider(new FakeProvider([say("not json"), json("fine")]), ledger);
    expect(await ask(llm, "plan")).toEqual({ word: "fine" });
    expect(ledger.recent()).toHaveLength(2);
    expect(ledger.recent()[1]).toMatchObject({ retry: true });
    expect(ledger.callsToday("plan")).toBe(1);
    expect(await ask(llm, "plan")).toBeNull();
  });

  it("a call that fails (or is aborted for the player) is logged but doesn't use up the cap", async () => {
    budgets.model.perGameDay.plan = 1;
    const ledger = new ModelLedger(() => 1);
    let fail = true;
    const llm = new BudgetedProvider(
      {
        chat: async () => {
          if (fail) throw new Error("aborted");
          return say(JSON.stringify({ word: "ok" }));
        },
      },
      ledger,
    );
    await expect(llm.chat({ kind: "plan", system: "s", messages: [] })).rejects.toThrow("aborted");
    expect(ledger.recent().at(-1)).toMatchObject({ kind: "plan", failed: true });
    fail = false;
    expect(await ask(llm, "plan")).toEqual({ word: "ok" });
  });

  it("generate exists only if the real provider has one, so structured() still falls back to chat", () => {
    expect(new BudgetedProvider(new FakeProvider(), new ModelLedger(() => 1)).generate).toBeUndefined();
    const withGenerate = { chat: async () => say(""), generate: async () => "{}" };
    expect(new BudgetedProvider(withGenerate, new ModelLedger(() => 1)).generate).toBeTypeOf("function");
  });

  it("the whole town copes with every flavour call refused: template words stand and no job fails", async () => {
    for (const k of CALL_KINDS) if (k !== "talk") budgets.model.perGameDay[k] = 0;
    config.director = true;
    config.planning = true;
    config.summaries = true;
    const fake = new FakeProvider();
    const town = makeTown({ llm: fake, rng: null });
    for (let d = 0; d < 3; d++) town.passHours(24);
    await town.background.drain();
    expect(town.background.stats.failed).toBe(0);
    // Plans, flavour and the chronicle were asked for, and not one reached the model.
    expect(fake.requests).toHaveLength(0);
    const dropped = Object.fromEntries(town.ledger.rows().map((r) => [r.kind, r.droppedTotal]));
    expect(dropped.plan).toBeGreaterThan(0);
    expect(dropped["quest-flavor"]).toBeGreaterThan(0);
  });

  it("keeps every call in the database's model_calls table, apart from the world's state", async () => {
    const store = new WorldStore(":memory:");
    const town = makeTown({ store, llm: new FakeProvider([json("x")]) });
    const before = worldHash(town.world, store);
    await structured((town as unknown as { llm: BudgetedProvider }).llm, Word, { kind: "plan", system: "s", prompt: "p" });
    const rows = store.modelCallStats(town.world.day);
    expect(rows).toEqual([expect.objectContaining({ kind: "plan", calls: 1 })]);
    // Real time and token counts are a measurement, not the world.
    expect(worldHash(town.world, store)).toBe(before);
    store.close();
  });
});

describe("N19.2 priorities in the background queue", () => {
  /** A queue whose first job holds the model until `release()`, so the rest line up behind it. */
  function lineUp() {
    const ran: string[] = [];
    let release!: () => void;
    const bg = new BackgroundWork(() => {}, { avgMs: () => 1000, maxWaitMs: 1e9 });
    bg.add({ key: "blocker", kind: "talk", run: () => new Promise<void>((r) => (release = r)) });
    const add = (key: string, kind: CallKind, fallback?: () => void) => bg.add({ key, kind, run: async () => void ran.push(key), ...(fallback ? { fallback } : {}) });
    return { bg, ran, add, release: () => release() };
  }

  it("runs summary, then plan, then flavour, whatever order they were queued in", async () => {
    const { bg, ran, add, release } = lineUp();
    add("flavor:a", "quest-flavor");
    add("plan:a", "plan");
    add("summary:a", "summary");
    add("chronicle:1", "chronicle");
    add("plan:b", "plan");
    expect(bg.queued()).toEqual(["summary:a", "plan:a", "plan:b", "chronicle:1", "flavor:a"]);
    release();
    await bg.drain();
    expect(ran).toEqual(["summary:a", "plan:a", "plan:b", "chronicle:1", "flavor:a"]);
  });

  it("is first in, first out within a kind, and a job that comes back after the player acted goes first", async () => {
    const { bg, ran, add, release } = lineUp();
    add("plan:1", "plan");
    add("plan:2", "plan");
    add("plan:3", "plan");
    release();
    await bg.drain();
    expect(ran).toEqual(["plan:1", "plan:2", "plan:3"]);
  });

  it("when the wait passes the limit, new flavour is dropped at once and its fallback runs; summaries still run", async () => {
    const dropped: string[] = [];
    const ran: string[] = [];
    let release!: () => void;
    const bg = new BackgroundWork(() => {}, { avgMs: () => 10_000, maxWaitMs: 30_000, onDrop: (j) => dropped.push(j.key) });
    const fell: string[] = [];
    bg.add({ key: "blocker", kind: "talk", run: () => new Promise<void>((r) => (release = r)) });
    for (let i = 0; i < 6; i++) bg.add({ key: `flavor:${i}`, kind: "quest-flavor", run: async () => void ran.push(`flavor:${i}`), fallback: () => void fell.push(`flavor:${i}`) });
    // The blocker (10 s) plus 2 flavour jobs (20 s) fill the 30 s; the rest were dropped as they came.
    expect(fell).toEqual(["flavor:2", "flavor:3", "flavor:4", "flavor:5"]);
    expect(dropped).toEqual(fell);
    bg.add({ key: "summary:a", kind: "summary", run: async () => void ran.push("summary:a") });
    bg.add({ key: "summary:b", kind: "summary", run: async () => void ran.push("summary:b") });
    bg.add({ key: "summary:c", kind: "summary", run: async () => void ran.push("summary:c") });
    // Summaries pushed the wait further, and flavour made way for them; none of the summaries were dropped.
    expect(ran).toEqual([]);
    release();
    await bg.drain();
    expect(ran.filter((k) => k.startsWith("summary"))).toEqual(["summary:a", "summary:b", "summary:c"]);
    expect(ran.filter((k) => k.startsWith("flavor")).length).toBe(0);
    expect(fell).toContain("flavor:0");
    expect(bg.stats.dropped).toBe(fell.length);
  });

  it("sheds from the bottom of the list up: flavour, then the chronicle, then plans; never summaries", () => {
    const fell: string[] = [];
    const bg = new BackgroundWork(() => {}, { avgMs: () => 10_000, maxWaitMs: 50_000 });
    bg.add({ key: "blocker", kind: "talk", run: () => new Promise<void>(() => {}) });
    const add = (key: string, kind: CallKind) => bg.add({ key, kind, run: async () => {}, fallback: () => void fell.push(key) });
    add("plan:a", "plan");
    add("retell:a", "retell");
    add("flavor:a", "quest-flavor");
    add("chronicle:1", "chronicle");
    expect(fell).toEqual([]);
    add("summary:1", "summary");
    expect(fell).toEqual(["flavor:a"]);
    add("summary:2", "summary");
    expect(fell).toEqual(["flavor:a", "retell:a"]);
    add("summary:3", "summary");
    expect(fell).toEqual(["flavor:a", "retell:a", "chronicle:1"]);
    add("summary:4", "summary");
    expect(fell).toEqual(["flavor:a", "retell:a", "chronicle:1", "plan:a"]);
    // Only summaries are left: the queue stays long rather than lose one.
    add("summary:5", "summary");
    add("summary:6", "summary");
    expect(fell).toHaveLength(4);
    expect(bg.queued()).toEqual(["summary:1", "summary:2", "summary:3", "summary:4", "summary:5", "summary:6"]);
  });

  it("a chronicle shed from a long queue doesn't leave the next night waiting on it", async () => {
    const town = makeTown({ rng: null });
    budgets.model.maxQueueWaitMs = 0;
    // Nothing is running, so a queue of one flavour job is already "too long" with a limit of 0.
    const shed = await Promise.race([town.chronicle(1), new Promise((r) => setTimeout(() => r("stuck"), 1000))]);
    expect(shed).toEqual({ log: [], accepted: [], rejected: [] });
  });
});

describe("N19.3 the player's conversation comes first", () => {
  it("a talk that starts while a background call holds the model gets its first word after the abort, not after the background call ends", async () => {
    const clock = new VirtualClock();
    const model = new SimModel(clock, (k) => (k === "chronicle" ? { first: 300, total: 2000 } : defaultLatency(k)));
    const ledger = new ModelLedger(() => 1);
    const talk = new BudgetedProvider(model.talk(), ledger, () => clock.now);
    const bgLlm = new BudgetedProvider(model.background(), ledger, () => clock.now);
    const bg = new BackgroundWork(() => bgLlm.abort(), { avgMs: (k) => ledger.avgMs(k) });
    bg.add({ key: "chronicle:1", kind: "chronicle", run: async () => void (await bgLlm.chat({ kind: "chronicle", system: "s", messages: [] })) });
    await clock.advanceTo(500);
    expect(bg.stats.running).toBe("chronicle:1");

    // The player says something: background work makes way.
    bg.pause();
    const started = clock.now;
    let firstWord = -1;
    const reply = talk.chat({ kind: "talk", system: "s", messages: [{ role: "user", content: "hi" }] }, () => {
      if (firstWord < 0) firstWord = clock.now - started;
    });
    await clock.advanceTo(started + 4000);
    await reply;
    expect(firstWord).toBe(300);
    expect(firstWord).toBeLessThan(budgets.model.talkFirstTokenMs);
    expect(ledger.talk()).toEqual({ last: 300, worst: 300 });
    // The chronicle starts again once the reply is done.
    bg.resume();
    await clock.advanceTo(clock.now + 5000);
    await bg.drain();
    expect(bg.stats).toMatchObject({ done: 1, failed: 0 });
  });
});

describe("N19.4 a busy simulated week", () => {
  it("stays inside every cap, drops nothing that is protected, and the player is never kept waiting", async () => {
    const r = await simulateBusy({ days: 7, talksPerDay: 8, planners: 20, flavours: 6, retellsPerDay: 3 });
    expect(r.talks).toBe(56);
    expect(r.firstTokenMs.max).toBeLessThanOrEqual(budgets.model.talkFirstTokenMs);
    for (const k of CALL_KINDS) if (Number.isFinite(budgets.model.perGameDay[k])) expect(r.peakPerDay[k], k).toBeLessThanOrEqual(budgets.model.perGameDay[k]);
    expect(r.kinds.summary.shed + r.kinds.summary.capped).toBe(0);
    expect(r.kinds.talk.shed).toBe(0);
    expect(r.queue.maxEstimatedWaitMs).toBeLessThanOrEqual(budgets.model.maxQueueWaitMs);
    // Every plan got its call, so the cast kept its model-written days.
    expect(r.kinds.plan.calls).toBe(7 * 20);
  });

  it("pushing the queue past its limit drops flavour first, and the player's talk still starts within the first-word target", async () => {
    const r = await simulateBusy({ days: 3, slow: 4, extra: { "quest-flavor": 40, plan: 30, retell: 20 } });
    expect(r.kinds["quest-flavor"].shed).toBeGreaterThan(0);
    // Everything shed that day was lower than everything kept: flavour went before plans.
    expect(r.kinds["quest-flavor"].shed + r.kinds["quest-flavor"].capped).toBeGreaterThan(r.kinds.plan.shed / 4);
    expect(r.kinds.summary.shed).toBe(0);
    expect(r.kinds.summary.calls).toBe(r.talks);
    expect(r.firstTokenMs.max).toBeLessThanOrEqual(budgets.model.talkFirstTokenMs);
    expect(r.queue.maxEstimatedWaitMs).toBeLessThanOrEqual(budgets.model.maxQueueWaitMs + 1);
  });

  it("a real town over a week keeps every tick budget", () => {
    const slack = perfSlack();
    const town = makeTown({ rng: null });
    resetTimings();
    for (let h = 0; h < 7 * 24; h++) town.passHours(1);
    const rows = checkBudgets(snapshot(), slack);
    expect(rows.find((r) => r.name === "passHour")).toMatchObject({ status: expect.stringMatching(/^(ok|warn)$/) });
    expect(rows.find((r) => r.name === "realm.day")).toMatchObject({ status: expect.stringMatching(/^(ok|warn)$/) });
    expect(rows.filter((r) => r.status === "over")).toEqual([]);
  });
});

describe("N19.5 tick budgets", () => {
  it("30 days of the realm at coarse detail: the median day is inside dayCoarseMs", () => {
    const realm = generateRealm(7, 1);
    const medians: number[] = [];
    for (let run = 0; run < 3; run++) {
      resetTimings();
      advanceRealm(realm, realm.day + 30);
      medians.push(snapshot()["realm.day"]!.p50);
    }
    medians.sort((a, b) => a - b);
    expect(medians[1]!).toBeLessThan(budgets.tick.dayCoarseMs * perfSlack());
  });

  it("checkBudgets says ok, warn, over or not measured", () => {
    const t = (p95: number) => ({ last: p95, p50: p95, p95, count: 5 });
    const rows = checkBudgets({ "realm.day": t(10), passHour: t(budgets.tick.hourFullMs * 0.9), flush: t(budgets.tick.flushMs + 1) });
    const by = Object.fromEntries(rows.map((r) => [r.name, r.status]));
    expect(by).toEqual({ "realm.day": "ok", passHour: "warn", flush: "over", "catchup.year": "idle" });
    // Slack widens every limit.
    expect(checkBudgets({ flush: t(budgets.tick.flushMs * 1.6) }, 2).find((r) => r.name === "flush")!.status).toBe("warn");
    expect(tickBudgets().map((b) => b.name)).toEqual(["passHour", "realm.day", "catchup.year", "flush"]);
  });

  it("the batch write is timed as 'flush'", () => {
    const store = new WorldStore(":memory:");
    resetTimings();
    store.commit(1);
    expect(snapshot().flush).toBeDefined();
    store.close();
  });

  it("an environment variable moves a budget, and an impossible one makes `sim:realm --check` exit 1", () => {
    const script = fileURLToPath(new URL("../scripts/sim-realm.ts", import.meta.url));
    const run = (env: Record<string, string>) => spawnSync("npx", ["tsx", script, "--check"], { env: { ...process.env, DAYS: "20", ...env }, encoding: "utf8" });
    const ok = run({});
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("Every measured budget holds");
    const bad = run({ BUDGET_TICK_DAY_MS: "0" });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("over");
  }, 180_000);
});

describe("N19.6 the admin Health tab", () => {
  it("shows each tick budget, each kind of model call against its cap, the queue and the first word", async () => {
    const store = new WorldStore(":memory:");
    const town = makeTown({ rng: null, store, llm: new FakeProvider([say("Hello.")]) });
    resetTimings();
    for (let h = 0; h < 24; h++) town.passHours(1);
    await town.agents.brena!.respond("Hello", town.sceneFor(town.agents.brena!));
    await town.background.drain();
    const ctx: AdminContext = { world: () => town.world, town: () => town, store, queueLength: () => 0 };
    const h = health(ctx);
    expect(h.budgets.tick.map((r) => r.name)).toEqual(["passHour", "realm.day", "catchup.year", "flush"]);
    expect(h.budgets.tick.find((r) => r.name === "passHour")!.p95Ms).not.toBeNull();
    expect(h.budgets.model.map((r) => r.kind)).toEqual([...CALL_KINDS]);
    expect(h.budgets.model[0]).toMatchObject({ kind: "talk", cap: null });
    expect(h.budgets.model.find((r) => r.kind === "plan")!.cap).toBe(budgets.model.perGameDay.plan);
    expect(h.budgets.queue).toMatchObject({ length: 0, maxWaitMs: budgets.model.maxQueueWaitMs });
    expect(h.budgets.talk.targetMs).toBe(budgets.model.talkFirstTokenMs);
    expect(h.budgets.talk.firstTokenMs).not.toBeNull();
    store.close();
  });
});
