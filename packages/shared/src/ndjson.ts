/** Reading newline-delimited JSON as it streams in (`POST /api/act`). */
export class NdjsonDecoder<T = unknown> {
  private buffer = "";

  /** Feed a chunk; get back every complete line, parsed. Bad lines are skipped. */
  push(chunk: string): T[] {
    this.buffer += chunk;
    const out: T[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // a broken line is dropped; the final `done` event carries the real state
      }
    }
    return out;
  }
}
