// The storage port in memory, for tests. It keeps what the real store keeps and refuses what the
// real store refuses, so the server's tests mean something.
import { CapacityError, dayIdFor } from "./store-port.mjs";

export function createMemoryStore() {
  const records = new Map();
  const counters = new Map();
  let failure = null;
  let gate = null;
  return {
    records,
    counters,
    /** The next storeReport rejects with this error, once. */
    failNext(error) {
      failure = error;
    },
    /** The next storeReport waits for this promise before it writes. */
    holdNext(promise) {
      gate = promise;
    },
    async storeReport({ receiptId, receivedAtMs, expiresAtMs, report }, { dailyMax }) {
      if (gate) {
        const waiting = gate;
        gate = null;
        await waiting;
      }
      if (failure) {
        const error = failure;
        failure = null;
        throw error;
      }
      const day = dayIdFor(receivedAtMs);
      const used = counters.get(day) ?? 0;
      if (used >= dailyMax) throw new CapacityError();
      if (records.has(receiptId)) throw new Error("already_exists");
      records.set(receiptId, structuredClone({ receivedAtMs, expiresAtMs, report }));
      counters.set(day, used + 1);
    },
    async getReport(receiptId) {
      const stored = records.get(receiptId);
      if (!stored) return null;
      return {
        receiptId,
        receivedAt: new Date(stored.receivedAtMs).toISOString(),
        expiresAt: new Date(stored.expiresAtMs).toISOString(),
        report: structuredClone(stored.report),
      };
    },
    async deleteReport(receiptId) {
      return records.delete(receiptId);
    },
  };
}
