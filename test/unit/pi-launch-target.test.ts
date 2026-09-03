import { describe, expect, it, vi } from "vitest";
import {
  defaultWslDistribution,
  expandMappedDrive,
  parseWslUncPath,
  resolveWslTarget,
  toWslPath,
} from "../../src/runtime/pi-launch-target.js";

describe("WSL launch target", () => {
  it("maps WSL UNC paths without invoking wslpath", async () => {
    const run = vi.fn();
    await expect(toWslPath("\\\\wsl.localhost\\Debian\\home\\user\\project", "Debian", "wsl.exe", run as never))
      .resolves.toBe("/home/user/project");
    expect(run).not.toHaveBeenCalled();
    expect(parseWslUncPath("\\\\wsl$\\Debian\\home\\user")).toEqual({
      distribution: "Debian",
      linuxPath: "/home/user",
    });
  });

  it("expands mapped WSL drives before path conversion", async () => {
    const run = vi.fn((_executable: string, args: string[]) => {
      if (_executable === "powershell.exe") {
        return Promise.resolve({ stdout: '"\\\\\\\\wsl$\\\\Debian"\r\n', stderr: "" });
      }
      throw new Error(`Unexpected executable: ${_executable} ${args.join(" ")}`);
    });

    await expect(expandMappedDrive("Z:\\home\\user\\project", run as never))
      .resolves.toBe("\\\\wsl$\\Debian\\home\\user\\project");
    await expect(toWslPath("Z:\\home\\user\\project", "Debian", "wsl.exe", run as never))
      .resolves.toBe("/home/user/project");
    expect(run).toHaveBeenCalledWith("powershell.exe", expect.arrayContaining([
      "-NoProfile",
      "-NonInteractive",
      expect.stringContaining("Get-PSDrive -Name 'Z'"),
    ]), expect.objectContaining({ windowsHide: true }));
  });

  it("keeps local drive paths when no network mapping exists", async () => {
    const run = vi.fn(() => Promise.resolve({ stdout: "null\r\n", stderr: "" }));
    await expect(expandMappedDrive("C:\\work\\repo", run as never)).resolves.toBe("C:\\work\\repo");
  });

  it("rejects a mapped drive from a different distribution", async () => {
    const run = vi.fn(() => Promise.resolve({ stdout: '"\\\\\\\\wsl$\\\\Ubuntu"', stderr: "" }));
    await expect(toWslPath("Z:\\home\\user", "Debian", "wsl.exe", run as never))
      .rejects.toThrow("belongs to WSL distribution Ubuntu");
  });

  it("rejects a workspace from a different distribution", async () => {
    await expect(toWslPath("\\\\wsl.localhost\\Ubuntu\\home\\user", "Debian"))
      .rejects.toThrow("belongs to WSL distribution Ubuntu");
  });

  it("maps Windows paths with wslpath and builds a login-shell prefix", async () => {
    const run = vi.fn((_executable: string, args: string[]) => {
      const command = args.at(-1);
      if (command === "C:\\work\\repo") return Promise.resolve({ stdout: "/mnt/c/work/repo\r\n", stderr: "" });
      return Promise.resolve({ stdout: "/home/user", stderr: "" });
    });
    const target = await resolveWslTarget({
      workspacePath: "C:\\work\\repo",
      configuredDistribution: "Debian",
      configuredExecutable: "/home/user/bin/pi",
      run: run as never,
    });

    expect(target).toMatchObject({
      distribution: "Debian",
      executable: "wsl.exe",
      piExecutable: "/home/user/bin/pi",
      piCwd: "/mnt/c/work/repo",
      spawnCwd: "C:\\work\\repo",
      executionLabel: "WSL: Debian",
    });
    expect(target.prefixArgs).toEqual(expect.arrayContaining([
      "--cd",
      "/mnt/c/work/repo",
      "--exec",
      "/bin/bash",
      "-ilc",
      'exec "$0" "$@"',
      "/home/user/bin/pi",
    ]));
  });

  it("selects the first installed distribution", async () => {
    const run = vi.fn(() => Promise.resolve({ stdout: "Debian\r\nUbuntu\r\n", stderr: "" }));
    await expect(defaultWslDistribution("wsl.exe", run as never)).resolves.toBe("Debian");
  });
});
