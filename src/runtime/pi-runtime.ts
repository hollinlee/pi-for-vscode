import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChatEvent } from "../chat/chat-reducer.js";
import { RpcEventNormalizer } from "../chat/rpc-event-normalizer.js";
import type {
  ConnectionSnapshot,
  ControlsSnapshot,
  ExtensionUiEvent,
  ExtensionUiResponse,
  ModelSummary,
  SessionSnapshot,
} from "../protocol.js";
import { normalizeExtensionUiEvent } from "../rpc/extension-ui.js";
import { RpcClient } from "../rpc/rpc-client.js";
import { hydrateAgentMessages } from "../session/hydrate-messages.js";
import { SessionStore } from "../session/session-store.js";
import { isRecord } from "../utils/is-record.js";

const execFileAsync = promisify(execFile);
export const MINIMUM_PI_VERSION = "0.84.2";

type ChatListener = (event: ChatEvent) => void;
type SessionListener = (snapshot: SessionSnapshot) => void;
type ControlsListener = (snapshot: ControlsSnapshot) => void;
type ExtensionUiListener = (event: ExtensionUiEvent) => void;

interface PendingExtensionUi {
  method: "select" | "confirm" | "input" | "editor";
  options?: string[];
  timer?: NodeJS.Timeout;
}

export class PiRuntime extends EventEmitter {
  readonly #normalizer = new RpcEventNormalizer();
  readonly #chatListeners = new Set<ChatListener>();
  readonly #sessionListeners = new Set<SessionListener>();
  readonly #controlsListeners = new Set<ControlsListener>();
  readonly #extensionUiListeners = new Set<ExtensionUiListener>();
  readonly #pendingExtensionUi = new Map<string, PendingExtensionUi>();
  readonly #sessionStore: SessionStore;
  #client: RpcClient | undefined;
  #snapshot: ConnectionSnapshot = { phase: "disconnected" };
  #sessionSnapshot: SessionSnapshot = { sessions: [] };
  #controlsSnapshot: ControlsSnapshot = { models: [], thinkingLevel: "off", thinkingLevels: ["off"] };
  #userSequence = 0;
  #running = false;

  constructor(sessionStore = new SessionStore()) {
    super();
    this.#sessionStore = sessionStore;
  }

  get snapshot(): ConnectionSnapshot {
    return this.#snapshot;
  }

  get sessionSnapshot(): SessionSnapshot {
    return this.#sessionSnapshot;
  }

  get controlsSnapshot(): ControlsSnapshot {
    return this.#controlsSnapshot;
  }

  show(snapshot: ConnectionSnapshot): void {
    this.#set(snapshot);
  }

  subscribeChat(listener: ChatListener): () => void {
    this.#chatListeners.add(listener);
    return () => this.#chatListeners.delete(listener);
  }

  subscribeSession(listener: SessionListener): () => void {
    this.#sessionListeners.add(listener);
    return () => this.#sessionListeners.delete(listener);
  }

  subscribeControls(listener: ControlsListener): () => void {
    this.#controlsListeners.add(listener);
    return () => this.#controlsListeners.delete(listener);
  }

  subscribeExtensionUi(listener: ExtensionUiListener): () => void {
    this.#extensionUiListeners.add(listener);
    return () => this.#extensionUiListeners.delete(listener);
  }

