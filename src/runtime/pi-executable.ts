import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ExecutableEnvironment {
  homeDir?: string;
  path?: string;
  platform?: NodeJS.Platform;
}

export async function resolvePiExecutable(
  configured: string,
  environment: ExecutableEnvironment = {},
): Promise<string> {
  const executable = configured.trim() || "pi";
  const platform = environment.platform ?? process.platform;

  if (platform === "win32" && looksLikePosixAbsolutePath(executable)) {
    throw new Error(
      `pi executable is a WSL/Linux path, but this extension is running on Windows: ${executable}. `
      + "Open the project with 'WSL: Reopen Folder in WSL' and install Pi for VS Code in WSL.",
    );
  }

  if (path.isAbsolute(executable)) {
    if (await isExecutable(executable)) return executable;
    throw missingExecutableError(executable, platform, environment.path);
  }

  const fromPath = await findOnPath(executable, environment.path ?? process.env.PATH, platform);
  if (fromPath) return fromPath;

  if (executable === "pi" && platform !== "win32") {
    const homeDir = environment.homeDir ?? os.homedir();
    const piNodeExecutable = path.join(homeDir, ".local", "share", "pi-node", "current", "bin", "pi");
    if (await isExecutable(piNodeExecutable)) return piNodeExecutable;
  }

  throw missingExecutableError(executable, platform, environment.path ?? process.env.PATH);
}

async function findOnPath(
  executable: string,
  pathValue: string | undefined,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  if (!pathValue) return undefined;
  const extensions = platform === "win32" ? windowsExecutableExtensions() : [""];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function windowsExecutableExtensions(): string[] {
  return (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function looksLikePosixAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}

function missingExecutableError(executable: string, platform: NodeJS.Platform, pathValue: string | undefined): Error {
  const remoteHint = platform === "win32"
    ? " To use pi installed in WSL, run 'WSL: Reopen Folder in WSL'."
    : " Configure pi.executablePath or install pi in this environment.";
  return new Error(
    `pi executable not found in the ${platform} Extension Host: ${executable}.`
    + `${remoteHint} Extension Host PATH: ${pathValue || "(empty)"}`,
  );
}
