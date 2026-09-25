import { createServer, type Server } from "node:http";
import { afterEach, expect, test } from "vitest";

import { metroWarmupTimeoutMs, waitForMetro, warmMetro } from "../e2e/support/global-setup";

class MetroPort {
  private readonly responses = new Map<
    string,
    { status: number; body: string; delayMs?: number }
  >();
  readonly requests: string[] = [];

  private constructor(
    readonly port: number,
    private readonly server: Server,
  ) {}

  static async listen(): Promise<MetroPort> {
    let endpoint!: MetroPort;
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      endpoint.requests.push(pathname);
      const served = endpoint.responses.get(pathname) ?? { status: 500, body: "fallback" };
      setTimeout(() => {
        response.writeHead(served.status, { "content-type": "text/plain" });
        response.end(served.body);
      }, served.delayMs ?? 0);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Failed to listen for Metro readiness test");
    }
    endpoint = new MetroPort(address.port, server);
    return endpoint;
  }

  serveMetro(): void {
    this.responses.set("/status", { status: 200, body: "packager-status:running" });
  }

  serveWarmableDocument({ bundleDelayMs = 0 } = {}): void {
    this.responses.set("/", {
      status: 200,
      body: '<html><script src="/index.bundle?platform=web"></script></html>',
    });
    this.responses.set("/index.bundle", {
      status: 200,
      body: "compiled bundle",
      delayMs: bundleDelayMs,
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

let endpoint: MetroPort | null = null;

afterEach(async () => {
  await endpoint?.close();
  endpoint = null;
});

test("Metro readiness rejects another HTTP listener on the selected port", async () => {
  endpoint = await MetroPort.listen();

  await expect(waitForMetro(endpoint.port, { label: "Metro", timeoutMs: 150 })).rejects.toThrow(
    "Expected Metro status",
  );

  endpoint.serveMetro();
  await expect(waitForMetro(endpoint.port, { label: "Metro", timeoutMs: 150 })).resolves.toBe(
    undefined,
  );
});

test("Metro warmup compiles the document's same-origin scripts before tests start", async () => {
  endpoint = await MetroPort.listen();
  endpoint.serveWarmableDocument();

  await warmMetro(endpoint.port);

  expect(endpoint.requests).toEqual(["/", "/index.bundle"]);
});

test("Metro warmup waits E2E_METRO_WARMUP_TIMEOUT_MS per request, 120 s when unset", async () => {
  expect(metroWarmupTimeoutMs({})).toBe(120_000);
  expect(metroWarmupTimeoutMs({ E2E_METRO_WARMUP_TIMEOUT_MS: "600000" })).toBe(600_000);
  expect(metroWarmupTimeoutMs({ E2E_METRO_WARMUP_TIMEOUT_MS: "later" })).toBe(120_000);

  endpoint = await MetroPort.listen();
  endpoint.serveWarmableDocument({ bundleDelayMs: 1_000 });

  await expect(warmMetro(endpoint.port, 100)).rejects.toMatchObject({ name: "TimeoutError" });
  await expect(warmMetro(endpoint.port, 5_000)).resolves.toBeUndefined();
});
