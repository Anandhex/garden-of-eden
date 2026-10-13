import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import hale from "../src/data/npcs/hale.json" with { type: "json" };
import pell from "../src/data/npcs/pell.json" with { type: "json" };
import { loadWorld, newWorld, saveWorld } from "../src/game/save.js";
import {
  certaintyOf,
  eventTexts,
  knownNameWords,
  lookupLore,
  MAX_LORE_LINES,
  parseLore,
  scopeCovers,
  unknownNames,
  worldLore,
} from "../src/npc/knowledge.js";
import { buildEventMessage, buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

const personas: Record<string, NpcPersona> = {
  brena: parsePersona(brena, "brena.json"),
  pell: parsePersona(pell, "pell.json"),
  hale: parsePersona(hale, "hale.json"),
};
const lore = worldLore();

function situation(id: string, line: string): string {
  const p = personas[id]!;
  return buildTurnMessage(p, createNpcState(p), createDemoWorld(), line);
}

describe("world lore file", () => {
  it("parses, and every NPC's scopes match something in it", () => {
    expect(lore.entries.length).toBeGreaterThan(10);
    for (const p of Object.values(personas)) expect(Object.keys(p.knows).length).toBeGreaterThan(0);
  });

  it("rejects duplicate ids, missing parents and an `ask` that isn't a person", () => {
    const entry = (id: string, extra = {}) => ({ id, kind: "place", name: id, text: "x", ...extra });
    expect(() => parseLore({ lore: [entry("a"), entry("a")] })).toThrow(/duplicate/);
    expect(() => parseLore({ lore: [entry("a.b.c")] })).toThrow(/no parent entry "a\.b"/);
    expect(() => parseLore({ lore: [entry("a"), entry("b", { ask: "a" })] })).toThrow(/not a person/);
  });

  it("an NPC file with a scope that matches nothing fails to load", () => {
    expect(() => parsePersona({ ...brena, knows: { "atlantis.*": "certain" } })).toThrow(/knows\.atlantis\.\*: matches nothing/);
  });
});

describe("knowledge scopes", () => {
  it("x.* covers x and everything under it; an exact id only itself", () => {
    expect(scopeCovers("people.mayor.*", "people.mayor")).toBe(true);
    expect(scopeCovers("people.mayor.*", "people.mayor.household")).toBe(true);
    expect(scopeCovers("people.mayor.*", "people.mayorship")).toBe(false);
    expect(scopeCovers("people.mayor", "people.mayor.household")).toBe(false);
    expect(scopeCovers("*", "anything")).toBe(true);
  });

  it("the most specific scope sets how sure they are", () => {
    const p = personas.pell!;
    expect(certaintyOf(p, "people.mayor.household")).toBe("certain"); // "*"
    expect(certaintyOf(p, "people.tomas.sighting")).toBe("rumour"); // exact beats "*"
    const h = personas.hale!;
    expect(certaintyOf(h, "mine_road")).toBe("certain"); // exact beats "mine_road.*"
    expect(certaintyOf(h, "mine_road.bandits")).toBe("rumour");
  });

  it("a blacksmith knows the mine road but not the mayor's household", () => {
    expect(certaintyOf(personas.brena!, "mine_road")).toBe("certain");
    expect(certaintyOf(personas.brena!, "people.mayor.household")).toBeNull();
  });
});

describe("lore in the situation block", () => {
  it("nothing outside an NPC's scope is ever shown, whatever the player asks", () => {
    for (const [id, p] of Object.entries(personas)) {
      for (const entry of lore.entries) {
        for (const word of [...entry.keywords, ...entry.aliases]) {
          const text = situation(id, `Tell me about the ${word}.`);
          for (const other of lore.entries) {
            if (certaintyOf(p, other.id) || createDemoWorld().recentEvents.includes(other.id)) continue;
            expect(text, `${id} asked about "${word}" saw ${other.id}`).not.toContain(other.text);
          }
        }
      }
    }
  });

  it("asked about the mayor's wife, Brena says she doesn't know and points to Pell; Pell knows her name", () => {
    const b = situation("brena", "What's the mayor's wife called?");
    expect(b).toMatch(/You know nothing about the mayor's household\. Say so; don't make anything up\. Old Pell might know\./);
    expect(b).not.toContain("Odile");
    expect(situation("pell", "What's the mayor's wife called?")).toContain("Odile");
  });

  it("a rumour is marked as one", () => {
    expect(situation("pell", "Any word of Tomas?")).toMatch(/heard a rumour \(you're not sure it's true\): A guardsman matching Tomas/);
  });

  it("doesn't hint at news the NPC doesn't know when asked about its parent", () => {
    const b = situation("brena", "Tell me about Tomas.");
    expect(b).toContain("Brena's younger brother");
    expect(b).not.toMatch(/seen in the city|hooded stranger/);
  });

  it("a news question brings up the news they know, never more than the cap", () => {
    const b = situation("brena", "Heard any news lately?");
    expect(b).toContain("raiding the mine road for two weeks");
    const found = lookupLore(personas.pell!, "Any news or gossip about the mayor, Tomas, bandits and the captain?");
    expect(found.known.length + found.unknown.length).toBeLessThanOrEqual(MAX_LORE_LINES);
  });

  it("small talk adds no lore lines", () => {
    expect(situation("brena", "Nice weather today, isn't it?")).not.toMatch(/You know:|rumour|know nothing/);
  });

  it("a name that isn't in the world gets a 'never heard of it', pointing to whoever hears the rumours", () => {
    expect(situation("brena", "Have you been to the ruins of Kargoth?")).toMatch(/never heard of Kargoth\. Say you don't know; Old Pell might/);
    // Pell is the one who hears the rumours: he doesn't send people to himself.
    expect(situation("pell", "Have you been to the ruins of Kargoth?")).toMatch(/never heard of Kargoth\. Say you don't know\. /);
  });

  it("game events add no lore lookup, and the system prompt has the rule and the referrals, but no secrets", () => {
    const p = personas.brena!;
    expect(buildEventMessage(p, createNpcState(p), createDemoWorld(), "Traveler asked about the mayor's wife.")).not.toMatch(/know nothing/);
    const system = buildSystemPrompt(p);
    expect(system).toMatch(/Never make up names, places or events/);
    expect(system).toMatch(/Who might know more: Old Pell \(every rumour in the village\)/);
    expect(system).not.toMatch(/mayor|vault|Odile/);
  });
});

describe("world events", () => {
  it("are lore ids; unknown ids never reach an NPC", () => {
    const world = createDemoWorld();
    world.recentEvents = ["news.cart_attack", "made.up_event"];
    expect(eventTexts(world.recentEvents)).toEqual(["Bandits attacked a merchant cart on the mine road this morning."]);
    const p = personas.brena!;
    expect(buildTurnMessage(p, createNpcState(p), world, "Hello.")).toContain("Recent news: Bandits attacked a merchant cart");
  });

  it("a save with an id that isn't in the lore loads without it", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-lore-")), "world.json");
    const raw = JSON.parse(JSON.stringify(newWorld(personas)));
    raw.recentEvents = ["news.cart_attack", "made.up_event"];
    writeFileSync(file, JSON.stringify(raw));
    expect(loadWorld(file, personas).recentEvents).toEqual(["news.cart_attack"]);
  });
});

describe("invented-name check", () => {
  const known = knownNameWords(Object.values(personas), ["Traveler"]);

  it("passes replies that only use names from the world", () => {
    expect(unknownNames("Old Pell might know. Ask him at the Gilded Goose, stranger.", known)).toEqual([]);
    expect(unknownNames("Tomas? My brother. Haven't heard from him since he left for the city.", known)).toEqual([]);
    expect(unknownNames("The mayor's wife is Odile, Aldric Voss keeps her close.", known)).toEqual([]);
  });

  it("flags names that aren't anywhere in the lore", () => {
    expect(unknownNames("The mayor's wife? That'd be Lady Marigold.", known)).toEqual(["Marigold"]);
    expect(unknownNames("I heard it from Gareth down at the mill.", known)).toEqual(["Gareth"]);
  });

  it("ignores ordinary words that open a sentence", () => {
    expect(unknownNames("Bandits on the road. Iron's scarce. Come back tomorrow.", known)).toEqual([]);
  });
});

describe("event lore", () => {
  it("never comes up from a lookup: an NPC only hears of a raid once it's in recentEvents", () => {
    const p = personas.pell!;
    expect(situation("pell", "Any news of a raid? Was anything stolen?")).not.toContain("raided a shop");
    const world = createDemoWorld();
    world.recentEvents = ["news.bandit_raid"];
    expect(buildTurnMessage(p, createNpcState(p), world, "Hello.")).toContain("Bandits raided a shop in Millbrook");
  });
});

describe("invented-name check, punctuation", () => {
  it("splits words joined by a dash", () => {
    const known = knownNameWords(Object.values(personas), ["Traveler"]);
    expect(unknownNames("My brother Tomas—last I heard—went to the city.", known)).toEqual([]);
  });
});
