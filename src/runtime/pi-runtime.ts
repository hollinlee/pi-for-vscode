import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChatEvent } from "../chat/chat-reducer.js";
import { RpcEventNormalizer } from "../chat/rpc-event-normalizer.js";
import type { ConnectionSnapshot, SessionSnapshot } from "../protocol.js";
import { RpcClient } from "../rpc/rpc-client.js";
import { hydrateAgentMessages } from "../session/hydrate-messages.js";
import { SessionStore } from "../session/session-store.js";

const execFileAsync = promisify(execFile);
export const MINIMUM_PI_VERSION = "0.84.2";

type ChatListener = (event: ChatEvent) => void;
type SessionListener = (snapshot: SessionSnapshot) => void;

export class PiRuntime extends EventEmitter {
  readonly #normalizer = new RpcEventNormalizer();
  readonly #chatListeners = new Set<ChatListener>();
  readonly #sessionListeners = new Set<SessionListener>();
  readonly #sessionStore: SessionStore;
  #client: RpcClient | undefined;
  #snapshot: ConnectionSnapshot = { phase: "disconnected" };
  #sessionSnapshot: SessionSnapshot = { sessions: [] };
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

  async connect(executable: string, cwd: string, sessionPath?: string): Promise<void> {
    await this.dispose();
    this.#normalizer.reset();
    this.#running = false;
    this.#emitChat({ type: "reset" });
    this.#setSession({ cwd, sessions: [] });
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
      await this.#synchronizeSession(client, cwd);
      if (this.#client !== client) return;
      this.#set({ phase: "ready", executable, version, cwd, pid: client.pid });
    } catch (error) {
      await this.dispose();
      this.#set({
        phase: "error",
        executable,
        cwd,
        message: toActionableMessage(error),
      });
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
    await this.#synchronizeSession(client, this.#requireCwd());
  }

  async switchSession(sessionPath: string): Promise<void> {
    const client = this.#requireIdleClient();
    const session = this.#sessionSnapshot.sessions.find((item) => item.path === sessionPath);
    if (!session || session.cwd !== this.#requireCwd()) throw new Error("Session is not available for this workspace");
    const result = await client.request("switch_session", { sessionPath });
    if (isRecord(result) && result.cancelled === true) return;
    this.#normalizer.reset();
    await this.#synchronizeSession(client, session.cwd);
  }

  async refreshSessions(): Promise<void> {
    const cwd = this.#snapshot.cwd;
    if (!cwd) return;
    const sessions = await this.#sessionStore.list(cwd);
    this.#setSession({ ...this.#sessionSnapshot, cwd, sessions });
  }

  async dispose(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    this.#running = false;
    if (client) await client.dispose();
    if (this.#snapshot.phase !== "disconnected") this.#set({ phase: "disconnected" });
  }

  #handleRpcEvent(value: unknown): void {
    for (const event of this.#normalizer.normalize(value)) {
      if (event.type === "status") {
        this.#running = event.phase === "streaming" || event.phase === "aborting";
        if (event.phase === "idle") void this.refreshSessions();
      }
      this.#emitChat(event);
    }
  }

  async #synchronizeSession(client: RpcClient, cwd: string): Promise<void> {
    const state = await client.request("get_state");
    const messageData = await client.request("get_messages");
    const sessions = await this.#sessionStore.list(cwd);
    if (this.#client !== client) return;

    const activeId = isRecord(state) && typeof state.sessionId === "string" ? state.sessionId : undefined;
    const activePath = isRecord(state) && typeof state.sessionFile === "string" ? state.sessionFile : undefined;
    const messages = isRecord(messageData) ? messageData.messages : undefined;
    this.#emitChat({ type: "hydrate", state: hydrateAgentMessages(messages) });
    this.#setSession({ cwd, activeId, activePath, sessions });
  }

  #requireClient(): RpcClient {
    if (!this.#client || this.#snapshot.phase !== "ready") throw new Error("Pi RPC is not connected");
    return this.#client;
  }

  #requireIdleClient(): RpcClient {
    const client = this.#requireClient();
    if (this.#running) throw new Error("Wait for Pi to finish before changing sessions");
    return client;
  }

  #requireCwd(): string {
    if (!this.#snapshot.cwd) throw new Error("Pi workspace is unavailable");
    return this.#snapshot.cwd;
  }

  #emitChat(event: ChatEvent): void {
    for (const listener of this.#chatListeners) listener(event);
  }

  #setSession(snapshot: SessionSnapshot): void {
    this.#sessionSnapshot = snapshot;
    for (const listener of this.#sessionListeners) listener(snapshot);
  }

  #fail(error: Error): void {
    const previous = this.#snapshot;
    this.#client = undefined;
    this.#running = false;
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

function toActionableMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
