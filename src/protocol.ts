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
  | { type: "connection"; value: ConnectionSnapshot };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "reconnect" }
  | { type: "openSettings" };

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  return ["ready", "reconnect", "openSettings"].includes(String(value.type));
}
