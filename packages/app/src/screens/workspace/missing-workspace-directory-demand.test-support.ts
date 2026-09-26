import { DaemonClient, type DaemonTransport } from "@getpaseo/client/internal/daemon-client";
import {
  WSInboundMessageSchema,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { HostRuntimeStore, type HostRuntimeStorage } from "@/runtime/host-runtime";
import type { ReplicaRow, ReplicaRowStore } from "@/runtime/replica-cache/row-store";
import { defaultHostAppearance } from "@/hosts/appearance";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";

export const serverId = "t1-host";
export const workspaceId = "t1-workspace";
export const workspace: WorkspaceDescriptor = {
  id: workspaceId,
  projectId: "t1-project",
  projectDisplayName: "Test",
  projectRootPath: "/test",
  workspaceDirectory: "/test",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
  status: "done",
  statusEnteredAt: null,
  archivingAt: null,
  diffStat: null,
  scripts: [],
};
// Created on the computer later in the same connection.
export const secondWorkspace: WorkspaceDescriptor = {
  ...workspace,
  id: "t1-second-workspace",
  name: "feature",
};

class MemoryRows implements ReplicaRowStore {
  rows: ReplicaRow[] = [];
  reads: Array<{ serverId: string; kinds: readonly string[]; ids?: readonly string[] }> = [];
  async open() {}
  async read(host: string, kinds: Parameters<ReplicaRowStore["read"]>[1], ids?: readonly string[]) {
    this.reads.push({ serverId: host, kinds, ids });
    return this.rows.filter(
      (row) => row.serverId === host && kinds.includes(row.kind) && (!ids || ids.includes(row.id)),
    );
  }
  async readAll() {
    return [{ serverId, rows: this.rows }];
  }
  async apply(changes: Parameters<ReplicaRowStore["apply"]>[0]) {
    const keys = [...changes.deletes, ...changes.upserts];
    this.rows = this.rows.filter(
      (row) =>
        !keys.some(
          (key) => key.serverId === row.serverId && key.kind === row.kind && key.id === row.id,
        ),
    );
    this.rows.push(...changes.upserts);
  }
  async deleteHost(host: string) {
    this.rows = this.rows.filter((row) => row.serverId !== host);
  }
  async renameHost(oldId: string, newId: string) {
    this.rows = this.rows.map((row) =>
      row.serverId === oldId ? { ...row, serverId: newId } : row,
    );
  }
  async clear() {
    this.rows = [];
  }
}

const REFRESH_LOOP_LIMIT = 10;

// A typed, in-memory transport port. Real DaemonClient serializes requests and parses replies;
// no socket, server fixture, module replacement, or React renderer is involved.
class DirectoryTransport implements DaemonTransport {
  private receive: (data: unknown, isBinary: boolean) => void = () => {};
  private opened: () => void = () => {};
  private disconnected: (event?: unknown) => void = () => {};
  readonly requests: SessionInboundMessage[] = [];
  readonly activeSubscriptions = new Set<string>();
  entries: WorkspaceDescriptor[] = [];
  holdWorkspaces = false;
  // A host with workspace labels: refreshAll() then waits for the label catalog after both
  // directory lists have landed. That tail took 1.4-2.25 s on the device.
  workspaceLabels = false;
  holdLabels = false;
  // The host answers workspace requests with an error while the connection stays up.
  failWorkspaces = false;
  private pending: Array<Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>> = [];
  private pendingLabels: Array<
    Extract<SessionInboundMessage, { type: "workspace.label.list.request" }>
  > = [];
  private nextSubscription = 0;
  private nextLabelSubscription = 0;
  onMessage(handler: (data: unknown, isBinary: boolean) => void) {
    this.receive = handler;
    return () => {
      this.receive = () => {};
    };
  }
  onOpen(handler: () => void) {
    this.opened = handler;
    return () => {};
  }
  onClose(handler: (event?: unknown) => void) {
    this.disconnected = handler;
    return () => {};
  }
  onError(_handler: (event?: unknown) => void) {
    return () => {};
  }
  close() {}
  open() {
    this.opened();
    this.reply({
      type: "status",
      payload: {
        status: "server_info",
        serverId,
        hostname: "Test host",
        version: "0.8.0",
        features: {
          ownedSubscriptions: true,
          ...(this.workspaceLabels ? { workspaceLabels: true } : {}),
        },
      },
    });
  }
  disconnect() {
    this.activeSubscriptions.clear();
    this.disconnected({ code: 1006, reason: "test offline" });
  }
  reply(message: SessionOutboundMessage) {
    queueMicrotask(() => this.receive(JSON.stringify({ type: "session", message }), false));
  }
  send(data: string | Uint8Array | ArrayBuffer) {
    if (typeof data !== "string") throw new Error("Unexpected binary request");
    const frame = WSInboundMessageSchema.parse(JSON.parse(data));
    if (frame.type === "ping") {
      this.receive(JSON.stringify({ type: "pong" }), false);
      return;
    }
    if (frame.type !== "session") return;
    const message = frame.message;
    this.requests.push(message);
    switch (message.type) {
      case "session.events.set_subscription.request":
        this.reply({
          type: "session.events.set_subscription.response",
          payload: { requestId: message.requestId, subscriptionId: this.subscription() },
        });
        break;
      case "fetch_agents_request":
        this.reply({
          type: "fetch_agents_response",
          payload: {
            requestId: message.requestId,
            subscriptionId: this.subscription(),
            entries: [],
            pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
          },
        });
        break;
      case "fetch_workspaces_request":
        // Replies are microtasks, so a refresh loop would starve the event loop and hang the
        // test. Past the limit the host goes quiet and the loop fails a request-count assertion.
        if (this.count("fetch_workspaces_request") > REFRESH_LOOP_LIMIT) this.pending.push(message);
        else if (this.failWorkspaces) this.fail(message);
        else if (this.holdWorkspaces) this.pending.push(message);
        else this.workspaceReply(message);
        break;
      case "workspace.label.list.request":
        if (this.holdLabels) this.pendingLabels.push(message);
        else this.labelReply(message);
        break;
      case "subscription.release.request":
        this.activeSubscriptions.delete(message.subscriptionId);
        this.reply({
          type: "subscription.release.response",
          payload: { requestId: message.requestId, subscriptionId: message.subscriptionId },
        });
        break;
      default:
        throw new Error(`Unexpected session request: ${message.type}`);
    }
  }
  private subscription() {
    const id = `t1-sub-${++this.nextSubscription}`;
    this.activeSubscriptions.add(id);
    return id;
  }
  private workspaceReply(
    message: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>,
  ) {
    this.reply({
      type: "fetch_workspaces_response",
      payload: {
        requestId: message.requestId,
        subscriptionId: this.subscription(),
        entries: this.entries.map((entry) => ({
          ...entry,
          statusEnteredAt: entry.statusEnteredAt?.toISOString() ?? null,
          activityAt: null,
        })),
        emptyProjects: [],
        pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
      },
    });
  }
  deliverWorkspaces() {
    this.holdWorkspaces = false;
    for (const request of this.pending.splice(0)) this.workspaceReply(request);
  }
  private fail(message: Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>) {
    this.reply({
      type: "rpc_error",
      payload: {
        requestId: message.requestId,
        requestType: message.type,
        error: "Workspace directory unavailable",
      },
    });
  }
  private labelReply(
    message: Extract<SessionInboundMessage, { type: "workspace.label.list.request" }>,
  ) {
    this.reply({
      type: "workspace.label.list.response",
      payload: {
        requestId: message.requestId,
        // Not in activeSubscriptions: the label catalog is not a directory subscription.
        subscriptionId: `t1-labels-${++this.nextLabelSubscription}`,
        labels: [],
        sync: { mode: "snapshot", generation: "t1-labels", headSeq: 0, removals: [] },
      },
    });
  }
  deliverLabels() {
    this.holdLabels = false;
    for (const request of this.pendingLabels.splice(0)) this.labelReply(request);
  }
  count(type: SessionInboundMessage["type"]) {
    return this.requests.filter((request) => request.type === type).length;
  }
}

export async function createDemandFixture(options: { workspaceLabels?: boolean } = {}) {
  const transport = new DirectoryTransport();
  transport.workspaceLabels = options.workspaceLabels ?? false;
  const rows = new MemoryRows();
  const values = new Map<string, string>();
  const storage: HostRuntimeStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  const client = new DaemonClient({
    url: "ws://unused.invalid",
    clientId: "t1-test",
    transportFactory: () => transport,
    reconnect: { enabled: false },
    logger: { debug() {}, info() {}, warn: console.warn, error: console.error },
  });
  const connect = async () => {
    const pending = client.connect();
    transport.open();
    await pending;
  };
  await connect();
  const runtime = new HostRuntimeStore({
    storage,
    replicaRowStore: rows,
    revokePushNotifications: async () => {},
    deps: {
      createClient: () => client,
      connectToDaemon: async () => {
        throw new Error("No extra connection probe expected");
      },
      getClientId: async () => "t1-test",
    },
  });
  const online = new Promise<void>((resolve) => {
    const stop = runtime.subscribe(serverId, () => {
      if (runtime.getSnapshot(serverId)?.connectionStatus === "online") {
        stop();
        resolve();
      }
    });
  });
  runtime.syncHosts(
    [
      {
        serverId,
        label: "Test host",
        appearance: defaultHostAppearance(),
        lifecycle: {},
        connections: [{ id: "t1-connection", type: "directTcp", endpoint: "unused.invalid:1" }],
        preferredConnectionId: "t1-connection",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
    {
      initialConnectionByServerId: new Map([
        [serverId, { connectionId: "t1-connection", existingClient: client }],
      ]),
    },
  );
  await online;
  // SessionProvider normally publishes this metadata; there is no React tree in this suite.
  useSessionStore.getState().updateSessionServerInfo(serverId, {
    serverId,
    hostname: "Test host",
    version: "0.8.0",
    features: { ownedSubscriptions: true, workspaceMultiplicity: true },
  });
  return {
    runtime,
    transport,
    rows,
    connect,
    session: () => useSessionStore.getState().sessions[serverId],
    async dispose() {
      runtime.syncHosts([]);
      await client.close();
      useSessionStore.getState().clearSession(serverId);
    },
  };
}
