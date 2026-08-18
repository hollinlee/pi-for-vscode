import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../../src/session/session-store.js";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("SessionStore", () => {
  it("uses pi's cwd encoding and lists valid sessions by activity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-sessions-"));
    temporaryDirectories.push(root);
    const agentDir = path.join(root, "agent");
    const cwd = path.join(root, "project:one");
    const store = new SessionStore(agentDir);
    const directory = store.sessionDirectory(cwd);
    await mkdir(directory, { recursive: true });

    await writeFile(path.join(directory, "older.jsonl"), sessionJsonl({
      id: "older",
      cwd,
      timestamp: "2026-01-01T00:00:00.000Z",
      name: "Older session",
      prompt: "first prompt",
      messageTimestamp: 1_767_225_600_000,
    }));
    await writeFile(path.join(directory, "newer.jsonl"), sessionJsonl({
      id: "newer",
      cwd,
      timestamp: "2026-01-02T00:00:00.000Z",
      prompt: "newer prompt",
      messageTimestamp: 1_767_312_000_000,
    }));
    await writeFile(path.join(directory, "wrong-cwd.jsonl"), sessionJsonl({
      id: "wrong",
      cwd: path.join(root, "other"),
      timestamp: "2026-01-03T00:00:00.000Z",
      prompt: "wrong",
      messageTimestamp: 1_767_398_400_000,
    }));
    await writeFile(path.join(directory, "malformed.jsonl"), "not-json\n");

    expect(directory).toContain(`sessions${path.sep}--`);
    const sessions = await store.list(cwd);
    expect(sessions.map((session) => session.id)).toEqual(["newer", "older"]);
    expect(sessions[1]).toMatchObject({
      name: "Older session",
      firstMessage: "first prompt",
      messageCount: 1,
      cwd,
    });
  });

  it("returns an empty list when the session directory is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-sessions-"));
    temporaryDirectories.push(root);
    await expect(new SessionStore(path.join(root, "agent")).list(path.join(root, "missing"))).resolves.toEqual([]);
  });
});

function sessionJsonl(input: {
  id: string;
  cwd: string;
  timestamp: string;
  prompt: string;
  messageTimestamp: number;
  name?: string;
}): string {
  const entries: unknown[] = [
    { type: "session", version: 3, id: input.id, timestamp: input.timestamp, cwd: input.cwd },
  ];
  if (input.name) entries.push({ type: "session_info", id: "info", parentId: null, timestamp: input.timestamp, name: input.name });
  entries.push({
    type: "message",
    id: "message",
    parentId: null,
    timestamp: input.timestamp,
    message: { role: "user", content: input.prompt, timestamp: input.messageTimestamp },
  });
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}
