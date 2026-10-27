// The hosted web app's deploy tooling (woowtech/README.md section 27): deploy-web.sh against
// stand-in tools, the Pages _headers, check-export.mjs on small exports, verify-live.mjs against a
// local server that serves an export the way Pages does, what Expo writes into index.html, and the
// web app's address and wrangler version across files. Nothing here builds, logs in or reaches
// the network.
//
//   node --test woowtech/web-deploy.test.mjs
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { importSource } from "./source-modules.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const DEPLOY_SCRIPT = "woowtech/scripts/deploy-web.sh";
const CHECK_EXPORT = path.join(repoRoot, "woowtech/web/check-export.mjs");
const HEADERS = path.join(repoRoot, "woowtech/web/_headers");
const ACCOUNT_ID = "9c27f623ee596e0b67be56263bcb1974";
const MiB = 1024 * 1024;

const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

// deploy-web.sh insists on Node 22. CI runs 22; this Mac's default is 24, with Homebrew's 22.
const NODE22 =
  process.versions.node.split(".")[0] === "22"
    ? process.execPath
    : "/opt/homebrew/opt/node@22/bin/node";
const needsNode22 = existsSync(NODE22) ? false : "no node 22";

test("only deploy:web deploys to Pages, and it runs deploy-web.sh", () => {
  // Upstream's deploy:web built dist and deployed it to a project named paseo-app: with our
  // login it would have made that project in WOOWTECH's account.
  const manifests = [
    "package.json",
    ...readJson("package.json").workspaces.map((dir) => `${dir}/package.json`),
  ];
  const deploying = manifests.flatMap((manifest) =>
    Object.entries(readJson(manifest).scripts ?? {})
      .filter(([, script]) => /paseo-app|pages deploy/.test(script))
      .map(([name, script]) => `${manifest} ${name}: ${script}`),
  );
  assert.deepEqual(deploying, []);
  assert.equal(
    readJson("packages/app/package.json").scripts["deploy:web"],
    "bash ../../woowtech/scripts/deploy-web.sh",
  );
});

