/**
 * Variables a running Claude Code session sets for the processes it starts.
 *
 * They name or reach that one session, so a daemon started from inside Claude Code
 * (a Bash tool command or a hook) must not hand them to the agents it launches. With
 * the messaging token, for example, a launched agent's shell command can post to the
 * parent session's inbox as if it were one of that session's own child processes.
 *
 * Upstream already drops CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_SSE_PORT and
 * CLAUDE_AGENT_SDK_VERSION in provider-launch-config.ts; these are the rest, taken
 * from Claude Code 2.1.282 and https://code.claude.com/docs/en/env-vars. User
 * configuration such as CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_USE_BEDROCK or
 * CLAUDE_CODE_MAX_OUTPUT_TOKENS is not session state and still reaches the agent.
 */
export const PARENT_CLAUDE_SESSION_ENV_VARS: readonly string[] = [
  // Added to the session's Bash tool and hook subprocesses. A nested claude that
  // inherits CLAUDE_CODE_CHILD_SESSION takes itself for the parent's child, and an
  // interactive one leaves itself out of --resume, --continue and history.
  // CLAUDE_PID is the parent's process id, for scripts that signal the parent.
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_INVOKED_SKILLS",
  "AI_AGENT",
  // The session's inbox, and the token that proves a sender is one of its children.
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  // Remote Control and background-session identity.
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_JOB_DIR",
  // Descriptors passed to the parent when it was launched. Agents start with stdio
  // only, so in an agent these numbers name no file or the wrong one.
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR",
];
