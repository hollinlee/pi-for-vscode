import type { ChatEvent, ToolCallView } from "./chat-reducer.js";

export class RpcEventNormalizer {
  #assistantSequence = 0;
  #currentAssistantId: string | undefined;

  reset(): void {
    this.#assistantSequence = 0;
    this.#currentAssistantId = undefined;
  }

  normalize(value: unknown): ChatEvent[] {
    if (!isRecord(value) || typeof value.type !== "string") return [];
    switch (value.type) {
      case "agent_start":
        return [{ type: "status", phase: "streaming" }];
      case "agent_settled":
        this.#currentAssistantId = undefined;
        return [{ type: "status", phase: "idle" }];
      case "message_start":
        return this.#startMessage(value.message);
      case "message_update":
        return this.#updateMessage(value.assistantMessageEvent);
      case "message_end":
        return this.#endMessage(value.message);
      case "tool_execution_start":
        return this.#startTool(value);
      case "tool_execution_update":
        return typeof value.toolCallId === "string"
          ? [{ type: "tool_update", id: value.toolCallId, output: extractResultText(value.partialResult) }]
          : [];
      case "tool_execution_end":
        return typeof value.toolCallId === "string"
          ? [{
              type: "tool_end",
              id: value.toolCallId,
              output: extractResultText(value.result),
              isError: value.isError === true,
            }]
          : [];
      case "extension_error":
        return [{ type: "error", message: typeof value.error === "string" ? value.error : "Pi extension error" }];
      default:
        return [];
    }
  }

  #startMessage(message: unknown): ChatEvent[] {
    if (!isRecord(message) || message.role !== "assistant") return [];
    const id = `assistant-${++this.#assistantSequence}`;
    this.#currentAssistantId = id;
    return [{ type: "assistant_start", id }];
  }

  #updateMessage(update: unknown): ChatEvent[] {
    if (!isRecord(update) || typeof update.type !== "string") return [];
    const { id, start } = this.#ensureAssistant();
    if (update.type === "text_delta" && typeof update.delta === "string") {
      return [...start, { type: "text_delta", id, delta: update.delta }];
    }
    if (update.type === "thinking_delta" && typeof update.delta === "string") {
      return [...start, { type: "thinking_delta", id, delta: update.delta }];
    }
    return [];
  }

  #endMessage(message: unknown): ChatEvent[] {
    if (!isRecord(message) || message.role !== "assistant" || !this.#currentAssistantId) return [];
    return [{ type: "assistant_end", id: this.#currentAssistantId }];
  }

  #startTool(event: Record<string, unknown>): ChatEvent[] {
    if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") return [];
    const { id: messageId, start } = this.#ensureAssistant();
    const tool: ToolCallView = {
      id: event.toolCallId,
      name: event.toolName,
      status: "running",
      args: event.args,
    };
    return [...start, { type: "tool_start", messageId, tool }];
  }

  #ensureAssistant(): { id: string; start: ChatEvent[] } {
    if (this.#currentAssistantId) return { id: this.#currentAssistantId, start: [] };
    this.#currentAssistantId = `assistant-${++this.#assistantSequence}`;
    return {
      id: this.#currentAssistantId,
      start: [{ type: "assistant_start", id: this.#currentAssistantId }],
    };
  }
}

function extractResultText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) return "";
  return value.content
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => typeof item.text === "string" ? item.text : "")
    .filter(Boolean)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
