import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  chmod,
  mkdir,
  writeFile,
  symlink,
  unlink,
  utimes,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistRecord } from "./service.mjs";
import { runNotifications } from "./notification-worker.mjs";

const receiptId = "air_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function fixture(t) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "notification-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await persistRecord(dir, {
    receiptId,
    receivedAt: new Date().toISOString(),
    report: { reportedContent: "PRIVATE\r\nBcc: evil@example.invalid" },
  });
  return dir;
}
function stateFile(dir) {
  return path.join(dir, "notifications", `${receiptId}.json`);
}
async function state(dir) {
  return JSON.parse(await readFile(stateFile(dir), "utf8"));
}

test("durable sending precedes transport; sent survives a new worker without resending", async (t) => {
  const queueDir = await fixture(t);
  const deliveries = [];
  const transport = {
    send: async (receipt) => {
      assert.equal((await state(queueDir)).status, "sending");
      deliveries.push(receipt);
      return { status: "sent" };
    },
  };
  await runNotifications({ queueDir, transport });
  await runNotifications({ queueDir, transport });
  assert.deepEqual(deliveries, [receiptId]);
  assert.equal((await state(queueDir)).status, "sent");
  assert.equal((await stat(stateFile(queueDir))).mode & 0o777, 0o600);
});

test("unknown and blocked remain visible on repeated runs without another attempt", async (t) => {
  for (const outcome of ["unknown", "blocked"]) {
    const queueDir = await fixture(t);
    let calls = 0;
    const transport = {
      send: async () => {
        calls++;
        return { status: outcome };
      },
    };
    await runNotifications({ queueDir, transport });
    const summary = await runNotifications({ queueDir, transport });
    assert.equal(calls, 1);
    assert.equal(summary.unresolved[outcome], 1);
    assert.deepEqual(summary.processed, { sent: 0, retry: 0, blocked: 0, unknown: 0 });
  }
});

test("transport timeout, malformed result and exception never retry", async (t) => {
  for (const send of [
    async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
    async () => ({ status: "surprise" }),
    async () => {
      throw new Error("PRIVATE");
    },
  ]) {
    const queueDir = await fixture(t);
    await runNotifications({ queueDir, transport: { send } });
    const summary = await runNotifications({
      queueDir,
      transport: { send: () => assert.fail("resent") },
    });
    assert.equal(summary.unresolved.unknown, 1);
    assert.equal((await readFile(stateFile(queueDir), "utf8")).includes("PRIVATE"), false);
  }
});

test("definite rejection backs off durably and stops after five attempts", async (t) => {
  const queueDir = await fixture(t);
  let clock = Date.now();
  let calls = 0;
  const options = {
    queueDir,
    now: () => clock,
    transport: {
      send: async () => {
        calls++;
        return { status: "retry" };
      },
    },
  };
  for (let attempt = 1; attempt <= 5; attempt++) {
    await runNotifications(options);
    const saved = await state(queueDir);
    assert.equal(saved.attempts, attempt);
    if (attempt < 5) {
      assert.equal(saved.nextAttemptAt, clock + 60_000 * 2 ** (attempt - 1));
      await runNotifications(options);
      assert.equal(calls, attempt);
      clock = saved.nextAttemptAt;
    }
  }
  assert.equal((await state(queueDir)).status, "blocked");
  await runNotifications(options);
  assert.equal(calls, 5);
});

test("exclusive lock blocks a second worker and deletion until the first finishes", async (t) => {
  const { deleteReceipt } = await import("./queue-admin.mjs");
  const queueDir = await fixture(t);
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const first = runNotifications({
    queueDir,
    transport: {
      send: async () => {
        entered();
        await pending;
        return { status: "sent" };
      },
    },
  });
  await ready;
  try {
    await assert.rejects(
      runNotifications({ queueDir, transport: { send: () => assert.fail("concurrent send") } }),
      { code: "EEXIST" },
    );
    await assert.rejects(deleteReceipt(queueDir, receiptId), { code: "EEXIST" });
    assert.equal(
      JSON.parse(await readFile(path.join(queueDir, `${receiptId}.json`), "utf8")).receiptId,
      receiptId,
    );
  } finally {
    finish();
    await first;
  }
  await deleteReceipt(queueDir, receiptId);
  await assert.rejects(readFile(stateFile(queueDir)), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(queueDir, `${receiptId}.json`)), { code: "ENOENT" });
});

