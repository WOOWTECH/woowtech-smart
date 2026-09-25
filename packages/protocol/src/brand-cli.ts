// The command that runs woowtech smart's CLI. The official Paseo installs
// `paseo`, so ours has its own name: both fit on one PATH, and neither app's
// "Install CLI" replaces the other's. The CLI, the daemon's messages and the
// desktop app's CLI install read it from here.

/** What people type to run the CLI. */
export const CLI_COMMAND = "woowtech-smart";

/** The file that runs the CLI on `platform`; Windows needs a .cmd trampoline. */
export function cliCommandFileName(platform: string): string {
  return platform === "win32" ? `${CLI_COMMAND}.cmd` : CLI_COMMAND;
}

/**
 * The CLI's top-level commands (packages/cli/src/cli.ts) and commander's help.
 * A CLI test keeps this list in step with the program.
 */
export const CLI_TOP_LEVEL_COMMANDS = [
  "agent",
  "archive",
  "attach",
  "clone",
  "daemon",
  "delete",
  "heartbeat",
  "help",
  "hooks",
  "hub",
  "import",
  "inspect",
  "logs",
  "ls",
  "onboard",
  "pair",
  "permit",
  "plugin",
  "project",
  "provider",
  "reload",
  "restart",
  "run",
  "schedule",
  "script",
  "send",
  "speech",
  "start",
  "status",
  "stop",
  "terminal",
  "wait",
  "workspace",
  "worktree",
] as const;

// `paseo` where it starts a command line: at the start of the text or after a
// space, quote, backtick or parenthesis, and followed by a known command or a
// flag. Paths, file names, variables, packages, links and an agent that happens
// to be called paseo are left alone.
const UPSTREAM_COMMAND = new RegExp(
  `(?<=^|[\\s"'\`(])paseo(?= (?:(?:${CLI_TOP_LEVEL_COMMANDS.join("|")})(?![\\w-])|-))`,
  "g",
);

/** `text` with upstream's `paseo <command>` written as our command. */
export function withCliCommand(text: string): string {
  return text.replace(UPSTREAM_COMMAND, CLI_COMMAND);
}
