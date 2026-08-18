# Pi for VS Code

Use the pi coding agent installed in the current VS Code Extension Host through a native Activity Bar chat view.

## Requirements

- VS Code 1.96 or newer.
- pi 0.84.2 or newer available on `PATH`, or configured with `pi.executablePath`.
- A trusted VS Code workspace.

For WSL, open the project with **Remote - WSL**. The extension and pi then run in the same WSL environment. A normal Windows window cannot call a pi installation inside WSL.

## Features

- Streaming Markdown, thinking state, and compact tool execution details.
- Pi-owned sessions shared with terminal pi.
- Model and thinking-level controls.
- RPC-compatible extension dialogs, notifications, status, widgets, title, and editor prefill.
- Explicit connection, compatibility, process, and protocol error states.

## Usage

1. Open a trusted workspace in local Linux or Remote WSL.
2. Select the Pi icon in the Activity Bar.
3. Use the session, model, and thinking controls above the message stream.
4. Enter a prompt. Use the stop button to abort the active run.

The extension restores the active pi session for the workspace after VS Code reloads.

## Security

A trusted VS Code workspace is launched with `pi --approve`. This allows pi to load project settings, extensions, packages, skills, and other project resources. Project pi extensions execute with the current user's permissions.

The extension does not read, copy, log, or transmit pi credentials. Tool execution keeps pi's existing behavior; no additional permission layer is added.

Markdown HTML is not rendered. External links are restricted to credential-free HTTP(S) URLs and opened through VS Code. Webview messages and RPC responses are validated before use.

## Compatibility

| Environment | Status |
| --- | --- |
| VS Code Remote - WSL | Supported and tested |
| Local Linux | Supported and tested |
| Windows local | Not supported in the initial release |
| macOS local | Not validated in the initial release |
| VSCodium | Not validated in the initial release |

The RPC contract is tested against pi 0.84.2. Newer pi releases are accepted, but protocol changes may require an extension update.

## Development

```bash
npm ci
npm run verify
npm run test:vscode
npm run package
```

The VSIX is written to `pi-for-vscode-<version>.vsix`.

## License

MIT
