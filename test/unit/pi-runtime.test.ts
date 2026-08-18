import { describe, expect, it, vi } from "vitest";
import { PiRuntime, compareVersions } from "../../src/runtime/pi-runtime.js";

describe("PiRuntime", () => {
  it("publishes and retains externally supplied availability states", () => {
    const runtime = new PiRuntime();
    const changed = vi.fn();
    runtime.on("change", changed);

    runtime.show({ phase: "untrusted", message: "Trust required" });

    expect(runtime.snapshot).toEqual({ phase: "untrusted", message: "Trust required" });
    expect(changed).toHaveBeenCalledOnce();
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
