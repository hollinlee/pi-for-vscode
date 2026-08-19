import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Brain,
  CheckCircle2,
  CircleX,
  Folder,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Square,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { initialChatState, type ChatMessage, type ChatState, type ToolCallView } from "../chat/chat-reducer.js";
import type {
  ConnectionSnapshot,
  ControlsSnapshot,
  ExtensionDialogRequest,
  ExtensionUiResponse,
  HostMessage,
  SessionSnapshot,
  SlashCommandSummary,
  WebviewMessage,
} from "../protocol.js";
import { isSafeExternalUrl } from "../protocol.js";
import {
  dismissExtensionNotification,
  initialExtensionUiState,
  notificationTimeout,
  reduceExtensionUi,
} from "./extension-ui-reducer.js";
import { completeSlashCommand, filterSlashCommands } from "./slash-commands.js";
import "./styles.css";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const initialConnection: ConnectionSnapshot = { phase: "disconnected" };
const initialSession: SessionSnapshot = { sessions: [] };
const initialControls: ControlsSnapshot = { models: [], thinkingLevel: "off", thinkingLevels: ["off"], commands: [] };

function App(): React.JSX.Element {
  const [connection, setConnection] = React.useState(initialConnection);
  const [chat, setChat] = React.useState<ChatState>(initialChatState);
  const [session, setSession] = React.useState<SessionSnapshot>(initialSession);
  const [controls, setControls] = React.useState<ControlsSnapshot>(initialControls);
  const [extensionUi, setExtensionUi] = React.useState(initialExtensionUiState);
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    const receive = (event: MessageEvent<HostMessage>) => {
      if (event.data?.type === "connection") setConnection(event.data.value);
      if (event.data?.type === "chat") setChat(event.data.value);
      if (event.data?.type === "session") setSession(event.data.value);
      if (event.data?.type === "controls") setControls(event.data.value);
      if (event.data?.type === "extensionUi") {
        const value = event.data.value;
        setExtensionUi((state) => reduceExtensionUi(state, value));
        if (value.type === "editorText") setDraft(value.text);
        if (value.type === "title") document.title = value.title;
      }
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
  const dismissNotification = React.useCallback((id: string) => {
    setExtensionUi((state) => dismissExtensionNotification(state, id));
  }, []);

  return (
    <main className={`shell ${connected ? "chat-shell" : ""}`}>
      <Toolbar connection={connection} />
      {connected ? (
        <>
          <SessionBar session={session} disabled={running} />
          <MessageStream chat={chat} />
          <div className="bottom-area">
            <ExtensionWidgets widgets={extensionUi.widgets} placement="aboveEditor" />
            <ExtensionStatuses statuses={extensionUi.statuses} />
            <WorkspaceContext cwd={connection.cwd} />
            <Composer
              value={draft}
              commands={controls.commands}
              running={running}
              aborting={chat.phase === "aborting"}
              onChange={setDraft}
              onSubmit={submit}
              onAbort={() => vscode.postMessage({ type: "abort" })}
            />
            <ControlsBar controls={controls} disabled={running} />
            <ExtensionWidgets widgets={extensionUi.widgets} placement="belowEditor" />
          </div>
          <NotificationStack notifications={extensionUi.notifications} onDismiss={dismissNotification} />
          {extensionUi.dialogs[0] && <ExtensionDialog key={extensionUi.dialogs[0].id} request={extensionUi.dialogs[0]} />}
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
        <button className="icon-button" title="Refresh connection" aria-label="Refresh connection" disabled={busy} onClick={() => vscode.postMessage({ type: "reconnect" })}>
          <RefreshCw size={15} className={busy ? "spin" : ""} />
        </button>
        <button className="icon-button" title="Open Pi settings" aria-label="Open Pi settings" onClick={() => vscode.postMessage({ type: "openSettings" })}>
          <Settings size={15} />
        </button>
      </div>
    </header>
  );
}

function SessionBar({ session, disabled }: { session: SessionSnapshot; disabled: boolean }): React.JSX.Element {
  const activeListed = session.activePath && session.sessions.some((item) => item.path === session.activePath);
  return (
    <div className="session-bar">
      <select aria-label="Active Pi session" value={session.activePath ?? ""} disabled={disabled} onChange={(event) => event.target.value && vscode.postMessage({ type: "switchSession", path: event.target.value })}>
        {!session.activePath && <option value="">New session</option>}
        {session.activePath && !activeListed && <option value={session.activePath}>Current session</option>}
        {session.sessions.map((item) => <option key={item.path} value={item.path}>{item.name ?? item.firstMessage}</option>)}
      </select>
      <button className="icon-button" title="Refresh sessions" aria-label="Refresh sessions" disabled={disabled} onClick={() => vscode.postMessage({ type: "refreshSessions" })}><RefreshCw size={14} /></button>
      <button className="icon-button" title="New session" aria-label="New session" disabled={disabled} onClick={() => vscode.postMessage({ type: "newSession" })}><Plus size={15} /></button>
    </div>
  );
}

function WorkspaceContext({ cwd }: { cwd?: string }): React.JSX.Element {
  return (
    <div className="workspace-context" title={cwd ?? "Workspace unavailable"}>
      <Folder size={13} aria-hidden="true" />
      <span className="context-label">CWD</span>
      <span className="context-value">{cwd ?? "Unavailable"}</span>
    </div>
  );
}

function ControlsBar({ controls, disabled }: { controls: ControlsSnapshot; disabled: boolean }): React.JSX.Element {
  const modelValue = controls.model ? encodeModel(controls.model.provider, controls.model.id) : "";
  const modelListed = controls.model && controls.models.some((model) => model.provider === controls.model?.provider && model.id === controls.model.id);
  return (
    <div className="controls-bar">
      <div className="control-field">
        <label htmlFor="pi-model">Model</label>
        <select
          id="pi-model"
          aria-label="Pi model"
          value={modelValue}
          disabled={disabled || controls.models.length === 0}
          onChange={(event) => {
            const selected = controls.models.find((model) => encodeModel(model.provider, model.id) === event.target.value);
            if (selected) vscode.postMessage({ type: "setModel", provider: selected.provider, modelId: selected.id });
          }}
        >
          {!controls.model && <option value="">No model</option>}
          {controls.model && !modelListed && <option value={modelValue}>{controls.model.name}</option>}
          {controls.models.map((model) => <option key={encodeModel(model.provider, model.id)} value={encodeModel(model.provider, model.id)}>{model.provider} / {model.name}</option>)}
        </select>
      </div>
      <div className="control-field thinking-field">
        <label htmlFor="pi-thinking">Thinking</label>
        <select id="pi-thinking" aria-label="Pi thinking level" value={controls.thinkingLevel} disabled={disabled} onChange={(event) => vscode.postMessage({ type: "setThinkingLevel", level: event.target.value })}>
          {controls.thinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
      </div>
    </div>
  );
}

function MessageStream({ chat }: { chat: ChatState }): React.JSX.Element {
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat]);
  return (
    <section className="message-stream" aria-live="polite" aria-busy={chat.phase === "streaming"}>
      {chat.messages.length === 0 ? <div className="empty-state"><TerminalSquare size={20} aria-hidden="true" /><span>RPC ready</span></div> : chat.messages.map((message) => <MessageView key={message.id} message={message} tools={chat.tools} />)}
      {chat.error && <div className="chat-error" role="alert">{chat.error}</div>}
      {chat.phase === "streaming" && <div className="working"><LoaderCircle size={13} className="spin" /> Working</div>}
      <div ref={end} />
    </section>
  );
}

function MessageView({ message, tools }: { message: ChatMessage; tools: ChatState["tools"] }): React.JSX.Element {
  if (message.role === "user") return <article className="message user-message"><div className="plain-text">{message.text}</div></article>;
  return (
    <article className="message assistant-message">
      {message.thinking && <details className="thinking-row"><summary><Brain size={13} /> Thinking</summary><div className="thinking-text">{message.thinking}</div></details>}
      {message.text && (
        <div className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, node, ...props }) => {
                void node;
                return href && isSafeExternalUrl(href)
                  ? (
                    <a
                      {...props}
                      href={href}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        vscode.postMessage({ type: "openExternal", url: href });
                      }}
                    >
                      {children}
                    </a>
                  )
                  : <span {...props}>{children}</span>;
              },
            }}
          >
            {message.text}
          </ReactMarkdown>
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
      <summary><Icon size={13} className={tool.status === "running" ? "spin" : ""} /><Wrench size={12} /><span>{tool.name}</span><span className="tool-status">{tool.status}</span></summary>
      <div className="tool-detail"><div className="tool-heading">Arguments</div><pre>{formatValue(tool.args)}</pre>{tool.output && <><div className="tool-heading">Result</div><pre>{tool.output}</pre></>}</div>
    </details>
  );
}

