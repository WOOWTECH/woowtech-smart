import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeDiagnosticIo } from "./woowtech-auth-io.js";

const markers = [
  "fake-private-email@example.invalid",
  "fake-private-account",
  "fake-private-token",
  "fake-private-stderr",
];
function diagnosticIo(): ClaudeDiagnosticIo {
  return {
    resolveLaunch: async () => ({ command: "fixture-only", args: [], source: "override" }),
    checkAvailability: async () => ({ available: true, resolvedPath: "fixture-only" }),
    commandRows: async () => [],
    binaryRows: async () => [{ label: "Binary", value: "Available" }],
    processEnv: () => ({}),
    exec: async () => {
      throw Object.assign(new Error(markers[3]), {
        code: 1,
        stdout: JSON.stringify({
          loggedIn: false,
          email: markers[0],
          accountId: markers[1],
          token: markers[2],
        }),
        stderr: markers[3],
      });
    },
  };
}

test("classifies nonzero logged-out stdout without disclosing private output", async () => {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    diagnosticIo: diagnosticIo(),
  });
  const { diagnostic } = await client.getDiagnostic();
  // Assert booleans so a RED never prints even the synthetic sensitive payload.
  expect(markers.some((marker) => diagnostic.includes(marker))).toBe(false);
  expect(diagnostic.split("\n").find((line) => line.startsWith("  Auth:"))).toBe(
    "  Auth: Needs login. Sign in with a Claude subscription or API key.",
  );
});

test("effective API key takes precedence over subscription login", async () => {
  let probes = 0;
  const io = diagnosticIo();
  io.exec = async () => {
    probes++;
    return { stdout: JSON.stringify({ loggedIn: true }), stderr: "" };
  };
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    diagnosticIo: io,
    runtimeSettings: { env: { ANTHROPIC_API_KEY: markers[2] } },
  });
  const { diagnostic } = await client.getDiagnostic();
  expect(markers.some((marker) => diagnostic.includes(marker))).toBe(false);
  expect(diagnostic.split("\n").find((line) => line.startsWith("  Auth:"))).toBe(
    "  Auth: Will use API key (usage-based billing).",
  );
  expect(probes).toBe(0);
});

// What `claude auth status` prints (Claude Code 2.1): JSON, exit 0 when logged in and 1 when
// not. A claude.ai login adds the account's email and organisation.
const EMAIL = "fake-owner@example.invalid";
const API_KEY = "sk-ant-api03-fakeKeyForTestsOnly-0000000000000000000000";
const OAUTH_TOKEN = "sk-ant-oat01-fakeTokenForTestsOnly-000000000000000000";
const PRIVATE = [EMAIL, API_KEY, OAUTH_TOKEN, "fake-org-uuid", "Fake Org"];

function authStatus(fields: Record<string, unknown>): string {
  return JSON.stringify(
    {
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      analyticsDisabled: false,
      email: EMAIL,
      orgId: "fake-org-uuid",
      orgName: "Fake Org",
      subscriptionType: "max",
      ...fields,
    },
    null,
    2,
  );
}

type Probe = { exitCode: 0 | 1; stdout: string } | { failure: Record<string, unknown> | string };

interface AuthCase extends FakeClaudeInput {
  name: string;
  auth: string;
}

interface FakeClaudeInput {
  baseEnv?: Record<string, string>;
  providerEnv?: Record<string, string>;
  probe?: Probe;
  installed?: boolean;
}

// A Claude client whose `claude auth status` is the given probe; records each run.
function fakeClaude(input: FakeClaudeInput) {
  const runs: string[][] = [];
  const io = diagnosticIo();
  io.processEnv = () => ({ ...input.baseEnv });
  io.checkAvailability = async () =>
    input.installed === false
      ? { available: false, resolvedPath: null }
      : { available: true, resolvedPath: "/fixture/bin/claude" };
  io.exec = async (command, args) => {
    runs.push([command, ...args]);
    const probe = input.probe;
    if (!probe) throw new Error("claude must not be probed");
    if ("failure" in probe) throw probe.failure;
    if (probe.exitCode === 0) return { stdout: probe.stdout, stderr: "" };
    throw Object.assign(new Error("Command failed: claude auth status"), {
      code: 1,
      stdout: probe.stdout,
      stderr: "",
    });
  };
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    diagnosticIo: io,
    runtimeSettings: input.providerEnv ? { env: input.providerEnv } : undefined,
  });
  return { client, runs };
}