test("deploy-web.sh parses with this machine's /bin/bash and with bash", () => {
  // macOS ships bash 3.2 as /bin/bash; CI has bash 5.
  for (const shell of ["/bin/bash", "bash"]) {
    const result = spawnSync(shell, ["-n", path.join(repoRoot, DEPLOY_SCRIPT)], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
  }
});

// --- deploy-web.sh against stand-in tools ---

const ENTRY = "_expo/static/js/web/index-0123456789abcdef.js";
const BUNDLE =
  'const report="https://reports.woowtech.io/v1/ai-content-reports",relay="relay.woowtech.io:443",' +
  'web="https://smart.woowtech.io",name="woowtech smart";\n';
const INDEX_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>woowtech smart</title></head>' +
  `<body><div id="root"></div><script src="/${ENTRY}" defer></script>\n</body></html>\n`;
const NO_SINKS = { "eval(": 0, "new Function(": 0, "importScripts(": 0, serviceWorker: 0 };
const BASELINE = {
  origins: ["https://reports.woowtech.io", "https://smart.woowtech.io"],
  scriptUrls: [],
  sinks: NO_SINKS,
};
const OWNER_LOGIN = {
  loggedIn: true,
  authType: "OAuth Token",
  email: "owner@example.invalid",
  accounts: [{ id: ACCOUNT_ID, name: "WOOWTECH" }],
  tokenPermissions: ["account:read", "user:read", "pages:write", "offline_access"],
};

/** Writes a small export: index.html, the entry bundle and two assets, plus `files` (null deletes). */
function writeExport(dir, { files = {}, bundle = BUNDLE, headers = true } = {}) {
  const contents = {
    "index.html": INDEX_HTML,
    [ENTRY]: bundle,
    "manifest.json": "{}\n",
    "assets/icon.png": "not really a png\n",
    ...(headers ? { _headers: readFileSync(HEADERS, "utf8") } : {}),
    ...files,
  };
  for (const [relative, content] of Object.entries(contents)) {
    const file = path.join(dir, relative);
    if (content === null) {
      rmSync(file, { force: true });
      continue;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

// The stand-in tools are POSIX sh: node takes a second to start on a busy 8 GB Mac. Each one logs
// a CALL line, then ARG, CWD, ENV and count lines; readCalls() turns them back into objects.

// Logs the variables in `names` that are set, as `ENV name=value` lines.
const SH_LOG_ENV = (names) => `for name in ${names.join(" ")}; do
    eval "isset=\\\${$name+set} value=\\\${$name-}"
    if [ "$isset" = set ]; then printf 'ENV %s=%s\\n' "$name" "$value"; fi
  done`;

// wrangler: records each call (arguments, working directory, the Cloudflare environment) and
// answers like wrangler 4.149.0 does with --json. FAKE_* variables change the answers.
const FAKE_WRANGLER = `#!/bin/sh
log="$FAKE_LOG/wrangler.log"
deployed="$FAKE_LOG/wrangler-deployed"
{
  printf 'CALL\\n'
  for arg in "$@"; do printf 'ARG %s\\n' "$arg"; done
  printf 'CWD %s\\n' "$PWD"
  printf 'CWD_ENTRIES %s\\n' "$(ls -A . | wc -l | tr -d ' ')"
  if [ -n "\${WRANGLER_CACHE_DIR:-}" ] && [ -d "$WRANGLER_CACHE_DIR" ]; then
    printf 'CACHE_ENTRIES %s\\n' "$(ls -A "$WRANGLER_CACHE_DIR" | wc -l | tr -d ' ')"
  fi
  ${SH_LOG_ENV([
    "CLOUDFLARE_ACCOUNT_ID",
    "XDG_CONFIG_HOME",
    "WRANGLER_CACHE_DIR",
    "WRANGLER_SEND_METRICS",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
    "CF_API_TOKEN",
    "CF_ACCOUNT_ID",
  ])}
} >>"$log"
login='${JSON.stringify(OWNER_LOGIN)}'
projects='[{"Project Name":"woowtech-smart-web","Project Domains":"woowtech-smart-web.pages.dev"}]'
case "$*" in
  --version) echo "\${FAKE_WRANGLER_VERSION:-4.149.0}"; exit 0 ;;
  "whoami --json") printf '%s\\n' "\${FAKE_WHOAMI:-$login}"; exit "\${FAKE_WHOAMI_EXIT:-0}" ;;
  "pages project list --json") printf '%s\\n' "\${FAKE_PROJECTS:-$projects}"; exit 0 ;;
esac
if [ "$1 $2" = "pages deploy" ]; then
  branch=""
  hash=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch) branch=$2 ;;
      --commit-hash) hash=$2 ;;
    esac
    shift
  done
  printf '%s %s\\n' "$branch" "\${FAKE_DEPLOYED_SHA:-$hash}" >"$deployed"
  exit "\${FAKE_DEPLOY_EXIT:-0}"
fi
if [ "$1 $2 $3" = "pages deployment list" ]; then
  if [ ! -f "$deployed" ]; then printf '%s\\n' "\${FAKE_PREVIOUS:-[]}"; exit 0; fi
  read -r branch hash <"$deployed"
  environment=Preview
  if [ "$branch" = main ]; then environment=Production; fi
  short=$(printf '%s' "$hash" | cut -c 1-7)
  printf '[{"Id":"d1","Environment":"%s","Branch":"%s","Source":"%s","Deployment":"https://0123abcd.woowtech-smart-web.pages.dev","Status":"now"}]\\n' "$environment" "$branch" "$short"
fi
exit 0
`;

// heavy.sh: records its arguments and runs the command after "run <label> --", unless
// FAKE_HEAVY_EXIT says how it ends instead.
const FAKE_HEAVY = `#!/bin/sh
{
  printf 'CALL\\n'
  for arg in "$@"; do printf 'ARG %s\\n' "$arg"; done
} >>"$FAKE_LOG/heavy.log"
if [ -n "\${FAKE_HEAVY_EXIT:-}" ]; then exit "$FAKE_HEAVY_EXIT"; fi
shift 3
exec "$@"
`;

// npm: records its arguments; \`ci\` makes node_modules where --prefix says, as the real one does.
const FAKE_NPM = `#!/bin/sh
{
  printf 'CALL\\n'
  for arg in "$@"; do printf 'ARG %s\\n' "$arg"; done
} >>"$FAKE_LOG/npm.log"
prefix=$PWD
previous=""
for arg in "$@"; do
  if [ "$previous" = --prefix ]; then prefix=$arg; fi
  previous=$arg
done
for arg in "$@"; do
  if [ "$arg" = ci ]; then mkdir -p "$prefix/node_modules"; fi
done
exit 0
`;

// npx: the build's \`npx expo export\`. Records its arguments, directory and the build's
// environment, then copies FAKE_TEMPLATE to --output-dir instead of building (FAKE_SPARSE adds a
// 26 MiB sparse file).
const FAKE_NPX = `#!/bin/sh
{
  printf 'CALL\\n'
  for arg in "$@"; do printf 'ARG %s\\n' "$arg"; done
  printf 'CWD %s\\n' "$PWD"
  ${SH_LOG_ENV([
    "APP_VARIANT",
    "WOOWTECH_AI_CONTENT_REPORT_URL",
    "NODE_OPTIONS",
    "EXPO_NO_TELEMETRY",
    "EXPO_PUBLIC_LOCAL_DAEMON",
    "EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL",
    "PASEO_WEB_PLATFORM",
    "PASEO_FDROID_BUILD",
    "PASEO_PROFILE_BUILD",
    "CLOUDFLARE_API_TOKEN",
  ])}
} >>"$FAKE_LOG/npx.log"
out=""
previous=""
for arg in "$@"; do
  if [ "$previous" = --output-dir ]; then out=$arg; fi
  previous=$arg
done
if [ "$1 $2" != "expo export" ] || [ -z "$out" ]; then
  echo "stand-in npx: not an export: $*" >&2
  exit 1
fi
mkdir -p "$out"
cp -R "$FAKE_TEMPLATE/." "$out/"
if [ -n "\${FAKE_SPARSE:-}" ]; then
  dd if=/dev/zero of="$out/$FAKE_SPARSE" bs=1 count=0 seek=27262976 2>/dev/null
fi
exit 0
`;

// verify-live.mjs in the fixture repository: records how deploy-web.sh calls it.
const FAKE_VERIFY = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_LOG + "/verify.jsonl", JSON.stringify({ args: process.argv.slice(2) }) + "\\n");
process.exit(Number(process.env.FAKE_VERIFY_EXIT ?? 0));
`;

function git(cwd, args, env) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function writeTool(file, source) {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

/**
 * A repository with deploy-web.sh, check-export.mjs and _headers from this checkout, a stand-in
 * verify-live.mjs, a baseline that fits the stand-in export, and a bare origin it is pushed to.
 * `linked` adds a linked worktree of it, where the script then runs.
 */
function deployFixture(t, { linked = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "woowtech-deploy-web-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(
    ["home", "bin", "log", "tmp", "template", "repo"].map((name) => [name, path.join(root, name)]),
  );
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const gitEnv = { PATH: process.env.PATH, HOME: dirs.home, GIT_CONFIG_NOSYSTEM: "1" };
  const { repo } = dirs;
  const files = {
    [DEPLOY_SCRIPT]: read(DEPLOY_SCRIPT),
    "woowtech/web/check-export.mjs": read("woowtech/web/check-export.mjs"),
    "woowtech/web/_headers": read("woowtech/web/_headers"),
    "woowtech/web/export-baseline.json": `${JSON.stringify(BASELINE, null, 2)}\n`,
    "woowtech/web/verify-live.mjs": FAKE_VERIFY,
    "packages/app/package.json": '{ "name": "@getpaseo/app" }\n',
    "package-lock.json": '{ "lockfileVersion": 3 }\n',
    ".gitignore": "node_modules/\n.env*\n",
  };
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
    writeFileSync(path.join(repo, relative), content);
  }
  chmodSync(path.join(repo, DEPLOY_SCRIPT), 0o755);
  git(repo, ["init", "-q", "-b", "main"], gitEnv);
  git(repo, ["add", "-A"], gitEnv);
  const identity = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"];
  git(repo, [...identity, "commit", "-q", "-m", "Ship the web app"], gitEnv);
  git(root, ["init", "-q", "--bare", "origin.git"], gitEnv);
  git(repo, ["remote", "add", "origin", path.join(root, "origin.git")], gitEnv);
  git(repo, ["push", "-q", "origin", "main"], gitEnv);
  let checkout = repo;
  if (linked) {
    checkout = path.join(root, "deploy");
    git(repo, ["worktree", "add", "-q", "--detach", checkout, "HEAD"], gitEnv);
  }
  symlinkSync(NODE22, path.join(dirs.bin, "node"));
  writeTool(path.join(dirs.bin, "wrangler"), FAKE_WRANGLER);
  writeTool(path.join(dirs.bin, "heavy.sh"), FAKE_HEAVY);
  writeTool(path.join(dirs.bin, "npm"), FAKE_NPM);
  writeTool(path.join(dirs.bin, "npx"), FAKE_NPX);
  writeExport(dirs.template, { headers: false });
  const sha = git(repo, ["rev-parse", "HEAD"], gitEnv);
  const short = git(repo, ["rev-parse", "--short=12", "HEAD"], gitEnv);
  const out = path.join(dirs.home, ".local/share/woowtech-smart/web-dist", short);
  return { ...dirs, root, checkout, gitEnv, identity, sha, out };
}

/** A stand-in's calls: { args, cwd, cwdEntries, cacheEntries, env } from its CALL/ARG/... lines. */
function readCalls(fixture, name) {
  const file = path.join(fixture.log, name);
  if (!existsSync(file)) return [];
  const calls = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const [, kind, rest] = /^([A-Z_]+) ?(.*)$/.exec(line) ?? [];
    if (kind === "CALL") calls.push({ args: [], env: {} });
    const call = calls.at(-1);
    if (kind === "ARG") call.args.push(rest);
    else if (kind === "CWD") call.cwd = rest;
    else if (kind === "CWD_ENTRIES") call.cwdEntries = Number(rest);
    else if (kind === "CACHE_ENTRIES") call.cacheEntries = Number(rest);
    else if (kind === "ENV")
      call.env[rest.slice(0, rest.indexOf("="))] = rest.slice(rest.indexOf("=") + 1);
  }
  return calls;
}

function readJsonLines(fixture, name) {
  const file = path.join(fixture.log, name);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

/** Runs deploy-web.sh in the fixture with only the variables it needs, and what the tools saw. */
function deploy(fixture, { args = [], env = {}, shell = null } = {}) {
  for (const name of readdirSync(fixture.log))
    rmSync(path.join(fixture.log, name), { force: true });
  const fullEnv = {
    PATH: `${fixture.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: fixture.home,
    TMPDIR: fixture.tmp,
    GIT_CONFIG_NOSYSTEM: "1",
    FAKE_LOG: fixture.log,
    FAKE_TEMPLATE: fixture.template,
    WOOW_WRANGLER: path.join(fixture.bin, "wrangler"),
    WOOW_HEAVY: path.join(fixture.bin, "heavy.sh"),
    WOOW_NODE22_BIN: fixture.bin,
    WOOW_VERIFY_WAIT: "0",
    ...env,
  };
  for (const [name, value] of Object.entries(fullEnv))
    if (value === undefined) delete fullEnv[name];
  const script = path.join(fixture.checkout, DEPLOY_SCRIPT);
  const result = shell
    ? spawnSync(shell, [script, ...args], { env: fullEnv, encoding: "utf8" })
    : spawnSync(script, args, { env: fullEnv, encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
    wrangler: readCalls(fixture, "wrangler.log"),
    heavy: readCalls(fixture, "heavy.log"),
    npm: readCalls(fixture, "npm.log"),
    npx: readCalls(fixture, "npx.log"),
    verify: readJsonLines(fixture, "verify.jsonl"),
  };
}

const uploads = (run) =>
  run.wrangler.filter((call) => call.args[0] === "pages" && call.args[1] === "deploy");
const builds = (run) => run.heavy.filter((call) => call.args.join(" ").includes("expo export"));
const npmCi = (run) => run.npm.filter((call) => call.args.includes("ci"));

function listTree(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? listTree(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
    .sort();
}

function assertRefused(run, status, pattern) {
  assert.equal(run.status, status, run.output);
  assert.match(run.output, pattern);
  assert.deepEqual(uploads(run), [], "it uploaded anyway");
}

test(
  "a dry run builds through heavy.sh with the production settings and runs no wrangler",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const run = deploy(fixture, {
      env: {
        WOOW_DRY_RUN: "1",
        // A caller's local daemon, dev label and Electron platform must not reach the bundle.
        EXPO_PUBLIC_LOCAL_DAEMON: "localhost:6768",
        EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL: "dev",
        PASEO_WEB_PLATFORM: "electron",
        CLOUDFLARE_API_TOKEN: "not-the-owner-login",
      },
    });

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.wrangler, [], "a dry run never runs wrangler");
    assert.deepEqual(npmCi(run), [], "no npm ci without WOOW_FRESH_INSTALL");
    assert.equal(builds(run).length, 1);
    assert.deepEqual(
      builds(run)[0].args.slice(0, 3),
      ["run", "web-export", "--"],
      "heavy.sh's default label",
    );
    // The build command line, run as written, with npm and npx standing in.
    assert.deepEqual(
      run.npm.map((call) => call.args),
      [["--prefix", fixture.checkout, "run", "build:app-deps"]],
    );
    assert.equal(run.npx.length, 1);
    const [exporter] = run.npx;
    assert.deepEqual(exporter.args, [
      "expo",
      "export",
      "--platform",
      "web",
      "--output-dir",
      fixture.out,
      "--clear",
      "--max-workers",
      "2",
    ]);
    assert.equal(exporter.cwd, path.join(fixture.checkout, "packages/app"));
    assert.equal(exporter.env.APP_VARIANT, "production");
    assert.equal(
      exporter.env.WOOWTECH_AI_CONTENT_REPORT_URL,
      "https://reports.woowtech.io/v1/ai-content-reports",
    );
    assert.equal(exporter.env.NODE_OPTIONS, "--max-old-space-size=4096");
    assert.equal(exporter.env.EXPO_NO_TELEMETRY, "1");
    for (const name of [
      "EXPO_PUBLIC_LOCAL_DAEMON",
      "EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL",
      "PASEO_WEB_PLATFORM",
      "CLOUDFLARE_API_TOKEN",
    ]) {
      assert.equal(exporter.env[name], undefined, `${name} reached the build`);
    }
    // The export plus _headers: deploy-web.sh writes its build record next to OUT, not into it.
    assert.deepEqual(listTree(fixture.out), [...listTree(fixture.template), "_headers"].sort());
    assert.ok(existsSync(`${fixture.out}.build.json`));
    assert.equal(
      readFileSync(path.join(fixture.out, "_headers"), "utf8"),
      readFileSync(HEADERS, "utf8"),
    );
  },
);

test(
  "WOOW_HEAVY_LABEL names heavy.sh's label, as the local E2E needs",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const run = deploy(fixture, { env: { WOOW_DRY_RUN: "1", WOOW_HEAVY_LABEL: "web1026-e2e" } });

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(builds(run)[0].args.slice(0, 2), ["run", "web1026-e2e"]);
  },
);

/** Every wrangler call: WOOWTECH's account, the wrangler-pages login, an empty cache and directory. */
function assertWranglerEnvironment(fixture, run) {
  assert.ok(run.wrangler.length > 0, "wrangler never ran");
  for (const call of run.wrangler) {
    const where = call.args.join(" ");
    assert.equal(call.env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT_ID, where);
    assert.equal(
      call.env.XDG_CONFIG_HOME,
      path.join(fixture.home, ".local/share/woowtech-smart/wrangler-pages"),
      where,
    );
    assert.equal(
      call.env.CLOUDFLARE_API_TOKEN,
      undefined,
      `${where}: the caller's API token reached wrangler`,
    );
    assert.equal(call.env.CF_API_TOKEN, undefined, where);
    assert.equal(call.env.CLOUDFLARE_API_KEY, undefined, where);
    assert.equal(call.env.WRANGLER_SEND_METRICS, "false", where);
    assert.ok(
      call.env.WRANGLER_CACHE_DIR.startsWith(`${fixture.tmp}/`),
      `${where}: cache ${call.env.WRANGLER_CACHE_DIR}`,
    );
    assert.equal(call.cacheEntries, 0, `${where}: the cache directory was not empty`);
    assert.ok(call.cwd.startsWith(`${fixture.tmp}/`), `${where}: ran in ${call.cwd}`);
    assert.equal(call.cwdEntries, 0, `${where}: its directory was not empty`);
  }
  assert.equal(
    existsSync(run.wrangler[0].env.WRANGLER_CACHE_DIR),
    false,
    "the cache directory was left behind",
  );
}

test(
  "a production deploy from an agent: checks, uploads, verifies, and stays logged in",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const run = deploy(fixture, {
      env: { CLOUDFLARE_API_TOKEN: "not-the-owner-login", CF_API_TOKEN: "old-name" },
    });

    assert.equal(run.status, 0, run.output);
    assertWranglerEnvironment(fixture, run);
    assert.deepEqual(
      run.wrangler.map((call) => call.args.slice(0, 3).join(" ")),
      [
        "--version",
        "whoami --json",
        "pages project list",
        "pages deployment list",
        `pages deploy ${fixture.out}`,
        "pages deployment list",
      ],
    );
    assert.deepEqual(uploads(run)[0].args, [
      "pages",
      "deploy",
      fixture.out,
      "--project-name",
      "woowtech-smart-web",
      "--branch",
      "main",
      "--commit-hash",
      fixture.sha,
      "--commit-message",
      "Ship the web app",
      "--commit-dirty=false",
    ]);
    // O12: the login stays for the next deploy.
    assert.deepEqual(
      run.wrangler.filter((call) => call.args[0] === "logout"),
      [],
    );
    assert.match(run.output, /without a confirmation/);
    // No custom domain on the project yet: the check runs against pages.dev.
    assert.deepEqual(run.verify, [{ args: ["https://woowtech-smart-web.pages.dev", fixture.out] }]);
  },
);

