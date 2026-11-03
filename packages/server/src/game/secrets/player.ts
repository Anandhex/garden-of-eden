import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { rankOf, temperOf } from "../chatter/person.js";
import { adjustRel } from "../chatter/rel.js";
import { streamFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { playerKnows, playerLearns } from "../playerKnowledge.js";
import { mint } from "../realm/ledger.js";
import { answerOf, expose, silence } from "./use.js";
import { knowSecret, secretRef, type DemandData, type Secret, type SecretData } from "./model.js";

/**
 * The player and secrets (N46 step 6): pry (watch someone, ask their servants), and use what they know like anyone: keep it, sell it to
 * someone who hates its subject, blackmail, or expose it. The same events and the same answers as townsfolk's (secrets/use.ts).
 */
export const secretsOfPlayer = (ctx: LifeCtx, p: PlayerState): Secret[] =>
  Object.keys(p.known ?? {})
    .filter((r) => r.startsWith("s:"))
    .map((r) => ctx.store.records.get<SecretData>(r.slice(2)))
    .filter((s): s is Secret => !!s && !s.data.exposed);

/** Pry into someone's life: an hour or two of watching and asking. Finds a secret of theirs (or their household's) by chance. */
export function pry(ctx: LifeCtx, p: PlayerState, target: PersonRow, day: number, hour: number): string[] {
  const secrets = ctx.store.records.open<SecretData>("secret", (s) => !s.data.exposed && (s.data.about === target.id || (s.data.others ?? []).includes(target.id)));
  const rng = streamFor(ctx.realm.seed, "pry", "player", target.id, day, hour);
  const unknown = secrets.filter((s) => !playerKnows(p, secretRef(s.id)));
  // Being seen prying costs their trust.
  if (rng() < 0.25) adjustRel(ctx.store, target.id, "player", { trust: -10 }, day);
  if (unknown.length === 0 || rng() > 0.35 + 0.05 * (p.skills?.lockpicking ?? 0)) return [`You watch ${target.name} and ask about them, but learn nothing worth knowing.`];
  const s = unknown[Math.floor(rng() * unknown.length)]!;
  playerLearns(p, secretRef(s.id), "saw", day, { text: s.data.text });
  return [`You find something out: ${s.data.text}.`];
}

/** Sell a secret to someone who would pay for it (a rival, an enemy of its subject): they know it now, and may use it. */
export function sellSecret(ctx: LifeCtx, p: PlayerState, secretId: string, buyer: PersonRow, day: number): string[] {
  const s = ctx.store.records.get<SecretData>(secretId);
  if (!s || !playerKnows(p, secretRef(secretId))) return ["You don't know that."];
  const hate = ctx.store.social.openBetween(buyer.id, s.data.about).reduce((a, g) => a + g.weight, 0);
  if (hate <= 0 && temperOf(buyer).greed < 0.5) return [`${buyer.name} has no use for it.`];
  const price = Math.round(5 + s.data.weight * 3 * (1 + hate));
  knowSecret(ctx, buyer.id, secretId, day, "bought");
  // Coin comes in from outside the books (townsfolk have no purse): the player's earnings, like a wage.
  mint(ctx.realm, "player", price, `sold a secret to ${buyer.name}`, p, day);
  return [`${buyer.name} pays you ${price} copper for it.`];
}

/** Blackmail someone with what you know: they answer as they would anyone (pay, refuse, flee, or silence you). */
export function blackmailBy(ctx: LifeCtx, p: PlayerState, secretId: string, day: number): string[] {
  const { realm, store } = ctx;
  const s = store.records.get<SecretData>(secretId);
  if (!s || !playerKnows(p, secretRef(secretId))) return ["You don't know that."];
  const subject = store.people.get(s.data.about);
  if (!subject || subject.death !== null) return ["There's nobody left to ask."];
  const id = `demand:${secretId}:player`;
  if (store.records.has(id)) return [`${subject.name} already knows what you want.`];
  const amount = 10 * Math.max(1, rankOf(subject));
  store.records.put<DemandData>({ id, kind: "demand", site: subject.site, a: "player", b: subject.id, since: day, status: "open", ended: null, data: { secret: secretId, by: "player", of: subject.id, amount, every: 12, paid: 0 } });
  recordLifeEvent(realm, store, { kind: "blackmail", actor: "player", target: subject.id, site: subject.site, day, key: id, details: `${p.name} told ${subject.name} what they know, and named a price for keeping quiet`, importance: 3, causedBy: [secretId] });
  adjustRel(store, subject.id, "player", { fear: 12, affection: -25, trust: -20 }, day);
  const playerAsKnower = { ...subject, id: "player", cls: "commoner", traits: null, outlook: null } as PersonRow;
  const { answer } = answerOf(ctx, subject, playerAsKnower, s.data, id);
  if (answer === "pay") {
    store.records.patch<DemandData>(id, { data: { answer: "pay", paid: 1, last: day } });
    mint(realm, "player", amount, `paid by ${subject.name} for silence`, p, day);
    return [`${subject.name} pays you ${amount} copper, and hates you for it.`];
  }
  if (answer === "silence") {
    silence(ctx, subject, playerAsKnower, secretId, id, day, "the player knew too much");
    p.society ??= {};
    (p.society.threats ??= []).push({ by: subject.id, day, why: s.data.text });
    return [`${subject.name} looks at you a long moment. "Speak of it, and you'll wish you hadn't."`];
  }
  store.records.patch<DemandData>(id, { status: answer === "flee" ? "fled" : "refused", data: { answer } });
  return [answer === "flee" ? `${subject.name} says nothing; by morning their household is packing.` : `${subject.name} tells you to say what you like.`];
}

/** Tell everyone. */
export function exposeBy(ctx: LifeCtx, p: PlayerState, secretId: string, day: number, hour: number, witnesses: string[]): string[] {
  const { realm, store } = ctx;
  const s = store.records.get<SecretData>(secretId);
  if (!s || !playerKnows(p, secretRef(secretId))) return ["You don't know that."];
  const subject = store.people.get(s.data.about);
  const site = subject?.site ?? s.site ?? "";
  const e = recordLifeEvent(realm, store, { kind: "exposure", actor: "player", target: s.data.about, site, day, hour, key: `${secretId}:player`, details: `${p.name} told everyone: ${s.data.text}`, importance: Math.min(9, 3 + Math.ceil(s.data.weight / 2)), causedBy: [secretId], witnesses });
  for (const w of witnesses) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
  expose(ctx, secretId, e, day);
  if (subject) adjustRel(store, subject.id, "player", { affection: -40, trust: -20 }, day);
  return [`You tell it to all who will listen. By tonight the whole place will know.`];
}
