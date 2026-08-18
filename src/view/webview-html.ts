export interface WebviewHtmlOptions {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src ${options.cspSource}; script-src 'nonce-${options.nonce}';">
  <link rel="stylesheet" href="${options.styleUri}">
  <title>Pi</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body>
</html>`;
}
