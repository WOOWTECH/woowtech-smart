import os from "node:os";
import path from "node:path";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

// woowtech smart keeps its own home so it can run beside an upstream Paseo install.
export const DEFAULT_PASEO_HOME = "~/.woowtech-smart";

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? DEFAULT_PASEO_HOME;
  const resolved = path.resolve(expandHomeDir(raw));
  return resolved;
}
