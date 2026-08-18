import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Brain,
  CheckCircle2,
  CircleX,
  Folder,
  LoaderCircle,
  RefreshCw,
  Send,
  Settings,
  Square,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { initialChatState, type ChatMessage, type ChatState, type ToolCallView } from "../chat/chat-reducer.js";
import type { ConnectionSnapshot, HostMessage, WebviewMessage } from "../protocol.js";
import "./styles.css";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const initialConnection: ConnectionSnapshot = { phase: "disconnected" };

function App(): React.JSX.Element {
  const [connection, setConnection] = React.useState(initialConnection);
  const [chat, setChat] = React.useState<ChatState>(initialChatState);
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.data?.type === "connection") setConnection(event.data.value);
      if (event.data?.type === "chat") setChat(event.data.value);
    };
    window.addEventListener("message", receive);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", receive);
  }, []);

  const connected = connection.phase === "ready";
  const running = chat.phase === "streaming" || chat.phase === "aborting";
  const submit = () => {
    if (!connected || running || !draft.trim()) return;
    vscode.postMessage({ type: "prompt", text: draft });
    setDraft("");
  };

  return (
    <main className={`shell ${connected ? "chat-shell" : ""}`}>
      <Toolbar connection={connection} />
      {connected ? (
        <>
          <MessageStream chat={chat} />
          <Composer
            value={draft}
            running={running}
            aborting={chat.phase === "aborting"}
            onChange={setDraft}
            onSubmit={submit}
            onAbort={() => vscode.postMessage({ type: "abort" })}
          />
        </>
      ) : (
        <ConnectionPanel connection={connection} />
      )}
    </main>
  );
}

function Toolbar({ connection }: { connection: ConnectionSnapshot }): React.JSX.Element {
  const busy = connection.phase === "starting";
  return (
    <header className="toolbar">
      <div className="identity">
        <span className={`toolbar-dot status-${connection.phase}`} aria-hidden="true" />
        <strong>PI</strong>
        <span>{connection.phase === "ready" ? "RPC READY" : "RPC"}</span>
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
  );
}

function MessageStream({ chat }: { chat: ChatState }): React.JSX.Element {
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [chat]);

  return (
    <section className="message-stream" aria-live="polite" aria-busy={chat.phase === "streaming"}>
      {chat.messages.length === 0 ? (
        <div className="empty-state">
          <TerminalSquare size={20} aria-hidden="true" />
          <span>RPC ready</span>
        </div>
      ) : chat.messages.map((message) => (
        <MessageView key={message.id} message={message} tools={chat.tools} />
      ))}
      {chat.error && <div className="chat-error" role="alert">{chat.error}</div>}
      {chat.phase === "streaming" && <div className="working"><LoaderCircle size={13} className="spin" /> Working</div>}
      <div ref={end} />
    </section>
  );
}

function MessageView({ message, tools }: { message: ChatMessage; tools: ChatState["tools"] }): React.JSX.Element {
  if (message.role === "user") {
    return <article className="message user-message"><div className="plain-text">{message.text}</div></article>;
  }
  return (
    <article className="message assistant-message">
      {message.thinking && (
        <details className="thinking-row">
          <summary><Brain size={13} /> Thinking</summary>
          <div className="thinking-text">{message.thinking}</div>
        </details>
      )}
      {message.text && (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        </div>
      )}
      {message.toolIds.map((id) => tools[id] && <ToolRow key={id} tool={tools[id]} />)}
    </article>
  );
}

function ToolRow({ tool }: { tool: ToolCallView }): React.JSX.Element {
  const Icon = tool.status === "running" ? LoaderCircle : tool.status === "success" ? CheckCircle2 : CircleX;
  return (
    <details className={`tool-row tool-${tool.status}`}>
      <summary>
        <Icon size={13} className={tool.status === "running" ? "spin" : ""} />
        <Wrench size={12} />
        <span>{tool.name}</span>
        <span className="tool-status">{tool.status}</span>
      </summary>
      <div className="tool-detail">
        <div className="tool-heading">Arguments</div>
        <pre>{formatValue(tool.args)}</pre>
        {tool.output && <><div className="tool-heading">Result</div><pre>{tool.output}</pre></>}
      </div>
    </details>
  );
}

function Composer(props: {
  value: string;
  running: boolean;
  aborting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
}): React.JSX.Element {
  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
      <textarea
        aria-label="Message Pi"
        placeholder="Message Pi"
        value={props.value}
        disabled={props.running}
        rows={3}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            props.onSubmit();
          }
        }}
      />
      {props.running ? (
        <button className="send-button stop-button" type="button" onClick={props.onAbort} disabled={props.aborting} title="Stop" aria-label="Stop">
          <Square size={14} fill="currentColor" />
        </button>
      ) : (
        <button className="send-button" type="submit" disabled={!props.value.trim()} title="Send" aria-label="Send">
          <Send size={15} />
        </button>
      )}
    </form>
  );
}

function ConnectionPanel({ connection }: { connection: ConnectionSnapshot }): React.JSX.Element {
  return (
    <section className="connection" aria-live="polite">
      <div className={`status-mark status-${connection.phase}`}>
        <span className="status-dot" />
        <div>
          <div className="status-label">{labelFor(connection.phase)}</div>
          <div className="status-message">{messageFor(connection)}</div>
        </div>
      </div>
      <div className="details" role="list" aria-label="Connection details">
        <Detail icon={<TerminalSquare size={14} />} label="Executable" value={connection.executable} />
        <Detail icon={<Activity size={14} />} label="Version" value={connection.version} />
        <Detail icon={<Folder size={14} />} label="Workspace" value={connection.cwd} />
      </div>
    </section>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }): React.JSX.Element {
  return <div className="detail-row" role="listitem"><div className="detail-label">{icon}<span>{label}</span></div><div className="detail-value" title={value}>{value ?? "—"}</div></div>;
}

function labelFor(phase: ConnectionSnapshot["phase"]): string {
  return { disconnected: "Disconnected", starting: "Starting pi", ready: "RPC ready", error: "Connection error", untrusted: "Workspace untrusted" }[phase];
}

function messageFor(connection: ConnectionSnapshot): string {
  if (connection.message) return connection.message;
  if (connection.phase === "starting") return "Probing executable and opening RPC";
  return "No active pi process";
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); }
}

createRoot(document.getElementById("root")!).render(<App />);
