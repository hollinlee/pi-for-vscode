import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiRuntime, compareVersions, probePiVersion } from "../../src/runtime/pi-runtime.js";

describe("PiRuntime", () => {
  it("publishes and retains externally supplied availability states", () => {
    const runtime = new PiRuntime();
    const changed = vi.fn();
    runtime.on("change", changed);

    runtime.show({ phase: "untrusted", message: "Trust required" });

    expect(runtime.snapshot).toEqual({ phase: "untrusted", message: "Trust required" });
    expect(changed).toHaveBeenCalledOnce();
  });

  it("moves to an actionable error for an incompatible executable", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pi-runtime-"));
    const executable = path.join(directory, "pi");
    await writeFile(executable, '#!/bin/sh\necho "0.1.0"\n');
    await chmod(executable, 0o755);

    const runtime = new PiRuntime();
    await runtime.connect(executable, directory);

    expect(runtime.snapshot).toMatchObject({
      phase: "error",
      executable,
      message: expect.stringContaining("incompatible") as string,
    });
    await rm(directory, { recursive: true, force: true });
  });
});

describe("probePiVersion", () => {
  it("parses a semantic version from executable output", async () => {
    await expect(probePiVersion(process.execPath, process.cwd())).resolves.toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("maps a missing executable to an actionable error", async () => {
    await expect(probePiVersion("/definitely/missing/pi", process.cwd())).rejects.toThrow(
      "pi executable not found",
    );
  });
});

describe("compareVersions", () => {
  it.each([
    ["0.84.2", "0.84.2", 0],
    ["0.85.0", "0.84.2", 1],
    ["0.84.1", "0.84.2", -1],
  ])("compares %s with %s", (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });
});