test(
  "once smart.woowtech.io is on the project, production is checked there",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const projects = [
      {
        "Project Name": "woowtech-smart-web",
        "Project Domains": "woowtech-smart-web.pages.dev, smart.woowtech.io",
      },
    ];
    const run = deploy(fixture, { env: { FAKE_PROJECTS: JSON.stringify(projects) } });

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.verify, [{ args: ["https://smart.woowtech.io", fixture.out] }]);
  },
);

test(
  "--preview uploads to the preview branch and checks that deployment, Access allowed",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    // A terminal answer is never asked for in preview.
    const run = deploy(fixture, { args: ["--preview"], env: { WOOW_TTY: "/nonexistent" } });

    assert.equal(run.status, 0, run.output);
    assert.equal(uploads(run)[0].args[uploads(run)[0].args.indexOf("--branch") + 1], "preview");
    assert.deepEqual(run.verify, [
      { args: ["https://0123abcd.woowtech-smart-web.pages.dev", fixture.out, "--allow-access"] },
    ]);
    assert.deepEqual(
      run.wrangler.filter((call) => call.args[0] === "logout"),
      [],
    );
  },
);

test("/bin/bash runs a production deploy, prompt and all", { skip: needsNode22 }, (t) => {
  const fixture = deployFixture(t);
  const answer = path.join(fixture.root, "answer");
  writeFileSync(answer, `${fixture.sha.slice(0, 7)}\n`);
  const run = deploy(fixture, { shell: "/bin/bash", env: { WOOW_TTY: answer } });

  assert.equal(run.status, 0, run.output);
  assert.equal(uploads(run).length, 1);
  assert.match(run.output, /production has no deployment yet/);
});

