// woowtech smart (woowtech/README.md section 16, owner 2026-11-14): through a real in-process
// daemon, a desktop whose user has been away for ten minutes is asked to show a finished agent's
// notice while no phone has a push token; once a phone has registered one, the next notice is
// pushed instead.
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

/** A desktop window whose user has not touched the computer for ten minutes. */
function reportAwayDesktop(client: DaemonClient): void {
  client.sendHeartbeat({
    deviceType: "web",
    focusedAgentId: null,
    focusedTerminalId: null,
    lastActivityAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    appVisible: false,
  });
}

test("with nobody present the desktop shows the notice until a phone registers for pushes", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "woowtech-attention-without-phone-"));
  // Without the wait, a notice the desktop was asked to show is never pushed later, so each
  // push below comes from the plan alone (woowtech-attention-escalation.ts).
  const previousWait = process.env.WOOWTECH_ESCALATION_SECONDS;
  process.env.WOOWTECH_ESCALATION_SECONDS = "0";
  const push = new RecordingPushSender();
  const daemon = await createTestPaseoDaemon({
    isDev: true,
    agentClients: { mock: new MockLoadTestAgentClient() },
    pushNotificationSender: push,
  });
  const desktop = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.8.0",
  });
  await desktop.connect();
  try {
    const created = await desktop.createWorkspace({
      source: { kind: "directory", path: cwd },
      title: "Attention without a phone",
    });
    const workspaceId = created.workspace?.id;
    if (!workspaceId) throw new Error(created.error ?? "Expected the workspace to be created");

    // Subscribes like the app does (session-context.tsx), so the daemon may pick this client.
    const notices: Array<{ agentId: string; shouldNotify: boolean }> = [];
    const observation = desktop.observeEvents(["agent_attention_required"], {
      notifications: true,
    });
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "agent_attention_required") notices.push(message.payload);
      },
    });
    await observation.ready;
    const finishAgent = () =>
      desktop.createAgent({
        provider: "mock",
        cwd,
        workspaceId,
        model: "e2e-fast-stream",
        initialPrompt: "finish quickly",
      });

    reportAwayDesktop(desktop);
    const first = await finishAgent();
    await waitUntil(() => notices.length === 1, "the first notice");
    expect(notices[0]).toMatchObject({ agentId: first.id, shouldNotify: true });
    expect(push.sent).toEqual([]);

    desktop.registerPushToken("wsp1:en:fcm-test-token:APA91bTestTokenForAttentionWithoutPhone");
    reportAwayDesktop(desktop);
    const second = await finishAgent();
    await waitUntil(() => notices.length === 2, "the second notice");
    expect(notices[1]).toMatchObject({ agentId: second.id, shouldNotify: false });
    await waitUntil(() => push.sent.length === 1, "the push");
    expect(push.sent[0]?.data).toMatchObject({ agentId: second.id, reason: "finished" });
  } finally {
    await desktop.close().catch(() => undefined);
    await daemon.close();
    if (previousWait === undefined) delete process.env.WOOWTECH_ESCALATION_SECONDS;
    else process.env.WOOWTECH_ESCALATION_SECONDS = previousWait;
    rmSync(cwd, { recursive: true, force: true });
  }
}, 60_000);
