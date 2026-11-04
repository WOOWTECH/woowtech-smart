import { createServer, type Server as HTTPServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  BRAND_IDENTITY,
  OTHER_BRAND_CLIENT_REASON,
  OTHER_BRAND_CLOSE_CODE,
} from "@getpaseo/protocol/brand-match";
import type pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import { BrowserToolsBroker } from "./browser-tools/broker.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { ScheduleService } from "./schedule/service.js";
import { createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import { VoiceAssistantWebSocketServer } from "./websocket-server.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";

// woowtech smart: only same-brand pairing (packages/protocol/src/brand-match.ts). The daemon
// names its brand in server_info and turns away the app of another brand, counting an app that
// names no brand as woowtech smart's. These tests run as woowtech smart, the repository's brand.

interface HelloOutcome {
  serverInfoBrand: unknown;
  close: { code: number; reason: string } | null;
}

const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

describe("only same-brand pairing", () => {
  it("names the daemon's brand in server_info", async () => {
    const outcome = await sayHello({ clientType: "mobile", brand: BRAND_IDENTITY.id });
    expect(outcome).toEqual({ serverInfoBrand: BRAND_IDENTITY, close: null });
  });

  it("turns away the app of another brand, after naming its own", async () => {
    const outcome = await sayHello({ clientType: "mobile", brand: "another-brand" });
    expect(outcome).toEqual({
      serverInfoBrand: BRAND_IDENTITY,
      close: { code: OTHER_BRAND_CLOSE_CODE, reason: OTHER_BRAND_CLIENT_REASON },
    });
  });

  it("lets in an app that names no brand, from before the check", async () => {
    const outcome = await sayHello({ clientType: "browser" });
    expect(outcome).toEqual({ serverInfoBrand: BRAND_IDENTITY, close: null });
  });

  it("lets in a CLI of another brand, which sends no push token", async () => {
    const outcome = await sayHello({ clientType: "cli", brand: "another-brand" });
    expect(outcome).toEqual({ serverInfoBrand: BRAND_IDENTITY, close: null });
  });
});

/** Sends one hello and reports the server_info brand and any close in the next moments. */
async function sayHello(hello: { clientType: string; brand?: string }): Promise<HelloOutcome> {
  const url = await startDaemon();
  const socket = new WebSocket(url);
  const outcome: HelloOutcome = { serverInfoBrand: undefined, close: null };
  let serverInfoSeen: () => void = () => {};
  const serverInfo = new Promise<void>((resolve) => {
    serverInfoSeen = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    socket.on("close", (code, reason) => {
      outcome.close = { code, reason: reason.toString() };
      resolve();
    });
  });
  socket.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as {
      type?: string;
      message?: { type?: string; payload?: { status?: string; brand?: unknown } };
    };
    if (frame.type === "session" && frame.message?.payload?.status === "server_info") {
      outcome.serverInfoBrand = frame.message.payload.brand;
      serverInfoSeen();
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  socket.send(
    JSON.stringify({ type: "hello", clientId: "cid_brand_test", protocolVersion: 1, ...hello }),
  );
  await serverInfo;
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 200))]);
  const wasClosed = outcome.close !== null;
  if (!wasClosed) {
    socket.close();
    await closed;
  }
  return { serverInfoBrand: outcome.serverInfoBrand, close: wasClosed ? outcome.close : null };
}

async function startDaemon(): Promise<string> {
  const httpServer = createServer();
  const wsServer = createWebSocketServer(httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  stops.push(async () => {
    await wsServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });
  return `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/ws`;
}

function createLogger() {
  const logger = {
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  return logger;
}

function createWebSocketServer(httpServer: HTTPServer): VoiceAssistantWebSocketServer {
  const agentManager = {
    setAgentAttentionCallback() {},
    subscribe: () => () => {},
    getMetricsSnapshot: () => ({
      total: 0,
      byLifecycle: {},
      withActiveForegroundTurn: 0,
      timelineStats: { totalItems: 0, maxItemsPerAgent: 0 },
    }),
  };
  const daemonConfigStore = {
    onApply: () => () => {},
    onChange: () => () => {},
  };

  return new VoiceAssistantWebSocketServer(
    httpServer,
    createStub<pino.Logger>(createLogger()),
    "srv-brand-test",
    createStub<AgentManager>(agentManager),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/paseo-brand-websocket-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set(["*"]) },
    createStub<WorkspaceAutoName>({
      scheduleForWorktree: () => {},
      scheduleForDirectory: () => {},
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    undefined,
    createStub<ScheduleService>({}),
    createStub<CheckoutDiffManager>({
      subscribe: () => {},
      scheduleRefreshForCwd: () => {},
      getMetrics: () => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      }),
      dispose: () => {},
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createProviderSnapshotManagerStub().manager,
    undefined,
    undefined,
    new BrowserToolsBroker({ defaultTimeoutMs: 500, createRequestId: () => "req-1" }),
  );
}