test("WOOW_CONFIRM_SHA confirms the commit without a prompt", { skip: needsNode22 }, (t) => {
  const fixture = deployFixture(t);
  const run = deploy(fixture, { env: { WOOW_CONFIRM_SHA: fixture.sha.slice(0, 9) } });

  assert.equal(run.status, 0, run.output);
  assert.equal(uploads(run).length, 1);
});

test(
  "the confirmation shows what production runs now and what changed since",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const previous = fixture.sha;
    writeFileSync(path.join(fixture.repo, "packages/app/added.txt"), "new\n");
    git(fixture.repo, ["add", "-A"], fixture.gitEnv);
    git(fixture.repo, [...fixture.identity, "commit", "-q", "-m", "Add a file"], fixture.gitEnv);
    git(fixture.repo, ["push", "-q", "origin", "main"], fixture.gitEnv);
    const live = [
      {
        Environment: "Production",
        Branch: "main",
        Source: previous.slice(0, 7),
        Deployment: "https://x.pages.dev",
      },
    ];
    const run = deploy(fixture, { env: { FAKE_PREVIOUS: JSON.stringify(live) } });

    assert.equal(run.status, 0, run.output);
    assert.match(
      run.output,
      new RegExp(`production runs ${previous.slice(0, 7)} now; changes since then`),
    );
    assert.match(run.output, /packages\/app\/added\.txt/);
  },
);

test(
  "WOOW_FRESH_INSTALL=1 runs npm ci once per lockfile, and a later deploy reuses the export",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t, { linked: true });
    const first = deploy(fixture, { env: { WOOW_DRY_RUN: "1", WOOW_FRESH_INSTALL: "1" } });

    assert.equal(first.status, 0, first.output);
    assert.deepEqual(
      npmCi(first).map((call) => call.args),
      [["--prefix", fixture.checkout, "ci"]],
    );
    assert.deepEqual(first.heavy[0].args, [
      "run",
      "web-export",
      "--",
      "npm",
      "--prefix",
      fixture.checkout,
      "ci",
    ]);
    assert.equal(builds(first).length, 1);
    const stamp = readFileSync(
      path.join(fixture.checkout, "node_modules/.woow-npm-ci"),
      "utf8",
    ).trim();
    assert.match(stamp, /^[0-9a-f]{64}$/);
    const info = JSON.parse(readFileSync(`${fixture.out}.build.json`, "utf8"));
    assert.deepEqual(
      [info.sha, info.lockfileSha256, info.freshInstall, info.dirty],
      [fixture.sha, stamp, true, false],
    );

    const second = deploy(fixture, { env: { WOOW_FRESH_INSTALL: "1" } });
    assert.equal(second.status, 0, second.output);
    assert.deepEqual(npmCi(second), [], "npm ci again for the same lockfile");
    assert.deepEqual(builds(second), [], "built again instead of reusing the export");
    assert.match(second.output, /using the export already built/);
    assert.equal(uploads(second).length, 1);
  },
);

