// The storage port the receiver talks to. firestore-store.mjs is the real one; memory-store.mjs
// is for tests.
//
//   storeReport({ receiptId, receivedAtMs, expiresAtMs, report }, { dailyMax }) -> Promise<void>
//       Writes the report and counts it against the UTC day of receivedAtMs, in one step. Rejects
//       with CapacityError when the day already holds dailyMax reports, and writes nothing then.
//   getReport(receiptId) -> Promise<{ receiptId, receivedAt, expiresAt, report } | null>
//   deleteReport(receiptId) -> Promise<boolean>   true only when it existed and is now gone

export const REPORTS_COLLECTION = "aiContentReports";
export const COUNTERS_COLLECTION = "aiContentReportCounters";

// The server names a report air_<uuid v4>; nothing the client sends becomes a document ID.
export const RECEIPT_ID =
  /^air_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const DAY_MS = 86_400_000;

export class CapacityError extends Error {
  constructor() {
    super("daily_capacity_reached");
    this.name = "CapacityError";
  }
}

/** The UTC day of a timestamp, as YYYYMMDD. */
export function dayIdFor(ms) {
  const day = new Date(ms);
  const month = String(day.getUTCMonth() + 1).padStart(2, "0");
  const date = String(day.getUTCDate()).padStart(2, "0");
  return `${day.getUTCFullYear()}${month}${date}`;
}

/** When the UTC day of a timestamp ends. */
export function dayEndMs(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS + DAY_MS;
}
