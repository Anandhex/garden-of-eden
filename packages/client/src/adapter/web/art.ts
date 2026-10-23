/**
 * The web adapter's art manifest (G6 step 1): every art id the server can send, mapped to a texture this adapter
 * has. For now those are the textures drawn in code at start-up (world/textures.ts); G6's sheets replace them id
 * by id. An id with no entry falls back by family, so nothing is ever drawn as an empty space.
 */
import type { ArtId } from "@millbrook/shared/view";
import { GRASS_VARIANTS, PATH_VARIANTS } from "./world/textures";

export interface ArtEntry {
  /** The texture key; with `variants`, keys are `${key}${n}` picked by a stable hash of the tile. */
  key: string;
  variants?: number;
}

export const MANIFEST: Record<ArtId, ArtEntry> = {
  "terrain/grass": { key: "grass", variants: GRASS_VARIANTS },
  "terrain/path": { key: "path", variants: PATH_VARIANTS },
  "terrain/water": { key: "water" },
  "terrain/sand": { key: "sand" },
  "terrain/hill": { key: "hill" },
  "terrain/marsh": { key: "marsh" },
  "terrain/field": { key: "field" },
  "terrain/ford": { key: "ford" },
  "terrain/bridge": { key: "bridge" },
  "terrain/town": { key: "town" },
  "terrain/yard": { key: "yard" },
  "terrain/road": { key: "rpath", variants: 3 },
  "props/tree": { key: "tree" },
  "props/rock": { key: "rock" },
  "props/reeds": { key: "reeds" },
  "props/milestone": { key: "milestone" },
  "props/signpost": { key: "signpost" },
  "props/shrine": { key: "shrine" },
  "props/farmhouse": { key: "farmhouse" },
  "props/bar": { key: "bar" },
  "props/thatch": { key: "thatch" },
  "buildings/wall": { key: "stonewall" },
  "buildings/door": { key: "door" },
  "buildings/gate": { key: "gate" },
  "people/body": { key: "body" },
  "people/player": { key: "body" },
  "creature/wolf": { key: "beast" },
  "creature/bear": { key: "beast" },
  "creature/boar": { key: "beast" },
  "creature/spider": { key: "beast" },
  "creature/horse": { key: "beast" },
  "creature/beast": { key: "beast" },
  "fx/grave": { key: "grave" },
  "fx/shadow": { key: "shadow" },
  "fx/marker": { key: "marker" },
  "fx/drop": { key: "drop" },
  "fx/flake": { key: "flake" },
  "fx/ripple": { key: "ripple" },
};

const FALLBACK: Record<string, ArtEntry> = { terrain: { key: "grass", variants: GRASS_VARIANTS }, props: { key: "rock" }, buildings: { key: "stonewall" }, people: { key: "body" }, creature: { key: "beast" }, fx: { key: "spark" } };

/** The texture for an art id at a tile (`hash` 0–1 picks a variant). */
export function textureFor(id: string, hash = 0): string {
  const e = (MANIFEST as Record<string, ArtEntry>)[id] ?? FALLBACK[id.split("/")[0]!] ?? { key: "spark" };
  return e.variants ? `${e.key}${Math.min(e.variants - 1, Math.floor(hash * e.variants))}` : e.key;
}

/** How an actor's sprite is drawn: a person (body and head), a beast, or a grave. */
export const lookOf = (sprite: string): "person" | "beast" | "grave" => (sprite === "fx/grave" ? "grave" : sprite.startsWith("creature/") ? "beast" : "person");
