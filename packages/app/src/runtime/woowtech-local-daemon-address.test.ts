import { describe, expect, it } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import {
  connectionFromListen,
  type HostConnection,
  type HostProfile,
} from "@/types/host-connection";
import { localDaemonAddressMoved } from "./woowtech-local-daemon-address";

function host(connections: HostConnection[]): HostProfile {
  return {
    serverId: "srv_desktop",
    label: "desktop",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections,
    preferredConnectionId: connections[0]?.id ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function listen(address: string): HostConnection {
  const connection = connectionFromListen(address);
  if (!connection) throw new Error(address);
  return connection;
}

const relay: HostConnection = {
  id: "relay:relay.example.com",
  type: "relay",
  relayEndpoint: "relay.example.com",
  daemonPublicKeyB64: "public-key",
};

describe("local daemon address moves", () => {
  it("adds the new port to a host that reached the daemon on localhost", () => {
    expect(
      localDaemonAddressMoved(host([listen("127.0.0.1:6770")]), listen("127.0.0.1:16770")),
    ).toBe(true);
  });

  it("does nothing when the host already has the address", () => {
    expect(
      localDaemonAddressMoved(host([listen("127.0.0.1:6770")]), listen("localhost:6770")),
    ).toBe(false);
  });

  it("keeps relay-only hosts free of localhost connections", () => {
    expect(localDaemonAddressMoved(host([relay]), listen("127.0.0.1:16770"))).toBe(false);
  });

  it("only follows a daemon that stays on this machine", () => {
    expect(
      localDaemonAddressMoved(host([listen("127.0.0.1:6770")]), listen("192.168.2.9:6770")),
    ).toBe(false);
  });
});
