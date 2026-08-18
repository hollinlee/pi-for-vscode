import type { ChatState } from "./chat/chat-reducer.js";
import type { SessionSummary } from "./session/session-store.js";
import { isRecord } from "./utils/is-record.js";

export type ConnectionPhase = "disconnected" | "starting" | "ready" | "error" | "untrusted";

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  executable?: string;
  version?: string;
  cwd?: string;
  pid?: number;
  message?: string;
}

export interface SessionSnapshot {
  cwd?: string;
  activeId?: string;
  activePath?: string;
  sessions: SessionSummary[];
}

export interface ModelSummary {
  provider: string;
  id: string;
  name: string;
}

export interface ControlsSnapshot {
  model?: ModelSummary;
  models: ModelSummary[];
  thinkingLevel: string;
  thinkingLevels: string[];
}

export interface ExtensionDialogRequest {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

export type ExtensionUiEvent =
  | { type: "dialog"; request: ExtensionDialogRequest }
  | { type: "dismiss"; id: string }
  | { type: "notify"; id: string; message: string; level: "info" | "warning" | "error" }
  | { type: "status"; key: string; text?: string }
  | { type: "widget"; key: string; lines?: string[]; placement: "aboveEditor" | "belowEditor" }
  | { type: "title"; title: string }
  | { type: "editorText"; text: string }
  | { type: "unsupported"; id: string; method: string };

export type ExtensionUiResponse =
  | { kind: "value"; value: string }
  | { kind: "confirmed"; confirmed: boolean }
  | { kind: "cancelled" };

export type HostMessage =
  | { type: "connection"; value: ConnectionSnapshot }
  | { type: "chat"; value: ChatState }
  | { type: "session"; value: SessionSnapshot }
  | { type: "controls"; value: ControlsSnapshot }
  | { type: "extensionUi"; value: ExtensionUiEvent };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "reconnect" }
  | { type: "openSettings" }
  | { type: "newSession" }
  | { type: "refreshSessions" }
  | { type: "switchSession"; path: string }
  | { type: "setModel"; provider: string; modelId: string }
  | { type: "setThinkingLevel"; level: string }
  | { type: "extensionUiResponse"; id: string; response: ExtensionUiResponse }
  | { type: "prompt"; text: string }
  | { type: "abort" };

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "ready":
    case "reconnect":
    case "openSettings":
    case "abort":
    case "newSession":
    case "refreshSessions":
      return hasOnlyKeys(value, ["type"]);
    case "switchSession":
      return hasOnlyKeys(value, ["type", "path"]) && isBoundedString(value.path, 4096);
    case "setModel":
      return hasOnlyKeys(value, ["type", "provider", "modelId"])
        && isBoundedString(value.provider, 200)
        && isBoundedString(value.modelId, 500);
    case "setThinkingLevel":
      return hasOnlyKeys(value, ["type", "level"]) && isBoundedString(value.level, 50);
    case "extensionUiResponse":
      return hasOnlyKeys(value, ["type", "id", "response"])
        && isBoundedString(value.id, 200)
        && isExtensionUiResponse(value.response);
    case "prompt":
      return hasOnlyKeys(value, ["type", "text"])
        && typeof value.text === "string"
        && value.text.trim().length > 0
        && value.text.length <= 100_000;
    default:
      return false;
  }
}

function isExtensionUiResponse(value: unknown): value is ExtensionUiResponse {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "cancelled") return hasOnlyKeys(value, ["kind"]);
  if (value.kind === "value") {
    return hasOnlyKeys(value, ["kind", "value"]) && typeof value.value === "string" && value.value.length <= 100_000;
  }
  if (value.kind === "confirmed") {
    return hasOnlyKeys(value, ["kind", "confirmed"]) && typeof value.confirmed === "boolean";
  }
  return false;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
