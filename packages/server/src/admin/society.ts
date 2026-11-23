import type { AdminCard, AdminSection } from "@garden-of-eden/shared";
import { customsAt } from "../game/culture/day.js";
import { beliefOf, faithOfPlace, peekFaith } from "../game/faith/model.js";
import type { DisputeData } from "../game/kin/disputes.js";
import type { FeudData } from "../game/kin/feuds.js";
import { crimes } from "../game/law/sentence.js";
import type { CaseData } from "../game/law/trial.js";
import { giftOf, peekMagic, schoolById } from "../game/magic/model.js";
import { peoplesOf } from "../game/peoples/generate.js";
import { titled } from "../game/realm/figures.js";
import { peekCourt } from "../game/secrets/court.js";
import type { SecretData } from "../game/secrets/model.js";
import { denOf, guildAt } from "../game/thieves/guilds.js";
import { surnameOf } from "../game/people/step.js";
import { peekArmies, rollOfTheFallen, type SoldierData } from "../game/war/armies.js";
import type { PersonRow } from "../store/peopleStore.js";
import type { AdminContext } from "./context.js";

/**
 * Stages 4–5 on the admin page (N70): what a person is in society (kin disputes and feuds, secrets known and held, faith, gift, a
 * soldier's record, cases), what a place is (its den, its court, its faith and culture, residents of other peoples, its levy), and the
 * Society card (`society`): every open feud, case and plot, omens and readings, armies with their levies, and each war's roll of the
 * fallen by battle. Read-only: only peek helpers (nothing here may fill in a missing field).
 */
type Row = [string, string, string?];

const refOf = (ctx: AdminContext, id: string | null | undefined): string | undefined => {
  if (!id) return undefined;
  if (id === "player") return "player";
  if (ctx.store?.people.get(id)) return `town:${id}`;
  if (ctx.world().realm?.figures[id]) return `figure:${id}`;
  return undefined;
};
const nameOf = (ctx: AdminContext, id: string | null | undefined): string => {
  if (!id) return "nobody";
  if (id === "player") return ctx.world().player.name;
  return ctx.store?.people.get(id)?.name ?? ctx.world().realm?.figures[id]?.name ?? id;
};
const crimeWords = (c: string) => crimes()[c]?.words ?? c;
const famName = (fam: string) => surnameOf(fam.split(":").slice(1).join(":") || fam) || fam;

/** A person's place in society (the person card). */
export function personSocietySections(ctx: AdminContext, row: PersonRow): AdminSection[] {
  const store = ctx.store;
  const realm = ctx.world().realm;
  if (!store || !realm) return [{ title: "Society", unavailable: "no database" }];
  const rows: Row[] = [];
  const fam = `${row.site}:${surnameOf(row.name)}`;
  for (const f of store.records.list<FeudData>("feud", (x) => x.data.names.includes(fam))) {
    const other = f.data.names.find((n) => n !== fam) ?? "";
    rows.push(["Feud", `with the ${famName(other)} family over ${f.data.cause} (since day ${f.since}, ${f.data.flares} flare-ups)${f.ended !== null ? `, ended day ${f.ended}${f.data.settledBy ? ` by ${f.data.settledBy}` : ""}` : ""}`]);
  }
  for (const d of store.records.list<DisputeData>("dispute", (x) => x.data.claimants.includes(row.id) || x.data.of === row.id)) rows.push(["Dispute", `over ${d.data.ofName}'s ${d.data.part.replace(/^shop:/, "shop (")}${d.data.part.startsWith("shop:") ? ")" : ""}: ${d.data.claimants.map((c) => nameOf(ctx, c)).join(" against ")}; the law gives it to ${nameOf(ctx, d.data.lawful)} (${d.status})`]);
  for (const s of store.records.list<SecretData>("secret", (x) => x.data.about === row.id || (x.data.others ?? []).includes(row.id))) rows.push(["Hides", `${s.data.text} (weight ${s.data.weight}${s.data.exposed ? `, exposed day ${s.data.exposed.day}` : ""}; ${store.knowledge.holders(`s:${s.id}`).length} know)`]);
  const known = store.knowledge.rowsOf(row.id).filter((k) => k.ref.startsWith("s:"));
  for (const k of known.slice(0, 8)) {
    const s = store.records.get<SecretData>(k.ref.slice(2));
    if (s && s.data.about !== row.id) rows.push(["Knows", `${s.data.text} (${k.source === "saw" ? "saw it" : `from ${nameOf(ctx, k.source)}`})`, refOf(ctx, s.data.about)]);
  }
  const b = beliefOf(row);
  if (b) rows.push(["Faith", `${realm.factions[b.faith]?.name ?? b.faith}, devotion ${Math.round(b.devotion * 100)}%`]);
  const g = giftOf(row);
  if (g && g.gift > 0) rows.push(["Gift", `${["none", "faint", "real", "strong", "great"][g.gift] ?? g.gift}${g.role ? `, a ${g.role === "hedge" ? "hedge witch" : `${g.role} mage`}` : ""}${Object.keys(g.schools).length ? `; ${Object.entries(g.schools).map(([sc, r]) => `${schoolById(sc)?.words ?? sc} ${r}`).join(", ")}` : ""}${g.shown === undefined ? " (never shown)" : ""}${g.hidden ? " (hidden)" : ""}${g.corruption ? `, corruption ${Math.round(g.corruption * 100)}%` : ""}`]);
  for (const s of store.records.list<SoldierData>("soldier", (x) => x.a === row.id)) rows.push(["Soldier", `${s.data.rank} of ${s.data.army.split(":").at(-1) ? (realm.kingdoms[s.data.army.split(":").at(-1)!]?.name ?? s.data.army) : s.data.army}'s army (${s.data.how}, day ${s.data.joined}), ${s.data.battles} battles: ${s.data.status}`]);
  for (const c of store.records.list<CaseData>("case", (x) => x.data.accused === row.id || x.data.accuser === row.id)) rows.push([c.data.accused === row.id ? "Accused" : "Accuser", `${crimeWords(c.data.crime)} at ${realm.settlements[c.site ?? ""]?.name ?? c.site} (day ${c.since}): ${c.status}${c.data.record ? `. ${c.data.record}` : ""}`]);
  for (const j of store.records.list<{ until: number; why: string }>("jail", (x) => x.a === row.id)) rows.push(["Jailed", `for ${j.data.why}, day ${j.since} to ${j.data.until} (${j.status})`]);
  return [{ title: "Society (N45–N55)", rows: rows.length > 0 ? rows : [["Nothing", "no feud, dispute, secret, faith, gift, soldiering or case on record"]] }];
}

