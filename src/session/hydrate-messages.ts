import type { ChatMessage, ChatState, ToolCallView } from "../chat/chat-reducer.js";

export function hydrateAgentMessages(value: unknown): ChatState {
  if (!Array.isArray(value)) return { phase: "idle", messages: [], tools: {} };
  const messages: ChatMessage[] = [];
  const tools: Record<string, ToolCallView> = {};
  const toolOwners = new Map<string, string>();
  let sequence = 0;

  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.role !== "string") continue;
    if (raw.role === "user") {
      messages.push({
        id: `history-user-${++sequence}`,
        role: "user",
        text: extractText(raw.content),
        thinking: "",
        toolIds: [],
      });
      continue;
    }
    if (raw.role === "assistant") {
      const id = `history-assistant-${++sequence}`;
      const message: ChatMessage = { id, role: "assistant", text: "", thinking: "", toolIds: [] };
      if (Array.isArray(raw.content)) {
        for (const block of raw.content) {
          if (!isRecord(block)) continue;
          if (block.type === "text" && typeof block.text === "string") message.text += block.text;
          if (block.type === "thinking" && typeof block.thinking === "string") message.thinking += block.thinking;
          if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
            message.toolIds.push(block.id);
            toolOwners.set(block.id, id);
            tools[block.id] = {
              id: block.id,
              name: block.name,
              args: block.arguments,
              status: "running",
            };
          }
        }
      }
      messages.push(message);
      continue;
    }
    if (raw.role === "toolResult" && typeof raw.toolCallId === "string") {
      const existing = tools[raw.toolCallId];
      const owner = toolOwners.get(raw.toolCallId);
      if (!existing || !owner) continue;
      tools[raw.toolCallId] = {
        ...existing,
        status: raw.isError === true ? "error" : "success",
        output: extractText(raw.content),
      };
    }
  }

  return { phase: "idle", messages, tools };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .map((block) => block.type === "text" && typeof block.text === "string" ? block.text : "")
    .filter(Boolean)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
