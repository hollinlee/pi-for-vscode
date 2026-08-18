import * as vscode from "vscode";
import { PiRuntime } from "./runtime/pi-runtime.js";
import { PiViewProvider } from "./view/pi-view-provider.js";

export function activate(context: vscode.ExtensionContext): void {
  const runtime = new PiRuntime();
  const provider = new PiViewProvider(context.extensionUri, runtime, () => connect(runtime));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PiViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("pi.refreshConnection", () => connect(runtime)),
    vscode.commands.registerCommand("pi.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:hollinlee.pi-for-vscode"),
    ),
    { dispose: () => void runtime.dispose() },
  );

  runtime.on("change", () => provider.update(runtime.snapshot));
}

async function connect(runtime: PiRuntime): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    runtime.show({
      phase: "untrusted",
      message: "Trust this workspace before starting pi.",
    });
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    runtime.show({
      phase: "error",
      message: "Open a workspace folder before starting pi.",
    });
    return;
  }
  const executable = vscode.workspace.getConfiguration("pi").get<string>("executablePath", "pi").trim() || "pi";
  await runtime.connect(executable, folder.uri.fsPath);
}

export function deactivate(): void {}
