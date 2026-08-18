import { describe, expect, it } from "vitest";
import { initialExtensionUiState, reduceExtensionUi } from "../../src/webview/extension-ui-reducer.js";

describe("reduceExtensionUi", () => {
  it("queues and dismisses dialogs without duplicates", () => {
    const request = { id: "one", method: "confirm" as const, title: "Confirm" };
    let state = reduceExtensionUi(initialExtensionUiState, { type: "dialog", request });
    state = reduceExtensionUi(state, { type: "dialog", request });
    expect(state.dialogs).toEqual([request]);
    expect(reduceExtensionUi(state, { type: "dismiss", id: "one" }).dialogs).toEqual([]);
  });

  it("updates fire-and-forget UI state and degrades unsupported methods", () => {
    let state = reduceExtensionUi(initialExtensionUiState, { type: "status", key: "x", text: "Ready" });
    state = reduceExtensionUi(state, { type: "widget", key: "w", lines: ["Line"], placement: "aboveEditor" });
    state = reduceExtensionUi(state, { type: "editorText", text: "Draft" });
    state = reduceExtensionUi(state, { type: "unsupported", id: "u", method: "custom" });
    expect(state.statuses).toEqual({ x: "Ready" });
    expect(state.widgets.w).toEqual({ lines: ["Line"], placement: "aboveEditor" });
    expect(state.editorText).toEqual({ revision: 1, text: "Draft" });
    expect(state.notifications[0]?.message).toContain("custom");

    state = reduceExtensionUi(state, { type: "status", key: "x" });
    state = reduceExtensionUi(state, { type: "widget", key: "w", placement: "aboveEditor" });
    expect(state.statuses).toEqual({});
    expect(state.widgets).toEqual({});
  });

  it("bounds notifications to the latest four", () => {
    const state = Array.from({ length: 6 }, (_, index) => index).reduce(
      (current, index) => reduceExtensionUi(current, { type: "notify", id: String(index), message: String(index), level: "info" }),
      initialExtensionUiState,
    );
    expect(state.notifications.map((item) => item.id)).toEqual(["2", "3", "4", "5"]);
  });
});
