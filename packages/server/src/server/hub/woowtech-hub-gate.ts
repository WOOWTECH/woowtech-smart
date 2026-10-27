// woowtech smart: Hub connections stay off unless config.json turns them on (daemon.hub.enabled).
// Upstream lets any owner session (the CLI, a paired app, the hosted web app talking to the daemon
// directly, or plugin code running in that web app's origin) connect the daemon to a Hub at any
// http(s) URL, with the permissions the session asks for. The daemon keeps the relationship in
// hub-relationship.json and reconnects to that Hub on every start, so a single request leaves a
// lasting remote-control channel. WOOWTECH runs no Hub; the hosted one is upstream's service.
//
// The switch is read once, when the daemon starts, and only from config.json: no RPC can patch it
// (daemon-config-store.ts picks the fields a patch may change), and a reload reports it as needing
// a restart. While it is off, connecting and permission changes fail before anything reaches the
// Hub or the disk, a stored relationship is not resumed (one warning names the key), and the
// status says why. Disconnecting works as upstream's does, so a stored relationship can still be
// removed. With the switch on, HubRelationshipController runs as upstream's.
import type pino from "pino";
import { CLI_COMMAND } from "@getpaseo/protocol/brand-cli";
import { readPersistedConfig, type PersistedConfig } from "../persisted-config.js";
import type { HubRelationshipStatus } from "./relationship-controller.js";

export const HUB_ENABLED_CONFIG_PATH = "daemon.hub.enabled";

export const HUB_DISABLED_MESSAGE = `Hub connections are turned off on this daemon (${HUB_ENABLED_CONFIG_PATH} is not true in config.json). To allow them, run \`${CLI_COMMAND} daemon config set ${HUB_ENABLED_CONFIG_PATH} true\`, then restart the daemon.`;

/** A Hub request refused because config.json does not turn Hub connections on. */
export class HubDisabledError extends Error {
  readonly code = "hub_disabled";

  constructor() {
    super(HUB_DISABLED_MESSAGE);
    this.name = "HubDisabledError";
  }
}

/** Whether config.json turns Hub connections on. Anything but `true` leaves them off. */
export function hubEnabledInConfig(config: PersistedConfig): boolean {
  return config.daemon?.hub?.enabled === true;
}

interface StoredHubRelationship {
  state: string;
  relationship: { daemonId: string; hubOrigin: string };
}

export class WoowtechHubGate {
  readonly enabled: boolean;
  private readonly logger: pino.Logger;

  constructor(options: { paseoHome: string; logger: pino.Logger }) {
    this.logger = options.logger;
    this.enabled = readHubEnabled(options);
  }

  /** Throws HubDisabledError while Hub connections are off. */
  assertEnabled(): void {
    if (!this.enabled) throw new HubDisabledError();
  }

  /** Whether startup may resume `stored`. While Hub connections are off, it warns that it does not. */
  allowsStart(stored: StoredHubRelationship | null): boolean {
    if (this.enabled) return true;
    if (stored?.state === "active" || stored?.state === "pending") {
      this.logger.warn(
        {
          daemonId: stored.relationship.daemonId,
          hubOrigin: stored.relationship.hubOrigin,
          configPath: HUB_ENABLED_CONFIG_PATH,
        },
        `Not resuming the stored Hub relationship: ${HUB_ENABLED_CONFIG_PATH} is not true in config.json`,
      );
    }
    return false;
  }

  /** The status to report. While Hub connections are off, nothing is connecting and lastError says why. */
  status(status: HubRelationshipStatus): HubRelationshipStatus {
    if (this.enabled || status.state === "revoked" || status.state === "disconnecting") {
      return status;
    }
    return {
      ...status,
      state: "not_connected",
      connectedAt: null,
      lastError: HUB_DISABLED_MESSAGE,
    };
  }
}

/** Reads the switch. A config.json that cannot be read leaves Hub connections off. */
function readHubEnabled(options: { paseoHome: string; logger: pino.Logger }): boolean {
  try {
    return hubEnabledInConfig(readPersistedConfig(options.paseoHome));
  } catch (error) {
    options.logger.warn(
      { err: error, configPath: HUB_ENABLED_CONFIG_PATH },
      "Hub connections stay off: config.json could not be read",
    );
    return false;
  }
}
