import type { SlashCommandSummary } from "../protocol.js";

const MAX_SUGGESTIONS = 8;

export function filterSlashCommands(commands: SlashCommandSummary[], draft: string): SlashCommandSummary[] {
  const match = draft.match(/^\/([^\s/]*)$/);
  if (!match) return [];
  const query = (match[1] ?? "").toLocaleLowerCase();
  return commands
    .filter((command) => command.name.toLocaleLowerCase().includes(query))
    .sort((left, right) => commandRank(left.name, query) - commandRank(right.name, query)
      || left.name.localeCompare(right.name))
    .slice(0, MAX_SUGGESTIONS);
}

export function completeSlashCommand(command: SlashCommandSummary): string {
  return `/${command.name} `;
}

function commandRank(name: string, query: string): number {
  const normalized = name.toLocaleLowerCase();
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  return 2;
}