function ExtensionDialog({ request }: { request: ExtensionDialogRequest }): React.JSX.Element {
  const [value, setValue] = React.useState(request.method === "editor" ? request.prefill ?? "" : request.options?.[0] ?? "");
  const respond = (response: ExtensionUiResponse) => vscode.postMessage({ type: "extensionUiResponse", id: request.id, response });
  React.useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage({ type: "extensionUiResponse", id: request.id, response: { kind: "cancelled" } });
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [request.id]);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="extension-dialog" role="dialog" aria-modal="true" aria-labelledby="extension-dialog-title">
        <h2 id="extension-dialog-title">{request.title}</h2>
        {request.message && <p>{request.message}</p>}
        {request.method === "select" && <select aria-label={request.title} value={value} onChange={(event) => setValue(event.target.value)}>{request.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>}
        {request.method === "input" && <input autoFocus value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} />}
        {request.method === "editor" && <textarea autoFocus rows={7} value={value} onChange={(event) => setValue(event.target.value)} />}
        <div className="dialog-actions">
          <button type="button" onClick={() => respond({ kind: "cancelled" })}>Cancel</button>
          {request.method === "confirm" ? (
            <><button type="button" onClick={() => respond({ kind: "confirmed", confirmed: false })}>No</button><button className="primary" type="button" autoFocus onClick={() => respond({ kind: "confirmed", confirmed: true })}>Yes</button></>
          ) : (
            <button className="primary" type="button" disabled={request.method === "select" && !value} onClick={() => respond({ kind: "value", value })}>Submit</button>
          )}
        </div>
      </section>
    </div>
  );
}

