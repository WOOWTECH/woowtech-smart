import { CLI_COMMAND, withCliCommand } from "@getpaseo/protocol/brand-cli";
import { Help, type Argument, type Command, type Option } from "commander";
import type { CommandError } from "./output/types.js";

// The CLI is upstream's program under woowtech smart's name. Its help pages and
// errors are rewritten as they are printed instead of editing upstream's
// strings, so text upstream adds later is covered too: `paseo <command>`
// becomes woowtech-smart everywhere, and in help pages the product name Paseo
// becomes woowtech smart, except Paseo Hub, which stays upstream's service until
// we run our own. Errors can quote the user's own names, so only commands are
// rewritten there.

const PRODUCT_NAME = "woowtech smart";
const UPSTREAM_PRODUCT_NAME = /\bPaseo\b(?! Hub\b)/g;

/** Help text with woowtech smart's product name and command. */
export function withCliBrand(text: string): string {
  return withCliCommand(text).replace(UPSTREAM_PRODUCT_NAME, PRODUCT_NAME);
}

/** The error with upstream's `paseo <command>` in its message and details written as ours. */
export function withCliCommandInError(error: CommandError): CommandError {
  return {
    ...error,
    message: withCliCommand(error.message),
    ...(typeof error.details === "string" ? { details: withCliCommand(error.details) } : {}),
  };
}

class BrandedHelp extends Help {
  override commandDescription(cmd: Command): string {
    return withCliBrand(super.commandDescription(cmd));
  }

  override subcommandDescription(cmd: Command): string {
    return withCliBrand(super.subcommandDescription(cmd));
  }

  override optionDescription(option: Option): string {
    return withCliBrand(super.optionDescription(option));
  }

  override argumentDescription(argument: Argument): string {
    return withCliBrand(super.argumentDescription(argument));
  }
}

function brandHelp(command: Command): void {
  command.createHelp = () => Object.assign(new BrandedHelp(), command.configureHelp());
  command.commands.forEach(brandHelp);
}

/** Names the program woowtech-smart and brands the help of every command in it. */
export function applyCliBrand(program: Command): Command {
  program.name(CLI_COMMAND);
  brandHelp(program);
  return program;
}
