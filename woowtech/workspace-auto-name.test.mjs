import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importSource } from "./source-modules.mjs";

function source(file) {
  return readFileSync(new URL(`../packages/server/src/${file}`, import.meta.url), "utf8");
}

const { isWorkspaceAutoNameEnabled } = await importSource(
  "packages/server/src/server/woowtech-metadata-policy.ts",
);

test("workspace auto-name is off in the fork policy, not a user setting", () => {
  assert.equal(isWorkspaceAutoNameEnabled(), false);
});

test("both daemon naming entrances reach the policy before any task is scheduled", () => {
  const service = source("server/workspace-auto-name.ts");
  assert.match(
    service,
    /this.isAutoNameEnabled = options.isAutoNameEnabled \?\? isWorkspaceAutoNameEnabled/,
  );
  const worktree = service.slice(
    service.indexOf("  scheduleForWorktree("),
    service.indexOf("  scheduleForDirectory("),
  );
  const directory = service.slice(
    service.indexOf("  scheduleForDirectory("),
    service.indexOf("  private async maybeAutoNameWorkspaceBranch"),
  );
  assert.match(worktree, /this.schedule\(/);
  assert.match(directory, /this.schedule\(/);
  const schedule = service.slice(service.indexOf("  private schedule("));
  assert.match(schedule, /if \(!this.isAutoNameEnabled\(\)\) return;\s*this.scheduleTask\(/);
  const bootstrap = source("server/bootstrap.ts");
  const wiring = bootstrap.slice(
    bootstrap.indexOf("const workspaceAutoName = new WorkspaceAutoName("),
    bootstrap.indexOf("  setupAutoArchiveOnMerge("),
  );
  assert.match(wiring, /new WorkspaceAutoName\(/);
  assert.doesNotMatch(wiring, /isAutoNameEnabled|scheduleTask/);
});

test("the naming policy is separate from commit/PR policy and shared generation", () => {
  assert.doesNotMatch(
    source("server/session/checkout/git-metadata-generator.ts"),
    /isWorkspaceAutoNameEnabled/,
  );
  for (const file of [
    "server/agent/structured-generation-providers.ts",
    "utils/build-metadata-prompt.ts",
  ]) {
    assert.doesNotMatch(source(file), /woowtech-metadata-policy|isWorkspaceAutoNameEnabled/);
  }
});