// Runs getDiagnostic against a fake `claude`; returns its Auth line and how often it was probed.
async function diagnoseAuth(input: FakeClaudeInput) {
  const { client, runs } = fakeClaude(input);
  const { diagnostic } = await client.getDiagnostic();
  return {
    auth: diagnostic.split("\n").find((line) => line.startsWith("  Auth:")),
    leaks: PRIVATE.some((value) => diagnostic.includes(value)),
    probes: runs.length,
  };
}

const subscription: Probe = { exitCode: 0, stdout: authStatus({}) };

describe("Claude login state in the diagnostic", () => {
  test.each<AuthCase>([
    {
      name: "a claude.ai subscription login",
      probe: subscription,
      auth: "Signed in with a Claude subscription.",
    },
    {
      name: "a subscription login next to an API key from Claude's settings",
      probe: { exitCode: 0, stdout: authStatus({ apiKeySource: "ANTHROPIC_API_KEY" }) },
      auth: "Will use API key (usage-based billing).",
    },
    {
      name: "a Console login's API key",
      probe: {
        exitCode: 0,
        stdout: authStatus({ apiKeySource: "/login managed key", subscriptionType: null }),
      },
      auth: "Signed in to Claude.",
    },
    {
      name: "a claude.ai login with no known plan",
      probe: { exitCode: 0, stdout: authStatus({ subscriptionType: null }) },
      auth: "Signed in to Claude.",
    },
    {
      name: "a token from Claude's settings",
      probe: {
        exitCode: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: "oauth_token",
          apiProvider: "firstParty",
        }),
      },
      auth: "Credentials are configured (billing not checked).",
    },
    {
      name: "an apiKeyHelper",
      probe: {
        exitCode: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: "api_key_helper",
          apiProvider: "firstParty",
          apiKeySource: "apiKeyHelper",
        }),
      },
      auth: "Authentication unknown (apiKeyHelper is not checked).",
    },
    {
      name: "a cloud provider chosen in Claude's settings",
      probe: {
        exitCode: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: "third_party",
          apiProvider: "bedrock",
        }),
      },
      auth: "Authentication unknown (cloud provider credentials are not checked).",
    },
    {
      name: "not logged in",
      probe: {
        exitCode: 1,
        stdout: JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }),
      },
      auth: "Needs login. Sign in with a Claude subscription or API key.",
    },
    {
      name: "output that is not the JSON status",
      probe: { exitCode: 0, stdout: `Logged in as ${EMAIL} (Fake Org)` },
      auth: "Authentication unknown.",
    },
    {
      name: "a probe that timed out",
      probe: { failure: { killed: true, signal: "SIGTERM", code: null, stdout: authStatus({}) } },
      auth: "Authentication unknown.",
    },
    {
      name: "a binary that cannot run",
      probe: { failure: { code: "ENOENT", message: `spawn failed for ${EMAIL}` } },
      auth: "Authentication unknown.",
    },
    {
      name: "a probe that threw something odd",
      probe: { failure: `unexpected ${API_KEY}` },
      auth: "Authentication unknown.",
    },
  ])("$name", async ({ auth, ...input }) => {
    const result = await diagnoseAuth(input);
    // Booleans only: a failing run must not print the fake private values either.
    expect(result.leaks).toBe(false);
    expect(result.auth).toBe(`  Auth: ${auth}`);
    expect(result.probes).toBe(1);
  });

  test.each<AuthCase>([
    {
      name: "ANTHROPIC_AUTH_TOKEN in the provider's env",
      providerEnv: { ANTHROPIC_AUTH_TOKEN: OAUTH_TOKEN },
      auth: "ANTHROPIC_AUTH_TOKEN is set (billing not checked).",
    },
    {
      name: "CLAUDE_CODE_OAUTH_TOKEN in the daemon's env",
      baseEnv: { CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN },
      auth: "CLAUDE_CODE_OAUTH_TOKEN is set (billing not checked).",
    },
    {
      name: "ANTHROPIC_API_KEY in the daemon's env",
      baseEnv: { ANTHROPIC_API_KEY: API_KEY },
      auth: "Will use API key (usage-based billing).",
    },
    {
      name: "ANTHROPIC_AUTH_TOKEN over ANTHROPIC_API_KEY",
      baseEnv: { ANTHROPIC_API_KEY: API_KEY },
      providerEnv: { ANTHROPIC_AUTH_TOKEN: OAUTH_TOKEN },
      auth: "ANTHROPIC_AUTH_TOKEN is set (billing not checked).",
    },
    {
      name: "ANTHROPIC_API_KEY over CLAUDE_CODE_OAUTH_TOKEN",
      baseEnv: { CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN, ANTHROPIC_API_KEY: API_KEY },
      auth: "Will use API key (usage-based billing).",
    },
    {
      name: "a cloud provider flag over every key",
      baseEnv: { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_API_KEY: API_KEY },
      auth: "Authentication unknown (cloud provider credentials are not checked).",
    },
    {
      name: "a named Anthropic profile",
      providerEnv: { ANTHROPIC_PROFILE: "work" },
      auth: "Authentication unknown (Anthropic profile credentials are not checked).",
    },
  ])("$name, without running claude", async ({ auth, ...input }) => {
    const result = await diagnoseAuth(input);
    expect(result.leaks).toBe(false);
    expect(result.auth).toBe(`  Auth: ${auth}`);
    expect(result.probes).toBe(0);
  });

  test.each<AuthCase>([
    {
      name: "an API key the provider's env blanks out",
      baseEnv: { ANTHROPIC_API_KEY: API_KEY },
      providerEnv: { ANTHROPIC_API_KEY: "" },
      probe: subscription,
      auth: "Signed in with a Claude subscription.",
    },
    {
      name: "a cloud provider flag that is off",
      baseEnv: { CLAUDE_CODE_USE_VERTEX: "0" },
      probe: subscription,
      auth: "Signed in with a Claude subscription.",
    },
  ])("$name leaves it to claude", async ({ auth, ...input }) => {
    const result = await diagnoseAuth(input);
    expect(result.leaks).toBe(false);
    expect(result.auth).toBe(`  Auth: ${auth}`);
    expect(result.probes).toBe(1);
  });
});

