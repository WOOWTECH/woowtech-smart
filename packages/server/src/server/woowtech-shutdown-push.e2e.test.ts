// woowtech smart: PROPOSAL 2 (not merged). Stopping the daemon closes every agent; the close
// interrupts a run, and the running -> idle edge used to send a "finished" push for work that
// never finished. See ~/.local/share/woowtech-smart/proposals/push-behaviour.md.
import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { MockLoadTestAgentClient } from "./agent/providers/mock-load-test-agent.js";
import type { PushNotificationSender, PushPayload } from "./push/index.js";

const WAIT_MS = 15_000;

class RecordingPushSender implements PushNotificationSender {
  readonly sent: PushPayload[] = [];

  async send(payload: PushPayload): Promise<void> {
    this.sent.push(payload);
  }

  reasons(): unknown[] {
    return this.sent.map((payload) => payload.data?.reason);
  }
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function startDaemon() {
  const cwd = mkdtempSync(path.join(tmpdir(), "woowtech-shutdown-push-"));
  const push = new RecordingPushSender();
  // The mock provider interrupts its run on close, like the daemon-b pre-flight saw.
  const daemon = await createTestPaseoDaemon({
    isDev: true,
    agentClients: { mock: new MockLoadTestAgentClient() },
    pushNotificationSender: push,
  });
  // This client never sends a heartbeat, so the daemon treats nobody as present and pushes.
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });
  await client.connect();
  const created = await client.createWorkspace({
    source: { kind: "directory", path: cwd },
    title: "Shutdown push",
  });
  const workspaceId = created.workspace?.id;
  if (!workspaceId) {
    throw new Error(created.error ?? "Expected the workspace to be created");
  }
  return { daemon, client, push, cwd, workspaceId };
}

async function stop(env: Awaited<ReturnType<typeof startDaemon>>): Promise<void> {
  await env.client.close().catch(() => undefined);
  await env.daemon.close();
  // Attention broadcasts await the last assistant message before they push.
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(env.cwd, { recursive: true, force: true });
}

test("stopping the daemon while an agent waits for permission sends no extra push", async () => {
  const env = await startDaemon();
  try {
    const agent = await env.client.createAgent({
      provider: "mock",
      cwd: env.cwd,
      workspaceId: env.workspaceId,
      model: "ten-second-stream",
      initialPrompt: "emit synthetic plan approval",
    });
    const parked = await env.client.waitForFinish(agent.id, WAIT_MS);
    expect(parked.status).toBe("permission");
    await waitUntil(() => env.push.sent.length === 1, "the permission push");
    expect(env.push.reasons()).toEqual(["permission"]);
  } finally {
    await stop(env);
  }

  expect(env.push.reasons()).toEqual(["permission"]);
}, 60_000);

test("stopping the daemon while an agent runs sends no push", async () => {
  const env = await startDaemon();
  try {
    const agent = await env.client.createAgent({
      provider: "mock",
      cwd: env.cwd,
      workspaceId: env.workspaceId,
      model: "five-minute-stream",
      initialPrompt: "stay running",
    });
    await env.client.waitForAgentUpsert(
      agent.id,
      (snapshot) => snapshot.status === "running",
      WAIT_MS,
    );
    expect(env.push.reasons()).toEqual([]);
  } finally {
    await stop(env);
  }

  expect(env.push.reasons()).toEqual([]);
}, 60_000);
