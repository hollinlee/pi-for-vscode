import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SessionCatalog } from "../session/session-store.js";

const execFileAsync = promisify(execFile);

export type ExecutionEnvironment = "auto" | "local" | "wsl";

export interface PiLaunchTarget {
  executable: string;
  prefixArgs: string[];
  piExecutable: string;
  piCwd: string;
  spawnCwd?: string;
  environment?: NodeJS.ProcessEnv;
  executionLabel: string;
  sessionStore: SessionCatalog;
}

export interface WslTargetOptions {
  configuredDistribution?: string;
  configuredExecutable?: string;
  workspacePath: string;
  wslExecutable?: string;
  run?: typeof execFileAsync;
}

export interface WslTargetDescriptor {
  distribution: string;
  executable: string;
  prefixArgs: string[];
  piExecutable: string;
  piCwd: string;
  spawnCwd: string;
  executionLabel: string;
}

export async function resolveWslTarget(options: WslTargetOptions): Promise<WslTargetDescriptor> {
  const wslExecutable = options.wslExecutable ?? "wsl.exe";
  const run = options.run ?? execFileAsync;
  const distribution = options.configuredDistribution?.trim() || await defaultWslDistribution(wslExecutable, run);
  const piCwd = await toWslPath(options.workspacePath, distribution, wslExecutable, run);
  const piExecutable = options.configuredExecutable?.trim() || "pi";
  return {
    distribution,
    executable: wslExecutable,
    prefixArgs: [
      "-d", distribution,
      "--cd", piCwd,
      "--exec", "/bin/bash", "-ilc", 'exec "$0" "$@"', piExecutable,
    ],
    piExecutable,
    piCwd,
    spawnCwd: options.workspacePath,
    executionLabel: `WSL: ${distribution}`,
  };
}

export async function defaultWslDistribution(
  wslExecutable = "wsl.exe",
  run: typeof execFileAsync = execFileAsync,
): Promise<string> {
  try {
    const { stdout } = await run(wslExecutable, ["--list", "--quiet"], { timeout: 5_000, windowsHide: true });
    const distribution = cleanWslOutput(stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (distribution) return distribution;
  } catch (error) {
    throw new Error(`Unable to list WSL distributions: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error("No WSL distribution is installed. Install WSL or set pi.executionEnvironment to local.");
}

export async function toWslPath(
  workspacePath: string,
  distribution: string,
  wslExecutable = "wsl.exe",
  run: typeof execFileAsync = execFileAsync,
): Promise<string> {
  const expandedWorkspacePath = await expandMappedDrive(workspacePath, run);
  const unc = parseWslUncPath(expandedWorkspacePath);
  if (unc) {
    if (unc.distribution.toLocaleLowerCase() !== distribution.toLocaleLowerCase()) {
      throw new Error(`Workspace belongs to WSL distribution ${unc.distribution}, not ${distribution}`);
    }
    return unc.linuxPath;
  }
  const converted = await runWsl(wslExecutable, distribution, ["wslpath", "-a", expandedWorkspacePath], run);
  if (!converted.startsWith("/")) throw new Error(`Unable to map workspace path into WSL: ${workspacePath}`);
  return converted;
}

export async function expandMappedDrive(
  workspacePath: string,
  run: typeof execFileAsync = execFileAsync,
): Promise<string> {
  const match = workspacePath.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match?.[1]) return workspacePath;
  const drive = match[1].toUpperCase();
  try {
    const { stdout } = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-PSDrive -Name '${drive}' -PSProvider FileSystem).DisplayRoot | ConvertTo-Json -Compress`,
    ], {
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    const displayRoot: unknown = JSON.parse(cleanWslOutput(stdout));
    if (typeof displayRoot !== "string" || !displayRoot.startsWith("\\\\")) return workspacePath;
    const suffix = (match[2] ?? "").replaceAll("/", "\\");
    return `${displayRoot.replace(/[\\/]+$/, "")}\\${suffix}`;
  } catch {
    return workspacePath;
  }
}

export function parseWslUncPath(value: string): { distribution: string; linuxPath: string } | undefined {
  const normalized = value.replaceAll("/", "\\");
  const match = normalized.match(/^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(.*)$/i);
  if (!match?.[1]) return undefined;
  const suffix = (match[2] ?? "").replaceAll("\\", "/");
  return { distribution: match[1], linuxPath: suffix || "/" };
}

async function runWsl(
  wslExecutable: string,
  distribution: string,
  args: string[],
  run: typeof execFileAsync,
): Promise<string> {
  const { stdout } = await run(wslExecutable, ["-d", distribution, "--exec", ...args], {
    timeout: 5_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return cleanWslOutput(stdout).trim();
}

function cleanWslOutput(value: string): string {
  return value.replaceAll("\0", "").replaceAll("\r", "");
}
