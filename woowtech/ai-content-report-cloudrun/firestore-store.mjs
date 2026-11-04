// The storage port on Firestore: the (default) database of project woowtech-smart, asia-east1,
// the one smart-push already uses.
//
//   aiContentReports/<receiptId>        { receivedAt, expiresAt, report }
//   aiContentReportCounters/<YYYYMMDD>  { day, count, expiresAt }
//
// `expiresAt` carries a Firestore TTL policy (deploy script, step "ttl"): Firestore deletes an
// expired document, typically within 24 hours of its expiry, and until then it can still be read.
// A report is written and counted in one transaction, so the daily cap is exact and a report that
// fails to write is not counted. Nothing about the sender (address, user agent) is stored.
import {
  CapacityError,
  COUNTERS_COLLECTION,
  DAY_MS,
  dayEndMs,
  dayIdFor,
  REPORTS_COLLECTION,
} from "./store-port.mjs";

// gRPC status NOT_FOUND, as the Firestore client reports it on a failed `exists: true` precondition.
const NOT_FOUND = 5;
// A day's counter outlives its day by two days, then the TTL policy removes it too.
const COUNTER_EXTRA_MS = 2 * DAY_MS;

/**
 * @param {{ firestore: object, Timestamp: { fromMillis(ms: number): unknown } }} deps
 *   The @google-cloud/firestore client and its Timestamp class (injected so tests need neither).
 */
export function createFirestoreStore({ firestore, Timestamp }) {
  const reports = () => firestore.collection(REPORTS_COLLECTION);
  const counters = () => firestore.collection(COUNTERS_COLLECTION);

  return {
    async storeReport({ receiptId, receivedAtMs, expiresAtMs, report }, { dailyMax }) {
      const day = dayIdFor(receivedAtMs);
      const reportRef = reports().doc(receiptId);
      const counterRef = counters().doc(day);
      await firestore.runTransaction(async (transaction) => {
        // Firestore transactions read first, then write.
        const counter = await transaction.get(counterRef);
        const used = counter.exists ? Number(counter.get("count")) || 0 : 0;
        if (used >= dailyMax) throw new CapacityError();
        transaction.create(reportRef, {
          receivedAt: Timestamp.fromMillis(receivedAtMs),
          expiresAt: Timestamp.fromMillis(expiresAtMs),
          report,
        });
        transaction.set(counterRef, {
          day,
          count: used + 1,
          expiresAt: Timestamp.fromMillis(dayEndMs(receivedAtMs) + COUNTER_EXTRA_MS),
        });
      });
    },

    async getReport(receiptId) {
      const snapshot = await reports().doc(receiptId).get();
      if (!snapshot.exists) return null;
      return {
        receiptId,
        receivedAt: new Date(snapshot.get("receivedAt").toMillis()).toISOString(),
        expiresAt: new Date(snapshot.get("expiresAt").toMillis()).toISOString(),
        report: snapshot.get("report"),
      };
    },

    async deleteReport(receiptId) {
      const ref = reports().doc(receiptId);
      try {
        await ref.delete({ exists: true });
      } catch (error) {
        if (error?.code === NOT_FOUND) return false;
        throw error;
      }
      // Read it back: "deleted" means it is gone, not that the call returned.
      if ((await ref.get()).exists) throw new Error("delete_not_confirmed");
      return true;
    },
  };
}

/** The real thing: Application Default Credentials, i.e. the Cloud Run service account. */
export async function createFirestoreStoreFromEnvironment(env = process.env) {
  const { Firestore, Timestamp } = await import("@google-cloud/firestore");
  const firestore = new Firestore(
    env.GOOGLE_CLOUD_PROJECT ? { projectId: env.GOOGLE_CLOUD_PROJECT } : {},
  );
  return createFirestoreStore({ firestore, Timestamp });
}
