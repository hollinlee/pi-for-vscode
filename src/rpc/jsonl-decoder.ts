import { StringDecoder } from "node:string_decoder";

export class IncompleteJsonlRecordError extends Error {
  constructor(readonly record: string) {
    super("RPC stream ended with an incomplete JSONL record");
  }
}

export class JsonlDecoder {
  readonly #decoder = new StringDecoder("utf8");
  #buffer = "";

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
      let record = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (record.endsWith("\r")) record = record.slice(0, -1);
      if (record.length > 0) records.push(record);
      newline = this.#buffer.indexOf("\n");
    }
    return records;
  }
}
