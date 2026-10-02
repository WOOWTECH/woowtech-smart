// woowtech smart: Windows can reserve the daemon's default port 6770 for Hyper-V or WSL
// (`netsh interface ipv4 show excludedportrange protocol=tcp`), or another program can hold
// it, and the built-in daemon then cannot listen (getpaseo #1552, #3333). Before starting
// it, the Windows app checks the default address and passes a free one in PASEO_LISTEN.
// The app and the CLI find the daemon through its instance record, so they follow
// (woowtech/README.md §25, G12). An address the user chose is never replaced.
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

/** packages/server/src/server/config.ts DEFAULT_PORT (a guard keeps them equal). */
export const WOOWTECH_DAEMON_DEFAULT_PORT = 6770;

const LOOPBACK = "127.0.0.1";
// New homes get the default written into config.json, so it is not a user choice.
const DEFAULT_LISTEN_SPELLINGS = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];
// Far apart, below Windows' default dynamic range (49152+), where Hyper-V reserves blocks.
const FALLBACK_OFFSETS = [10_000, 20_000, 30_000, 40_000];

/** null when the address can be bound, otherwise the error code. */
export type PortProbe = (host: string, port: number) => Promise<string | null>;

export type ListenFallbackDecision =
  | { kind: "keep"; reason: "not-windows" | "user-configured" | "default-free" }
  | { kind: "keep"; reason: "probe-failed"; code: string }
  | { kind: "fallback"; listen: string; code: string }
  | { kind: "keep"; reason: "no-free-port"; code: string };

export async function chooseDesktopDaemonListen(input: {
  platform: NodeJS.Platform;
  envListen: string | undefined;
  configListen: string | undefined;
  defaultPort: number;
  probe: PortProbe;
  allocatePort: (host: string) => Promise<number | null>;
}): Promise<ListenFallbackDecision> {
  if (input.platform !== "win32") {
    return { kind: "keep", reason: "not-windows" };
  }
  const envListen = input.envListen?.trim();
  const configListen = input.configListen?.trim();
  if (
    envListen ||
    (configListen && !DEFAULT_LISTEN_SPELLINGS(input.defaultPort).includes(configListen))
  ) {
    return { kind: "keep", reason: "user-configured" };
  }
  const code = await input.probe(LOOPBACK, input.defaultPort);
  if (code === null) {
    return { kind: "keep", reason: "default-free" };
  }
  if (code !== "EACCES" && code !== "EADDRINUSE") {
    // Let the daemon report anything else itself.
    return { kind: "keep", reason: "probe-failed", code };
  }
  for (const offset of FALLBACK_OFFSETS) {
    const port = input.defaultPort + offset;
    if ((await input.probe(LOOPBACK, port)) === null) {
      return { kind: "fallback", listen: `${LOOPBACK}:${port}`, code };
    }
  }
  const port = await input.allocatePort(LOOPBACK);
  return port === null
    ? { kind: "keep", reason: "no-free-port", code }
    : { kind: "fallback", listen: `${LOOPBACK}:${port}`, code };
}

/** daemon.listen from the home's config.json, if there is one. */
export function readConfiguredListen(home: string): string | undefined {
  try {
    const config = JSON.parse(readFileSync(path.join(home, "config.json"), "utf8")) as {
      daemon?: { listen?: unknown };
    };
    return typeof config.daemon?.listen === "string" ? config.daemon.listen : undefined;
  } catch {
    return undefined;
  }
}

export function probeTcpPort(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "ERROR"));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(null));
    });
  });
}

/** A port the system hands out now; Windows never assigns one inside a reserved range. */
export function allocateTcpPort(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(port));
    });
  });
}
