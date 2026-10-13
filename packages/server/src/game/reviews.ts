import { createHash } from "node:crypto";
import { config } from "../config.js";
import type { BackgroundWork } from "../director/background.js";
import type { LLMProvider } from "../llm/provider.js";
import { type FactsSheet, factsFor } from "../npc/depth/facts.js";
import { applyChanges } from "../npc/review/apply.js";
import { CLOSENESS, impactOn, type Closeness, type Shock, type ShockKind, SHOCK_WEIGHTS } from "../npc/review/impact.js";
import { reviewInput, reviewInputNow, worthReviewing } from "../npc/review/inputs.js";
import { modelReviews } from "../npc/review/model.js";
import { ruleProposal } from "../npc/review/rules.js";
import type { Proposal, ReviewInput } from "../npc/review/types.js";
import { checkProposal } from "../npc/review/validate.js";
import { FRIEND_AFFECTION } from "../npc/social.js";
import type { NpcPersona, NpcState } from "../npc/types.js";
import type { WorldStore } from "./db.js";
import { streamFor } from "./dice.js";
import { type GameEvent, recordEvent } from "./events.js";
import { cycleDue } from "./people/outlook.js";
import { townHits } from "./people/outlook.js";
import type { SiteStep } from "./people/step.js";
import type { SavedWorld } from "./save.js";

/**
 * Lives that change, for the people who talk (N25b steps 3, 5 and 6). Everyone who talks is reviewed every few days and the
 * same day a big event hits their life. A review gathers what they know (npc/review/inputs.ts), asks the model what
 * changes (npc/review/model.ts, several people to a call) or, when the model is off, over budget or gives nothing
 * usable, applies code's rules (rules.ts); every proposal goes through the same checks (validate.ts) and the same
 * apply (apply.ts), and is recorded with its reasons (`life_reviews`). The model proposes; code decides.
 *
 * Who is reviewed when:
 *  - the player's place and companions: every `review.everyDays` days (spread by a seeded offset), by the model in batches;
 *  - a place on arrival: one review covering the time away, however many cycles were missed;
 *  - talkers elsewhere: only when something big hits them, or every third cycle when the queue has room;
 *  - a shock (impact over the bar): that day, with the larger limits, the model first for talkers at the player's place;
 *  - everyone else (the townsfolk): code's rules, in the people's day (game/people/outlook.ts).
 */

/** The queue is "quiet" (the model has room for reviews of people away) below this estimated wait, ms. */
export const QUIET_WAIT_MS = 30_000;
/** Most reviews of people away from the player in one day. */
export const AWAY_PER_DAY = 6;

export interface Agentish {
  state: NpcState;
  persona: NpcPersona;
  isDead: boolean;
}

/** What the reviews need of the town. */
export interface ReviewHost {
  world: SavedWorld;
  store?: WorldStore | undefined;
  personas: Record<string, NpcPersona>;
  agents: Record<string, Agentish>;
  background: BackgroundWork;
  bgLlm: LLMProvider;
  /** Where the player is. */
  site(): string;
  /** Who travels with the player. */
  companionIds(): string[];
  /** A talker's file changed: a new agent on the same state. */
  replaceNpc(persona: NpcPersona): unknown;
  /** Is the model to be asked? (Off: code's rules do every review.) */
  modelOn(): boolean;
}

const hashOf = (input: ReviewInput): string => createHash("sha1").update(JSON.stringify({ ...input, day: undefined })).digest("hex").slice(0, 12);

export class LifeReviews {
  /** Shock reviews already made today for a (shock, person) pair, so a shock reviews each person once. */
  private seen = new Set<string>();
  private awayToday = { day: -1, n: 0 };

  constructor(private readonly h: ReviewHost) {}

  private get day(): number {
    return this.h.world.day;
  }

  private live(id: string): boolean {
    const a = this.h.agents[id];
    return !!a && !a.isDead && !a.state.dormant && a.state.outcome !== "dead";
  }

  // ---- When ----

