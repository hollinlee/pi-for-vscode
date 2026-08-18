import { describe, expect, it } from "vitest";
import { IncompleteJsonlRecordError, JsonlDecoder } from "../../src/rpc/jsonl-decoder.js";

describe("JsonlDecoder", () => {
  it("splits only on LF and strips a trailing CR", () => {
    const decoder = new JsonlDecoder();
    expect(decoder.push(Buffer.from('{"a":1}\r\n{"b":'))).toEqual(['{"a":1}']);
    expect(decoder.push(Buffer.from('2}\n'))).toEqual(['{"b":2}']);
    expect(decoder.end()).toEqual([]);
  });

  it("preserves Unicode separators inside a JSON record", () => {
    const decoder = new JsonlDecoder();
    const value = '{"text":"a\u2028b\u2029c"}\n';
    expect(decoder.push(Buffer.from(value))).toEqual(['{"text":"a\u2028b\u2029c"}']);
  });

  it("decodes UTF-8 characters split across chunks", () => {
    const bytes = Buffer.from('{"text":"你好"}\n');
    const split = bytes.indexOf(Buffer.from("你")) + 1;
    const decoder = new JsonlDecoder();
    expect(decoder.push(bytes.subarray(0, split))).toEqual([]);
    expect(decoder.push(bytes.subarray(split))).toEqual(['{"text":"你好"}']);
  });

  it("rejects an incomplete final record with its buffered fragment", () => {
    const decoder = new JsonlDecoder();
    decoder.push(Buffer.from('{"a":1}'));

    let thrown: unknown;
    try {
      decoder.end();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IncompleteJsonlRecordError);
    expect((thrown as IncompleteJsonlRecordError).record).toBe('{"a":1}');
  });
});
