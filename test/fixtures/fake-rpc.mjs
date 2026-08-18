let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    const request = JSON.parse(line);
    if (request.type === "never") {
      newline = buffer.indexOf("\n");
      continue;
    }
    if (request.type === "invalid") {
      process.stdout.write("{invalid json}\n");
      newline = buffer.indexOf("\n");
      continue;
    }
    if (request.type === "malformed_response") {
      process.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: "yes" })}\n`);
      newline = buffer.indexOf("\n");
      continue;
    }
    if (request.type === "incomplete_exit") {
      process.stdout.write('{"type":"partial"');
      setTimeout(() => process.exit(0), 5);
      newline = buffer.indexOf("\n");
      continue;
    }
    if (request.type === "emit_event") {
      process.stdout.write(`${JSON.stringify({ type: "fixture_event", value: 42 })}\n`);
    }
    if (request.type === "get_state" || request.type === "emit_event") {
      const response = {
        id: request.id,
        type: "response",
        command: request.type,
        success: true,
        data: { isStreaming: false, sessionId: "fixture" },
      };
      const encoded = Buffer.from(`${JSON.stringify(response)}\n`);
      process.stdout.write(encoded.subarray(0, 5));
      setTimeout(() => process.stdout.write(encoded.subarray(5)), 5);
    }
    newline = buffer.indexOf("\n");
  }
});

process.on("SIGTERM", () => process.exit(0));
