import os from "node:os";
import path from "node:path";
import { DEFAULT_DAEMON_HOME } from "@getpaseo/protocol/brand-daemon";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

// Each brand keeps its own home so it can run beside an upstream Paseo install and the other brand.
export const DEFAULT_PASEO_HOME = DEFAULT_DAEMON_HOME;

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? DEFAULT_PASEO_HOME;
  const resolved = path.resolve(expandHomeDir(raw));
  return resolved;
}
