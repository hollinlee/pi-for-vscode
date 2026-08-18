import type { ExtensionDialogRequest, ExtensionUiEvent } from "../protocol.js";
import { isRecord } from "../utils/is-record.js";

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

export function normalizeExtensionUiEvent(value: unknown): ExtensionUiEvent | undefined {
  if (!isRecord(value) || value.type !== "extension_ui_request" || typeof value.id !== "string" || typeof value.method !== "string") {
    return undefined;
  }
  const id = value.id;
  const method = value.method;
  if (DIALOG_METHODS.has(method)) {
    const request: ExtensionDialogRequest = {
      id,
      method: method as ExtensionDialogRequest["method"],
      title: boundedString(value.title) ?? titleFor(method),
      message: boundedString(value.message),
      options: Array.isArray(value.options)
        ? value.options.filter((option): option is string => typeof option === "string").slice(0, 200).map((option) => option.slice(0, 10_000))
        : undefined,
      placeholder: boundedString(value.placeholder),
      prefill: boundedString(value.prefill, 100_000),
      timeout: finiteTimeout(value.timeout),
    };
    return { type: "dialog", request };
  }
  if (method === "notify") {
    return {
      type: "notify",
      id,
      message: boundedString(value.message, 100_000) ?? "Pi extension notification",
      level: value.notifyType === "warning" || value.notifyType === "error" ? value.notifyType : "info",
    };
  }
  if (method === "setStatus" && typeof value.statusKey === "string") {
    return { type: "status", key: value.statusKey.slice(0, 500), text: boundedString(value.statusText) };
  }
  if (method === "setWidget" && typeof value.widgetKey === "string") {
    return {
      type: "widget",
      key: value.widgetKey.slice(0, 500),
      lines: Array.isArray(value.widgetLines)
        ? value.widgetLines.filter((line): line is string => typeof line === "string").slice(0, 100).map((line) => line.slice(0, 10_000))
        : undefined,
      placement: value.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
    };
  }
  if (method === "setTitle" && typeof value.title === "string") return { type: "title", title: value.title.slice(0, 500) };
  if (method === "set_editor_text" && typeof value.text === "string") return { type: "editorText", text: value.text.slice(0, 100_000) };
  return { type: "unsupported", id, method };
}

function boundedString(value: unknown, maximum = 10_000): string | undefined {
  return typeof value === "string" ? value.slice(0, maximum) : undefined;
}

function finiteTimeout(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, 86_400_000) : undefined;
}

function titleFor(method: string): string {
  return method === "confirm" ? "Confirm" : method === "select" ? "Select" : method === "editor" ? "Edit" : "Input";
}
