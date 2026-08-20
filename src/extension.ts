import { access } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { PiRuntime } from "./runtime/pi-runtime.js";
import {
  resolveWslTarget,
  type ExecutionEnvironment,
  type PiLaunchTarget,
} from "./runtime/pi-launch-target.js";
import { resolvePiExecutable } from "./runtime/pi-executable.js";
import { SessionStore } from "./session/session-store.js";
import { WslSessionStore } from "./session/wsl-session-store.js";
import { PiViewProvider } from "./view/pi-view-provider.js";

const ACTIVE_SESSION_KEY = "pi.activeSession";

interface ActiveSessionPointer {
  cwd: string;
  path: string;
}

export function activate(context: vscode.ExtensionContext): void {
  const runtime = new PiRuntime();
  const saved = context.workspaceState.get<ActiveSessionPointer>(ACTIVE_SESSION_KEY);
  const provider = new PiViewProvider(
    context.extensionUri,
    runtime,
    () => connect(runtime, context, runtime.snapshot.cwd ?? saved?.cwd, runtime.sessionSnapshot.activePath ?? saved?.path),
    () => createSession(runtime),
  );
  runtime.on("change", () => provider.updateConnection(runtime.snapshot));
  const unsubscribeChat = runtime.subscribeChat((event) => provider.updateChat(event));
  const unsubscribeSession = runtime.subscribeSession((snapshot) => {
    provider.updateSession(snapshot);
    if (snapshot.cwd && snapshot.activePath) {
      void context.workspaceState.update(ACTIVE_SESSION_KEY, { cwd: snapshot.cwd, path: snapshot.activePath });
    }
  });
  const unsubscribeControls = runtime.subscribeControls((snapshot) => provider.updateControls(snapshot));
  const unsubscribeExtensionUi = runtime.subscribeExtensionUi((event) => provider.updateExtensionUi(event));

  const launcher = vscode.window.createTreeView<vscode.TreeItem>("pi.launcher", {
    treeDataProvider: {
      getTreeItem: (item) => item,
      getChildren: () => [],
    },
  });
  let openingPi = false;
  const openPi = async () => {
    if (openingPi) return;
    openingPi = true;
    try {
      await vscode.commands.executeCommand("workbench.view.explorer");
      await vscode.commands.executeCommand("pi.sidebar.focus");
    } finally {
      openingPi = false;
    }
  };
  const openFromLauncher = launcher.onDidChangeVisibility(({ visible }) => {
    if (visible) void openPi();
  });
  if (launcher.visible) void openPi();

  context.subscriptions.push(
    launcher,
    openFromLauncher,
    vscode.commands.registerCommand("pi.open", openPi),
    vscode.window.registerWebviewViewProvider(PiViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("pi.refreshConnection", () =>
      connect(runtime, context, runtime.snapshot.cwd, runtime.sessionSnapshot.activePath)),
    vscode.commands.registerCommand("pi.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:hollinlee.pi-for-vscode"),
    ),
    { dispose: unsubscribeChat },
    { dispose: unsubscribeSession },
    { dispose: unsubscribeControls },
    { dispose: unsubscribeExtensionUi },
    { dispose: () => void runtime.dispose() },
  );
}

async function connect(
  runtime: PiRuntime,
  context: vscode.ExtensionContext,
  preferredCwd?: string,
  sessionPath?: string,
): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    runtime.show({ phase: "untrusted", message: "Trust this workspace before starting pi." });
    return;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = folders.find((item) => preferredCwd && path.resolve(item.uri.fsPath) === path.resolve(preferredCwd)) ?? folders[0];
  if (!folder) {
    runtime.show({ phase: "error", message: "Open a workspace folder before starting pi." });
    return;
  }
  const target = await getLaunchTarget(folder.uri.fsPath).catch((error: unknown) => {
    runtime.show({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (!target) return;
  const restorablePath = sessionPath && (target.executionLabel.startsWith("WSL:") || await pathExists(sessionPath))
    ? sessionPath
    : undefined;
  if (sessionPath && !restorablePath) await context.workspaceState.update(ACTIVE_SESSION_KEY, undefined);
  await runtime.connect(target.executable, target.piCwd, restorablePath, {
    prefixArgs: target.prefixArgs,
    spawnCwd: target.spawnCwd,
    environment: target.environment,
    executionLabel: target.executionLabel,
    sessionStore: target.sessionStore,
  });
}

async function createSession(runtime: PiRuntime): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) throw new Error("Open a workspace folder before creating a session");
  let folder: vscode.WorkspaceFolder | undefined;
  if (folders.length === 1) {
    folder = folders[0];
  } else {
    const selection = await vscode.window.showQuickPick(
      folders.map((item) => ({ label: item.name, description: item.uri.fsPath, folder: item })),
      { placeHolder: "Select the workspace folder for the new Pi session" },
    );
    folder = selection?.folder;
  }
  if (!folder) return;

  const target = await getLaunchTarget(folder.uri.fsPath).catch((error: unknown) => {
    runtime.show({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (!target) return;
  if (runtime.snapshot.phase === "ready" && runtime.snapshot.cwd === target.piCwd) {
    await runtime.newSession();
    return;
  }
  await runtime.connect(target.executable, target.piCwd, undefined, {
    prefixArgs: target.prefixArgs,
    spawnCwd: target.spawnCwd,
    environment: target.environment,
    executionLabel: target.executionLabel,
    sessionStore: target.sessionStore,
  });
}

async function getLaunchTarget(workspacePath: string): Promise<PiLaunchTarget> {
  const configuration = vscode.workspace.getConfiguration("pi");
  const executionEnvironment = configuration.get<ExecutionEnvironment>("executionEnvironment", "auto");
  const useWsl = process.platform === "win32" && executionEnvironment !== "local";
  if (executionEnvironment === "wsl" && process.platform !== "win32") {
    throw new Error("pi.executionEnvironment=wsl is only valid in a Windows Extension Host");
  }
  if (useWsl) {
    const descriptor = await resolveWslTarget({
      workspacePath,
      configuredDistribution: configuration.get<string>("wslDistribution", ""),
      configuredExecutable: configuration.get<string>("executablePath", "pi"),
    });
    const sessionStore = new WslSessionStore(descriptor.distribution, descriptor.executable);
    return { ...descriptor, environment: process.env, sessionStore };
  }

  const executable = await getExecutable();
  return {
    executable,
    prefixArgs: [],
    piExecutable: executable,
    piCwd: path.resolve(workspacePath),
    spawnCwd: path.resolve(workspacePath),
    executionLabel: vscode.env.remoteName === "wsl" ? "Remote WSL" : "Local",
    sessionStore: new SessionStore(),
  };
}

async function getExecutable(): Promise<string> {
  const configured = vscode.workspace.getConfiguration("pi").get<string>("executablePath", "pi");
  return resolvePiExecutable(configured);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function deactivate(): void {}
