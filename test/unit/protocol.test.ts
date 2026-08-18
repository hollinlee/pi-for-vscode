import { describe, expect, it } from "vitest";
import { isWebviewMessage } from "../../src/protocol.js";

const LONG_PROMPT = "a".repeat(100_001);

describe("isWebviewMessage", () => {
  it.each([
    { type: "ready" },
    { type: "reconnect" },
    { type: "openSettings" },
    { type: "newSession" },
    { type: "refreshSessions" },
    { type: "switchSession", path: "/tmp/session.jsonl" },
    { type: "abort" },
    { type: "prompt", text: "hello" },
  ])("accepts valid message $type", (message) => {
    expect(isWebviewMessage(message)).toBe(true);
  });

  it.each([
    null,
    {},
    { type: "prompt", text: "" },
    { type: "prompt", text: 4 },
    { type: "prompt", text: LONG_PROMPT },
    { type: "prompt", text: "hello", extra: true },
    { type: "switchSession", path: "" },
    { type: "switchSession", path: "/tmp/session.jsonl", extra: true },
    { type: "abort", extra: true },
    { type: "unknown" },
  ])("rejects malformed message", (message) => {
    expect(isWebviewMessage(message)).toBe(false);
  });
});
