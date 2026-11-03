import type { WorldStore } from "../db.js";
import type { LifeCtx } from "../people/step.js";
import { learn } from "../gossip/knowledge.js";
import type { Rec } from "../../store/recordStore.js";
import type { KnownSecret } from "../choice/types.js";

/**
 * Secrets (N46, its base built with N45's affairs): a fact in code with who knows it. A secret is a record of kind "secret" (who it is
 * about, what it is, how bad it would be if it came out) and its knowers are knowledge rows of the ref `s:<record id>`. Gossip never passes
 * an `s:` ref on by itself (its worth is 0: gossip/refs.ts): someone who knows a secret keeps it, tells it on purpose (exposure, an event
 * that does spread), sells it, or uses it (blackmail). The admin view sees them all.
 */
export const SECRET_KINDS = ["affair", "crime", "debt", "loyalty", "runaway", "cover", "bastard", "war_plans", "gift", "plot", "bribe", "cult"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export interface SecretData {
  what: SecretKind;
  /** Who it would harm to have it known (the one who hides it), and anyone else in it. */
  about: string;
  others?: string[];
  /** Words: "Ada Reed is seeing Tom Hale behind her husband's back". */
  text: string;
  /** 1..10: what it would cost them to have it out. */
  weight: number;
  /** The event it began with, when there is one (the crime, the affair's first night). */
  event?: string;
  /** Exposed: the day and the event that made it public. */
  exposed?: { day: number; event: string; by: string };
  /** Blackmail paid on it: who to whom, how much, last day. */
  paid?: Array<{ by: string; to: string; amount: number; day: number }>;
}

export type Secret = Rec<SecretData>;

export const secretRef = (id: string): string => `s:${id}`;

/** A new secret. The id comes from what it is and when (never from a counter), so a place worked out later makes the same one. */
export function addSecret(store: Pick<WorldStore, "records">, o: { site: string | null; day: number; data: SecretData; key: string }): Secret {
  const id = `sec:${o.data.what}:${o.key}`;
  const have = store.records.get<SecretData>(id);
  if (have) return have;
  const rec: Secret = { id, kind: "secret", site: o.site, a: o.data.about, b: o.data.others?.[0] ?? null, data: o.data, since: o.day, status: "kept", ended: null };
  store.records.put(rec);
  return rec;
}

/** Someone comes to know a secret (as a witness, by prying, from someone who told them). */
export function knowSecret(ctx: LifeCtx, who: string, secretId: string, day: number, source = "saw"): boolean {
  if (!ctx.store.records.has(secretId)) return false;
  return learn(ctx, who, secretRef(secretId), { day, source, accuracy: 1 });
}

/** Who knows a secret (the one it's about always does). */
export function knowersOf(store: Pick<WorldStore, "knowledge">, secretId: string): string[] {
  return store.knowledge.holders(secretRef(secretId)).map((k) => k.who).sort();
}

/** Secrets someone knows about others. */
export function secretsKnownBy(store: Pick<WorldStore, "knowledge" | "records">, who: string): Secret[] {
  return store.knowledge
    .rowsOf(who)
    .filter((r) => r.ref.startsWith("s:"))
    .map((r) => store.records.get<SecretData>(r.ref.slice(2)))
    .filter((s): s is Secret => !!s && s.ended === null);
}

/** The secrets about a person that are still kept. */
export const secretsAbout = (store: Pick<WorldStore, "records">, who: string): Secret[] => store.records.open<SecretData>("secret", (s) => s.data.about === who || (s.data.others ?? []).includes(who));

/**
 * Who in a place knows a secret about someone else, for the day's choices (N46): knower → what they know, with whether they already
 * demand something on it. One read of the place's open secrets, not one per person.
 */
export function secretsHeldAt(store: Pick<WorldStore, "knowledge" | "records" | "people">, site: string): Map<string, KnownSecret[]> {
  const out = new Map<string, KnownSecret[]>();
  const secrets = store.records.open<SecretData>("secret", (s) => s.site === site && !s.data.exposed);
  if (secrets.length === 0) return out;
  const demands = store.records.open<DemandData>("demand", (d) => d.site === site);
  for (const s of secrets) {
    const about = store.people.get(s.data.about);
    if (!about || about.death !== null) continue;
    for (const k of store.knowledge.holders(secretRef(s.id))) {
      if (k.who === s.data.about || (s.data.others ?? []).includes(k.who) || k.who === "player") continue;
      const list = out.get(k.who) ?? [];
      list.push({ id: s.id, about: about.id, aboutName: about.name, what: s.data.what, text: s.data.text, weight: s.data.weight, demanding: demands.some((d) => d.data.secret === s.id && d.data.by === k.who) });
      out.set(k.who, list);
    }
  }
  return out;
}

/** A demand made on a secret (blackmail): who of whom, what, how often, paid how many times. */
export interface DemandData {
  secret: string;
  by: string;
  of: string;
  /** Copper a payment (in coin for those with a purse, in kind for townsfolk, who have none). */
  amount: number;
  every: number;
  paid: number;
  last?: number;
  answer?: "pay" | "refuse" | "flee" | "silence";
}
