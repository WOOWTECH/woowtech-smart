// Looks at or deletes one report by receipt number, with the operator's own Google credentials.
//
//   node admin.mjs show   air_<uuid>
//   node admin.mjs delete air_<uuid>
//
// Setup, once: `npm ci --omit=dev` in this folder and `gcloud auth application-default login`.
// The Firestore page of the Google Cloud console does the same (collection aiContentReports);
// this exists for a terminal.
//
// `show` prints the report, including any text the person chose to attach, so it runs only on a
// terminal that is not being recorded: it refuses when stdout is piped or redirected, and it
// writes nothing to any log. Do not paste its output into chat, tickets or CI.
// `delete` prints only whether the report is gone, after reading it back.
import { pathToFileURL } from "node:url";
import { RECEIPT_ID } from "./store-port.mjs";

const USAGE = "usage: node admin.mjs show|delete air_<uuid>\n";

/**
 * @param {{ argv: string[], stdout: { write(s: string): unknown, isTTY?: boolean },
 *   stderr: { write(s: string): unknown }, store: object }} io
 * @returns {Promise<number>} the exit code
 */
export async function runAdmin({ argv, stdout, stderr, store }) {
  const [command, receiptId, ...extra] = argv;
  if ((command !== "show" && command !== "delete") || extra.length > 0) {
    stderr.write(USAGE);
    return 2;
  }
  if (typeof receiptId !== "string" || !RECEIPT_ID.test(receiptId)) {
    stderr.write("not a receipt number: expected air_ and a UUID, in lower case\n");
    return 2;
  }
  if (command === "show") {
    if (stdout.isTTY !== true) {
      stderr.write("refusing: show prints report text and needs an interactive terminal\n");
      return 3;
    }
    const found = await store.getReport(receiptId);
    if (!found) {
      stderr.write("no such report (it may have expired and been deleted)\n");
      return 1;
    }
    stdout.write(`${JSON.stringify(found, null, 2)}\n`);
    return 0;
  }
  const deleted = await store.deleteReport(receiptId);
  if (!deleted) {
    stderr.write("no such report: nothing to delete\n");
    return 1;
  }
  stdout.write(`deleted ${receiptId}: read back, it is gone\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createFirestoreStoreFromEnvironment } = await import("./firestore-store.mjs");
  const env = { GOOGLE_CLOUD_PROJECT: "woowtech-smart", ...process.env };
  const store = await createFirestoreStoreFromEnvironment(env);
  process.exitCode = await runAdmin({
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
    store,
  });
}
