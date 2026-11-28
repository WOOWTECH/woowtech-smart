import { BRAND } from "@getpaseo/protocol/brand-values";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationKind,
} from "@getpaseo/protocol/notification-preferences";
import { createWorkspaceRuntimeStore } from "./workspace-runtime-store/index.js";
import { SessionDelivery } from "./session/owned-subscriptions/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentAttentionCallback, AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { Session } from "./session.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import {
  createPushNotifications,
  type PushNotifications,
  type PushNotificationSender,
  type PushPayload,
} from "./push/index.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";
import { parseServerInfoStatusPayload } from "@getpaseo/protocol/messages";

const WORKSPACE_ID = "workspace-1";

const wsModuleMock = vi.hoisted(() => {
  class MockWebSocketServer {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    close() {
      // no-op
    }
  }

  return { MockWebSocketServer };
});

vi.mock("ws", () => ({
  WebSocketServer: wsModuleMock.MockWebSocketServer,
}));

vi.mock("./session.js", () => ({
  Session: function Session() {
    return {};
  },
}));

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";

interface WebSocketServerInternals {
  sessions: Map<unknown, unknown>;
  broadcastAgentAttention(params: Parameters<AgentAttentionCallback>[0]): Promise<void>;
}

function createLogger() {
  const logger = {
    child: vi.fn(() => logger),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
}

function createWorkspaceAutoNameStub(): WorkspaceAutoName {
  return createStub<WorkspaceAutoName>({
    scheduleForWorktree: () => {},
    scheduleForDirectory: () => {},
  });
}

class RecordingPushNotificationSender implements PushNotificationSender {
  readonly sent: PushPayload[] = [];
  readonly sentWithKind: Array<{ payload: PushPayload; kind?: NotificationKind }> = [];

  async send(payload: PushPayload, kind?: NotificationKind): Promise<void> {
    this.sent.push(payload);
    this.sentWithKind.push({ payload, kind });
  }
}

function createServer(
  agentManagerOverrides?: Record<string, unknown>,
  customPushSender?: PushNotificationSender,
) {
  const pushNotifications = new RecordingPushNotificationSender();
  const sender = customPushSender ?? pushNotifications;
  const agentManager = {
    subscribe: vi.fn(() => () => {}),
    onStop: () => () => {},
    setAgentAttentionCallback: vi.fn(),
    getAgent: vi.fn(() => ({ workspaceId: WORKSPACE_ID, pendingPermissions: new Map() })),
    getLastAssistantMessage: vi.fn(async () => null),
    getMetricsSnapshot: vi.fn(() => ({
      total: 0,
      byLifecycle: {},
      withActiveForegroundTurn: 0,
      timelineStats: {
        totalItems: 0,
        maxItemsPerAgent: 0,
      },
    })),
    ...agentManagerOverrides,
  };
  const daemonConfigStore = {
    onApply: vi.fn(() => () => {}),
    onChange: vi.fn(() => () => {}),
  };

  const server = new VoiceAssistantWebSocketServer(
    createStub<HTTPServer>({}),
    createStub<pino.Logger>(createLogger()),
    "srv-test",
    createStub<AgentManager>(agentManager),
    createStub<AgentStorage>({}),
    createStub<DownloadTokenStore>({}),
    "/tmp/paseo-test",
    createStub<DaemonConfigStore>(daemonConfigStore),
    null,
    { allowedOrigins: new Set() },
    createWorkspaceAutoNameStub(),
    createWorkspaceRuntimeStore(),
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
      subscribe: vi.fn(),
      scheduleRefreshForCwd: vi.fn(),
      getMetrics: vi.fn(() => ({
        checkoutDiffTargetCount: 0,
        checkoutDiffSubscriptionCount: 0,
        checkoutDiffWatcherCount: 0,
        checkoutDiffFallbackRefreshTargetCount: 0,
      })),
      dispose: vi.fn(),
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sender,
    createProviderSnapshotManagerStub().manager,
  );

  return { server, agentManager, pushNotifications };
}

function createOpenSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function createSessionWithActivity(
  activity: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt?: Date;
  } | null,
  subscribed = true,
) {
  return {
    getClientActivity: vi.fn(() => activity),
    supports: () => false,
    supportsForSource: () => false,
    subscribesToAgent: vi.fn(async () => subscribed),
  };
}

