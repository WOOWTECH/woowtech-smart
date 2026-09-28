// woowtech smart looks for the user's `claude` in Claude Code's install locations when
// the daemon's PATH has none: the desktop app started from the Dock may not have
// ~/.local/bin on PATH. The locations, their order and the file checks are unit-tested
// next to the resolver, in woowtech-claude-fallback.test.ts under
// packages/server/src/executable-resolution. This checks the upstream seam: the Claude provider finds `claude` through
// checkProviderLaunchAvailable, which adds the fallback when its caller passes no launch
// default. An upstream change to either can drop the fallback without failing a test.
// The checks run the daemon's source through tsx with HOME and PATH pointed into a
// temporary directory, so no real `claude` runs. woowtech/README.md section 3.
//
//   node --test woowtech/claude-executable.test.mjs
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { importSource } from "./source-modules.mjs";

const { ClaudeAgentClient, resolveClaudeCodeVersion } = await importSource(
  "packages/server/src/server/agent/providers/claude/agent.ts",
);

const silentLogger = {
  child() {
    return silentLogger;
  },
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A home directory with `claude` only at `location`, and a PATH without one. */
function dockLikeEnvironment(t, location) {
  const root = mkdtempSync(path.join(os.tmpdir(), "woowtech-claude-executable-"));
  const home = path.join(root, "home");
  const emptyPathDir = path.join(root, "bin");
  mkdirSync(emptyPathDir, { recursive: true });
  const claude = path.join(home, location);
  mkdirSync(path.dirname(claude), { recursive: true });
  writeFileSync(claude, '#!/bin/sh\necho "2.1.283 (Claude Code)"\n');
  chmodSync(claude, 0o755);

  const saved = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = home;
  process.env.PATH = emptyPathDir;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, claude };
}

test(
  "the Claude provider finds ~/.local/bin/claude when the daemon's PATH has none",
  {
    skip: process.platform === "win32" && "the fallback locations are POSIX paths",
  },
  async (t) => {
    dockLikeEnvironment(t, ".local/bin/claude");

    assert.equal(await new ClaudeAgentClient({ logger: silentLogger }).isAvailable(), true);
    // The version comes from running the file found there.
    assert.equal(await resolveClaudeCodeVersion(), "2.1.283");
  },
);

test(
  "a command the user set still resolves only as configured",
  {
    skip: process.platform === "win32" && "the fallback locations are POSIX paths",
  },
  async (t) => {
    const { root } = dockLikeEnvironment(t, ".local/bin/claude");
    const missing = path.join(root, "custom", "claude");
    const client = new ClaudeAgentClient({
      logger: silentLogger,
      runtimeSettings: { command: { mode: "replace", argv: [missing] } },
    });

    assert.equal(await client.isAvailable(), false);
  },
);
