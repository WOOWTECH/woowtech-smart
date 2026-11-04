// woowtech smart: Install CLI on Windows also puts %USERPROFILE%\.local\bin on the user PATH
// (woowtech/README.md §31, plan G16), the Windows counterpart of the export line the Mac writes
// into the shell rc. One Windows PowerShell run reads HKCU\Environment\Path without expanding it,
// does nothing when the folder is already on the user or machine PATH, and otherwise appends it
// keeping the value's kind: REG_EXPAND_SZ (Windows' default) gets %USERPROFILE%\.local\bin,
// REG_SZ the expanded folder. setx and [Environment]::SetEnvironmentVariable would rewrite the
// value as REG_SZ and break %USERPROFILE%\AppData\Local\Microsoft\WindowsApps (winget). Clearing
// a dummy user variable through .NET then broadcasts the change, so new terminals see it.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface UserPathResult {
  changed: boolean;
  error?: string;
}

interface ExecFileTextOptions {
  windowsHide: boolean;
  timeout: number;
  encoding: "utf8";
  maxBuffer: number;
}

type ExecFileText = (
  file: string,
  args: string[],
  options: ExecFileTextOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface UserPathDeps {
  execFile?: ExecFileText;
  systemRoot?: string;
  timeoutMs?: number;
}

export const ENSURE_USER_PATH_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "$entry = '%USERPROFILE%\\.local\\bin'",
  "$expanded = [Environment]::ExpandEnvironmentVariables($entry)",
  "function Get-Folder([string]$value) {",
  "  [Environment]::ExpandEnvironmentVariables($value.Trim().Trim('\"')).TrimEnd('\\').ToLowerInvariant()",
  "}",
  "$changed = $false",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
  "try {",
  "  $hasPath = $key.GetValueNames() -contains 'Path'",
  "  $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
  "  $kind = if ($hasPath) { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }",
  "  $machine = [string][Environment]::GetEnvironmentVariable('Path', 'Machine')",
  "  $folders = @($raw -split ';') + @($machine -split ';') | Where-Object { $_.Trim() -ne '' } | ForEach-Object { Get-Folder $_ }",
  "  if (-not ($folders -contains (Get-Folder $expanded))) {",
  "    $value = if ($kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) { $entry } else { $expanded }",
  "    $next = if ($raw.Trim() -eq '') { $value } else { $raw.TrimEnd(';') + ';' + $value }",
  "    $key.SetValue('Path', $next, $kind)",
  "    $changed = $true",
  "  }",
  "} finally { $key.Close() }",
  "if ($changed) { [Environment]::SetEnvironmentVariable('WOOWTECH_SMART_ENV_REFRESH', $null, 'User') }",
  "if ($changed) { '{\"changed\":true}' } else { '{\"changed\":false}' }",
].join("\n");

export async function ensureWindowsUserPathEntry(deps: UserPathDeps = {}): Promise<UserPathResult> {
  const systemRoot = deps.systemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
  const powershell = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const run = deps.execFile ?? runExecFile;
  try {
    const { stdout } = await run(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(ENSURE_USER_PATH_SCRIPT, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: deps.timeoutMs ?? 15_000,
        encoding: "utf8",
        maxBuffer: 64 * 1024,
      },
    );
    const parsed = JSON.parse(stdout.trim()) as { changed?: unknown };
    return { changed: parsed.changed === true };
  } catch (error) {
    return { changed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function runExecFile(
  file: string,
  args: string[],
  options: ExecFileTextOptions,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, options);
}
