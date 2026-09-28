import { execFile } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createServer, type RequestListener } from "node:http";
import { connect, type Socket, type Server } from "node:net";
import { afterEach, expect, test } from "vitest";
import { EnvHttpProxyAgent, getGlobalDispatcher } from "undici";
import { fetchFromRegistry } from "./claude-agent-sdk-download.js";

const downloadFailure = (status?: number) =>
  `[woowtech:claude-sdk:download] Claude Agent SDK download failed${status === undefined ? "" : ` with HTTP ${status}`}. First use of Claude requires downloading a component, but the registry or mirror could not be reached. Send your next message to retry.`;

// C-030 explicitly permits loopback registry/proxy fixtures for this transport contract.
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});
async function listen(server: Server): Promise<string> {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  return `http://127.0.0.1:${address.port}`;
}
async function registry(handler: RequestListener = (_req, res) => res.end("fixture")) {
  return listen(createServer(handler));
}
async function proxy() {
  let connects = 0;
  const server = createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  server.on("connect", (req, socket, head) => {
    const target = new URL(`http://${req.url}`);
    if (target.hostname !== "127.0.0.1") {
      socket.destroy();
      return;
    }
    connects++;
    const upstream = connect(Number(target.port), "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  return { url: await listen(server), count: () => connects };
}

test("HTTP_PROXY uses a download-local CONNECT dispatcher", async () => {
  const target = await registry();
  const tunnel = await proxy();
  expect(
    Buffer.from(await fetchFromRegistry(target, { env: { HTTP_PROXY: tunnel.url } })).toString(),
  ).toBe("fixture");
  expect(tunnel.count()).toBe(1);
});

test.each(["HTTP_PROXY", "http_proxy"])(
  "honors %s, without affecting ordinary fetch",
  async (key) => {
    const target = await registry();
    const tunnel = await proxy();
    const globalDispatcher = getGlobalDispatcher();
    await fetchFromRegistry(target, { env: { [key]: tunnel.url } });
    expect(tunnel.count()).toBe(1);
    expect(getGlobalDispatcher()).toBe(globalDispatcher);
  },
);

test("lowercase proxy wins over uppercase", async () => {
  const target = await registry();
  const lower = await proxy();
  const upper = await proxy();
  await fetchFromRegistry(target, { env: { http_proxy: lower.url, HTTP_PROXY: upper.url } });
  expect([lower.count(), upper.count()]).toEqual([1, 0]);
});

test.each([
  ["127.0.0.1", 0],
  [".0.0.1", 0],
  ["*.0.0.1", 0],
  ["unused.invalid, 127.0.0.1 other.invalid", 0],
  ["*", 0],
  ["not-loopback.invalid", 1],
  ["127.0.0.1:1", 1],
])("NO_PROXY=%s selects the expected route", async (noProxy, count) => {
  const target = await registry();
  const tunnel = await proxy();
  await fetchFromRegistry(target, { env: { HTTP_PROXY: tunnel.url, NO_PROXY: noProxy } });
  expect(tunnel.count()).toBe(count);
});

test("NO_PROXY honors exact port and lowercase precedence including empty", async () => {
  const target = await registry();
  const tunnel = await proxy();
  await fetchFromRegistry(target, {
    env: { HTTP_PROXY: tunnel.url, NO_PROXY: new URL(target).host },
  });
  expect(tunnel.count()).toBe(0);
  await fetchFromRegistry(target, {
    env: { HTTP_PROXY: tunnel.url, no_proxy: "127.0.0.1", NO_PROXY: "unused.invalid" },
  });
  expect(tunnel.count()).toBe(0);
  await fetchFromRegistry(target, { env: { HTTP_PROXY: tunnel.url, no_proxy: "", NO_PROXY: "*" } });
  expect(tunnel.count()).toBe(1);
});

test("rejects non-2xx without exposing response headers or URL secrets", async () => {
  const target = await registry((_req, res) => {
    res.writeHead(503, { "x-sensitive": "fixture-header-secret" });
    res.write("unfinished");
  });
  const error = await fetchFromRegistry(`${target}/?fixture-query-secret`, { env: {} }).catch(
    (e: unknown) => e,
  );
  expect(error).toMatchObject({
    name: "ClaudeAgentSdkDownloadError",
    status: 503,
    message: downloadFailure(503),
  });
  expect(JSON.stringify(error)).not.toMatch(/secret|127\.0\.0\.1|cause/);
});

test("sanitizes invalid authenticated proxy errors", async () => {
  const error = await fetchFromRegistry("http://127.0.0.1:1", {
    env: { HTTP_PROXY: "not-a-url:fixture-user:fixture-password?fixture-query" },
  }).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ message: downloadFailure() });
  expect(error).not.toHaveProperty("cause");
  expect(JSON.stringify(error)).not.toMatch(/fixture|127\.0\.0\.1/);
});

test("total timeout covers a body stalled after headers", async () => {
  const target = await registry((_req, res) => {
    res.writeHead(200);
    res.write("partial");
  });
  await expect(fetchFromRegistry(target, { env: {}, timeoutMs: 80 })).rejects.toThrow(
    downloadFailure(),
  );
});

test("disconnect rejects, and the next download can succeed", async () => {
  let attempt = 0;
  const target = await registry((_req, res) => {
    if (++attempt === 1) {
      res.writeHead(200, { "content-length": 100 });
      res.write("partial");
      res.socket?.destroy();
    } else res.end("retry");
  });
  await expect(fetchFromRegistry(target, { env: {} })).rejects.toThrow(downloadFailure());
  expect(Buffer.from(await fetchFromRegistry(target, { env: {} })).toString()).toBe("retry");
});

test("startup extra CA trusts direct and CONNECT downloads, never disables verification", async () => {
  const root = path.resolve(".dev/f11-repair/fixtures");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "sdk-ca-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const cert = path.join(dir, "ca.pem");
  const key = path.join(dir, "key.pem");
  const config = path.join(dir, "openssl.cnf");
  await writeFile(
    config,
    `[req]
  distinguished_name=dn
  x509_extensions=extensions
  prompt=no
  [dn]
  CN=SDK fixture only
  [extensions]
  basicConstraints=critical,CA:TRUE
  keyUsage=critical,keyCertSign,digitalSignature,keyEncipherment
  subjectAltName=IP:127.0.0.1
  `,
  );
  const execute = promisify(execFile);
  await execute(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-config",
      config,
    ],
    {
      env: { PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: dir },
      timeout: 10_000,
    },
  );
  const target = (
    await listen(
      createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (_req, res) =>
        res.end("trusted fixture"),
      ),
    )
  ).replace("http:", "https:");
  const tunnel = await proxy();
  const other = await proxy();
  const source = new URL("./claude-agent-sdk-download.ts", import.meta.url).href;
  const script = `import { fetchFromRegistry } from ${JSON.stringify(source)};
    try {
      const bytes = await fetchFromRegistry(process.argv[1], { timeoutMs: 3000 });
      console.log(JSON.stringify({ node: process.versions.node, body: Buffer.from(bytes).toString() }));
    } catch (error) { console.log(JSON.stringify({ node: process.versions.node, error: error.message })); }
  `;
  const binary = process.execPath;
  for (const proxied of [false, true]) {
    const before = tunnel.count();
    const proxyEnv = proxied ? { HTTPS_PROXY: tunnel.url } : {};
    const rejected = await execute(
      binary,
      ["--import", "tsx", "--input-type=module", "-e", script, target],
      {
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          HOME: dir,
          TMPDIR: dir,
          CLAUDE_CONFIG_DIR: dir,
          PASEO_HOME: dir,
          TSX_DISABLE_CACHE: "1",
          ...proxyEnv,
        },
        timeout: 10_000,
      },
    );
    const rejection = JSON.parse(rejected.stdout);
    expect(rejection.node).toBe(process.versions.node);
    expect(rejection.error).toBe(downloadFailure());
    const accepted = await execute(
      binary,
      ["--import", "tsx", "--input-type=module", "-e", script, target],
      {
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          HOME: dir,
          TMPDIR: dir,
          CLAUDE_CONFIG_DIR: dir,
          PASEO_HOME: dir,
          TSX_DISABLE_CACHE: "1",
          NODE_EXTRA_CA_CERTS: cert,
          ...proxyEnv,
        },
        timeout: 10_000,
      },
    );
    expect(JSON.parse(accepted.stdout)).toEqual({
      node: rejection.node,
      body: "trusted fixture",
    });
    expect(tunnel.count()).toBe(before + (proxied ? 2 : 0));
  }
  for (const proxyEnv of [
    { https_proxy: tunnel.url },
    { HTTP_PROXY: tunnel.url },
    { http_proxy: tunnel.url },
    { https_proxy: tunnel.url, HTTPS_PROXY: other.url, HTTP_PROXY: other.url },
  ]) {
    const before = tunnel.count();
    const accepted = await execute(
      binary,
      ["--import", "tsx", "--input-type=module", "-e", script, target],
      {
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          HOME: dir,
          TMPDIR: dir,
          CLAUDE_CONFIG_DIR: dir,
          PASEO_HOME: dir,
          TSX_DISABLE_CACHE: "1",
          NODE_EXTRA_CA_CERTS: cert,
          ...proxyEnv,
        },
        timeout: 10_000,
      },
    );
    expect(JSON.parse(accepted.stdout).body).toBe("trusted fixture");
    expect(tunnel.count()).toBe(before + 1);
    expect(other.count()).toBe(0);
  }
  const before = tunnel.count();
  const bypass = await execute(
    binary,
    ["--import", "tsx", "--input-type=module", "-e", script, target],
    {
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        HOME: dir,
        TMPDIR: dir,
        CLAUDE_CONFIG_DIR: dir,
        PASEO_HOME: dir,
        TSX_DISABLE_CACHE: "1",
        NODE_EXTRA_CA_CERTS: cert,
        HTTPS_PROXY: tunnel.url,
        NO_PROXY: "127.0.0.1",
      },
      timeout: 10_000,
    },
  );
  expect(JSON.parse(bypass.stdout).body).toBe("trusted fixture");
  expect(tunnel.count()).toBe(before);
}, 30_000);

