import { EnvHttpProxyAgent, fetch } from "undici";

export const CLAUDE_SDK_DOWNLOAD_GUIDANCE =
  "First use of Claude requires downloading a component, but the registry or mirror could not be reached. Send your next message to retry.";

export class ClaudeAgentSdkDownloadError extends Error {
  readonly status?: number;

  constructor(status?: number) {
    // Never attach the raw transport cause: it can contain proxy/registry credentials.
    super(
      `[woowtech:claude-sdk:download] Claude Agent SDK download failed${status === undefined ? "" : ` with HTTP ${status}`}. ${CLAUDE_SDK_DOWNLOAD_GUIDANCE}`,
    );
    this.name = "ClaudeAgentSdkDownloadError";
    this.status = status;
  }
}

export function claudeAgentSdkRegistry(env: NodeJS.ProcessEnv): string | undefined {
  return env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY;
}

/** Owns only this download's dispatcher, including body consumption and cancellation. */
export async function fetchFromRegistry(
  url: string,
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    createDispatcher?: (settings: EnvHttpProxyAgent.Options) => EnvHttpProxyAgent;
  } = {},
): Promise<Uint8Array> {
  const env = options.env ?? process.env;
  let dispatcher: EnvHttpProxyAgent | undefined;
  try {
    try {
      // Empty strings prevent undici from falling back to ambient process.env.
      // An absent HTTPS proxy falls back to HTTP in EnvHttpProxyAgent.
      const createDispatcher =
        options.createDispatcher ?? ((settings) => new EnvHttpProxyAgent(settings));
      dispatcher = createDispatcher({
        httpProxy: env.http_proxy ?? env.HTTP_PROXY ?? "",
        httpsProxy: env.https_proxy ?? env.HTTPS_PROXY ?? "",
        noProxy: env.no_proxy ?? env.NO_PROXY ?? "",
      });
      const response = await fetch(url, {
        dispatcher,
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
      if (!response.ok) throw new ClaudeAgentSdkDownloadError(response.status);
      return new Uint8Array(await response.arrayBuffer());
    } finally {
      // destroy also closes unfinished bodies; its errors cross the same safe boundary.
      await dispatcher?.destroy();
    }
  } catch (error) {
    if (error instanceof ClaudeAgentSdkDownloadError) throw error;
    throw new ClaudeAgentSdkDownloadError();
  }
}
