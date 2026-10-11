import { describe, expect, it } from "vitest";
import { LeadingMoodFilter } from "../src/npc/moodPrefix.js";

/** Feed chunks through the filter and return what got through. */
function run(chunks: string[]) {
  let out = "";
  const f = new LeadingMoodFilter((d) => (out += d));
  for (const c of chunks) f.push(c);
  f.end();
  return { out, mood: f.mood, removed: f.removed };
}

describe("LeadingMoodFilter", () => {
  it("removes a leading mood label and reports the mood", () => {
    expect(run(["Ann", "oyed", ".", " That's low", ", stranger."])).toEqual({
      out: "That's low, stranger.",
      mood: "annoyed",
      removed: "Annoyed. ",
    });
  });

  it("handles the label arriving in one chunk", () => {
    expect(run(["Angry! Get out."]).out).toBe("Get out.");
  });

  it("leaves normal replies untouched", () => {
    expect(run(["Stranger", ", what do you want?"])).toEqual({ out: "Stranger, what do you want?", mood: null, removed: "" });
  });

  it("does not strip a mood word used in a sentence", () => {
    expect(run(["Happy to ", "help."]).out).toBe("Happy to help.");
  });

  it("passes through replies that start with punctuation or quotes", () => {
    expect(run(['"Fifteen gold."']).out).toBe('"Fifteen gold."');
  });

  it("flushes a short reply held back at the end", () => {
    expect(run(["Hm"]).out).toBe("Hm");
  });

  it("handles an empty stream", () => {
    expect(run([]).out).toBe("");
  });
});
