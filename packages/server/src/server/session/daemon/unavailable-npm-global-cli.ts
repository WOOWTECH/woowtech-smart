import type { CommandResult, NpmGlobalPaseoCli, NpmGlobalPaseoInstall } from "./npm-global-cli.js";

export class NpmSelfUpdateUnavailableError extends Error {
  constructor() {
    super(
      "woowtech smart does not update the daemon through npm. Update the woowtech smart desktop app on this host.",
    );
    this.name = "NpmSelfUpdateUnavailableError";
  }
}

/**
 * The daemon's npm self-update, switched off.
 *
 * Upstream Paseo updates an npm-installed daemon with `npm install -g @getpaseo/cli@latest`,
 * which would replace woowtech smart with upstream Paseo. woowtech smart ships the daemon
 * inside its desktop app, so the desktop app's updater is the only update path and npm is
 * never run.
 */
export class UnavailableNpmGlobalPaseoCli implements NpmGlobalPaseoCli {
  async inspect(): Promise<NpmGlobalPaseoInstall> {
    throw new NpmSelfUpdateUnavailableError();
  }

  async installLatest(): Promise<CommandResult> {
    throw new NpmSelfUpdateUnavailableError();
  }
}
