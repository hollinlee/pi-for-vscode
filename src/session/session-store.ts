import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path, { type PlatformPath } from "node:path";
import { createInterface } from "node:readline";
import { isRecord } from "../utils/is-record.js";

export interface SessionSummary {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  created: string;
  modified: string;
}

export interface SessionCatalog {
  list(cwd: string): Promise<SessionSummary[]>;
}

export interface SessionStoreOptions {
  agentDir?: string;
  cwdPath?: PlatformPath;
  filePath?: PlatformPath;
  toRuntimePath?: (filePath: string) => string;
}

export class SessionStore implements SessionCatalog {
  readonly #agentDir: string;
  readonly #cwdPath: PlatformPath;
  readonly #filePath: PlatformPath;
  readonly #toRuntimePath: (filePath: string) => string;

  constructor(options: string | SessionStoreOptions = {}) {
    const normalized = typeof options === "string" ? { agentDir: options } : options;
    this.#agentDir = normalized.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent");
    this.#cwdPath = normalized.cwdPath ?? path;
    this.#filePath = normalized.filePath ?? path;
    this.#toRuntimePath = normalized.toRuntimePath ?? ((filePath) => filePath);
  }

  async list(cwd: string): Promise<SessionSummary[]> {
    const resolvedCwd = this.#cwdPath.resolve(cwd);
    const directory = this.sessionDirectory(resolvedCwd);
    let files: string[];
    try {
      files = (await readdir(directory)).filter((file) => file.endsWith(".jsonl"));
    } catch {
      return [];
    }

    const sessions: SessionSummary[] = [];
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(8, files.length) }, async () => {
      while (nextIndex < files.length) {
        const file = files[nextIndex++];
        if (!file) continue;
        const session = await this.#read(this.#filePath.join(directory, file), resolvedCwd);
        if (session) sessions.push(session);
      }
    });
    await Promise.all(workers);
    return sessions.sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
  }

  sessionDirectory(cwd: string): string {
    const resolved = this.#cwdPath.resolve(cwd);
    const safePath = `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return this.#filePath.join(this.#filePath.resolve(this.#agentDir), "sessions", safePath);
  }

  async #read(filePath: string, expectedCwd: string): Promise<SessionSummary | undefined> {
    try {
      const fileStat = await stat(filePath);
      const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
      let header: Record<string, unknown> | undefined;
      let name: string | undefined;
      let firstMessage = "";
      let messageCount = 0;
      let lastActivity = 0;

      for await (const line of lines) {
        const entry = parseRecord(line);
        if (!entry) continue;
        if (!header) {
          if (entry.type !== "session" || typeof entry.id !== "string" || typeof entry.cwd !== "string") return undefined;
          if (this.#cwdPath.resolve(entry.cwd) !== expectedCwd) return undefined;
          header = entry;
          continue;
        }
        if (entry.type === "session_info") {
          name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
          continue;
        }
        if (entry.type !== "message" || !isRecord(entry.message)) continue;
        messageCount += 1;
        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;
        const text = extractText(entry.message.content);
        if (role === "user" && !firstMessage && text) firstMessage = text;
        const timestamp = typeof entry.message.timestamp === "number"
          ? entry.message.timestamp
          : typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
        if (!Number.isNaN(timestamp)) lastActivity = Math.max(lastActivity, timestamp);
      }

      if (!header || typeof header.id !== "string" || typeof header.cwd !== "string") return undefined;
      const created = typeof header.timestamp === "string" && !Number.isNaN(Date.parse(header.timestamp))
        ? header.timestamp
        : fileStat.birthtime.toISOString();
      return {
        id: header.id,
        path: this.#toRuntimePath(filePath),
        cwd: header.cwd,
        name,
        firstMessage: firstMessage || "(no messages)",
        messageCount,
        created,
        modified: new Date(lastActivity || fileStat.mtimeMs).toISOString(),
      };
    } catch {
      return undefined;
    }
  }
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .map((block) => block.type === "text" && typeof block.text === "string" ? block.text : "")
    .filter(Boolean)
    .join(" ");
}
