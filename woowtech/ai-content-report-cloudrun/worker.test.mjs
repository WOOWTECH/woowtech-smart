// Tests for the Cloudflare Worker in front of the receiver (deploy/cloudflare-worker-smart-reports.js)
// and its wrangler config. The Worker runs here with a stand-in for fetch, so nothing leaves the
// machine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { MAX_BODY_BYTES, REPORT_PATH } from "./contract.mjs";
import worker from "./deploy/cloudflare-worker-smart-reports.js";

const HOST = "https://reports.woowtech.io";
const EDGE_KEY = "edge-key-for-the-worker-tests-0123456789abcdef";
const RELAY = "https://smart-reports-test.invalid";
const ENV = Object.freeze({ RELAY_ORIGIN: RELAY, EDGE_KEY });
const DESKTOP = "woowtech-smart://app";
const BODY = JSON.stringify({ schemaVersion: 1 });

const stored = () =>
  new Response(JSON.stringify({ receiptId: "air_x" }), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** One request through the Worker; `upstream` answers (or throws) in place of the receiver. */
async function call(path, init, { env = ENV, upstream = stored, host = HOST } = {}) {
  const relayed = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    relayed.push({ url: String(input), options });
    return upstream(input, options);
  };
  try {
    const response = await worker.fetch(new Request(`${host}${path}`, init), env);
    return { response, relayed, text: await response.text() };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const post = ({ headers = {}, body = BODY } = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body,
});

test("relays a report with the edge key and nothing else of the client", async () => {
  const { response, relayed, text } = await call(
    `${REPORT_PATH}?utm=1`,
    post({
      headers: {
        cookie: "session=1",
        authorization: "Bearer client-token",
        "user-agent": "agent-007",
        "x-forwarded-for": "203.0.113.9",
        "cf-connecting-ip": "203.0.113.9",
        "x-real-ip": "203.0.113.9",
        accept: "application/json",
      },
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(text), { receiptId: "air_x" });
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(relayed.length, 1);
  const [{ url, options }] = relayed;
  assert.equal(url, `${RELAY}${REPORT_PATH}`, "no query string travels");
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "manual");
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(options.headers, {
    "content-type": "application/json",
    "x-woowtech-edge-key": EDGE_KEY,
  });
  assert.equal(Buffer.from(options.body).toString("utf8"), BODY);
});

test("only POST on the report path of reports.woowtech.io is served", async () => {
  for (const path of [
    "/",
    "/health",
    "/v1/other",
    `${REPORT_PATH}/`,
    `${REPORT_PATH}x`,
    "/V1/ai-content-reports",
  ]) {
    const { response, relayed } = await call(path, post());
    assert.equal(response.status, 404, path);
    assert.deepEqual(relayed, []);
  }
  // The workers.dev address is outside the woowtech.io zone: it is served nothing.
  const workersDev = await worker.fetch(
    new Request(`https://smart-reports-proxy.example.workers.dev${REPORT_PATH}`, post()),
    ENV,
  );
  assert.equal(workersDev.status, 404);

  for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
    const { response, relayed } = await call(REPORT_PATH, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST");
    assert.deepEqual(relayed, []);
  }
});

test("a phone sends no Origin; a request with an Origin is refused unless the origin is listed", async () => {
  for (const origin of [
    "https://example.invalid",
    "null",
    "*",
    "",
    `${DESKTOP}/`,
    "WOOWTECH-SMART://app",
    "woowtech-smart://other",
    "https://reports.woowtech.io",
  ]) {
    const { response, relayed, text } = await call(REPORT_PATH, post({ headers: { origin } }));
    assert.equal(response.status, 403, origin);
    assert.deepEqual(JSON.parse(text), { error: "origin_not_allowed" });
    assert.equal(response.headers.get("access-control-allow-origin"), null, origin);
    assert.deepEqual(relayed, []);
  }

  // The desktop App's origin is listed by default.
  const desktop = await call(REPORT_PATH, post({ headers: { origin: DESKTOP } }));
  assert.equal(desktop.response.status, 201);

  // ALLOWED_ORIGINS replaces the list: empty means no browser at all.
  const none = await call(REPORT_PATH, post({ headers: { origin: DESKTOP } }), {
    env: { ...ENV, ALLOWED_ORIGINS: "" },
  });
  assert.equal(none.response.status, 403);
  const two = { ...ENV, ALLOWED_ORIGINS: "https://a.invalid, https://b.invalid" };
  for (const [origin, status] of [
    ["https://a.invalid", 201],
    ["https://b.invalid", 201],
    [DESKTOP, 403],
  ]) {
    const answered = await call(REPORT_PATH, post({ headers: { origin } }), { env: two });
    assert.equal(answered.response.status, status, origin);
  }
  // A wildcard or "null" in the list never lets those through.
  for (const listed of ["*", "null", "*, null"]) {
    for (const origin of ["*", "null", "https://example.invalid"]) {
      const answered = await call(REPORT_PATH, post({ headers: { origin } }), {
        env: { ...ENV, ALLOWED_ORIGINS: listed },
      });
      assert.equal(answered.response.status, 403, `${listed} / ${origin}`);
    }
  }
  // Phones, with no Origin at all, are not affected by the list.
  const phone = await call(REPORT_PATH, post(), { env: { ...ENV, ALLOWED_ORIGINS: "" } });
  assert.equal(phone.response.status, 201);
});

test("a preflight from the desktop App is answered by the Worker, anyone else's is not", async () => {
  const { response, relayed } = await call(REPORT_PATH, {
    method: "OPTIONS",
    headers: {
      origin: DESKTOP,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), DESKTOP);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST");
  assert.equal(response.headers.get("access-control-allow-headers"), "content-type, accept");
  assert.equal(response.headers.get("access-control-max-age"), "600");
  assert.match(response.headers.get("vary"), /Origin/);
  assert.deepEqual(relayed, [], "a preflight never reaches the receiver");

  for (const headers of [
    { origin: "https://example.invalid", "access-control-request-method": "POST" },
    { origin: "null", "access-control-request-method": "POST" },
    { "access-control-request-method": "POST" },
  ]) {
    const refused = await call(REPORT_PATH, { method: "OPTIONS", headers });
    assert.equal(refused.response.status, 405, JSON.stringify(headers));
    assert.equal(refused.response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(refused.relayed, []);
  }
  for (const headers of [
    { origin: DESKTOP },
    { origin: DESKTOP, "access-control-request-method": "DELETE" },
  ]) {
    const refused = await call(REPORT_PATH, { method: "OPTIONS", headers });
    assert.equal(refused.response.status, 405, JSON.stringify(headers));
    assert.notEqual(refused.response.status, 204);
  }
  const elsewhere = await call("/v1/other", {
    method: "OPTIONS",
    headers: { origin: DESKTOP, "access-control-request-method": "POST" },
  });
  assert.equal(elsewhere.response.status, 404);

  const noBrowsers = await call(
    REPORT_PATH,
    { method: "OPTIONS", headers: { origin: DESKTOP, "access-control-request-method": "POST" } },
    { env: { ...ENV, ALLOWED_ORIGINS: "" } },
  );
  assert.equal(noBrowsers.response.status, 405);
});

test("every answer to the desktop App's origin carries the CORS headers, errors included", async () => {
  const fromDesktop = (headers = {}) => post({ headers: { origin: DESKTOP, ...headers } });
  const cases = [
    ["stored", fromDesktop(), {}, 201],
    ["wrong content type", fromDesktop({ "content-type": "text/plain" }), {}, 415],
    ["declared too large", fromDesktop({ "content-length": String(MAX_BODY_BYTES + 1) }), {}, 413],
    [
      "receiver says capacity",
      fromDesktop(),
      {
        upstream: () =>
          new Response('{"error":"capacity"}', { status: 429, headers: { "retry-after": "120" } }),
      },
      429,
    ],
    [
      "receiver unreachable",
      fromDesktop(),
      {
        upstream: () => {
          throw new Error("down");
        },
      },
      503,
    ],
    ["misconfigured", fromDesktop(), { env: { ...ENV, EDGE_KEY: "short" } }, 500],
  ];
  for (const [name, init, options, status] of cases) {
    const { response } = await call(REPORT_PATH, init, options);
    assert.equal(response.status, status, name);
    assert.equal(response.headers.get("access-control-allow-origin"), DESKTOP, name);
    assert.equal(response.headers.get("access-control-expose-headers"), "retry-after", name);
    assert.match(response.headers.get("vary"), /Origin/, name);
  }
  // The App reads retry-after on a 429, so it has to come through.
  const limited = await call(REPORT_PATH, fromDesktop(), {
    upstream: () => new Response("{}", { status: 429, headers: { "retry-after": "120" } }),
  });
  assert.equal(limited.response.headers.get("retry-after"), "120");
});

test("only JSON is taken", async () => {
  for (const contentType of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
  ]) {
    const { response, relayed, text } = await call(
      REPORT_PATH,
      post({ headers: { "content-type": contentType } }),
    );
    assert.equal(response.status, 415, contentType);
    assert.deepEqual(JSON.parse(text), { error: "content_type_required" });
    assert.deepEqual(relayed, []);
  }
  const none = await call(REPORT_PATH, { method: "POST" });
  assert.equal(none.response.status, 415);

  for (const contentType of ["application/json; charset=utf-8", "Application/JSON"]) {
    const { response, relayed } = await call(
      REPORT_PATH,
      post({ headers: { "content-type": contentType } }),
    );
    assert.equal(response.status, 201, contentType);
    assert.equal(relayed[0].options.headers["content-type"], "application/json");
  }
});

test("a body is limited to 12,288 bytes, declared or streamed", async () => {
  const exact = "x".repeat(MAX_BODY_BYTES);
  const ok = await call(REPORT_PATH, post({ body: exact }));
  assert.equal(ok.response.status, 201);
  assert.equal(ok.relayed[0].options.body.byteLength, MAX_BODY_BYTES);

  const over = await call(REPORT_PATH, post({ body: `${exact}x` }));
  assert.equal(over.response.status, 413);
  assert.deepEqual(JSON.parse(over.text), { error: "body_too_large" });
  assert.deepEqual(over.relayed, []);

  for (const length of [String(MAX_BODY_BYTES + 1), "99999999", "abc"]) {
    const declared = await call(REPORT_PATH, post({ headers: { "content-length": length } }));
    assert.equal(declared.response.status, 413, length);
    assert.deepEqual(declared.relayed, []);
  }

  // A stream without a length is cut off once it passes the limit.
  const chunks = [4096, 4096, 4096, 4096];
  const stream = new ReadableStream({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(120));
      controller.close();
    },
  });
  const streamed = await call(REPORT_PATH, {
    ...post({ body: null }),
    body: stream,
    duplex: "half",
  });
  assert.equal(streamed.response.status, 413);
  assert.deepEqual(streamed.relayed, []);
});

test("without RELAY_ORIGIN (https) and a long enough EDGE_KEY it answers 500 and relays nothing", async () => {
  for (const env of [
    {},
    { RELAY_ORIGIN: RELAY },
    { EDGE_KEY },
    { RELAY_ORIGIN: "http://insecure.invalid", EDGE_KEY },
    { RELAY_ORIGIN: "set-me:the-run.app-URL-printed-by-the-deploy-script", EDGE_KEY },
    { RELAY_ORIGIN: "not a url", EDGE_KEY },
    { RELAY_ORIGIN: RELAY, EDGE_KEY: "short" },
  ]) {
    const { response, relayed, text } = await call(REPORT_PATH, post(), { env });
    assert.equal(response.status, 500, JSON.stringify(env));
    assert.deepEqual(JSON.parse(text), { error: "edge_misconfigured" });
    assert.deepEqual(relayed, []);
    assert.equal(text.includes(EDGE_KEY), false);
  }
});

test("an unreachable or slow receiver is a 503 with a fixed body", async () => {
  for (const failure of [
    new Error("connect ECONNREFUSED 10.0.0.1:443"),
    new DOMException("timed out", "TimeoutError"),
  ]) {
    const { response, text } = await call(REPORT_PATH, post(), {
      upstream: () => {
        throw failure;
      },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(text), { error: "upstream_unavailable" });
    assert.equal(text.includes("ECONNREFUSED"), false);
  }
});

test("the receiver's status and body pass through, its other headers do not", async () => {
  const { response, text } = await call(REPORT_PATH, post(), {
    upstream: () =>
      new Response('{"error":"capacity"}', {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "3600",
          "set-cookie": "a=b",
          server: "Google Frontend",
          "x-powered-by": "node",
          "x-cloud-trace-context": "abc",
          location: "https://elsewhere.invalid/",
        },
      }),
  });
  assert.equal(response.status, 429);
  assert.deepEqual(JSON.parse(text), { error: "capacity" });
  assert.equal(response.headers.get("retry-after"), "3600");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const name of [
    "set-cookie",
    "server",
    "x-powered-by",
    "x-cloud-trace-context",
    "location",
  ]) {
    assert.equal(response.headers.get(name), null, name);
  }
});

