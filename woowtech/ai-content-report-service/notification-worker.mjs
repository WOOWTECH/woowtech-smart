import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RECEIPT,
  readPrivate,
  writeState,
  withNotificationLock,
  cleanupNotificationStates,
} from "./notification-storage.mjs";
import { createGmailTransport, loadGmailCredentials } from "./gmail-transport.mjs";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 60_000;

function validateState(state) {
  const statuses = ["sending", "sent", "retry", "blocked", "unknown"];
  if (
    !state ||
    state.version !== 1 ||
    !statuses.includes(state.status) ||
    !Number.isInteger(state.attempts) ||
    state.attempts < 1 ||
    state.attempts > MAX_ATTEMPTS ||
    !Number.isFinite(state.updatedAt) ||
    (state.status === "retry" && !Number.isFinite(state.nextAttemptAt))
  )
    throw new Error("invalid notification state; manual review required");
  return state;
}

async function deliverNotification({ dir, receipt, previous, transport, now }) {
  const attempts = (previous?.attempts ?? 0) + 1;
  if (attempts > MAX_ATTEMPTS) throw new Error("invalid exhausted retry state");
  await writeState(dir, receipt, { version: 1, status: "sending", attempts, updatedAt: now() });
  let result;
  try {
    result = await transport.send(receipt);
  } catch {
    // An arbitrary transport exception cannot establish that Gmail did not accept mail.
    result = { status: "unknown" };
  }
  let status = result?.status;
  if (!["sent", "retry", "blocked", "unknown"].includes(status)) status = "unknown";
  if (status === "retry" && attempts === MAX_ATTEMPTS) status = "blocked";
  const next = { version: 1, status, attempts, updatedAt: now() };
  if (status === "retry") next.nextAttemptAt = now() + BACKOFF_MS * 2 ** (attempts - 1);
  await writeState(dir, receipt, next);
  return status;
}

async function countUnresolved(dir) {
  const unresolved = { retry: 0, blocked: 0, unknown: 0, sending: 0 };
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json") || !RECEIPT.test(name.slice(0, -5))) continue;
    const state = validateState(JSON.parse((await readPrivate(path.join(dir, name))).text));
    if (Object.hasOwn(unresolved, state.status)) unresolved[state.status]++;
  }
  return unresolved;
}

export async function runNotifications({
  queueDir,
  transport,
  now = Date.now,
  retentionMs = 30 * 86_400_000,
}) {
  if (!Number.isFinite(retentionMs) || retentionMs <= 0) throw new Error("invalid retention");
  return withNotificationLock(queueDir, async (dir) => {
    const counts = { sent: 0, retry: 0, blocked: 0, unknown: 0 };
    await cleanupNotificationStates(queueDir, dir, retentionMs, now());
    for (const name of (await readdir(queueDir)).sort()) {
      const receipt = name.slice(0, -5);
      if (!name.endsWith(".json") || !RECEIPT.test(receipt)) continue;
      let record;
      try {
        record = await readPrivate(path.join(queueDir, name));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (now() - record.mtimeMs > retentionMs) continue;
      const parsed = JSON.parse(record.text);
      if (parsed.receiptId !== receipt) throw new Error("receipt mismatch");
      let previous = null;
      try {
        previous = validateState(JSON.parse((await readPrivate(path.join(dir, name))).text));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (previous?.status === "sending") {
        await writeState(dir, receipt, { ...previous, status: "unknown", updatedAt: now() });
        counts.unknown++;
        continue;
      }
      if (previous && previous.status !== "retry") continue;
      if (previous && previous.nextAttemptAt > now()) continue;
      const status = await deliverNotification({ dir, receipt, previous, transport, now });
      counts[status]++;
    }
    await cleanupNotificationStates(queueDir, dir, retentionMs, now());
    const unresolved = await countUnresolved(dir);
    return { processed: counts, unresolved };
  });
}

export async function notificationFromEnvironment(env = process.env) {
  const credentials = await loadGmailCredentials(env.AI_REPORT_GMAIL_ENV_FILE);
  const days = Number(env.AI_REPORT_RETENTION_DAYS || 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("invalid retention");
  return runNotifications({
    queueDir: env.AI_REPORT_QUEUE_DIR,
    retentionMs: days * 86_400_000,
    transport: createGmailTransport({ credentials }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  notificationFromEnvironment()
    .then((counts) => {
      process.stdout.write(`${JSON.stringify(counts)}\n`);
      if (Object.values(counts.unresolved).some((count) => count > 0)) process.exitCode = 2;
      return counts;
    })
    .catch(() => {
      process.stderr.write(
        "Notification worker stopped; inspect private configuration, lock and state.\n",
      );
      process.exitCode = 1;
    });
}