  /** A new day began: the cycle reviews that fall on it. */
  newDay(): void {
    const day = this.day;
    const here = this.h.site();
    const near = new Set(this.h.companionIds());
    const due: string[] = [];
    const away: string[] = [];
    for (const [id, t] of Object.entries(this.h.world.talkers ?? {})) {
      if (!this.live(id)) continue;
      if (!cycleDue(id, day)) continue;
      if (t.site === here || near.has(id)) due.push(id);
      // People away: only every third cycle, and only when the queue has room.
      else if (Math.floor((day + 0) / config.review.everyDays) % 3 === 0) away.push(id);
    }
    this.queue(due);
    if (this.h.background.estimatedWait() < QUIET_WAIT_MS) {
      if (this.awayToday.day !== day) this.awayToday = { day, n: 0 };
      const room = Math.max(0, AWAY_PER_DAY - this.awayToday.n);
      this.awayToday.n += Math.min(room, away.length);
      this.queue(away.slice(0, room));
    }
    if (this.seen.size > 2000) this.seen.clear();
  }

  /** The player arrived: everyone there who has gone `everyDays` or more without a review gets one, covering the time away. */
  arrive(site: string): void {
    const day = this.day;
    const ids = Object.entries(this.h.world.talkers ?? {})
      .filter(([id, t]) => t.site === site && this.live(id) && day - (this.h.agents[id]!.state.review?.day ?? day - config.review.everyDays) >= config.review.everyDays)
      .map(([id]) => id);
    this.queue(ids);
  }

  /** Something big happened: whoever it hits hard enough is reviewed today (with the larger limits). */
  shock(shock: Shock): void {
    const index = this.closeness();
    // Who could be touched: for a place's or a kingdom's event, its people; for a person's, those who list a victim as their own, kin or friend.
    const candidates = new Set<string>();
    if (shock.scope === "person") {
      for (const v of shock.victims) for (const id of index.byRelative.get(v) ?? []) candidates.add(id);
    } else {
      for (const [id, c] of index.of) if (c.site === shock.site || (shock.kingdom && c.kingdom === shock.kingdom)) candidates.add(id);
    }
    const hit: Array<{ id: string; impact: number }> = [];
    for (const id of [...candidates].sort()) {
      if (!this.live(id)) continue;
      const key = `${shock.ref}|${id}`;
      if (this.seen.has(key)) continue;
      const impact = impactOn(shock, index.of.get(id)!);
      if (impact < config.review.shockImpact) continue;
      this.seen.add(key);
      hit.push({ id, impact });
    }
    if (hit.length === 0) return;
    const here = this.h.site();
    const near = new Set(this.h.companionIds());
    // The model takes the shocks of the people with the player; the others when it is quiet; else code's rules at once.
    const modelled = hit.filter((x) => this.h.world.talkers?.[x.id]?.site === here || near.has(x.id) || this.h.background.estimatedWait() < QUIET_WAIT_MS);
    const coded = hit.filter((x) => !modelled.includes(x));
    this.queue(modelled.map((x) => x.id), shock, new Map(modelled.map((x) => [x.id, x.impact])));
    for (const x of coded) void this.run([x.id], shock, new Map([[x.id, x.impact]]), true);
  }

  // ---- Closeness ----

  private cache: { day: number; count: number; of: Map<string, Closeness>; byRelative: Map<string, Set<string>> } | null = null;

