import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../src/chat/chat-reducer.js";
import type { ExtensionUiEvent } from "../../src/protocol.js";
import { PiRuntime } from "../../src/runtime/pi-runtime.js";
import { SessionStore } from "../../src/session/session-store.js";

const fakePi = path.resolve("test/fixtures/fake-pi.mjs");

describe("PiRuntime controls and extension UI", () => {
  it("queries and switches model and thinking controls", async () => {
    const { runtime, root } = await connectedRuntime();
    expect(runtime.controlsSnapshot).toMatchObject({
      model: { provider: "fixture", id: "model-a" },
      thinkingLevel: "medium",
      thinkingLevels: ["off", "low", "medium", "high"],
      commands: [
        { name: "grill", description: "Align intent before implementation", source: "extension" },
        { name: "plan", description: "Create an implementation plan", source: "prompt", location: "user" },
        { name: "skill:remote-devices", description: "Operate remote devices", source: "skill", location: "user" },
      ],
    });

    await expect(runtime.setModel("fixture", "missing")).rejects.toThrow("not available");
    await runtime.setModel("fixture", "model-b");
    await runtime.setThinkingLevel("high");
    expect(runtime.controlsSnapshot).toMatchObject({
      model: { provider: "fixture", id: "model-b" },
      thinkingLevel: "high",
    });
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    ["confirm", { kind: "confirmed", confirmed: true }],
    ["select", { kind: "value", value: "B" }],
    ["input", { kind: "value", value: "text" }],
    ["editor", { kind: "value", value: "line 1\nline 2" }],
  ] as const)("correlates and resolves %s dialogs", async (method, response) => {
    const { runtime, root } = await connectedRuntime();
    const ui: ExtensionUiEvent[] = [];
    const chat: ChatEvent[] = [];
    runtime.subscribeExtensionUi((event) => ui.push(event));
    runtime.subscribeChat((event) => chat.push(event));

    await runtime.prompt(`ui-${method}`);
    const dialog = await waitFor(() => ui.find((event): event is Extract<ExtensionUiEvent, { type: "dialog" }> => event.type === "dialog"));
    if (method === "select") {
      await expect(runtime.respondExtensionUi(dialog.request.id, { kind: "value", value: "C" })).rejects.toThrow("offered options");
    }
    await runtime.respondExtensionUi(dialog.request.id, response);
    await waitFor(() => chat.find((event) => event.type === "status" && event.phase === "idle"));

    expect(ui.some((event) => event.type === "dismiss" && event.id === dialog.request.id)).toBe(true);
    expect(ui.some((event) => event.type === "notify")).toBe(true);
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it("dismisses timed dialogs and cancels pending dialogs on dispose", async () => {
    const { runtime, root } = await connectedRuntime();
    const ui: ExtensionUiEvent[] = [];
    runtime.subscribeExtensionUi((event) => ui.push(event));

    await runtime.prompt("ui-timeout");
    await waitFor(() => ui.find((event) => event.type === "dialog"));
    await waitFor(() => ui.find((event) => event.type === "dismiss" && event.id === "dialog-timeout"), 500);
    await runtime.dispose();

    const second = new PiRuntime(new SessionStore(path.join(root, "agent-2")));
    await second.connect(fakePi, path.join(root, "workspace"));
    const secondUi: ExtensionUiEvent[] = [];
    second.subscribeExtensionUi((event) => secondUi.push(event));
    await second.prompt("ui-input");
    await waitFor(() => secondUi.find((event) => event.type === "dialog"));
    await second.cancelExtensionUi();
    expect(secondUi.some((event) => event.type === "dismiss" && event.id === "dialog-input")).toBe(true);
    await second.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it("forwards supported fire-and-forget UI events", async () => {
    const { runtime, root } = await connectedRuntime();
    const ui: ExtensionUiEvent[] = [];
    runtime.subscribeExtensionUi((event) => ui.push(event));
    await runtime.prompt("ui-fire");
    await waitFor(() => ui.find((event) => event.type === "editorText"));
    expect(ui.map((event) => event.type)).toEqual(expect.arrayContaining(["notify", "status", "widget", "title", "editorText"]));
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
});

async function connectedRuntime(): Promise<{ runtime: PiRuntime; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-controls-"));
  const cwd = path.join(root, "workspace");
  await mkdir(cwd, { recursive: true });
  const runtime = new PiRuntime(new SessionStore(path.join(root, "agent")));
  await runtime.connect(fakePi, cwd);
  expect(runtime.snapshot.phase).toBe("ready");
  return { runtime, root };
}

async function waitFor<T>(read: () => T | undefined, timeout = 1_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for fixture event");
}
