import test from "node:test";
import assert from "node:assert/strict";
import { createFirestoreStore } from "./firestore-store.mjs";
import { CapacityError, DAY_MS, dayEndMs, dayIdFor } from "./store-port.mjs";
import { validReport } from "./support.mjs";

// The smallest Firestore that has the methods the store uses, with the one property that matters
// here: a transaction's writes land together, only when its function finishes, and a create on a
// document that exists fails the whole transaction.
class FakeTimestamp {
  constructor(ms) {
    this.ms = ms;
  }
  static fromMillis(ms) {
    return new FakeTimestamp(ms);
  }
  toMillis() {
    return this.ms;
  }
}

function createFakeFirestore({ ignoreDeletes = false } = {}) {
  const docs = new Map();
  const snapshot = (path) => ({
    exists: docs.has(path),
    get: (field) => docs.get(path)?.[field],
  });
  const reference = (collection, id) => {
    const path = `${collection}/${id}`;
    return {
      path,
      get: async () => snapshot(path),
      delete: async (precondition) => {
        if (precondition?.exists && !docs.has(path)) {
          throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
        }
        if (!ignoreDeletes) docs.delete(path);
      },
    };
  };
  return {
    docs,
    collection: (name) => ({ doc: (id) => reference(name, id) }),
    async runTransaction(update) {
      const writes = [];
      const transaction = {
        get: async (ref) => snapshot(ref.path),
        create: (ref, data) => writes.push({ kind: "create", path: ref.path, data }),
        set: (ref, data) => writes.push({ kind: "set", path: ref.path, data }),
      };
      const result = await update(transaction);
      for (const write of writes) {
        if (write.kind === "create" && docs.has(write.path)) {
          throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
        }
      }
      for (const write of writes) docs.set(write.path, { ...write.data });
      return result;
    },
  };
}

const RECEIPT = "air_11111111-1111-4111-8111-111111111111";
const OTHER_RECEIPT = "air_22222222-2222-4222-8222-222222222222";
const NOON = Date.UTC(2026, 9, 14, 12, 0, 0);
const record = (overrides = {}) => ({
  receiptId: RECEIPT,
  receivedAtMs: NOON,
  expiresAtMs: NOON + 30 * DAY_MS,
  report: validReport({ reportedContent: "attached text" }),
  ...overrides,
});
const setup = (options) => {
  const firestore = createFakeFirestore(options);
  return { firestore, store: createFirestoreStore({ firestore, Timestamp: FakeTimestamp }) };
};

test("a report is one document under its receipt number: receivedAt, expiresAt, report, nothing else", async () => {
  const { firestore, store } = setup();
  const input = record();
  await store.storeReport(input, { dailyMax: 10 });
  const document = firestore.docs.get(`aiContentReports/${RECEIPT}`);
  assert.deepEqual(Object.keys(document).sort(), ["expiresAt", "receivedAt", "report"]);
  // expiresAt is the field the TTL policy watches, so it has to be a Firestore Timestamp.
  assert.ok(document.expiresAt instanceof FakeTimestamp);
  assert.ok(document.receivedAt instanceof FakeTimestamp);
  assert.equal(document.receivedAt.toMillis(), NOON);
  assert.equal(document.expiresAt.toMillis(), NOON + 30 * DAY_MS);
  assert.deepEqual(document.report, input.report);
});

test("the same transaction counts the report on its UTC day, and the counter expires too", async () => {
  const { firestore, store } = setup();
  await store.storeReport(record(), { dailyMax: 10 });
  await store.storeReport(record({ receiptId: OTHER_RECEIPT }), { dailyMax: 10 });
  const counter = firestore.docs.get("aiContentReportCounters/20261014");
  assert.equal(counter.count, 2);
  assert.equal(counter.day, "20261014");
  assert.ok(counter.expiresAt instanceof FakeTimestamp);
  assert.equal(counter.expiresAt.toMillis(), dayEndMs(NOON) + 2 * DAY_MS);
  assert.deepEqual(Object.keys(counter).sort(), ["count", "day", "expiresAt"]);
});

test("a new UTC day has its own counter", async () => {
  const { firestore, store } = setup();
  const lastSecond = Date.UTC(2026, 9, 14, 23, 59, 59);
  const firstSecond = Date.UTC(2026, 9, 15, 0, 0, 0);
  assert.equal(dayIdFor(lastSecond), "20261014");
  assert.equal(dayIdFor(firstSecond), "20261015");
  await store.storeReport(record({ receivedAtMs: lastSecond }), { dailyMax: 1 });
  await store.storeReport(record({ receiptId: OTHER_RECEIPT, receivedAtMs: firstSecond }), {
    dailyMax: 1,
  });
  assert.equal(firestore.docs.get("aiContentReportCounters/20261014").count, 1);
  assert.equal(firestore.docs.get("aiContentReportCounters/20261015").count, 1);
});

test("a full day rejects with CapacityError and writes nothing", async () => {
  const { firestore, store } = setup();
  await store.storeReport(record(), { dailyMax: 1 });
  await assert.rejects(
    store.storeReport(record({ receiptId: OTHER_RECEIPT }), { dailyMax: 1 }),
    CapacityError,
  );
  assert.equal(firestore.docs.has(`aiContentReports/${OTHER_RECEIPT}`), false);
  assert.equal(firestore.docs.get("aiContentReportCounters/20261014").count, 1);
});

test("a report that cannot be created is not counted", async () => {
  const { firestore, store } = setup();
  firestore.docs.set(`aiContentReports/${RECEIPT}`, { receivedAt: new FakeTimestamp(1) });
  await assert.rejects(store.storeReport(record(), { dailyMax: 10 }), /ALREADY_EXISTS/);
  assert.equal(firestore.docs.has("aiContentReportCounters/20261014"), false);
});

test("getReport gives back the report with ISO times, or null", async () => {
  const { store } = setup();
  const input = record();
  await store.storeReport(input, { dailyMax: 10 });
  assert.deepEqual(await store.getReport(RECEIPT), {
    receiptId: RECEIPT,
    receivedAt: new Date(NOON).toISOString(),
    expiresAt: new Date(NOON + 30 * DAY_MS).toISOString(),
    report: input.report,
  });
  assert.equal(await store.getReport(OTHER_RECEIPT), null);
});

test("deleteReport removes it and reads back; a missing report is false", async () => {
  const { firestore, store } = setup();
  await store.storeReport(record(), { dailyMax: 10 });
  assert.equal(await store.deleteReport(RECEIPT), true);
  assert.equal(firestore.docs.has(`aiContentReports/${RECEIPT}`), false);
  assert.equal(await store.deleteReport(RECEIPT), false);
});

test("deleteReport does not say deleted when the report is still there", async () => {
  const { store } = setup({ ignoreDeletes: true });
  await store.storeReport(record(), { dailyMax: 10 });
  await assert.rejects(store.deleteReport(RECEIPT), /delete_not_confirmed/);
});