test("with the IP_RATE_LIMITER binding, an IP over its limit gets 429 before its body is read", async () => {
  const keys = [];
  let allow = false;
  const env = {
    ...ENV,
    IP_RATE_LIMITER: {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: allow };
      },
    },
  };

  const limited = await call(
    REPORT_PATH,
    post({ headers: { "cf-connecting-ip": "203.0.113.9" } }),
    { env },
  );
  assert.equal(limited.response.status, 429);
  assert.equal(limited.response.headers.get("retry-after"), "60");
  assert.deepEqual(JSON.parse(limited.text), { error: "rate_limited" });
  assert.deepEqual(limited.relayed, []);
  assert.deepEqual(keys, ["203.0.113.9"]);

  // "Before its body is read": a body stream nobody has asked a byte of stays untouched.
  keys.length = 0;
  let pulled = false;
  const watched = new ReadableStream(
    {
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode(BODY));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const refusedUnread = await call(
    REPORT_PATH,
    { ...post({ body: null }), body: watched, duplex: "half" },
    { env },
  );
  assert.equal(refusedUnread.response.status, 429);
  assert.equal(pulled, false, "the limiter runs before the body is read");
  assert.deepEqual(keys, ["unknown"]);

  keys.length = 0;
  allow = true;
  const passed = await call(REPORT_PATH, post({ headers: { "cf-connecting-ip": "203.0.113.9" } }), {
    env,
  });
  assert.equal(passed.response.status, 201);
  const unknown = await call(REPORT_PATH, post(), { env });
  assert.equal(unknown.response.status, 201);
  assert.deepEqual(keys, ["203.0.113.9", "unknown"]);

  // Requests refused earlier do not use up the limit.
  keys.length = 0;
  await call("/v1/other", post(), { env });
  await call(REPORT_PATH, { method: "GET" }, { env });
  await call(REPORT_PATH, post({ headers: { "content-type": "text/plain" } }), { env });
  await call(REPORT_PATH, post({ headers: { origin: "https://example.invalid" } }), { env });
  await call(REPORT_PATH, post({ headers: { "content-length": "99999" } }), { env });
  assert.deepEqual(keys, []);
});