describe("Claude login state for the provider list", () => {
  test("probes the claude the provider launches", async () => {
    const { client, runs } = fakeClaude({ probe: subscription });
    expect(await client.getAuthStatus()).toEqual({ state: "signed_in", method: "subscription" });
    expect(runs).toEqual([["/fixture/bin/claude", "auth", "status"]]);
  });

  test.each([
    {
      name: "not logged in",
      input: { probe: { exitCode: 1 as const, stdout: JSON.stringify({ loggedIn: false }) } },
      status: { state: "needs_login" },
      probes: 1,
    },
    {
      name: "an API key over a subscription login",
      input: { providerEnv: { ANTHROPIC_API_KEY: API_KEY }, probe: subscription },
      status: { state: "configured", method: "api_key" },
      probes: 0,
    },
    {
      name: "ANTHROPIC_AUTH_TOKEN",
      input: { baseEnv: { ANTHROPIC_AUTH_TOKEN: OAUTH_TOKEN } },
      status: { state: "configured", method: "auth_token" },
      probes: 0,
    },
    {
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      input: { providerEnv: { CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN } },
      status: { state: "configured", method: "oauth_token" },
      probes: 0,
    },
    {
      name: "a cloud provider",
      input: { baseEnv: { CLAUDE_CODE_USE_VERTEX: "true" } },
      status: { state: "unknown", method: "cloud_provider" },
      probes: 0,
    },
    {
      name: "an apiKeyHelper",
      input: {
        probe: {
          exitCode: 0 as const,
          stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key_helper" }),
        },
      },
      status: { state: "unknown", method: "api_key_helper" },
      probes: 1,
    },
    {
      name: "claude missing",
      input: { installed: false },
      status: { state: "unknown" },
      probes: 0,
    },
    {
      name: "a probe that timed out",
      input: { probe: { failure: { killed: true, signal: "SIGTERM", code: null } } },
      status: { state: "unknown" },
      probes: 1,
    },
  ])("$name", async ({ input, status, probes }) => {
    const { client, runs } = fakeClaude(input);
    const result = await client.getAuthStatus();
    expect(PRIVATE.some((value) => JSON.stringify(result).includes(value))).toBe(false);
    expect(result).toEqual(status);
    expect(runs.length).toBe(probes);
  });

  test("never throws when locating claude fails", async () => {
    const io = diagnosticIo();
    io.resolveLaunch = async () => {
      throw new Error(`cannot read settings of ${EMAIL}`);
    };
    const client = new ClaudeAgentClient({ logger: createTestLogger(), diagnosticIo: io });
    expect(await client.getAuthStatus()).toEqual({ state: "unknown" });
  });
});
