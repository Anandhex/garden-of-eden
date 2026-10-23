# The art (G6)

All of the game's pictures are made here, as text, and packed by `npm run art`. Nothing is drawn by hand in an
image editor, so every sprite can be read, diffed and changed in a pull request. The packed files are committed,
so `npm run build` doesn't need to run the packer. A test (`packages/server/tests/g6.test.ts`) fails when they fall
behind the sources.

```
art/
  palette.txt          one character per colour
  sprites/<sheet>.txt  the sprites, by sheet: terrain, buildings, props, people, creatures, fx
  tiled/               Tiled tilesets (<sheet>.tsj + .png, made by the packer) and building templates (templates/*.tmj)
  pack.ts, png.ts      the packer (node's zlib only, no other dependency)
```

`npm run art` writes:

- `packages/client/public/art/<sheet>.png` and `.json`: texture atlases with Phaser JSON-hash frames;
- `packages/client/src/adapter/web/art/sheets.json`: each frame's sheet, size and foot;
- `art/tiled/terrain.tsj`, `buildings.tsj` (and their `.png`): Tiled tilesets of the 16 px tiles, with Wang sets;
- `packages/shared/src/view/templates.json`: the building templates, as plain JSON for the server and every adapter.

## The grid

- **16 logical pixels a tile.** The packer writes every pixel as a 4×4 block, so a tile is **64 px** in the PNG;
  the web adapter shows it at **32 px** with nearest-neighbour filtering. That is the plan's "art at 2×": crisp now,
  and room for a closer camera or a 2.5D renderer later without redrawing.
- Sprites can be any size. People are 16×20 (a head above their tile), trees 20×20, a horse 24×20.
- **The foot.** Everything that stands (people, trees, lamps) has a foot: the pixel that stands on the bottom
  middle of its tile. It defaults to the bottom middle of the sprite; `foot=x,y` moves it (a tree's trunk). The
  adapter y-sorts by the foot.

## The palette

`palette.txt`: one line per colour, `char  #rrggbb[aa]  name  [layer]`. `.` is always transparent. Use the named
colours; add one only when no existing colour will do. Earthy and a little warm, outlines near-black (`k`), never pure
black. Shadows are `_` (black at 35%); glows and mist are `:`, `;`, `*` (white at rising alpha).

**Layers** (`cloth`, `hair`, `trim`) are greys that the adapter tints. A `split` sprite is cut into
`<name>.body`, `.cloth`, `.hair` and `.trim` frames by these: people's clothes take `look.tint`, trim `look.trim`,
hair a colour picked from the person's id. That is how thousands of townsfolk share one body.

## Naming

`<family>/<thing>` with the family from `packages/shared/src/view/art.ts` (`terrain`, `props`, `buildings`,
`people`, `creature`, `fx`), lower case with underscores:

- variants end in `_<n>` (`terrain/grass_0` … `_3`): the adapter picks one by a stable hash of the tile;
- people: `people/body/<dir><step>` with dir `s n e w` and step `0` (stand), `1`, `2` (the feet); the walk plays 1-0-2-0;
- creatures: `creature/<kind>/<e|w><n>`, two trot frames, seen from the side;
- building tiles: `buildings/<material>_<part>_<l|m|r>` for roofs (`top`, `mid`, `near`), `buildings/<material>_<l|m|r|win>` for front walls;
- generated corner tiles: `terrain/wang/<set>_<mask>` (mask bits: top-left 1, top-right 2, bottom-right 4, bottom-left 8).

Every art id in `art.ts` maps to frames in the web adapter's manifest (`packages/client/src/adapter/web/art.ts`,
`SHEET_ART`), and to a code-drawn fallback (`MANIFEST`) for when a sheet fails to load. A missing frame never
draws as nothing; it draws the fallback and the console says `[art] no sheet art for …` once.

## How to add a sprite

1. Add it to the right `sprites/<sheet>.txt`: a header line, then its rows.

   ```
   == props/well 16x16 foot=8,15
   ................
   ....kkkkkkkk....
   ...
   ```

   Options on the header: `WxH` (else taken from the rows), `foot=x,y`, `split` (tinted layers), `mirror=<name>`
   (a horizontal mirror, no rows), `base=<name>` (draw over an earlier frame: `.` keeps its pixel, `,` clears it,
   the last row repeats down), `wang over=… base=… edge=c [rim=c]` (16 corner tiles between two grounds), and any
   other `key=value` or flag becomes a property of the frame (`window`, `glow=fx/window_glow`, `wall=face`).
2. Put new tiles **at the end** of their sheet's file, so the tileset keeps every old tile's number (the packer keeps
   numbers from the old `.tsj` in any case, and appends new tiles).
3. `npm run art`. The packer stops on a row of the wrong width or a character not in the palette, with the line.
4. If it is a new art id the server sends, add it to `art.ts` and to the web manifest (`SHEET_ART` and `MANIFEST`);
   the G6 test checks both ways.

## Templates

A template (`tiled/templates/<id>.tmj`) dresses a generated building. Open it in Tiled with `tiled/buildings.tsj`.

- Layers: `roof` and `walls` (tile layers), `props` and `lights` (object layers of points), `marks` (the `door`).
- The first row is the ridge, standing on the street behind the building; the last row is the front wall.
- Map properties: `kinds` (the building kinds it fits), `slice` (`left,right,top,bottom`: rows and columns kept at
  the edges, the middle repeated, so one template fits any size), `door` (the tile a front door gets), `porch` (drawn
  over the roof for a door on another side), `roofTint` (tint the roof by the building's colour).
- Objects: a prop has `art` (a frame), `layer` (`roof` or `walls`) and optionally `anchor=door` (placed relative to
  the door); a light's class is its kind (`lamp`, `fire`, `forge`, `torch`, `magic`). Window tiles (`window` on the
  frame) make window lights by themselves.

A template only dresses. The town generator decides the map (walls, doors, who can walk where); the template never
does. Several templates for one kind are picked by a stable hash of the map and building, so a town looks the same
on every visit.
