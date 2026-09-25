import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import type { PushPayload } from "./push-service.js";
import { createWoowtechRelayDeliver } from "./woowtech-relay.js";

// Shaped like FCM registration tokens. Fake.
const PHONE = "fake-install-0001:APA91bFAKE_TOKEN_FOR_CONTRACT_TESTS_ONLY-0001";
// Ids in the shapes the daemon generates (server-id.ts, workspace-registry-model.ts, randomUUID).
const SERVER_ID = "srv_Ab3dEf9hIjK_";
const WORKSPACE_ID = "wks_0123456789abcdef";
const AGENT_ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

/** What the fake relay answers each request with, the last one repeating. */
type FakeRelayAnswer = { status: number; body?: unknown } | "hang" | "reset";

interface RelayRequest {
  method: string | undefined;
  path: string | undefined;
  contentType: string | undefined;
  /** The request body exactly as it arrived. */
  raw: Buffer;
}

interface FakeRelay {
  url: string;
  requests: RelayRequest[];
}

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

/**
 * A local HTTP server in place of push.woowtech.io. It answers in turn from `answers`, the
 * last one repeating, or with what `answers` returns for the request.
 */
async function startFakeRelay(
  answers: FakeRelayAnswer[] | ((request: RelayRequest) => FakeRelayAnswer) = [
    { status: 201, body: { ok: true } },
  ],
) {
  const requests: RelayRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        path: request.url,
        contentType: request.headers["content-type"],
        raw: Buffer.concat(chunks),
      });
      const answer =
        typeof answers === "function"
          ? answers(requests[requests.length - 1])
          : answers[Math.min(requests.length, answers.length) - 1];
      if (answer === "hang") return;
      if (answer === "reset") {
        request.socket.destroy();
        return;
      }
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body ?? {}));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const relay: FakeRelay = { url: `http://127.0.0.1:${port}/api/smart/v1/notify`, requests };
  return relay;
}

/** An address where no relay listens any more. */
async function unreachableRelay(): Promise<FakeRelay> {
  const relay = await startFakeRelay();
  const server = servers.pop();
  await new Promise((resolve) => server?.close(resolve));
  return relay;
}

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

interface LogCall {
  level: LogLevel;
  args: unknown[];
}

function recordingLogger() {
  const calls: LogCall[] = [];
  const record =
    (level: LogLevel) =>
    (...args: unknown[]) => {
      calls.push({ level, args });
    };
  const logger = {
    child: () => logger,
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
  };
  return { logger: logger as unknown as pino.Logger, calls };
}

