/**
 * G8 locality: each place's frame carries its locale (culture, land, wealth 0..1, size), which the Unity builder
 * (LocaleArch.cs) uses to change how the culture's buildings are built for the land and how well the place lives.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FrameSchema } from "@garden-of-eden/shared/view";
import { generateRealm } from "../src/game/realm/generate.js";
import { SETTLEMENT_KINDS, TERRAINS } from "../src/game/realm/types.js";
import { localeOf } from "../src/view/locale.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const map = { id: "x", name: "X", kind: "place" as const, w: 40, h: 30 };

describe("G8: the place's locale", () => {
  it("is filled from the settlement: its culture, land, prosperity as wealth 0..1, and size", () => {
    const realm = generateRealm(1);
    const all = Object.values(realm.settlements);
    expect(all.length).toBeGreaterThan(5);
    for (const s of all) {
      const loc = localeOf(realm, s.id)!;
      expect(loc.terrain).toBe(s.terrain);
      expect(loc.size).toBe(s.kind);
      expect(loc.wealth).toBeGreaterThanOrEqual(0);
      expect(loc.wealth).toBeLessThanOrEqual(1);
      expect(loc.wealth).toBeCloseTo(Math.min(1, Math.max(0, s.prosperity / 100)), 2);
      expect(loc.culture).not.toBe("");
    }
    // the land differs from place to place, so the buildings can too
    expect(new Set(all.map((s) => localeOf(realm, s.id)!.terrain)).size).toBeGreaterThan(2);
  });

  it("is null with no realm or no such place", () => {
    expect(localeOf(null, "a")).toBeNull();
    expect(localeOf(generateRealm(1), "nowhere")).toBeNull();
    expect(localeOf(generateRealm(1), null)).toBeNull();
  });

  it("is an optional field of the frame's map", () => {
    expect(FrameSchema.shape.map.safeParse(map).success).toBe(true);
    expect(FrameSchema.shape.map.safeParse({ ...map, locale: { culture: "river", terrain: "marsh", wealth: 0.4, size: "village" } }).success).toBe(true);
    expect(FrameSchema.shape.map.safeParse({ ...map, locale: { culture: "river", terrain: "marsh", wealth: 1.4, size: "village" } }).success).toBe(false);
  });

  it("uses only land and sizes the Unity builder knows", () => {
    const cs = readFileSync(`${root}unity/GardenOfEden/Assets/Game/World/LocaleArch.cs`, "utf8");
    const cases = [...cs.matchAll(/case "([a-z]+)":/g)].map((m) => m[1]!);
    const known = new Set<string>([...TERRAINS, ...SETTLEMENT_KINDS]);
    for (const c of cases) expect(known.has(c), `LocaleArch.cs case "${c}"`).toBe(true);
    // every size has a standing, and every land but the plain valley has a rule
    for (const k of SETTLEMENT_KINDS) expect(cases).toContain(k);
    for (const t of TERRAINS) if (t !== "valley") expect(cases).toContain(t);
    const frameCs = readFileSync(`${root}unity/GardenOfEden/Assets/Game/Net/Frame.cs`, "utf8");
    expect(frameCs).toMatch(/public Locale locale;/);
  });
});
