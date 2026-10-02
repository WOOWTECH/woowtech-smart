// woowtech smart: the Windows desktop app can start its daemon on another port when Windows
// reserved the default one (woowtech/README.md §25, G12). A saved host that reached the daemon
// on localhost then needs the new address too. Hosts saved another way, such as relay only,
// keep upstream's behavior and get no localhost connection.
import { hostHasConnection, type HostConnection, type HostProfile } from "@/types/host-connection";

function isLocalhostTcp(connection: HostConnection): boolean {
  return connection.type === "directTcp" && connection.endpoint.startsWith("localhost:");
}

export function localDaemonAddressMoved(host: HostProfile, connection: HostConnection): boolean {
  return (
    isLocalhostTcp(connection) &&
    !hostHasConnection(host, connection) &&
    host.connections.some(isLocalhostTcp)
  );
}
