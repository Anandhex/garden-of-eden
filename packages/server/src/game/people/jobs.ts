import type { Job, SocialClass } from "@millbrook/shared";
import type { Rng } from "../dice.js";

/**
 * What a young person does once they come of age (N25), from their class and what their place can use. The
 * same picture rollPeople (game/realm/townsfolk.ts) paints for the first people of a place, simpler: a
 * serf's child works the land, a craftsman's a trade, a servant's household needs them.
 */
export interface Occupation {
  job: Job;
  /** As the crowd simulation reads it: `zone:fields`, `home`, `streets` (a target the map lacks falls back to the square). */
  work: string;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

export function occupationAtAdulthood(cls: SocialClass, gender: "female" | "male", kind: string, rng: Rng): Occupation {
  switch (cls) {
    case "slave":
      return { job: "slave", work: rng() < 0.4 ? "zone:fields" : "streets" };
    case "serf":
      return rng() < 0.75 ? { job: "farmer", work: "zone:fields" } : { job: "labourer", work: "streets" };
    case "royal":
      return { job: "royal", work: "home" };
    case "noble":
      return { job: kind === "capital" && rng() < 0.4 ? "courtier" : "noble", work: "home" };
    case "gentry":
      return { job: pick(rng, ["clerk", "clerk", "scholar"] as const), work: "home" };
    case "clergy":
      return { job: "acolyte", work: "streets" };
    case "merchant":
      return { job: rng() < 0.6 ? "stallholder" : "merchant", work: "zone:market" };
    case "artisan":
      return { job: pick(rng, ["baker", "weaver", "carpenter", "cobbler", "tailor", "potter", "apprentice"] as const), work: "home" };
    default: {
      const farm = kind === "hamlet" || kind === "village";
      const r = rng();
      if (farm && r < 0.45) return { job: "farmer", work: "zone:fields" };
      if (r < 0.65) return { job: "labourer", work: "streets" };
      if (r < 0.75) return { job: "porter", work: "streets" };
      if (r < 0.82) return gender === "female" ? { job: "washer", work: "zone:square" } : { job: "hunter", work: "out:exit_woods" };
      if (r < 0.9) return { job: "guard", work: "zone:gate" };
      return { job: "weaver", work: "home" };
    }
  }
}

/** Jobs a person keeps into old age: the household, the pulpit and the throne don't retire. */
export const NO_RETIRING: ReadonlySet<Job> = new Set<Job>(["slave", "royal", "noble", "priest", "elder", "innkeeper", "servant"]);
