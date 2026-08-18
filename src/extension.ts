import { access } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { PiRuntime } from "./runtime/pi-runtime.js";
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

  context.subscriptions.push(
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
  const executable = getExecutable();
  const restorablePath = sessionPath && await pathExists(sessionPath) ? sessionPath : undefined;
  if (sessionPath && !restorablePath) await context.workspaceState.update(ACTIVE_SESSION_KEY, undefined);
  await runtime.connect(executable, folder.uri.fsPath, restorablePath);
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

  const targetCwd = path.resolve(folder.uri.fsPath);
  if (runtime.snapshot.phase === "ready" && runtime.snapshot.cwd && path.resolve(runtime.snapshot.cwd) === targetCwd) {
    await runtime.newSession();
    return;
  }
  await runtime.connect(getExecutable(), targetCwd);
}

function getExecutable(): string {
  return vscode.workspace.getConfiguration("pi").get<string>("executablePath", "pi").trim() || "pi";
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
