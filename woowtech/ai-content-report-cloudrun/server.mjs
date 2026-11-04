// Receiver for AI content reports, as a Cloud Run service (design: the same shape as smart-push).
//
// Reachable only through the Cloudflare Worker `smart-reports-proxy` (reports.woowtech.io): the
// Worker adds the edge key, and a request without it is refused before its body is read.
// The App's contract is contract.mjs, the same file the first (file queue) receiver used.
import http from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { MAX_BODY_BYTES, REPORT_PATH, REPORT_SCHEMA_VERSION, validateReport } from "./contract.mjs";
import { CapacityError, DAY_MS, dayEndMs } from "./store-port.mjs";

export const EDGE_KEY_HEADER = "x-woowtech-edge-key";
const MIN_EDGE_KEY_LENGTH = 32;
const JSON_TYPE = "application/json";
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_DAILY_MAX = 2000;
// The Worker in front gives up on this service after 12 s and the App after 15 s. Answering first
// with our own 500 keeps the failure on the record (a log line) and the instance from holding a
// request while Firestore retries for a minute.
const DEFAULT_STORE_TIMEOUT_MS = 8000;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

class DeadlineError extends Error {
  constructor() {
    super("store_timeout");
    this.name = "DeadlineError";
  }
}

// Settles like `promise`, or rejects with DeadlineError after `ms`. The work behind `promise` is
// not cancelled (a Firestore transaction cannot be). The race keeps listening to it, so a failure
// that arrives after the deadline is not an unhandled rejection, which would stop the process.
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError()), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const digest = (value) => createHash("sha256").update(value).digest();

/**
 * Compares a presented edge key with every accepted key in constant time. Two keys are accepted
 * while a key is being rotated.
 */
export function edgeKeyAccepted(presented, acceptedKeys) {
  if (typeof presented !== "string" || presented === "") return false;
  const presentedDigest = digest(presented);
  let accepted = false;
  for (const key of acceptedKeys) {
    // Hashing first gives equal-length buffers; every key is compared so timing reveals nothing.
    accepted = timingSafeEqual(presentedDigest, digest(key)) || accepted;
  }
  return accepted;
}

/**
 * Reads the accepted edge keys from EDGE_KEYS: one key, or two separated by a comma or whitespace
 * while a key is being rotated. A weak or missing key stops the service from starting. Error
 * messages never include a key.
 */
export function parseEdgeKeys(raw) {
  const keys = String(raw ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (keys.length < 1 || keys.length > 2) {
    throw new Error("EDGE_KEYS must hold one edge key, or two while rotating");
  }
  if (keys.some((key) => key.length < MIN_EDGE_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key))) {
    throw new Error(`Each edge key must be at least ${MIN_EDGE_KEY_LENGTH} printable characters`);
  }
  return keys;
}

function respond(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": `${JSON_TYPE}; charset=utf-8`,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body === null ? undefined : JSON.stringify(body));
}

// Answers sent before the request body was read close the connection, so a client cannot keep
// pushing a body at a socket that has already been answered.
const earlyAnswer = { connection: "close" };

async function readJson(req) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, "body_too_large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

