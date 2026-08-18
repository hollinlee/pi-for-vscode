import { describe, expect, it } from "vitest";
import { buildWebviewHtml } from "../../src/view/webview-html.js";

describe("buildWebviewHtml", () => {
  it("uses a nonce-only script policy and blocks base/form navigation", () => {
    const html = buildWebviewHtml({
      nonce: "nonce-123",
      cspSource: "vscode-webview://source",
      scriptUri: "vscode-webview://source/webview.js",
      styleUri: "vscode-webview://source/webview.css",
    });

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("script-src 'nonce-nonce-123'");
    expect(html).toContain('script nonce="nonce-123"');
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toContain("https:");
  });
});
