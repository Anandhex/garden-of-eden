import type { SocietyAction, SocietyRow, SocietyView } from "@garden-of-eden/shared";
import { config } from "../../config.js";
import type { NpcPersona, NpcState, PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { customsAt, breakTaboo, keepCustom, tonguePenalty } from "../culture/day.js";
import { cultureById } from "../culture/model.js";
import type { WorldStore } from "../db.js";
import { unitFor, type Rng } from "../dice.js";
import { beliefOf, faithOfPlace, peekFaith } from "../faith/model.js";
import { bribeJudge, breakOut, playerCases, tryPlayer } from "../law/player.js";
import { crimes } from "../law/sentence.js";
import type { CaseData } from "../law/trial.js";
import { jailedNow } from "../law/trial.js";
import { learnSpell, playerCast, teacherAt, type PlayerMagic } from "../magic/player.js";
import { forbiddenHere, giftOf, rollGift, schoolById, spellById, spells } from "../magic/model.js";
import { formatMoney } from "../money.js";
import type { LifeCtx } from "../people/step.js";
import { peoplesOf } from "../peoples/generate.js";
import type { SavedWorld } from "../save.js";
import type { SecretData } from "../secrets/model.js";
import { blackmailBy, exposeBy, pry, secretsOfPlayer, sellSecret } from "../secrets/player.js";
import { comeHome, escapeSlavery, helperFor, recoverPack } from "../setback/setback.js";
import { CLAIM_WEIGHT, frame, payVoice, playerPlants } from "../shaping/rumours.js";
import { blackMarket, buyBlack, informOn, joinGuild, trusted } from "../thieves/day.js";
import { denOf, guildAt } from "../thieves/guilds.js";
import { enlist, peekArmies, type SoldierData } from "../war/armies.js";

/**
 * Society in play (N70): every player action of N46–N55 behind one `society` action (`act` with `op` and its arguments), offered only
 * where it can be done, with the same offer-then-confirm as every other costly action; the player's own court day, the exits of a slave's
 * chapter, coming home after a setback; and the panels' rows (the snapshot's `society`). No new rules: each op calls its phase's function.
 *
 * Costly ops (coin, freedom, a lie sworn to) are offered first: the price and the risk go on the player as an offer (`society.offer`), and
 * the `confirm` op does it. The server, the CLI and the tests all go through `societyAct`.
 */
export interface SocietyHost {
  world: SavedWorld;
  store?: WorldStore | undefined;
  agents: Record<string, { persona: NpcPersona; state: NpcState; isDead?: boolean }>;
  site(): string;
  presentAt(place: SavedWorld["player"]["place"]): Array<{ persona: { id: string } }>;
  arriveAt(to: string): string[];
  actionRng(): Rng;
}

export interface SocietyResult {
  ok: boolean;
  lines: string[];
  /** Hours the deed takes (the caller passes them). */
  hours?: number;
  /** Waiting for the player's yes. */
  confirm?: string;
}

/** Ops that cost coin or freedom: offered, then confirmed (design rule 4). */
const COSTLY = new Set(["bribejudge", "blackmail", "buy", "learn", "voice", "frame", "enlist", "ransom", "inform"]);
/** How often a place's court sits (every so many days, from a day of its own). */
export const COURT_EVERY = 6;
/** Court days a player may stay away from their case before it's heard without them. */
export const MISSED_COURT_DAYS = 2;
/** Taboos a person can simply do (the rest are broken by doing the thing: eating, killing). */
const DEEDS: Record<string, string> = { whistling_at_night: "Whistle", whistling_aboard: "Whistle", spilling_salt: "Spill the salt", spilling_milk: "Spill the milk", stepping_on_threshold: "Step on the threshold", speaking_ill_of_the_dead: "Speak ill of the dead" };
/** What eating a thing breaks: horse meat, gull. */
const FOOD_TABOOS: Array<[RegExp, string]> = [
  [/horse/, "eating_horse"],
  [/gull/, "eating_gulls"],
];
/** Who can be paid to say it for you: the innkeeper's evening crowd (the bard), the priest's sermon, the clerk's proclamation. */
const VOICE_OF: Record<string, "bard" | "priest" | "crier"> = { innkeeper: "bard", priest: "priest", clerk: "crier" };

const words = (id: string) => id.replace(/_/g, " ");
const p_ = (h: SocietyHost) => h.world.player;
const ctxOf = (h: SocietyHost): LifeCtx | null => (h.world.realm && h.store ? { realm: h.world.realm, store: h.store } : null);

/** The day a place's court sits. */
export const courtDayAt = (seed: number, site: string, day: number): boolean => (day + Math.floor(unitFor(seed, "court-day", site) * COURT_EVERY)) % COURT_EVERY === 0;
/** The next court day at a place, from a day (inclusive). */
export function nextCourtDay(seed: number, site: string, from: number): number {
  for (let d = from; d < from + COURT_EVERY; d++) if (courtDayAt(seed, site, d)) return d;
  return from;
}

/** A person of the people table the player can deal with: a talker who is a live row of the place the player is in. */
function rowOf(h: SocietyHost, id: unknown): PersonRow | null {
  const r = typeof id === "string" && id ? h.store?.people.get(id) : undefined;
  return r && r.death === null ? r : null;
}

/** Who sees what the player does here: the people of the table standing in the same spot (talkers present who are rows). */
export function onlookers(h: SocietyHost, except: string[] = []): string[] {
  const p = p_(h);
  if (!h.store || p.road) return [];
  return h
    .presentAt(p.place)
    .map((a) => a.persona.id)
    .filter((id) => !except.includes(id) && !h.agents[id]?.isDead && rowOf(h, id) !== null)
    .sort();
}

/** Someone named in a few words, among the grown people of the place ("Hal Webb", "hal"). */
function findByName(h: SocietyHost, text: string, site: string): PersonRow | null {
  const t = text.toLowerCase();
  const rows = (h.store!.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.job !== "child");
  return rows.find((r) => t.includes(r.name.toLowerCase())) ?? rows.find((r) => t.includes(r.name.split(" ")[0]!.toLowerCase()) && r.name.split(" ")[0]!.length > 2) ?? null;
}

/** "Hal Webb stole the grain money": the subject and the claim (CLAIM_WEIGHT's words), and what follows as the detail. */
function parseClaim(h: SocietyHost, text: string, site: string): { subject: PersonRow; claim: string; detail?: string } | null {
  const subject = findByName(h, text, site);
  if (!subject) return null;
  const t = text.toLowerCase();
  const claim = Object.keys(CLAIM_WEIGHT).find((c) => new RegExp(`\\b${c}`).test(t)) ?? (/\bthie|steal/.test(t) ? "stole" : /cheat/.test(t) ? "cheats" : /plot/.test(t) ? "plots" : null);
  if (!claim) return null;
  const after = t.split(new RegExp(`\\b${claim}`))[1]?.trim();
  return { subject, claim, ...(claim === "stole" && after ? { detail: after } : {}) };
}

const kingdomOf = (h: SocietyHost) => {
  const realm = h.world.realm;
  return realm?.settlements[h.site()]?.kingdom ?? null;
};

/** What a costly op will cost and risk, in words, for the offer. Null when it can't be done (the op itself says why). */
function priceOf(h: SocietyHost, op: string, a: Record<string, unknown>): string | null {
  const realm = h.world.realm!;
  const p = p_(h);
  switch (op) {
    case "bribejudge":
      return `Offer the judge ${formatMoney(Number(a.amount) || 0)} to drop the case? An honest judge will charge you with bribery as well.`;
    case "blackmail": {
      const s = h.store?.records.get<SecretData>(String(a.secret ?? ""));
      const who = s ? h.store?.people.get(s.data.about) : undefined;
      return who ? `Tell ${who.name} what you know and name a price? They may pay, refuse, run, or come after you.` : null;
    }
    case "buy": {
      const o = blackMarket(ctxOf(h)!, h.site(), h.world.day).find((x) => x.id === a.offer);
      return o ? `Buy ${o.what} for ${formatMoney(o.price)}? Carrying it is a crime where it's banned.` : null;
    }
    case "learn": {
      const sp = spellById(String(a.spell ?? ""));
      return sp ? `Pay ${formatMoney(20 * sp.rank)} to be taught ${sp.name}?${spellForbiddenWords(h, sp.school)}` : null;
    }
    case "voice": {
      const v = rowOf(h, a.npc);
      const kind = v ? VOICE_OF[v.job] : undefined;
      return v && kind ? `Pay ${v.name} ${formatMoney(kind === "crier" ? 80 : kind === "priest" ? 50 : 25)} to spread it? If the watch traces it to you, it's slander.` : null;
    }
    case "frame": {
      const w = rowOf(h, a.npc);
      return w ? `Pay ${w.name} ${formatMoney(Number(a.bribe) || 40)} to swear to it? If it comes out, the case turns on you.` : null;
    }
    case "enlist": {
      const k = kingdomOf(h);
      return k ? `Put your mark to ${realm.kingdoms[k]?.name ?? "the crown"}'s roll? A soldier goes where the army goes.` : null;
    }
    case "ransom": {
      const price = slavePrice(p);
      return `Buy your freedom for ${formatMoney(price)}${p.money < price ? " (a friend would have to pay it)" : ""}?`;
    }
    case "inform":
      return "Name the guild's members to the watch? Those you can't name will remember who talked.";
  }
  return null;
}

const spellForbiddenWords = (h: SocietyHost, school: string): string =>
  forbiddenHere(h.world.realm!, h.site(), school, h.world.day) ? " It's forbidden here: being seen working it is sorcery." : "";

/** What freedom costs a slave: half again what they were sold for. */
export function slavePrice(p: PlayerState): number {
  const sold = (p.society?.setbacks ?? []).filter((s: { kind: string }) => s.kind === "sold").at(-1) as { price?: number } | undefined;
  return Math.round((sold?.price ?? 120) * 1.5);
}

/** Friends who would pay for the player (talkers who like them and have the coin): N26J's ransom friends. */
function friendsOf(h: SocietyHost): Array<{ name: string; money: number; pay: (n: number) => void }> {
  return Object.values(h.agents)
    .filter((a) => !a.isDead && a.state.relationship >= 40 && a.state.money > 0)
    .sort((a, b) => b.state.money - a.state.money || a.persona.id.localeCompare(b.persona.id))
    .map((a) => ({ name: a.persona.name, money: a.state.money, pay: (n: number) => void (a.state.money -= n) }));
}

/** The free player heads home: when they next arrive there, the story goes ahead of them (N49 step 5). */
function homeward(p: PlayerState, home: string, day: number): void {
  (p.society ??= {}).homeward = { home, day };
}

/**
 * One society op. `args.confirm` (sent by the `confirm` op) does a costly one; without it the price is offered. Refusals come back with
 * `ok: false` and the reason.
 */
export function societyAct(h: SocietyHost, op: string, args: Record<string, unknown> = {}): SocietyResult {
  const realm = h.world.realm;
  const ctx = ctxOf(h);
  const p = p_(h);
  if (!realm || !ctx) return { ok: false, lines: ["There's no wider world here for that."] };
  const day = h.world.day;
  const hour = h.world.hour;
  const site = h.site();
  if (op === "cancel") {
    if (p.society?.offer) delete p.society.offer;
    return { ok: true, lines: ["You think better of it."] };
  }
  if (op === "confirm") {
    const o = p.society?.offer as { op: string; args: Record<string, unknown> } | undefined;
    if (!o) return { ok: false, lines: ["There's nothing waiting on your word."] };
    delete p.society!.offer;
    return societyAct(h, o.op, { ...o.args, confirm: true });
  }
  if (COSTLY.has(op) && args.confirm !== true) {
    const text = priceOf(h, op, args);
    if (!text) return { ok: false, lines: ["That can't be done here."] };
    (p.society ??= {}).offer = { op, args: { ...args }, text, day };
    return { ok: true, lines: [text], confirm: text };
  }
  const held = p.chapter && ["captive", "slave", "prisoner"].includes(p.chapter.kind);
  const free = ["escape", "ransom", "cancel", "confirm", "taboo", "custom", "recover", "bribejudge"];
  if (held && !free.includes(op)) return { ok: false, lines: ["Not while you're held."] };
  const npc = rowOf(h, args.npc);
  const needNpc = (): SocietyResult | null => (npc && npc.site === site ? null : { ok: false, lines: ["They aren't here, or aren't someone you can deal with that way."] });
  const res = (lines: string[], ok = true, hours?: number): SocietyResult => ({ ok, lines, ...(hours ? { hours } : {}) });
  switch (op) {
    // ---- Secrets (N46) ----
    case "pry": {
      if (!config.society.secrets) return res(["Nobody here keeps secrets worth prying into."], false);
      const no = needNpc();
      if (no) return no;
      return res(pry(ctx, p, npc!, day, hour), true, 2);
    }
    case "sellsecret": {
      const no = needNpc();
      if (no) return no;
      const lines = sellSecret(ctx, p, String(args.secret ?? ""), npc!, day);
      return res(lines, /pays you/.test(lines[0] ?? ""));
    }
    case "blackmail":
      return res(blackmailBy(ctx, p, String(args.secret ?? ""), day));
    case "expose": {
      const lines = exposeBy(ctx, p, String(args.secret ?? ""), day, hour, onlookers(h));
      return res(lines, !/don't know/.test(lines[0] ?? ""));
    }
    // ---- The underworld (N47) ----
    case "market": {
      const g = guildAt(realm, site);
      if (!g || !trusted(p, g.id)) return res(["Nobody here knows what you're talking about."], false);
      const offers = blackMarket(ctx, site, day);
      return res(offers.length > 0 ? offers.map((o) => `${o.what}: ${formatMoney(o.price)}`) : ["Nothing to be had just now."]);
    }
    case "buy": {
      const lines = buyBlack(ctx, p, site, String(args.offer ?? ""), day);
      const ok = /^You buy/.test(lines[0] ?? "");
      // What was bought is carried: a banned book is a grimoire the toll can find (N51).
      if (ok && args.offer === "grimoire") p.inventory["grimoire_necromancy"] = (p.inventory["grimoire_necromancy"] ?? 0) + 1;
      if (ok && args.offer === "papers") p.inventory["forged_papers"] = (p.inventory["forged_papers"] ?? 0) + 1;
      if (ok && args.offer === "stolen") p.inventory["stolen_ring"] = (p.inventory["stolen_ring"] ?? 0) + 1;
      return res(lines, ok);
    }
    case "joinguild": {
      if (!config.society.underworld) return res(["There's no guild of thieves here."], false);
      const g = guildAt(realm, site);
      if (!g) return res(["There's no guild of thieves here, or none that will own to it."], false);
      if (!knowsDen(h, site)) return res(["You'd have to know who to ask first."], false);
      return res(joinGuild(ctx, p, site, day));
    }
    case "inform": {
      if (!knowsDen(h, site)) return res(["You know of no guild here to inform on."], false);
      return res(informOn(ctx, p, site, day));
    }
    // ---- The law (N48) ----
    case "breakout": {
      const no = needNpc();
      if (no) return no;
      const lines = breakOut(ctx, p, npc!, day, hour);
      return res(lines, /^You get/.test(lines[0] ?? ""), 2);
    }
    case "bribejudge": {
      const r = bribeJudge(ctx, p, String(args.case ?? ""), Math.max(0, Math.floor(Number(args.amount) || 0)), day);
      return res(r.lines, r.ok);
    }
    // ---- Magic (N51) ----
    case "learn": {
      if (!config.society.magic) return res(["Nobody here teaches that."], false);
      const lines = learnSpell(ctx, p, site, String(args.spell ?? ""), day);
      const ok = / teaches you /.test(lines[0] ?? "");
      return res(lines, ok, ok ? 8 : undefined);
    }
    case "cast": {
      const r = playerCast(ctx, p, String(args.spell ?? ""), site, day, hour, onlookers(h), null, h.actionRng());
      return res(r.lines, r.ok, r.minutes >= 60 ? Math.round(r.minutes / 60) : undefined);
    }
    // ---- Shaping what people believe (N52) ----
    case "plant": {
      const no = needNpc();
      if (no) return no;
      const c = parseClaim(h, String(args.text ?? ""), site);
      if (!c) return res([`Say who, and what: "Hal Webb stole the tax money". (${Object.keys(CLAIM_WEIGHT).join(", ")})`], false);
      if (c.subject.id === npc!.id) return res(["Not to their own face."], false);
      return res(playerPlants(ctx, p, npc!, { id: c.subject.id, name: c.subject.name }, c.claim, day, c.detail));
    }
    case "voice": {
      const no = needNpc();
      if (no) return no;
      const kind = VOICE_OF[npc!.job];
      if (!kind) return res([`${npc!.name} has nobody's ear but their own.`], false);
      const c = parseClaim(h, String(args.text ?? ""), site);
      if (!c) return res([`Say who, and what: "Hal Webb stole the tax money".`], false);
      const lines = payVoice(ctx, p, kind, npc!, { subject: c.subject.id, subjectName: c.subject.name, claim: c.claim, ...(c.detail ? { detail: c.detail } : {}) }, site, day);
      return res(lines, /takes your coin/.test(lines[0] ?? ""));
    }
    case "frame": {
      const no = needNpc();
      if (no) return no;
      const target = findByName(h, String(args.text ?? ""), site);
      if (!target || target.id === npc!.id) return res(["Frame whom? Name them."], false);
      const r = frame(ctx, p, target, npc!, Math.max(1, Math.floor(Number(args.bribe) || 40)), day);
      return res(r.lines, r.ok);
    }
    // ---- Customs and taboos (N53) ----
    case "custom": {
      if (!config.society.cultures) return res(["Nobody here minds."], false);
      const lines = keepCustom(ctx, p, site, String(args.custom ?? ""), onlookers(h), day);
      return lines.length > 0 ? res(lines) : res(["That's not a custom here."], false);
    }
    case "taboo": {
      if (!config.society.cultures) return res(["Nobody here minds."], false);
      const t = String(args.taboo ?? "");
      const lines = breakTaboo(ctx, p, site, t, onlookers(h), day, hour);
      return lines.length > 0 ? res(lines) : res([`You ${(DEEDS[t] ?? words(t)).toLowerCase()}. Nobody here minds.`]);
    }
    // ---- War (N55) ----
    case "enlist": {
      if (!config.society.armies) return res(["There's no army raising men here."], false);
      const k = kingdomOf(h);
      if (!k) return res(["There's no crown here to enlist with."], false);
      if (p.society?.army) return res(["You're already on an army's roll."], false);
      const lines = enlist(realm, p, k, day);
      return res(lines, !!p.society?.army);
    }
    // ---- A setback's chapter (N49) ----
    case "escape": {
      if (p.chapter?.kind !== "slave") return res(["You're nobody's slave."], false);
      if (p.society?.escapeTried === day) return res(["Not again today: they're watching you too closely."], false);
      (p.society ??= {}).escapeTried = day;
      const home = p.chapter.home;
      const r = escapeSlavery(ctx, p, day, h.actionRng());
      if (!r.ok || !r.to) return res(r.lines, false);
      homeward(p, home, day);
      const lines = [...r.lines, ...h.arriveAt(r.to)];
      if (r.to === home) lines.push(...arrivedHome(h, home));
      return res(lines);
    }
    case "ransom": {
      const c = p.chapter;
      if (c?.kind !== "slave") return res(["You're nobody's slave."], false);
      const price = slavePrice(p);
      const master = h.store!.people.get(c.holder);
      let how: string;
      if (p.money >= price) {
        // The master keeps no purse the realm counts: the coin leaves the books with the player's, as a framing witness's bribe does (N52).
        p.money -= price;
        how = `You count out ${formatMoney(price)} for ${master?.name ?? "your master"}, and they sign the paper.`;
      } else {
        const friend = friendsOf(h).find((f) => f.money >= price);
        if (!friend) return res([`${master?.name ?? "Your master"} wants ${formatMoney(price)} for you. Nobody has sent it yet.`], false);
        friend.pay(price);
        how = `Word reaches ${friend.name}, who sends ${formatMoney(price)} to buy you free.`;
      }
      const home = c.home;
      delete p.chapter;
      p.society ??= {};
      p.society.cls = "commoner";
      const last = (p.society.setbacks ?? []).at(-1);
      if (last) last.escaped = day;
      homeward(p, home, day);
      return res([how, "You walk out of the gate a free person. Home is a long road from here."]);
    }
    case "recover":
      return res(recoverPack(ctx, p, site, day), packHere(h));
  }
  return res([`No such thing to do: ${op}.`], false);
}

/** Whether the player knows where the den is: shown it, a member, or talking to one of the guild. */
function knowsDen(h: SocietyHost, site: string): boolean {
  const realm = h.world.realm!;
  const g = guildAt(realm, site);
  if (!g) return false;
  const den = h.store ? denOf(h.store, site) : undefined;
  return trusted(p_(h), g.id) || (den?.data.found ?? []).includes("player") || onlookers(h).some((id) => h.store!.people.get(id)?.faction === g.id);
}

const packHere = (h: SocietyHost): boolean => !!h.store?.records.open("pack", (r) => r.a === "player" && r.site === h.site()).length;

/** Coming home after a setback: the story goes ahead (N49's `comeHome`), once. */
function arrivedHome(h: SocietyHost, to: string): string[] {
  const p = p_(h);
  const hw = p.society?.homeward as { home: string; day: number } | undefined;
  const ctx = ctxOf(h);
  if (!hw || hw.home !== to || !ctx) return [];
  delete p.society!.homeward;
  return comeHome(ctx, p, to, h.world.day);
}

/** The player arrives somewhere (Town.arriveAt): home after a setback, or where they fell with their pack still lying there. */
export function societyArrive(h: SocietyHost, to: string): string[] {
  const out = arrivedHome(h, to);
  if (packHere(h)) out.push("What you carried when you fell still lies here. (Recover it from the World tab.)");
  return out;
}

/**
 * The player's part of each day (Town.realmNights): their cases heard on the court day of the place they were opened in (with them there,
 * or after two court days without them, in their absence), a day's warning before, a lock-up served out.
 */
export function societyPlayerDay(h: SocietyHost, day: number): string[] {
  const ctx = ctxOf(h);
  const p = p_(h);
  if (!ctx || !config.society.trials) return [];
  const { realm, store } = ctx;
  const out: string[] = [];
  const here = p.road ? null : h.site();
  // A cell's term served.
  if (p.chapter?.kind === "prisoner" && p.chapter.until !== undefined && day >= p.chapter.until) {
    delete p.chapter;
    out.push("The cell door is opened: your time is served.");
  }
  for (const id of playerCases(ctx)) {
    const c = store.records.get<CaseData & { missed?: number; warned?: number }>(id)!;
    if (!c.site || c.since >= day) continue;
    const place = realm.settlements[c.site]?.name ?? "the court";
    if (!courtDayAt(realm.seed, c.site, day)) {
      if (here === c.site && courtDayAt(realm.seed, c.site, day + 1) && c.data.warned !== day) {
        store.records.patch(id, { data: { warned: day } });
        out.push(`Your case (${crimes()[c.data.crime]?.words ?? c.data.crime}) is to be heard at ${place}'s court tomorrow.`);
      }
      continue;
    }
    const absent = here !== c.site;
    if (absent && (c.data.missed ?? 0) + 1 < MISSED_COURT_DAYS) {
      store.records.patch(id, { data: { missed: (c.data.missed ?? 0) + 1 } });
      continue;
    }
    const r = tryPlayer(ctx, p, id, day, absent ? { absent: true } : {});
    out.push(absent ? `${place}'s court heard the case against you without you: ${r.verdict.guilty ? "guilty" : "not guilty"}.` : `You're brought before ${place}'s court for ${crimes()[c.data.crime]?.words ?? c.data.crime}: ${r.verdict.guilty ? "guilty" : "not guilty"}.`);
    if (r.sentence) {
      out.push(...r.sentence.lines);
      // A lock-up is a chapter in the cell, served day by day (the cell's door is the exit).
      if (r.sentence.sentence.kind === "lockup" && !absent && !p.chapter) {
        const until = Math.max(day + 1, r.sentence.sentence.until ?? day + 1);
        p.chapter = { kind: "prisoner", holder: r.verdict.judge ?? "", site: c.site, since: day, exits: [], watch: 0, worked: 0, home: c.site, until };
      }
    }
  }
  return out;
}

/** What eating something breaks here (N53: taboos are raised by doing the thing). */
export function eatTaboo(h: SocietyHost, item: string): string[] {
  const ctx = ctxOf(h);
  if (!ctx || !config.society.cultures) return [];
  const t = FOOD_TABOOS.find(([re]) => re.test(item))?.[1];
  return t ? breakTaboo(ctx, p_(h), h.site(), t, onlookers(h), h.world.day, h.world.hour) : [];
}

// ---------- The panels' rows ----------

/** The player's magic as the panels read it: never written here (a view must not change the world). */
const peekMagicOf = (seed: number, p: PlayerState): PlayerMagic => (p.society?.magic as PlayerMagic | undefined) ?? { gift: rollGift(seed, "player"), schools: {} };

const btn = (id: string, label: string, op: string, o: { args?: Record<string, string | number>; enabled?: boolean; why?: string; danger?: boolean; input?: { arg: string; placeholder: string } } = {}): SocietyAction => ({
  id: `society:${id}`,
  label,
  op,
  enabled: o.enabled ?? true,
  ...(o.args ? { args: o.args } : {}),
  ...(o.why ? { why: o.why } : {}),
  ...(o.danger ? { danger: true } : {}),
  ...(o.input ? { input: o.input } : {}),
});

/** The snapshot's `society`: the place, the player, the people about (by talker id). */
export function societyView(h: SocietyHost, npcIds: string[]): SocietyView | null {
  const ctx = ctxOf(h);
  if (!ctx) return null;
  const { realm, store } = ctx;
  const p = p_(h);
  const day = h.world.day;
  const site = h.site();
  const onRoad = !!p.road;
  const held = !!p.chapter && ["captive", "slave", "prisoner"].includes(p.chapter.kind);
  const sections: SocietyView["sections"] = [];

  // ---- The player's own: a chapter and its exits, cases, record, tongues, spells, secrets, a soldier's roll ----
  const me: SocietyRow[] = [];
  const c = p.chapter;
  if (c?.kind === "slave") {
    const master = store.people.get(c.holder);
    const helper = helperFor(ctx, p, day);
    const price = slavePrice(p);
    me.push({ text: `You're a slave of ${master?.name ?? "a master"} at ${realm.settlements[c.site]?.name ?? "their house"}, ${day - c.since} days now.${helper ? ` ${helper.name} knows a way out.` : " Win a fellow slave's trust, one who hates the master, and they may show you the way out."}` });
    me.push({
      text: "Ways out",
      actions: [
        btn("escape", "Run for it", "escape", { enabled: p.society?.escapeTried !== day, why: p.society?.escapeTried === day ? "Not again today" : helper ? `With ${helper.name}'s help` : "Alone, it's a long chance", danger: true }),
        btn("ransom", `Buy freedom (${formatMoney(price)})`, "ransom", { enabled: p.money >= price || friendsOf(h).some((f) => f.money >= price), why: p.money >= price ? "Your own coin" : "Only if a friend has the coin" }),
      ],
    });
  } else if (c?.kind === "prisoner") me.push({ text: `You're in ${realm.settlements[c.site]?.name ?? "the"} cell${c.until !== undefined ? ` until day ${c.until}` : ""}.` });
  const hw = p.society?.homeward as { home: string } | undefined;
  if (hw) me.push({ text: `Free again. Home (${realm.settlements[hw.home]?.name ?? "home"}) is waiting to hear where you've been.` });
  for (const id of playerCases(ctx)) {
    const k = store.records.get<CaseData>(id)!;
    if (!k.site) continue;
    const at = realm.settlements[k.site]?.name ?? "the court";
    const next = nextCourtDay(realm.seed, k.site, Math.max(day, k.since + 1));
    const canBribe = !held && site === k.site && !onRoad;
    me.push({
      text: `A case against you at ${at}: ${crimes()[k.data.crime]?.words ?? k.data.crime}. To be heard on day ${next}${site === k.site ? "" : " (be there, or it's heard without you)"}.`,
      actions: [btn(`bribe:${id}`, "Offer the judge…", "bribejudge", { args: { case: id }, enabled: canBribe, why: canBribe ? "Coin to forget the case; an honest judge will charge you for it" : `Only at ${at}`, danger: true, input: { arg: "amount", placeholder: "copper" } })],
    });
  }
  const record = (p.sentences ?? []).slice(-4);
  if (record.length > 0) me.push({ text: `Your record: ${record.map((s) => `${s.kind} for ${crimes()[s.crime]?.words ?? s.crime} at ${realm.settlements[s.place]?.name ?? s.place} (day ${s.day})`).join("; ")}.` });
  if (config.society.cultures) {
    const t = (p.society?.tongues ?? {}) as Record<string, number>;
    const known = Object.entries(t).map(([id, v]) => `${cultureById(realm, id)?.tongue.id ?? id} ${v >= 1 ? "(fluent)" : `(${Math.round(v * 100)}%)`}`);
    const pen = Object.keys(t).length > 0 ? tonguePenalty(realm, p, site) : 0;
    if (known.length > 0) me.push({ text: `Tongues: ${known.join(", ")}.${pen >= 0.3 ? " You barely share a language with the people here: talking anyone round is harder." : ""}` });
  }
  if (config.society.magic) {
    const m = peekMagicOf(realm.seed, p);
    const learned = Object.entries(m.schools).flatMap(([sc, rank]) => spells().filter((s) => s.school === sc && s.rank <= rank));
    if (learned.length > 0)
      me.push({
        text: `Spells (MP ${p.mp ?? 0}): ${learned.map((s) => s.name).join(", ")}.`,
        actions: learned.map((s) => btn(`cast:${s.id}`, `Cast ${s.name}`, "cast", { args: { spell: s.id }, enabled: !held && (p.mp ?? 0) >= s.cost.mp, why: schoolById(s.school)?.forbidden ? "Forbidden in some places: don't be seen" : `${s.cost.mp} MP`, danger: !!schoolById(s.school)?.forbidden })),
      });
  }
  const mine = secretsOfPlayer(ctx, p);
  for (const s of mine.slice(0, 8)) {
    const who = store.people.get(s.data.about);
    const here = who && who.site === site && who.death === null && !onRoad;
    me.push({
      text: `You know: ${s.data.text}.`,
      actions: here
        ? [btn(`blackmail:${s.id}`, "Blackmail", "blackmail", { args: { secret: s.id }, enabled: !held, why: `Name ${who!.name} a price for your silence`, danger: true }), btn(`expose:${s.id}`, "Tell everyone", "expose", { args: { secret: s.id }, enabled: !held, why: "Out loud, where people can hear", danger: true })]
        : [],
    });
  }
  const army = p.society?.army as { army: string; rank: string; joined: number } | undefined;
  if (army) me.push({ text: `On the roll of ${army.army.split(":").at(-1) ? (realm.kingdoms[army.army.split(":").at(-1)!]?.name ?? "the crown") : "the crown"}'s army, a ${army.rank}, since day ${army.joined}.` });
  const guild = p.society?.guild as { id: string; rank: string } | undefined;
  if (guild) me.push({ text: `Of ${realm.factions[guild.id]?.name ?? "a thieves' guild"}, a ${guild.rank}.` });
  if (me.length > 0) sections.push({ title: "You", rows: me });

  // ---- The place: customs and taboos, the faith, the den if known, the court, the cells, a teacher, the war ----
  if (!onRoad) {
    const place: SocietyRow[] = [];
    const name = realm.settlements[site]?.name ?? "this place";
    if (config.society.cultures) {
      const cu = customsAt(realm, site);
      if (cu.culture) {
        place.push({ text: `Here they keep ${cu.culture.name}.`, actions: cu.customs.map((x) => btn(`custom:${x}`, words(x), "custom", { args: { custom: x }, enabled: !held, why: "Keep the custom where people see: it's liked" })) });
        const known = new Set((p.society?.learnedTaboos ?? []) as string[]);
        place.push({ text: `Not done here: ${cu.taboos.map((x) => `${words(x)}${known.has(`${cu.culture!.id}:${x}`) ? " (you learned that the hard way)" : ""}`).join(", ")}.`, actions: cu.taboos.filter((x) => DEEDS[x]).map((x) => btn(`taboo:${x}`, DEEDS[x]!, "taboo", { args: { taboo: x }, why: `Here, ${words(x)} is not done`, danger: true })) });
      }
    }
    if (config.society.belief) {
      const f = faithOfPlace(realm, site);
      const fac = f ? realm.factions[f] : undefined;
      const faith = f ? peekFaith(realm)?.faiths[f] : undefined;
      if (fac) place.push({ text: `The faith here: ${fac.name}${faith ? `, who worship ${faith.deity}` : ""}.` });
    }
    if (config.society.underworld) {
      const g = guildAt(realm, site);
      const den = denOf(store, site);
      if (g && den && den.ended === null && knowsDen(h, site)) {
        const member = trusted(p, g.id);
        const offers = member ? blackMarket(ctx, site, day) : [];
        place.push({
          text: member ? `${g.name} keep a den here, and they know you.` : `${g.name} keep a den here. You know who to ask.`,
          actions: member
            ? [...offers.map((o) => btn(`buy:${o.id}`, `${o.what} (${formatMoney(o.price)})`, "buy", { args: { offer: o.id }, enabled: !held && p.money >= o.price, why: o.kind === "banned" ? "Banned: carrying it is a crime" : "No questions asked", danger: o.kind !== "stolen" })), btn("inform", "Inform on them", "inform", { why: "The watch takes those you can name; the rest won't forget", danger: true })]
            : [btn("joinguild", "Ask to join", "joinguild", { why: "Footpads start at the bottom" }), btn("inform", "Inform on them", "inform", { why: "The watch takes those you can name; the rest won't forget", danger: true })],
        });
      }
    }
    if (config.society.trials) {
      const cases = store.records.openAt<CaseData>("case", site, (x) => x.data.accused !== "player");
      if (cases.length > 0) place.push({ text: `Before ${name}'s court (next sitting day ${nextCourtDay(realm.seed, site, day)}): ${cases.slice(0, 6).map((x) => `${store.people.get(x.data.accused)?.name ?? "someone"} for ${crimes()[x.data.crime]?.words ?? x.data.crime}`).join("; ")}.` });
      const cells = store.records.open<{ until: number; why: string }>("jail", (j) => j.site === site && j.data.until > day);
      for (const j of cells.slice(0, 6)) {
        const r = j.a ? store.people.get(j.a) : undefined;
        if (r) place.push({ text: `In the cell: ${r.name}, for ${j.data.why}, until day ${j.data.until}.`, actions: [btn(`breakout:${r.id}`, "Break them out", "breakout", { args: { npc: r.id }, enabled: !held, why: "If the watch sees you, there's a case for aiding an escape", danger: true })] });
      }
    }
    if (config.society.magic) {
      const t = teacherAt(ctx, site);
      if (t) {
        const g = giftOf(t);
        const m = peekMagicOf(realm.seed, p);
        const teach = spells().filter((s) => (g?.schools[s.school] ?? 0) >= s.rank && (m.schools[s.school] ?? 0) < s.rank);
        place.push({
          text: `${t.name} is a hedge witch: ${teach.length > 0 ? "they could teach you, for coin." : "nothing more they can teach you."}`,
          actions: teach.slice(0, 6).map((s) => btn(`learn:${s.id}`, `Learn ${s.name} (${formatMoney(20 * s.rank)})`, "learn", { args: { spell: s.id }, enabled: !held && p.money >= 20 * s.rank && m.gift > 0 && s.rank <= m.gift + 1, why: m.gift <= 0 ? "You'd need the gift: they'll tell you if you have it" : s.rank > m.gift + 1 ? "Beyond your gift" : p.money < 20 * s.rank ? "Not enough coin" : `${schoolById(s.school)?.words ?? s.school}, rank ${s.rank}` })),
        });
      }
    }
    if (config.society.armies) {
      const k = realm.settlements[site]?.kingdom;
      const a = k ? peekArmies(realm).find((x) => x.party === `k:${k}` && x.status !== "disbanded") : undefined;
      if (a && k) {
        const w = realm.wars.find((x) => x.id === a.war);
        const levied = store.records.listAt<SoldierData>("soldier", site, (s) => s.data.war === a.war).length;
        place.push({ text: `${realm.kingdoms[k]?.name ?? "The crown"} is at war${w ? ` (${w.cause})` : ""}. ${name} owes ${a.levy[site] ?? 0} to the levy and has sent ${levied}.`, actions: [btn("enlist", "Enlist", "enlist", { enabled: !held && !army, why: army ? "You're already on the roll" : "A soldier, who rises with the battles they live through", danger: true })] });
      }
    }
    if (packHere(h)) place.push({ text: "What you carried when you fell still lies here.", actions: [btn("recover", "Take it back", "recover")] });
    const residents = (peoplesOf(realm)?.residents ?? []).filter((x) => x.site === site);
    if (residents.length > 0) place.push({ text: `Living here among the people: ${residents.length} of other kinds (${[...new Set(residents.map((x) => x.species))].join(", ")}).` });
    if (place.length > 0) sections.push({ title: `Among the people of ${name}`, rows: place });
  }

  // ---- The people about: what the player knows of each, and what can be done with them ----
  const people: SocietyView["people"] = {};
  if (!onRoad)
    for (const id of npcIds) {
      const r = rowOf(h, id);
      if (!r || r.site !== site) continue;
      const lines: string[] = [];
      const tools: SocietyAction[] = [];
      const known = mine.filter((s) => s.data.about === r.id || (s.data.others ?? []).includes(r.id));
      for (const s of known.slice(0, 3)) lines.push(`you know: ${s.data.text}`);
      const b = beliefOf(r);
      if (b && config.society.belief) lines.push(`${realm.factions[b.faith]?.name ?? "a faith"}${b.devotion >= 0.7 ? ", devout" : b.devotion < 0.3 ? ", lukewarm" : ""}`);
      const gift = giftOf(r);
      if (gift && gift.gift > 0 && gift.shown !== undefined && !gift.hidden) lines.push(`has the gift${gift.role ? ` (${gift.role === "hedge" ? "a hedge witch" : `a ${gift.role} mage`})` : ""}`);
      if (r.species && r.species !== "human") lines.push(`one of the ${r.species} folk`);
      if (jailedNow(store, r.id, day)) lines.push("held in the cell");
      if (config.society.secrets) tools.push(btn(`pry:${r.id}`, "Pry", "pry", { args: { npc: r.id }, enabled: !held, why: "Watch them and ask about them: a secret, by chance, and they may notice" }));
      // Sell what you know about someone they hate (the buyer decides if it's worth coin).
      for (const s of mine.filter((x) => x.data.about !== r.id).slice(0, 3)) {
        const hate = store.social.openBetween(r.id, s.data.about).length > 0;
        if (hate) tools.push(btn(`sell:${s.id}:${r.id}`, `Sell what you know of ${store.people.get(s.data.about)?.name.split(" ")[0] ?? "them"}`, "sellsecret", { args: { secret: s.id, npc: r.id }, enabled: !held, why: "They have no love for them" }));
      }
      tools.push(btn(`plant:${r.id}`, "Whisper…", "plant", { args: { npc: r.id }, enabled: !held, why: "Tell them something that isn't true about someone: it spreads", danger: true, input: { arg: "text", placeholder: "who, and what they did" } }));
      const voice = VOICE_OF[r.job];
      if (voice) tools.push(btn(`voice:${r.id}`, voice === "bard" ? "Pay for a song…" : voice === "priest" ? "Pay for a sermon…" : "Pay for a proclamation…", "voice", { args: { npc: r.id }, enabled: !held, why: "Everyone at the venue hears it at once", danger: true, input: { arg: "text", placeholder: "who, and what they did" } }));
      tools.push(btn(`frame:${r.id}`, "Pay to swear…", "frame", { args: { npc: r.id, bribe: 40 }, enabled: !held && p.money >= 40, why: "40 copper for them to swear they saw someone steal", danger: true, input: { arg: "text", placeholder: "whom to frame" } }));
      const g = config.society.underworld ? guildAt(realm, site) : undefined;
      if (g && r.faction === g.id && !trusted(p, g.id)) tools.push(btn(`joinguild:${r.id}`, `Ask to join ${g.name}`, "joinguild", { enabled: !held, why: "They're one of them" }));
      if (lines.length > 0 || tools.length > 0) people[id] = { lines, tools };
    }

  const offer = p.society?.offer as { text: string } | undefined;
  return { offer: offer ? { text: offer.text } : null, sections, people };
}
