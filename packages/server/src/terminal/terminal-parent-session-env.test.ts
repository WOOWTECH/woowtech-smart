import { delimiter, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTerminalEnvironment } from "./terminal.js";

// A daemon started from inside Claude Code (a Bash tool command or a hook) carries
// that session's variables, and a terminal it opens inherits the daemon's
// environment. The terminal is the user's own shell: a `claude` run there is a new
// session, not a nested one, and nothing in it may post to the parent's inbox.
const parentSession = {
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "cli",
  CLAUDE_CODE_SSE_PORT: "11803",
  CLAUDE_AGENT_SDK_VERSION: "0.2.71",
  CLAUDE_CODE_SESSION_ID: "parent-session",
  CLAUDE_CODE_CHILD_SESSION: "1",
  CLAUDE_CODE_SESSION_ATTENDED: "1",
  CLAUDE_PID: "4242",
  CLAUDE_EFFORT: "high",
  CLAUDE_CODE_EXECPATH: "/parent/claude",
  CLAUDE_CODE_INVOKED_SKILLS: "parent-skill",
  AI_AGENT: "claude-code_2-1-282_agent",
  CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/parent-inbox.sock",
  CLAUDE_CODE_MESSAGING_TOKEN: "parent-inbox-token",
  CLAUDE_CODE_BRIDGE_SESSION_ID: "session_parent",
  CLAUDE_JOB_DIR: "/parent/jobs/1",
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3",
  CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: "4",
  CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR: "5",
  CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR: "6",
};

// What the user's shell and the tools they run in it still need.
const userEnvironment = {
  HOME: "/home/user",
  USER: "user",
  SHELL: "/bin/zsh",
  LANG: "zh_TW.UTF-8",
  TMPDIR: "/tmp/user",
  SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
  EDITOR: "vim",
  CLAUDE_CODE_OAUTH_TOKEN: "user-oauth-token",
  CLAUDE_CODE_USE_BEDROCK: "1",
  ANTHROPIC_API_KEY: "user-api-key",
  ANTHROPIC_MODEL: "user-model",
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000",
  CLAUDE_CONFIG_DIR: "/home/user/.claude-work",
  PASEO_CLI: "/Applications/woowtech smart.app/Contents/Resources/bin/woowtech-smart",
};

// What the daemon hands the terminal it opens: activity reporting and the
// worktree's runtime variables.
const terminalEnv = {
  PATH: ["/usr/bin", "/bin"].join(delimiter),
  PASEO_TERMINAL_ID: "terminal-1",
  PASEO_ACTIVITY_TOKEN: "activity-token",
  PASEO_TERMINAL_ACTIVITY_URL: "http://127.0.0.1:6770/api/terminal-activity",
  PASEO_WORKSPACE_ID: "wks_0123456789abcdef",
  PASEO_WORKTREE_PATH: "/home/user/.woowtech-smart/worktrees/repo/feature",
  PASEO_WORKTREE_PORT: "43123",
};

describe("terminals of a daemon started from a Claude Code session", () => {
  const inherited = { ...parentSession, ...userEnvironment };
  const saved = Object.fromEntries(
    Object.keys(inherited).map((name) => [name, process.env[name]] as const),
  );

  beforeEach(() => {
    Object.assign(process.env, inherited);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("leave the session behind and keep what the user's shell needs", () => {
    const env = buildTerminalEnvironment({
      shell: "/bin/bash",
      env: terminalEnv,
      paseoCliBinDir: "/cli/bin",
      paseoHookCliPath: "/cli/bin/woowtech-smart",
    });
    const kept = {
      ...userEnvironment,
      ...terminalEnv,
      PATH: ["/cli/bin", "/usr/bin", "/bin"].join(delimiter),
      PASEO_HOOK_CLI: resolve("/cli/bin/woowtech-smart"),
      TERM: "xterm-256color",
    };

    expect(Object.keys(parentSession).filter((name) => name in env)).toEqual([]);
    // Only the names under test, so a failure never prints the rest of the environment.
    expect(Object.fromEntries(Object.keys(kept).map((name) => [name, env[name]]))).toEqual(kept);
  });
});
