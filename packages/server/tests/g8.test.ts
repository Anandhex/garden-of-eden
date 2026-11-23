/**
 * G8: regional building styles. A place is built the way its people build (its kingdom's culture, or another people's
 * own way) with what its land gives (the walls of ordinary houses); rich places roof their cottages in the culture's
 * fine roof. Every styled template wears only frames the packed art has, and the server sends the place's style.
 */
import { describe, expect, it } from "vitest";
import { archStyle, CULTURE_STYLES, dress, PEOPLE_STYLES, styledFrame, styleIdFor, TEMPLATE_IDS, TEMPLATES, templateById, templateFor, templateForStyle, TERRAIN_STYLES, WINDOW_TILES } from "@millbrook/shared/view";
import sheets from "../../client/src/adapter/web/art/sheets.json" with { type: "json" };
import { buildLookOf } from "../src/game/culture/look.js";
import { cultureAt } from "../src/game/culture/model.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { advanceRealm } from "../src/game/realm/day.js";

const FRAMES = sheets.frames as Record<string, unknown>;

const ALL_STYLES = [
  ...CULTURE_STYLES.flatMap((c) => TERRAIN_STYLES.flatMap((t) => [`${c}.${t}`, `${c}.${t}.rich`])),
  ...PEOPLE_STYLES,
];

/** Every frame a template draws: roof, walls, door, porch and props. */
function framesOf(id: string): string[] {
  const t = templateById(id)!;
  return [...t.roof.flat(), ...t.walls.flat(), t.door, t.porch, ...t.props.map((p) => p.art)].filter((x): x is string => !!x);
}

describe("G8 regional building styles", () => {
  it("every style of every template wears only frames the art has, and keeps its windows lit", () => {
    for (const style of ALL_STYLES) {
      expect(archStyle(style), style).not.toBeNull();
      for (const id of TEMPLATE_IDS) {
        const styled = `${id}~${style}`;
        for (const f of framesOf(styled)) expect(FRAMES[f], `${styled}: ${f}`).toBeTruthy();
        // A window in the plain template is a window (lit after dark) in the styled one.
        const plainWindows = TEMPLATES[id]!.walls.flat().filter((f) => f && WINDOW_TILES[f]).length;
        const styledWindows = templateById(styled)!.walls.flat().filter((f) => f && WINDOW_TILES[f]).length;
        expect(styledWindows, styled).toBe(plainWindows);
      }
    }
  });

  it("an unknown style or none leaves the template plain; templateForStyle without a style is templateFor", () => {
    expect(templateById("house_a~atlantis")).toEqual(TEMPLATES.house_a);
    expect(templateById("nope~coastal.coast")).toBeUndefined();
    for (let i = 0; i < 20; i++) expect(templateForStyle("house", "", `town:${i}`, undefined)).toBe(templateFor("house", "", `town:${i}`));
    expect(styleIdFor({})).toBeUndefined();
    expect(styleIdFor({ culture: "nowhere", terrain: "hills" })).toBeUndefined();
  });

  it("culture picks the roofs, the land the walls, and wealth the fine roof", () => {
    const roofOf = (style: string) => templateById(`house_a~${style}`)!.roof[1]![1];
    const wallOf = (style: string) => templateById(`house_a~${style}`)!.walls.at(-1)!.find((f) => f?.endsWith("_m"));
    // Roofs by culture, on the same land.
    expect(new Set(CULTURE_STYLES.filter((c) => c !== "steppe").map((c) => roofOf(`${c}.plains`))).size).toBeGreaterThanOrEqual(4);
    expect(roofOf("coastal.plains")).toMatch(/tile_/);
    expect(roofOf("forest.plains")).toMatch(/turf_/);
    expect(roofOf("highland.plains")).toMatch(/reed_/);
    // Walls by land, for a people with no wall of their own (the river folk).
    expect(wallOf("river.hills")).toMatch(/stone_/);
    expect(wallOf("river.forest")).toMatch(/log_/);
    expect(wallOf("river.marsh")).toMatch(/daub_/);
    expect(wallOf("river.plains")).toMatch(/plaster_/);
    // ...but the coast folk whitewash wherever they live.
    expect(wallOf("coastal.forest")).toMatch(/white_/);
    // A rich river town roofs its cottages in shingles, a poor one in straw.
    expect(roofOf("river.plains")).toMatch(/thatch_/);
    expect(roofOf("river.plains.rich")).toMatch(/shingle_/);
    // Steppe houses are felt tents; a dwarf hold is dark stone throughout.
    expect(templateForStyle("house", "", "m:1", "steppe.plains")).toBe("tent~steppe.plains");
    expect(framesOf(templateForStyle("hall", "", "m:1", "dwarf")).filter((f) => /_(m|l|r|win)$/.test(f) && !/(slate|darkstone)_/.test(f))).toEqual([]);
    // A roof whose material changed is not tinted by the building's colour; one the style kept still is.
    expect(templateById("house_b~coastal.coast")!.roofTint).toBe(false);
    expect(templateById("house_b~river.plains")!.roofTint).toBe(true);
    expect(templateById("market~coastal.coast")!.roofTint).toBe(true);
  });

  it("a frame family swaps by its longest prefix, and a single frame by name", () => {
    const s = archStyle("imperial.hills")!;
    expect(styledFrame(s, "buildings/stone_win")).toBe("buildings/brick_win");
    expect(styledFrame(s, "buildings/door_stone")).toBe("buildings/brick_door");
    expect(styledFrame(s, "props/hay")).toBe("props/hay");
  });

  it("dressing a styled building puts the region's materials on the map, the same on every visit", () => {
    const id = templateForStyle("house", "", "town:3", "forest.forest");
    const a = dress(templateById(id)!, { x: 2, y: 2, w: 4, h: 3, door: { x: 3, y: 4 } });
    const b = dress(templateById(id)!, { x: 2, y: 2, w: 4, h: 3, door: { x: 3, y: 4 } });
    expect(a).toEqual(b);
    expect(a.walls.some((w) => w.frame.startsWith("buildings/log_"))).toBe(true);
  });

  it("the realm's places look like their kingdoms and their land: several looks in one realm, other peoples their own", () => {
    const realm = generateRealm(1, 1);
    advanceRealm(realm, 3);
    const looks = new Map<string, string>();
    for (const s of Object.values(realm.settlements).filter((x) => !x.way && !x.abandoned)) {
      const look = buildLookOf(realm, s.id)!;
      expect(look, s.id).toBeTruthy();
      if (look.style) looks.set(s.id, look.style);
    }
    expect(new Set(looks.values()).size).toBeGreaterThanOrEqual(4);
    // The style names the place's kingdom culture and its own land.
    for (const [site, style] of looks) {
      const s = realm.settlements[site]!;
      if (s.species && s.species !== "human") {
        expect(style).toBe(s.species);
        continue;
      }
      const [culture, terrain, rich] = style.split(".");
      expect(culture).toBe(cultureAt(realm, site)!.template);
      expect(terrain).toBe(s.terrain);
      expect(rich === "rich").toBe(s.kind === "city" || s.kind === "capital");
    }
    // Another people's hold (N54) builds its own way, without the human culture's paint.
    const hold = Object.values(realm.settlements).find((s) => s.species === "dwarf");
    if (hold) expect(buildLookOf(realm, hold.id)).toEqual({ style: "dwarf" });
  });
});
