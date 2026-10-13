import { lstat, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const RECEIPT = /^air_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const [command, receipt] = process.argv.slice(2);
const queueDir = process.env.AI_REPORT_QUEUE_DIR;

if (!queueDir || !path.isAbsolute(queueDir))
  throw new Error("AI_REPORT_QUEUE_DIR must be absolute");
if (!RECEIPT.test(receipt ?? "")) throw new Error("A valid server receipt ID is required");
const queueInfo = await lstat(queueDir);
if (!queueInfo.isDirectory() || queueInfo.isSymbolicLink()) {
  throw new Error("Queue path must be a real directory, not a symbolic link");
}
const file = path.join(queueDir, `${receipt}.json`);
const fileInfo = await lstat(file);
if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
  throw new Error("Receipt must resolve to a regular queue file, not a symbolic link");
}

if (command === "show") {
  process.stdout.write(await readFile(file, "utf8"));
} else if (command === "delete") {
  await unlink(file);
  const directory = await open(queueDir, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  const remains = (await readdir(queueDir)).includes(`${receipt}.json`);
  if (remains) throw new Error("Deletion verification failed");
  process.stdout.write(`${receipt} deleted and absence verified\n`);
} else {
  throw new Error("Usage: queue-admin.mjs show|delete RECEIPT_ID");
}
