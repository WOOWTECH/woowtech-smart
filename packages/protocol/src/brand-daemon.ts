// Where the brand's daemon lives on a machine. woowtech smart and Apporo smart run next to the
// official Paseo and next to each other, so each brand has its own home and default port, apart
// from Paseo's and from each other's (woowtech/README.md §5).
import { BRAND } from "./brand-values.js";

/** The daemon's default home, before `~` is expanded: ~/.woowtech-smart. */
export const DEFAULT_DAEMON_HOME = BRAND.homeDir;

/** The daemon's default port, which the app and the CLI also assume for a host. */
export const DEFAULT_DAEMON_PORT = BRAND.defaultPort;
