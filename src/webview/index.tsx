import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, Folder, RefreshCw, Settings, TerminalSquare } from "lucide-react";
import type { ConnectionSnapshot, HostMessage, WebviewMessage } from "../protocol.js";
import "./styles.css";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();

const initial: ConnectionSnapshot = { phase: "disconnected" };

function App(): React.JSX.Element {
  const [connection, setConnection] = React.useState(initial);

  React.useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.data?.type === "connection") setConnection(event.data.value);
    };
    window.addEventListener("message", receive);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", receive);
  }, []);

  const busy = connection.phase === "starting";
  return (
    <main className="shell">
      <header className="toolbar">
        <div className="identity">
          <TerminalSquare size={16} aria-hidden="true" />
          <strong>PI</strong>
          <span>RPC</span>
        </div>
        <div className="actions">
          <button
            className="icon-button"
            title="Refresh connection"
            aria-label="Refresh connection"
            disabled={busy}
            onClick={() => vscode.postMessage({ type: "reconnect" })}
          >
            <RefreshCw size={15} className={busy ? "spin" : ""} />
          </button>
          <button
            className="icon-button"
            title="Open Pi settings"
            aria-label="Open Pi settings"
            onClick={() => vscode.postMessage({ type: "openSettings" })}
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      <section className="connection" aria-live="polite">
        <div className={`status-mark status-${connection.phase}`}>
          <span className="status-dot" />
          <div>
            <div className="status-label">{labelFor(connection.phase)}</div>
            <div className="status-message">{messageFor(connection)}</div>
          </div>
        </div>

        <dl className="details">
          <Detail icon={<TerminalSquare size={14} />} label="Executable" value={connection.executable} />
          <Detail icon={<Activity size={14} />} label="Version" value={connection.version} />
          <Detail icon={<Folder size={14} />} label="Workspace" value={connection.cwd} />
        </dl>
      </section>
    </main>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }): React.JSX.Element {
  return (
    <div className="detail-row">
      <dt>{icon}<span>{label}</span></dt>
      <dd title={value}>{value ?? "—"}</dd>
    </div>
  );
}

function labelFor(phase: ConnectionSnapshot["phase"]): string {
  return {
    disconnected: "Disconnected",
    starting: "Starting pi",
    ready: "RPC ready",
    error: "Connection error",
    untrusted: "Workspace untrusted",
  }[phase];
}

function messageFor(connection: ConnectionSnapshot): string {
  if (connection.message) return connection.message;
  if (connection.phase === "ready") return connection.pid ? `Process ${connection.pid}` : "Connected";
  if (connection.phase === "starting") return "Probing executable and opening RPC";
  return "No active pi process";
}

createRoot(document.getElementById("root")!).render(<App />);
