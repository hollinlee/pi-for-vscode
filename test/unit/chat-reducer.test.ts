import { describe, expect, it } from "vitest";
import { initialChatState, reduceChat, type ChatEvent } from "../../src/chat/chat-reducer.js";

describe("reduceChat", () => {
  it("assembles streaming text, thinking and tool lifecycle deterministically", () => {
    const events: ChatEvent[] = [
      { type: "user", id: "u1", text: "Inspect" },
      { type: "status", phase: "streaming" },
      { type: "assistant_start", id: "a1" },
      { type: "thinking_delta", id: "a1", delta: "Check " },
      { type: "thinking_delta", id: "a1", delta: "files" },
      { type: "text_delta", id: "a1", delta: "Found " },
      { type: "text_delta", id: "a1", delta: "it." },
      {
        type: "tool_start",
        messageId: "a1",
        tool: { id: "t1", name: "read", status: "running", args: { path: "a.ts" } },
      },
      { type: "tool_update", id: "t1", output: "partial" },
      { type: "tool_end", id: "t1", output: "complete", isError: false },
      { type: "assistant_end", id: "a1" },
      { type: "status", phase: "idle" },
    ];

    const state = events.reduce(reduceChat, initialChatState);
    expect(state.phase).toBe("idle");
    expect(state.messages).toEqual([
      { id: "u1", role: "user", text: "Inspect", thinking: "", toolIds: [] },
      { id: "a1", role: "assistant", text: "Found it.", thinking: "Check files", toolIds: ["t1"] },
    ]);
    expect(state.tools.t1).toMatchObject({ status: "success", output: "complete" });
  });

  it("does not duplicate assistant messages or tool ids", () => {
    let state = reduceChat(initialChatState, { type: "assistant_start", id: "a1" });
    state = reduceChat(state, { type: "assistant_start", id: "a1" });
    const tool = { id: "t1", name: "bash", status: "running" as const, args: {} };
    state = reduceChat(state, { type: "tool_start", messageId: "a1", tool });
    state = reduceChat(state, { type: "tool_start", messageId: "a1", tool });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.toolIds).toEqual(["t1"]);
  });

  it("retains messages while surfacing errors and resets authoritatively", () => {
    let state = reduceChat(initialChatState, { type: "user", id: "u1", text: "hello" });
    state = reduceChat(state, { type: "error", message: "failed" });
    expect(state).toMatchObject({ phase: "error", error: "failed" });
    expect(state.messages).toHaveLength(1);
    expect(reduceChat(state, { type: "reset" })).toEqual(initialChatState);
  });
});