  async connect(executable: string, cwd: string, sessionPath?: string): Promise<void> {
    await this.dispose();
    this.#normalizer.reset();
    this.#running = false;
    this.#emitChat({ type: "reset" });
    this.#setSession({ cwd, sessions: [] });
    this.#setControls({ models: [], thinkingLevel: "off", thinkingLevels: ["off"] });
    this.#set({ phase: "starting", executable, cwd });
    try {
      const version = await probePiVersion(executable, cwd);
      if (compareVersions(version, MINIMUM_PI_VERSION) < 0) {
        throw new Error(`pi ${version} is incompatible; ${MINIMUM_PI_VERSION} or newer is required`);
      }

      const args = ["--mode", "rpc", "--approve"];
      if (sessionPath) args.push("--session", sessionPath);
      const client = RpcClient.launch(executable, args, { cwd });
      this.#client = client;
      client.on("event", (value: unknown) => {
        if (this.#client === client) this.#handleRpcEvent(value);
      });
      client.on("protocolError", (error: Error) => {
        if (this.#client === client) this.#fail(error);
      });
      client.on("exit", () => {
        if (this.#client === client) this.#fail(new Error("pi RPC process exited"));
      });
      await this.#synchronizeRuntime(client, cwd);
      if (this.#client !== client) return;
      this.#set({ phase: "ready", executable, version, cwd, pid: client.pid });
    } catch (error) {
      await this.dispose();
      this.#set({ phase: "error", executable, cwd, message: toActionableMessage(error) });
    }
  }

  async prompt(text: string): Promise<void> {
    const client = this.#requireClient();
    if (this.#running) throw new Error("Pi is already processing a prompt");
    const normalized = text.trim();
    if (!normalized) throw new Error("Prompt cannot be empty");

    this.#running = true;
    this.#emitChat({ type: "status", phase: "streaming" });
    this.#emitChat({ type: "user", id: `user-${++this.#userSequence}`, text: normalized });
    try {
      await client.request("prompt", { message: normalized });
    } catch (error) {
      this.#running = false;
      this.#emitChat({ type: "error", message: toActionableMessage(error) });
      throw error;
    }
  }

  async abort(): Promise<void> {
    const client = this.#requireClient();
    if (!this.#running) return;
    this.#emitChat({ type: "status", phase: "aborting" });
    try {
      await client.request("abort");
    } catch (error) {
      this.#running = false;
      this.#emitChat({ type: "error", message: toActionableMessage(error) });
      throw error;
    }
  }

  async newSession(): Promise<void> {
    const client = this.#requireIdleClient();
    const result = await client.request("new_session");
    if (isRecord(result) && result.cancelled === true) return;
    this.#normalizer.reset();
    this.#emitChat({ type: "reset" });
    await this.#synchronizeRuntime(client, this.#requireCwd());
  }

  async switchSession(sessionPath: string): Promise<void> {
    const client = this.#requireIdleClient();
    const session = this.#sessionSnapshot.sessions.find((item) => item.path === sessionPath);
    if (!session || session.cwd !== this.#requireCwd()) throw new Error("Session is not available for this workspace");
    const result = await client.request("switch_session", { sessionPath });
    if (isRecord(result) && result.cancelled === true) return;
    this.#normalizer.reset();
    await this.#synchronizeRuntime(client, session.cwd);
  }

  async refreshSessions(): Promise<void> {
    const cwd = this.#snapshot.cwd;
    if (!cwd) return;
    const sessions = await this.#sessionStore.list(cwd);
    this.#setSession({ ...this.#sessionSnapshot, cwd, sessions });
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const client = this.#requireIdleClient();
    if (!this.#controlsSnapshot.models.some((model) => model.provider === provider && model.id === modelId)) {
      throw new Error(`Model is not available: ${provider}/${modelId}`);
    }
    await client.request("set_model", { provider, modelId });
    await this.#synchronizeControls(client);
  }

  async setThinkingLevel(level: string): Promise<void> {
    const client = this.#requireIdleClient();
    if (!this.#controlsSnapshot.thinkingLevels.includes(level)) throw new Error(`Unsupported thinking level: ${level}`);
    await client.request("set_thinking_level", { level });
    await this.#synchronizeControls(client);
  }

  async respondExtensionUi(id: string, response: ExtensionUiResponse): Promise<void> {
    const client = this.#requireClient();
    const pending = this.#pendingExtensionUi.get(id);
    if (!pending) return;
    if (pending.method === "confirm" && response.kind !== "confirmed" && response.kind !== "cancelled") {
      throw new Error("Confirm dialogs require a boolean response");
    }
    if (pending.method !== "confirm" && response.kind === "confirmed") {
      throw new Error(`${pending.method} dialogs require a value response`);
    }
    if (pending.method === "select" && response.kind === "value" && !pending.options?.includes(response.value)) {
      throw new Error("Select response is not one of the offered options");
    }
    this.#clearPendingExtensionUi(id);
    const payload = response.kind === "cancelled"
      ? { type: "extension_ui_response", id, cancelled: true }
      : response.kind === "confirmed"
        ? { type: "extension_ui_response", id, confirmed: response.confirmed }
        : { type: "extension_ui_response", id, value: response.value };
    await client.send(payload);
  }

  async cancelExtensionUi(): Promise<void> {
    const client = this.#client;
    const ids = [...this.#pendingExtensionUi.keys()];
    for (const id of ids) {
      this.#clearPendingExtensionUi(id);
      if (client) await client.send({ type: "extension_ui_response", id, cancelled: true }).catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    await this.cancelExtensionUi();
    const client = this.#client;
    this.#client = undefined;
    this.#running = false;
    if (client) await client.dispose();
    if (this.#snapshot.phase !== "disconnected") this.#set({ phase: "disconnected" });
  }

  #handleRpcEvent(value: unknown): void {
    const extensionUi = normalizeExtensionUiEvent(value);
    if (extensionUi) {
      this.#handleExtensionUi(extensionUi);
      return;
    }
    for (const event of this.#normalizer.normalize(value)) {
      if (event.type === "status") {
        this.#running = event.phase === "streaming" || event.phase === "aborting";
        if (event.phase === "idle") void this.refreshSessions().catch(() => undefined);
      }
      this.#emitChat(event);
    }
  }

  #handleExtensionUi(event: ExtensionUiEvent): void {
    if (event.type === "dialog") {
      const timer = event.request.timeout
        ? setTimeout(() => this.#clearPendingExtensionUi(event.request.id), event.request.timeout)
        : undefined;
      this.#pendingExtensionUi.set(event.request.id, {
        method: event.request.method,
        options: event.request.options,
        timer,
      });
    }
    this.#emitExtensionUi(event);
  }

  async #synchronizeRuntime(client: RpcClient, cwd: string): Promise<void> {
    const state = await client.request("get_state");
    const messageData = await client.request("get_messages");
    const sessions = await this.#sessionStore.list(cwd);
    if (this.#client !== client) return;

    const activeId = isRecord(state) && typeof state.sessionId === "string" ? state.sessionId : undefined;
    const activePath = isRecord(state) && typeof state.sessionFile === "string" ? state.sessionFile : undefined;
    const messages = isRecord(messageData) ? messageData.messages : undefined;
    this.#emitChat({ type: "hydrate", state: hydrateAgentMessages(messages) });
    this.#setSession({ cwd, activeId, activePath, sessions });
    await this.#synchronizeControls(client, state);
  }

  async #synchronizeControls(client: RpcClient, knownState?: unknown): Promise<void> {
    const [state, modelData, thinkingData] = await Promise.all([
      knownState === undefined ? client.request("get_state") : Promise.resolve(knownState),
      client.request("get_available_models"),
      client.request("get_available_thinking_levels"),
    ]);
    if (this.#client !== client) return;
    const model = isRecord(state) ? parseModel(state.model) : undefined;
    const models = isRecord(modelData) && Array.isArray(modelData.models)
      ? modelData.models.map(parseModel).filter((item): item is ModelSummary => item !== undefined)
      : [];
    const thinkingLevel = isRecord(state) && typeof state.thinkingLevel === "string" ? state.thinkingLevel : "off";
    const thinkingLevels = isRecord(thinkingData) && Array.isArray(thinkingData.levels)
      ? thinkingData.levels.filter((level): level is string => typeof level === "string")
      : ["off"];
    this.#setControls({ model, models, thinkingLevel, thinkingLevels });
  }

  #requireClient(): RpcClient {
    if (!this.#client || this.#snapshot.phase !== "ready") throw new Error("Pi RPC is not connected");
    return this.#client;
  }

  #requireIdleClient(): RpcClient {
    const client = this.#requireClient();
    if (this.#running) throw new Error("Wait for Pi to finish before changing runtime settings");
    return client;
  }

  #requireCwd(): string {
    if (!this.#snapshot.cwd) throw new Error("Pi workspace is unavailable");
    return this.#snapshot.cwd;
  }

  #clearPendingExtensionUi(id: string): void {
    const pending = this.#pendingExtensionUi.get(id);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.#pendingExtensionUi.delete(id);
    this.#emitExtensionUi({ type: "dismiss", id });
  }

  #emitChat(event: ChatEvent): void {
    for (const listener of this.#chatListeners) listener(event);
  }

  #emitExtensionUi(event: ExtensionUiEvent): void {
    for (const listener of this.#extensionUiListeners) listener(event);
  }

  #setSession(snapshot: SessionSnapshot): void {
    this.#sessionSnapshot = snapshot;
    for (const listener of this.#sessionListeners) listener(snapshot);
  }

  #setControls(snapshot: ControlsSnapshot): void {
    this.#controlsSnapshot = snapshot;
    for (const listener of this.#controlsListeners) listener(snapshot);
  }

  #fail(error: Error): void {
    const previous = this.#snapshot;
    this.#client = undefined;
    this.#running = false;
    void this.cancelExtensionUi();
    this.#emitChat({ type: "error", message: error.message });
    this.#set({ ...previous, phase: "error", pid: undefined, message: error.message });
  }

  #set(snapshot: ConnectionSnapshot): void {
    this.#snapshot = snapshot;
    this.emit("change", snapshot);
  }
}

export async function probePiVersion(executable: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, ["--version"], {
      cwd,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    const match = stdout.trim().match(/\d+\.\d+\.\d+/);
    if (!match) throw new Error(`unexpected version output: ${stdout.trim()}`);
    return match[0];
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") throw new Error(`pi executable not found: ${executable}`);
    throw error;
  }
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function parseModel(value: unknown): ModelSummary | undefined {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.id !== "string") return undefined;
  return { provider: value.provider, id: value.id, name: typeof value.name === "string" ? value.name : value.id };
}

function toActionableMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
