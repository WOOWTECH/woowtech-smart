// woowtech smart: runs a .cmd/.bat script through cmd.exe with every argument intact (plan G17).
// Upstream's spawn path caret-escapes once and also inside quotes, so "fix (wip)" arrives as
// fix ^(wip^) and an unquoted & reaches the script's own %* parse. This is the in-app terminal's
// algorithm (terminal.ts escapeCmdExeArgument, qntm.org/cmd), without node-pty: quote with MSVCRT
// rules, then caret-escape cmd.exe's syntax twice, once for cmd /c and once for the script's %*.
// cmd.exe cannot carry a line break inside one argument; that is an error here (D18), where the
// terminal turns it into a space.
import path from "node:path";

const CMD_EXE_METACHAR_PATTERN = /([()%!^"`<>&|;, *?])/g;

export class WindowsCommandScriptArgumentError extends Error {
  constructor(public readonly script: string) {
    super(
      `${path.win32.basename(script)} is a batch script, and cmd.exe cannot pass it an argument ` +
        "that contains a line break. Install the program's .exe version instead.",
    );
    this.name = "WindowsCommandScriptArgumentError";
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
  const escapedArgs = run.args.map(escapeCmdShimArgument);
  return `/d /v:off /s /c "${[escapeMetaChars(run.script), ...escapedArgs].join(" ")}"`;
}
