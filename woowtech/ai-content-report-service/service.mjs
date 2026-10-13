import http from "node:http";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_BODY_BYTES, REPORT_PATH, validateReport } from "./contract.mjs";

const JSON_TYPE = "application/json";
const OWNED_FILE = /^air_[0-9a-f-]+\.json$/;

async function ensureRestrictedQueueDir(queueDir) {
  await mkdir(queueDir, { recursive: true, mode: 0o700 });
  const info = await stat(queueDir);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw new Error("queue directory must be private");
}

function corsHeaders(origin, allowedOrigins) {
  return origin && allowedOrigins.has(origin)
    ? { "access-control-allow-origin": origin, vary: "Origin" }
    : {};
}

function respond(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": `${JSON_TYPE}; charset=utf-8`,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body === null ? undefined : JSON.stringify(body));
}

async function readJson(req) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw Object.assign(new Error("body_too_large"), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("body_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

export async function cleanupExpired(queueDir, retentionMs, now = Date.now()) {
  await ensureRestrictedQueueDir(queueDir);
  let removed = 0;
  for (const name of await readdir(queueDir)) {
    if (!OWNED_FILE.test(name)) continue;
    const file = path.join(queueDir, name);
    const info = await stat(file).catch((error) =>
      error.code === "ENOENT" ? null : Promise.reject(error),
    );
    if (info?.isFile() && now - info.mtimeMs > retentionMs) {
      await unlink(file).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      removed += 1;
    }
  }
  return removed;
}

async function assertQueueCapacity(queueDir, maxRecords, maxBytes, incomingBytes) {
  await ensureRestrictedQueueDir(queueDir);
  if (incomingBytes > maxBytes) throw Object.assign(new Error("queue_full"), { status: 503 });
  const names = (await readdir(queueDir)).filter((name) => OWNED_FILE.test(name));
  if (names.length >= maxRecords) throw Object.assign(new Error("queue_full"), { status: 503 });
  let bytes = 0;
  for (const name of names) {
    const info = await stat(path.join(queueDir, name)).catch((error) =>
      error.code === "ENOENT" ? null : Promise.reject(error),
    );
    if (info?.isFile()) bytes += info.size;
    if (bytes + incomingBytes > maxBytes)
      throw Object.assign(new Error("queue_full"), { status: 503 });
  }
}

export async function persistRecord(queueDir, record, io = { open, rename, unlink }) {
  await ensureRestrictedQueueDir(queueDir);
  const finalFile = path.join(queueDir, `${record.receiptId}.json`);
  const temporaryFile = `${finalFile}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await io.open(temporaryFile, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await io.rename(temporaryFile, finalFile);
    const directory = await io.open(queueDir, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await io.unlink(temporaryFile).catch(() => undefined);
    throw error;
  }
}

function singleRawHeader(req, expectedName) {
  const values = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === expectedName)
      values.push(req.rawHeaders[index + 1]);
  }
  return values.length === 1 ? values[0] : null;
}

function rateLimitAddress(req, trustedProxyAddress, clientAddressHeader) {
  const peer = req.socket.remoteAddress ?? "unknown";
  if (!trustedProxyAddress || peer !== trustedProxyAddress) return { address: peer, error: null };
  const forwarded = singleRawHeader(req, clientAddressHeader);
  if (typeof forwarded !== "string" || !isIP(forwarded)) {
    return { address: null, error: "invalid_client_address" };
  }
  return { address: forwarded, error: null };
}

function applyRateLimit({ attempts, address, timestamp, rateLimit, rateWindowMs }) {
  for (const [knownAddress, times] of attempts) {
    const active = times.filter((time) => timestamp - time < rateWindowMs);
    if (active.length) attempts.set(knownAddress, active);
    else attempts.delete(knownAddress);
  }
  const recent = attempts.get(address) ?? [];
  if (recent.length >= rateLimit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((rateWindowMs - (timestamp - recent[0])) / 1000)),
    };
  }
  recent.push(timestamp);
  attempts.set(address, recent);
  return { allowed: true, retryAfter: null };
}

export function createReportServer({
  queueDir,
  allowedOrigins = [],
  rateLimit = 5,
  rateWindowMs = 600_000,
  maxQueueRecords = 10_000,
  maxQueueBytes = 100 * 1024 * 1024,
  trustedProxyAddress = null,
  clientAddressHeader = null,
  now = Date.now,
  writeRecord = persistRecord,
} = {}) {
  if (!queueDir) throw new Error("queueDir is required");
  if ((trustedProxyAddress === null) !== (clientAddressHeader === null))
    throw new Error("trusted proxy address and client address header must be configured together");
  if (trustedProxyAddress !== null && !isIP(trustedProxyAddress))
    throw new Error("trusted proxy address must be an IP literal");
  if (clientAddressHeader !== null && !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(clientAddressHeader))
    throw new Error("invalid client address header");
  const origins = new Set(allowedOrigins);
  const attempts = new Map();
  let operationTail = Promise.resolve();
  const enqueue = (operation) => {
    const current = operationTail.then(operation);
    operationTail = current.catch(() => undefined);
    return current;
  };
  const server = http.createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : null;
    const cors = corsHeaders(origin, origins);
    if (origin && !origins.has(origin)) return respond(res, 403, { error: "origin_not_allowed" });
    if (req.method === "OPTIONS" && req.url === REPORT_PATH)
      return respond(res, 204, null, {
        ...cors,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
    if (req.method === "GET" && req.url === "/health")
      return respond(res, 200, { status: "ok" }, cors);
    if (req.method !== "POST" || req.url !== REPORT_PATH)
      return respond(res, 404, { error: "not_found" }, cors);
    if (
      !String(req.headers["content-type"] ?? "")
        .toLowerCase()
        .startsWith(JSON_TYPE)
    )
      return respond(res, 415, { error: "content_type_required" }, cors);
    const timestamp = now();
    const client = rateLimitAddress(req, trustedProxyAddress, clientAddressHeader);
    if (client.error) return respond(res, 400, { error: client.error }, cors);
    const rateLimitResult = applyRateLimit({
      attempts,
      address: client.address,
      timestamp,
      rateLimit,
      rateWindowMs,
    });
    if (!rateLimitResult.allowed) {
      return respond(
        res,
        429,
        { error: "rate_limited" },
        { ...cors, "retry-after": String(rateLimitResult.retryAfter) },
      );
    }
    try {
      const report = await readJson(req);
      const error = validateReport(report);
      if (error) return respond(res, 400, { error }, cors);
      const receivedAt = new Date(timestamp).toISOString();
      const receiptId = `air_${randomUUID()}`;
      const record = { receiptId, receivedAt, report };
      const incomingBytes = Buffer.byteLength(`${JSON.stringify(record)}\n`, "utf8");
      await enqueue(async () => {
        await assertQueueCapacity(queueDir, maxQueueRecords, maxQueueBytes, incomingBytes);
        await writeRecord(queueDir, record);
      });
      return respond(res, 201, { schemaVersion: 1, receiptId, receivedAt }, cors);
    } catch (error) {
      const status = Number(error?.status) || 500;
      return respond(
        res,
        status,
        { error: status === 500 ? "storage_unavailable" : error.message },
        cors,
      );
    }
  });
  server.cleanupQueue = (retentionMs) => enqueue(() => cleanupExpired(queueDir, retentionMs));
  return server;
}

function parseOrigins(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => new URL(item).origin);
}

function parseQueueLimits(env) {
  const retentionDays = Number(env.AI_REPORT_RETENTION_DAYS || 30);
  const maxQueueRecords = Number(env.AI_REPORT_MAX_QUEUE_RECORDS || 10_000);
  const maxQueueBytes = Number(env.AI_REPORT_MAX_QUEUE_BYTES || 100 * 1024 * 1024);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365)
    throw new Error("invalid retention");
  if (!Number.isInteger(maxQueueRecords) || maxQueueRecords < 1)
    throw new Error("invalid record limit");
  if (!Number.isInteger(maxQueueBytes) || maxQueueBytes < 1) throw new Error("invalid byte limit");
  const retentionMs = retentionDays * 86_400_000;
  return { retentionMs, maxQueueRecords, maxQueueBytes };
}

export async function startFromEnvironment(env = process.env) {
  const host = env.AI_REPORT_HOST?.trim() || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && env.AI_REPORT_ALLOW_NON_LOOPBACK !== "1")
    throw new Error("Refusing non-loopback bind");
  const queueDir = env.AI_REPORT_QUEUE_DIR?.trim();
  if (!queueDir || !path.isAbsolute(queueDir))
    throw new Error("AI_REPORT_QUEUE_DIR must be absolute");
  const { retentionMs, maxQueueRecords, maxQueueBytes } = parseQueueLimits(env);
  const trustedProxyAddress = env.AI_REPORT_TRUSTED_PROXY_ADDRESS?.trim() || null;
  const clientAddressHeader = env.AI_REPORT_CLIENT_ADDRESS_HEADER?.trim().toLowerCase() || null;
  const server = createReportServer({
    queueDir,
    allowedOrigins: parseOrigins(env.AI_REPORT_ALLOWED_ORIGINS),
    maxQueueRecords,
    maxQueueBytes,
    trustedProxyAddress,
    clientAddressHeader,
  });
  await server.cleanupQueue(retentionMs);
  const timer = setInterval(
    () => {
      void server
        .cleanupQueue(retentionMs)
        .catch((error) => process.stderr.write(`queue cleanup failed: ${error.message}\n`));
    },
    Math.min(retentionMs, 86_400_000),
  );
  timer.unref();
  server.once("close", () => clearInterval(timer));
  await new Promise((resolve, reject) =>
    server.listen(Number(env.AI_REPORT_PORT || 8787), host, resolve).once("error", reject),
  );
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`)
  startFromEnvironment()
    .then((server) => {
      const address = server.address();
      process.stdout.write(
        `AI report service listening on ${typeof address === "object" ? `${address.address}:${address.port}` : address}\n`,
      );
      return server;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
