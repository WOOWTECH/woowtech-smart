import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { ACPAgentClient } from "./acp-agent.js";

const echoClientInfoAgent = fileURLToPath(
  new URL("./test-utils/echo-client-info-acp-agent.mjs", import.meta.url),
);

class InitializingClient extends ACPAgentClient {
  async clientInfoSeenByAgent(): Promise<unknown> {
    const spawned = await this.spawnProcess();
    spawned.child.kill();
    return spawned.initialize._meta?.receivedClientInfo;
  }
}

describe("ACP client identity", () => {
  test("introduces itself to ACP agents as woowtech smart", async () => {
    const client = new InitializingClient({
      provider: "acp-identity-test",
      logger: createTestLogger(),
      defaultCommand: [process.execPath, echoClientInfoAgent],
    });

    expect(await client.clientInfoSeenByAgent()).toEqual({
      name: "woowtech smart",
      version: "dev",
    });
  });
});
