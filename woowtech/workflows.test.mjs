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
import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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

test("CI runs on every push to main, on pull requests and on demand, as upstream does", () => {
  // The repository is public since 2026-10-08, so standard runners cost no minutes. While it
  // was private (GitHub Free, 2,000 minutes a month) CI ran weekly instead.
  const { on } = workflow("ci.yml");
  assert.deepEqual(Object.keys(on).sort(), [
    "merge_group",
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  assert.deepEqual(on.push, { branches: ["main"] });
});

/**
 * The terms a job's `if` joins with `&&` at its top level. Empty when an `||` outside
 * parentheses could run the job without them.
 */
function requiredTerms(condition) {
  let expression = String(condition ?? "").replace(/^\s*\$\{\{([\s\S]*)\}\}\s*$/, "$1");
  // Collapse parenthesized groups, innermost first, until only the top level is left.
  for (let previous = ""; previous !== expression; ) {
    previous = expression;
    expression = expression.replace(/\([^()]*\)/g, "()");
  }
  return expression.includes("||") ? [] : expression.split("&&").map((term) => term.trim());
}

test("CI runs the Playwright shards only on a manual run that asks for them", () => {
  // The owner's decision (2026-09-26): the four shards took 26 to 44 minutes each in CI run 2.
  // The weekly run, pull requests and the merge queue run every other job. Run workflow
  // with run_playwright ticked runs the shards as well.
  const ci = workflow("ci.yml");
  const input = ci.on.workflow_dispatch?.inputs?.run_playwright;
  assert.deepEqual(
    { type: input?.type, default: input?.default },
    { type: "boolean", default: false },
    "Declare workflow_dispatch's run_playwright input: a boolean, unticked by default.",
  );
  const ids = (select) =>
    Object.entries(ci.jobs)
      .filter(([, job]) => select(job))
      .map(([id]) => id);
  const playwright = ids((job) =>
    (job.steps ?? []).some(({ run }) =>
      /\bnpm run test:e2e --workspace=@getpaseo\/app\b/.test(String(run ?? "")),
    ),
  );
  assert.ok(playwright.length > 0, "the Playwright jobs were not found");
  const onDemand = ["github.event_name == 'workflow_dispatch'", "inputs.run_playwright"];
  assert.deepEqual(
    ids((job) => onDemand.every((term) => requiredTerms(job.if).includes(term))),
    playwright,
    "Start each Playwright job's if with " +
      "`github.event_name == 'workflow_dispatch' && inputs.run_playwright && `.",
  );
  assert.deepEqual(
    ids((job) => /\b(?:github\.event_name|inputs)\b/.test(String(job.if ?? ""))),
    playwright,
    "Only the Playwright jobs depend on the event or the inputs; the weekly run runs the rest.",
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

test("CI's Ubuntu jobs name an Ubuntu version, not ubuntu-latest", () => {
  // GitHub moves ubuntu-latest to Ubuntu 26 from 2026-10-19. With a version, the image
  // changes when we change the label, not under a weekly run. Two job names still say
  // (ubuntu-latest): they are upstream's check names, which scripts/ci-workflow.test.mjs pins.
  const labels = (value) =>
    typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(labels);
  const latest = [];
  for (const name of ENABLED) {
    for (const [id, job] of Object.entries(workflow(name).jobs)) {
      // A matrix job lists its runners in the matrix.
      for (const label of labels([job["runs-on"], job.strategy?.matrix])) {
        if (/\bubuntu-latest\b/.test(label)) latest.push(`${name} ${id}: ${label}`);
      }
    }
  }
  assert.deepEqual(latest, [], "Pin each Ubuntu runner to a version, such as ubuntu-24.04.");
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

// GitHub runs private repositories on 2-core, 7 GB Linux runners; upstream's public repo gets
// 4 cores and 16 GB. CI runs 1 and 2 failed on time and memory limits that upstream's runners meet.

/** The Ubuntu steps that run a command matching `pattern`, with the environment each gets. */
function ubuntuSteps(pattern) {
  const ci = workflow("ci.yml");
  return Object.entries(ci.jobs)
    .filter(([, job]) => String(job["runs-on"]).startsWith("ubuntu-"))
    .flatMap(([id, job]) =>
      (job.steps ?? [])
        .filter((step) => pattern.test(String(step.run ?? "")))
        .map((step) => ({
          job: id,
          step: step.name,
          run: String(step.run),
          env: { ...ci.env, ...job.env, ...step.env },
        })),
    );
}

/** A source file without its comments, so that a comment naming a setting does not count. */
function readRepoCode(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/.*/g, "");
}

test("CI gives a cold Metro bundle ten minutes, not 30, 90 or 120 seconds", () => {
  // Every Playwright shard stopped in globalSetup with the web bundle at 91% after 120 s.
  // The desktop job's lifecycle E2E compiles the same bundle while its window waits 90 s,
  // and its browser E2E starts another Metro and waits Playwright's default 30 s for Settings.
  for (const file of [
    "packages/app/e2e/support/global-setup.ts",
    "packages/desktop/e2e/daemon-lifecycle-renderer.electron.mjs",
    "packages/desktop/e2e/browser-tabs.e2e.mjs",
  ]) {
    assert.match(
      readRepoCode(file),
      /\benv\.E2E_METRO_WARMUP_TIMEOUT_MS\b/,
      `${file} ignores the setting`,
    );
  }
  const metroSteps = ubuntuSteps(/\btest:e2e\b/);
  assert.ok(metroSteps.length >= 5, "the Playwright and desktop E2E steps were not found");
  assert.deepEqual(
    metroSteps.filter(({ env }) => !(Number(env.E2E_METRO_WARMUP_TIMEOUT_MS) >= 600_000)),
    [],
  );
});

test("the desktop browser E2E retries a screenshot the tab has not painted yet", () => {
  // CI run 2: the hidden window had not painted within the desktop's 5 s capture, and
  // browser_screenshot answered screenshot_no_frame, retryable. verifyHiddenBrowserScreenshots
  // called it once. Every call goes through an ...UntilReady helper, which retries retryable
  // errors until the script's timeout and returns any other answer.
  const code = readRepoCode("packages/desktop/e2e/browser-tabs.e2e.mjs");
  const callers = [
    ...code.matchAll(/(\w+)\((?:\s*client,)?(?:\s*\{\s*name:)?\s*"browser_screenshot"/g),
  ].map(([, caller]) => caller);
  assert.ok(callers.length >= 2, "the browser_screenshot calls were not found");
  assert.deepEqual(
    callers.filter((caller) => !caller.endsWith("UntilReady")),
    [],
  );
});

test("CI gives Metro in the Playwright shards a 4 GB heap", () => {
  // CI run 2's shard 4: Metro, holding the app and the second entry root-error-recovery.spec.ts
  // asks for, reached Node's default heap limit, about 1.8 GB on the 7 GB runner (4 GB on
  // upstream's 16 GB runner), and every later test found no server. Metro gets the setting
  // because global-setup.ts starts it with the step's environment.
  const startMetro = /function startMetro\([\s\S]*?\n\}\n/.exec(
    readRepoCode("packages/app/e2e/support/global-setup.ts"),
  )?.[0];
  assert.match(
    startMetro ?? "",
    /\benv:\s*\{\s*\.\.\.process\.env\b/,
    "global-setup.ts no longer starts Metro with the step's environment",
  );
  const heapLimits = ubuntuSteps(/\bnpm run test:e2e --workspace=@getpaseo\/app\b/).map(
    ({ job, env }) => [job, /--max-old-space-size=(\d+)/.exec(env.NODE_OPTIONS ?? "")?.[1]],
  );
  assert.deepEqual(heapLimits, [
    ["playwright-1", "4096"],
    ["playwright-2", "4096"],
    ["playwright-3", "4096"],
    ["playwright-4", "4096"],
  ]);
});

test("CI gives the Linux desktop build's Metro export a 4 GB heap", () => {
  // CI run 8 (2026-09-29): "Build Linux desktop artifacts" runs npm run build:desktop, whose
  // expo export of the web bundle reached Node's default heap limit, about 1.8 GB on the 7 GB
  // runner, at 81% of the bundle. The app had grown with F11 and the third upstream batch; run 7
  // had passed near that limit. Local builds have always needed 4096 MB for expo export.
  const heapLimits = ubuntuSteps(/\bnpm run build:desktop\b/).map(({ job, env }) => [
    job,
    /--max-old-space-size=(\d+)/.exec(env.NODE_OPTIONS ?? "")?.[1],
  ]);
  assert.deepEqual(heapLimits, [["desktop-tests-ubuntu", "4096"]]);
});

/**
 * The hook and test timeouts of each packages/app vitest project, as vitest itself resolves
 * them for the app's test script followed by `args`, with PASEO_APP_TEST_HOOK_TIMEOUT_MS set
 * to `hookTimeout`, or unset when it is null.
 */
async function appTestTimeouts({ hookTimeout = null, args = "" } = {}) {
  const env = { ...process.env };
  delete env.PASEO_APP_TEST_HOOK_TIMEOUT_MS;
  if (hookTimeout !== null) env.PASEO_APP_TEST_HOOK_TIMEOUT_MS = hookTimeout;
  const appDir = new URL("../packages/app/", import.meta.url);
  const { scripts } = JSON.parse(readFileSync(new URL("package.json", appDir), "utf8"));
  const script = `
    import { createVitest, parseCLI } from "vitest/node";
    const { options } = parseCLI(${JSON.stringify(`${scripts.test} ${args}`.trim())});
    const vitest = await createVitest("test", { ...options, watch: false, run: true });
    const projects = vitest.projects.map(({ name, config }) => ({
      name,
      browser: config.browser.enabled,
      hookTimeout: config.hookTimeout,
      testTimeout: config.testTimeout,
    }));
    await vitest.close();
    process.stdout.write(JSON.stringify(projects) + "\\n", () => process.exit(0));
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { cwd: fileURLToPath(appDir), env },
  );
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("CI gives the app unit tests' hooks two minutes; unset, vitest keeps its defaults", async () => {
  // input-draft.live.test.tsx imports a large module graph in beforeAll: 9.5 s on an idle
  // Mac, over vitest's 10 s on the runner. vitest ignores --hookTimeout for projects, so
  // packages/app/vitest.config.ts reads the variable. Unset, as on a developer's machine,
  // every project keeps vitest's own default: 10 s, or 30 s in browser mode.
  const appTests = ubuntuSteps(/npm run test --workspace=@getpaseo\/app\b/);
  assert.deepEqual(
    appTests.map(({ job, env }) => [job, Number(env.PASEO_APP_TEST_HOOK_TIMEOUT_MS)]),
    [["app-tests", 120_000]],
  );
  const [inCi, unset] = await Promise.all([
    appTestTimeouts({ hookTimeout: "120000" }),
    appTestTimeouts(),
  ]);
  assert.ok(inCi.length >= 2, "the app's unit and browser projects were not found");
  assert.deepEqual(
    inCi.filter(({ hookTimeout }) => hookTimeout !== 120_000),
    [],
  );
  assert.deepEqual(
    unset.filter(({ browser, hookTimeout }) => hookTimeout !== (browser ? 30_000 : 10_000)),
    [],
  );
});

test("CI gives each app test a minute, and vitest hands --testTimeout to every project", async () => {
  // unistyles-module-scope.test.ts parses every app source file with TypeScript: 1.4 s on a
  // Mac, over vitest's 5 s on the runner in CI run 2. vitest passes --testTimeout on to its
  // projects, unlike --hookTimeout, so the flag on CI's command is enough. npm hands the
  // script what follows `--`, and keeps a flag before it for itself.
  const args = ubuntuSteps(/npm run test --workspace=@getpaseo\/app\b/).map(({ run }) =>
    run
      .split(/\s--\s/)
      .slice(1)
      .join(" -- "),
  );
  assert.equal(args.length, 1, "the app-tests step was not found");
  const projects = await appTestTimeouts({ args: args[0] });
  assert.ok(projects.length >= 2, "the app's unit and browser projects were not found");
  assert.deepEqual(
    projects.filter(({ testTimeout }) => testTimeout !== 60_000),
    [],
  );
});

test("CI runs two CLI e2e files at a time, not upstream's four", () => {
  // At 4, daemon status requests missed their 1.5 s limit (03-daemon) and a restarted
  // worker came up after its 20 s deadline (25-daemon-restart-supervisor).
  assert.match(
    readRepoCode("packages/cli/tests/run-all.ts"),
    /\benv\.PASEO_CLI_TEST_CONCURRENCY\b/,
  );
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

test("the pre-commit hook formats and lints .mjs files, as CI does", () => {
  // CI checks the whole repo. Without mjs in these globs the hook skipped every .mjs file,
  // and CI run 1's format and lint jobs failed on three of them.
  const hook = YAML.parse(readFileSync(new URL("../lefthook.yml", import.meta.url), "utf8"));
  assert.deepEqual(
    hook["pre-commit"].jobs
      .filter(({ name }) => name === "format" || name === "lint")
      .map(({ name, glob }) => [name, /\bmjs\b/.test(glob)]),
    [
      ["format", true],
      ["lint", true],
    ],
  );
});

test("CI's guard step skips one test: zh-TW's regeneration, which needs OpenCC", () => {
  // The typecheck job runs every woowtech/*.test.mjs after `npm ci` and the server stack's
  // build (scripts/ci-workflow.test.mjs pins the step). OpenCC comes from woowtech/tools, which
  // has its own package.json that `npm ci` does not install, so the one test that runs the
  // generator is skipped there by its exact name. Nothing else may be skipped or narrowed.
  const guardSteps = workflow("ci.yml").jobs.typecheck.steps.filter(({ run }) =>
    /\bwoowtech\/\*\.test\.mjs\b/.test(String(run ?? "")),
  );
  assert.equal(guardSteps.length, 1, "the typecheck job's guard step was not found");
  const run = String(guardSteps[0].run);
  assert.doesNotMatch(run, /--test-(?:name-pattern|only)\b/);
  const skips = [...run.matchAll(/--test-skip-pattern="([^"]*)"/g)].map(
    ([, pattern]) => new RegExp(pattern),
  );

  const guardTests = readdirSync(new URL("./", import.meta.url))
    .filter((name) => name.endsWith(".test.mjs"))
    .flatMap((file) =>
      [
        ...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(
          /\b(?:test|it|describe|suite)(?:\.\w+)?\(\s*(["'`])(.*?)\1/g,
        ),
      ].map(([, , title]) => ({ file, title })),
    );
  assert.deepEqual(
    guardTests.filter(({ title }) => skips.some((skip) => skip.test(title))),
    [
      {
        file: "zh-tw.test.mjs",
        title: "Traditional Chinese is regenerated from upstream's current Simplified Chinese",
      },
    ],
  );
});

test("CI's typecheck job checks out the full history: the vendor guard reads icons at UPSTREAM_REF", () => {
  // CI run 10 (2026-09-30): claude-badge.test.mjs failed in the guard step with "fatal: invalid
  // object name '130705c02^'". woowtech/tools/write-vendor-badges.mjs reads the vendor icon files
  // at UPSTREAM_REF (woowtech/vendor-marks.mjs) with git show, and actions/checkout fetches only
  // the head commit unless fetch-depth is 0. A local clone has the full history, so only CI fails.
  const depths = workflow("ci.yml")
    .jobs.typecheck.steps.filter(({ uses }) => String(uses).startsWith("actions/checkout@"))
    .map((step) => String(step.with?.["fetch-depth"]));
  assert.deepEqual(depths, ["0"], "Give the typecheck job's checkout `with: fetch-depth: 0`.");
});