test("the Worker logs nothing", async () => {
  const source = await readFile(
    new URL("./deploy/cloudflare-worker-smart-reports.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bconsole\b/);

  const seen = [];
  const originals = {};
  for (const name of ["log", "info", "warn", "error", "debug"]) {
    originals[name] = console[name];
    console[name] = (...args) => seen.push([name, args]);
  }
  try {
    await call(REPORT_PATH, post({ headers: { origin: DESKTOP } }));
    await call(REPORT_PATH, post({ body: "x".repeat(MAX_BODY_BYTES + 1) }));
    await call(REPORT_PATH, post(), {
      upstream: () => {
        throw new Error("down");
      },
    });
  } finally {
    Object.assign(console, originals);
  }
  assert.deepEqual(seen, []);
});

// The wrangler config is JSONC: full-line // comments and trailing commas.
function parseJsonc(text) {
  const withoutComments = text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, "$1"));
}

test("PUBLIC_HOST moves the Worker to another brand's host, and only there", async () => {
  const apporo = { ...ENV, PUBLIC_HOST: "reports.apporo.ai" };

  const served = await call(REPORT_PATH, post(), {
    env: apporo,
    host: "https://reports.apporo.ai",
  });
  const elsewhere = await call(REPORT_PATH, post(), { env: apporo });

  assert.equal(served.response.status, 201);
  assert.equal(served.relayed.length, 1);
  assert.equal(elsewhere.response.status, 404);
  assert.equal(elsewhere.relayed.length, 0);
});

