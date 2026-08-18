import { spawn } from "node:child_process";

const child = spawn("pi", ["--mode", "rpc", "--approve", "--no-extensions", "--no-session"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "inherit"],
});
let buffer = "";
const timeout = setTimeout(() => finish(new Error("pi RPC smoke timed out")), 20_000);

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    const message = JSON.parse(line);
    if (message.type === "response" && message.command === "get_state" && message.success === true) {
      console.log(JSON.stringify({
        rpc: "ready",
        sessionId: message.data.sessionId,
        model: message.data.model ? `${message.data.model.provider}/${message.data.model.id}` : null,
      }));
      finish();
      return;
    }
    newline = buffer.indexOf("\n");
  }
});
child.once("error", finish);
child.stdin.write(`${JSON.stringify({ id: "smoke-state", type: "get_state" })}\n`);

function finish(error) {
  if (finish.completed) return;
  finish.completed = true;
  clearTimeout(timeout);
  child.kill("SIGTERM");
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
