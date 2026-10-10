import { MOODS, type Mood } from "./types.js";

/**
 * Small models sometimes write their mood as text ("Annoyed. That's low, stranger.")
 * instead of calling change_mood. On qwen3:4b-instruct this happened on about half
 * of insult turns. This filter sits on the text stream, holds back the first word
 * until it can tell, and removes a leading mood label so the player never sees it.
 * The caller then applies the mood as if the tool had been called.
 *
 * Only a mood word followed by punctuation counts ("Annoyed." yes, "Happy to help" no).
 */
export class LeadingMoodFilter {
  private buffer = "";
  private decided = false;
  /** After removing a label, drop whitespace until real text arrives (it may come in later chunks). */
  private trimLeading = false;
  /** The mood found at the start of the reply, if any. */
  mood: Mood | null = null;
  /** The exact text that was removed, e.g. "Annoyed. ". */
  removed = "";

  constructor(private readonly emit: (delta: string) => void) {}

  push(delta: string): void {
    if (this.decided) {
      this.emitText(delta);
      return;
    }
    this.buffer += delta;
    // Decide once the first word is complete, or if the start is clearly not a word.
    if (/^\s*[A-Za-z]+[^A-Za-z]/.test(this.buffer) || /^\s*[^A-Za-z\s]/.test(this.buffer) || this.buffer.length > 24) {
      this.decide();
    }
  }

  /** Call when the stream ends, to flush anything still held back. */
  end(): void {
    if (!this.decided) this.decide();
  }

  private decide(): void {
    this.decided = true;
    const match = this.buffer.match(/^\s*([A-Za-z]+)[.!,:;—-]+\s*/);
    const word = match?.[1]?.toLowerCase();
    if (match && word && (MOODS as readonly string[]).includes(word)) {
      this.mood = word as Mood;
      this.removed = match[0];
      this.buffer = this.buffer.slice(match[0].length);
      this.trimLeading = true;
    }
    this.emitText(this.buffer);
    this.buffer = "";
  }

  private emitText(delta: string): void {
    if (this.trimLeading) {
      const trimmed = delta.trimStart();
      this.removed += delta.slice(0, delta.length - trimmed.length);
      if (trimmed) this.trimLeading = false;
      delta = trimmed;
    }
    if (delta) this.emit(delta);
  }
}