/** A brand's values (woowtech/brands/<id>.json). */
async function brand(id) {
  return JSON.parse(await readFile(new URL(`../brands/${id}.json`, import.meta.url), "utf8"));
}

test("Apporo smart's wrangler config serves its App's report address and desktop origin", async () => {
  const configUrl = new URL(
    "./deploy/cloudflare-worker-smart-reports.apporo.wrangler.jsonc",
    import.meta.url,
  );
  const text = await readFile(configUrl, "utf8");
  const config = parseJsonc(text);
  const apporo = await brand("apporo");
  const reportUrl = new URL(apporo.services.aiContentReportUrl);

  assert.equal(reportUrl.pathname, REPORT_PATH);
  assert.equal(config.main, "cloudflare-worker-smart-reports.js");
  assert.deepEqual(config.routes, [{ pattern: reportUrl.hostname, custom_domain: true }]);
  assert.equal(config.vars.PUBLIC_HOST, reportUrl.hostname);
  assert.equal(config.vars.ALLOWED_ORIGINS, `${apporo.scheme}://app`);
  assert.deepEqual(Object.keys(config.vars).sort(), [
    "ALLOWED_ORIGINS",
    "PUBLIC_HOST",
    "RELAY_ORIGIN",
  ]);
  assert.ok(
    !config.vars.RELAY_ORIGIN.startsWith("https:"),
    "a placeholder until the run.app URL is set",
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.observability, { enabled: false });
  assert.equal(config.logpush, false);
  assert.doesNotMatch(text, /[0-9a-f]{32,}/i, "no key in the config");
  assert.deepEqual(
    config.ratelimits.map((limiter) => limiter.simple),
    [{ limit: 10, period: 60 }],
  );
});