test(
  "a deploy without WOOW_FRESH_INSTALL reuses a dry run's export but never a dirty one",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    assert.equal(deploy(fixture, { env: { WOOW_DRY_RUN: "1" } }).status, 0);
    const reused = deploy(fixture);
    assert.equal(reused.status, 0, reused.output);
    assert.deepEqual(builds(reused), []);

    writeFileSync(path.join(fixture.repo, "packages/app/dirty.txt"), "local\n");
    const dirty = deploy(fixture, { env: { WOOW_DRY_RUN: "1", WOOW_ALLOW_DIRTY: "1" } });
    assert.equal(dirty.status, 0, dirty.output);
    assert.equal(JSON.parse(readFileSync(`${fixture.out}.build.json`, "utf8")).dirty, true);
    rmSync(path.join(fixture.repo, "packages/app/dirty.txt"));
    const rebuilt = deploy(fixture);
    assert.equal(rebuilt.status, 0, rebuilt.output);
    assert.equal(builds(rebuilt).length, 1, "a dirty dry run's export was uploaded");
  },
);

test(
  "an unclean, unpushed or .env-carrying checkout is refused before the build",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    writeFileSync(path.join(fixture.repo, "stray.txt"), "x\n");
    const dirty = deploy(fixture);
    assertRefused(dirty, 2, /the worktree has changes/);
    assert.deepEqual(builds(dirty), []);
    rmSync(path.join(fixture.repo, "stray.txt"));

    writeFileSync(
      path.join(fixture.repo, "packages/app/.env"),
      "EXPO_PUBLIC_LOCAL_DAEMON=localhost:6768\n",
    );
    assertRefused(deploy(fixture), 2, /packages\/app\/\.env exists/);
    rmSync(path.join(fixture.repo, "packages/app/.env"));

    git(
      fixture.repo,
      [...fixture.identity, "commit", "-q", "--allow-empty", "-m", "Not pushed"],
      fixture.gitEnv,
    );
    assertRefused(deploy(fixture), 2, /is on no origin branch/);
  },
);

test("the switches refuse what they are not for", { skip: needsNode22 }, (t) => {
  const fixture = deployFixture(t);
  // npm ci would replace the main checkout's node_modules.
  assertRefused(deploy(fixture, { env: { WOOW_FRESH_INSTALL: "1" } }), 2, /use a linked worktree/);
  assertRefused(deploy(fixture, { env: { WOOW_ALLOW_DIRTY: "1" } }), 2, /only for WOOW_DRY_RUN=1/);
  // WOOW_TTY stands in for the terminal only with a stand-in wrangler.
  const realWrangler = deploy(fixture, {
    env: { WOOW_WRANGLER: undefined, WOOW_TTY: "/dev/null" },
  });
  assertRefused(realWrangler, 2, /WOOW_TTY only works with a stand-in wrangler/);
  assert.deepEqual(builds(realWrangler), []);
  assertRefused(
    deploy(fixture, { env: { WOOW_DRY_RUN: "yes" } }),
    2,
    /WOOW_DRY_RUN must be 1 or unset/,
  );
});

test("a wrong confirmation, or one it cannot read, uploads nothing", { skip: needsNode22 }, (t) => {
  const fixture = deployFixture(t);
  const answer = path.join(fixture.root, "answer");
  writeFileSync(answer, "0000000\n");
  assertRefused(
    deploy(fixture, { env: { WOOW_TTY: answer } }),
    2,
    /is not [0-9a-f]{7}: nothing was uploaded/,
  );
  assertRefused(
    deploy(fixture, { env: { WOOW_TTY: "/nonexistent" } }),
    2,
    /cannot read the confirmation/,
  );
  assertRefused(deploy(fixture, { env: { WOOW_CONFIRM_SHA: "0000000" } }), 2, /is not this commit/);
  assertRefused(
    deploy(fixture, { env: { WOOW_CONFIRM_SHA: fixture.sha.slice(0, 6) } }),
    2,
    /at least 7/,
  );
});

test(
  "a login that is missing, too broad or for another account is refused, and so is another wrangler",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const login = (changes) => JSON.stringify({ ...OWNER_LOGIN, ...changes });
    const cases = [
      [{ FAKE_WHOAMI: '{"loggedIn":false}', FAKE_WHOAMI_EXIT: "1" }, /not logged in/],
      [
        {
          FAKE_WHOAMI: login({
            tokenPermissions: [...OWNER_LOGIN.tokenPermissions, "workers_scripts:write"],
          }),
        },
        /scopes beyond .*workers_scripts:write/,
      ],
      [
        { FAKE_WHOAMI: login({ accounts: [{ id: "0123456789abcdef0123456789abcdef" }] }) },
        /cannot use the WOOWTECH account/,
      ],
      [{ FAKE_WHOAMI: login({ authType: "User API Token" }) }, /not the owner OAuth login/],
      [{ FAKE_PROJECTS: "[]" }, /has no Pages project woowtech-smart-web/],
      [{ FAKE_WRANGLER_VERSION: "4.105.0" }, /wrangler is "4\.105\.0", not 4\.149\.0/],
    ];
    for (const [env, pattern] of cases) assertRefused(deploy(fixture, { env }), 4, pattern);

    // wrangler would read a login in ~/.wrangler instead of wrangler-pages.
    mkdirSync(path.join(fixture.home, ".wrangler"));
    assertRefused(deploy(fixture), 4, /\.wrangler exists/);
  },
);

test("an export check-export.mjs rejects is never uploaded", { skip: needsNode22 }, (t) => {
  const fixture = deployFixture(t);
  const cases = [
    [
      { "index.html": INDEX_HTML.replace("</body>", "<script>window.x=1</script></body>") },
      /inline <script>/,
    ],
    [{ "404.html": "<p>not found</p>\n" }, /404\.html must not be in the export/],
    [{ "other.html": "<p>other</p>\n" }, /2 HTML files/],
    [{ [ENTRY]: `${BUNDLE}const upstream="https://app.paseo.sh";\n` }, /"app\.paseo\.sh" is in/],
  ];
  for (const [files, pattern] of cases) {
    rmSync(fixture.template, { recursive: true, force: true });
    writeExport(fixture.template, { headers: false, files });
    // Build again: the record next to the export would let the next run reuse this one.
    rmSync(`${fixture.out}.build.json`, { force: true });
    assertRefused(deploy(fixture), 3, pattern);
  }
  rmSync(fixture.template, { recursive: true, force: true });
  writeExport(fixture.template, { headers: false });
  rmSync(`${fixture.out}.build.json`, { force: true });
  // Pages takes files up to 25 MiB.
  assertRefused(
    deploy(fixture, { env: { FAKE_SPARSE: "assets/huge.bin" } }),
    3,
    /over Pages' 25 MiB limit/,
  );
});

test(
  "a failed upload, an old deployment or a site that does not match exits 5 or 6",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const failed = deploy(fixture, { env: { FAKE_DEPLOY_EXIT: "1" } });
    assert.equal(failed.status, 5, failed.output);

    const stale = deploy(fixture, { env: { FAKE_DEPLOYED_SHA: "0".repeat(40) } });
    assert.equal(stale.status, 6, stale.output);
    assert.match(stale.output, /Rollback to this deployment/);

    const mismatch = deploy(fixture, { env: { FAKE_VERIFY_EXIT: "1", WOOW_VERIFY_ATTEMPTS: "2" } });
    assert.equal(mismatch.status, 6, mismatch.output);
    assert.equal(mismatch.verify.length, 2, "verify-live.mjs was not retried");
    assert.match(mismatch.output, /does not serve this export/);
    for (const run of [failed, stale, mismatch]) {
      assert.deepEqual(
        run.wrangler.filter((call) => call.args[0] === "logout"),
        [],
      );
    }
  },
);

