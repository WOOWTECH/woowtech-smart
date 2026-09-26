import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importSource } from "./source-modules.mjs";

function source(file) {
  return readFileSync(new URL(`../packages/server/src/${file}`, import.meta.url), "utf8");
}

const { isGitMetadataGenerationEnabled } = await importSource(
  "packages/server/src/server/woowtech-metadata-policy.ts",
);

test("commit and PR metadata are OFF without consulting environment or home preferences", () => {
  assert.equal(isGitMetadataGenerationEnabled(), false);
  const policy = source("server/woowtech-metadata-policy.ts");
  assert.doesNotMatch(policy, /process\.env|readFile|import\s/);
});

test("both generator entrances gate before prompt construction with the fork default", () => {
  const generator = source("server/session/checkout/git-metadata-generator.ts");
  assert.match(generator, /from "\.\.\/\.\.\/woowtech-metadata-policy\.js"/);
  assert.match(
    generator,
    /const isGenerationEnabled = deps\.isGenerationEnabled \?\? isGitMetadataGenerationEnabled/,
  );
  assert.match(
    generator,
    /async generateCommitMessage\(cwd\) \{\s*if \(!isGenerationEnabled\(\)\) return COMMIT_MESSAGE_FALLBACK;\s*const prompt/,
  );
  assert.match(
    generator,
    /async generatePullRequestText\(cwd, baseRef\) \{\s*if \(!isGenerationEnabled\(\)\) return PULL_REQUEST_FALLBACK;\s*const prompt/,
  );
});

test("production checkout wiring uses the guarded generator without enabling a test override", () => {
  const session = source("server/session.ts");
  const wiring = session.slice(
    session.indexOf("this.checkoutSession = new CheckoutSession({"),
    session.indexOf("this.workspaceGitObserver = createWorkspaceGitObserverService({"),
  );
  assert.match(wiring, /gitMetadataGenerator: createGitMetadataGenerator\(\{/);
  assert.match(wiring, /generation: createAgentStructuredTextGeneration\(\{/);
  assert.doesNotMatch(wiring, /isGenerationEnabled|buildMetadataPrompt/);
});
