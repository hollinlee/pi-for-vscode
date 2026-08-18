import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

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

export class SessionStore {
  constructor(private readonly agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent")) {}

  async list(cwd: string): Promise<SessionSummary[]> {
    const resolvedCwd = path.resolve(cwd);
    const directory = this.sessionDirectory(resolvedCwd);
    let files: string[];
    try {
      files = (await readdir(directory)).filter((file) => file.endsWith(".jsonl"));
    } catch {
      return [];
    }

    const sessions = (await Promise.all(files.map((file) => this.#read(path.join(directory, file), resolvedCwd))))
      .filter((session): session is SessionSummary => session !== undefined);
    return sessions.sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
  }

  sessionDirectory(cwd: string): string {
    const resolved = path.resolve(cwd);
    const safePath = `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return path.join(path.resolve(this.agentDir), "sessions", safePath);
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
          if (path.resolve(entry.cwd) !== expectedCwd) return undefined;
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
        path: filePath,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
