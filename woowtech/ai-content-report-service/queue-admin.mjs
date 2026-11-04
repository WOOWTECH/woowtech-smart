import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RECEIPT,
  readPrivate,
  syncDirectory,
  withNotificationLock,
  cleanupNotificationStates,
} from "./notification-storage.mjs";

export async function deleteReceipt(queueDir, receipt) {
  if (!RECEIPT.test(receipt ?? "")) throw new Error("A valid server receipt ID is required");
  return withNotificationLock(queueDir, async (dir) => {
    const file = path.join(queueDir, `${receipt}.json`);
    // Retrying a deletion after a crash must also clear any orphaned state.
    try {
      await readPrivate(file);
      await unlink(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await syncDirectory(queueDir);
    await cleanupNotificationStates(queueDir, dir, Infinity, Date.now());
    if (
      (await readdir(queueDir)).includes(`${receipt}.json`) ||
      (await readdir(dir)).includes(`${receipt}.json`)
    )
      throw new Error("Deletion verification failed");
  });
}

async function main() {
  const [command, receipt] = process.argv.slice(2);
  const queueDir = process.env.AI_REPORT_QUEUE_DIR;
  if (!queueDir || !path.isAbsolute(queueDir))
    throw new Error("AI_REPORT_QUEUE_DIR must be absolute");
  if (!RECEIPT.test(receipt ?? "")) throw new Error("A valid server receipt ID is required");
  if (command === "show") {
    const queueInfo = await lstat(queueDir);
    if (!queueInfo.isDirectory() || queueInfo.isSymbolicLink())
      throw new Error("Queue must be a real directory");
    process.stdout.write((await readPrivate(path.join(queueDir, `${receipt}.json`))).text);
  } else if (command === "delete") {
    await deleteReceipt(queueDir, receipt);
    process.stdout.write("Report and notification state deleted and absence verified\n");
  } else throw new Error("Usage: queue-admin.mjs show|delete RECEIPT_ID");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("Queue operation failed; check private paths and worker lock.\n");
    process.exitCode = 1;
  });
}