  /**
   * Who each talker is and who is close to them, for working out how hard an event hits: built once a day (and again when
   * someone new starts to talk) from their family rows, their figure's kin and their friends.
   */
  closeness(): NonNullable<LifeReviews["cache"]> {
    const world = this.h.world;
    const count = Object.keys(world.talkers ?? {}).length;
    if (this.cache && this.cache.day === this.day && this.cache.count === count) return this.cache;
    const of = new Map<string, Closeness>();
    const byRelative = new Map<string, Set<string>>();
    const people = this.h.store?.people;
    const figures = world.realm ? Object.values(world.realm.figures) : [];
    const figOf = new Map(figures.filter((f) => f.talks).map((f) => [f.talks!, f]));
    for (const [id, t] of Object.entries(world.talkers ?? {})) {
      const fig = figOf.get(id);
      const row = people?.get(id) ?? (fig?.person ? people?.get(fig.person) : null) ?? null;
      const ids = [id, ...(row ? [row.id] : []), ...(fig ? [fig.id] : [])];
      const family = new Set<string>();
      const friends = new Set<string>();
      if (row && people) for (const k of [row.spouse, row.mother, row.father, ...people.childrenOf(row.id).map((c) => c.id)]) if (k) family.add(k);
      if (fig && world.realm) {
        for (const p of fig.parents ?? []) family.add(p);
        for (const kid of figures) if (kid.parents?.includes(fig.id)) family.add(kid.id);
      }
      for (const [other, r] of Object.entries(this.h.agents[id]?.state.npcRelations ?? {})) if (r.affection >= FRIEND_AFFECTION && r.trust >= 0) friends.add(other);
      if (row?.master_id) friends.add(row.master_id);
      of.set(id, { ids, site: t.site, kingdom: world.realm?.settlements[t.site]?.kingdom ?? null, family, friends });
      for (const r of [...ids, ...family, ...friends]) {
        let set = byRelative.get(r);
        if (!set) byRelative.set(r, (set = new Set()));
        set.add(id);
      }
    }
    this.cache = { day: this.day, count, of, byRelative };
    return this.cache;
  }

  // ---- Queueing and batching ----

  /** Queue reviews for these people: in batches of `review.batch`, grouped by place, one call each. */
  private queue(ids: string[], shock?: Shock, impacts?: Map<string, number>): void {
    if (ids.length === 0) return;
    const bySite = new Map<string, string[]>();
    for (const id of ids) {
      const site = this.h.world.talkers?.[id]?.site ?? "";
      bySite.set(site, [...(bySite.get(site) ?? []), id]);
    }
    for (const [site, group] of [...bySite].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (let i = 0; i < group.length; i += config.review.batch) {
        const chunk = group.slice(i, i + config.review.batch);
        const key = `life-review:${shock ? shock.ref : "cycle"}:${site}:${this.day}:${chunk.join(",")}`;
        const codeOnly = !this.h.modelOn();
        if (codeOnly) {
          void this.run(chunk, shock, impacts, true);
          continue;
        }
        this.h.background.add({
          key,
          kind: "life-review",
          // Shed from a long queue: code's rules review them at once.
          fallback: () => void this.run(chunk, shock, impacts, true),
          run: async () => void (await this.run(chunk, shock, impacts, false)),
        });
      }
    }
  }

  // ---- A batch ----

  /**
   * Review these people: one model call for them all (the model's proposals), or code's rules (`codeOnly`: the model is off, over budget,
   * or the review was shed from a long queue). Code's rules are a plain read and write, done in one go before this returns; the model's
   * take as long as the model does. Someone already being reviewed by the model isn't reviewed twice at once: the second waits its turn.
   */
  async run(ids: string[], shock?: Shock, impacts?: Map<string, number>, codeOnly = false): Promise<void> {
    const waits = ids.map((id) => this.inflight.get(id)).filter((p): p is Promise<void> => !!p);
    if (waits.length > 0) await Promise.allSettled(waits);
    // A plain cycle review made earlier today is not made again; a shock review always is.
    const todo = ids.filter((id) => this.live(id) && this.h.personas[id] && (shock || this.h.agents[id]!.state.review?.day !== this.day));
    if (todo.length === 0) return;
    const ctx = this.ctx();
    const input = (id: string, f: typeof reviewInputNow) => f(ctx, id, shock ? { shock: { ref: shock.ref, text: shock.text, impact: impacts?.get(id) ?? 0 } } : {});
    if (codeOnly) {
      this.finish(todo.map((id) => input(id, reviewInputNow)).filter((i): i is ReviewInput => this.worthIt(i, shock)), null, shock);
      return;
    }
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    for (const id of todo) this.inflight.set(id, gate);
    try {
      const inputs: ReviewInput[] = [];
      for (const id of todo) {
        const i = await reviewInput(ctx, id, shock ? { shock: { ref: shock.ref, text: shock.text, impact: impacts?.get(id) ?? 0 } } : {});
        if (this.worthIt(i, shock)) inputs.push(i);
      }
      if (inputs.length === 0) return;
      let proposals: Record<string, Proposal> | null = null;
      try {
        proposals = await modelReviews(this.h.bgLlm, inputs);
      } catch {
        proposals = null;
      }
      this.finish(inputs, proposals, shock);
    } finally {
      for (const id of todo) this.inflight.delete(id);
      release();
    }
  }

