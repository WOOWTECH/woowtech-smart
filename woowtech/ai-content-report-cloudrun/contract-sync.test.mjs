import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MAX_BODY_BYTES, REPORT_PATH, REPORT_SCHEMA_VERSION } from "./contract.mjs";

const here = (name) => new URL(name, import.meta.url);

test("the contract here is the one the app was built against (the first receiver's file)", async () => {
  // This folder builds on its own, so it holds a copy. A change to the original has to come here.
  const original = await readFile(here("../ai-content-report-service/contract.mjs"), "utf8");
  const copy = await readFile(here("./contract.mjs"), "utf8");
  assert.equal(copy, original);
});

test("the numbers the Worker and the service must agree on", async () => {
  assert.equal(REPORT_PATH, "/v1/ai-content-reports");
  assert.equal(MAX_BODY_BYTES, 12288);
  assert.equal(REPORT_SCHEMA_VERSION, 1);
  const worker = await readFile(here("./deploy/cloudflare-worker-smart-reports.js"), "utf8");
  assert.match(worker, /const MAX_BODY_BYTES = 12288;/);
  assert.match(worker, /const REPORT_PATH = ["']\/v1\/ai-content-reports["'];/);
});
