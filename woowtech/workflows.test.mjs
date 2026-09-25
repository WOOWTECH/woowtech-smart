// woowtech smart runs one GitHub Actions workflow: CI's Ubuntu tests. The other
// workflow files came from upstream. They deploy upstream's web app, relay and
// website, publish releases and Docker images, push Nix hash commits, or need macOS
// runners. They stay in the repo so upstream merges apply cleanly, and are disabled
// in GitHub's UI. GitHub enables every new workflow file, and one with a push
// trigger runs on the push that adds it. woowtech/README.md section 18 has the
// reasons and the steps.
//
//   node --test woowtech/workflows.test.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const desktopDir = new URL("../packages/desktop/", import.meta.url);

function workflow(name) {
  return YAML.parse(readFileSync(new URL(name, workflowsDir), "utf8"));
}

/** The name of the deb package our desktop build makes, as electron-builder picks it. */
async function debPackageName() {
  const { AppInfo, Packager } = createRequire(new URL("package.json", desktopDir))(
    "electron-builder",
  );
  const packager = new Packager({
    projectDir: fileURLToPath(desktopDir),
    config: "electron-builder.yml",
  });
  await packager.validateConfig();
  const { deb, linux } = packager.config;
  const name =
    deb?.packageName ?? linux?.packageName ?? new AppInfo(packager, null).linuxPackageName;
  // fpm lowercases deb package names.
  return name.toLowerCase();
}

// The workflows GitHub runs for us.
const ENABLED = ["ci.yml"];

// Disabled in GitHub: Actions → the workflow → ··· → Disable workflow.
const DISABLED_IN_UI = {
  "android-apk-release.yml": "builds on upstream's EAS project and uploads to a GitHub release",
  "deploy-app.yml": "deploys the web app to upstream's Cloudflare Pages project",
  "deploy-relay.yml": "deploys upstream's relay config; ours is deployed by hand",
  "deploy-website.yml": "deploys paseo.sh to upstream's Cloudflare account",
  "desktop-release.yml": "builds on macOS and Windows runners and publishes a GitHub release",
  "desktop-rollout.yml": "restamps the rollout of a published desktop release",
  "docker.yml": "builds a two-architecture image on every push and publishes to GHCR on tags",
  "nix-update-hash.yml": "needs upstream's bot app and pushes commits to main",
  "nix.yml": "runs a macOS job and expects upstream's app name",
  "release-notes-sync.yml": "creates and edits GitHub releases from upstream's CHANGELOG.md",
};

test("every workflow file is either enabled or disabled in GitHub's UI", () => {
  // GitHub only reads .yml and .yaml files directly in .github/workflows.
  const files = readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  const known = [...ENABLED, ...Object.keys(DISABLED_IN_UI)];
  assert.deepEqual(
    {
      new: files.filter((name) => !known.includes(name)),
      gone: known.filter((name) => !files.includes(name)),
    },
    { new: [], gone: [] },
    "GitHub runs a new workflow file as soon as it sees it, starting with the push " +
      "that adds it. Before pushing, follow woowtech/README.md section 18, then list the " +
      "file in DISABLED_IN_UI with the reason, or in ENABLED if CI needs it. Drop the " +
      "names of deleted files.",
  );
});

test("CI runs weekly, on pull requests and on demand, not on every push to main", () => {
  const { on } = workflow("ci.yml");
  const message =
    "A full CI run takes about 250 of GitHub Free's 2,000 private-repo minutes a month. " +
    "Ten pushes a working day would need about 27 times that, a weekly run about half.";
  assert.deepEqual(
    Object.keys(on).sort(),
    ["merge_group", "pull_request", "schedule", "workflow_dispatch"],
    message,
  );
  const weekly = /^\d{1,2} \d{1,2} \* \* [0-6]$/;
  assert.deepEqual(
    on.schedule.map(({ cron }) => weekly.test(cron)),
    [true],
    message,
  );
});

test("CI's weekly run skips change detection, which has no default branch to compare with", () => {
  // dorny/paths-filter reads the default branch from the event payload, and a
  // schedule event's payload does not carry the repository, so the action fails
  // there. Outside pull requests every job runs whatever it detects.
  const pathFilters = workflow("ci.yml").jobs.changes.steps.filter(({ uses }) =>
    String(uses).startsWith("dorny/paths-filter@"),
  );
  assert.deepEqual(
    pathFilters.map((step) => step.if),
    ["github.event_name != 'schedule'"],
  );
});

