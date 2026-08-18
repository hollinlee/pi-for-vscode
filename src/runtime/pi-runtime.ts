import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { RpcClient } from "../rpc/rpc-client.js";
import type { ConnectionSnapshot } from "../protocol.js";

const execFileAsync = promisify(execFile);
export const MINIMUM_PI_VERSION = "0.84.2";

export class PiRuntime extends EventEmitter {
  #client: RpcClient | undefined;
  #snapshot: ConnectionSnapshot = { phase: "disconnected" };

  get snapshot(): ConnectionSnapshot {
    return this.#snapshot;
  }

  show(snapshot: ConnectionSnapshot): void {
    this.#set(snapshot);
  }

  async connect(executable: string, cwd: string): Promise<void> {
    await this.dispose();
    this.#set({ phase: "starting", executable, cwd });
    try {
      const version = await probePiVersion(executable, cwd);
      if (compareVersions(version, MINIMUM_PI_VERSION) < 0) {
        throw new Error(`pi ${version} is incompatible; ${MINIMUM_PI_VERSION} or newer is required`);
      }

      const client = RpcClient.launch(executable, ["--mode", "rpc", "--approve"], { cwd });
      this.#client = client;
      client.on("protocolError", (error: Error) => this.#fail(error));
      client.on("exit", () => {
        if (this.#client === client) this.#fail(new Error("pi RPC process exited"));
      });
      await client.request("get_state");
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

  async dispose(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    if (client) await client.dispose();
    if (this.#snapshot.phase !== "disconnected") this.#set({ phase: "disconnected" });
  }

  #fail(error: Error): void {
    const previous = this.#snapshot;
    this.#client = undefined;
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
