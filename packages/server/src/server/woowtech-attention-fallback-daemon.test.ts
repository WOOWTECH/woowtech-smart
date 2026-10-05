// woowtech smart (woowtech/README.md section 16): through a real in-process daemon, a present
// desktop client is asked to show an agent's notice instead of a push; when it reports that its
// system did not show it, the daemon sends that push, once, and only for that client.
import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { MockLoadTestAgentClient } from "./agent/providers/mock-load-test-agent.js";
import type { PushNotificationSender, PushPayload } from "./push/index.js";

const WAIT_MS = 30_000;

class RecordingPushSender implements PushNotificationSender {
  readonly sent: PushPayload[] = [];

  async send(payload: PushPayload): Promise<void> {
    this.sent.push(payload);
  }
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface AttentionNotice {
  agentId: string;
  timestamp: string;
  shouldNotify: boolean;
}

/** Subscribes like the app does (session-context.tsx), so the daemon may pick this client. */
async function watchNotices(client: DaemonClient): Promise<() => Promise<AttentionNotice>> {
  const notices: AttentionNotice[] = [];
  const observation = client.observeEvents(["agent_attention_required"], { notifications: true });
  observation.subscribe({
    snapshot: () => {},
    update: (message) => {
      if (message.type === "agent_attention_required") notices.push(message.payload);
    },
  });
  await observation.ready;
  return async () => {
    await waitUntil(() => notices.length > 0, "agent_attention_required");
    return notices[0]!;
  };
}

async function connect(port: number): Promise<DaemonClient> {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, appVersion: "0.8.0" });
  await client.connect();
  return client;
}

/** A desktop window in front of the user, looking at no agent: present, so no push. */
function reportPresentDesktop(client: DaemonClient): void {
  client.sendHeartbeat({
    deviceType: "web",
    focusedAgentId: null,
    focusedTerminalId: null,
    lastActivityAt: new Date().toISOString(),
    appVisible: true,
  });
}

test("a notice the desktop could not show is pushed once after its report", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "woowtech-attention-fallback-"));
  const push = new RecordingPushSender();
  const daemon = await createTestPaseoDaemon({
    isDev: true,
    agentClients: { mock: new MockLoadTestAgentClient() },
    pushNotificationSender: push,
  });
  const desktop = await connect(daemon.port);
  const browser = await connect(daemon.port);
  try {
    expect(desktop.supportsAttentionDisplayFallback()).toBe(true);
    const created = await desktop.createWorkspace({
      source: { kind: "directory", path: cwd },
      title: "Attention fallback",
    });
    const workspaceId = created.workspace?.id;
    if (!workspaceId) throw new Error(created.error ?? "Expected the workspace to be created");

    // Only the desktop reports presence, so it is the one asked to show the notice.
    const nextNotice = await watchNotices(desktop);
    reportPresentDesktop(desktop);
    const agent = await desktop.createAgent({
      provider: "mock",
      cwd,
      workspaceId,
      model: "ten-second-stream",
      initialPrompt: "finish quickly",
    });
    const received = await nextNotice();
    expect(received).toMatchObject({ agentId: agent.id, shouldNotify: true });
    expect(push.sent).toEqual([]);

    const target = { kind: "agent", agentId: agent.id, timestamp: received.timestamp } as const;
    expect((await browser.reportAttentionDisplayFailure(target)).outcome).toBe("unknown");
    expect((await desktop.reportAttentionDisplayFailure(target)).outcome).toBe("pushed");
    await waitUntil(() => push.sent.length === 1, "the fallback push");
    expect((await desktop.reportAttentionDisplayFailure(target)).outcome).toBe("unknown");

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.data).toMatchObject({ agentId: agent.id, reason: "finished" });
  } finally {
    await desktop.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await daemon.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 60_000);
