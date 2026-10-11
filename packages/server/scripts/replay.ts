import { readTranscript } from "../src/game/transcript.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run replay -- <transcript.jsonl>");
  process.exit(1);
}

const turns = readTranscript(file);
console.log(`Loaded ${turns.length} recorded turn(s).`);
for (const [index, turn] of turns.entries()) {
  console.log(`${index + 1}. ${turn.playerLine} -> ${turn.actions.length} action(s)`);
}
