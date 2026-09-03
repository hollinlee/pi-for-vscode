import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isRecord } from "../utils/is-record.js";

const execFileAsync = promisify(execFile);
const ENV_REFERENCE = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

export interface PiEnvironmentOptions {
  baseEnvironment?: NodeJS.ProcessEnv;
  homeDir?: string;
  shell?: string;
  modelsPath?: string;
}

export async function resolvePiEnvironment(options: PiEnvironmentOptions = {}): Promise<NodeJS.ProcessEnv> {
  const baseEnvironment = { ...(options.baseEnvironment ?? process.env) };
  const homeDir = options.homeDir ?? os.homedir();
  const modelsPath = options.modelsPath ?? path.join(homeDir, ".pi", "agent", "models.json");
  const requiredNames = await readCredentialEnvironmentNames(modelsPath);
  const missingNames = [...requiredNames].filter((name) => !baseEnvironment[name]);
  if (missingNames.length === 0) return baseEnvironment;

  const shell = options.shell ?? baseEnvironment.SHELL ?? "/bin/sh";
  try {
    const { stdout } = await execFileAsync(shell, ["-ilc", "env -0"], {
      cwd: homeDir,
      encoding: "buffer",
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    const shellEnvironment = parseNullDelimitedEnvironment(stdout);
    for (const name of missingNames) {
      const value = shellEnvironment[name];
      if (value) baseEnvironment[name] = value;
    }
  } catch {
    // Pi will return its normal provider-auth error if the login shell cannot supply a credential.
  }
  return baseEnvironment;
}

export async function readCredentialEnvironmentNames(modelsPath: string): Promise<Set<string>> {
  try {
    const value: unknown = JSON.parse(await readFile(modelsPath, "utf8"));
    if (!isRecord(value) || !isRecord(value.providers)) return new Set();
    const names = new Set<string>();
    for (const provider of Object.values(value.providers)) {
      if (!isRecord(provider) || typeof provider.apiKey !== "string") continue;
      const match = provider.apiKey.match(ENV_REFERENCE);
      const name = match?.[1];
      if (name) names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

function parseNullDelimitedEnvironment(value: Buffer): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const entry of value.toString("utf8").split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}
