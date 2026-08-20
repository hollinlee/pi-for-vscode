# Changelog

## 0.0.9

- Resolve Windows mapped drives backed by `\\wsl$\\<distro>` before converting the workspace path for the WSL bridge.
- Reject mapped workspaces whose WSL distribution differs from `pi.wslDistribution`.

## 0.0.8

- Add a Windows-to-WSL bridge that launches pi RPC through `wsl.exe` from a local Windows VS Code window.
- Map Windows and WSL UNC workspace paths to Linux paths, load credentials through the WSL login shell, and list pi-owned sessions through a bounded WSL helper.
- Show the active execution environment next to the pi working directory.

## 0.0.7

- Load extension, prompt-template, and skill slash commands from the active pi RPC session.
- Show filtered command completion above the composer with descriptions, source labels, and keyboard navigation.

## 0.0.6

- Show the active pi working directory directly above the message composer.
- Move model and thinking-level controls directly below the composer so execution context stays visible while prompting.

## 0.0.5

- Resolve environment-backed provider credentials from the user's interactive login shell when the VS Code Extension Host does not inherit them.
- Import only credential variables referenced by `~/.pi/agent/models.json`; existing Extension Host values remain authoritative.

## 0.0.4

- Add a Primary Activity Bar launcher that restores Explorer and focuses Pi in the Secondary Side Bar.
- Make extension notifications dismissible; info messages expire after 5 seconds and warnings after 10 seconds, while errors remain until dismissed.

## 0.0.3

- Place the Pi view in VS Code's Secondary Side Bar so Explorer and other Primary Side Bar views remain visible on the left.

## 0.0.2

- Detect pi-node installations automatically when the Extension Host PATH omits pi.
- Report whether a missing executable comes from Windows, Linux, or WSL and guide Windows users to reopen the workspace in WSL.

## 0.0.1

- Initial VS Code Activity Bar chat for installed pi RPC runtimes.
- Streaming messages, thinking, tool states, and abort support.
- Pi-owned session creation, restore, and switching.
- Model, thinking-level, and RPC extension UI controls.
- Local Linux and Remote WSL support.
