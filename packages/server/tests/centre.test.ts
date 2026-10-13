import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * N25a: the game has no centre. No code, data, prompt or client string may know that Millbrook exists, name a
 * hand-written person, or ask "is the player at home?". Each pattern has a ceiling (lines matched); the phase
 * ends with every ceiling at 0, and a pattern may never go up.
 */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIRS = ["server/src", "shared/src", "client/src", "server/scripts"];
const EXT = /\.(ts|tsx|json|html|css)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

/** The project's own name stays: the package scope and the storage keys. */
const ALLOWED = /@millbrook\/|millbrook\.(timeFlows|voice|[a-zA-Z]+Key)|millbrook-/g;

const PATTERNS: Array<{ name: string; re: RegExp; ceiling: number }> = [
  { name: "HOME_ID", re: /HOME_ID/, ceiling: 0 },
  { name: "Millbrook", re: /\bmillbrook\b/i, ceiling: 0 },
  { name: "the cast (Brena, Hale, Pell, Pip, Rook, Wren)", re: /\b(Brena|Hale|Pell|Pip|Rook|Wren)\b/, ceiling: 0 },
  { name: "Voss, Holt, the Goose, the Deeps", re: /Aldric Voss|Reyna Holt|Gilded Goose|Old Mine Deeps/, ceiling: 0 },
  { name: "atHome(", re: /atHome\(/, ceiling: 0 },
  { name: "world.creatures", re: /\bworld\.creatures\b/, ceiling: 0 },
  { name: "world.haunts", re: /\bworld\.haunts\b/, ceiling: 0 },
  { name: "realm.home", re: /\brealm\.home\b/, ceiling: 0 },
  { name: "s.home", re: /\bs\.home\b/, ceiling: 0 },
  { name: "tests/fixtures", re: /tests\/fixtures/, ceiling: 0 },
];

describe("N25a the centre lint", () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
  const lines = files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((text, i) => ({ f, i: i + 1, text: text.replace(ALLOWED, "") })));

  it.each(PATTERNS)("$name stays at or under $ceiling", ({ re, ceiling }) => {
    const hits = lines.filter((l) => re.test(l.text));
    expect(hits.map((h) => `${h.f.replace(ROOT, "")}:${h.i}: ${h.text.trim().slice(0, 100)}`).slice(0, 12), `${hits.length} lines`).toHaveLength(Math.min(hits.length, ceiling));
    expect(hits.length).toBeLessThanOrEqual(ceiling);
  });
});
