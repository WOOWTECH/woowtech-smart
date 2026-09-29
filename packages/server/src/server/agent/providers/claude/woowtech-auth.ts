import type {
  ProviderAuthMethod,
  ProviderAuthState,
} from "@getpaseo/protocol/woowtech-provider-auth";
import {
  createProviderEnv,
  createProviderEnvSpec,
  type ProviderEnvSpec,
  type ProviderLaunchAvailability,
  type ProviderRuntimeSettings,
  type ResolvedProviderLaunch,
} from "../../provider-launch-config.js";
import type { ClaudeDiagnosticIo } from "./woowtech-auth-io.js";

// woowtech smart: Claude's login state for the provider list and its diagnostic
// (woowtech/README.md §3). Display only. `claude auth status` prints the account's email and
// organisation, so nothing here returns, logs or throws its output: callers get a fixed state.

export interface ClaudeAuthStatus {
  state: ProviderAuthState;
  method?: ProviderAuthMethod;
}

const UNKNOWN: ClaudeAuthStatus = { state: "unknown" };
const AUTH_STATUS_TIMEOUT_MS = 5_000;
const CLOUD_PROVIDER_FLAGS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

// Claude Code's own reading of a flag.
function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

/**
 * The credential the provider's environment selects, in Claude Code's order
 * (code.claude.com/docs/en/authentication), or null when only `claude` can tell. Agents run
 * Claude non-interactively, which always uses ANTHROPIC_API_KEY when it is set, even over a
 * subscription login; `claude auth status` still reports the subscription then.
 */
export function classifyClaudeAuthEnv(env: NodeJS.ProcessEnv): ClaudeAuthStatus | null {
  if (CLOUD_PROVIDER_FLAGS.some((flag) => isTruthy(env[flag]))) {
    return { state: "unknown", method: "cloud_provider" };
  }
  if (isSet(env.ANTHROPIC_AUTH_TOKEN)) return { state: "configured", method: "auth_token" };
  if (isSet(env.ANTHROPIC_API_KEY)) return { state: "configured", method: "api_key" };
  if (isSet(env.CLAUDE_CODE_OAUTH_TOKEN)) return { state: "configured", method: "oauth_token" };
  if (
    isSet(env.ANTHROPIC_PROFILE) ||
    (isSet(env.ANTHROPIC_FEDERATION_RULE_ID) && isSet(env.ANTHROPIC_ORGANIZATION_ID))
  ) {
    return { state: "unknown", method: "anthropic_profile" };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Classifies `claude auth status` JSON. Only fixed values leave this function. */
export function classifyClaudeAuthStatusOutput(stdout: string): ClaudeAuthStatus {
  let status: unknown;
  try {
    status = JSON.parse(stdout);
  } catch {
    return UNKNOWN;
  }
  if (!isRecord(status)) return UNKNOWN;
  if (status.loggedIn === false) return { state: "needs_login" };
  if (status.loggedIn !== true) return UNKNOWN;
  const { authMethod, apiKeySource, apiProvider, subscriptionType } = status;
  if (
    authMethod === "third_party" ||
    (typeof apiProvider === "string" && apiProvider !== "firstParty")
  ) {
    return { state: "unknown", method: "cloud_provider" };
  }
  if (authMethod === "api_key_helper" || apiKeySource === "apiKeyHelper") {
    return { state: "unknown", method: "api_key_helper" };
  }
  // An API key from Claude's own settings wins over the login in non-interactive mode too.
  if (authMethod === "api_key" || apiKeySource === "ANTHROPIC_API_KEY") {
    return { state: "configured", method: "api_key" };
  }
  if (authMethod === "oauth_token") return { state: "configured" };
  const noApiKey = apiKeySource === undefined || apiKeySource === null || apiKeySource === "none";
  if (
    authMethod === "claude.ai" &&
    noApiKey &&
    typeof subscriptionType === "string" &&
    subscriptionType !== ""
  ) {
    return { state: "signed_in", method: "subscription" };
  }
  return { state: "signed_in" };
}

async function readAuthStatusOutput(
  io: ClaudeDiagnosticIo,
  launch: ResolvedProviderLaunch,
  availability: ProviderLaunchAvailability,
  env: ProviderEnvSpec,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    const result = await io.exec(
      availability.resolvedPath ?? launch.command,
      [...launch.args, "auth", "status"],
      { ...env, timeout: AUTH_STATUS_TIMEOUT_MS, signal },
    );
    return result.stdout;
  } catch (error) {
    // Logged out exits 1 and still prints its JSON. A missing binary, a timeout or a signal
    // leaves the state unknown.
    if (!isRecord(error)) return null;
    if (error.killed === true || error.signal || typeof error.code !== "number") return null;
    return typeof error.stdout === "string" ? error.stdout : null;
  }
}

export interface ResolveClaudeAuthStatusInput {
  io: ClaudeDiagnosticIo;
  runtimeSettings?: ProviderRuntimeSettings;
  signal?: AbortSignal;
  /** The launch the caller already resolved. Resolved here when omitted. */
  resolved?: { launch: ResolvedProviderLaunch; availability: ProviderLaunchAvailability };
}

async function resolveLaunch(input: ResolveClaudeAuthStatusInput) {
  const launch = await input.io.resolveLaunch({
    commandConfig: input.runtimeSettings?.command,
    defaultBinary: "claude",
  });
  return { launch, availability: await input.io.checkAvailability(launch) };
}

/** Never throws: anything that cannot be read is `unknown`. */
export async function resolveClaudeAuthStatus(
  input: ResolveClaudeAuthStatusInput,
): Promise<ClaudeAuthStatus> {
  try {
    const baseEnv = input.io.processEnv();
    const fromEnv = classifyClaudeAuthEnv(
      createProviderEnv({ baseEnv, runtimeSettings: input.runtimeSettings }),
    );
    if (fromEnv) return fromEnv;
    const resolved = input.resolved ?? (await resolveLaunch(input));
    if (!resolved.availability.available) return UNKNOWN;
    const stdout = await readAuthStatusOutput(
      input.io,
      resolved.launch,
      resolved.availability,
      createProviderEnvSpec({ baseEnv, runtimeSettings: input.runtimeSettings }),
      input.signal,
    );
    return stdout === null ? UNKNOWN : classifyClaudeAuthStatusOutput(stdout);
  } catch {
    return UNKNOWN;
  }
}

/** The diagnostic's Auth line: fixed English text, never the probe's output. */
export function formatClaudeAuthDiagnostic(status: ClaudeAuthStatus): string {
  switch (status.state) {
    case "needs_login":
      return "Needs login. Sign in with a Claude subscription or API key.";
    case "signed_in":
      return status.method === "subscription"
        ? "Signed in with a Claude subscription."
        : "Signed in to Claude.";
    case "configured":
      if (status.method === "api_key") return "Will use API key (usage-based billing).";
      if (status.method === "auth_token") {
        return "ANTHROPIC_AUTH_TOKEN is set (billing not checked).";
      }
      if (status.method === "oauth_token") {
        return "CLAUDE_CODE_OAUTH_TOKEN is set (billing not checked).";
      }
      return "Credentials are configured (billing not checked).";
    case "unknown":
      if (status.method === "cloud_provider") {
        return "Authentication unknown (cloud provider credentials are not checked).";
      }
      if (status.method === "api_key_helper") {
        return "Authentication unknown (apiKeyHelper is not checked).";
      }
      if (status.method === "anthropic_profile") {
        return "Authentication unknown (Anthropic profile credentials are not checked).";
      }
      return "Authentication unknown.";
  }
}
