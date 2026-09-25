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

test("CI's RPM smoke first removes the deb package our desktop build installed", async () => {
  // Upstream's deb is `paseo`. dpkg only warns about a package that is not installed,
  // so a stale name leaves the deb's files in place to hide what the RPM misses.
  const removed = workflow("ci.yml").jobs["desktop-tests-ubuntu"].steps.flatMap(({ run }) =>
    [...String(run ?? "").matchAll(/\bdpkg --remove (\S+)/g)].map(([, name]) => name),
  );
  assert.deepEqual(removed, [await debPackageName()]);
});
