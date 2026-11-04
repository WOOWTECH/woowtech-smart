// woowtech smart: Hub connections stay off unless config.json turns them on (daemon.hub.enabled).
// Upstream lets any owner session (the CLI, a paired app, the hosted web app talking to the daemon
// directly, or plugin code running in that web app's origin) connect the daemon to a Hub at any
// http(s) URL, with the permissions the session asks for. The daemon keeps the relationship in
// hub-relationship.json and reconnects to that Hub on every start, so a single request leaves a
// lasting remote-control channel. WOOWTECH runs no Hub; the hosted one is upstream's service.
//
// What the switch does: while it is off, connecting and permission changes fail before anything
// reaches the Hub or the disk, a stored relationship is not resumed at start, and the status says
// why. Disconnecting works as upstream's does, so a stored relationship can still be removed. With
// the switch on, HubRelationshipController runs as upstream's. Either way, a start that finds a
// stored relationship warns once, naming the Hub and the key.
//
// What it is not: a boundary against an owner session, which has every permission. The switch is
// read once, when the daemon starts, and only from config.json; the daemon config RPC does not
// patch it and there is no environment override. But a session that can write files or run code
// (the file write RPC takes any directory and needs only workspace.write; terminals, agents and
// plugins run code) can edit config.json, ask for a restart (daemon.manage) and then connect a Hub.
// The switch keeps the app and the CLI from tying this daemon to a Hub, the hosted one included,
// by accident.
import path from "node:path";
import type pino from "pino";
import { CLI_COMMAND } from "@getpaseo/protocol/brand-cli";
import { resolvePaseoHome } from "../paseo-home.js";
import { readPersistedConfig, type PersistedConfig } from "../persisted-config.js";
import type { HubRelationshipStatus } from "./relationship-controller.js";

export const HUB_ENABLED_CONFIG_PATH = "daemon.hub.enabled";

/**
 * The refusal, with the command that turns Hub connections on for the home this daemon runs in.
 * The CLI edits the default home unless it is told which one, so any other home needs --home.
 */
export function hubDisabledMessage(paseoHome: string): string {
  const home = path.resolve(paseoHome);
  const homeOption = home === resolvePaseoHome({}) ? "" : ` --home ${JSON.stringify(home)}`;
  return `Hub connections are turned off on this daemon (${HUB_ENABLED_CONFIG_PATH} is not true in config.json). To allow them, run \`${CLI_COMMAND} daemon config set ${HUB_ENABLED_CONFIG_PATH} true${homeOption}\`, then restart the daemon.`;
}

/** A Hub request refused because config.json does not turn Hub connections on. */
export class HubDisabledError extends Error {
  readonly code = "hub_disabled";

  constructor(message: string) {
    super(message);
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
  private readonly disabledMessage: string;

  constructor(options: { paseoHome: string; logger: pino.Logger }) {
    this.logger = options.logger;
    this.enabled = readHubEnabled(options);
    this.disabledMessage = hubDisabledMessage(options.paseoHome);
  }

  /** Throws HubDisabledError while Hub connections are off. */
  assertEnabled(): void {
    if (!this.enabled) throw new HubDisabledError(this.disabledMessage);
  }

  /**
   * Whether startup may resume `stored`. When there is a relationship to resume, it warns once
   * either way, naming the Hub: that it does not (the switch is off) or that it does (it is on).
   */
  allowsStart(stored: StoredHubRelationship | null): boolean {
    if (stored?.state === "active" || stored?.state === "pending") {
      const { daemonId, hubOrigin } = stored.relationship;
      const outcome = this.enabled ? "Resuming" : "Not resuming";
      const switchState = this.enabled ? "is true" : "is not true";
      this.logger.warn(
        { daemonId, hubOrigin, configPath: HUB_ENABLED_CONFIG_PATH },
        `${outcome} the stored Hub relationship with ${hubOrigin}: ${HUB_ENABLED_CONFIG_PATH} ${switchState} in config.json`,
      );
    }
    return this.enabled;
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
      lastError: this.disabledMessage,
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