test("the wrangler config deploys the Worker to reports.woowtech.io alone, with no logs", async () => {
  const configUrl = new URL(
    "./deploy/cloudflare-worker-smart-reports.wrangler.jsonc",
    import.meta.url,
  );
  const text = await readFile(configUrl, "utf8");
  const config = parseJsonc(text);

  assert.equal(config.name, "smart-reports-proxy");
  assert.ok(existsSync(new URL(config.main, configUrl)), "main points at the Worker file");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "reports.woowtech.io", custom_domain: true }]);
  const woowtech = await brand("woowtech");
  assert.equal(new URL(woowtech.services.aiContentReportUrl).hostname, "reports.woowtech.io");
  assert.equal(DESKTOP, `${woowtech.scheme}://app`, "the Worker's default origin is woowtech's");
  assert.deepEqual(config.observability, { enabled: false });
  assert.equal(config.logpush, false);

  // The placeholder is not an https URL, so a Worker deployed without editing it answers 500.
  const placeholderProtocol = (() => {
    try {
      return new URL(config.vars.RELAY_ORIGIN).protocol;
    } catch {
      return null;
    }
  })();
  assert.notEqual(placeholderProtocol, "https:");
  assert.deepEqual(
    Object.keys(config.vars),
    ["RELAY_ORIGIN"],
    "no secret and no origin list in the file",
  );
  assert.doesNotMatch(text, /[0-9a-f]{32,}/i, "no key in the config");

  // Cloudflare's rate limiting binding takes a period of 10 or 60 seconds.
  assert.equal(config.ratelimits.length, 1);
  const [limiter] = config.ratelimits;
  assert.equal(limiter.name, "IP_RATE_LIMITER");
  assert.match(limiter.namespace_id, /^\d+$/);
  assert.notEqual(limiter.namespace_id, "4101", "4101 is smart-push-proxy's");
  assert.ok([10, 60].includes(limiter.simple.period));
  assert.ok(limiter.simple.limit > 0);
});
