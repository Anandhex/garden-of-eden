import type { PersonRow } from "../../store/peopleStore.js";
import type { Rng } from "../dice.js";
import { angry, type Temper } from "./person.js";
import { warmth } from "./rel.js";
import type { Axes, InteractionKind } from "./types.js";

/**
 * What two people say and do to each other when they meet (N37): code decides, from who they are and how they get on, by a scored
 * roll. The base of every pair is courtesy (a greeting, a bow to someone far above, news shared, a complaint); a hostility roll weighted
 * by temper, pride, the class gap, old dislike, an open grievance, a sour mood and drink turns some of them into a sneer, an insult, a
 * humiliation or a threat, and the lower one's own boldness and grievances may make them refuse a bow or an order. Someone who owes
 * amends may apologise. Rolls are made in a fixed order from the stream the caller gives.
 */
export interface Party {
  row: Pick<PersonRow, "id" | "cls" | "job" | "master_id">;
  t: Temper;
}

export interface PickIn {
  x: Party;
  y: Party;
  /** `x`'s view of `y`, and `y`'s of `x` (after fading). */
  viewXofY: Axes;
  viewYofX: Axes;
  /** How much each holds open against the other. */
  hateXofY: number;
  hateYofX: number;
  /** Close kin: they quarrel less. */
  kin: boolean;
  /** Others who can see them. */
  witnesses: number;
  /** Evening at the inn: drink loosens tongues. */
  drink: boolean;
  /** The lower of the two is expected to bow to the higher (the chat is a passing one, and the gap is wide). */
  bowing: boolean;
}

export interface Picked {
  actor: Party;
  target: Party;
  kind: InteractionKind;
}

/** Numbers of the roll, in one place. */
export const HOSTILITY = {
  base: 0.008,
  temper: 0.02,
  prideGap: 0.011,
  dislike: 0.15,
  grievance: 0.25,
  angry: 0.02,
  drink: 0.02,
  /** Lower to higher: how much a refusal or an insult upward is held back. */
  upward: 0.25,
  refuseBow: { base: 0.004, grievance: 0.4, scorn: 0.06, bold: 0.004, angry: 0.02 },
  refuseOrder: { base: 0.02, grievance: 0.5, bold: 0.06, angry: 0.04, fear: 0.1 },
  scold: 0.1,
  kin: 0.35,
  apology: { base: 0.01, owed: 0.4, cap: 0.25 },
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const isMasterOf = (m: Party, s: Party) => s.row.master_id === m.row.id;

export function pickInteraction(p: PickIn, rng: Rng): Picked {
  const { x, y } = p;
  const H = HOSTILITY;
  const side = (who: Party) => (who === x ? { view: p.viewXofY, hate: p.hateXofY, owed: p.hateYofX } : { view: p.viewYofX, hate: p.hateYofX, owed: p.hateXofY });
  const out = (actor: Party, kind: InteractionKind): Picked => ({ actor, target: actor === x ? y : x, kind });
  const fam = p.kin ? H.kin : 1;

  // A master and their servant or slave.
  if (isMasterOf(x, y) || isMasterOf(y, x)) {
    const m = isMasterOf(x, y) ? x : y;
    const s = m === x ? y : x;
    const sv = side(s);
    const pRefuse = clamp01(H.refuseOrder.base + H.refuseOrder.grievance * sv.hate + H.refuseOrder.bold * s.t.bravery + (angry(s.t) ? H.refuseOrder.angry : 0) - (H.refuseOrder.fear * sv.view.fear) / 100);
    if (rng() < pRefuse) return out(s, "refuse_order");
    const pScold = H.scold * m.t.temper * m.t.pride + (angry(m.t) ? H.angry : 0);
    return out(m, rng() < pScold ? "sneer" : "order");
  }

  // Who stands higher (a tie: whoever the caller put first).
  const hi = y.t.rank > x.t.rank ? y : x;
  const lo = hi === x ? y : x;
  const gap = hi.t.rank - lo.t.rank;
  const hs = side(hi);
  const ls = side(lo);

  // Amends first: someone who has wronged the other and is the sort to say so.
  for (const who of [x, y]) {
    const owed = side(who).owed;
    if (owed >= 0.05) {
      const pApol = Math.min(H.apology.cap, H.apology.base + H.apology.owed * owed * who.t.honesty);
      if (rng() < pApol) return out(who, "apologise");
    }
  }

  // The higher one's temper, pride and old scores.
  const dislikeHi = clamp01(Math.max(0, -warmth(hs.view)) / 100);
  const pDown = fam * (H.base + H.temper * hi.t.temper + H.prideGap * hi.t.pride * gap + H.dislike * dislikeHi + H.grievance * hs.hate + (angry(hi.t) ? H.angry : 0) + (p.drink ? H.drink : 0));
  if (rng() < pDown) {
    const sev = rng();
    if (hs.hate >= 0.4 && sev < 0.15) return out(hi, "threaten");
    if (p.witnesses >= 3 && hi.t.temper > 0.6 && sev < 0.1 + 0.2 * hi.t.pride) return out(hi, "humiliate");
    return out(hi, sev < 0.35 ? "insult" : "sneer");
  }

  // The lower one: refusing a bow, or biting back.
  const bold = 0.2 + 0.8 * lo.t.bravery;
  const scornLo = clamp01(Math.max(0, -ls.view.respect) / 100);
  const dislikeLo = clamp01(Math.max(0, -warmth(ls.view)) / 100);
  const cowed = 1 - Math.min(1, ls.view.fear / 150);
  if (p.bowing && gap >= 3) {
    const r = H.refuseBow;
    const pBow = fam * (r.base + r.grievance * ls.hate + r.scorn * scornLo + r.bold * lo.t.bravery + (angry(lo.t) ? r.angry : 0)) * cowed;
    if (rng() < pBow) return out(lo, "refuse_bow");
  }
  const pUp = fam * H.upward * (H.base + H.temper * lo.t.temper + H.dislike * dislikeLo + H.grievance * ls.hate + (angry(lo.t) ? H.angry : 0) + (p.drink ? H.drink : 0)) * bold * cowed;
  if (rng() < pUp) return out(lo, rng() < 0.4 ? "insult" : "sneer");

  // Courtesy.
  if (p.bowing && gap >= 3) return out(lo, "bow");
  const r = rng();
  if (r < 0.5) return out(x, "greet");
  if (r < 0.75) return out(x, "share_news");
  if (r < 0.85) return out(gap > 0 ? lo : x, "complain");
  if (r < 0.92) return out(gap > 0 ? lo : x, "flatter");
  return out(x, "greet");
}
