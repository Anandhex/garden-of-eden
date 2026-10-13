import worldJson from "./fixtures/world.json" with { type: "json" };
import { parseLore, setBaseLore } from "../src/npc/knowledge.js";

// The game's lore is all generated (N25a). The tests of one NPC's mechanics use the six fixture NPC files, which know
// a fixed world (tests/fixtures/world.json): it is the base lore for every test file, before it imports anything.
setBaseLore(parseLore(worldJson, "tests/fixtures/world.json"));
