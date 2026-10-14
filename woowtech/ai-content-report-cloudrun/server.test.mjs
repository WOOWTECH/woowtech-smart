import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES, REPORT_PATH } from "./contract.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import {
  createReportServer,
  EDGE_KEY_HEADER,
  edgeKeyAccepted,
  parseEdgeKeys,
  startFromEnvironment,
} from "./server.mjs";
import { DAY_MS, RECEIPT_ID } from "./store-port.mjs";
import { KEY, OTHER_KEY, postReport, send, startFixture, validReport } from "./support.mjs";

test("stores a valid report and answers 201 with the server's own receipt", async (t) => {
  const { store, url, clock } = await startFixture(t);
  const report = validReport({ reportedContent: "the reply the person chose to attach" });
  const response = await postReport(url, report);
  assert.equal(response.status, 201);
  const answer = response.json();
  assert.deepEqual(Object.keys(answer).sort(), ["receiptId", "receivedAt", "schemaVersion"]);
  assert.equal(answer.schemaVersion, 1);
  assert.match(answer.receiptId, RECEIPT_ID);
  assert.equal(answer.receivedAt, new Date(clock()).toISOString());
  // The receipt is the server's: nothing of the client's reportId reaches it.
  assert.equal(answer.receiptId.includes(report.reportId), false);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["access-control-allow-origin"], undefined);

  assert.equal(store.records.size, 1);
  const stored = store.records.get(answer.receiptId);
  assert.deepEqual(stored.report, report);
  assert.equal(stored.receivedAtMs, clock());
  assert.equal(stored.expiresAtMs - stored.receivedAtMs, 30 * DAY_MS);
  // Only what the report is: no address, no user agent, no headers.
  assert.deepEqual(Object.keys(stored).sort(), ["expiresAtMs", "receivedAtMs", "report"]);
});

test("every report gets its own receipt", async (t) => {
  const { store, url } = await startFixture(t);
  const first = (await postReport(url, validReport())).json().receiptId;
  const second = (await postReport(url, validReport())).json().receiptId;
  assert.notEqual(first, second);
  assert.equal(store.records.size, 2);
});

