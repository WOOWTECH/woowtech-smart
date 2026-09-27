import { EnvHttpProxyAgent, fetch } from "undici";

export class ClaudeAgentSdkDownloadError extends Error {
  readonly status?: number;

  constructor(status?: number) {
    // Never attach the raw transport cause: it can contain proxy/registry credentials.
    super(
      status === undefined
        ? "Claude Agent SDK download failed"
        : `Claude Agent SDK download failed with HTTP ${status}`,
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
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<Uint8Array> {
  const env = options.env ?? process.env;
  let dispatcher: EnvHttpProxyAgent | undefined;
  try {
    // Empty strings prevent undici from falling back to ambient process.env.
    // An absent HTTPS proxy falls back to HTTP in EnvHttpProxyAgent.
    dispatcher = new EnvHttpProxyAgent({
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
  } catch (error) {
    if (error instanceof ClaudeAgentSdkDownloadError) throw error;
    throw new ClaudeAgentSdkDownloadError();
  } finally {
    // destroy also closes unfinished non-2xx or aborted bodies; close could wait for them.
    await dispatcher?.destroy();
  }
}
