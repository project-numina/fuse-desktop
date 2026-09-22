/** Splits a byte stream into newline-delimited JSON objects. */
export class JsonLineReader {
  private buffer = '';

  constructor(
    private readonly onObject: (value: unknown, line: string) => void,
    private readonly onInvalid: (line: string, error: unknown) => void,
  ) {}

  push(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.emit(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  /** Flush a trailing line that had no newline (process exit). */
  end(): void {
    const line = this.buffer;
    this.buffer = '';
    this.emit(line);
  }

  private emit(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('{')) {
      this.onInvalid(trimmed, null);
      return;
    }
    try {
      this.onObject(JSON.parse(trimmed), trimmed);
    } catch (error) {
      this.onInvalid(trimmed, error);
    }
  }
}
