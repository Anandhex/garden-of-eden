import type { WorldStore } from "../db.js";
import type { Realm } from "../realm/types.js";
import type { FeudData } from "../kin/feuds.js";
import type { AffairData } from "../kin/affairs.js";
import { peekCourt } from "../secrets/court.js";
import { faithFactions, peekFaith } from "../faith/model.js";
import { peekMagic } from "../magic/model.js";

/**
 * The balance bounds of Stages 4–6 (N45–N64), checked at the end of a long run (`npm run sim:years`): each names its phase. When one fails,
 * tune the answers (heads deciding, marriages ending feuds, laws, cures, relief), not hard caps (plans README section 22).
 */
export interface SocietyBound {
  name: string;
  phase: string;
  ok: boolean;
  detail: string;
}

export function checkSocietyBounds(realm: Realm, store: WorldStore): SocietyBound[] {
  const day = realm.day;
  const year = 48;
  const out: SocietyBound[] = [];

  // ---- N45 ----
  const feuds = store.records.list<FeudData>("feud");
  const open = feuds.filter((f) => f.ended === null);
  const perPlace = new Map<string, number>();
  for (const f of open) perPlace.set(f.site ?? "", (perPlace.get(f.site ?? "") ?? 0) + 1);
  const most = Math.max(0, ...perPlace.values());
  const old = feuds.filter((f) => f.since < day - 20 * year);
  const lasting = old.filter((f) => f.ended === null);
  out.push({ name: "feuds-bounded", phase: "N45", ok: most <= 4 && (old.length === 0 || lasting.length / old.length <= 0.5), detail: `${open.length} open feuds, at most ${most} in a place; ${lasting.length} of ${old.length} begun a generation ago still open` });
  const disputes = store.records.list("dispute");
  const stuck = disputes.filter((d) => d.ended === null && d.since < day - 12);
  out.push({ name: "estates-pass", phase: "N45", ok: stuck.length === 0, detail: `${disputes.length} disputes, ${stuck.length} open longer than a season's part` });
  const affairs = store.records.list<AffairData>("secret", (s) => s.data.what === "affair");
  const years = Math.max(1, day / year);
  const ks = Math.max(1, Object.keys(realm.kingdoms).length);
  const living = Object.values(realm.settlements).reduce((a, s) => a + s.population, 0);
  const rate = affairs.length / years / Math.max(1, living);
  out.push({ name: "affairs-rare", phase: "N45", ok: rate < 0.02, detail: `${affairs.length} affairs in ${years.toFixed(1)} years among ~${living} people (${(rate * 1000).toFixed(2)} per thousand a year)` });

  // ---- N46 ----
  const secrets = store.records.list("secret");
  const openSecrets = secrets.filter((x) => x.ended === null);
  out.push({ name: "secrets-bounded", phase: "N46", ok: openSecrets.length <= Math.max(50, living * 0.05), detail: `${openSecrets.length} secrets kept among ~${living} people` });
  const demands = store.records.list("demand");
  out.push({ name: "blackmail-rare", phase: "N46", ok: demands.length / years <= Math.max(10, living * 0.004), detail: `${demands.length} demands in ${years.toFixed(1)} years` });
  const court = peekCourt(realm);
  const struck = (court?.plots ?? []).filter((p) => p.end?.how === "struck");
  // ---- N47 ----
  const dens = store.records.list<{ thefts: number; arrests: number; ranks: Record<string, string> }>("den");
  const thefts = dens.reduce((a, d) => a + d.data.thefts, 0);
  const seasons = Math.max(1, day / 12);
  const perK = (thefts / seasons / Math.max(1, living)) * 1000;
  out.push({ name: "crime-band", phase: "N47", ok: perK < 60, detail: `${thefts} thefts in ${seasons.toFixed(0)} seasons (${perK.toFixed(1)} per thousand people a season)` });
  const wiped = dens.filter((d) => d.data.arrests > 0 && Object.keys(d.data.ranks).length === 0);
  out.push({ name: "guilds-survive-crackdowns", phase: "N47", ok: dens.length === 0 || wiped.length < dens.length, detail: `${wiped.length} of ${dens.length} dens emptied by arrests` });
  // ---- N48 ----
  const cases = store.records.list<{ verdict?: string; parts?: Array<[string, number]> }>("case", (c) => c.ended !== null && !!c.data.parts);
  const strong = cases.filter((c) => (c.data.parts ?? []).filter(([, v]) => v > 0).reduce((a, [, v]) => a + v, 0) >= 3);
  const convicted = strong.filter((c) => c.data.verdict === "guilty");
  out.push({ name: "justice-not-random", phase: "N48", ok: strong.length < 5 || convicted.length / strong.length >= 0.6, detail: `${convicted.length} of ${strong.length} strong cases convicted` });
  const hanged = realm.stats.sentence_hanging ?? 0;
  out.push({ name: "executions-bounded", phase: "N48", ok: hanged / years / ks <= 6, detail: `${hanged} hangings in ${years.toFixed(1)} years` });
  // ---- N50 ----
  const faith = peekFaith(realm);
  const facs = faithFactions(realm);
  out.push({ name: "faiths-persist", phase: "N50", ok: !faith || Object.keys(faith.faiths).every((id) => realm.factions[id]?.dissolved === undefined || (realm.factions[id]?.dissolved ?? 0) > day - year), detail: `${facs.length} faiths living, ${Object.keys(faith?.faiths ?? {}).length} ever` });
  const omens = (realm.news ?? []).filter((n) => n.kind === "omen").length;
  out.push({ name: "omens-rare", phase: "N50", ok: (faith?.omens.length ?? 0) <= 24, detail: `${faith?.omens.length ?? 0} omens kept, ${omens} in the news` });
  const persecutions = store.records.list("case", (c) => (c.data as { crime?: string }).crime === "heresy").length;
  out.push({ name: "persecution-bounded", phase: "N50", ok: persecutions / years <= Math.max(20, living * 0.01), detail: `${persecutions} heresy cases in ${years.toFixed(1)} years` });
  // ---- N51 ----
  const mages = Object.values(peekMagic(realm)?.mages ?? {});
  out.push({ name: "magic-not-dominant", phase: "N51", ok: mages.filter((m) => m.role === "battle").length <= Math.max(3, Object.keys(realm.settlements).length / 4), detail: `${mages.length} mages of the realm; a battle mage adds at most 15% to a side` });
  const hunts = store.records.list("case", (c) => (c.data as { crime?: string }).crime === "sorcery").length;
  out.push({ name: "witch-hunts-rare", phase: "N51", ok: hunts / years <= Math.max(6, living * 0.002), detail: `${hunts} sorcery cases in ${years.toFixed(1)} years` });
  out.push({ name: "assassinations-rare", phase: "N46", ok: struck.length / ks / years <= 0.34, detail: `${struck.length} rulers murdered in ${years.toFixed(1)} years across ${ks} kingdoms` });
  return out;
}