/** A place in society (the place card). */
export function placeSocietySections(ctx: AdminContext, site: string): AdminSection[] {
  const store = ctx.store;
  const realm = ctx.world().realm;
  if (!store || !realm) return [{ title: "Society", unavailable: "no database" }];
  const day = ctx.world().day;
  const rows: Row[] = [];
  const cu = customsAt(realm, site);
  if (cu.culture) rows.push(["Culture", `${cu.culture.name} (tongue ${cu.culture.tongue.id}): customs ${cu.customs.join(", ").replace(/_/g, " ")}; taboos ${cu.taboos.join(", ").replace(/_/g, " ")}`]);
  const f = faithOfPlace(realm, site);
  if (f) rows.push(["Faith", `${realm.factions[f]?.name ?? f}${peekFaith(realm)?.faiths[f] ? `, of ${peekFaith(realm)!.faiths[f]!.deity}` : ""}`]);
  const g = guildAt(realm, site);
  const den = denOf(store, site);
  if (den) rows.push(["Den", `${g?.name ?? den.data.guild}: ${Object.keys(den.data.ranks).length} members, stash ${den.data.stash}, coin ${den.data.coin}, heat ${Math.round(den.data.heat * 100)}%, ${den.data.thefts} thefts, ${den.data.fenced} fenced, ${den.data.arrests} arrests${den.ended !== null ? ` (gone, day ${den.ended})` : ""}${(den.data.found ?? []).includes("player") ? "; the player knows it" : ""}`]);
  for (const c of store.records.list<CaseData>("case", (x) => x.site === site).slice(-15).reverse()) rows.push(["Case", `${nameOf(ctx, c.data.accused)} for ${crimeWords(c.data.crime)}${c.data.false ? " (made up)" : ""}${(c.data as { planted?: boolean }).planted ? " (framed)" : ""}, day ${c.since}: ${c.status}`, refOf(ctx, c.data.accused)]);
  for (const j of store.records.open<{ until: number; why: string }>("jail", (x) => x.site === site && x.data.until > day)) rows.push(["In the cell", `${nameOf(ctx, j.a)} for ${j.data.why}, until day ${j.data.until}`, refOf(ctx, j.a)]);
  const residents = (peoplesOf(realm)?.residents ?? []).filter((x) => x.site === site);
  for (const r of residents.slice(0, 12)) rows.push(["Of another people", `${nameOf(ctx, r.id)}, ${r.species}${r.clever ? "" : " (doesn't talk)"}, since day ${r.day}`, refOf(ctx, r.id)]);
  for (const a of peekArmies(realm).filter((x) => (x.levy[site] ?? 0) > 0)) rows.push(["Levy", `${a.id}: owes ${a.levy[site]}, sent ${a.raised[site] ?? 0} (${a.status})`]);
  return [{ title: "Society (N45–N55)", rows: rows.length > 0 ? rows : [["Nothing", "no culture, faith, den, case, resident or levy on record"]] }];
}

