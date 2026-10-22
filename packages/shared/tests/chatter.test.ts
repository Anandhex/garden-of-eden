import { describe, expect, it } from "vitest";
import { HOSTILE, INTERACTIONS, isHostile, isInteraction, kindLines, markKey, type Townsperson } from "../src/index.js";

const person = (cls: Townsperson["cls"], gender: Townsperson["gender"] = "male"): Townsperson => ({ id: cls, name: cls, gender, age: 30, cls, job: "farmer", faction: null, factionName: null, home: 0, work: "home", master: null, masterId: null, color: "#fff" });

describe("N37: kinds of exchange in the shared code", () => {
  it("a mark's key is the same whichever way round the pair is", () => {
    expect(markKey(3, 9, 640)).toBe(markKey(9, 3, 640));
    expect(markKey(3, 9, 640)).not.toBe(markKey(3, 9, 641));
  });

  it("the hostile kinds are all kinds, and only wrongs are hostile", () => {
    for (const k of HOSTILE) expect(INTERACTIONS).toContain(k);
    for (const k of ["greet", "bow", "order", "complain", "share_news", "flatter", "apologise"] as const) expect(isHostile(k)).toBe(false);
    for (const k of ["sneer", "insult", "humiliate", "refuse_bow", "refuse_order", "threaten"] as const) expect(isHostile(k)).toBe(true);
    expect(isInteraction("insult")).toBe(true);
    expect(isInteraction("kiss")).toBe(false);
  });

  it("every kind with words of its own has them, for the high and the low alike, and says them the same way for the same seed", () => {
    for (const kind of INTERACTIONS) {
      for (const [a, b] of [[person("noble"), person("serf")], [person("serf"), person("noble", "female")], [person("commoner"), person("commoner")]] as const) {
        const lines = kindLines(kind, a, b, 123);
        if (["greet", "bow", "order", "share_news"].includes(kind)) expect(lines, kind).toBeNull();
        else {
          expect(lines, kind).not.toBeNull();
          expect(lines![0].length, kind).toBeGreaterThan(2);
          expect(kindLines(kind, a, b, 123)).toEqual(lines);
        }
      }
    }
  });

  it("a noble's sneer at a serf is answered with deference, a serf's at a noble with anger", () => {
    const down = kindLines("sneer", person("noble"), person("serf"), 5)!;
    expect(down[1]).toMatch(/lord|bow|says nothing|yes/i);
    const up = kindLines("sneer", person("serf"), person("noble"), 5)!;
    expect(up[0]).not.toBe(down[0]);
  });
});
