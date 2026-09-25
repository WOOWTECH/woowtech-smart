import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPairCommand } from "./pair.js";

// These next steps are printed or returned as results instead of going through
// the CLI's error output, so they spell out the woowtech-smart command.
describe("daemon commands tell you what to run next with woowtech-smart", () => {
  const savedExitCode = process.exitCode;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "woowtech-next-command-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    await rm(home, { recursive: true, force: true });
  });

  function captureStderr(): () => string {
    let written = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
    return () => written;
  }

  it("pair names the start and relay commands", async () => {
    const stderr = captureStderr();

    await runPairCommand({ daemonTarget: { kind: "instance", home } });

    expect(stderr()).toContain(
      `Offline pairing offer. Start with: woowtech-smart daemon start --home ${JSON.stringify(home)}`,
    );
    expect(stderr()).toContain("Run woowtech-smart daemon pair --relay to enable it.");
  });

  it("pair --json names the relay command agents should run", async () => {
    const stderr = captureStderr();

    await runPairCommand({ daemonTarget: { kind: "instance", home }, json: true });

    const relayDisabled = JSON.parse(stderr().trim().split("\n").at(-1) ?? "{}");
    expect(relayDisabled.action).toBe(
      "Run woowtech-smart daemon pair --relay --json to enable it explicitly.",
    );
  });
});
