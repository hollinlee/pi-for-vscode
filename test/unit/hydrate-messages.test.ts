import { describe, expect, it } from "vitest";
import { hydrateAgentMessages } from "../../src/session/hydrate-messages.js";

describe("hydrateAgentMessages", () => {
  it("projects persisted user, assistant and tool messages into chat state", () => {
    const state = hydrateAgentMessages([
      { role: "user", content: "Inspect this" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Need a file" },
          { type: "text", text: "Reading." },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "contents" }],
        isError: false,
      },
    ]);

    expect(state.messages).toEqual([
      { id: "history-user-1", role: "user", text: "Inspect this", thinking: "", toolIds: [] },
      { id: "history-assistant-2", role: "assistant", text: "Reading.", thinking: "Need a file", toolIds: ["call-1"] },
    ]);
    expect(state.tools["call-1"]).toEqual({
      id: "call-1",
      name: "read",
      args: { path: "a.ts" },
      status: "success",
      output: "contents",
    });
  });

  it("ignores unsupported records and returns a stable empty state for malformed input", () => {
    expect(hydrateAgentMessages({ messages: [] })).toEqual({ phase: "idle", messages: [], tools: {} });
    expect(hydrateAgentMessages([{ role: "custom", content: "hidden" }])).toEqual({ phase: "idle", messages: [], tools: {} });
  });
});
