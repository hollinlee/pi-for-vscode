import { describe, expect, it, vi } from "vitest";
import { WslSessionStore } from "../../src/session/wsl-session-store.js";

describe("WslSessionStore", () => {
  it("lists bounded Linux session metadata through wsl.exe", async () => {
    const session = {
      id: "session-1",
      path: "/home/user/.pi/agent/sessions/project/session.jsonl",
      cwd: "/mnt/c/work/project",
      name: "Bridge session",
      firstMessage: "hello",
      messageCount: 2,
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-02T00:00:00.000Z",
    };
    const run = vi.fn(() => Promise.resolve({ stdout: `${JSON.stringify([session])}\r\n`, stderr: "" }));
    const store = new WslSessionStore("Debian", "wsl.exe", run as never);

    await expect(store.list("/mnt/c/work/project")).resolves.toEqual([session]);
    expect(run).toHaveBeenCalledWith("wsl.exe", expect.arrayContaining([
      "-d",
      "Debian",
      "--exec",
      "/bin/bash",
      "/mnt/c/work/project",
    ]), expect.objectContaining({ windowsHide: true }));
  });

  it("rejects malformed or non-Linux session paths", async () => {
    const run = vi.fn(() => Promise.resolve({ stdout: JSON.stringify([
      { id: "bad", path: "C:\\session.jsonl", cwd: "/work", firstMessage: "x", messageCount: 1, created: "x", modified: "x" },
    ]), stderr: "" }));
    const store = new WslSessionStore("Debian", "wsl.exe", run as never);
    await expect(store.list("/work")).resolves.toEqual([]);
  });

  it("degrades to an empty list when WSL session lookup fails", async () => {
    const run = vi.fn(() => Promise.reject(new Error("WSL unavailable")));
    const store = new WslSessionStore("Debian", "wsl.exe", run as never);
    await expect(store.list("/work")).resolves.toEqual([]);
  });
});
