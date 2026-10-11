import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE } from "@millbrook/shared";
import { pickVoice } from "../src/voice/pick";

const mac = [
  { name: "Samantha", lang: "en-US", localService: true },
  { name: "Daniel", lang: "en-GB", localService: true },
  { name: "Serena", lang: "en_GB", localService: true },
  { name: "Moira", lang: "en-IE", localService: true },
  { name: "Thomas", lang: "fr-FR", localService: true },
  { name: "Google UK English Female", lang: "en-GB", localService: false },
];

describe("pickVoice (T14)", () => {
  it("takes the first preferred voice that's installed, by exact name or prefix", () => {
    expect(pickVoice(mac, { ...DEFAULT_VOICE, browser: ["Arthur", "Daniel"] }, "hale")?.name).toBe("Daniel");
    expect(pickVoice(mac, { ...DEFAULT_VOICE, browser: ["google uk english"] }, "wren")?.name).toBe("Google UK English Female");
  });

  it("falls back to the NPC's language and gender, on-device voices first", () => {
    expect(pickVoice(mac, { ...DEFAULT_VOICE, lang: "en-GB", gender: "female", browser: ["Nobody"] }, "brena")?.name).toBe("Serena");
    expect(pickVoice(mac, { ...DEFAULT_VOICE, lang: "en-GB", gender: "male" }, "rook")?.name).toBe("Daniel");
  });

  it("widens to the language family, keeps each NPC's pick stable, and gives up cleanly", () => {
    const a = pickVoice(mac, { ...DEFAULT_VOICE, lang: "en-AU" }, "pell");
    expect(a?.lang.startsWith("en")).toBe(true);
    expect(pickVoice(mac, { ...DEFAULT_VOICE, lang: "en-AU" }, "pell")).toBe(a);
    expect(pickVoice(mac, { ...DEFAULT_VOICE, lang: "de-DE" }, "pell")).toBeNull();
    expect(pickVoice([], DEFAULT_VOICE, "pell")).toBeNull();
  });
});