function connectClient(
  server: VoiceAssistantWebSocketServer,
  activity: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt?: Date;
  } | null,
  options: { subscribed?: boolean } = {},
) {
  const ws = createOpenSocket();
  const delivery = new SessionDelivery(() => {});
  delivery.attach(ws, false);
  asInternals<WebSocketServerInternals>(server).sessions.set(ws, {
    kind: "trusted",
    session: {
      ...createSessionWithActivity(activity, options.subscribed ?? true),
      delivery,
      wantsSourceNotification: () => true,
    },
    clientId: "client-test",
    appVersion: null,
    connectionLogger: createLogger(),
    sockets: new Set([ws]),
    externalDisconnectCleanupTimeout: null,
  });
  return ws;
}

// woowtech smart: whether a phone has a push token, as push/index.ts's hasActiveTokens() answers.
function setPhoneHasPushToken(server: VoiceAssistantWebSocketServer, hasToken: boolean) {
  asInternals<{ pushNotifications: Pick<PushNotifications, "hasActiveTokens"> }>(
    server,
  ).pushNotifications = { hasActiveTokens: () => hasToken };
}

function readAttentionRequiredMessage(ws: ReturnType<typeof createOpenSocket>, index = 0) {
  const rawMessage = ws.send.mock.calls[index]?.[0];
  expect(typeof rawMessage).toBe("string");
  if (typeof rawMessage !== "string") throw new Error("Expected string WebSocket frame");
  const message = JSON.parse(rawMessage);
  expect(message.type).toBe("session");
  expect(message.message.type).toBe("agent_stream");
  expect(message.message.payload.event.type).toBe("attention_required");
  return message.message.payload.event;
}

