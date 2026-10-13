import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_BODY_BYTES, REPORT_PATH, validateReport } from "./contract.mjs";
import { cleanupExpired, createReportServer, persistRecord } from "./service.mjs";

const valid = () => ({
  schemaVersion: 1,
  reportId: randomUUID(),
  reason: "other",
  platform: "ios",
  appVersion: "1.2.3",
  locale: "zh-TW",
  reportedContent: null,
});
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ai-report-"));
  const server = createReportServer({ queueDir: dir, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, url: `http://127.0.0.1:${server.address().port}${REPORT_PATH}` };
}
const post = (url, body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("strict contract rejects unknown and sensitive fields", () => {
  assert.equal(validateReport({ ...valid(), apiKey: "secret" }), "unexpected_field:apiKey");
  assert.equal(validateReport({ ...valid(), pairingInfo: {} }), "unexpected_field:pairingInfo");
  assert.equal(validateReport({ ...valid(), reason: "made-up" }), "invalid_reason");
});

test("receipt follows durable 0600 server-named record", async (t) => {
  const { dir, url } = await fixture(t);
  const response = await post(url, valid());
  assert.equal(response.status, 201);
  const receipt = await response.json();
  const names = await readdir(dir);
  assert.deepEqual(names, [`${receipt.receiptId}.json`]);
  assert.equal((await stat(path.join(dir, names[0]))).mode & 0o777, 0o600);
  const queued = JSON.parse(await readFile(path.join(dir, names[0]), "utf8"));
  assert.equal(queued.receiptId, receipt.receiptId);
  assert.equal("remoteAddress" in queued, false);
});

test("true HTTP body, rate and capacity limits fail closed", async (t) => {
  const bodyFixture = await fixture(t);
  assert.equal((await post(bodyFixture.url, "x".repeat(MAX_BODY_BYTES + 1))).status, 413);
  const rateFixture = await fixture(t, { rateLimit: 1 });
  assert.equal((await post(rateFixture.url, valid())).status, 201);
  assert.equal((await post(rateFixture.url, valid())).status, 429);
  const capacityFixture = await fixture(t, { maxQueueBytes: 1 });
  assert.equal((await post(capacityFixture.url, valid())).status, 503);
  assert.deepEqual(await readdir(capacityFixture.dir), []);
});

test("write failure returns 500 without a success receipt", async (t) => {
  const { url } = await fixture(t, {
    writeRecord: async () => {
      throw new Error("disk failed");
    },
  });
  const response = await post(url, valid());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "storage_unavailable" });
});

test("persist failure removes its partial temporary file", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ai-report-partial-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const opened = [];
  await assert.rejects(
    persistRecord(
      dir,
      { receiptId: `air_${randomUUID()}`, receivedAt: new Date().toISOString(), report: valid() },
      {
        open: async (file) => {
          opened.push(file);
          await writeFile(file, "partial", { mode: 0o600 });
          return {
            writeFile: async () => {
              throw new Error("disk full");
            },
            sync: async () => {},
            close: async () => {},
          };
        },
        rename: async () => {},
        unlink: async (file) => rm(file, { force: true }),
      },
    ),
  );
  assert.equal(opened.length, 1);
  assert.deepEqual(await readdir(dir), []);
});

test("receipt waits for the renamed record and queue directory sync", async (t) => {
  const events = [];
  const { url } = await fixture(t, {
    writeRecord: (queueDir, record) =>
      persistRecord(queueDir, record, {
        open: async (target, flags) => {
          if (target === queueDir) {
            assert.equal(flags, "r");
            return {
              sync: async () => events.push("directory-sync"),
              close: async () => events.push("directory-close"),
            };
          }
          events.push("temporary-open");
          return {
            writeFile: async () => events.push("file-write"),
            sync: async () => events.push("file-sync"),
            close: async () => events.push("file-close"),
          };
        },
        rename: async () => events.push("rename"),
        unlink: async () => events.push("unlink"),
      }),
  });
  const response = await post(url, valid());
  assert.equal(response.status, 201);
  assert.deepEqual(events, [
    "temporary-open",
    "file-write",
    "file-sync",
    "file-close",
    "rename",
    "directory-sync",
    "directory-close",
  ]);
});