test("heavy.sh giving up exits 75", { skip: needsNode22 }, (t) => {
  const fixture = deployFixture(t);
  const run = deploy(fixture, { env: { WOOW_DRY_RUN: "1", FAKE_HEAVY_EXIT: "75" } });
  assert.equal(run.status, 75, run.output);
});

// --- _headers ---

/** _headers as { pattern: [{ name, value } | { remove }] }, names in lowercase. */
function parseHeaders(text) {
  const rules = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = [];
      rules.set(line.trim(), current);
    } else if (line.trim().startsWith("!")) {
      current.push({ remove: line.trim().slice(1).trim().toLowerCase() });
    } else {
      const colon = line.indexOf(":");
      current.push({
        name: line.slice(0, colon).trim().toLowerCase(),
        value: line.slice(colon + 1).trim(),
      });
    }
  }
  return rules;
}

test("_headers keeps the site unframeable and scripts on this origin, and lets direct connections through", () => {
  const text = readFileSync(HEADERS, "utf8");
  const rules = parseHeaders(text);
  const root = new Map(
    (rules.get("/*") ?? []).filter((entry) => entry.name).map((entry) => [entry.name, entry.value]),
  );
  const csp = new Map(
    root
      .get("content-security-policy")
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .map(([name, ...sources]) => [name, sources]),
  );
  for (const directive of ["object-src", "base-uri", "form-action", "frame-ancestors"]) {
    assert.deepEqual(csp.get(directive), ["'none'"], directive);
  }
  // No host or scheme source that could load a third party's script. O1 (2026-10-27): the parity
  // policy, with 'unsafe-inline' and 'unsafe-eval' as app.paseo.sh needs (README section 27).
  const scriptSources = csp.get("script-src");
  const allowed =
    /^(?:'self'|'unsafe-inline'|'unsafe-eval'|'wasm-unsafe-eval'|blob:|'sha(?:256|384|512)-[A-Za-z0-9+/=]+')$/;
  assert.deepEqual(
    scriptSources.filter((source) => !allowed.test(source)),
    [],
  );
  assert.ok(
    scriptSources.includes("'unsafe-inline'") && scriptSources.includes("'unsafe-eval'"),
    "O1 picked parity",
  );
  for (const scheme of ["https:", "wss:", "ws:"])
    assert.ok(csp.get("connect-src").includes(scheme), scheme);
  // It would turn ws://localhost into wss://, and direct connections fail.
  assert.doesNotMatch(text, /upgrade-insecure-requests/);
  assert.equal(root.get("x-frame-options"), "DENY");
  assert.match(root.get("strict-transport-security"), /^max-age=\d+$/);
  assert.equal(root.get("cross-origin-opener-policy"), "same-origin");
  // D3 and dictation need these; "()" would turn them off for the site.
  const permissions = new Map(
    root
      .get("permissions-policy")
      .split(",")
      .map((entry) => entry.trim().split("=")),
  );
  for (const feature of [
    "microphone",
    "local-network",
    "loopback-network",
    "local-network-access",
  ]) {
    assert.notEqual(permissions.get(feature), "()", feature);
  }
  // no-transform on HTML stops Cloudflare injecting scripts; JS keeps its compression.
  assert.match(root.get("cache-control"), /\bno-transform\b/);
  assert.ok((rules.get("/_expo/static/*") ?? []).some((entry) => entry.remove === "cache-control"));
  // Only the incident version of _headers clears what browsers stored (README section 27).
  assert.doesNotMatch(text, /clear-site-data/i);
  assert.ok(rules.size <= 100, "Pages reads at most 100 rules");
  assert.deepEqual(
    text.split("\n").filter((line) => line.length > 2000),
    [],
  );
});

test("packages/app/public adds nothing that changes how Pages serves the export", () => {
  // public/ is copied into every web build: Pages files belong in woowtech/web.
  for (const name of ["_headers", "_redirects", "404.html", "_worker.js"]) {
    assert.equal(existsSync(path.join(repoRoot, "packages/app/public", name)), false, name);
  }
  assert.doesNotMatch(read("packages/app/public/index.html"), /<script/i);
});

/**
 * The text from `start` to the brace that closes the block opened by the first ") {" after it:
 * a function's body, not the destructured parameters before it. Braces in strings count.
 */
function block(text, start) {
  const open = text.indexOf(") {", start);
  if (start === -1 || open === -1) throw new Error("no block there");
  let depth = 0;
  for (let at = open + 2; at < text.length; at += 1) {
    if (text[at] === "{") depth += 1;
    if (text[at] === "}") depth -= 1;
    if (depth === 0) return text.slice(start, at + 1);
  }
  throw new Error("unbalanced braces");
}

