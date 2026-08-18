#!/usr/bin/env node

if (process.argv.includes("--version")) {
  process.stdout.write("0.84.2\n");
  process.exit(0);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const request = JSON.parse(buffer.slice(0, newline).replace(/\r$/, ""));
    buffer = buffer.slice(newline + 1);
    if (request.type === "get_state") respond(request, true, { isStreaming: false, sessionId: "runtime-fixture" });
    if (request.type === "prompt") {
      respond(request, true);
      process.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    }
    if (request.type === "abort") respond(request, false, undefined, "abort failed");
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
