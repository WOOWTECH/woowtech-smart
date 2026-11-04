const PASEO_NODE_ENV = "PASEO_NODE_ENV";

export interface NodeEntrypointSpec {
  entryPath: string;
  execArgv: string[];
}

export interface NodeEntrypointInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export type NodeEntrypointArgvMode = "bare" | "node-script";

interface CreateNodeEntrypointInvocationInput {
  execPath: string;
  isPackaged: boolean;
  /** woowtech smart: packaged test build (README §31, G26). */
  testBuild?: boolean;
  packagedRunnerPath: string | null;
  entrypoint: NodeEntrypointSpec;
  argvMode: NodeEntrypointArgvMode;
  args: string[];
  baseEnv: NodeJS.ProcessEnv;
}

export function createElectronNodeEnv(
  baseEnv: NodeJS.ProcessEnv,
  options?: { isPackaged?: boolean; testBuild?: boolean },
): NodeJS.ProcessEnv {
  // woowtech smart: in the daemon, development mode only adds the mock agent providers, which
  // a packaged test build needs (README §31, G26).
  const production = options?.isPackaged === true && options.testBuild !== true;
  return {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: "1",
    [PASEO_NODE_ENV]: production ? "production" : "development",
  };
}

export function createNodeEntrypointInvocation(
  input: CreateNodeEntrypointInvocationInput,
): NodeEntrypointInvocation {
  const env = createElectronNodeEnv(input.baseEnv, {
    isPackaged: input.isPackaged,
    testBuild: input.testBuild,
  });

  if (input.isPackaged) {
    if (!input.packagedRunnerPath) {
      throw new Error("Packaged node entrypoint runner is required for desktop launches.");
    }

    return {
      command: input.execPath,
      args: [
        "--disable-warning=DEP0040",
        input.packagedRunnerPath,
        input.argvMode,
        input.entrypoint.entryPath,
        ...input.args,
      ],
      env,
    };
  }

  return {
    command: input.execPath,
    args: [...input.entrypoint.execArgv, input.entrypoint.entryPath, ...input.args],
    env,
  };
}
