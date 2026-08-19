import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  engines?: { vscode?: string };
  contributes?: {
    viewsContainers?: {
      activitybar?: unknown[];
      secondarySidebar?: Array<{ id?: string }>;
    };
  };
}

describe("extension manifest layout", () => {
  it("places Pi in the Secondary Side Bar without occupying the Activity Bar", async () => {
    const manifest = JSON.parse(
      await readFile(path.resolve("package.json"), "utf8"),
    ) as ExtensionManifest;

    expect(manifest.engines?.vscode).toBe("^1.106.0");
    expect(manifest.contributes?.viewsContainers?.activitybar).toBeUndefined();
    expect(manifest.contributes?.viewsContainers?.secondarySidebar).toEqual([
      expect.objectContaining({ id: "pi-for-vscode" }),
    ]);
  });
});