test("Expo's single-page export writes only external, deferred scripts into index.html", () => {
  // check-export.mjs checks the real index.html; this says why there is nothing else to expect.
  // Without line comments: one of them is a <script> template with an unclosed "${".
  const source = read(
    "node_modules/@expo/cli/build/src/start/server/metro/serializeHtml.js",
  ).replace(/^\s*\/\/.*$/gm, "");
  const start = source.indexOf("function htmlFromSerialAssets(");
  assert.notEqual(
    start,
    -1,
    "Expo no longer has htmlFromSerialAssets: check how it writes index.html",
  );
  const body = block(source, start);
  const tags = [...body.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
  const inline = tags.filter((tag) => !/^<script src="\$\{[^}]+\}" defer>$/.test(tag));
  assert.deepEqual(inline, ['<script type="module">']);
  assert.ok(
    block(body, body.indexOf("if (hydrate) {")).includes('<script type="module">'),
    "only for hydrate",
  );
  // hydrate is only for static and server output.
  assert.match(read("packages/app/app.config.js"), /\bweb:\s*\{[^}]*\boutput:\s*"single"/);
});

// --- check-export.mjs ---

function checkExport(t, { files, bundle, baseline = BASELINE, args = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "woowtech-check-export-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "export");
  writeExport(dir, { files, bundle });
  const baselineFile = path.join(root, "baseline.json");
  writeFileSync(baselineFile, `${JSON.stringify(baseline)}\n`);
  const result = spawnSync(
    process.execPath,
    [CHECK_EXPORT, dir, "--baseline", baselineFile, ...args],
    {
      encoding: "utf8",
    },
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, dir, baselineFile };
}

const withSinks = (sinks, extra = {}) => ({
  ...BASELINE,
  ...extra,
  sinks: { ...NO_SINKS, ...sinks },
});

test("check-export passes React Navigation's segments and Expo's worker loader", (t) => {
  const run = checkExport(t, {
    bundle: `${BUNDLE}i.segment=i.segment.replace(/\\/$/,'');importScripts(ASYNC_WORKER_BASE);\n`,
    baseline: withSinks({ "importScripts(": 1 }),
  });
  assert.equal(run.status, 0, run.output);
});

test("check-export fails a script URL the baseline does not list, such as expo-camera's jsQR", (t) => {
  const bundle = `${BUNDLE}const deps=['https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js'];\n`;
  const origins = [...BASELINE.origins, "https://cdn.jsdelivr.net"].sort();
  const unlisted = checkExport(t, { bundle, baseline: { ...BASELINE, origins } });
  assert.equal(unlisted.status, 1, unlisted.output);
  assert.match(
    unlisted.output,
    /script URLs not in the baseline: https:\/\/cdn\.jsdelivr\.net\/npm\/jsqr@1\.2\.0\/dist\/jsQR\.min\.js/,
  );
  const scriptUrls = ["https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js"];
  const listed = checkExport(t, { bundle, baseline: { ...BASELINE, origins, scriptUrls } });
  assert.equal(listed.status, 0, listed.output);
});

test("check-export fails while the baseline is empty", (t) => {
  const run = checkExport(t, { baseline: { origins: [], scriptUrls: [], sinks: {} } });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /not initialized/);
  // As committed, before the first real dry run.
  assert.deepEqual(readJson("woowtech/web/export-baseline.json"), {
    origins: [],
    scriptUrls: [],
    sinks: {},
  });
});

test("check-export fails a new service worker registration or a worker-like file", (t) => {
  const registers = checkExport(t, {
    bundle: `${BUNDLE}navigator.serviceWorker.register('/sw.js');\n`,
  });
  assert.equal(registers.status, 1, registers.output);
  assert.match(registers.output, /"serviceWorker" appears 1 times; the baseline allows 0/);
  for (const file of ["sw.js", "service-worker.js", "workbox-1a2b.js"]) {
    const run = checkExport(t, { files: { [file]: "self.addEventListener('fetch',()=>{});\n" } });
    assert.equal(run.status, 1, `${file}: ${run.output}`);
    assert.match(run.output, /named like a service worker/);
  }
  // Without serviceWorkerPath, expo-notifications' web code throws instead of registering one.
  assert.doesNotMatch(read("packages/app/app.config.js"), /serviceWorkerPath/);
});

test("check-export fails a new origin or one more eval(, and passes what --write-baseline wrote", (t) => {
  const origin = checkExport(t, {
    bundle: `${BUNDLE}fetch("https://collector.example.invalid/x");\n`,
  });
  assert.equal(origin.status, 1, origin.output);
  assert.match(origin.output, /origins not in the baseline: https:\/\/collector\.example\.invalid/);
  const evals = checkExport(t, { bundle: `${BUNDLE}eval(code);\n` });
  assert.equal(evals.status, 1, evals.output);
  assert.match(evals.output, /"eval\(" appears 1 times; the baseline allows 0/);

  const bundle = `${BUNDLE}eval(code);fetch("https://collector.example.invalid/x");\n`;
  const written = checkExport(t, { bundle, args: ["--write-baseline"] });
  assert.equal(written.status, 0, written.output);
  const baseline = JSON.parse(readFileSync(written.baselineFile, "utf8"));
  assert.deepEqual(baseline.sinks, { ...NO_SINKS, "eval(": 1 });
  const again = spawnSync(
    process.execPath,
    [CHECK_EXPORT, written.dir, "--baseline", written.baselineFile],
    {
      encoding: "utf8",
    },
  );
  assert.equal(again.status, 0, again.stdout + again.stderr);
});

test("check-export fails a second HTML file, a source map or a symlink", (t) => {
  for (const [files, pattern] of [
    [{ "help/index.html": "<p>help</p>\n" }, /2 HTML files/],
    [{ [`${ENTRY}.map`]: "{}\n" }, /source maps are not published/],
  ]) {
    const run = checkExport(t, { files });
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, pattern);
  }
  const linked = checkExport(t);
  symlinkSync("/etc/hosts", path.join(linked.dir, "hosts"));
  const withLink = spawnSync(
    process.execPath,
    [CHECK_EXPORT, linked.dir, "--baseline", linked.baselineFile],
    {
      encoding: "utf8",
    },
  );
  assert.equal(withLink.status, 1);
  assert.match(withLink.stderr, /hosts is a symlink/);
});

test("check-export fails a file over 25 MiB, using its size on disk", (t) => {
  const run = checkExport(t);
  const fd = openSync(path.join(run.dir, "assets/huge.bin"), "w");
  ftruncateSync(fd, 25 * MiB + 1);
  closeSync(fd);
  const again = spawnSync(
    process.execPath,
    [CHECK_EXPORT, run.dir, "--baseline", run.baselineFile],
    {
      encoding: "utf8",
    },
  );
  assert.equal(again.status, 1);
  assert.match(again.stderr, /assets\/huge\.bin is 25\.00 MiB, over Pages' 25 MiB limit/);
});

test("check-export wants the report receiver, the relay and the web app in the bundle", (t) => {
  const run = checkExport(t, {
    bundle: 'const name="woowtech smart";\n',
    baseline: withSinks({}, { origins: [] }),
  });
  assert.equal(run.status, 1, run.output);
  for (const needle of [
    "reports.woowtech.io/v1/ai-content-reports",
    "relay.woowtech.io",
    "smart.woowtech.io",
  ]) {
    assert.match(
      run.output,
      new RegExp(`does not contain "[^"]*${needle.replaceAll(".", "\\.")}`),
      needle,
    );
  }
});

// --- verify-live.mjs ---

const execFileAsync = promisify(execFile);
const VERIFY_LIVE = path.join(repoRoot, "woowtech/web/verify-live.mjs");

/** The headers a Pages-like server sends for `pathname`: _headers' rules in order, "! name" drops. */
function headersFor(rules, pathname) {
  const headers = new Map();
  for (const [pattern, entries] of rules) {
    const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : null;
    if (prefix === null ? pathname !== pattern : !pathname.startsWith(prefix)) continue;
    for (const entry of entries) {
      if (entry.remove) headers.delete(entry.remove);
      else headers.set(entry.name, entry.value);
    }
  }
  return headers;
}

function isFile(file) {
  return existsSync(file) && lstatSync(file).isFile();
}

/**
 * Serves `dir` on 127.0.0.1 as Pages serves a Direct Upload: files at their paths, index.html for
 * any other path (the SPA fallback, /_headers included), and _headers' rules on every answer.
 * `change(answer)` can alter { pathname, status, headers, body }, as a Worker route or the zone could.
 */
async function servePages(t, dir, change = () => {}) {
  const rules = parseHeaders(readFileSync(path.join(dir, "_headers"), "utf8"));
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.join(dir, pathname);
    const served = pathname !== "/_headers" && file.startsWith(`${dir}/`) && isFile(file);
    const answer = { pathname, status: 200, headers: headersFor(rules, pathname) };
    answer.headers.set(
      "content-type",
      served ? "application/octet-stream" : "text/html; charset=utf-8",
    );
    answer.body = readFileSync(served ? file : path.join(dir, "index.html"));
    change(answer);
    response.writeHead(answer.status, Object.fromEntries(answer.headers));
    response.end(answer.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function verifyLive(base, dir, args = []) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [VERIFY_LIVE, base, dir, ...args]);
    return { status: 0, summary: JSON.parse(stdout) };
  } catch (error) {
    return { status: error.code, summary: JSON.parse(error.stdout || "{}"), stderr: error.stderr };
  }
}

