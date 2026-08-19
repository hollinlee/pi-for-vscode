const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("hollinlee.pi-for-vscode");
  assert.ok(extension, "development extension is registered");
  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("pi.open"));
  assert.ok(commands.includes("pi.refreshConnection"));
  assert.ok(commands.includes("pi.openSettings"));

  await vscode.commands.executeCommand("pi.refreshConnection");
}

module.exports = { run };
