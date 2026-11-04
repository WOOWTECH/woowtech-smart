import test from "node:test";
import assert from "node:assert/strict";
import { runAdmin } from "./admin.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { DAY_MS } from "./store-port.mjs";
import { validReport } from "./support.mjs";

const RECEIPT = "air_11111111-1111-4111-8111-111111111111";
const NOON = Date.UTC(2026, 9, 14, 12, 0, 0);

async function setup({ tty = true } = {}) {
  const store = createMemoryStore();
  await store.storeReport(
    {
      receiptId: RECEIPT,
      receivedAtMs: NOON,
      expiresAtMs: NOON + 30 * DAY_MS,
      report: validReport({ reportedContent: "ATTACHED-REPLY-TEXT" }),
    },
    { dailyMax: 10 },
  );
  // Any call to the store after this point is counted.
  let calls = 0;
  const watched = new Proxy(store, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (typeof value !== "function" || name === "storeReport") return value;
      return (...args) => {
        calls += 1;
        return value.apply(target, args);
      };
    },
  });
  const out = [];
  const err = [];
  return {
    store,
    calls: () => calls,
    out,
    err,
    run: (argv) =>
      runAdmin({
        argv,
        stdout: { write: (text) => out.push(text), isTTY: tty },
        stderr: { write: (text) => err.push(text) },
        store: watched,
      }),
  };
}

test("only a server-made receipt number gets as far as the store", async () => {
  const { run, calls, out, err } = await setup();
  const bad = [
    "air_../../etc/passwd",
    "../air_11111111-1111-4111-8111-111111111111",
    "AIR_11111111-1111-4111-8111-111111111111",
    "air_11111111-1111-4111-8111-11111111111F",
    "air_11111111-1111-1111-8111-111111111111",
    "air_11111111-1111-4111-c111-111111111111",
    `${RECEIPT}/extra`,
    `${RECEIPT} `,
    "",
  ];
  for (const receipt of bad) {
    assert.equal(await run(["show", receipt]), 2, receipt);
    assert.equal(await run(["delete", receipt]), 2, receipt);
  }
  assert.equal(await run(["show"]), 2);
  assert.equal(await run(["delete"]), 2);
  assert.equal(calls(), 0);
  assert.deepEqual(out, []);
  assert.ok(err.length > 0);
});

test("unknown commands and extra arguments print the usage", async () => {
  const { run, calls, err } = await setup();
  assert.equal(await run([]), 2);
  assert.equal(await run(["list"]), 2);
  assert.equal(await run(["show", RECEIPT, "more"]), 2);
  assert.equal(calls(), 0);
  assert.match(err.join(""), /usage: node admin.mjs show\|delete/);
});

test("show prints the report on a terminal and refuses anywhere else", async () => {
  const terminal = await setup({ tty: true });
  assert.equal(await terminal.run(["show", RECEIPT]), 0);
  const printed = JSON.parse(terminal.out.join(""));
  assert.equal(printed.receiptId, RECEIPT);
  assert.equal(printed.report.reportedContent, "ATTACHED-REPLY-TEXT");

  const piped = await setup({ tty: false });
  assert.equal(await piped.run(["show", RECEIPT]), 3);
  assert.deepEqual(piped.out, []);
  assert.equal(piped.calls(), 0);
  assert.equal(piped.err.join("").includes("ATTACHED-REPLY-TEXT"), false);
});

test("show says so when a report is not there", async () => {
  const { run, out, err } = await setup();
  assert.equal(await run(["show", "air_22222222-2222-4222-8222-222222222222"]), 1);
  assert.deepEqual(out, []);
  assert.match(err.join(""), /no such report/);
});

test("delete removes the report and prints the receipt number, not the report", async () => {
  const { run, store, out } = await setup();
  assert.equal(await run(["delete", RECEIPT]), 0);
  assert.equal(await store.getReport(RECEIPT), null);
  assert.equal(out.join("").includes("ATTACHED-REPLY-TEXT"), false);
  assert.match(out.join(""), new RegExp(RECEIPT));
  assert.equal(await run(["delete", RECEIPT]), 1);
});
