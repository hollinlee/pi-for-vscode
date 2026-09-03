import type { ExtensionDialogRequest, ExtensionUiEvent } from "../protocol.js";

export interface ExtensionNotification {
  id: string;
  message: string;
  level: "info" | "warning" | "error";
}

export interface ExtensionUiState {
  dialogs: ExtensionDialogRequest[];
  notifications: ExtensionNotification[];
  statuses: Record<string, string>;
  widgets: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  editorText?: { revision: number; text: string };
  title?: string;
}

export const initialExtensionUiState: ExtensionUiState = {
  dialogs: [],
  notifications: [],
  statuses: {},
  widgets: {},
};

export function dismissExtensionNotification(state: ExtensionUiState, id: string): ExtensionUiState {
  return { ...state, notifications: state.notifications.filter((notification) => notification.id !== id) };
}

export function notificationTimeout(level: ExtensionNotification["level"]): number | undefined {
  if (level === "info") return 5_000;
  if (level === "warning") return 10_000;
  return undefined;
}

export function reduceExtensionUi(state: ExtensionUiState, event: ExtensionUiEvent): ExtensionUiState {
  switch (event.type) {
    case "dialog":
      return state.dialogs.some((dialog) => dialog.id === event.request.id)
        ? state
        : { ...state, dialogs: [...state.dialogs, event.request] };
    case "dismiss":
      return { ...state, dialogs: state.dialogs.filter((dialog) => dialog.id !== event.id) };
    case "notify":
      return {
        ...state,
        notifications: [...state.notifications.filter((item) => item.id !== event.id), event].slice(-4),
      };
    case "status": {
      const statuses = { ...state.statuses };
      if (event.text) statuses[event.key] = event.text;
      else delete statuses[event.key];
      return { ...state, statuses };
    }
    case "widget": {
      const widgets = { ...state.widgets };
      if (event.lines) widgets[event.key] = { lines: event.lines, placement: event.placement };
      else delete widgets[event.key];
      return { ...state, widgets };
    }
    case "title":
      return { ...state, title: event.title };
    case "editorText":
      return { ...state, editorText: { revision: (state.editorText?.revision ?? 0) + 1, text: event.text } };
    case "unsupported":
      return {
        ...state,
        notifications: [...state.notifications, {
          id: event.id,
          message: `Unsupported extension UI: ${event.method}`,
          level: "warning" as const,
        }].slice(-4),
      };
  }
}
