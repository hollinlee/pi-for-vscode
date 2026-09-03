#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

if (process.argv.includes("--version")) {
  process.stdout.write("0.84.2\n");
  process.exit(0);
}

const sessionArgument = process.argv.indexOf("--session");
let sessionFile = sessionArgument >= 0 ? process.argv[sessionArgument + 1] : "/tmp/runtime-new.jsonl";
let sessionId = readSessionId(sessionFile) ?? "runtime-new";
let model = { provider: "fixture", id: "model-a", name: "Fixture A" };
let thinkingLevel = "medium";
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const request = JSON.parse(buffer.slice(0, newline).replace(/\r$/, ""));
    buffer = buffer.slice(newline + 1);
    if (request.type === "get_state") {
      respond(request, true, { isStreaming: false, sessionId, sessionFile, model, thinkingLevel });
    }
    if (request.type === "get_available_models") {
      respond(request, true, { models: [
        { provider: "fixture", id: "model-a", name: "Fixture A" },
        { provider: "fixture", id: "model-b", name: "Fixture B" },
      ] });
    }
    if (request.type === "get_available_thinking_levels") {
      respond(request, true, { levels: ["off", "low", "medium", "high"] });
    }
    if (request.type === "get_commands") {
      respond(request, true, { commands: [
        { name: "grill", description: "Align intent before implementation", source: "extension" },
        { name: "plan", description: "Create an implementation plan", source: "prompt", location: "user" },
        { name: "skill:remote-devices", description: "Operate remote devices", source: "skill", location: "user" },
      ] });
    }
    if (request.type === "set_model") {
      model = { provider: request.provider, id: request.modelId, name: request.modelId === "model-b" ? "Fixture B" : request.modelId };
      respond(request, true, model);
    }
    if (request.type === "set_thinking_level") {
      thinkingLevel = request.level;
      respond(request, true);
    }
    if (request.type === "get_messages") {
      respond(request, true, { messages: readMessages(sessionFile) });
    }
    if (request.type === "prompt") {
      respond(request, true);
      if (request.message === "protocol-error") {
        process.stdout.write("{invalid json}\n");
      } else if (request.message === "crash") {
        setTimeout(() => process.exit(17), 5);
      } else {
        process.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
        emitUiForPrompt(request.message);
      }
    }
    if (request.type === "extension_ui_response") {
      process.stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: `notify-${request.id}`, method: "notify", message: JSON.stringify(request), notifyType: "info" })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    }
    if (request.type === "abort") respond(request, false, undefined, "abort failed");
    if (request.type === "switch_session") {
      sessionFile = request.sessionPath;
      sessionId = readSessionId(sessionFile) ?? path.basename(sessionFile);
      respond(request, true, { cancelled: false });
    }
    if (request.type === "new_session") {
      sessionId = "runtime-new";
      sessionFile = "/tmp/runtime-new.jsonl";
      respond(request, true, { cancelled: false });
    }
    newline = buffer.indexOf("\n");
  }
});
process.on("SIGTERM", () => process.exit(0));

function emitUiForPrompt(message) {
  const method = typeof message === "string" && message.startsWith("ui-") ? message.slice(3) : undefined;
  if (method === "confirm") sendUi({ id: "dialog-confirm", method, title: "Confirm?", message: "Continue" });
  if (method === "select") sendUi({ id: "dialog-select", method, title: "Select", options: ["A", "B"] });
  if (method === "input") sendUi({ id: "dialog-input", method, title: "Input", placeholder: "value" });
  if (method === "editor") sendUi({ id: "dialog-editor", method, title: "Editor", prefill: "line 1\nline 2" });
  if (method === "timeout") sendUi({ id: "dialog-timeout", method: "confirm", title: "Timeout", timeout: 25 });
  if (method === "fire") {
    sendUi({ id: "notify-1", method: "notify", message: "Done", notifyType: "warning" });
    sendUi({ id: "status-1", method: "setStatus", statusKey: "fixture", statusText: "Ready" });
    sendUi({ id: "widget-1", method: "setWidget", widgetKey: "fixture", widgetLines: ["Line 1"], widgetPlacement: "belowEditor" });
    sendUi({ id: "title-1", method: "setTitle", title: "Fixture title" });
    sendUi({ id: "editor-1", method: "set_editor_text", text: "Prefilled" });
    process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  }
}

function sendUi(request) {
  process.stdout.write(`${JSON.stringify({ type: "extension_ui_request", ...request })}\n`);
}

function respond(request, success, data, error) {
  process.stdout.write(`${JSON.stringify({
    id: request.id,
    type: "response",
    command: request.type,
    success,
    data,
    error,
  })}\n`);
}

function readEntries(file) {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function readSessionId(file) {
  const header = readEntries(file).find((entry) => entry.type === "session");
  return header?.id;
}

function readMessages(file) {
  return readEntries(file).filter((entry) => entry.type === "message").map((entry) => entry.message);
}
