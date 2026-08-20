import { describe, expect, it, vi } from "vitest";
import {
  defaultWslDistribution,
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