describe("VoiceAssistantWebSocketServer notification payloads", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not emit attention or include presence without an agent-directory subscription", async () => {
    const { server, pushNotifications } = createServer();
    const now = new Date();
    const unsubscribed = connectClient(
      server,
      {
        deviceType: "web",
        appVisible: true,
        focusedAgentId: "agent-1",
        lastActivityAt: now,
      },
      { subscribed: false },
    );

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-1",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(unsubscribed.send).not.toHaveBeenCalled();
    expect(pushNotifications.sent).toHaveLength(1);
  });

  it("uses assistant preview text for push notifications with markdown removed", async () => {
    const getLastAssistantMessage = vi.fn(
      async () => "**Done**. Updated `README.md` and [link](https://example.com).",
    );
    const { server, pushNotifications } = createServer({
      getAgent: vi.fn(() => ({
        config: { title: null },
        cwd: "/tmp/worktree",
        workspaceId: WORKSPACE_ID,
        pendingPermissions: new Map(),
      })),
      getLastAssistantMessage,
    });

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-1",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(pushNotifications.sent).toEqual([
      {
        title: "Agent finished",
        body: "Done. Updated README.md and link.",
        data: {
          serverId: "srv-test",
          workspaceId: WORKSPACE_ID,
          agentId: "agent-1",
          reason: "finished",
        },
      },
    ]);
    expect(getLastAssistantMessage).toHaveBeenCalledWith("agent-1");
  });

  it("sends push notifications regardless of UI label presence", async () => {
    const getLastAssistantMessage = vi.fn(async () => "Done.");
    const { server, pushNotifications } = createServer({
      getAgent: vi.fn(() => ({
        config: { title: null },
        cwd: "/tmp/worktree",
        workspaceId: WORKSPACE_ID,
        labels: {},
        pendingPermissions: new Map(),
      })),
      getLastAssistantMessage,
    });

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-2",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(pushNotifications.sent).toHaveLength(1);
    expect(getLastAssistantMessage).toHaveBeenCalledWith("agent-2");
  });

  it("routes a hidden stale focused browser tab's notification to the present Electron web client", async () => {
    const { server, pushNotifications } = createServer();
    const nowMs = Date.now();
    const electronWs = connectClient(server, {
      deviceType: "web",
      appVisible: false,
      focusedAgentId: "agent-Y",
      lastActivityAt: new Date(nowMs - 5_000),
    });
    const firefoxWs = connectClient(server, {
      deviceType: "web",
      appVisible: false,
      focusedAgentId: "agent-X",
      lastActivityAt: new Date(nowMs - 300_000),
    });

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-X",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(readAttentionRequiredMessage(electronWs).shouldNotify).toBe(true);
    expect(readAttentionRequiredMessage(firefoxWs).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toEqual([]);
  });

  // woowtech smart (README section 16): a backgrounded phone cannot show the in-app notice, so it
  // must not swallow the push (woowtech-attention-presence.ts).
  it("pushes when the only connected phone is backgrounded but recently active", async () => {
    const { server, pushNotifications } = createServer();
    const phoneWs = connectClient(server, {
      deviceType: "mobile",
      appVisible: false,
      focusedAgentId: "agent-X",
      lastActivityAt: new Date(Date.now() - 30_000),
    });

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-X",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(readAttentionRequiredMessage(phoneWs).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toHaveLength(1);
  });

  // woowtech smart (README section 16): closing agents on shutdown interrupts their runs; the
  // resulting "finished" must not notify anyone.
  it("notifies nobody about attention raised while the daemon is stopping", async () => {
    const { server, pushNotifications } = createServer();
    const desktopWs = connectClient(server, {
      deviceType: "web",
      appVisible: false,
      focusedAgentId: null,
      lastActivityAt: new Date(),
    });
    server.prepareForShutdown();

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-X",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(readAttentionRequiredMessage(desktopWs).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toEqual([]);
  });

  it("does not push attention raised while the daemon is stopping with nobody present", async () => {
    const { server, pushNotifications } = createServer();
    server.prepareForShutdown();

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-X",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(pushNotifications.sent).toEqual([]);
  });

  it("pushes non-error attention when the only connected client has never sent a heartbeat", async () => {
    const { server, pushNotifications } = createServer();
    const ws = connectClient(server, null);

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-no-heartbeat",
      provider: "claude",
      reason: "finished",
      attentionTimestamp: new Date(),
    });

    expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toHaveLength(1);
  });

  // woowtech smart (README section 16, owner 2026-11-14): an error pushes too, so the user can come
  // back and change the task or the conversation (woowtech-attention-presence.ts).
  it("pushes error attention with agent error NotificationKind when the only connected client has never sent a heartbeat", async () => {
    const { server, pushNotifications } = createServer();
    const ws = connectClient(server, null);

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-no-heartbeat",
      provider: "claude",
      reason: "error",
      attentionTimestamp: new Date(),
    });

    expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toHaveLength(1);
    expect(pushNotifications.sent[0]?.data?.reason).toBe("error");
    expect(pushNotifications.sentWithKind[0]?.kind).toEqual({ kind: "agent", reason: "error" });
  });

  // woowtech smart: a present computer shows the error, and the daemon remembers it, so the phone
  // gets it when the computer cannot show it or nobody deals with it (woowtech-attention-fallback.ts).
  it("remembers an error a present computer is asked to show, for the phone", async () => {
    const { server, pushNotifications } = createServer();
    setPhoneHasPushToken(server, true);
    const ws = connectClient(server, {
      deviceType: "web",
      appVisible: false,
      focusedAgentId: null,
      lastActivityAt: new Date(),
    });
    const remember = vi.spyOn(
      asInternals<{ woowtechAttentionFallback: { remember(entry: unknown): void } }>(server)
        .woowtechAttentionFallback,
      "remember",
    );

    await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
      agentId: "agent-X",
      provider: "claude",
      reason: "error",
      attentionTimestamp: new Date(),
    });

    expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(true);
    expect(pushNotifications.sent).toEqual([]);
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ kind: "agent", agentId: "agent-X" }),
      }),
    );
  });

  // woowtech smart (README section 16, owner 2026-11-14): with nobody present and no phone to
  // push to, the computer used last shows the notice (woowtech-attention-presence.ts).
  describe("with nobody present", () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const computerAway = (minutes: number) => ({
      deviceType: "web" as const,
      appVisible: false,
      focusedAgentId: null,
      lastActivityAt: minutesAgo(minutes),
    });

    it("asks the computer used last when no phone has a push token", async () => {
      const { server, pushNotifications } = createServer();
      setPhoneHasPushToken(server, false);
      const earlierWs = connectClient(server, computerAway(30));
      const laterWs = connectClient(server, computerAway(5));

      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-X",
        provider: "claude",
        reason: "finished",
        attentionTimestamp: new Date(),
      });

      expect(readAttentionRequiredMessage(earlierWs).shouldNotify).toBe(false);
      expect(readAttentionRequiredMessage(laterWs).shouldNotify).toBe(true);
      expect(pushNotifications.sent).toEqual([]);
    });

    it("pushes as before when a phone has a push token", async () => {
      const { server, pushNotifications } = createServer();
      setPhoneHasPushToken(server, true);
      const ws = connectClient(server, computerAway(5));

      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-X",
        provider: "claude",
        reason: "finished",
        attentionTimestamp: new Date(),
      });

      expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
      expect(pushNotifications.sent).toHaveLength(1);
    });

    it("pushes an error when a phone has a push token", async () => {
      const { server, pushNotifications } = createServer();
      setPhoneHasPushToken(server, true);
      const ws = connectClient(server, computerAway(10));

      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-X",
        provider: "claude",
        reason: "error",
        attentionTimestamp: new Date(),
      });

      expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
      expect(pushNotifications.sent).toHaveLength(1);
      expect(pushNotifications.sent[0]?.data?.reason).toBe("error");
    });

    it("shows an error on the computer when no phone has a push token", async () => {
      const { server, pushNotifications } = createServer();
      setPhoneHasPushToken(server, false);
      const ws = connectClient(server, computerAway(10));

      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-X",
        provider: "claude",
        reason: "error",
        attentionTimestamp: new Date(),
      });

      expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(true);
      expect(pushNotifications.sent).toEqual([]);
    });

    it("leaves a backgrounded phone without a push token out", async () => {
      const { server, pushNotifications } = createServer();
      setPhoneHasPushToken(server, false);
      const phoneWs = connectClient(server, {
        deviceType: "mobile",
        appVisible: false,
        focusedAgentId: null,
        lastActivityAt: minutesAgo(1),
      });
      const computerWs = connectClient(server, computerAway(40));

      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-X",
        provider: "claude",
        reason: "finished",
        attentionTimestamp: new Date(),
      });

      expect(readAttentionRequiredMessage(phoneWs).shouldNotify).toBe(false);
      expect(readAttentionRequiredMessage(computerWs).shouldNotify).toBe(true);
      expect(pushNotifications.sent).toEqual([]);
    });

    it("still notifies nobody while the daemon is stopping", async () => {
      const { server, pushNotifications } = createServer();
      setPhoneHasPushToken(server, false);
      const ws = connectClient(server, computerAway(10));
      server.prepareForShutdown();

      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-X",
        provider: "claude",
        reason: "finished",
        attentionTimestamp: new Date(),
      });

      expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
      expect(pushNotifications.sent).toEqual([]);
    });
  });

  // woowtech smart: the app registers its push token only with a daemon that pushes through
  // WoowTech's push relay (woowtech/README.md, 16).
  it("tells the app that its pushes go through WoowTech's push relay", () => {
    const { server } = createServer();

    const serverInfo = asInternals<{
      buildServerInfoStatusPayload(
        session: Pick<Session, "getPermissions" | "getHostSourceId">,
      ): unknown;
    }>(server).buildServerInfoStatusPayload({
      getPermissions: () => [],
      getHostSourceId: () => "client-test",
    });

    expect(parseServerInfoStatusPayload(serverInfo)?.features?.woowtechPush).toBe(true);
  });

  // woowtech smart: a connected app gets the preview (the desktop app shows it as an OS
  // notification), while the push that leaves the machine says a generic sentence
  // (push/woowtech-push-content.ts).
  it("keeps the preview on the machine and pushes without it", async () => {
    const agentId = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
    const workspaceId = "wks_0123456789abcdef";
    const { server } = createServer({
      getAgent: vi.fn(() => ({
        config: { title: "Rotate the Acme password" },
        cwd: "/Users/alex/secret-project",
        workspaceId,
        pendingPermissions: new Map(),
      })),
      getLastAssistantMessage: vi.fn(async () => "Rotated the Acme database password."),
    });
    const home = mkdtempSync(path.join(tmpdir(), "woowtech-push-split-"));
    const leftTheMachine: PushPayload[] = [];
    const push = createPushNotifications({
      logger: createStub<pino.Logger>(createLogger()),
      filePath: path.join(home, "push-tokens.json"),
      language: "en",
      deliver: async (_tokens, payload) => {
        leftTheMachine.push(payload);
      },
    });
    push.renew("ExponentPushToken[phone]");
    asInternals<{ pushNotificationSender: PushNotificationSender }>(server).pushNotificationSender =
      push;
    // A current app that has never sent a heartbeat: it gets the event, and the phone gets
    // the push.
    const ws = createOpenSocket();
    const delivery = new SessionDelivery(() => {});
    delivery.attach(ws, true);
    const publishToSource = vi.fn();
    asInternals<WebSocketServerInternals>(server).sessions.set(ws, {
      kind: "trusted",
      session: {
        delivery,
        getClientActivity: vi.fn(() => null),
        wantsSourceEvent: () => true,
        wantsSourceNotification: () => true,
        publishToSource,
      },
      clientId: "client-test",
      appVersion: null,
      connectionLogger: createLogger(),
      sockets: new Set([ws]),
      externalDisconnectCleanupTimeout: null,
    });

    try {
      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId,
        provider: "claude",
        reason: "finished",
        attentionTimestamp: new Date(),
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(publishToSource).toHaveBeenCalledTimes(1);
      const [, message] = publishToSource.mock.calls[0] ?? [];
      expect(message.type).toBe("agent_attention_required");
      expect(message.payload.notification).toEqual({
        title: "Agent finished",
        body: "Rotated the Acme database password.",
        data: { serverId: "srv-test", workspaceId, agentId, reason: "finished" },
      });
      // srv-test is not an id the daemon generates, so it stays on the machine as well.
      expect(leftTheMachine).toEqual([
        {
          title: `${BRAND.name}`,
          body: "Work finished — tap to see the result.",
          data: { workspaceId, agentId, reason: "finished" },
        },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("filters agent finished, permission, and error pushes per token preferences", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-ws-agent-prefs-"));
    try {
      const deliveries: Array<{ tokens: string[]; payload: PushPayload }> = [];
      const realPush = createPushNotifications({
        logger: createStub<pino.Logger>(createLogger()),
        filePath: path.join(home, "push-tokens.json"),
        deliver: async (tokens, payload) => {
          deliveries.push({ tokens, payload });
        },
      });
      // Phone A: permission and error on, finished off (woowtech smart: the defaults turn every
      // event on, owner 2026-11-28)
      realPush.renew("ExponentPushToken[phone-default]", {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        events: {
          ...DEFAULT_NOTIFICATION_PREFERENCES.events,
          agentFinished: false,
        },
      });
      // Phone B: finished enabled, error disabled
      realPush.renew("ExponentPushToken[phone-finished-only]", {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        events: {
          ...DEFAULT_NOTIFICATION_PREFERENCES.events,
          agentPermission: false,
          agentError: false,
          agentFinished: true,
        },
      });

      const { server } = createServer(undefined, realPush);

      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-1",
        provider: "claude",
        reason: "finished",
        attentionTimestamp: new Date(1_000),
      });
      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-1",
        provider: "claude",
        reason: "permission",
        attentionTimestamp: new Date(2_000),
      });
      await asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-1",
        provider: "claude",
        reason: "error",
        attentionTimestamp: new Date(3_000),
      });

      // woowtech smart: the relay payload is built asynchronously (push/woowtech-push-content.ts).
      await vi.waitFor(() => expect(deliveries).toHaveLength(3));
      expect(deliveries.map((d) => ({ tokens: d.tokens, reason: d.payload.data.reason }))).toEqual([
        { tokens: ["ExponentPushToken[phone-finished-only]"], reason: "finished" },
        { tokens: ["ExponentPushToken[phone-default]"], reason: "permission" },
        { tokens: ["ExponentPushToken[phone-default]"], reason: "error" },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it("notifies once while an agent's finish stays unread", async () => {
    const { server, pushNotifications } = createServer();
    const broadcast = (attentionTimestamp: Date) =>
      asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-1",
        provider: "claude",
        reason: "finished",
        attentionTimestamp,
      });
    const firstUnreadFinish = new Date(1_000);

    await broadcast(firstUnreadFinish);
    await broadcast(firstUnreadFinish);
    await broadcast(firstUnreadFinish);
    expect(pushNotifications.sent).toHaveLength(1);

    // After the user reads the agent (or marks it unread), its next unread finish is new.
    await broadcast(new Date(2_000));
    expect(pushNotifications.sent).toHaveLength(2);
  });

  it("notifies a repeated finish when the user had the agent on screen for the first one", async () => {
    const { server, pushNotifications } = createServer();
    // With a phone token, leaving the computer routes the unread finish to the phone.
    setPhoneHasPushToken(server, true);
    const activity = {
      deviceType: "web" as const,
      appVisible: true,
      focusedAgentId: "agent-1" as string | null,
      lastActivityAt: new Date(),
    };
    const ws = connectClient(server, activity);
    const unreadFinish = new Date(1_000);
    const broadcast = () =>
      asInternals<WebSocketServerInternals>(server).broadcastAgentAttention({
        agentId: "agent-1",
        provider: "claude",
        reason: "finished",
        attentionTimestamp: unreadFinish,
      });

    await broadcast();
    expect(readAttentionRequiredMessage(ws).shouldNotify).toBe(false);
    expect(pushNotifications.sent).toEqual([]);

    // The user leaves; the agent keeps finishing turns it starts on its own.
    activity.appVisible = false;
    activity.focusedAgentId = null;
    activity.lastActivityAt = new Date(Date.now() - 600_000);
    await broadcast();
    await broadcast();
    expect(pushNotifications.sent).toHaveLength(1);
    expect(ws.send).toHaveBeenCalledTimes(3);
    expect(readAttentionRequiredMessage(ws, 1).shouldNotify).toBe(false);
    expect(readAttentionRequiredMessage(ws, 2).shouldNotify).toBe(false);
  });
});
