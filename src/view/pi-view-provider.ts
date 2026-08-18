import * as vscode from "vscode";
import type { ChatEvent, ChatState } from "../chat/chat-reducer.js";
import { initialChatState, reduceChat } from "../chat/chat-reducer.js";
import type { ConnectionSnapshot, HostMessage } from "../protocol.js";
import { isWebviewMessage } from "../protocol.js";
import type { PiRuntime } from "../runtime/pi-runtime.js";

export class PiViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "pi.sidebar";
  #view: vscode.WebviewView | undefined;
  #chat: ChatState = initialChatState;

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
      switch (message.type) {
        case "ready":
          this.updateConnection(this.runtime.snapshot);
          this.#post({ type: "chat", value: this.#chat });
          break;
        case "reconnect":
          void this.reconnect();
          break;
        case "openSettings":
          void vscode.commands.executeCommand("pi.openSettings");
          break;
        case "prompt":
          void this.runtime.prompt(message.text).catch(() => undefined);
          break;
        case "abort":
          void this.runtime.abort().catch(() => undefined);
          break;
      }
    });
    void this.reconnect();
  }

  updateConnection(snapshot: ConnectionSnapshot): void {
    this.#post({ type: "connection", value: snapshot });
  }

  updateChat(event: ChatEvent): void {
    this.#chat = reduceChat(this.#chat, event);
    this.#post({ type: "chat", value: this.#chat });
  }

  #post(message: HostMessage): void {
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
