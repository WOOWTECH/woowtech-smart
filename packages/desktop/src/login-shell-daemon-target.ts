// The official Paseo reads PASEO_HOME and PASEO_HOST too, and people who use it
// may export them in their shell profile to aim Paseo's CLI at Paseo's daemon.
// The desktop app merges its login shell's environment into its own at startup,
// which would move woowtech smart's daemon into Paseo's home and send our CLI
// to Paseo's daemon. The app takes these two only from its own launch
// environment, where the desktop e2e and smoke tests set them.
const APP_CHOSEN_DAEMON_TARGET = ["PASEO_HOME", "PASEO_HOST"] as const;

/** The login shell's environment without the daemon target the app chooses itself. */
export function withoutLoginShellDaemonTarget(
  shellEnv: Record<string, string>,
): Record<string, string> {
  const env = { ...shellEnv };
  for (const key of APP_CHOSEN_DAEMON_TARGET) {
    delete env[key];
  }
  return env;
}
