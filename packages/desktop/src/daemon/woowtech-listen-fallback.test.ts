import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateTcpPort,
  chooseDesktopDaemonListen,
  probeTcpPort,
  readConfiguredListen,
  type PortProbe,
} from "./woowtech-listen-fallback.js";

function probeWith(codes: Record<number, string | null>): { probe: PortProbe; probed: number[] } {
  const probed: number[] = [];
  return {
    probed,
    probe: async (_host, port) => {
      probed.push(port);
      return codes[port] ?? null;
    },
  };
}

const base = {
  platform: "win32" as NodeJS.Platform,
  envListen: undefined,
  configListen: "127.0.0.1:6770",
  defaultPort: 6770,
  allocatePort: async () => 51234,
};

describe("desktop daemon listen fallback", () => {
  it("keeps the default when it can be bound", async () => {
    const p = probeWith({});
    expect(await chooseDesktopDaemonListen({ ...base, probe: p.probe })).toEqual({
      kind: "keep",
      reason: "default-free",
    });
    expect(p.probed).toEqual([6770]);
  });

  it("moves off a port Windows reserved or another program holds", async () => {
    for (const code of ["EACCES", "EADDRINUSE"]) {
      const p = probeWith({ 6770: code });
      expect(await chooseDesktopDaemonListen({ ...base, probe: p.probe })).toEqual({
        kind: "fallback",
        listen: "127.0.0.1:16770",
        code,
      });
    }
  });

  it("tries the next candidates, then a system-assigned port", async () => {
    const p = probeWith({ 6770: "EACCES", 16770: "EACCES", 26770: "EADDRINUSE" });
    expect(await chooseDesktopDaemonListen({ ...base, probe: p.probe })).toEqual({
      kind: "fallback",
      listen: "127.0.0.1:36770",
      code: "EACCES",
    });
    const all = probeWith({
      6770: "EACCES",
      16770: "EACCES",
      26770: "EACCES",
      36770: "EACCES",
      46770: "EACCES",
    });
    expect(await chooseDesktopDaemonListen({ ...base, probe: all.probe })).toEqual({
      kind: "fallback",
      listen: "127.0.0.1:51234",
      code: "EACCES",
    });
    expect(
      await chooseDesktopDaemonListen({
        ...base,
        probe: all.probe,
        allocatePort: async () => null,
      }),
    ).toEqual({ kind: "keep", reason: "no-free-port", code: "EACCES" });
  });

  it("never replaces an address the user chose", async () => {
    const p = probeWith({ 6770: "EACCES" });
    for (const input of [
      { envListen: "127.0.0.1:7000" },
      { configListen: "0.0.0.0:6770" },
      { configListen: "127.0.0.1:7001" },
    ]) {
      expect(await chooseDesktopDaemonListen({ ...base, ...input, probe: p.probe })).toEqual({
        kind: "keep",
        reason: "user-configured",
      });
    }
    expect(p.probed).toEqual([]);
  });

  it("treats a missing or default config address as not chosen", async () => {
    for (const configListen of [undefined, "localhost:6770", " 127.0.0.1:6770 "]) {
      const p = probeWith({ 6770: "EACCES" });
      expect(
        (await chooseDesktopDaemonListen({ ...base, configListen, probe: p.probe })).kind,
      ).toBe("fallback");
    }
  });

  it("leaves other probe errors to the daemon and other platforms alone", async () => {
    expect(
      await chooseDesktopDaemonListen({ ...base, probe: probeWith({ 6770: "EPERM" }).probe }),
    ).toEqual({ kind: "keep", reason: "probe-failed", code: "EPERM" });
    for (const platform of ["darwin", "linux"] as const) {
      const p = probeWith({ 6770: "EACCES" });
      expect(await chooseDesktopDaemonListen({ ...base, platform, probe: p.probe })).toEqual({
        kind: "keep",
        reason: "not-windows",
      });
      expect(p.probed).toEqual([]);
    }
  });
});

describe("TCP port probes", () => {
  it("reports a held port and frees ports it checked", async () => {
    const holder = net.createServer();
    const port = await new Promise<number>((resolve) => {
      holder.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
        const address = holder.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    try {
      expect(await probeTcpPort("127.0.0.1", port)).toBe("EADDRINUSE");
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
    expect(await probeTcpPort("127.0.0.1", port)).toBeNull();
    const allocated = await allocateTcpPort("127.0.0.1");
    expect(allocated).toBeGreaterThan(0);
    expect(await probeTcpPort("127.0.0.1", allocated ?? 0)).toBeNull();
  });
});

describe("configured listen address", () => {
  it("reads daemon.listen from config.json and tolerates a missing or broken file", () => {
    const home = mkdtempSync(path.join(tmpdir(), "woowtech listen "));
    try {
      expect(readConfiguredListen(home)).toBeUndefined();
      writeFileSync(path.join(home, "config.json"), "{ not json");
      expect(readConfiguredListen(home)).toBeUndefined();
      writeFileSync(path.join(home, "config.json"), JSON.stringify({ daemon: { listen: 7 } }));
      expect(readConfiguredListen(home)).toBeUndefined();
      writeFileSync(
        path.join(home, "config.json"),
        JSON.stringify({ daemon: { listen: "127.0.0.1:6770" } }),
      );
      expect(readConfiguredListen(home)).toBe("127.0.0.1:6770");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