/** The daemon's deliver for `relay`, recording what it revokes, waits for and logs. */
function deliverTo(relay: FakeRelay, options: { timeoutMs?: number } = {}) {
  const revoked: string[] = [];
  const sleeps: number[] = [];
  const { logger, calls } = recordingLogger();
  const deliver = createWoowtechRelayDeliver({
    relayUrl: relay.url,
    fetch: globalThis.fetch,
    logger,
    revoke: (token) => {
      revoked.push(token);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  return { deliver, revoked, sleeps, logs: calls };
}

// Each phone's token carries LOGGED, so no log line may contain that word.
const LOGGED_PHONES = {
  delivered: "fake-install-L1:APA91bLOGGED_DELIVERED_TOKEN_TAIL-0001",
  gone: "fake-install-L2:APA91bLOGGED_GONE_TOKEN_TAIL-0002",
  unavailable: "fake-install-L3:APA91bLOGGED_UNAVAILABLE_TOKEN_TAIL-0003",
  refused: "fake-install-L4:APA91bLOGGED_REFUSED_TOKEN_TAIL-0004",
  upstream: "fake-install-L5:APA91bLOGGED_UPSTREAM_TOKEN_TAIL-0005",
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The debug line for a phone's last answer. */
function answered(token: string, result: { attempts: number; status: number }): LogCall {
  return {
    level: "debug",
    args: [{ phone: sha256Hex(token).slice(0, 8), ...result }, "The push relay answered"],
  };
}

function sortedByPhone(calls: LogCall[]): LogCall[] {
  const phoneOf = (call: LogCall) => JSON.stringify(call.args[0]);
  return [...calls].sort((a, b) => phoneOf(a).localeCompare(phoneOf(b)));
}

// What the daemon's log says about each answer it does not retry.
const RELAY_ANSWER_LOG: Record<number, string> = {
  400: "The push relay refused a malformed request, a daemon bug",
  403: "The push relay refused the daemon's request",
  413: "The push relay refused a malformed request, a daemon bug",
  429: "The push relay's limit for this phone is reached; dropped the push",
  502: "The push relay could not reach FCM or APNs; dropped the push",
  404: "The push relay gave an unexpected answer; dropped the push",
};

function finishedAgent(): PushPayload {
  return {
    title: "woowtech smart",
    body: "Work finished — tap to see the result.",
    data: { serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID, reason: "finished" },
  };
}

function bodiesOf(relay: FakeRelay): unknown[] {
  return relay.requests.map((request) => JSON.parse(request.raw.toString("utf8")));
}

describe("pushes through WoowTech's push relay", () => {
  test("the relay receives the phone's token, language, the reason and the target, and nothing else", async () => {
    const relay = await startFakeRelay();
    const { deliver } = deliverTo(relay);

    await deliver([`wsp1:zh-TW:${PHONE}`], finishedAgent());

    expect(
      relay.requests.map(({ method, path, contentType }) => ({ method, path, contentType })),
    ).toEqual([{ method: "POST", path: "/api/smart/v1/notify", contentType: "application/json" }]);
    expect(relay.requests[0]?.raw.toString("utf8")).toBe(
      JSON.stringify({
        token: PHONE,
        locale: "zh-TW",
        reason: "finished",
        target: { serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID },
      }),
    );
  });

  test("the user's text never leaves the machine, whatever field it is in", async () => {
    const relay = await startFakeRelay();
    const { deliver } = deliverTo(relay);
    const markers = {
      title: "MARKER-TITLE Rotate Acme credentials",
      body: "MARKER-BODY Rotated the Acme database password",
      cwd: "/Users/marker/MARKER-CWD-secret-project",
      terminalName: "MARKER-TERMINAL vim notes.md",
      workspaceName: "MARKER-WORKSPACE acme-billing",
      reason: "MARKER-REASON deploy acme to production",
      serverId: "MARKER-SERVER alex-macbook",
    };

    await deliver([`wsp1:en:${PHONE}`], {
      title: markers.title,
      body: markers.body,
      data: {
        ...markers,
        workspaceId: markers.cwd,
        agentId: AGENT_ID,
      },
    });

    const raw = relay.requests.map((request) => request.raw.toString("utf8")).join("\n");
    expect(relay.requests).toHaveLength(1);
    expect(Object.values(markers).filter((marker) => raw.includes(marker))).toEqual([]);
    expect(raw).not.toContain("MARKER");
    expect(bodiesOf(relay)).toEqual([
      { token: PHONE, locale: "en", reason: "attention", target: { agentId: AGENT_ID } },
    ]);
  });

  test("tokens the relay cannot use are revoked and never sent", async () => {
    const relay = await startFakeRelay();
    const { deliver, revoked } = deliverTo(relay);
    const unusable = [
      "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", // the official Paseo app, older builds
      `wsp1:zh-CN:${PHONE}`,
      `wsp2:en:${PHONE}`,
      "wsp1:en:too-short:1",
    ];

    await deliver([...unusable, `wsp1:en:${PHONE}`], finishedAgent());

    expect(revoked).toEqual(unusable);
    expect(bodiesOf(relay)).toEqual([
      {
        token: PHONE,
        locale: "en",
        reason: "finished",
        target: { serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID },
      },
    ]);
  });

  test("a phone registered in two languages gets one push, in the one registered last", async () => {
    const relay = await startFakeRelay();
    const { deliver, revoked } = deliverTo(relay);

    // The app switched from English to Chinese and its revocation of the old string is lost.
    await deliver([`wsp1:en:${PHONE}`, `wsp1:zh-TW:${PHONE}`], finishedAgent());

    expect(bodiesOf(relay)).toEqual([
      {
        token: PHONE,
        locale: "zh-TW",
        reason: "finished",
        target: { serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID },
      },
    ]);
    expect(revoked).toEqual([]);
  });

  test("a token the relay reports invalid (410) is revoked in every language it is registered in", async () => {
    const relay = await startFakeRelay([{ status: 410, body: { error: "token_invalid" } }]);
    const { deliver, revoked, sleeps } = deliverTo(relay);

    await deliver([`wsp1:en:${PHONE}`, `wsp1:zh-TW:${PHONE}`], finishedAgent());

    expect(relay.requests).toHaveLength(1);
    expect(revoked).toEqual([`wsp1:en:${PHONE}`, `wsp1:zh-TW:${PHONE}`]);
    expect(sleeps).toEqual([]);
  });

  test("an unavailable relay (503) is tried once more after 2 to 4 seconds", async () => {
    const relay = await startFakeRelay([
      { status: 503, body: { error: "upstream_unavailable" } },
      { status: 201, body: { ok: true } },
    ]);
    const { deliver, revoked, sleeps } = deliverTo(relay);

    await deliver([`wsp1:en:${PHONE}`], finishedAgent());

    expect(relay.requests).toHaveLength(2);
    expect(relay.requests[1]?.raw).toEqual(relay.requests[0]?.raw);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2_000);
    expect(sleeps[0]).toBeLessThanOrEqual(4_000);
    expect(revoked).toEqual([]);
  });

  test("a relay still unavailable after the retry drops the push", async () => {
    const relay = await startFakeRelay([
      { status: 503, body: { error: "upstream_unavailable" } },
      { status: 503, body: { error: "upstream_unavailable" } },
      { status: 201, body: { ok: true } },
    ]);
    const { deliver, revoked, sleeps, logs } = deliverTo(relay);

    await deliver([`wsp1:en:${PHONE}`], finishedAgent());

    expect(relay.requests).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(revoked).toEqual([]);
    expect(logs.filter(({ level }) => level === "warn")).toEqual([
      { level: "warn", args: [{ status: 503 }, "Dropped a push the push relay could not take"] },
    ]);
  });

  test("a connection the network drops is tried once more", async () => {
    const relay = await startFakeRelay(["reset", { status: 201, body: { ok: true } }]);
    const { deliver, revoked, sleeps, logs } = deliverTo(relay);

    await deliver([`wsp1:en:${PHONE}`], finishedAgent());

    expect(relay.requests).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(revoked).toEqual([]);
    expect(logs.filter(({ level }) => level === "warn")).toEqual([]);
  });

  test("a relay that cannot be reached drops the push after one retry", async () => {
    const { deliver, revoked, sleeps, logs } = deliverTo(await unreachableRelay());

    await deliver([`wsp1:en:${PHONE}`], finishedAgent());

    expect(sleeps).toHaveLength(1);
    expect(revoked).toEqual([]);
    expect(logs.filter(({ level }) => level === "warn")).toEqual([
      {
        level: "warn",
        args: [{ error: "ECONNREFUSED" }, "Dropped a push the push relay could not take"],
      },
    ]);
  });

  test("a relay that does not answer in time counts as unavailable", async () => {
    const relay = await startFakeRelay(["hang"]);
    const { deliver, revoked, sleeps, logs } = deliverTo(relay, { timeoutMs: 50 });

    await deliver([`wsp1:en:${PHONE}`], finishedAgent());

    expect(relay.requests).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(revoked).toEqual([]);
    expect(logs.filter(({ level }) => level === "warn")).toEqual([
      {
        level: "warn",
        args: [{ error: "TimeoutError" }, "Dropped a push the push relay could not take"],
      },
    ]);
  });

  test.each([
    [
      400,
      { error: "invalid_request", field: "target.agentId" },
      "error",
      { field: "target.agentId" },
    ],
    [403, { error: "forbidden" }, "error", {}],
    [413, {}, "error", {}],
    [429, { error: "rate_limited", scope: "daily", retryAfterSeconds: 60 }, "info", {}],
    [502, { error: "upstream_auth" }, "warn", {}],
    [404, {}, "warn", {}],
  ] as const)(
    "a %i answer is neither retried nor revoked",
    async (status, answer, level, details) => {
      const relay = await startFakeRelay([{ status, body: answer }, { status: 201 }]);
      const { deliver, revoked, sleeps, logs } = deliverTo(relay);

      await deliver([`wsp1:en:${PHONE}`], finishedAgent());

      expect(relay.requests).toHaveLength(1);
      expect(sleeps).toEqual([]);
      expect(revoked).toEqual([]);
      expect(logs.filter((call) => call.level !== "debug")).toEqual([
        { level, args: [{ status, ...details }, RELAY_ANSWER_LOG[status]] },
      ]);
    },
  );

  test("logs never name a phone's token; debug names it by 8 hex digits of its SHA-256", async () => {
    const answers: Record<string, FakeRelayAnswer> = {
      [LOGGED_PHONES.delivered]: { status: 201, body: { ok: true } },
      [LOGGED_PHONES.gone]: { status: 410, body: { error: "token_invalid" } },
      [LOGGED_PHONES.unavailable]: { status: 503, body: { error: "upstream_unavailable" } },
      [LOGGED_PHONES.refused]: { status: 400, body: { error: "invalid_request", field: "token" } },
      [LOGGED_PHONES.upstream]: { status: 502, body: { error: "upstream_auth" } },
    };
    const relay = await startFakeRelay(
      (request) => answers[JSON.parse(request.raw.toString("utf8")).token],
    );
    const { deliver, logs } = deliverTo(relay);

    await deliver(
      [
        "ExponentPushToken[LOGGED-expo-token]",
        ...Object.values(LOGGED_PHONES).map((token) => `wsp1:en:${token}`),
        `wsp1:zh-TW:${LOGGED_PHONES.delivered}`,
      ],
      finishedAgent(),
    );

    const everything = JSON.stringify(logs);
    expect(everything).not.toContain("LOGGED");
    expect(everything).not.toContain("wsp1");
    for (const token of Object.values(LOGGED_PHONES)) {
      expect(everything).not.toContain(sha256Hex(token).slice(0, 9));
    }
    const debug = logs.filter(({ level }) => level === "debug");
    const phoneNamedIn = (call: LogCall) =>
      Object.values(LOGGED_PHONES).some((token) =>
        JSON.stringify(call.args).includes(sha256Hex(token).slice(0, 8)),
      );
    expect(logs.filter(phoneNamedIn)).toEqual(debug);
    expect(sortedByPhone(debug)).toEqual(
      sortedByPhone([
        answered(LOGGED_PHONES.delivered, { attempts: 1, status: 201 }),
        answered(LOGGED_PHONES.gone, { attempts: 1, status: 410 }),
        answered(LOGGED_PHONES.unavailable, { attempts: 2, status: 503 }),
        answered(LOGGED_PHONES.refused, { attempts: 1, status: 400 }),
        answered(LOGGED_PHONES.upstream, { attempts: 1, status: 502 }),
      ]),
    );
  });

  test("a token the store cannot drop does not stop the push to the other phones", async () => {
    const relay = await startFakeRelay();
    const { logger, calls } = recordingLogger();
    const deliver = createWoowtechRelayDeliver({
      relayUrl: relay.url,
      fetch: globalThis.fetch,
      logger,
      revoke: () => {
        throw new Error("disk full");
      },
      sleep: async () => undefined,
    });

    await deliver(
      ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", `wsp1:en:${PHONE}`],
      finishedAgent(),
    );

    expect(relay.requests).toHaveLength(1);
    expect(calls.filter(({ level }) => level === "warn")).toEqual([
      { level: "warn", args: [{ failed: 1 }, "Failed to revoke push tokens"] },
    ]);
  });
});
