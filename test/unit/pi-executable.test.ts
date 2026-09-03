import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePiExecutable } from "../../src/runtime/pi-executable.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolvePiExecutable", () => {
  it("resolves pi from the Extension Host PATH", async () => {
    const root = await temporaryRoot();
    const executable = await fakeExecutable(path.join(root, "bin", "pi"));

    await expect(resolvePiExecutable("pi", { path: path.dirname(executable), homeDir: root, platform: "linux" }))
      .resolves.toBe(executable);
  });

  it("falls back to the stable pi-node symlink location", async () => {
    const root = await temporaryRoot();
    const executable = await fakeExecutable(path.join(root, ".local", "share", "pi-node", "current", "bin", "pi"));

    await expect(resolvePiExecutable("pi", { path: "/usr/bin", homeDir: root, platform: "linux" }))
      .resolves.toBe(executable);
  });

  it("keeps an explicit accessible path", async () => {
    const root = await temporaryRoot();
    const executable = await fakeExecutable(path.join(root, "custom-pi"));

    await expect(resolvePiExecutable(executable, { platform: "linux" })).resolves.toBe(executable);
  });

  it("explains when a WSL path is configured in a Windows Extension Host", async () => {
    await expect(resolvePiExecutable("/home/user/.local/bin/pi", { platform: "win32" })).rejects.toThrow(
      "Reopen Folder in WSL",
    );
  });

  it("includes Extension Host platform and PATH when pi is missing", async () => {
    const root = await temporaryRoot();
    await expect(resolvePiExecutable("pi", { path: "/missing/bin", homeDir: root, platform: "linux" }))
      .rejects.toThrow("linux Extension Host");
    await expect(resolvePiExecutable("pi", { path: "/missing/bin", homeDir: root, platform: "linux" }))
      .rejects.toThrow("/missing/bin");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-executable-"));
  roots.push(root);
  return root;
}

async function fakeExecutable(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "#!/bin/sh\nexit 0\n");
  await chmod(filePath, 0o755);
  return filePath;
}
