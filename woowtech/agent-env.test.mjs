// A daemon started from inside Claude Code (a Bash tool command or a hook) inherits
// that session's variables: its id, its inbox socket and token, the parent's process
// id. The agents the daemon launches are other sessions and must not get them, or an
// agent's command can post into the parent session's inbox as one of its children.
// Upstream drops only four of these, Pi and OMP start through a transport that drops
// none, and terminals drop none at all, so a merge can bring any of these gaps back.
// These checks run the daemon's source through tsx.
//
//   node --test woowtech/agent-env.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const agentDir = "../packages/server/src/server/agent/";
const { createProviderEnv } = await tsImport(
  `${agentDir}provider-launch-config.ts`,
  import.meta.url,
);
const { PARENT_CLAUDE_SESSION_ENV_VARS } = await tsImport(
  `${agentDir}parent-claude-session-env.ts`,
  import.meta.url,
);
const { JsonlRpcProcess } = await tsImport(
  `${agentDir}providers/jsonl-rpc-process.ts`,
  import.meta.url,
);
const { buildTerminalEnvironment } = await tsImport(
  "../packages/server/src/terminal/terminal.ts",
  import.meta.url,
);

const SESSION_VARS = ["CLAUDECODE", ...PARENT_CLAUDE_SESSION_ENV_VARS];
const USER_SETTINGS = {
  CLAUDE_CODE_OAUTH_TOKEN: "user-oauth-token",
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000",
};

/** Placeholder values for every session variable, so no real one is ever printed. */
function parentSessionEnv() {
  return Object.fromEntries(SESSION_VARS.map((name) => [name, `parent-${name}`]));
}

// Answers each request with the names from `names` that are set in its environment.
const REPORT_ENV_NAMES = `
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, type, names } = JSON.parse(line);
  const data = names.filter((name) => name in process.env);
  process.stdout.write(JSON.stringify({ type: "response", id, command: type, success: true, data }) + "\\n");
});
`;

test("provider launches drop the Claude Code session the daemon started in", () => {
  const env = createProviderEnv({
    baseEnv: { PATH: "/usr/bin", ...parentSessionEnv(), ...USER_SETTINGS },
  });

  assert.deepEqual(
    SESSION_VARS.filter((name) => name in env),
    [],
  );
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, USER_SETTINGS.CLAUDE_CODE_OAUTH_TOKEN);
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, USER_SETTINGS.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
});

test("Pi and OMP launches drop it too", async () => {
  const names = [...SESSION_VARS, ...Object.keys(USER_SETTINGS)];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, parentSessionEnv(), USER_SETTINGS);
  let transport;
  try {
    transport = new JsonlRpcProcess({
      launch: { command: process.execPath, args: ["-e", REPORT_ENV_NAMES], cwd: process.cwd() },
      logger: { warn() {} },
    });
  } finally {
    // The child has its environment once it is spawned; put this process's back.
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  try {
    assert.deepEqual(await transport.request({ type: "env", names }), Object.keys(USER_SETTINGS));
  } finally {
    await transport.close();
  }
});

test("terminals the daemon opens drop it too", () => {
  // Upstream's four as well: with CLAUDECODE left in, `claude` run in the terminal
  // takes itself for a nested session.
  const names = [
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_AGENT_SDK_VERSION",
    ...PARENT_CLAUDE_SESSION_ENV_VARS,
  ];
  const saved = Object.fromEntries(
    [...names, ...Object.keys(USER_SETTINGS)].map((name) => [name, process.env[name]]),
  );
  Object.assign(
    process.env,
    Object.fromEntries(names.map((name) => [name, `parent-${name}`])),
    USER_SETTINGS,
  );
  let env;
  try {
    env = buildTerminalEnvironment({
      shell: "/bin/sh",
      env: { PATH: "/usr/bin" },
      paseoCliBinDir: null,
      paseoHookCliPath: null,
    });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.deepEqual(
    names.filter((name) => name in env),
    [],
  );
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, USER_SETTINGS.CLAUDE_CODE_OAUTH_TOKEN);
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, USER_SETTINGS.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
});