  private inflight = new Map<string, Promise<void>>();
  /** Reflections still being written to the store (each is an embedding call). */
  private pending = new Set<Promise<unknown>>();

  /** Wait until every review under way, and every memory it left, is written (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0 || this.pending.size > 0) await Promise.allSettled([...this.inflight.values(), ...this.pending]);
  }

  private ctx() {
    const world = this.h.world;
    return { world, store: this.h.store, personas: this.h.personas, states: Object.fromEntries(Object.entries(this.h.agents).map(([id, a]) => [id, a.state])) };
  }

  /** A quiet stretch with nothing to weigh is not worth a call: it is noted and left. */
  private worthIt(input: ReviewInput, shock?: Shock): boolean {
    if (shock || worthReviewing(input)) return true;
    const state = this.h.agents[input.who.id]!.state;
    const was = state.review;
    state.review = { day: this.day, ...(was?.shock !== undefined ? { shock: was.shock } : {}), ...(was?.seen ? { seen: was.seen } : {}) };
    return false;
  }

  /** Check and apply each person's proposal: the model's if it gave a usable one, else code's rules. */
  private finish(inputs: ReviewInput[], proposals: Record<string, Proposal> | null, shock?: Shock): void {
    for (const input of inputs) {
      const id = input.who.id;
      if (!this.live(id)) continue;
      let by: "model" | "code" = proposals?.[id] ? "model" : "code";
      let proposal: Proposal = proposals?.[id] ?? ruleProposal(input);
      let checked = checkProposal(proposal, input, !!shock);
      // A reply with nothing usable in it counts as no reply: code's rules take the person.
      if (by === "model" && checked.accepted.length === 0 && (proposal.changes.length > 0 || proposal.malformed > 0)) {
        const rules = ruleProposal(input);
        const second = checkProposal(rules, input, !!shock);
        checked = { accepted: second.accepted, clipped: [...checked.clipped, ...second.clipped], rejected: [...checked.rejected, ...second.rejected] };
        proposal = { ...rules, malformed: proposal.malformed };
        by = "code";
      }
      this.settle(input, proposal, checked, by, shock);
    }
  }

  /** Apply one person's checked review, record it, remember it. */
  private settle(input: ReviewInput, proposal: Proposal, checked: ReturnType<typeof checkProposal>, by: "model" | "code", shock?: Shock): void {
    const world = this.h.world;
    const id = input.who.id;
    const agent = this.h.agents[id]!;
    const persona = this.h.personas[id]!;
    const sheet: FactsSheet = factsFor({ realm: world.realm ?? null, people: this.h.store?.people ?? null, events: world.events ?? [], day: this.day, talkers: world.talkers ?? {} }, persona);
    const { persona: next, lines } = applyChanges({ persona, state: agent.state, day: this.day, input, sheet, rng: streamFor(world.seed ?? 1, "review", id, this.day) }, checked.accepted, proposal.mood);
    if (next !== persona) this.h.replaceNpc(next);
    // What changed is known to the person alone: no witnesses, no gossip. One event for the review, of its most telling kind.
    if (lines.length > 0) {
      const order = ["story-turn", "secret-made", "new-goal", "new-fear", "changed-mind"] as const;
      const kind = order.find((k) => lines.some((l) => l.event === k)) ?? "changed-mind";
      recordEvent(world, { kind, actor: id, target: id, details: lines.map((l) => l.text).join("; ").slice(0, 240), importance: shock ? 3 : 2, why: lines.map((l) => l.why).join(" ").slice(0, 280), witnesses: [id], knownBy: [id], ...(input.who.site ? { site: input.who.site } : {}) });
    }
    this.h.store?.logReview({ who: id, day: this.day, by, ...(shock ? { shock: shock.ref } : {}), inputHash: hashOf(input), proposal: { changes: proposal.changes, mood: proposal.mood }, applied: lines, clipped: checked.clipped, rejected: checked.rejected });
    // The review is a memory too, found by meaning the next time something like it comes up.
    if (lines.length > 0 && this.h.store) {
      const text = `${persona.name.split(" ")[0]} thought it over: ${lines.map((l) => l.why).join(" ")}`.slice(0, 260);
      const write = this.h.store
        .addMemory(id, this.day, "reflection", text, shock ? 6 : 3)
        .then(() => void this.h.store!.pruneMemories(id))
        .catch(() => undefined)
        .finally(() => void this.pending.delete(write));
      this.pending.add(write);
    }
  }
}

