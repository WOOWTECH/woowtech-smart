// Shared by the tests (not a test file itself, and not part of the image).
import http from "node:http";
import { randomUUID } from "node:crypto";
import { REPORT_PATH } from "./contract.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createReportServer, EDGE_KEY_HEADER } from "./server.mjs";

export const KEY = "edge-key-for-tests-0123456789abcdef";
export const OTHER_KEY = "another-edge-key-for-tests-0123456789";

export const validReport = (overrides = {}) => ({
  schemaVersion: 1,
  reportId: randomUUID(),
  reason: "other",
  platform: "ios",
  appVersion: "1.2.3",
  locale: "zh-TW",
  reportedContent: null,
  ...overrides,
});

/**
 * One request with exact control of the headers. `chunks` sends a body without Content-Length,
 * so Node uses chunked transfer encoding.
 */
export function send(url, { method = "POST", headers = {}, body = null, chunks = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    let answered = false;
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        agent: false,
      },
      (response) => {
        const parts = [];
        response.on("data", (part) => parts.push(part));
        response.on("end", () => {
          answered = true;
          const text = Buffer.concat(parts).toString("utf8");
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    // A server that answers before reading a body may close the socket on a client still sending.
    request.on("error", (error) => {
      if (!answered) reject(error);
    });
    if (chunks) {
      for (const chunk of chunks) request.write(chunk);
      request.end();
    } else {
      request.end(body ?? undefined);
    }
  });
}

/** A signed (edge key) JSON post of a report. */
export function postReport(url, report, { key = KEY, headers = {} } = {}) {
  const body = typeof report === "string" ? report : JSON.stringify(report);
  return send(url, {
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      ...(key === null ? {} : { [EDGE_KEY_HEADER]: key }),
      ...headers,
    },
    body,
  });
}

/** The server on a free local port, a memory store, a clock the test moves, and the log lines. */
export async function startFixture(t, options = {}) {
  const store = options.store ?? createMemoryStore();
  const logs = [];
  let clock = options.startMs ?? Date.UTC(2026, 9, 14, 8, 0, 0);
  const server = createReportServer({
    store,
    edgeKeys: options.edgeKeys ?? [KEY],
    now: () => clock,
    log: (entry) => logs.push(entry),
    ...options.server,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
    logs,
    base,
    url: `${base}${REPORT_PATH}`,
    advance: (ms) => {
      clock += ms;
    },
    clock: () => clock,
  };
}
