import { CLI_TOP_LEVEL_COMMANDS } from "@getpaseo/protocol/brand-cli";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createCli } from "./cli.js";
import { renderError } from "./output/render.js";

function withSubcommands(command: Command): Command[] {
  return [command, ...command.commands.flatMap(withSubcommands)];
}

function commandLine(command: Command): string {
  return command.parent ? `${commandLine(command.parent)} ${command.name()}` : command.name();
}

function subcommand(parent: Command | undefined, name: string): Command | undefined {
  return parent?.commands.find((command) => command.name() === name);
}

function namesUpstream(line: string): boolean {
  return /\bPaseo\b(?! Hub\b)/.test(line) || /(?:^|[\s"'`(])paseo [a-z-]/.test(line);
}

/** Help lines of `command` that still name upstream's product or command. */
function upstreamNamesInHelp(command: Command): string[] {
  return command
    .helpInformation()
    .split("\n")
    .filter(namesUpstream)
    .map((line) => `${commandLine(command)}: ${line.trim()}`);
}

describe("the CLI is woowtech-smart", () => {
  it("names the program woowtech-smart in every usage line", () => {
    const program = createCli();

    expect(program.name()).toBe("woowtech-smart");
    expect(program.helpInformation()).toMatch(/^Usage: woowtech-smart \[options\] \[command\]\n/);
    expect(subcommand(subcommand(program, "agent"), "archive")?.helpInformation()).toMatch(
      /^Usage: woowtech-smart agent archive /,
    );
  });

  it("names woowtech smart and its command in every help page, keeping Paseo Hub", () => {
    const program = createCli();
    expect(withSubcommands(program).flatMap(upstreamNamesInHelp)).toEqual([]);
    expect(program.helpInformation()).toContain(
      "woowtech smart CLI - control your AI coding agents from the command line",
    );
    expect(subcommand(program, "hub")?.helpInformation()).toContain("Manage Paseo Hub");
  });

  it("knows every top-level command when it rewrites upstream's command text", () => {
    const known: readonly string[] = CLI_TOP_LEVEL_COMMANDS;
    const unknown = createCli()
      .commands.map((command) => command.name())
      .filter((name) => !known.includes(name));

    expect(unknown).toEqual([]);
  });
});

describe("errors name the woowtech-smart command", () => {
  const error = {
    code: "DAEMON_NOT_RUNNING",
    message: "Cannot connect to daemon. Start with: paseo daemon start",
    details: 'Use "paseo ls" to list available agents',
  };

  it("in the table output people read", () => {
    expect(renderError(error, { noColor: true })).toBe(
      'Error: Cannot connect to daemon. Start with: woowtech-smart daemon start\nUse "woowtech-smart ls" to list available agents',
    );
  });

  it("in the JSON and YAML output agents read", () => {
    expect(JSON.parse(renderError(error, { format: "json" }))).toEqual({
      error: {
        code: "DAEMON_NOT_RUNNING",
        message: "Cannot connect to daemon. Start with: woowtech-smart daemon start",
        details: 'Use "woowtech-smart ls" to list available agents',
      },
    });
    expect(renderError(error, { format: "yaml" })).toContain(
      "Start with: woowtech-smart daemon start",
    );
  });

  it("without touching names that only look like the command", () => {
    const pathError = { code: "CONFIG", message: "Cannot read ~/.paseo/config.json" };

    expect(JSON.parse(renderError(pathError, { format: "json" }))).toEqual({ error: pathError });
  });
});
