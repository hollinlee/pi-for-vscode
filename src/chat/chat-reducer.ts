export type ChatPhase = "idle" | "streaming" | "aborting" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  toolIds: string[];
}

export interface ToolCallView {
  id: string;
  name: string;
  status: "running" | "success" | "error";
  args: unknown;
  output?: string;
}

export interface ChatState {
  phase: ChatPhase;
  messages: ChatMessage[];
  tools: Record<string, ToolCallView>;
  error?: string;
}

export type ChatEvent =
  | { type: "reset" }
  | { type: "hydrate"; state: ChatState }
  | { type: "status"; phase: ChatPhase }
  | { type: "user"; id: string; text: string }
  | { type: "assistant_start"; id: string }
  | { type: "text_delta"; id: string; delta: string }
  | { type: "thinking_delta"; id: string; delta: string }
  | { type: "assistant_end"; id: string }
  | { type: "tool_start"; messageId: string; tool: ToolCallView }
  | { type: "tool_update"; id: string; output: string }
  | { type: "tool_end"; id: string; output?: string; isError: boolean }
  | { type: "error"; message: string };

export const initialChatState: ChatState = {
  phase: "idle",
  messages: [],
  tools: {},
};

export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "reset":
      return initialChatState;
    case "hydrate":
      return event.state;
    case "status":
      return { ...state, phase: event.phase, error: event.phase === "error" ? state.error : undefined };
    case "user":
      return {
        ...state,
        error: undefined,
        messages: [...state.messages, { id: event.id, role: "user", text: event.text, thinking: "", toolIds: [] }],
      };
    case "assistant_start":
      if (state.messages.some((message) => message.id === event.id)) return state;
      return {
        ...state,
        messages: [...state.messages, { id: event.id, role: "assistant", text: "", thinking: "", toolIds: [] }],
      };
    case "text_delta":
      return updateMessage(state, event.id, (message) => ({ ...message, text: message.text + event.delta }));
    case "thinking_delta":
      return updateMessage(state, event.id, (message) => ({ ...message, thinking: message.thinking + event.delta }));
    case "assistant_end":
      return state;
    case "tool_start":
      return {
        ...updateMessage(state, event.messageId, (message) => ({
          ...message,
          toolIds: message.toolIds.includes(event.tool.id) ? message.toolIds : [...message.toolIds, event.tool.id],
        })),
        tools: { ...state.tools, [event.tool.id]: event.tool },
      };
    case "tool_update":
      return updateTool(state, event.id, (tool) => ({ ...tool, output: event.output }));
    case "tool_end":
      return updateTool(state, event.id, (tool) => ({
        ...tool,
        status: event.isError ? "error" : "success",
        output: event.output ?? tool.output,
      }));
    case "error":
      return { ...state, phase: "error", error: event.message };
  }
}

function updateMessage(state: ChatState, id: string, update: (message: ChatMessage) => ChatMessage): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) => message.id === id ? update(message) : message),
  };
}

function updateTool(state: ChatState, id: string, update: (tool: ToolCallView) => ToolCallView): ChatState {
  const tool = state.tools[id];
  if (!tool) return state;
  return { ...state, tools: { ...state.tools, [id]: update(tool) } };
}
