import { describe, expect, it } from "vitest";
import { isSafeExternalUrl, isWebviewMessage } from "../../src/protocol.js";

const LONG_PROMPT = "a".repeat(100_001);

describe("isWebviewMessage", () => {
  it.each([
    { type: "ready" },
    { type: "reconnect" },
    { type: "openSettings" },
    { type: "newSession" },
    { type: "refreshSessions" },
    { type: "switchSession", path: "/tmp/session.jsonl" },
    { type: "setModel", provider: "fixture", modelId: "model-a" },
    { type: "setThinkingLevel", level: "high" },
    { type: "extensionUiResponse", id: "dialog", response: { kind: "cancelled" } },
    { type: "extensionUiResponse", id: "dialog", response: { kind: "value", value: "A" } },
    { type: "extensionUiResponse", id: "dialog", response: { kind: "confirmed", confirmed: true } },
    { type: "openExternal", url: "https://example.com/path?q=1" },
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
    { type: "setModel", provider: "", modelId: "model-a" },
    { type: "setThinkingLevel", level: "" },
    { type: "extensionUiResponse", id: "dialog", response: { kind: "value", value: "A", extra: true } },
    { type: "extensionUiResponse", id: "dialog", response: { kind: "confirmed", confirmed: "yes" } },
    { type: "extensionUiResponse", id: "dialog", response: { kind: "unknown" } },
    { type: "openExternal", url: "javascript:alert(1)" },
    { type: "openExternal", url: "https://user:pass@example.com" },
    { type: "openExternal", url: "/relative" },
    { type: "abort", extra: true },
    { type: "unknown" },
  ])("rejects malformed message", (message) => {
    expect(isWebviewMessage(message)).toBe(false);
  });
});

describe("isSafeExternalUrl", () => {
  it("allows only credential-free HTTP(S) URLs", () => {
    expect(isSafeExternalUrl("https://example.com/docs")).toBe(true);
    expect(isSafeExternalUrl("http://localhost:3000")).toBe(true);
    expect(isSafeExternalUrl("command:workbench.action.openSettings")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,hello")).toBe(false);
  });
});
