import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "test", "vscode", "suite.cjs"),
    launchArgs: [root, "--disable-extensions"],
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
