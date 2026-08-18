import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PiRuntime } from "../../src/runtime/pi-runtime.js";
import { SessionStore } from "../../src/session/session-store.js";

const fakePi = path.resolve("test/fixtures/fake-pi.mjs");

describe("PiRuntime failure recovery", () => {
  it.each(["protocol-error", "crash"])("cleans up after %s and reconnects", async (failure) => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-failure-"));
    const cwd = path.join(root, "workspace");
    await mkdir(cwd, { recursive: true });
    const runtime = new PiRuntime(new SessionStore(path.join(root, "agent")));
    await runtime.connect(fakePi, cwd);
    const failedPid = runtime.snapshot.pid;
    expect(failedPid).toBeTypeOf("number");

    await runtime.prompt(failure);
    await waitFor(() => runtime.snapshot.phase === "error");
    await waitFor(() => failedPid !== undefined && !isProcessAlive(failedPid));
    expect(runtime.snapshot).toMatchObject({ phase: "error", pid: undefined });

    await runtime.connect(fakePi, cwd);
    expect(runtime.snapshot.phase).toBe("ready");
    expect(runtime.snapshot.pid).not.toBe(failedPid);
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it("reports missing executables without leaving an active process", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-failure-"));
    const cwd = path.join(root, "workspace");
    await mkdir(cwd, { recursive: true });
    const runtime = new PiRuntime(new SessionStore(path.join(root, "agent")));

    await runtime.connect(path.join(root, "missing-pi"), cwd);
    expect(runtime.snapshot.phase).toBe("error");
    expect(runtime.snapshot).not.toHaveProperty("pid");
    expect(runtime.snapshot.message).toContain("pi executable not found");
    await rm(root, { recursive: true, force: true });
  });

  it("removes subscriptions deterministically", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-failure-"));
    const cwd = path.join(root, "workspace");
    await mkdir(cwd, { recursive: true });
    const runtime = new PiRuntime(new SessionStore(path.join(root, "agent")));
    let calls = 0;
    const unsubscribe = runtime.subscribeChat(() => { calls += 1; });
    unsubscribe();

    await runtime.connect(fakePi, cwd);
    expect(calls).toBe(0);
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(read: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for runtime state");
}
