import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../src/chat/chat-reducer.js";
import { PiRuntime } from "../../src/runtime/pi-runtime.js";
import { SessionStore } from "../../src/session/session-store.js";

const fakePi = path.resolve("test/fixtures/fake-pi.mjs");

describe("PiRuntime session workflow", () => {
  it("restores, switches and replaces Pi-owned session state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-runtime-sessions-"));
    const cwd = path.join(root, "workspace");
    await mkdir(cwd, { recursive: true });
    const store = new SessionStore(path.join(root, "agent"));
    const directory = store.sessionDirectory(cwd);
    await mkdir(directory, { recursive: true });
    const first = path.join(directory, "first.jsonl");
    const second = path.join(directory, "second.jsonl");
    await writeFile(first, session("first", cwd, "first prompt"));
    await writeFile(second, session("second", cwd, "second prompt"));

    const runtime = new PiRuntime(store);
    const chatEvents: ChatEvent[] = [];
    runtime.subscribeChat((event) => chatEvents.push(event));

    await runtime.connect(fakePi, cwd, first);
    expect(runtime.sessionSnapshot).toMatchObject({ activeId: "first", activePath: first, cwd });
    expect(lastHydrate(chatEvents).state.messages[0]?.text).toBe("first prompt");

    await runtime.switchSession(second);
    expect(runtime.sessionSnapshot).toMatchObject({ activeId: "second", activePath: second, cwd });
    expect(lastHydrate(chatEvents).state.messages[0]?.text).toBe("second prompt");

    await runtime.newSession();
    expect(runtime.sessionSnapshot).toMatchObject({ activeId: "runtime-new", activePath: "/tmp/runtime-new.jsonl", cwd });
    expect(lastHydrate(chatEvents).state.messages).toEqual([]);

    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it("rejects switching to a path outside the current session list", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-runtime-sessions-"));
    const cwd = path.join(root, "workspace");
    await mkdir(cwd, { recursive: true });
    const runtime = new PiRuntime(new SessionStore(path.join(root, "agent")));
    await runtime.connect(fakePi, cwd);

    await expect(runtime.switchSession(path.join(root, "unknown.jsonl"))).rejects.toThrow("not available");
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
});

function lastHydrate(events: ChatEvent[]): Extract<ChatEvent, { type: "hydrate" }> {
  const event = [...events].reverse().find((item): item is Extract<ChatEvent, { type: "hydrate" }> => item.type === "hydrate");
  if (!event) throw new Error("Expected a hydrate event");
  return event;
}

function session(id: string, cwd: string, prompt: string): string {
  return [
    { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd },
    {
      type: "message",
      id: `${id}-message`,
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: prompt, timestamp: 1_767_225_601_000 },
    },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}
