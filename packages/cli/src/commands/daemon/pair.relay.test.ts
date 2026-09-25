import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLocalPairingOffer, runPairCommand } from "./pair.js";

// woowtech smart runs its own relay and turns it on in new homes, so pairing needs
// no consent step and sends the phone to relay.woowtech.io.
describe("daemon pair in a new home", () => {
  const savedExitCode = process.exitCode;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "woowtech-pair-relay-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    await rm(root, { recursive: true, force: true });
  });

  it("offers pairing through WoowTech's relay", async () => {
    const offer = await resolveLocalPairingOffer({ paseoHome: path.join(root, "home") });

    expect(offer.relayEnabled).toBe(true);
    expect(parseConnectionOfferFromUrl(offer.url ?? "")?.relay).toEqual({
      endpoint: "relay.woowtech.io:443",
      useTls: true,
    });
  });

  it("prints the pairing link instead of asking to enable the relay", async () => {
    let stdout = "";
    let stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    await runPairCommand({ daemonTarget: { kind: "instance", home: path.join(root, "home") } });

    expect(stdout).toContain("#offer=");
    expect(stderr).not.toContain("Relay pairing is disabled");
    expect(process.exitCode).toBe(savedExitCode);
  });
});
