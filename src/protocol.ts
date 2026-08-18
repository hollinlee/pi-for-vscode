import type { ChatState } from "./chat/chat-reducer.js";

export type ConnectionPhase =
  | "disconnected"
  | "starting"
  | "ready"
  | "error"
  | "untrusted";

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  executable?: string;
  version?: string;
  cwd?: string;
  pid?: number;
  message?: string;
}

export type HostMessage =
  | { type: "connection"; value: ConnectionSnapshot }
  | { type: "chat"; value: ChatState };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "reconnect" }
  | { type: "openSettings" }
  | { type: "prompt"; text: string }
  | { type: "abort" };

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "ready":
    case "reconnect":
    case "openSettings":
    case "abort":
      return hasOnlyKeys(value, ["type"]);
    case "prompt":
      return hasOnlyKeys(value, ["type", "text"])
        && typeof value.text === "string"
        && value.text.trim().length > 0
        && value.text.length <= 100_000;
    default:
      return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
