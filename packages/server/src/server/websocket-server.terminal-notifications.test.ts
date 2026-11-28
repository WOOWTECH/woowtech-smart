import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationKind,
} from "@getpaseo/protocol/notification-preferences";
import { createWorkspaceRuntimeStore } from "./workspace-runtime-store/index.js";
import { SessionDelivery } from "./session/owned-subscriptions/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server as HTTPServer } from "http";
import type pino from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { DownloadTokenStore } from "./file-download/token-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { ScheduleService } from "./schedule/service.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type {
  TerminalActivityListener,
  TerminalActivityTransitionEvent,
  TerminalManager,
} from "../terminal/terminal-manager.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";
import { asInternals, createStub } from "./test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import {
  createPushNotifications,
  type PushNotifications,
  type PushNotificationSender,
  type PushPayload,
} from "./push/index.js";
import type { WorkspaceAutoName } from "./workspace-auto-name.js";
import { relayReasonFor } from "@getpaseo/protocol/woowtech-push";

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

class RecordingPushNotificationSender implements PushNotificationSender {
  readonly sent: PushPayload[] = [];
  readonly sentWithKind: Array<{ payload: PushPayload; kind?: NotificationKind }> = [];

  async send(payload: PushPayload, kind?: NotificationKind): Promise<void> {
    this.sent.push(payload);
    this.sentWithKind.push({ payload, kind });
  }
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

function createTerminalManager() {
  let listener: TerminalActivityListener | null = null;

  const manager = createStub<TerminalManager>({
    subscribeTerminalActivity: vi.fn((l: TerminalActivityListener) => {
      listener = l;
      return () => {
        listener = null;
      };
    }),
  });

  function emit(event: TerminalActivityTransitionEvent): void {
    listener?.(event);
  }

  return { manager, emit };
}

function workspaceRecord(overrides?: Partial<PersistedWorkspaceRecord>): PersistedWorkspaceRecord {
  return {
    workspaceId: "ws-1",
    projectId: "project-1",
    cwd: CWD,
    kind: "directory",
    displayName: "Project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function createWorkspaceRegistry(records: PersistedWorkspaceRecord[]): WorkspaceRegistry {
  return createStub<WorkspaceRegistry>({
    list: vi.fn(async () => records),
  });
}

function createServer(
  terminalManager: TerminalManager,
  workspaceRegistry?: WorkspaceRegistry,
  customPushSender?: PushNotificationSender,
) {
  const pushNotifications = new RecordingPushNotificationSender();
  const sender = customPushSender ?? pushNotifications;
  const agentManager = {
    setAgentAttentionCallback: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onStop: () => () => {},
    getAgent: vi.fn(() => null),
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
    terminalManager,
    undefined,
    "1.2.3-test",
    undefined,
    undefined,
    workspaceRegistry,
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

  return { server, pushNotifications };
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

function connectClient(
  server: VoiceAssistantWebSocketServer,
  subscribed = true,
  activity: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    focusedTerminalId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
  } | null = null,
) {
  const ws = createOpenSocket();
  const delivery = new SessionDelivery(() => {});
  delivery.attach(ws, false);
  asInternals<{ sessions: Map<unknown, unknown> }>(server).sessions.set(ws, {
    kind: "trusted",
    session: {
      delivery,
      wantsSourceNotification: () => true,
      getClientActivity: vi.fn(() => activity),
      subscribesToTerminalDirectory: vi.fn(async () => subscribed),
    },
    clientId: "client-test",
    appVersion: null,
    connectionLogger: createLogger(),
    sockets: new Set([ws]),
    externalDisconnectCleanupTimeout: null,
  });
  return ws;
}

function sentTerminalAttentionMessages(ws: ReturnType<typeof createOpenSocket>) {
  return ws.send.mock.calls
    .map(([rawMessage]) => {
      expect(typeof rawMessage).toBe("string");
      if (typeof rawMessage !== "string") throw new Error("Expected string WebSocket frame");
      return JSON.parse(rawMessage);
    })
    .filter(
      (message) =>
        message.type === "session" && message.message.type === "terminal_attention_required",
    )
    .map((message) => message.message.payload as TerminalAttentionPayload);
}

interface TerminalAttentionPayload {
  terminalId: string;
  cwd: string;
  workspaceId?: string;
  shouldNotify: boolean;
  reason: "finished" | "needs_input";
  title: string;
  body: string;
}

function readTerminalAttentionMessage(ws: ReturnType<typeof createOpenSocket>) {
  const terminalMessages = sentTerminalAttentionMessages(ws);
  expect(terminalMessages).toHaveLength(1);
  const [payload] = terminalMessages;
  if (!payload) throw new Error("Expected terminal attention message");
  return payload;
}

function expectNoTerminalAttentionMessage(ws: ReturnType<typeof createOpenSocket>) {
  expect(sentTerminalAttentionMessages(ws)).toHaveLength(0);
}

const CWD = "/home/user/project";

// Drain microtasks: the broadcast awaits the workspace registry before sending.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function transition(input: {
  previousState: "working" | "idle" | "attention";
  previousChangedAt: number;
  state: "working" | "idle" | "attention" | null;
  changedAt: number;
  id?: string;
  workspaceId?: string;
}): TerminalActivityTransitionEvent {
  return {
    terminalId: input.id ?? "term-1",
    name: "bash",
    cwd: CWD,
    workspaceId: input.workspaceId ?? "ws-1",
    activity: input.state ? { state: input.state, changedAt: input.changedAt } : null,
    previous: { state: input.previousState, changedAt: input.previousChangedAt },
  };
}

describe("VoiceAssistantWebSocketServer terminal attention notifications", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not emit attention without a matching terminal-directory subscription", async () => {
    const { manager, emit } = createTerminalManager();
    const { server, pushNotifications } = createServer(manager);
    const ws = connectClient(server, false);

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: "idle",
        changedAt: 11001,
      }),
    );
    await flushAsync();

    expectNoTerminalAttentionMessage(ws);
    expect(pushNotifications.sent).toHaveLength(1);
  });

  it("broadcasts terminal_attention_required after working -> idle", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(manager);
    const ws = connectClient(server);

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: "idle",
        changedAt: 11001,
      }),
    );

    // Wait for async broadcast
    await flushAsync();

    const payload = readTerminalAttentionMessage(ws);
    expect(payload.terminalId).toBe("term-1");
    expect(payload.cwd).toBe(CWD);
    expect(payload.workspaceId).toBe("ws-1");
    expect(payload.reason).toBe("finished");
    expect(payload.title).toBe("Terminal finished");
    expect(payload.body).toBe("bash");
    // Client has no recent activity so it is not the in-app recipient.
    expect(payload.shouldNotify).toBe(false);
  });

  it("forwards the terminal event workspaceId into the payload", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(manager);
    const ws = connectClient(server);

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: "idle",
        changedAt: 11001,
        workspaceId: "ws-event",
      }),
    );

    await flushAsync();

    expect(readTerminalAttentionMessage(ws).workspaceId).toBe("ws-event");
  });

  it("keeps the event workspaceId for a subdirectory terminal cwd", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(manager);
    const ws = connectClient(server);

    emit({
      ...transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: "idle",
        changedAt: 11001,
      }),
      cwd: `${CWD}/packages/app`,
    });

    await flushAsync();

    expect(readTerminalAttentionMessage(ws).workspaceId).toBe("ws-1");
  });

  it("does not derive terminal attention ownership from the workspace registry", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(
      manager,
      createWorkspaceRegistry([
        workspaceRecord({ archivedAt: "2026-02-01T00:00:00.000Z" }),
        workspaceRecord({ workspaceId: "ws-other", cwd: "/home/user/other" }),
      ]),
    );
    const ws = connectClient(server);

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: "idle",
        changedAt: 11001,
      }),
    );

    await flushAsync();

    expect(readTerminalAttentionMessage(ws).workspaceId).toBe("ws-1");
  });

  it("does not broadcast on working -> working (no transition to idle)", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(manager);
    const ws = connectClient(server);

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: "working",
        changedAt: 15000,
      }),
    );

    await flushAsync();

    expectNoTerminalAttentionMessage(ws);
  });

  it("does not broadcast on working -> unknown", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(manager);
    const ws = connectClient(server);

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: null,
        changedAt: 15000,
      }),
    );

    await flushAsync();

    expectNoTerminalAttentionMessage(ws);
  });

  it("broadcasts needs_input after working -> attention", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(manager);
    const ws = connectClient(server);

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 1000,
        state: "attention",
        changedAt: 15000,
      }),
    );

    await flushAsync();

    const payload = readTerminalAttentionMessage(ws);
    expect(payload.reason).toBe("needs_input");
    expect(payload.title).toBe("Terminal needs input");
    expect(payload.body).toBe("bash");
  });

  it("broadcasts needs_input after idle -> attention", async () => {
    const { manager, emit } = createTerminalManager();
    const { server } = createServer(manager);
    const ws = connectClient(server);

    emit(
      transition({
        previousState: "idle",
        previousChangedAt: 1000,
        state: "attention",
        changedAt: 15000,
      }),
    );

    await flushAsync();

    const payload = readTerminalAttentionMessage(ws);
    expect(payload.reason).toBe("needs_input");
    expect(payload.title).toBe("Terminal needs input");
  });

  it("sends push notification when no clients are present", async () => {
    const { manager, emit } = createTerminalManager();
    const { pushNotifications } = createServer(
      manager,
      createWorkspaceRegistry([workspaceRecord()]),
    );
    // No connected clients

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 0,
        state: "idle",
        changedAt: 15000,
      }),
    );

    await flushAsync();

    expect(pushNotifications.sent).toHaveLength(1);
    expect(pushNotifications.sent[0]?.title).toBe("Terminal finished");
    expect(pushNotifications.sent[0]?.data).toMatchObject({
      serverId: "srv-test",
      terminalId: "term-1",
      workspaceId: "ws-1",
    });
    expect(pushNotifications.sentWithKind[0]?.kind).toEqual({
      kind: "terminal",
      reason: "finished",
    });
  });

  it("filters terminal needs_input and finished pushes per token preferences", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-ws-terminal-prefs-"));
    try {
      // woowtech smart: a push leaves the machine titled with the brand, not the notice
      // (push/woowtech-push-content.ts), so this checks which phones got each push.
      const deliveries: Array<{ tokens: string[] }> = [];
      const realPush = createPushNotifications({
        logger: createStub<pino.Logger>(createLogger()),
        filePath: path.join(home, "push-tokens.json"),
        deliver: async (tokens) => {
          deliveries.push({ tokens });
        },
      });
      // Token with explicit default preferences: terminalNeedsInput: true, terminalFinished: false
      realPush.renew("ExponentPushToken[phone-default]", DEFAULT_NOTIFICATION_PREFERENCES);
      // Token with terminalFinished: true, terminalNeedsInput: false
      realPush.renew("ExponentPushToken[phone-terminal-finished]", {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        events: {
          ...DEFAULT_NOTIFICATION_PREFERENCES.events,
          terminalNeedsInput: false,
          terminalFinished: true,
        },
      });

      const { manager, emit } = createTerminalManager();
      createServer(manager, createWorkspaceRegistry([workspaceRecord()]), realPush);

      emit(
        transition({
          previousState: "working",
          previousChangedAt: 0,
          state: "attention",
          changedAt: 15_000,
        }),
      );
      await flushAsync();

      emit(
        transition({
          previousState: "working",
          previousChangedAt: 15_000,
          state: "idle",
          changedAt: 30_000,
        }),
      );
      await flushAsync();

      expect(deliveries).toEqual([
        { tokens: ["ExponentPushToken[phone-default]"] },
        { tokens: ["ExponentPushToken[phone-terminal-finished]"] },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // woowtech smart (README section 16): terminal attention raised while the daemon stops is not pushed.
  it("does not push terminal attention raised while the daemon is stopping", async () => {
    const { manager, emit } = createTerminalManager();
    const { server, pushNotifications } = createServer(
      manager,
      createWorkspaceRegistry([workspaceRecord()]),
    );
    server.prepareForShutdown();

    emit(
      transition({
        previousState: "working",
        previousChangedAt: 0,
        state: "idle",
        changedAt: 15000,
      }),
    );

    await flushAsync();

    expect(pushNotifications.sent).toEqual([]);
  });

  // woowtech smart (README section 16, owner 2026-11-14): with nobody present and no phone to
  // push to, the computer used last shows the terminal's notice (woowtech-attention-presence.ts).
  describe("with nobody present", () => {
    async function finishTerminalWithComputerAway(phoneHasToken: boolean) {
      const { manager, emit } = createTerminalManager();
      const { server, pushNotifications } = createServer(
        manager,
        createWorkspaceRegistry([workspaceRecord()]),
      );
      asInternals<{ pushNotifications: Pick<PushNotifications, "hasActiveTokens"> }>(
        server,
      ).pushNotifications = { hasActiveTokens: () => phoneHasToken };
      const ws = connectClient(server, true, {
        deviceType: "web",
        focusedAgentId: null,
        focusedTerminalId: null,
        lastActivityAt: new Date(Date.now() - 10 * 60_000),
        appVisible: false,
      });

      emit(
        transition({
          previousState: "working",
          previousChangedAt: 0,
          state: "idle",
          changedAt: 15000,
        }),
      );
      await flushAsync();

      return { shouldNotify: readTerminalAttentionMessage(ws).shouldNotify, pushNotifications };
    }

    it("asks the computer used last when no phone has a push token", async () => {
      const { shouldNotify, pushNotifications } = await finishTerminalWithComputerAway(false);

      expect(shouldNotify).toBe(true);
      expect(pushNotifications.sent).toEqual([]);
    });

    it("pushes as before when a phone has a push token", async () => {
      const { shouldNotify, pushNotifications } = await finishTerminalWithComputerAway(true);

      expect(shouldNotify).toBe(false);
      expect(pushNotifications.sent).toHaveLength(1);
    });
  });

  // woowtech smart: the push relay picks its sentence from the reason (push/woowtech-relay.ts),
  // so a finished terminal must not read "needs your attention".
  it.each([
    ["idle", "finished", "finished"],
    ["attention", "needs_input", "attention"],
  ] as const)(
    "tells the push why when the terminal turns %s",
    async (state, reason, relayReason) => {
      const { manager, emit } = createTerminalManager();
      const { pushNotifications } = createServer(manager);

      emit(transition({ previousState: "working", previousChangedAt: 0, state, changedAt: 15000 }));
      await flushAsync();

      expect(pushNotifications.sent.map((payload) => payload.data?.reason)).toEqual([reason]);
      expect(pushNotifications.sent.map((payload) => relayReasonFor(payload.data))).toEqual([
        relayReason,
      ]);
    },
  );
});