test(
  "process death leaves sending and a stale lock; explicit unlock recovers as unknown",
  { timeout: 5000 },
  async (t) => {
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const queueDir = await fixture(t);
    const moduleUrl = new URL("./notification-worker.mjs", import.meta.url).href;
    const source = `import { runNotifications } from ${JSON.stringify(moduleUrl)}; await runNotifications({queueDir: ${JSON.stringify(queueDir)}, transport: {send: async () => {process.stdout.write('ready'); await new Promise(() => {setInterval(() => {}, 1000)});}}});`;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill("SIGKILL"));
    await once(child.stdout, "data");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    assert.equal((await state(queueDir)).status, "sending");
    const options = { queueDir, transport: { send: () => assert.fail("resent after crash") } };
    await assert.rejects(runNotifications(options), { code: "EEXIST" });
    await unlink(path.join(queueDir, "notifications", "worker.lock"));
    const summary = await runNotifications(options);
    assert.equal(summary.unresolved.unknown, 1);
    assert.equal((await state(queueDir)).status, "unknown");
  },
);

test("expired and removed records do not accumulate notification state", async (t) => {
  const queueDir = await fixture(t);
  const transport = { send: async () => ({ status: "sent" }) };
  await runNotifications({ queueDir, transport });
  const file = path.join(queueDir, `${receiptId}.json`);
  await utimes(file, new Date(0), new Date(0));
  await runNotifications({ queueDir, transport: { send: () => assert.fail("expired send") } });
  await assert.rejects(readFile(stateFile(queueDir)), { code: "ENOENT" });
  await utimes(file, new Date(), new Date());
  await runNotifications({ queueDir, transport });
  await unlink(file);
  await runNotifications({ queueDir, transport });
  await assert.rejects(readFile(stateFile(queueDir)), { code: "ENOENT" });
});

test("unsafe queue, state and report paths fail closed before transport", async (t) => {
  const never = { send: () => assert.fail("unsafe send") };
  for (const kind of [
    "queue-mode",
    "queue-link",
    "record-mode",
    "record-link",
    "state-mode",
    "state-link",
    "receipt-injection",
    "corrupt-state",
  ]) {
    let queueDir = await fixture(t);
    const file = path.join(queueDir, `${receiptId}.json`);
    if (kind === "queue-mode") await chmod(queueDir, 0o755);
    if (kind === "queue-link") {
      const link = `${queueDir}-link`;
      await symlink(queueDir, link);
      t.after(() => unlink(link));
      queueDir = link;
    }
    if (kind === "record-mode") await chmod(file, 0o644);
    if (kind === "record-link") {
      await unlink(file);
      await symlink("missing", file);
    }
    if (kind.startsWith("state") || kind === "corrupt-state") {
      await mkdir(path.join(queueDir, "notifications"), { mode: 0o700 });
      if (kind === "state-link") await symlink(file, stateFile(queueDir));
      else
        await writeFile(stateFile(queueDir), "{}", { mode: kind === "state-mode" ? 0o644 : 0o600 });
    }
    if (kind === "receipt-injection")
      await writeFile(
        file,
        JSON.stringify({ receiptId: `${receiptId}\r\nBcc: bad@example.invalid` }),
      );
    await assert.rejects(runNotifications({ queueDir, transport: never }));
  }
});

test("CLI repeats expose unresolved counts with exit 2, and missing env fails without details", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const queueDir = await fixture(t);
  await runNotifications({ queueDir, transport: { send: async () => ({ status: "unknown" }) } });
  const envFile = path.join(queueDir, "gmail.env");
  await writeFile(
    envFile,
    "GMAIL_CLIENT_ID=synthetic\nGMAIL_CLIENT_SECRET=synthetic\nGMAIL_REFRESH_TOKEN=synthetic\nGMAIL_SENDER=sender@example.invalid\nGMAIL_RECIPIENT=review@example.invalid\n",
    { mode: 0o600 },
  );
  const cli = new URL("./notification-worker.mjs", import.meta.url);
  for (let run = 0; run < 2; run++) {
    const child = spawnSync(process.execPath, [cli.pathname], {
      env: { AI_REPORT_QUEUE_DIR: queueDir, AI_REPORT_GMAIL_ENV_FILE: envFile },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(child.status, 2);
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), {
      processed: { sent: 0, retry: 0, blocked: 0, unknown: 0 },
      unresolved: { retry: 0, blocked: 0, unknown: 1, sending: 0 },
    });
  }
  const missing = spawnSync(process.execPath, [cli.pathname], {
    env: { AI_REPORT_QUEUE_DIR: queueDir },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(
    missing.stderr,
    "Notification worker stopped; inspect private configuration, lock and state.\n",
  );
});
