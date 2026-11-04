// woowtech smart (hub/woowtech-hub-gate.ts): through a real in-process daemon, a Hub request that
// the switch refuses reaches the client with its own error code and a message that names the
// command to run, and the daemon stores nothing. With config.json turning Hub connections on, the
// status carries no refusal.
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { DaemonClient, createTestPaseoDaemon } from "../test-utils/index.js";

async function withDaemon(
  options: { hubEnabled: boolean },
  run: (daemon: { paseoHome: string }, client: DaemonClient) => Promise<void>,
): Promise<void> {
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false, ...options });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    await run(daemon, client);
  } finally {
    await client.close();
    await daemon.close();
  }
}

describe("over the daemon's RPC", () => {
  test("a new daemon refuses to connect a Hub or change its permissions, with code hub_disabled", async () => {
    await withDaemon({ hubEnabled: false }, async (daemon, client) => {
      await expect(
        client.connectHub("https://hub.example.test", "enrollment-token", ["hub.execute"]),
      ).rejects.toMatchObject({
        name: "DaemonRpcError",
        code: "hub_disabled",
        requestType: "hub.management.daemon.connect.request",
        message: expect.stringContaining(
          "woowtech-smart daemon config set daemon.hub.enabled true",
        ),
      });
      await expect(client.updateHubPermissions({ grant: ["daemon.manage"] })).rejects.toMatchObject(
        {
          name: "DaemonRpcError",
          code: "hub_disabled",
          requestType: "hub.management.daemon.permissions.update.request",
        },
      );

      const { status } = await client.getHubStatus();
      expect(status).toMatchObject({
        state: "not_connected",
        hubOrigin: null,
        lastError: expect.stringContaining("daemon.hub.enabled"),
      });
      await expect(access(path.join(daemon.paseoHome, "hub-relationship.json"))).rejects.toThrow(
        /ENOENT/,
      );
    });
  });

  test("a daemon whose config.json turns Hub connections on reports no refusal", async () => {
    await withDaemon({ hubEnabled: true }, async (_daemon, client) => {
      const { status } = await client.getHubStatus();

      expect(status).toEqual({
        state: "not_connected",
        daemonId: null,
        hubOrigin: null,
        permissions: [],
        connectedAt: null,
        lastError: null,
      });
    });
  });
});
