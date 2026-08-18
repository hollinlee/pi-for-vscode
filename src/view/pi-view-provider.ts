import * as vscode from "vscode";
import type { ChatEvent, ChatState } from "../chat/chat-reducer.js";
import { initialChatState, reduceChat } from "../chat/chat-reducer.js";
import type {
  ConnectionSnapshot,
  ControlsSnapshot,
  ExtensionUiEvent,
  HostMessage,
  SessionSnapshot,
} from "../protocol.js";
import { isWebviewMessage } from "../protocol.js";
import type { PiRuntime } from "../runtime/pi-runtime.js";
import { buildWebviewHtml } from "./webview-html.js";

export class PiViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "pi.sidebar";
  #view: vscode.WebviewView | undefined;
  #chat: ChatState = initialChatState;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly runtime: PiRuntime,
    private readonly reconnect: () => Promise<void>,
    private readonly createSession: () => Promise<void>,
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
          this.updateSession(this.runtime.sessionSnapshot);
          this.updateControls(this.runtime.controlsSnapshot);
          break;
        case "reconnect":
          void this.#run(this.reconnect());
          break;
        case "openSettings":
          void vscode.commands.executeCommand("pi.openSettings");
          break;
        case "newSession":
          void this.#run(this.createSession());
          break;
        case "refreshSessions":
          void this.#run(this.runtime.refreshSessions());
          break;
        case "switchSession":
          void this.#run(this.runtime.switchSession(message.path));
          break;
        case "setModel":
          void this.#run(this.runtime.setModel(message.provider, message.modelId));
          break;
        case "setThinkingLevel":
          void this.#run(this.runtime.setThinkingLevel(message.level));
          break;
        case "extensionUiResponse":
          void this.#run(this.runtime.respondExtensionUi(message.id, message.response));
          break;
        case "openExternal":
          void this.#run((async () => {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          })());
          break;
        case "prompt":
          void this.#run(this.runtime.prompt(message.text));
          break;
        case "abort":
          void this.#run(this.runtime.abort());
          break;
      }
    });
    view.onDidDispose(() => {
      if (this.#view === view) this.#view = undefined;
      void this.runtime.cancelExtensionUi();
    });
    void this.#run(this.reconnect());
  }

  updateConnection(snapshot: ConnectionSnapshot): void {
    this.#post({ type: "connection", value: snapshot });
  }

  updateChat(event: ChatEvent): void {
    this.#chat = reduceChat(this.#chat, event);
    this.#post({ type: "chat", value: this.#chat });
  }

  updateSession(snapshot: SessionSnapshot): void {
    this.#post({ type: "session", value: snapshot });
  }

  updateControls(snapshot: ControlsSnapshot): void {
    this.#post({ type: "controls", value: snapshot });
  }

  updateExtensionUi(event: ExtensionUiEvent): void {
    if (event.type === "title" && this.#view) this.#view.title = event.title.slice(0, 100);
    this.#post({ type: "extensionUi", value: event });
  }

  async #run(operation: Promise<void>): Promise<void> {
    try {
      await operation;
    } catch (error) {
      this.updateChat({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  #post(message: HostMessage): void {
    void this.#view?.webview.postMessage(message);
  }

  #html(webview: vscode.Webview): string {
    const nonce = createNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"));
    return buildWebviewHtml({
      nonce,
      cspSource: webview.cspSource,
      scriptUri: script.toString(),
      styleUri: style.toString(),
    });
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
