import { describe, expect, it } from "vitest";
import { normalizeExtensionUiEvent } from "../../src/rpc/extension-ui.js";

describe("normalizeExtensionUiEvent", () => {
  it.each(["select", "confirm", "input", "editor"] as const)("normalizes %s dialogs", (method) => {
    const event = normalizeExtensionUiEvent({
      type: "extension_ui_request",
      id: `id-${method}`,
      method,
      title: "Title",
      message: "Message",
      options: ["A", "B", 3],
      timeout: 500,
    });
    expect(event).toMatchObject({
      type: "dialog",
      request: { id: `id-${method}`, method, title: "Title", message: "Message", timeout: 500 },
    });
  });

  it("normalizes every supported fire-and-forget method", () => {
    expect(normalizeExtensionUiEvent({ type: "extension_ui_request", id: "1", method: "notify", message: "Done", notifyType: "warning" })).toEqual({ type: "notify", id: "1", message: "Done", level: "warning" });
    expect(normalizeExtensionUiEvent({ type: "extension_ui_request", id: "2", method: "setStatus", statusKey: "x", statusText: "Ready" })).toEqual({ type: "status", key: "x", text: "Ready" });
    expect(normalizeExtensionUiEvent({ type: "extension_ui_request", id: "3", method: "setWidget", widgetKey: "x", widgetLines: ["Line"], widgetPlacement: "belowEditor" })).toEqual({ type: "widget", key: "x", lines: ["Line"], placement: "belowEditor" });
    expect(normalizeExtensionUiEvent({ type: "extension_ui_request", id: "4", method: "setTitle", title: "Pi" })).toEqual({ type: "title", title: "Pi" });
    expect(normalizeExtensionUiEvent({ type: "extension_ui_request", id: "5", method: "set_editor_text", text: "Draft" })).toEqual({ type: "editorText", text: "Draft" });
  });

  it("marks unknown UI methods unsupported and ignores malformed records", () => {
    expect(normalizeExtensionUiEvent({ type: "extension_ui_request", id: "x", method: "custom" })).toEqual({ type: "unsupported", id: "x", method: "custom" });
    expect(normalizeExtensionUiEvent({ type: "extension_ui_request", method: "confirm" })).toBeUndefined();
    expect(normalizeExtensionUiEvent(null)).toBeUndefined();
  });
});
