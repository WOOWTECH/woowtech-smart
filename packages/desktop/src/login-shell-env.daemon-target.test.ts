import type { SpawnSyncReturns } from "node:child_process";
import { describe, expect, it } from "vitest";

import { inheritLoginShellEnv } from "./login-shell-env";

type LoginShellEnvInput = NonNullable<Parameters<typeof inheritLoginShellEnv>[0]>;
type LoginShellSpawnSync = NonNullable<LoginShellEnvInput["spawnSync"]>;

const quietLogger = { info() {}, warn() {} };

function appLaunchEnv(): NodeJS.ProcessEnv {
  return { HOME: "/Users/someone", SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" };
}

/** A login shell whose profile ends up with `shellEnv`. */
function loginShellWith(shellEnv: Record<string, string>): LoginShellSpawnSync {
  return ((_shell: string, args: readonly string[]) => {
    const command = String(args.at(-1));
    const marker = /"([0-9a-f]{12})" \+ JSON\.stringify\(process\.env\) \+ "\1"/.exec(command)?.[1];
    if (!marker) throw new Error(`missing env marker in shell command: ${command}`);
    const stdout = `${marker}${JSON.stringify(shellEnv)}${marker}`;
    return {
      pid: 0,
      output: [null, stdout, ""],
      stdout,
      stderr: "",
      status: 0,
      signal: null,
    } satisfies SpawnSyncReturns<string>;
  }) as LoginShellSpawnSync;
}

// People who also use the official Paseo may export PASEO_HOME or PASEO_HOST in
// their shell profile to aim Paseo's CLI at Paseo's daemon. woowtech smart's
// desktop app reads the login shell's environment at startup and must not
// follow them into ~/.paseo or to Paseo's daemon.
describe("the login shell environment beside the official Paseo", () => {
  it("ignores PASEO_HOME and PASEO_HOST exported by the shell profile", () => {
    const env = appLaunchEnv();

    inheritLoginShellEnv({
      env,
      logger: quietLogger,
      platform: "darwin",
      spawnSync: loginShellWith({
        HOME: "/Users/someone",
        SHELL: "/bin/zsh",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        PASEO_HOME: "/Users/someone/.paseo",
        PASEO_HOST: "127.0.0.1:6767",
      }),
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(env.PASEO_HOME).toBeUndefined();
    expect(env.PASEO_HOST).toBeUndefined();
  });

  it("keeps the PASEO_HOME and PASEO_HOST the app itself was launched with", () => {
    const env = { ...appLaunchEnv(), PASEO_HOME: "/tmp/e2e-home", PASEO_HOST: "unused:1" };

    inheritLoginShellEnv({
      env,
      logger: quietLogger,
      platform: "darwin",
      spawnSync: loginShellWith({
        HOME: "/Users/someone",
        SHELL: "/bin/zsh",
        PATH: "/usr/bin:/bin",
        PASEO_HOME: "/Users/someone/.paseo",
        PASEO_HOST: "127.0.0.1:6767",
      }),
    });

    expect(env.PASEO_HOME).toBe("/tmp/e2e-home");
    expect(env.PASEO_HOST).toBe("unused:1");
  });
});
