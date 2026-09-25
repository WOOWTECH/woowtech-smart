import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForDaemonReady } from "./daemon-instance.js";

// The CLI and the desktop app show these messages as they are, so the commands
// in them have to be the woowtech-smart CLI's.
describe("daemon instance messages name the woowtech-smart command", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "woowtech-daemon-instance-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("tells you how to start a daemon that is not running", async () => {
    await expect(waitForDaemonReady(home, { timeoutMs: 0 })).rejects.toThrow(
      `Start with: woowtech-smart daemon start --home ${JSON.stringify(home)}`,
    );
  });

  it("tells you how to check and stop a daemon that never became ready", async () => {
    await writeFile(
      path.join(home, "paseo.pid"),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        hostname: hostname(),
        uid: process.getuid?.() ?? 0,
        listen: null,
      }),
    );

    const error = await waitForDaemonReady(home, { timeoutMs: 0 }).catch((reason) => reason);

    expect(error.message).toContain(
      `Status: woowtech-smart daemon status --home ${JSON.stringify(home)}`,
    );
    expect(error.message).toContain(
      `Stop: woowtech-smart daemon stop --home ${JSON.stringify(home)}`,
    );
  });
});
