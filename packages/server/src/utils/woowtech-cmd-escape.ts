// woowtech smart: runs .cmd/.bat scripts with the SDK dialect also used by in-app terminals.
// The shared builder quotes paths and escapes arguments according to the script's second parse.
// Keep /d /v:off and the fork's explicit line-break diagnostic (D18).
import path from "node:path";
import { windowsCommandLine } from "@getpaseo/plugin/internal/windows-command";

const CMD_EXE_METACHAR_PATTERN = /([()%!^"`<>&|;, *?])/g;

export class WindowsCommandScriptArgumentError extends Error {
  // A plain field: the terminal worker runs this file with Node's type stripping when it runs from
  // source, and that refuses a constructor parameter property.
  readonly script: string;

  constructor(script: string) {
    super(
      `${path.win32.basename(script)} is a batch script, and cmd.exe cannot pass it an argument ` +
        "that contains a line break. Install the program's .exe version instead.",
    );
    this.name = "WindowsCommandScriptArgumentError";
    this.script = script;
  }
}

function escapeMetaChars(text: string): string {
  return text.replace(CMD_EXE_METACHAR_PATTERN, "^$1");
}

function hasLineBreak(arg: string): boolean {
  return /[\r\n]/.test(arg);
}

/** One argument, quoted and escaped for a script that forwards %* (no line breaks). */
export function escapeCmdShimArgument(arg: string): string {
  if (hasLineBreak(arg)) {
    throw new RangeError("cmd.exe cannot carry a line break inside an argument");
  }
  let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
  escaped = escaped.replace(/(\\*)$/, "$1$1");
  return escapeMetaChars(escapeMetaChars(`"${escaped}"`));
}

export interface CmdScriptRun {
  /** Full path of the .cmd or .bat file. */
  script: string;
  args: readonly string[];
}

/**
 * The arguments for `cmd.exe` (spawned with windowsVerbatimArguments) that run the script with its
 * arguments. /d skips AutoRun commands and /v:off delayed expansion, whatever the registry says.
 */
export function buildCmdShimCommandLine(run: CmdScriptRun): string {
  if (run.args.some(hasLineBreak)) {
    throw new WindowsCommandScriptArgumentError(run.script);
  }
  return `/d /v:off /s /c ${windowsCommandLine(run.script, run.args, { commandScript: true })}`;
}