test("answers 201 only after the store has confirmed the write", async (t) => {
  const store = createMemoryStore();
  const { url } = await startFixture(t, { store });
  let release;
  store.holdNext(new Promise((resolve) => (release = resolve)));
  let answered = false;
  const pending = postReport(url, validReport()).then((response) => {
    answered = true;
    return response;
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(answered, false, "no answer while the write is still open");
  assert.equal(store.records.size, 0);
  release();
  const response = await pending;
  assert.equal(response.status, 201);
  assert.equal(store.records.size, 1);
});

test("a request without the edge key, or with a wrong one, is refused before anything is read", async (t) => {
  const { store, url } = await startFixture(t);
  const missing = await postReport(url, validReport(), { key: null });
  assert.equal(missing.status, 403);
  assert.deepEqual(missing.json(), { error: "forbidden" });
  assert.equal(missing.headers.connection, "close");
  const wrong = await postReport(url, validReport(), { key: OTHER_KEY });
  assert.equal(wrong.status, 403);
  const empty = await postReport(url, validReport(), { key: "" });
  assert.equal(empty.status, 403);
  assert.equal(store.records.size, 0);
  // Header names are case-insensitive; the key is not.
  const ok = await send(url, {
    headers: {
      "content-type": "application/json",
      [EDGE_KEY_HEADER.toUpperCase()]: KEY,
    },
    body: JSON.stringify(validReport()),
  });
  assert.equal(ok.status, 201);
  const lowerCased = await postReport(url, validReport(), { key: KEY.toUpperCase() });
  assert.equal(lowerCased.status, 403);
});

test("two edge keys are accepted while one is being rotated, and no third", async (t) => {
  const { store, url } = await startFixture(t, { edgeKeys: [KEY, OTHER_KEY] });
  assert.equal((await postReport(url, validReport(), { key: KEY })).status, 201);
  assert.equal((await postReport(url, validReport(), { key: OTHER_KEY })).status, 201);
  assert.equal((await postReport(url, validReport(), { key: `${KEY} ${OTHER_KEY}` })).status, 403);
  assert.equal((await postReport(url, validReport(), { key: `${KEY}-x` })).status, 403);
  assert.equal(store.records.size, 2);
});

test("edge key parsing: one key, or two; weak or missing keys stop the service", () => {
  assert.deepEqual(parseEdgeKeys(KEY), [KEY]);
  assert.deepEqual(parseEdgeKeys(`${KEY} ${OTHER_KEY}`), [KEY, OTHER_KEY]);
  assert.deepEqual(parseEdgeKeys(`${KEY},${OTHER_KEY}\n`), [KEY, OTHER_KEY]);
  assert.throws(() => parseEdgeKeys(undefined), /EDGE_KEYS must hold/);
  assert.throws(() => parseEdgeKeys("  "), /EDGE_KEYS must hold/);
  assert.throws(() => parseEdgeKeys(`${KEY} ${OTHER_KEY} ${KEY}x`), /EDGE_KEYS must hold/);
  assert.throws(() => parseEdgeKeys("a".repeat(31)), /at least 32/);
  assert.throws(() => parseEdgeKeys("é".repeat(40)), /printable/);
  try {
    parseEdgeKeys("short-key");
  } catch (error) {
    assert.equal(error.message.includes("short-key"), false, "a message never holds a key");
  }
  assert.equal(edgeKeyAccepted(KEY, [KEY]), true);
  assert.equal(edgeKeyAccepted(KEY.slice(1), [KEY]), false);
  assert.equal(edgeKeyAccepted("", [KEY]), false);
  assert.equal(edgeKeyAccepted(undefined, [KEY]), false);
  assert.equal(edgeKeyAccepted([KEY], [KEY]), false);
});

test("any request that carries an Origin is refused, even with the right key", async (t) => {
  const { store, url } = await startFixture(t);
  const response = await postReport(url, validReport(), {
    headers: { origin: "https://example.invalid" },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(response.json(), { error: "origin_not_allowed" });
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(store.records.size, 0);
});

test("only a JSON body is read", async (t) => {
  const { store, url } = await startFixture(t);
  const plain = await postReport(url, validReport(), { headers: { "content-type": "text/plain" } });
  assert.equal(plain.status, 415);
  const body = JSON.stringify(validReport());
  const none = await send(url, {
    headers: { [EDGE_KEY_HEADER]: KEY, "content-length": String(Buffer.byteLength(body)) },
    body,
  });
  assert.equal(none.status, 415);
  assert.equal(store.records.size, 0);
  const charset = await postReport(url, validReport(), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  assert.equal(charset.status, 201);
});

test("a body that is not JSON, or breaks the contract, is a 400 and is not stored", async (t) => {
  const { store, url } = await startFixture(t);
  const broken = await postReport(url, "{not json");
  assert.equal(broken.status, 400);
  assert.deepEqual(broken.json(), { error: "invalid_json" });
  const unknown = await postReport(url, { ...validReport(), apiKey: "x" });
  assert.deepEqual(unknown.json(), { error: "unexpected_field:apiKey" });
  assert.equal(unknown.status, 400);
  const reason = await postReport(url, validReport({ reason: "made-up" }));
  assert.deepEqual(reason.json(), { error: "invalid_reason" });
  const id = await postReport(url, validReport({ reportId: "not-a-uuid" }));
  assert.deepEqual(id.json(), { error: "invalid_report_id" });
  const array = await postReport(url, "[]");
  assert.deepEqual(array.json(), { error: "body_not_object" });
  assert.equal(store.records.size, 0);
});

test("the attached text is limited to 8 KiB, the body to 12,288 bytes", async (t) => {
  const { store, url } = await startFixture(t);
  assert.equal(
    (await postReport(url, validReport({ reportedContent: "a".repeat(8192) }))).status,
    201,
  );
  const tooLong = await postReport(url, validReport({ reportedContent: "a".repeat(8193) }));
  assert.equal(tooLong.status, 400);
  assert.deepEqual(tooLong.json(), { error: "invalid_reported_content_size" });

  const declared = await postReport(url, "x".repeat(MAX_BODY_BYTES + 1));
  assert.equal(declared.status, 413);
  assert.deepEqual(declared.json(), { error: "body_too_large" });
  assert.equal(declared.headers.connection, "close");

  const chunked = await send(url, {
    headers: { "content-type": "application/json", [EDGE_KEY_HEADER]: KEY },
    chunks: [1, 2, 3, 4].map(() => "x".repeat(4096)),
  });
  assert.equal(chunked.status, 413);
  assert.equal(store.records.size, 1);
});

test("a full day answers 429 and stores nothing; the next UTC day starts again", async (t) => {
  const { store, url, logs, advance } = await startFixture(t, { server: { dailyMax: 2 } });
  assert.equal((await postReport(url, validReport())).status, 201);
  assert.equal((await postReport(url, validReport())).status, 201);
  const full = await postReport(url, validReport());
  assert.equal(full.status, 429);
  assert.deepEqual(full.json(), { error: "capacity" });
  // 08:00 UTC: the day has 16 hours left.
  assert.equal(full.headers["retry-after"], String(16 * 3600));
  assert.equal(store.records.size, 2);
  assert.deepEqual(logs.at(-1), {
    severity: "WARNING",
    event: "ai_report_rejected",
    code: "capacity",
  });

  advance(DAY_MS);
  assert.equal((await postReport(url, validReport())).status, 201);
  assert.equal(store.records.size, 3);
});

test("a failed write is a 500 with a fixed code, never a 201, and the service recovers", async (t) => {
  const { store, url, logs } = await startFixture(t);
  store.failNext(new Error("disk on fire at /secret/path with key abc"));
  const failed = await postReport(url, validReport());
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.json(), { error: "storage_unavailable" });
  assert.equal(store.records.size, 0);
  assert.deepEqual(logs, [
    { severity: "ERROR", event: "ai_report_error", code: "storage_unavailable" },
  ]);
  assert.equal(JSON.stringify(logs).includes("secret"), false);
  assert.equal((await postReport(url, validReport())).status, 201);
});

test("a store that does not answer in time is a 500 with its own log code, and the service goes on", async (t) => {
  const { store, url, logs } = await startFixture(t, { server: { storeTimeoutMs: 100 } });
  // Never answers.
  store.holdNext(new Promise(() => {}));
  const started = Date.now();
  const hung = await postReport(url, validReport());
  assert.equal(hung.status, 500);
  assert.deepEqual(hung.json(), { error: "storage_unavailable" });
  assert.ok(Date.now() - started < 3000, "answered by the deadline, not by the client giving up");
  assert.equal(store.records.size, 0);
  assert.deepEqual(logs, [
    { severity: "ERROR", event: "ai_report_error", code: "storage_timeout" },
  ]);
  assert.equal((await postReport(url, validReport())).status, 201);
});

test("a store that fails after the deadline does not crash the process", async (t) => {
  const { store, url } = await startFixture(t, { server: { storeTimeoutMs: 50 } });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));
  let fail;
  store.holdNext(new Promise((_, reject) => (fail = () => reject(new Error("late failure")))));
  assert.equal((await postReport(url, validReport())).status, 500);
  fail();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(unhandled, []);
});

test("the log carries the receipt number and nothing of the report, the sender or the key", async (t) => {
  const { logs, url } = await startFixture(t);
  const report = validReport({ reportedContent: "TOP-SECRET-REPORTED-TEXT", locale: "ja-JP" });
  const response = await postReport(url, report, { headers: { "user-agent": "agent-007" } });
  const { receiptId } = response.json();
  assert.deepEqual(logs, [{ severity: "NOTICE", event: "ai_report_stored", receiptId }]);
  const everything = JSON.stringify(logs);
  for (const secret of ["TOP-SECRET", report.reportId, "ja-JP", "127.0.0.1", "agent-007", KEY]) {
    assert.equal(everything.includes(secret), false, `the log must not hold ${secret}`);
  }
  // A refusal logs nothing at all: no body was read and no outcome is interesting.
  await postReport(url, report, { key: null });
  assert.equal(logs.length, 1);
});

test("routes: /health answers; the report path takes POST only; the rest is 404", async (t) => {
  const { base, url, store } = await startFixture(t);
  const health = await send(`${base}/health`, { method: "GET" });
  assert.equal(health.status, 200);
  assert.deepEqual(health.json(), { status: "ok" });
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    const refused = await send(url, { method, headers: { [EDGE_KEY_HEADER]: KEY } });
    assert.equal(refused.status, 405, method);
    assert.equal(refused.headers.allow, "POST");
  }
  assert.equal((await send(`${base}/`, { method: "GET" })).status, 404);
  assert.equal((await send(`${base}/health`, { method: "POST" })).status, 404);
  assert.equal((await send(`${base}${REPORT_PATH}?x=1`, { method: "POST" })).status, 404);
  assert.equal((await send(`${base}/v1/other`, { method: "POST" })).status, 404);
  assert.equal(store.records.size, 0);
});

test("the server needs a store and one or two edge keys", () => {
  const store = createMemoryStore();
  assert.throws(() => createReportServer({ edgeKeys: [KEY] }), /store is required/);
  assert.throws(() => createReportServer({ store, edgeKeys: [] }), /edgeKeys/);
  assert.throws(() => createReportServer({ store, edgeKeys: [KEY, OTHER_KEY, "x"] }), /edgeKeys/);
  assert.throws(() => createReportServer({ store }), /edgeKeys/);
});

test("the environment is checked before the service listens", async () => {
  const store = createMemoryStore();
  await assert.rejects(startFromEnvironment({}), /EDGE_KEYS must hold/);
  await assert.rejects(startFromEnvironment({ EDGE_KEYS: "short" }), (error) => {
    assert.match(error.message, /at least 32/);
    assert.equal(error.message.includes("short"), false);
    return true;
  });
  await assert.rejects(
    startFromEnvironment({ EDGE_KEYS: KEY, RETENTION_DAYS: "0" }, { store }),
    /RETENTION_DAYS/,
  );
  await assert.rejects(
    startFromEnvironment({ EDGE_KEYS: KEY, RETENTION_DAYS: "366" }, { store }),
    /RETENTION_DAYS/,
  );
  await assert.rejects(
    startFromEnvironment({ EDGE_KEYS: KEY, DAILY_MAX_REPORTS: "x" }, { store }),
    /DAILY_MAX_REPORTS/,
  );
  await assert.rejects(startFromEnvironment({ EDGE_KEYS: KEY, PORT: "70000" }, { store }), /PORT/);
});
