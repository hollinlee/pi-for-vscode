import * as vscode from "vscode";
import type { ConnectionSnapshot, HostMessage } from "../protocol.js";
import { isWebviewMessage } from "../protocol.js";
import type { PiRuntime } from "../runtime/pi-runtime.js";

export class PiViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "pi.sidebar";
  #view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly runtime: PiRuntime,
    private readonly reconnect: () => Promise<void>,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = this.#html(view.webview);
    view.webview.onDidReceiveMessage((message: unknown) => {
      if (!isWebviewMessage(message)) return;
      if (message.type === "ready") this.update(this.runtime.snapshot);
      if (message.type === "reconnect") void this.reconnect();
      if (message.type === "openSettings") void vscode.commands.executeCommand("pi.openSettings");
    });
    void this.reconnect();
  }

  update(snapshot: ConnectionSnapshot): void {
    const message: HostMessage = { type: "connection", value: snapshot };
    void this.#view?.webview.postMessage(message);
  }

  #html(webview: vscode.Webview): string {
    const nonce = createNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style.toString()}">
  <title>Pi</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
