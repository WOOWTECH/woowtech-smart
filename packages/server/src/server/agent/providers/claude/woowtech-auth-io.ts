import { execCommand } from "../../../../utils/spawn.js";
import type { ProcessEnvRecord } from "../../../paseo-env.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
} from "../../provider-launch-config.js";
import {
  buildBinaryDiagnosticRows,
  buildCommandResolutionDiagnosticRows,
} from "../diagnostic-utils.js";

/**
 * woowtech smart: what Claude's diagnostic and login state read from the machine
 * (woowtech/README.md §3). Tests pass fakes, so they never run a real `claude` or read the
 * daemon's own credentials. Agent launch and permissions do not go through here.
 */
export interface ClaudeDiagnosticIo {
  resolveLaunch: typeof resolveProviderLaunch;
  checkAvailability: typeof checkProviderLaunchAvailable;
  commandRows: typeof buildCommandResolutionDiagnosticRows;
  binaryRows: typeof buildBinaryDiagnosticRows;
  exec: typeof execCommand;
  /** The daemon's environment, which the provider's configured env extends. */
  processEnv: () => ProcessEnvRecord;
}

export const realClaudeDiagnosticIo: ClaudeDiagnosticIo = {
  resolveLaunch: resolveProviderLaunch,
  checkAvailability: checkProviderLaunchAvailable,
  commandRows: buildCommandResolutionDiagnosticRows,
  binaryRows: buildBinaryDiagnosticRows,
  exec: execCommand,
  processEnv: () => process.env,
};
