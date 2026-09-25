import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOnboard } from "./onboard.js";

const notes = vi.hoisted(() => ({
  shown: [] as Array<{ message?: string; title?: string }>,
  stop: new Error("onboarding stopped after its first note"),
}));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  // The first note is the daemon's folder. Stopping there keeps onboarding from
  // asking about voice and starting a daemon.
  note: (message?: string, title?: string) => {
    notes.shown.push({ message, title });
    throw notes.stop;
  },
}));

function setIsTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean | undefined) {
  Object.defineProperty(stream, "isTTY", { value, configurable: true, writable: true });
}

// Upstream titles the daemon's folder "Paseo home". With our name in it,
// "woowtech smart home" reads as a smart home, so the title says what the folder is.
describe("onboarding in an interactive terminal", () => {
  const stdinIsTTY = process.stdin.isTTY;
  const stdoutIsTTY = process.stdout.isTTY;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "woowtech-onboard-"));
    notes.shown.length = 0;
    setIsTTY(process.stdin, true);
    setIsTTY(process.stdout, true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setIsTTY(process.stdin, stdinIsTTY);
    setIsTTY(process.stdout, stdoutIsTTY);
    await rm(home, { recursive: true, force: true });
  });

  it("titles the daemon's folder as its data folder", async () => {
    await expect(runOnboard({ daemonTarget: { kind: "instance", home } })).rejects.toBe(notes.stop);

    expect(notes.shown).toEqual([{ message: home, title: "Daemon data folder" }]);
    expect(notes.shown[0]?.title).not.toMatch(/smart home/i);
  });
});
