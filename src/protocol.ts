import type { ChatState } from "./chat/chat-reducer.js";
import type { SessionSummary } from "./session/session-store.js";
import { isRecord } from "./utils/is-record.js";

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

export interface SessionSnapshot {
  cwd?: string;
  activeId?: string;
  activePath?: string;
  sessions: SessionSummary[];
}

export type HostMessage =
  | { type: "connection"; value: ConnectionSnapshot }
  | { type: "chat"; value: ChatState }
  | { type: "session"; value: SessionSnapshot };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "reconnect" }
  | { type: "openSettings" }
  | { type: "newSession" }
  | { type: "refreshSessions" }
  | { type: "switchSession"; path: string }
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
      return hasOnlyKeys(value, ["type", "path"])
        && typeof value.path === "string"
        && value.path.length > 0
        && value.path.length <= 4096;
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
