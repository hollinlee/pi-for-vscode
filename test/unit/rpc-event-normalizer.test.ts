import { describe, expect, it } from "vitest";
import { RpcEventNormalizer } from "../../src/chat/rpc-event-normalizer.js";

describe("RpcEventNormalizer", () => {
  it("normalizes assistant deltas and lifecycle", () => {
    const normalizer = new RpcEventNormalizer();
    expect(normalizer.normalize({ type: "agent_start" })).toEqual([{ type: "status", phase: "streaming" }]);
    expect(normalizer.normalize({ type: "message_start", message: { role: "assistant" } })).toEqual([
      { type: "assistant_start", id: "assistant-1" },
    ]);
    expect(normalizer.normalize({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    })).toEqual([{ type: "text_delta", id: "assistant-1", delta: "hello" }]);
    expect(normalizer.normalize({ type: "agent_settled" })).toEqual([{ type: "status", phase: "idle" }]);
  });

  it("creates an assistant before an out-of-order delta", () => {
    const normalizer = new RpcEventNormalizer();
    expect(normalizer.normalize({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    })).toEqual([
      { type: "assistant_start", id: "assistant-1" },
      { type: "thinking_delta", id: "assistant-1", delta: "hmm" },
    ]);
  });

  it("normalizes tool lifecycle and text results", () => {
    const normalizer = new RpcEventNormalizer();
    expect(normalizer.normalize({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "a" } })).toEqual([
      { type: "assistant_start", id: "assistant-1" },
      {
        type: "tool_start",
        messageId: "assistant-1",
        tool: { id: "t1", name: "read", status: "running", args: { path: "a" } },
      },
    ]);
    expect(normalizer.normalize({
      type: "tool_execution_update",
      toolCallId: "t1",
      partialResult: { content: [{ type: "text", text: "partial" }] },
    })).toEqual([{ type: "tool_update", id: "t1", output: "partial" }]);
    expect(normalizer.normalize({
      type: "tool_execution_end",
      toolCallId: "t1",
      result: { content: [{ type: "text", text: "done" }] },
      isError: false,
    })).toEqual([{ type: "tool_end", id: "t1", output: "done", isError: false }]);
  });

  it("ignores malformed and unrelated events", () => {
    const normalizer = new RpcEventNormalizer();
    expect(normalizer.normalize(null)).toEqual([]);
    expect(normalizer.normalize({ type: "tool_execution_start", toolName: 4 })).toEqual([]);
    expect(normalizer.normalize({ type: "queue_update" })).toEqual([]);
  });
});