function exportFor(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "woowtech-verify-live-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeExport(dir);
  return dir;
}

test("verify-live passes a site that serves the export with its _headers", async (t) => {
  const dir = exportFor(t);
  const { status, summary } = await verifyLive(await servePages(t, dir), dir);
  assert.equal(status, 0, JSON.stringify(summary));
  assert.equal(summary.ok, true);
  assert.equal(summary.files, 3, "the entry bundle, manifest.json and the icon");
});

const injectScript = (answer) => {
  if (answer.pathname === "/") {
    answer.body = Buffer.from(
      String(answer.body).replace("</body>", '<script src="/cdn-cgi/x.js"></script></body>'),
    );
  }
};
const changeBundle = (answer) => {
  if (answer.pathname === `/${ENTRY}`) answer.body = Buffer.from(`${answer.body}x;`);
};
const dropFallbackCsp = (answer) => {
  if (answer.pathname === "/settings/general") answer.headers.delete("content-security-policy");
};
const transformScripts = (answer) => {
  if (answer.pathname.startsWith("/_expo/static/"))
    answer.headers.set("cache-control", "public, no-transform");
};

test("verify-live fails what a Worker route or the zone could change", async (t) => {
  const dir = exportFor(t);
  for (const [change, pattern] of [
    [injectScript, /has \/cdn-cgi\/ \(injected into the page\)/],
    [changeBundle, /index-0123456789abcdef\.js: the content is not the exported file's/],
    [dropFallbackCsp, /settings\/general: content-security-policy is null/],
    [transformScripts, /cache-control has no-transform/],
  ]) {
    const { status, summary } = await verifyLive(await servePages(t, dir, change), dir);
    assert.equal(status, 1, JSON.stringify(summary));
    assert.ok(
      summary.failures.some((failure) => pattern.test(failure)),
      JSON.stringify(summary.failures),
    );
  }
});

test("verify-live skips a preview behind Cloudflare Access only when told it may", async (t) => {
  const dir = exportFor(t);
  const base = await servePages(t, dir, (answer) => {
    answer.status = 302;
    answer.headers.set("location", "https://woowtech.cloudflareaccess.com/cdn-cgi/access/login");
    answer.body = "";
  });
  const allowed = await verifyLive(base, dir, ["--allow-access"]);
  assert.deepEqual([allowed.status, allowed.summary.skipped], [0, "behind Cloudflare Access"]);
  const refused = await verifyLive(base, dir);
  assert.equal(refused.status, 1);
  assert.ok(refused.summary.failures.some((failure) => /status 302, not 200/.test(failure)));
});

test("hosted-web-smoke.mjs refuses to start without a pairing link", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "woowtech/web/hosted-web-smoke.mjs")],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--pair-url is required/);
});

// --- the same address and the same wrangler everywhere ---

const scriptConstant = (name) => new RegExp(`^${name}=(\\S+)$`, "m").exec(read(DEPLOY_SCRIPT))?.[1];
const smokeDefaultBase = () =>
  /^const DEFAULT_BASE = "([^"]+)";$/m.exec(read("woowtech/web/hosted-web-smoke.mjs"))?.[1];

test("deploy-web.sh and the smoke test name the same site", () => {
  assert.equal(scriptConstant("SITE_ORIGIN"), "https://smart.woowtech.io");
  assert.equal(smokeDefaultBase(), scriptConstant("SITE_ORIGIN"));
});

test("the site is BRAND_WEB_APP's origin, and the reports Worker answers it by default", async () => {
  // Lane A writes brand-web-app.ts and Lane D the Worker's default origins: this passes once both
  // are merged (web-spec.md section 8).
  const brand = "packages/protocol/src/brand-web-app.ts";
  assert.ok(existsSync(path.join(repoRoot, brand)), `${brand} is missing`);
  const { BRAND_WEB_APP } = await importSource(brand);
  assert.equal(BRAND_WEB_APP.origin, `https://${BRAND_WEB_APP.host}`);
  assert.equal(scriptConstant("SITE_ORIGIN"), BRAND_WEB_APP.origin);
  const worker = read(
    "woowtech/ai-content-report-cloudrun/deploy/cloudflare-worker-smart-reports.js",
  );
  const origins = /const DEFAULT_ALLOWED_ORIGINS = \[([^\]]*)\]/.exec(worker)?.[1] ?? "";
  assert.ok(
    [...origins.matchAll(/"([^"]+)"/g)].some(([, origin]) => origin === BRAND_WEB_APP.origin),
    `DEFAULT_ALLOWED_ORIGINS is [${origins}]`,
  );
});

/** Section 27 of the README: from its heading to the next section. */
function readmeSection27() {
  const readme = read("woowtech/README.md");
  const start = readme.search(/^### 27\. /m);
  assert.notEqual(start, -1, "woowtech/README.md has no section 27");
  const body = readme.indexOf("\n", start) + 1;
  const end = readme.slice(body).search(/^#{2,3} /m);
  return end === -1 ? readme.slice(start) : readme.slice(start, body + end);
}

test("deploy-web.sh's wrangler version is the one section 27 and the reports Worker's docs use", () => {
  // Lane D pins the reports Worker's commands: this passes once it is merged.
  const version = scriptConstant("WRANGLER_VERSION");
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const texts = {
    "woowtech/README.md section 27": readmeSection27(),
    "woowtech/ai-content-report-cloudrun/README.md": read(
      "woowtech/ai-content-report-cloudrun/README.md",
    ),
    "cloudflare-worker-smart-reports.wrangler.jsonc": read(
      "woowtech/ai-content-report-cloudrun/deploy/cloudflare-worker-smart-reports.wrangler.jsonc",
    ),
  };
  for (const [name, text] of Object.entries(texts)) {
    const named = [...text.matchAll(/wrangler(?:@|\s+)v?(\d+\.\d+\.\d+)/g)].map(
      ([, found]) => found,
    );
    assert.ok(named.length > 0, `${name} names no wrangler version`);
    assert.deepEqual(
      named.filter((found) => found !== version),
      [],
      `${name} names another wrangler`,
    );
    assert.doesNotMatch(text, /wrangler@4(?![.\d])/, `${name} runs an unpinned wrangler@4`);
  }
});
