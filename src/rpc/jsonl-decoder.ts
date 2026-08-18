import { StringDecoder } from "node:string_decoder";

export const DEFAULT_MAX_JSONL_RECORD_CHARS = 16 * 1024 * 1024;

export class IncompleteJsonlRecordError extends Error {
  constructor(readonly record: string) {
    super("RPC stream ended with an incomplete JSONL record");
  }
}

export class JsonlRecordTooLargeError extends Error {
  constructor(readonly size: number, readonly maximum: number) {
    super(`RPC JSONL record exceeds ${maximum} characters`);
  }
}

export class JsonlDecoder {
  readonly #decoder = new StringDecoder("utf8");
  #buffer = "";

  constructor(private readonly maximumRecordChars = DEFAULT_MAX_JSONL_RECORD_CHARS) {}

  push(chunk: Buffer): string[] {
    this.#buffer += this.#decoder.write(chunk);
    return this.#drain();
  }

  end(chunk?: Buffer): string[] {
    if (chunk) this.#buffer += this.#decoder.write(chunk);
    this.#buffer += this.#decoder.end();
    const records = this.#drain();
    if (this.#buffer.length > 0) {
      const incomplete = this.#buffer;
      this.#buffer = "";
      throw new IncompleteJsonlRecordError(incomplete);
    }
    return records;
  }

  #drain(): string[] {
    const records: string[] = [];
    let newline = this.#buffer.indexOf("\n");
    while (newline !== -1) {
      if (newline > this.maximumRecordChars) this.#tooLarge(newline);
      let record = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (record.endsWith("\r")) record = record.slice(0, -1);
      if (record.length > 0) records.push(record);
      newline = this.#buffer.indexOf("\n");
    }
    if (this.#buffer.length > this.maximumRecordChars) this.#tooLarge(this.#buffer.length);
    return records;
  }

  #tooLarge(size: number): never {
    this.#buffer = "";
    throw new JsonlRecordTooLargeError(size, this.maximumRecordChars);
  }
}