// ---- Where shocks come from ----

/** A big event the game recorded (the player attacked, robbed or killed someone, a raid, a death): the shock it is, if it is one. */
export function shockFromEvent(e: GameEvent, realmKingdomOf: (site: string) => string | null): Shock | null {
  const base = { day: e.day, ...(e.site ? { site: e.site } : {}), kingdom: e.site ? realmKingdomOf(e.site) : null };
  const personal = (kind: ShockKind, victims: string[], text: string): Shock => ({ ref: `s:${kind}:${e.id}`, kind, text, scope: "person", victims, ...base });
  switch (e.kind) {
    case "killed":
      return personal("family-death", [e.target], e.details);
    case "death":
      return personal("family-death", [e.actor], e.details);
    case "attacked":
    case "subdued":
      return e.target ? personal("attacked", [e.target], e.details) : null;
    case "looted":
    case "theft":
    case "theft-caught":
      return e.target ? personal("robbed", [e.target], e.details) : null;
    case "marriage":
      return personal("wedding", [e.actor, e.target].filter(Boolean), e.details);
    case "raid":
      return e.site ? { ref: `s:raid:${e.id}`, kind: "raid", text: e.details, scope: "town", victims: [], ...base } : null;
    default:
      return null;
  }
}

/** The shocks a day's step made: deaths and weddings in families, and a place's raid, war, famine or plague beginning. */
export function shocksFromStep(step: SiteStep, store: Pick<WorldStore, "people">, kingdomOf: (site: string) => string | null, siteName: string): Shock[] {
  const out: Shock[] = [];
  const base = { day: step.day, site: step.site, kingdom: kingdomOf(step.site) };
  for (const d of step.deaths) {
    // The dead are the victims; whoever lists them as family (or a close friend) is hit through their own closeness.
    out.push({ ref: `s:family-death:${d.id}`, kind: "family-death", text: `${d.name} died${d.record.cause === "old-age" ? " of old age" : ` (${d.record.cause})`}`, scope: "person", victims: [d.id, ...(d.persona ? [d.persona] : []), ...(d.figure ? [d.figure] : [])], ...base });
  }
  for (const [a, b] of step.marriages) out.push({ ref: `s:wedding:${a}:${b}`, kind: "wedding", text: `a wedding`, scope: "person", victims: [a, b], ...base });
  const flips = townHits(store.people, step.site, step.day);
  for (const h of flips) {
    const kind: ShockKind = h.kind === "raid" ? "raid" : h.kind === "war" ? "war" : h.kind === "famine" ? "famine" : "plague";
    const text = kind === "raid" ? `${siteName} was raided` : kind === "war" ? "the kingdom went to war" : kind === "famine" ? `famine began in ${siteName}` : `sickness began to spread in ${siteName}`;
    out.push({ ref: `s:${kind}:${step.site}:${step.day}`, kind, text, scope: kind === "war" ? "kingdom" : "town", victims: [], ...base });
  }
  return out;
}

export { CLOSENESS, SHOCK_WEIGHTS };
