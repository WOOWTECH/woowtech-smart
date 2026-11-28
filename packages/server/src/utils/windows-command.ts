import { extname } from "node:path";

// The daemon's shell selection and probes need this predicate. Quoting stays private to the SDK's
// process implementation, rather than becoming part of the public plugin API.
export function isWindowsCommandScript(executablePath: string): boolean {
  const extension = extname(executablePath).toLowerCase();
  return process.platform === "win32" && (extension === ".cmd" || extension === ".bat");
}
