import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { JsonlDecoder } from "./jsonl-decoder.js";
import { isRecord } from "../utils/is-record.js";

interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface RpcClientOptions {
  requestTimeoutMs?: number;
  killTimeoutMs?: number;
}

export class RpcClient extends EventEmitter {
  readonly #decoder = new JsonlDecoder();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #requestTimeoutMs: number;
  readonly #killTimeoutMs: number;
  #sequence = 0;
  #disposed = false;

  private constructor(readonly process: ChildProcessWithoutNullStreams, options: RpcClientOptions = {}) {
    super();
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#killTimeoutMs = options.killTimeoutMs ?? 1_000;
    process.stdout.on("data", (chunk: Buffer) => this.#consume(chunk));
    process.stdout.once("end", () => {
      try {
        this.#decoder.end();
      } catch (error) {
        this.emit("protocolError", error);
      }
    });
    process.stderr.on("data", (chunk: Buffer) => this.emit("diagnostic", chunk.toString("utf8")));
    process.once("error", (error) => this.#close(error));
    process.once("exit", (code, signal) => {
      this.#close(new Error(`pi RPC exited (${signal ?? String(code)})`));
      this.emit("exit", code, signal);
    });
  }

  static launch(
    executable: string,
    args: string[],
    options: SpawnOptionsWithoutStdio & RpcClientOptions = {},
  ): RpcClient {
    const { requestTimeoutMs, killTimeoutMs, ...spawnOptions } = options;
    const child = spawn(executable, args, { ...spawnOptions, stdio: "pipe" });
    return new RpcClient(child, { requestTimeoutMs, killTimeoutMs });
  }

  get pid(): number | undefined {
    return this.process.pid;
  }

  send(message: Record<string, unknown>): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error("pi RPC client is disposed"));
    return new Promise((resolve, reject) => {
      this.process.stdin.write(`${JSON.stringify(message)}\n`, (error) => error ? reject(error) : resolve());
    });
  }

  request(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#disposed) return Promise.reject(new Error("pi RPC client is disposed"));
    const id = `vscode-${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`pi RPC request timed out: ${type}`));
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`, (error) => {
        if (error) this.#reject(id, error);
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rejectAll(new Error("pi RPC client disposed"));
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;

    const exited = new Promise<void>((resolve) => this.process.once("exit", () => resolve()));
    this.process.kill("SIGTERM");
    const timer = setTimeout(() => this.process.kill("SIGKILL"), this.#killTimeoutMs);
    await exited;
    clearTimeout(timer);
  }

  #consume(chunk: Buffer): void {
    try {
      for (const record of this.#decoder.push(chunk)) this.#handleRecord(record);
    } catch (error) {
      this.emit("protocolError", error);
    }
  }

  #handleRecord(record: string): void {
    let message: unknown;
    try {
      message = JSON.parse(record);
    } catch (error) {
      this.emit("protocolError", new Error(`Invalid pi RPC JSON: ${String(error)}`));
      return;
    }
    if (isRecord(message) && message.type === "response" && !isRpcResponse(message)) {
      this.emit("protocolError", new Error("Invalid pi RPC response schema"));
      return;
    }
    if (isRpcResponse(message) && message.id && this.#pending.has(message.id)) {
      const pending = this.#pending.get(message.id)!;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.success) pending.resolve(message.data);
      else pending.reject(new Error(message.error ?? `${message.command} failed`));
      return;
    }
    this.emit("event", message);
  }

  #reject(id: string, error: Error): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  #rejectAll(error: Error): void {
    for (const id of this.#pending.keys()) this.#reject(id, error);
  }

  #close(error: Error): void {
    this.#disposed = true;
    this.#rejectAll(error);
  }
}

function isRpcResponse(value: unknown): value is RpcResponse {
  return isRecord(value)
    && value.type === "response"
    && typeof value.command === "string"
    && typeof value.success === "boolean"
    && (value.id === undefined || typeof value.id === "string")
    && (value.error === undefined || typeof value.error === "string");
}