test("CI jobs run on Ubuntu, and on Windows only when WOOWTECH_CI_WINDOWS is true", () => {
  // The repository variable is unset, so a gated job is skipped without a runner.
  const windowsGate = /^\$\{\{\s*vars\.WOOWTECH_CI_WINDOWS == 'true' && /;
  const offUbuntu = [];
  for (const name of ENABLED) {
    for (const [id, job] of Object.entries(workflow(name).jobs)) {
      const runner = String(job["runs-on"]);
      if (runner.startsWith("ubuntu-")) continue;
      if (runner.startsWith("windows-") && windowsGate.test(job.if ?? "")) continue;
      offUbuntu.push(`${name} ${id}: ${runner}`);
    }
  }
  assert.deepEqual(
    offUbuntu,
    [],
    "Windows is out of v1, and its minutes count double against GitHub Free's 2,000 " +
      "(macOS ten times). Start a Windows job's if with " +
      "`vars.WOOWTECH_CI_WINDOWS == 'true' && `.",
  );
});

test("CI can neither deploy nor publish: no credentials but the test keys, no write access", () => {
  // Deploying or publishing takes a credential: a Cloudflare, Expo, npm or Apple
  // secret, a bot key, or a GITHUB_TOKEN that can write. Upstream's CI passes three
  // model API keys to its tests. We do not set them, and the suites CI runs do not
  // read them. Jobs without permissions get the repository's read-only default.
  const testKeys = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]);
  const grants = (permissions) =>
    typeof permissions === "string"
      ? [permissions].filter((level) => level !== "read-all")
      : Object.entries(permissions ?? {})
          .filter(([, level]) => level === "write")
          .map(([scope]) => `${scope}: write`);
  const found = [];
  for (const name of ENABLED) {
    const source = readFileSync(new URL(name, workflowsDir), "utf8");
    for (const [, secret] of source.matchAll(/\bsecrets(?:\.|\[\s*['"])(\w+)/g)) {
      if (!testKeys.has(secret)) found.push(`${name}: secrets.${secret}`);
    }
    const { permissions, jobs } = workflow(name);
    for (const grant of grants(permissions)) found.push(`${name}: ${grant}`);
    for (const [id, job] of Object.entries(jobs)) {
      for (const grant of grants(job.permissions)) found.push(`${name} ${id}: ${grant}`);
    }
  }
  assert.deepEqual(found, [], "The owner's rule for CI: tests only, nothing deploys or publishes.");
});

// GitHub runs private repositories on 2-core Linux runners; upstream's public repo gets 4.
// CI run 1 (2026-09-25) failed on four time limits that upstream's runners meet.

/** The Ubuntu steps that run a command matching `pattern`, with the environment each gets. */
function ubuntuSteps(pattern) {
  const ci = workflow("ci.yml");
  return Object.entries(ci.jobs)
    .filter(([, job]) => String(job["runs-on"]).startsWith("ubuntu-"))
    .flatMap(([id, job]) =>
      (job.steps ?? [])
        .filter((step) => pattern.test(String(step.run ?? "")))
        .map((step) => ({ job: id, step: step.name, env: { ...ci.env, ...job.env, ...step.env } })),
    );
}

function readRepo(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("CI gives a cold Metro bundle ten minutes, not 90 or 120 seconds", () => {
  // Every Playwright shard stopped in globalSetup with the web bundle at 91% after 120 s.
  // The desktop job's lifecycle E2E compiles the same bundle while its window waits 90 s.
  for (const file of [
    "packages/app/e2e/support/global-setup.ts",
    "packages/desktop/e2e/daemon-lifecycle-renderer.electron.mjs",
  ]) {
    assert.match(readRepo(file), /E2E_METRO_WARMUP_TIMEOUT_MS/, `${file} ignores the setting`);
  }
  const metroSteps = ubuntuSteps(/\btest:e2e\b/);
  assert.ok(metroSteps.length >= 5, "the Playwright and desktop E2E steps were not found");
  assert.deepEqual(
    metroSteps.filter(({ env }) => !(Number(env.E2E_METRO_WARMUP_TIMEOUT_MS) >= 600_000)),
    [],
  );
});

test("CI gives the app unit tests' hooks two minutes", () => {
  // input-draft.live.test.tsx imports a large module graph in beforeAll: 9.5 s on an idle
  // Mac, over vitest's 10 s on the runner. vitest ignores --hookTimeout for projects.
  assert.match(readRepo("packages/app/vitest.config.ts"), /PASEO_APP_TEST_HOOK_TIMEOUT_MS/);
  const appTests = ubuntuSteps(/npm run test --workspace=@getpaseo\/app\b/);
  assert.deepEqual(
    appTests.map(({ job, env }) => [job, Number(env.PASEO_APP_TEST_HOOK_TIMEOUT_MS)]),
    [["app-tests", 120_000]],
  );
});

test("CI runs two CLI e2e files at a time, not upstream's four", () => {
  // At 4, daemon status requests missed their 1.5 s limit (03-daemon) and a restarted
  // worker came up after its 20 s deadline (25-daemon-restart-supervisor).
  assert.match(readRepo("packages/cli/tests/run-all.ts"), /PASEO_CLI_TEST_CONCURRENCY/);
  const cliTests = ubuntuSteps(/npm run test --workspace=@getpaseo\/cli\b/);
  assert.deepEqual(
    cliTests.map(({ job, env }) => [job, String(env.PASEO_CLI_TEST_CONCURRENCY)]),
    [
      ["cli-tests-1", "2"],
      ["cli-tests-2", "2"],
      ["cli-tests-3", "2"],
    ],
  );
});

test("CI's Ubuntu desktop job may run for an hour", () => {
  // Run 1 stopped at its unit tests. The E2E, packaging and smoke steps after them
  // compile Metro's bundle, export the web app and build four Linux packages.
  assert.equal(workflow("ci.yml").jobs["desktop-tests-ubuntu"]["timeout-minutes"], 60);
});

test("CI's RPM smoke first removes the deb package our desktop build installed", async () => {
  // Upstream's deb is `paseo`. dpkg only warns about a package that is not installed,
  // so a stale name leaves the deb's files in place to hide what the RPM misses.
  const removed = workflow("ci.yml").jobs["desktop-tests-ubuntu"].steps.flatMap(({ run }) =>
    [...String(run ?? "").matchAll(/\bdpkg --remove (\S+)/g)].map(([, name]) => name),
  );
  assert.deepEqual(removed, [await debPackageName()]);
});
