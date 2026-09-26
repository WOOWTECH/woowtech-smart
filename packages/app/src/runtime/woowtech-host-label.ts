import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { parseServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import type { HostProfile } from "@/types/host-connection";

export type HostLabelServerInfo = NonNullable<ReturnType<DaemonClient["getLastServerInfoMessage"]>>;

interface HostLabelInput {
  hosts: HostProfile[];
  serverId: string;
  info: HostLabelServerInfo | null;
}

export function fillHostLabel(input: HostLabelInput): HostProfile[] {
  if (!input.info || input.info.serverId !== input.serverId) return input.hosts;
  const hostname = input.info.hostname?.trim();
  if (!hostname) return input.hosts;
  const host = input.hosts.find((candidate) => candidate.serverId === input.serverId);
  if (!host || (host.label.trim() !== "" && host.label !== host.serverId)) return input.hosts;
  if (host.label === hostname) return input.hosts;
  return input.hosts.map((candidate) =>
    candidate === host
      ? { ...host, label: hostname, updatedAt: new Date().toISOString() }
      : candidate,
  );
}

interface HostLabelObserver {
  client: Pick<DaemonClient, "on" | "getLastServerInfoMessage" | "getConnectionState">;
  isCurrent: () => boolean;
  receive: (info: HostLabelServerInfo) => void;
}

export function observeHostLabelServerInfo(input: HostLabelObserver): () => void {
  function receive(info: HostLabelServerInfo | null): void {
    if (!info || !input.isCurrent() || input.client.getConnectionState().status !== "connected")
      return;
    input.receive(info);
  }
  const unsubscribe = input.client.on("status", (message) => {
    receive(parseServerInfoStatusPayload(message.payload));
  });
  // The probe's client may already have completed the normal server_info handshake.
  receive(input.client.getLastServerInfoMessage());
  return unsubscribe;
}
