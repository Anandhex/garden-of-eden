import type { Rng } from "../dice.js";
import { cure } from "../health.js";
import { learn } from "../gossip/knowledge.js";
import type { LifeCtx } from "../people/step.js";
import { magicAt, spellById, type Spell } from "./model.js";

/**
 * Casting (N51 decision 3): a spell's cost (MP, reagents, time), its risk, and its effect through the systems that already exist (HP and
 * illness for healing, the fight's damage, a knowledge row for scrying). A failed cast misfires: the MP is spent, and the effect may turn
 * on the caster (damage), or bring magic sickness; a forbidden school's cast leaves corruption, whether it works or not.
 */
export interface Caster {
  mp: number;
  hp: number;
  maxHp: number;
  inventory?: Record<string, number>;
  illness?: { id: string } | null;
  injuries?: Array<{ id: string }>;
  schools: Record<string, number>;
  corruption?: number;
}

export interface Target {
  hp?: number;
  maxHp?: number;
  illness?: { id: string } | null;
  injuries?: Array<{ id: string }>;
}

export interface Cast {
  ok: boolean;
  misfire: boolean;
  lines: string[];
  /** Damage dealt (to the target, or to the caster on a misfire). */
  damage?: number;
  healed?: number;
  /** What a scrying learned (a ref and its accuracy). */
  scried?: { ref: string; accuracy: number };
  minutes: number;
}

/** Can they cast it: the school learned to its rank, the MP, the reagents. */
export function canCast(c: Caster, sp: Spell): string | null {
  if ((c.schools[sp.school] ?? 0) < sp.rank) return `You haven't learned ${sp.name}.`;
  if (c.mp < sp.cost.mp) return "You haven't the strength left for it.";
  for (const r of sp.cost.reagents ?? []) if ((c.inventory?.[r.item] ?? 0) < r.qty) return `You need ${r.qty} ${r.item}.`;
  return null;
}

/** Cast a spell. `place` sets how strong it is (magicAt); `rng` the risk. */
export function cast(ctx: LifeCtx | null, c: Caster, spellId: string, target: Target | null, place: string | null, rng: Rng, opts: { scryRef?: string; scryFor?: string; day?: number } = {}): Cast {
  const sp = spellById(spellId);
  if (!sp) return { ok: false, misfire: false, lines: ["No such spell."], minutes: 0 };
  const no = canCast(c, sp);
  if (no) return { ok: false, misfire: false, lines: [no], minutes: 0 };
  c.mp -= sp.cost.mp;
  for (const r of sp.cost.reagents ?? []) c.inventory![r.item] = (c.inventory![r.item] ?? 0) - r.qty;
  const power = ctx && place ? magicAt(ctx.realm, place, sp.school) : 1;
  // Rank above what the spell needs makes it safer; a strong place too.
  const risk = Math.max(0.01, sp.cost.risk - 0.05 * ((c.schools[sp.school] ?? 0) - sp.rank) - 0.05 * (power - 1));
  const forbidden = sp.school === "necromancy" || sp.school === "blood";
  if (forbidden) c.corruption = Math.min(1, (c.corruption ?? 0) + 0.05);
  if (rng() < risk) {
    const back = sp.effect.kind === "damage" || sp.effect.kind === "curse" ? Math.ceil(sp.effect.magnitude / 2) : 0;
    c.hp = Math.max(1, c.hp - back);
    return { ok: false, misfire: true, damage: back, lines: [back > 0 ? `${sp.name} goes wrong: it burns back into you (${back}).` : `${sp.name} slips away from you; the strength is spent.`], minutes: sp.cost.minutes };
  }
  const m = sp.effect.magnitude * power;
  switch (sp.effect.kind) {
    case "heal": {
      if (!target || target.hp === undefined || target.maxHp === undefined) break;
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + Math.round(m));
      return { ok: true, misfire: false, healed: target.hp - before, lines: [`${sp.name}: the wound closes (${target.hp - before}).`], minutes: sp.cost.minutes };
    }
    case "cure": {
      const ill = target?.illness?.id;
      if (target && ill && cure(target as never, ill)) return { ok: true, misfire: false, lines: [`${sp.name}: the fever breaks.`], minutes: sp.cost.minutes };
      return { ok: true, misfire: false, lines: [`${sp.name}: there's nothing in them to drive out.`], minutes: sp.cost.minutes };
    }
    case "damage":
    case "curse":
      return { ok: true, misfire: false, damage: Math.round(m), lines: [`${sp.name} strikes (${Math.round(m)}).`], minutes: sp.cost.minutes };
    case "scry": {
      // The one sanctioned way the truth becomes knowledge without a carrier: only what the caster names, never quite right.
      const accuracy = Math.min(0.9, sp.effect.magnitude * (0.8 + 0.1 * (c.schools[sp.school] ?? 0)));
      if (ctx && opts.scryRef && opts.scryFor) learn(ctx, opts.scryFor, opts.scryRef, { day: opts.day ?? ctx.realm.day, source: "scried", accuracy });
      return { ok: true, misfire: false, ...(opts.scryRef ? { scried: { ref: opts.scryRef, accuracy } } : {}), lines: [`${sp.name}: shapes in the water, half clear.`], minutes: sp.cost.minutes };
    }
    default:
      break;
  }
  return { ok: true, misfire: false, lines: [`${sp.name} takes hold.`], minutes: sp.cost.minutes };
}