test("directory sync failure returns 500 and no success receipt", async (t) => {
  const { url } = await fixture(t, {
    writeRecord: (queueDir, record) =>
      persistRecord(queueDir, record, {
        open: async (target) =>
          target === queueDir
            ? {
                sync: async () => {
                  throw new Error("directory sync failed");
                },
                close: async () => {},
              }
            : {
                writeFile: async () => {},
                sync: async () => {},
                close: async () => {},
              },
        rename: async () => {},
        unlink: async () => {},
      }),
  });
  const response = await post(url, valid());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "storage_unavailable" });
});

test("trusted proxy uses one configured client IP header for independent limits", async (t) => {
  const { url } = await fixture(t, {
    trustedProxyAddress: "127.0.0.1",
    clientAddressHeader: "x-review-client-ip",
    rateLimit: 1,
  });
  assert.equal((await post(url, valid(), { "x-review-client-ip": "192.0.2.10" })).status, 201);
  assert.equal((await post(url, valid(), { "x-review-client-ip": "192.0.2.11" })).status, 201);
  assert.equal((await post(url, valid(), { "x-review-client-ip": "192.0.2.10" })).status, 429);
});

test("trusted proxy rejects missing, repeated and non-IP client headers", async (t) => {
  const { url } = await fixture(t, {
    trustedProxyAddress: "127.0.0.1",
    clientAddressHeader: "x-review-client-ip",
  });
  assert.equal((await post(url, valid())).status, 400);
  assert.equal(
    (await post(url, valid(), { "x-review-client-ip": "192.0.2.1, 198.51.100.2" })).status,
    400,
  );
  const repeated = await fetch(url, {
    method: "POST",
    headers: [
      ["content-type", "application/json"],
      ["x-review-client-ip", "192.0.2.1"],
      ["x-review-client-ip", "198.51.100.2"],
    ],
    body: JSON.stringify(valid()),
  });
  assert.equal(repeated.status, 400);
});

test("untrusted peers ignore the configured client address header", async (t) => {
  const { url } = await fixture(t, {
    trustedProxyAddress: "127.0.0.2",
    clientAddressHeader: "x-review-client-ip",
    rateLimit: 1,
  });
  assert.equal((await post(url, valid(), { "x-review-client-ip": "192.0.2.10" })).status, 201);
  assert.equal((await post(url, valid(), { "x-review-client-ip": "192.0.2.11" })).status, 429);
});

test("trusted proxy settings must be paired and precise", () => {
  assert.throws(
    () => createReportServer({ queueDir: "/tmp/reports", trustedProxyAddress: "127.0.0.1" }),
    /configured together/,
  );
  assert.throws(
    () =>
      createReportServer({
        queueDir: "/tmp/reports",
        trustedProxyAddress: "proxy.example.test",
        clientAddressHeader: "x-review-client-ip",
      }),
    /IP literal/,
  );
  assert.throws(
    () =>
      createReportServer({
        queueDir: "/tmp/reports",
        trustedProxyAddress: "127.0.0.1",
        clientAddressHeader: "x bad header",
      }),
    /invalid client address header/,
  );
});

test("CORS permits only configured exact origins and handles preflight", async (t) => {
  const { url } = await fixture(t, { allowedOrigins: ["https://app.example.test"] });
  const allowed = await fetch(url, {
    method: "OPTIONS",
    headers: { origin: "https://app.example.test", "access-control-request-method": "POST" },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.test");
  const denied = await fetch(url, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example.test", "access-control-request-method": "POST" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("cleanup removes only expired owned queue files", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ai-report-clean-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const owned = path.join(dir, "air_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json");
  await writeFile(owned, "{}\n");
  await writeFile(path.join(dir, "leave-me.txt"), "x");
  await utimes(owned, new Date(0), new Date(0));
  assert.equal(await cleanupExpired(dir, 1000, 5000), 1);
  assert.deepEqual(await readdir(dir), ["leave-me.txt"]);
});