test.each([false, true])(
  "authenticated proxy errors expose no userinfo, query, headers or raw cause (query=%s)",
  async (withQuery) => {
    const target = await registry((_req, res) => {
      res.writeHead(503, { "x-fixture-secret": "fixture-header" });
      res.end();
    });
    const tunnel = await proxy();
    const configuredProxy = new URL(tunnel.url);
    configuredProxy.username = "fixture-user";
    configuredProxy.password = "fixture-password";
    configuredProxy.search = withQuery ? "fixture-query" : "";
    const error = await fetchFromRegistry(target, {
      env: { HTTP_PROXY: configuredProxy.href },
    }).catch((failure: unknown) => failure);
    expect(tunnel.count()).toBe(withQuery ? 0 : 1);
    expect(error).toMatchObject({
      message: withQuery ? downloadFailure() : downloadFailure(503),
    });
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("url");
    expect(JSON.stringify(error)).not.toMatch(/fixture|127\.0\.0\.1/);
  },
);

test("dispatcher teardown errors cross the same safe download boundary", async () => {
  class FailingTeardownAgent extends EnvHttpProxyAgent {
    override async destroy() {
      await new Promise<void>((resolve) => super.destroy(null, resolve));
      throw new Error("fixture-user:fixture-password@fixture.invalid/?fixture-email headers cause");
    }
  }
  const error = await fetchFromRegistry("http://127.0.0.1:1", {
    env: {},
    createDispatcher: (settings) => new FailingTeardownAgent(settings),
  }).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ name: "ClaudeAgentSdkDownloadError", message: downloadFailure() });
  expect(error).not.toHaveProperty("cause");
  expect(JSON.stringify(error)).not.toMatch(/fixture|headers|cause/);
});
