import { describe, expect, it } from "vitest";
import type { SlashCommandSummary } from "../../src/protocol.js";
import { completeSlashCommand, filterSlashCommands } from "../../src/webview/slash-commands.js";

const commands: SlashCommandSummary[] = [
  { name: "plan", description: "Plan work", source: "prompt", location: "user" },
  { name: "grill", description: "Align intent", source: "extension" },
  { name: "skill:remote-devices", description: "Remote devices", source: "skill", location: "user" },
  { name: "regression", source: "extension" },
];

describe("slash command completion", () => {
  it("shows all commands for a bare slash and ranks prefix matches", () => {
    expect(filterSlashCommands(commands, "/").map((command) => command.name)).toEqual([
      "grill",
      "plan",
      "regression",
      "skill:remote-devices",
    ]);
    expect(filterSlashCommands(commands, "/gr").map((command) => command.name)).toEqual([
      "grill",
      "regression",
    ]);
  });

  it("does not suggest after command arguments or for normal prompts", () => {
    expect(filterSlashCommands(commands, "/grill context")).toEqual([]);
    expect(filterSlashCommands(commands, "use /grill")).toEqual([]);
    expect(filterSlashCommands(commands, "hello")).toEqual([]);
  });

  it("bounds suggestions and completes without executing", () => {
    const many = Array.from({ length: 12 }, (_, index): SlashCommandSummary => ({
      name: `command-${index}`,
      source: "extension",
    }));
    expect(filterSlashCommands(many, "/command")).toHaveLength(8);
    expect(completeSlashCommand(commands[1]!)).toBe("/grill ");
  });
});
