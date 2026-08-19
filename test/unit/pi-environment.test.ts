import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCredentialEnvironmentNames, resolvePiEnvironment } from "../../src/runtime/pi-environment.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolvePiEnvironment", () => {
  it("finds environment variable references in pi provider configuration", async () => {
    const root = await temporaryRoot();
    const modelsPath = path.join(root, "models.json");
    await writeFile(modelsPath, JSON.stringify({
      providers: {
        lingsuan: { apiKey: "$LINGSUAN_OPENAI" },
        literal: { apiKey: "literal-key" },
        compiler: { apiKey: "$QWEN_API_KEY" },
      },
    }));

    await expect(readCredentialEnvironmentNames(modelsPath)).resolves.toEqual(
      new Set(["LINGSUAN_OPENAI", "QWEN_API_KEY"]),
    );
  });

  it("imports only missing credentials from a login shell", async () => {
    const root = await temporaryRoot();
    const modelsPath = path.join(root, "models.json");
    const shellPath = path.join(root, "shell");
    await writeFile(modelsPath, JSON.stringify({ providers: { lingsuan: { apiKey: "$LINGSUAN_OPENAI" } } }));
    await writeFile(shellPath, "#!/bin/sh\nprintf 'LINGSUAN_OPENAI=from-login-shell\\0OTHER=value\\0'\n");
    await chmod(shellPath, 0o755);

    const environment = await resolvePiEnvironment({
      baseEnvironment: { PATH: "/usr/bin", LINGSUAN_OPENAI: undefined, OTHER: "existing" },
      homeDir: root,
      modelsPath,
      shell: shellPath,
    });

    expect(environment.LINGSUAN_OPENAI).toBe("from-login-shell");
    expect(environment.OTHER).toBe("existing");
    expect(environment.PATH).toBe("/usr/bin");
  });

  it("does not start a login shell when required credentials are already present", async () => {
    const root = await temporaryRoot();
    const modelsPath = path.join(root, "models.json");
    await writeFile(modelsPath, JSON.stringify({ providers: { lingsuan: { apiKey: "$LINGSUAN_OPENAI" } } }));

    await expect(resolvePiEnvironment({
      baseEnvironment: { LINGSUAN_OPENAI: "already-present" },
      homeDir: root,
      modelsPath,
      shell: "/definitely/missing/shell",
    })).resolves.toMatchObject({ LINGSUAN_OPENAI: "already-present" });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-environment-"));
  roots.push(root);
  return root;
}