// One JSON object per line, as Cloud Run turns into a log entry: `severity` becomes the entry's
// severity, the rest its jsonPayload. Callers pass fixed codes and receipt numbers, never report
// text, request headers or addresses.
function writeLogLine(entry) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export function createReportServer({
  store,
  edgeKeys,
  now = Date.now,
  retentionMs = DEFAULT_RETENTION_DAYS * DAY_MS,
  dailyMax = DEFAULT_DAILY_MAX,
  storeTimeoutMs = DEFAULT_STORE_TIMEOUT_MS,
  log = writeLogLine,
  newReceiptId = () => `air_${randomUUID()}`,
} = {}) {
  if (!store) throw new Error("store is required");
  if (!Array.isArray(edgeKeys) || edgeKeys.length < 1 || edgeKeys.length > 2) {
    throw new Error("edgeKeys must hold one key, or two while rotating");
  }

  async function handle(req, res) {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/health") return respond(res, 200, { status: "ok" });
    if (url !== REPORT_PATH) return respond(res, 404, { error: "not_found" });
    if (req.method !== "POST") {
      return respond(res, 405, { error: "method_not_allowed" }, { allow: "POST", ...earlyAnswer });
    }
    if (!edgeKeyAccepted(req.headers[EDGE_KEY_HEADER], edgeKeys)) {
      return respond(res, 403, { error: "forbidden" }, earlyAnswer);
    }
    // The app sends no Origin: only a browser does, and no browser page is meant to post here.
    if (req.headers.origin !== undefined) {
      return respond(res, 403, { error: "origin_not_allowed" }, earlyAnswer);
    }
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith(JSON_TYPE)) {
      return respond(res, 415, { error: "content_type_required" }, earlyAnswer);
    }

    let report;
    try {
      report = await readJson(req);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return respond(
        res,
        error.status,
        { error: error.code },
        error.status === 413 ? earlyAnswer : {},
      );
    }
    const problem = validateReport(report);
    if (problem) return respond(res, 400, { error: problem });

    const timestamp = now();
    const receiptId = newReceiptId();
    const receivedAt = new Date(timestamp).toISOString();
    try {
      await withDeadline(
        store.storeReport(
          { receiptId, receivedAtMs: timestamp, expiresAtMs: timestamp + retentionMs, report },
          { dailyMax },
        ),
        storeTimeoutMs,
      );
    } catch (error) {
      if (error instanceof CapacityError) {
        log({ severity: "WARNING", event: "ai_report_rejected", code: "capacity" });
        const retryAfter = Math.max(60, Math.ceil((dayEndMs(timestamp) - timestamp) / 1000));
        return respond(res, 429, { error: "capacity" }, { "retry-after": String(retryAfter) });
      }
      // The answer is the same for the App; the log tells a slow store from a broken one.
      const code = error instanceof DeadlineError ? "storage_timeout" : "storage_unavailable";
      log({ severity: "ERROR", event: "ai_report_error", code });
      return respond(res, 500, { error: "storage_unavailable" });
    }
    // The log line comes after the write is confirmed and before the answer: Cloud Run may slow
    // the instance once the answer is out, and this line is what the notification mail waits for.
    log({ severity: "NOTICE", event: "ai_report_stored", receiptId });
    return respond(res, 201, { schemaVersion: REPORT_SCHEMA_VERSION, receiptId, receivedAt });
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch {
      log({ severity: "ERROR", event: "ai_report_error", code: "internal_error" });
      if (!res.headersSent) respond(res, 500, { error: "internal_error" });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

function integerFrom(raw, fallback, min, max, name) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/**
 * Starts the service the way Cloud Run runs it. Environment: EDGE_KEYS (from Secret Manager),
 * PORT (Cloud Run sets it), RETENTION_DAYS (default 30), DAILY_MAX_REPORTS (default 2000),
 * GOOGLE_CLOUD_PROJECT.
 */
export async function startFromEnvironment(env = process.env, { store } = {}) {
  const edgeKeys = parseEdgeKeys(env.EDGE_KEYS);
  const retentionDays = integerFrom(
    env.RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    1,
    365,
    "RETENTION_DAYS",
  );
  const dailyMax = integerFrom(
    env.DAILY_MAX_REPORTS,
    DEFAULT_DAILY_MAX,
    1,
    100_000,
    "DAILY_MAX_REPORTS",
  );
  const port = integerFrom(env.PORT, 8080, 1, 65_535, "PORT");
  const reportStore =
    store ??
    (await (await import("./firestore-store.mjs")).createFirestoreStoreFromEnvironment(env));
  const server = createReportServer({
    store: reportStore,
    edgeKeys,
    retentionMs: retentionDays * DAY_MS,
    dailyMax,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  writeLogLine({ severity: "INFO", event: "ai_report_receiver_started" });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A failure nobody awaited (a late gRPC error, say) is logged by code only; by default Node
  // would stop the process and drop the requests in flight.
  process.on("unhandledRejection", () => {
    writeLogLine({ severity: "ERROR", event: "ai_report_error", code: "unhandled_rejection" });
  });
  try {
    const server = await startFromEnvironment();
    // Cloud Run sends SIGTERM before it stops an instance: finish the requests in flight.
    process.once("SIGTERM", () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 8000).unref();
    });
  } catch (error) {
    const code = String(error?.message ?? error).slice(0, 200);
    writeLogLine({ severity: "CRITICAL", event: "ai_report_start_failed", code });
    process.exitCode = 1;
  }
}
