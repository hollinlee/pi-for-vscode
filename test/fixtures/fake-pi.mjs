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
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const request = JSON.parse(buffer.slice(0, newline).replace(/\r$/, ""));
    buffer = buffer.slice(newline + 1);
    if (request.type === "get_state") {
      respond(request, true, { isStreaming: false, sessionId, sessionFile });
    }
    if (request.type === "get_messages") {
      respond(request, true, { messages: readMessages(sessionFile) });
    }
    if (request.type === "prompt") {
      respond(request, true);
      process.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
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