function NotificationStack({ notifications, onDismiss }: {
  notifications: typeof initialExtensionUiState.notifications;
  onDismiss: (id: string) => void;
}): React.JSX.Element | null {
  if (notifications.length === 0) return null;
  return (
    <div className="notification-stack" aria-live="polite">
      {notifications.map((item) => <ExtensionNotification key={item.id} notification={item} onDismiss={onDismiss} />)}
    </div>
  );
}

function ExtensionNotification({ notification, onDismiss }: {
  notification: typeof initialExtensionUiState.notifications[number];
  onDismiss: (id: string) => void;
}): React.JSX.Element {
  React.useEffect(() => {
    const timeout = notificationTimeout(notification.level);
    if (timeout === undefined) return;
    const timer = window.setTimeout(() => onDismiss(notification.id), timeout);
    return () => window.clearTimeout(timer);
  }, [notification.id, notification.level, notification.message, onDismiss]);

  return (
    <div className={`extension-notification notify-${notification.level}`} role={notification.level === "error" ? "alert" : "status"}>
      <span>{notification.message}</span>
      <button
        type="button"
        className="notification-dismiss"
        title="Dismiss notification"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(notification.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function ExtensionStatuses({ statuses }: { statuses: Record<string, string> }): React.JSX.Element | null {
  const entries = Object.entries(statuses);
  return entries.length === 0 ? null : <div className="extension-statuses">{entries.map(([key, text]) => <span key={key}>{text}</span>)}</div>;
}

function ExtensionWidgets({ widgets, placement }: { widgets: typeof initialExtensionUiState.widgets; placement: "aboveEditor" | "belowEditor" }): React.JSX.Element | null {
  const entries = Object.entries(widgets).filter(([, widget]) => widget.placement === placement);
  return entries.length === 0 ? null : <div className="extension-widgets">{entries.map(([key, widget]) => <div key={key}>{widget.lines.map((line, index) => <div key={index}>{line}</div>)}</div>)}</div>;
}

function Composer(props: {
  value: string;
  commands: SlashCommandSummary[];
  running: boolean;
  aborting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
}): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [dismissedDraft, setDismissedDraft] = React.useState<string>();
  const suggestions = dismissedDraft === props.value ? [] : filterSlashCommands(props.commands, props.value);
  React.useEffect(() => { setSelectedIndex(0); }, [props.value]);

  const complete = (command: SlashCommandSummary) => {
    props.onChange(completeSlashCommand(command));
    setDismissedDraft(undefined);
  };

  return (
    <form className="composer" onSubmit={(event) => {
      event.preventDefault();
      const selected = suggestions[selectedIndex];
      if (selected) complete(selected);
      else props.onSubmit();
    }}>
      {suggestions.length > 0 && (
        <div className="slash-menu" role="listbox" aria-label="Pi commands">
          {suggestions.map((command, index) => (
            <button
              key={`${command.source}:${command.name}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={index === selectedIndex ? "selected" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => complete(command)}
            >
              <span className="slash-name">/{command.name}</span>
              <span className="slash-source">{command.source}</span>
              {command.description && <span className="slash-description">{command.description}</span>}
            </button>
          ))}
        </div>
      )}
      <textarea
        aria-label="Message Pi"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        placeholder="Message Pi"
        value={props.value}
        disabled={props.running}
        rows={3}
        onChange={(event) => {
          setDismissedDraft(undefined);
          props.onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (suggestions.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) => (index + 1) % suggestions.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              const selected = suggestions[selectedIndex];
              if (selected) complete(selected);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissedDraft(props.value);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            const selected = suggestions[selectedIndex];
            if (selected) complete(selected);
            else props.onSubmit();
          }
        }}
      />
      {props.running ? <button className="send-button stop-button" type="button" onClick={props.onAbort} disabled={props.aborting} title="Stop" aria-label="Stop"><Square size={14} fill="currentColor" /></button> : <button className="send-button" type="submit" disabled={!props.value.trim()} title="Send" aria-label="Send"><Send size={15} /></button>}
    </form>
  );
}

function ConnectionPanel({ connection }: { connection: ConnectionSnapshot }): React.JSX.Element {
  return (
    <section className="connection" aria-live="polite">
      <div className={`status-mark status-${connection.phase}`}><span className="status-dot" /><div><div className="status-label">{labelFor(connection.phase)}</div><div className="status-message">{messageFor(connection)}</div></div></div>
      <div className="details" role="list" aria-label="Connection details"><Detail icon={<TerminalSquare size={14} />} label="Executable" value={connection.executable} /><Detail icon={<Activity size={14} />} label="Version" value={connection.version} /><Detail icon={<Folder size={14} />} label="Workspace" value={connection.cwd} /></div>
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
  if (connection.phase === "ready") return connection.pid ? `Process ${connection.pid}` : "Connected";
  if (connection.phase === "starting") return "Probing executable and opening RPC";
  return "No active pi process";
}

function encodeModel(provider: string, id: string): string {
  return JSON.stringify([provider, id]);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); }
}

createRoot(document.getElementById("root")!).render(<App />);
