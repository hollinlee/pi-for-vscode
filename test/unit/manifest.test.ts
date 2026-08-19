import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  engines?: { vscode?: string };
  activationEvents?: string[];
  contributes?: {
    viewsContainers?: {
      activitybar?: Array<{ id?: string }>;
      secondarySidebar?: Array<{ id?: string }>;
    };
    views?: Record<string, Array<{ id?: string }>>;
    commands?: Array<{ command?: string }>;
  };
}

describe("extension manifest layout", () => {
  it("keeps a left launcher while placing the Pi chat in the Secondary Side Bar", async () => {
    const manifest = JSON.parse(
      await readFile(path.resolve("package.json"), "utf8"),
    ) as ExtensionManifest;

    expect(manifest.engines?.vscode).toBe("^1.106.0");
    expect(manifest.activationEvents).toContain("onView:pi.launcher");
    expect(manifest.contributes?.viewsContainers?.activitybar).toEqual([
      expect.objectContaining({ id: "pi-for-vscode-launcher" }),
    ]);
    expect(manifest.contributes?.viewsContainers?.secondarySidebar).toEqual([
      expect.objectContaining({ id: "pi-for-vscode" }),
    ]);
    expect(manifest.contributes?.views?.["pi-for-vscode-launcher"]).toEqual([
      expect.objectContaining({ id: "pi.launcher" }),
    ]);
    expect(manifest.contributes?.commands).toContainEqual(expect.objectContaining({ command: "pi.open" }));
  });
});