/** The Society card: the realm's open feuds, cases and plots, omens and readings, armies and their levies, and each war's dead by battle. */
export function societyCard(ctx: AdminContext): AdminCard | null {
  const store = ctx.store;
  const realm = ctx.world().realm;
  if (!realm) return null;
  const day = ctx.world().day;
  const placeName = (id: string | null | undefined) => realm.settlements[id ?? ""]?.name ?? id ?? "?";
  const sections: AdminSection[] = [];
  if (store) {
    const feuds = store.records.open<FeudData>("feud");
    sections.push({ title: `Open feuds (${feuds.length})`, rows: feuds.slice(0, 40).map((f): Row => [placeName(f.site), `the ${famName(f.data.names[0])} against the ${famName(f.data.names[1])}, over ${f.data.cause}, since day ${f.since} (${f.data.flares} flare-ups)`, f.site ? `place:${f.site}` : undefined]) });
    const disputes = store.records.open<DisputeData>("dispute");
    sections.push({ title: `Open disputes (${disputes.length})`, rows: disputes.slice(0, 30).map((d): Row => [placeName(d.site), `${d.data.ofName}'s ${d.data.part}: ${d.data.claimants.map((c) => nameOf(ctx, c)).join(" against ")}`]) });
    const cases = store.records.open<CaseData>("case");
    sections.push({ title: `Open cases (${cases.length})`, rows: cases.slice(0, 40).map((c): Row => [placeName(c.site), `${nameOf(ctx, c.data.accused)} for ${crimeWords(c.data.crime)}${c.data.false ? " (made up)" : ""}${(c.data as { planted?: boolean }).planted ? " (framed)" : ""}, opened day ${c.since}${c.data.witnesses?.length ? `; witnesses ${c.data.witnesses.map((w) => nameOf(ctx, w)).join(", ")}` : ""}`, refOf(ctx, c.data.accused)]) });
    const recent = store.records.list<CaseData>("case", (c) => c.ended !== null && c.ended >= day - 12);
    sections.push({ title: `Verdicts lately (${recent.length})`, rows: recent.slice(-20).reverse().map((c): Row => [`Day ${c.ended}`, c.data.record ?? `${nameOf(ctx, c.data.accused)}: ${c.status}`, refOf(ctx, c.data.accused)]) });
    const secrets = store.records.open<SecretData>("secret", (s) => !s.data.exposed);
    const demands = store.records.open("demand");
    sections.push({ title: "Secrets and blackmail", rows: [["Kept", String(secrets.length)], ["Demands open", String(demands.length)], ...demands.slice(0, 10).map((d): Row => ["Demand", `${nameOf(ctx, d.a)} of ${nameOf(ctx, d.b)}: ${(d.data as { amount?: number }).amount ?? "?"} copper (${d.status})`, refOf(ctx, d.b)])] });
    const fabs = store.records.list<{ subjectName: string; claim: string; by: string; investigated?: { found?: string; hops: number } }>("fabrication");
    sections.push({ title: `Rumours planted (${fabs.length})`, rows: fabs.slice(-20).reverse().map((f): Row => [placeName(f.site), `that ${f.data.subjectName} ${f.data.claim}, by ${nameOf(ctx, f.data.by)} (${f.status}${f.data.investigated ? `; investigated, ${f.data.investigated.found ? `traced to ${nameOf(ctx, f.data.investigated.found)}` : "not traced"} in ${f.data.investigated.hops} hops` : ""}; ${store.knowledge.holders(`r:${f.id}`).length} have heard it)`]) });
  }
  const court = peekCourt(realm);
  sections.push({ title: "Plots at court", rows: (court?.plots ?? []).slice(-15).reverse().map((p): Row => [realm.kingdoms[p.k]?.name ?? p.k, `${nameOf(ctx, p.claimant)} against ${nameOf(ctx, p.target)} (strength ${p.strength.toFixed(1)}, ${p.conspirators.length} sworn, since day ${p.since})${p.end ? `: ${p.end.how} on day ${p.end.day} (${p.end.why})` : ""}`, refOf(ctx, p.claimant)]) });
  const faith = peekFaith(realm);
  sections.push({ title: "Omens and readings", rows: [...(faith?.omens ?? []).slice(-10).reverse().map((o): Row => [`Day ${o.day}`, `${o.text}${o.at ? ` (${placeName(o.at)})` : ""}`]), ...(faith?.readings ?? []).slice(-10).reverse().map((r): Row => [`Reading, day ${r.day}`, `${nameOf(ctx, r.seer)} read it as ${r.means} (${realm.kingdoms[r.kingdom]?.name ?? r.kingdom})`, refOf(ctx, r.seer)])] });
  const mages = Object.entries(peekMagic(realm)?.mages ?? {});
  if (mages.length > 0) sections.push({ title: `Mages of the realm (${mages.length})`, rows: mages.slice(0, 20).map(([id, m]): Row => [nameOf(ctx, id), `${m.role}`, refOf(ctx, id)]) });
  for (const a of peekArmies(realm)) {
    const soldiers = store?.records.list<SoldierData>("soldier", (s) => s.data.army === a.id) ?? [];
    const by = (st: string) => soldiers.filter((s) => s.data.status === st).length;
    sections.push({
      title: `Army: ${a.id.split(":").slice(2).join(":")} in ${a.war} (${a.side}, ${a.status})`,
      rows: [["Soldiers", `${soldiers.length}: ${by("serving")} serving, ${by("dead")} dead, ${by("missing")} missing, ${by("discharged")} home`], ...Object.entries(a.levy).sort((x, y) => x[0].localeCompare(y[0])).map(([site, n]): Row => [placeName(site), `owes ${n}, sent ${a.raised[site] ?? 0}`, `place:${site}`])],
    });
  }
  if (store)
    for (const w of realm.wars.slice(-6)) {
      const roll = rollOfTheFallen(store, w.id);
      if (roll.length === 0) continue;
      const byBattle = new Map<string, typeof roll>();
      for (const d of roll) byBattle.set(d.data.battle || "the war", [...(byBattle.get(d.data.battle || "the war") ?? []), d]);
      sections.push({ title: `Roll of the fallen: ${w.id} (${roll.length})`, rows: [...byBattle].flatMap(([battle, dead]) => [[battle.startsWith("battle:") ? `Battle at ${placeName(battle.split(":")[2])}` : battle, `${dead.length} dead`] as Row, ...dead.slice(0, 12).map((d): Row => [`  ${d.data.name}`, `${d.data.rank} of ${placeName(d.data.home)}, ${d.status}`, refOf(ctx, d.a)])]) });
    }
  const peoples = peoplesOf(realm);
  if (peoples) sections.push({ title: "Other peoples", rows: [...Object.entries(peoples.lairs).map(([id, l]): Row => [nameOf(ctx, id), `${l.kind} lair at ${Math.round(l.x)}, ${Math.round(l.y)}`]), ...Object.entries(peoples.burned).map(([d, at]): Row => [`${nameOf(ctx, d)} burned`, `last on day ${at}`]), ...peoples.asked.slice(-6).map((x): Row => [`Asked, day ${x.day}`, `${x.by} asked ${x.of}: ${x.ok ? "yes" : "no"}`])] });
  const p = ctx.world().player;
  const ps = p.society ?? {};
  sections.push({
    title: "The player in society",
    rows: [
      ...(p.chapter ? ([["Chapter", `${p.chapter.kind} at ${placeName(p.chapter.site)} since day ${p.chapter.since}${p.chapter.until !== undefined ? `, until day ${p.chapter.until}` : ""}`]] as Row[]) : []),
      ...((store?.records.open<CaseData>("case", (c) => c.data.accused === "player") ?? []).map((c): Row => ["Case against them", `${crimeWords(c.data.crime)} at ${placeName(c.site)}, opened day ${c.since}`])),
      ...(ps.army ? ([["Soldier", `${ps.army.rank} of ${ps.army.army}`]] as Row[]) : []),
      ...(ps.guild ? ([["Guild", `${realm.factions[ps.guild.id]?.name ?? ps.guild.id}, ${ps.guild.rank}`]] as Row[]) : []),
      ...(ps.magic ? ([["Magic", `gift ${ps.magic.gift}; ${Object.entries(ps.magic.schools ?? {}).map(([sc, r]) => `${sc} ${r}`).join(", ") || "nothing learned"}`]] as Row[]) : []),
      ...(ps.tongues ? ([["Tongues", Object.entries(ps.tongues as Record<string, number>).map(([c, v]) => `${c} ${Math.round(v * 100)}%`).join(", ")]] as Row[]) : []),
      ...((ps.setbacks ?? []) as Array<{ kind: string; day: number; site: string }>).slice(-5).map((s): Row => ["Setback", `${s.kind} at ${placeName(s.site)}, day ${s.day}`]),
    ],
  });
  void titled;
  return { ref: "society", kind: "society", name: "Society", subtitle: "Stages 4–5: feuds, cases, plots, omens, armies and the fallen", alive: true, site: null, siteName: null, doing: `day ${day}`, sections };
}
