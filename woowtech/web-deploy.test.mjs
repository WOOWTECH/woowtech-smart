// The hosted web app's deploy tooling (woowtech/README.md section 27): deploy-web.sh against
// stand-in tools, the Pages _headers, check-export.mjs on small exports, verify-live.mjs against a
// local server that serves an export the way Pages does, what Expo writes into index.html, and the
// web app's address and wrangler version across files. Nothing here builds, logs in or reaches
// the network.
//
//   node --test woowtech/web-deploy.test.mjs
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { importSource } from "./source-modules.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const DEPLOY_SCRIPT = "woowtech/scripts/deploy-web.sh";
const CHECK_EXPORT = path.join(repoRoot, "woowtech/web/check-export.mjs");
const HEADERS = path.join(repoRoot, "woowtech/web/_headers");
const ACCOUNT_ID = "9c27f623ee596e0b67be56263bcb1974";
// Alan's account, which holds apporo.ai: Apporo smart's Pages project lives there.
const APPORO_ACCOUNT_ID = "9f14a17191df1e77889566d848f063ad";
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
// Apporo smart's stand-in export and its baseline (woowtech/web/export-baseline.apporo.json).
const APPORO_BUNDLE =
  'const report="https://www.apporo.ai/api/smart/v1/ai-content-reports",relay="relay.apporo.ai:443",' +
  'web="https://smart.apporo.ai",name="Apporo smart";\n';
const APPORO_BASELINE = {
  origins: ["https://smart.apporo.ai", "https://www.apporo.ai"],
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
// The owner's login as it is on this Mac: it can use both brands' accounts.
const LOGIN_BOTH_ACCOUNTS = JSON.stringify({
  ...OWNER_LOGIN,
  accounts: [...OWNER_LOGIN.accounts, { id: APPORO_ACCOUNT_ID, name: "Alan" }],
});
const APPORO_PROJECTS = JSON.stringify([
  { "Project Name": "apporo-smart-web", "Project Domains": "apporo-smart-web.pages.dev" },
]);
// The files whose change since production's commit deploy-web.sh makes someone acknowledge (exit 7).
const GUARD_FILES = [
  "woowtech/web/export-baseline.json",
  "woowtech/web/_headers",
  "woowtech/web/check-export.mjs",
  "woowtech/web/verify-live.mjs",
  "woowtech/scripts/deploy-web.sh",
];
// Apporo smart's: its own baseline in place of woowtech smart's.
const APPORO_GUARD_FILES = ["woowtech/web/export-baseline.apporo.json", ...GUARD_FILES.slice(1)];
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

// What wrangler reads from the environment that could carry the login somewhere else, or take the
// place of it: none of these may reach it (README section 27).
const WRANGLER_ENV_NAMES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "XDG_CONFIG_HOME",
  "WRANGLER_CACHE_DIR",
  "WRANGLER_SEND_METRICS",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
  "WRANGLER_CF_AUTHORIZATION_TOKEN",
  "CLOUDFLARE_API_BASE_URL",
  "CF_API_BASE_URL",
  "CLOUDFLARE_COMPLIANCE_REGION",
  "WRANGLER_API_ENVIRONMENT",
  "WRANGLER_AUTH_DOMAIN",
  "WRANGLER_AUTH_URL",
  "WRANGLER_TOKEN_URL",
  "WRANGLER_REVOKE_URL",
  "WRANGLER_CLIENT_ID",
  "NODE_OPTIONS",
];
const HOSTILE_WRANGLER_ENV = {
  CLOUDFLARE_API_TOKEN: "not-the-owner-login",
  CLOUDFLARE_API_KEY: "key",
  CLOUDFLARE_EMAIL: "someone@example.invalid",
  CF_API_TOKEN: "old-name",
  CF_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  WRANGLER_CF_AUTHORIZATION_TOKEN: "token",
  CLOUDFLARE_API_BASE_URL: "https://api.example.invalid",
  CF_API_BASE_URL: "https://api.example.invalid",
  CLOUDFLARE_COMPLIANCE_REGION: "fedramp_high",
  WRANGLER_API_ENVIRONMENT: "staging",
  WRANGLER_AUTH_DOMAIN: "auth.example.invalid",
  WRANGLER_AUTH_URL: "https://auth.example.invalid/auth",
  WRANGLER_TOKEN_URL: "https://auth.example.invalid/token",
  WRANGLER_REVOKE_URL: "https://auth.example.invalid/revoke",
  WRANGLER_CLIENT_ID: "client",
  NODE_OPTIONS: "--max-old-space-size=2048",
};

// wrangler: records each call (arguments, working directory, whether stdin is a terminal, the
// Cloudflare environment) and answers like wrangler 4.149.0 does with --json. FAKE_* variables
// change the answers; `logout` makes `whoami --json` say loggedIn false from then on.
const FAKE_WRANGLER = `#!/bin/sh
log="$FAKE_LOG/wrangler.log"
deployed="$FAKE_LOG/wrangler-deployed"
loggedout="$FAKE_LOG/wrangler-logged-out"
whoamis="$FAKE_LOG/wrangler-whoami-count"
{
  printf 'CALL\\n'
  for arg in "$@"; do printf 'ARG %s\\n' "$arg"; done
  printf 'CWD %s\\n' "$PWD"
  printf 'CWD_ENTRIES %s\\n' "$(ls -A . | wc -l | tr -d ' ')"
  if [ -t 0 ]; then printf 'STDIN tty\\n'; else printf 'STDIN not-tty\\n'; fi
  if [ -n "\${WRANGLER_CACHE_DIR:-}" ] && [ -d "$WRANGLER_CACHE_DIR" ]; then
    printf 'CACHE_ENTRIES %s\\n' "$(ls -A "$WRANGLER_CACHE_DIR" | wc -l | tr -d ' ')"
  fi
  ${SH_LOG_ENV(WRANGLER_ENV_NAMES)}
} >>"$log"
login='${JSON.stringify(OWNER_LOGIN)}'
projects='[{"Project Name":"woowtech-smart-web","Project Domains":"woowtech-smart-web.pages.dev"}]'
case "$*" in
  --version) echo "\${FAKE_WRANGLER_VERSION:-4.149.0}"; exit 0 ;;
  "whoami --json")
    count=$(cat "$whoamis" 2>/dev/null || echo 0)
    count=$((count + 1))
    echo "$count" >"$whoamis"
    if [ -f "$loggedout" ]; then printf '{"loggedIn":false}\\n'; exit 1; fi
    if [ "$count" -ge 2 ] && [ -n "\${FAKE_WHOAMI_LATER:-}" ]; then printf '%s\\n' "$FAKE_WHOAMI_LATER"; exit 0; fi
    printf '%s\\n' "\${FAKE_WHOAMI:-$login}"
    exit "\${FAKE_WHOAMI_EXIT:-0}" ;;
  logout)
    if [ -z "\${FAKE_LOGOUT_KEEPS:-}" ]; then : >"$loggedout"; fi
    echo "Successfully logged out."
    exit 0 ;;
  "pages project list --json") printf '%s\\n' "\${FAKE_PROJECTS:-$projects}"; exit 0 ;;
esac
if [ "$1 $2" = "pages deploy" ]; then
  branch=""
  hash=""
  for arg in "$@"; do
    case "$arg" in
      --branch=*) branch=\${arg#--branch=} ;;
      --commit-hash=*) hash=\${arg#--commit-hash=} ;;
    esac
  done
  rm -rf "$FAKE_LOG/uploaded"
  cp -R "$3" "$FAKE_LOG/uploaded"
  printf '%s %s\\n' "$branch" "\${FAKE_DEPLOYED_SHA:-$hash}" >"$deployed"
  exit "\${FAKE_DEPLOY_EXIT:-0}"
fi
if [ "$1 $2 $3" = "pages deployment list" ]; then
  project=woowtech-smart-web
  for arg in "$@"; do
    case "$arg" in
      --project-name=*) project=\${arg#--project-name=} ;;
    esac
  done
  if [ -n "\${FAKE_LIST_FAIL:-}" ]; then echo "stand-in wrangler: the deployment list failed" >&2; exit 1; fi
  if [ ! -f "$deployed" ]; then printf '%s\\n' "\${FAKE_PREVIOUS:-[]}"; exit 0; fi
  read -r branch hash <"$deployed"
  environment=Preview
  if [ "$branch" = main ]; then environment=Production; fi
  short=$(printf '%s' "$hash" | cut -c 1-7)
  printf '[{"Id":"d1","Environment":"%s","Branch":"%s","Source":"%s","Deployment":"https://0123abcd.%s.pages.dev","Status":"now"}]\\n' "\${FAKE_DEPLOYED_ENV:-$environment}" "\${FAKE_DEPLOYED_BRANCH:-$branch}" "$short" "$project"
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
// 26 MiB sparse file). FAKE_BUILD_* make the build do what a build in a shared worktree could:
// fail, edit a tracked file, commit, leave a .env file, or make ~/.wrangler.
const FAKE_NPX = `#!/bin/sh
{
  printf 'CALL\\n'
  for arg in "$@"; do printf 'ARG %s\\n' "$arg"; done
  printf 'CWD %s\\n' "$PWD"
  if [ -n "\${FAKE_FINAL_OUT:-}" ]; then
    if [ -d "$FAKE_FINAL_OUT" ]; then printf 'ENV FINAL_OUT=yes\\n'; else printf 'ENV FINAL_OUT=no\\n'; fi
  fi
  if [ -f ../protocol/src/brand-values.ts ]; then
    printf 'ENV BRAND_ID=%s\\n' "$(sed -n 's/^export const BRAND_ID = "\\(.*\\)";$/\\1/p' ../protocol/src/brand-values.ts)"
  fi
  if [ -f ../../node_modules/some-dep/index.js ]; then printf 'ENV DEP=yes\\n'; fi
  if [ -L ../../node_modules/linked-app ]; then printf 'ENV LINK=%s\\n' "$(readlink ../../node_modules/linked-app)"; fi
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
if [ -n "\${FAKE_BUILD_FAIL:-}" ]; then echo "stand-in npx: the build failed" >&2; exit 1; fi
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
if [ -n "\${FAKE_BUILD_TOUCH:-}" ]; then echo "// edited during the build" >>"$FAKE_BUILD_TOUCH"; fi
if [ -n "\${FAKE_BUILD_COMMIT:-}" ]; then
  git -c user.name=Other -c user.email=other@example.invalid commit -q --allow-empty -m "Moved during the build"
fi
if [ -n "\${FAKE_BUILD_ENV_FILE:-}" ]; then echo "EXPO_PUBLIC_LOCAL_DAEMON=localhost:6768" >"$PWD/.env"; fi
if [ -n "\${FAKE_BUILD_WRANGLER_DIR:-}" ]; then mkdir -p "$HOME/.wrangler"; fi
exit 0
`;

// verify-live.mjs in the fixture repository: records how deploy-web.sh calls it and ends as
// FAKE_VERIFY_EXIT (the deployment's own address) or FAKE_VERIFY_SITE_EXIT (the brand's site) say.
const FAKE_VERIFY = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_LOG + "/verify.jsonl", JSON.stringify({ args: process.argv.slice(2) }) + "\\n");
const site = !new URL(process.argv[2]).hostname.endsWith(".pages.dev");
process.exit(Number((site ? process.env.FAKE_VERIFY_SITE_EXIT : process.env.FAKE_VERIFY_EXIT) ?? 0));
`;

// woowtech/tools/apply-brand.mjs in the fixture repository: records where and how it ran, then
// writes the brand into brand-values.ts as the real one does (FAKE_APPLY_AS writes another brand,
// FAKE_APPLY_FAIL makes it fail).
const FAKE_APPLY_BRAND = `import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(process.env.FAKE_LOG + "/apply-brand.jsonl", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (process.env.FAKE_APPLY_FAIL) process.exit(1);
const id = process.env.FAKE_APPLY_AS || process.argv[2];
writeFileSync("packages/protocol/src/brand-values.ts", 'export const BRAND_ID = "' + id + '";\\n');
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
 * A repository with deploy-web.sh, check-export.mjs, _headers and the brand files from this
 * checkout, stand-ins for verify-live.mjs and apply-brand.mjs, woowtech applied, baselines that fit
 * the stand-in exports, and a bare origin it is pushed to. `linked` adds a linked worktree of it,
 * where the script then runs; `subject` is the commit's; `brand` picks the stand-in export.
 */
function deployFixture(
  t,
  { linked = false, subject = "Ship the web app", brand = "woowtech" } = {},
) {
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
    "woowtech/web/export-baseline.apporo.json": `${JSON.stringify(APPORO_BASELINE, null, 2)}\n`,
    "woowtech/web/verify-live.mjs": FAKE_VERIFY,
    "woowtech/brands/woowtech.json": read("woowtech/brands/woowtech.json"),
    "woowtech/brands/apporo.json": read("woowtech/brands/apporo.json"),
    "woowtech/tools/apply-brand.mjs": FAKE_APPLY_BRAND,
    "packages/protocol/src/brand-values.ts": 'export const BRAND_ID = "woowtech";\n',
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
  git(repo, [...identity, "commit", "-q", "-m", subject], gitEnv);
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
  writeExport(dirs.template, {
    headers: false,
    bundle: brand === "apporo" ? APPORO_BUNDLE : BUNDLE,
  });
  const sha = git(repo, ["rev-parse", "HEAD"], gitEnv);
  const short = git(repo, ["rev-parse", "--short=12", "HEAD"], gitEnv);
  const outRoot = path.join(dirs.home, ".local/share/woowtech-smart/web-dist");
  const loginHome = path.join(dirs.home, ".local/share/woowtech-smart/wrangler-pages");
  return {
    ...dirs,
    root,
    checkout,
    gitEnv,
    identity,
    sha,
    outRoot,
    loginHome,
    out: path.join(outRoot, brand === "woowtech" ? short : `${brand}-${short}`),
  };
}

/** A stand-in's calls: { args, cwd, cwdEntries, cacheEntries, stdin, env } from its CALL/ARG/... lines. */
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
    else if (kind === "STDIN") call.stdin = rest;
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

function resetLogs(fixture) {
  for (const name of readdirSync(fixture.log))
    rmSync(path.join(fixture.log, name), { recursive: true, force: true });
}

/** The variables deploy-web.sh gets: only what it needs, and what the stand-in tools read. */
function runEnv(fixture, env) {
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
  return fullEnv;
}

/** What deploy-web.sh prints as the hash of the guard files' diff from `from` to HEAD. */
function guardHash(fixture, from, files = GUARD_FILES) {
  const diff = spawnSync(
    "git",
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--full-index",
      from,
      "HEAD",
      "--",
      ...files,
    ],
    { cwd: fixture.checkout, env: fixture.gitEnv },
  );
  assert.equal(diff.status, 0, String(diff.stderr));
  return sha256(diff.stdout).slice(0, 12);
}

function collect(fixture, status, output) {
  return {
    status,
    output,
    wrangler: readCalls(fixture, "wrangler.log"),
    heavy: readCalls(fixture, "heavy.log"),
    npm: readCalls(fixture, "npm.log"),
    npx: readCalls(fixture, "npx.log"),
    verify: readJsonLines(fixture, "verify.jsonl"),
  };
}

/**
 * Runs deploy-web.sh in the fixture and returns what the tools saw. A production upload is a first
 * deploy unless FAKE_PREVIOUS says otherwise, so it comes with the acknowledgement of the guard
 * diff (exit 7) unless `ack` is null or the environment brings its own.
 */
function deploy(fixture, { args = [], env = {}, shell = null, ack = "first" } = {}) {
  resetLogs(fixture);
  const production =
    !args.includes("--preview") && !args.includes("--logout") && env.WOOW_DRY_RUN === undefined;
  const acknowledged =
    production && ack === "first" && !("WOOW_ACK_GUARD_DIFF" in env)
      ? { WOOW_ACK_GUARD_DIFF: guardHash(fixture, EMPTY_TREE) }
      : {};
  const fullEnv = runEnv(fixture, { ...acknowledged, ...env });
  const script = path.join(fixture.checkout, DEPLOY_SCRIPT);
  const result = shell
    ? spawnSync(shell, [script, ...args], { env: fullEnv, encoding: "utf8" })
    : spawnSync(script, args, { env: fullEnv, encoding: "utf8" });
  return collect(fixture, result.status, `${result.stdout}\n${result.stderr}`);
}

const uploads = (run) =>
  run.wrangler.filter((call) => call.args[0] === "pages" && call.args[1] === "deploy");
const builds = (run) => run.heavy.filter((call) => call.args.join(" ").includes("expo export"));
const npmCi = (run) => run.npm.filter((call) => call.args.includes("ci"));
/** The wrangler subcommands in order; an upload is just "pages deploy". */
const kinds = (run) =>
  run.wrangler.map(({ args }) =>
    args[0] === "pages"
      ? args
          .slice(0, 3)
          .join(" ")
          .replace(/^pages deploy .*/, "pages deploy")
      : args.slice(0, 2).join(" "),
  );
const uploadedTree = (fixture) => listTree(path.join(fixture.log, "uploaded"));
const stagesLeft = (fixture) =>
  existsSync(fixture.outRoot)
    ? readdirSync(fixture.outRoot).filter((name) => name.startsWith(".stage-"))
    : [];
const treesLeft = (fixture) =>
  existsSync(fixture.outRoot)
    ? readdirSync(fixture.outRoot).filter((name) => name.startsWith(".tree-"))
    : [];

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

/** The upload directory a run gave wrangler: a copy under the script's own temporary directory. */
function assertUploadCopy(fixture, run) {
  const dir = uploads(run)[0].args[2];
  assert.match(
    dir,
    new RegExp(`^${escapeRegExp(fixture.tmp)}/woowtech-deploy-web\\.[A-Za-z0-9]+/upload$`),
  );
  assert.notEqual(dir, fixture.out);
  return dir;
}

/** A commit on top of the fixture's, pushed: `files` are written, `subject` is its subject. */
function commitOnTop(fixture, subject, files = {}) {
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(fixture.repo, relative)), { recursive: true });
    writeFileSync(path.join(fixture.repo, relative), content);
  }
  git(fixture.repo, ["add", "-A"], fixture.gitEnv);
  git(
    fixture.repo,
    [...fixture.identity, "commit", "-q", "--allow-empty", "-m", subject],
    fixture.gitEnv,
  );
  git(fixture.repo, ["push", "-q", "origin", "main"], fixture.gitEnv);
  return git(fixture.repo, ["rev-parse", "HEAD"], fixture.gitEnv);
}

/** What `wrangler pages deployment list --json` says production runs: `sha` as its 7-character Source. */
const productionRuns = (sha, id = "d0") =>
  JSON.stringify([
    {
      Id: id,
      Environment: "Production",
      Branch: "main",
      Source: sha.slice(0, 7),
      Deployment: "https://old.woowtech-smart-web.pages.dev",
    },
  ]);

test("deploy-web.sh asks for a guard diff of the files this test hashes, and its prompt gives up", () => {
  const script = read(DEPLOY_SCRIPT);
  const guarded = /^GUARD_FILES="([^"]+)"$/m.exec(script)?.[1].split(" ");
  assert.deepEqual(
    guarded?.map((file) => (file === "$BASELINE" ? brandPresets().woowtech.BASELINE : file)),
    GUARD_FILES,
  );
  for (const file of GUARD_FILES) assert.ok(existsSync(path.join(repoRoot, file)), file);
  // A person who walks away from the prompt, or an agent that runs the script in a terminal
  // without WOOW_CONFIRM_SHA, would wait for ever.
  assert.match(script, /IFS= read -r -t 600 answer/);
});

test(
  "a dry run builds into a stage, through heavy.sh with the production settings, and runs no wrangler",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const run = deploy(fixture, {
      env: {
        WOOW_DRY_RUN: "1",
        // A caller's dev label and Electron platform must not reach the bundle.
        EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL: "dev",
        PASEO_WEB_PLATFORM: "electron",
        CLOUDFLARE_API_TOKEN: "not-the-owner-login",
        FAKE_FINAL_OUT: fixture.out,
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
    // EXPO_PUBLIC_LOCAL_DAEMON is refused when it is set (below); it is unset for the build anyway.
    assert.ok(builds(run)[0].args.join(" ").includes("-u EXPO_PUBLIC_LOCAL_DAEMON"));
    // The build command line, run as written, with npm and npx standing in.
    assert.deepEqual(
      run.npm.map((call) => call.args),
      [["--prefix", fixture.checkout, "run", "build:app-deps"]],
    );
    assert.equal(run.npx.length, 1);
    const [exporter] = run.npx;
    // The export is built in a stage of its own and moved to its place afterwards.
    assert.equal(exporter.args.slice(0, 5).join(" "), "expo export --platform web --output-dir");
    assert.match(
      exporter.args[5],
      new RegExp(`^${escapeRegExp(fixture.outRoot)}/\\.stage-[0-9a-f]{12}\\.[A-Za-z0-9]+/export$`),
    );
    assert.deepEqual(exporter.args.slice(6), ["--clear", "--max-workers", "2"]);
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
    assert.equal(exporter.env.FINAL_OUT, "no", "no export existed yet");
    assert.deepEqual(stagesLeft(fixture), [], "the stage was left behind");
    // The export plus _headers: deploy-web.sh writes its build record next to OUT, not into it.
    assert.deepEqual(listTree(fixture.out), [...listTree(fixture.template), "_headers"].sort());
    assert.equal(
      readFileSync(path.join(fixture.out, "_headers"), "utf8"),
      readFileSync(HEADERS, "utf8"),
    );
    // The record has the SHA-256 of every exported file.
    const info = JSON.parse(readFileSync(`${fixture.out}.build.json`, "utf8"));
    assert.deepEqual(Object.keys(info.files), listTree(fixture.out));
    assert.equal(info.files[ENTRY], sha256(BUNDLE));
    assert.equal(info.dirty, false);
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

test(
  "--brand=apporo builds in a copy of HEAD with Apporo applied, checks it as Apporo's, and removes the copy",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t, { brand: "apporo" });
    // The checkout's node_modules go into the copy, workspace links and all.
    mkdirSync(path.join(fixture.checkout, "node_modules/some-dep"), { recursive: true });
    writeFileSync(path.join(fixture.checkout, "node_modules/some-dep/index.js"), "export {};\n");
    symlinkSync("../packages/app", path.join(fixture.checkout, "node_modules/linked-app"));
    const run = deploy(fixture, { args: ["--brand=apporo"], env: { WOOW_DRY_RUN: "1" } });

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.wrangler, [], "a dry run never runs wrangler");
    const applied = readJsonLines(fixture, "apply-brand.jsonl");
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].args, ["apporo"]);
    const tree = applied[0].cwd;
    assert.match(
      tree,
      new RegExp(`^${escapeRegExp(fixture.outRoot)}/\\.tree-apporo-[0-9a-f]{12}\\.[A-Za-z0-9]+$`),
    );
    // The build ran in the copy, with Apporo applied and Apporo's report receiver.
    assert.deepEqual(
      run.npm.map((call) => call.args),
      [["--prefix", tree, "run", "build:app-deps"]],
    );
    const [exporter] = run.npx;
    assert.equal(exporter.cwd, path.join(tree, "packages/app"));
    assert.equal(exporter.env.BRAND_ID, "apporo");
    assert.equal(exporter.env.DEP, "yes", "the checkout's node_modules are not in the copy");
    assert.equal(exporter.env.LINK, "../packages/app", "a workspace link became something else");
    assert.equal(
      exporter.env.WOOWTECH_AI_CONTENT_REPORT_URL,
      "https://www.apporo.ai/api/smart/v1/ai-content-reports",
    );
    // Apporo's export has a name of its own next to woowtech's, and check-export took it as Apporo's.
    assert.equal(path.basename(fixture.out), `apporo-${fixture.sha.slice(0, 12)}`);
    assert.deepEqual(listTree(fixture.out), [...listTree(fixture.template), "_headers"].sort());
    assert.match(run.output, /brand apporo's export .* passed its checks/);
    assert.deepEqual(treesLeft(fixture), [], "the copy was left behind");
    assert.deepEqual(stagesLeft(fixture), [], "the stage was left behind");
    // The checkout is untouched: woowtech applied, nothing changed.
    assert.equal(
      readFileSync(path.join(fixture.checkout, "packages/protocol/src/brand-values.ts"), "utf8"),
      'export const BRAND_ID = "woowtech";\n',
    );
    assert.equal(git(fixture.checkout, ["status", "--porcelain"], fixture.gitEnv), "");
  },
);

test(
  "an Apporo copy that ends up with another brand, or a failed apply, builds nothing",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t, { brand: "apporo" });
    const dry = { WOOW_DRY_RUN: "1" };
    const wrong = deploy(fixture, {
      args: ["--brand=apporo"],
      env: { ...dry, FAKE_APPLY_AS: "woowtech" },
    });
    assertRefused(wrong, 3, /has brand "woowtech" applied, not apporo/);
    assert.deepEqual(builds(wrong), []);
    const failed = deploy(fixture, {
      args: ["--brand=apporo"],
      env: { ...dry, FAKE_APPLY_FAIL: "1" },
    });
    assertRefused(failed, 3, /apply-brand\.mjs apporo failed/);
    assert.deepEqual(builds(failed), []);
    assert.deepEqual(treesLeft(fixture), [], "the copy was left behind");
  },
);

test(
  "woowtech smart's stand-in export fails as Apporo's: check-export wants Apporo's values",
  { skip: needsNode22 },
  (t) => {
    // The woowtech fixture's template holds woowtech's report URL, relay and name.
    const fixture = deployFixture(t);
    const run = deploy(fixture, { args: ["--brand=apporo"], env: { WOOW_DRY_RUN: "1" } });
    assertRefused(run, 3, /check-export\.mjs found problems/);
    assert.match(run.output, /the bundle does not contain "relay\.apporo\.ai"/);
    assert.match(run.output, /"relay\.woowtech\.io" is in/);
  },
);

test(
  "--brand=apporo uploads to apporo-smart-web in Alan's account and checks smart.apporo.ai",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t, { brand: "apporo" });
    const projects = JSON.stringify([
      {
        "Project Name": "apporo-smart-web",
        "Project Domains": "apporo-smart-web.pages.dev, smart.apporo.ai",
      },
    ]);
    const run = deploy(fixture, {
      args: ["--brand=apporo"],
      ack: null,
      env: {
        FAKE_WHOAMI: LOGIN_BOTH_ACCOUNTS,
        FAKE_PROJECTS: projects,
        WOOW_ACK_GUARD_DIFF: guardHash(fixture, EMPTY_TREE, APPORO_GUARD_FILES),
      },
    });

    assert.equal(run.status, 0, run.output);
    assertWranglerEnvironment(fixture, run, "wrangler-pages", APPORO_ACCOUNT_ID);
    const [upload] = uploads(run);
    const dir = assertUploadCopy(fixture, run);
    assert.equal(upload.args[3], "--project-name=apporo-smart-web");
    for (const call of run.wrangler.filter(({ args }) =>
      args.join(" ").includes("deployment list"),
    )) {
      assert.ok(call.args.includes("--project-name=apporo-smart-web"), call.args.join(" "));
    }
    assert.deepEqual(run.verify, [
      { args: ["https://0123abcd.apporo-smart-web.pages.dev", dir] },
      { args: ["https://smart.apporo.ai", dir] },
    ]);
  },
);

test(
  "Apporo smart's upload needs a login that can use its account, its own guard diff and its own marker",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t, { brand: "apporo" });
    const apporo = { FAKE_WHOAMI: LOGIN_BOTH_ACCOUNTS, FAKE_PROJECTS: APPORO_PROJECTS };
    // The login reaches WOOWTECH's account only.
    assertRefused(
      deploy(fixture, { args: ["--brand=apporo"], env: { FAKE_PROJECTS: APPORO_PROJECTS } }),
      4,
      /cannot use the account that holds apporo\.ai 9f14a17191df1e77889566d848f063ad/,
    );
    // woowtech smart's guard hash is not Apporo smart's: its baseline is another file.
    assertRefused(
      deploy(fixture, { args: ["--brand=apporo"], env: apporo }),
      7,
      /is not this diff's hash/,
    );
    // woowtech smart's marker says nothing about Apporo smart's project.
    mkdirSync(fixture.loginHome, { recursive: true });
    writeFileSync(path.join(fixture.loginHome, "domain-attached"), "");
    const ack = { WOOW_ACK_GUARD_DIFF: guardHash(fixture, EMPTY_TREE, APPORO_GUARD_FILES) };
    const unmarked = deploy(fixture, {
      args: ["--brand=apporo"],
      ack: null,
      env: { ...apporo, ...ack },
    });
    assert.equal(unmarked.status, 0, unmarked.output);
    // Its own marker does: smart.apporo.ai has to be on the project.
    writeFileSync(path.join(fixture.loginHome, "domain-attached-apporo"), "");
    assertRefused(
      deploy(fixture, { args: ["--brand=apporo"], ack: null, env: { ...apporo, ...ack } }),
      4,
      /smart\.apporo\.ai is not on the Pages project apporo-smart-web any more/,
    );
  },
);

/**
 * Every wrangler call: the brand's account, the login directory `home`, an empty cache and working
 * directory, no credentials or endpoints from the caller, and no standard input to ask questions of.
 */
function assertWranglerEnvironment(fixture, run, home = "wrangler-pages", account = ACCOUNT_ID) {
  assert.ok(run.wrangler.length > 0, "wrangler never ran");
  for (const call of run.wrangler) {
    const where = call.args.join(" ");
    assert.equal(call.env.CLOUDFLARE_ACCOUNT_ID, account, where);
    assert.equal(
      call.env.XDG_CONFIG_HOME,
      path.join(fixture.home, ".local/share/woowtech-smart", home),
      where,
    );
    assert.equal(call.env.WRANGLER_SEND_METRICS, "false", where);
    for (const name of Object.keys(HOSTILE_WRANGLER_ENV)) {
      assert.equal(call.env[name], undefined, `${where}: the caller's ${name} reached wrangler`);
    }
    assert.ok(
      call.env.WRANGLER_CACHE_DIR.startsWith(`${fixture.tmp}/`),
      `${where}: cache ${call.env.WRANGLER_CACHE_DIR}`,
    );
    assert.equal(call.cacheEntries, 0, `${where}: the cache directory was not empty`);
    assert.ok(call.cwd.startsWith(`${fixture.tmp}/`), `${where}: ran in ${call.cwd}`);
    assert.equal(call.cwdEntries, 0, `${where}: its directory was not empty`);
    assert.equal(call.stdin, "not-tty", `${where}: stdin was a terminal`);
  }
  assert.equal(
    existsSync(run.wrangler[0].env.WRANGLER_CACHE_DIR),
    false,
    "the cache directory was left behind",
  );
}

test(
  "a production deploy from an agent: checks twice, uploads a copy, verifies, and stays logged in",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const run = deploy(fixture, { env: HOSTILE_WRANGLER_ENV });

    assert.equal(run.status, 0, run.output);
    assertWranglerEnvironment(fixture, run);
    assert.deepEqual(kinds(run), [
      // before the build
      "--version",
      "whoami --json",
      "pages project list",
      // production's newest deployment, for the checks on where this commit comes from
      "pages deployment list",
      // right before the upload
      "--version",
      "whoami --json",
      "pages project list",
      "pages deploy",
      "pages deployment list",
    ]);
    // Each value shares its argument with its flag, and --cwd is the empty directory wrangler runs in.
    const [upload] = uploads(run);
    const dir = assertUploadCopy(fixture, run);
    assert.deepEqual(upload.args, [
      "pages",
      "deploy",
      dir,
      "--project-name=woowtech-smart-web",
      "--branch=main",
      `--commit-hash=${fixture.sha}`,
      "--commit-message=Ship the web app",
      "--commit-dirty=false",
      `--cwd=${upload.cwd}`,
    ]);
    // What was uploaded is the export plus _headers, and the copy is not where the export lives.
    assert.deepEqual(uploadedTree(fixture), [...listTree(fixture.template), "_headers"].sort());
    // O12: the login stays for the next deploy.
    assert.deepEqual(
      run.wrangler.filter((call) => call.args[0] === "logout"),
      [],
    );
    assert.match(run.output, /without a confirmation/);
    // No custom domain on the project yet: the deployment's own address is the only one checked.
    assert.deepEqual(run.verify, [
      { args: ["https://0123abcd.woowtech-smart-web.pages.dev", dir] },
    ]);
  },
);

test(
  "once smart.woowtech.io is on the project, production is checked there too",
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
    // The Bulk Redirect makes woowtech-smart-web.pages.dev answer 301: that address is never checked.
    const dir = assertUploadCopy(fixture, run);
    assert.deepEqual(run.verify, [
      { args: ["https://0123abcd.woowtech-smart-web.pages.dev", dir] },
      { args: ["https://smart.woowtech.io", dir] },
    ]);
  },
);

test(
  "a custom domain that is listed but not answering yet is its own failure, without rollback advice",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const projects = JSON.stringify([
      {
        "Project Name": "woowtech-smart-web",
        "Project Domains": "woowtech-smart-web.pages.dev, smart.woowtech.io",
      },
    ]);
    // Production already runs this commit (deployment d0), so the rollback text has a target.
    const env = {
      FAKE_PROJECTS: projects,
      FAKE_PREVIOUS: productionRuns(fixture.sha),
      WOOW_VERIFY_ATTEMPTS: "2",
    };

    const notActive = deploy(fixture, { env: { ...env, FAKE_VERIFY_SITE_EXIT: "3" } });
    assert.equal(notActive.status, 8, notActive.output);
    assert.match(notActive.output, /smart\.woowtech\.io is on the project and does not answer/);
    assert.doesNotMatch(notActive.output, /Rollback to this deployment/);
    assert.equal(uploads(notActive).length, 1);
    assert.deepEqual(
      notActive.verify.map((call) => call.args[0]),
      [
        "https://0123abcd.woowtech-smart-web.pages.dev",
        "https://smart.woowtech.io",
        "https://smart.woowtech.io",
      ],
    );

    // Answering with the wrong content is a real exit 6, with the rollback text.
    const wrong = deploy(fixture, { env: { ...env, FAKE_VERIFY_SITE_EXIT: "1" } });
    assert.equal(wrong.status, 6, wrong.output);
    assert.match(wrong.output, /Rollback to this deployment/);

    // The deployment's own address failing is exit 6 too, and the domain is not tried.
    const own = deploy(fixture, { env: { ...env, FAKE_VERIFY_EXIT: "1" } });
    assert.equal(own.status, 6, own.output);
    assert.deepEqual(
      own.verify.map((call) => call.args[0]),
      [
        "https://0123abcd.woowtech-smart-web.pages.dev",
        "https://0123abcd.woowtech-smart-web.pages.dev",
      ],
    );
  },
);

test(
  "once the domain-attached marker exists, a project without smart.woowtech.io is an error",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    mkdirSync(fixture.loginHome, { recursive: true });
    writeFileSync(path.join(fixture.loginHome, "domain-attached"), "");

    const detached = deploy(fixture);
    assertRefused(
      detached,
      4,
      /smart\.woowtech\.io is not on the Pages project woowtech-smart-web any more/,
    );
    assert.match(detached.output, /incident steps in woowtech\/README\.md section 27/);
    assert.deepEqual(builds(detached), [], "it built before it looked at the project");

    const projects = [
      {
        "Project Name": "woowtech-smart-web",
        "Project Domains": "woowtech-smart-web.pages.dev, smart.woowtech.io",
      },
    ];
    const attached = deploy(fixture, { env: { FAKE_PROJECTS: JSON.stringify(projects) } });
    assert.equal(attached.status, 0, attached.output);
  },
);

test(
  "--preview uploads to the preview branch and checks that deployment, Access allowed",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    // A terminal answer is never asked for in preview, and production's checks do not apply:
    // the preview branch does not replace anything, and the guard diff is for production.
    const run = deploy(fixture, {
      args: ["--preview"],
      env: { WOOW_TTY: "/nonexistent", FAKE_PREVIOUS: productionRuns("0".repeat(40)) },
    });

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(kinds(run), [
      "--version",
      "whoami --json",
      "pages project list",
      "--version",
      "whoami --json",
      "pages project list",
      "pages deploy",
      "pages deployment list",
    ]);
    const dir = assertUploadCopy(fixture, run);
    assert.equal(uploads(run)[0].args.includes("--branch=preview"), true);
    assert.deepEqual(run.verify, [
      { args: ["https://0123abcd.woowtech-smart-web.pages.dev", dir, "--allow-access"] },
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
  assert.match(run.output, /WOOW_CONFIRM_SHA confirms/);
});

test(
  "the confirmation shows what production runs now and what changed since",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const previous = fixture.sha;
    commitOnTop(fixture, "Add a file", { "packages/app/added.txt": "new\n" });
    // No guard file changed since production's commit, so nothing has to be acknowledged.
    const run = deploy(fixture, { ack: null, env: { FAKE_PREVIOUS: productionRuns(previous) } });

    assert.equal(run.status, 0, run.output);
    assert.match(
      run.output,
      new RegExp(
        `production runs ${previous.slice(0, 7)} now \\(deployment d0\\); changes since then`,
      ),
    );
    assert.match(run.output, /packages\/app\/added\.txt/);
    assert.match(run.output, /the guard files are unchanged/);
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
  "an export that is not what its record says is built again, and what is uploaded is the copy",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    assert.equal(deploy(fixture, { env: { WOOW_DRY_RUN: "1" } }).status, 0);
    // Someone changes the shared export between the dry run and the upload.
    writeFileSync(path.join(fixture.out, ENTRY), `${BUNDLE}// not what was built\n`);
    const run = deploy(fixture);

    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /building again/);
    assert.equal(builds(run).length, 1);
    assert.equal(
      readFileSync(path.join(fixture.log, "uploaded", ENTRY), "utf8"),
      BUNDLE,
      "the changed file was uploaded",
    );
    assertUploadCopy(fixture, run);
  },
);

test(
  "a failed build leaves the export that was there, and no stage",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    assert.equal(deploy(fixture, { env: { WOOW_DRY_RUN: "1" } }).status, 0);
    const before = readFileSync(`${fixture.out}.build.json`, "utf8");
    const run = deploy(fixture, {
      env: { WOOW_DRY_RUN: "1", FAKE_BUILD_FAIL: "1", FAKE_FINAL_OUT: fixture.out },
    });

    assert.equal(run.status, 3, run.output);
    assert.match(run.output, /the web export failed/);
    assert.equal(run.npx[0].env.FINAL_OUT, "yes", "the old export was removed before the build");
    assert.equal(readFileSync(`${fixture.out}.build.json`, "utf8"), before);
    assert.deepEqual(listTree(fixture.out), [...listTree(fixture.template), "_headers"].sort());
    assert.deepEqual(stagesLeft(fixture), []);
  },
);

test(
  "what changes during the build is found afterwards, and the export is not put in place",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const cases = [
      [
        { FAKE_BUILD_TOUCH: path.join(fixture.repo, "packages/app/package.json") },
        2,
        /the worktree has changes after the build/,
      ],
      [{ FAKE_BUILD_COMMIT: "1" }, 2, /no longer [0-9a-f]{12}, after the build/],
      [{ FAKE_BUILD_ENV_FILE: "1" }, 2, /packages\/app\/\.env exists after the build/],
      [{ FAKE_BUILD_WRANGLER_DIR: "1" }, 4, /\.wrangler exists/],
    ];
    for (const [env, status, pattern] of cases) {
      git(fixture.repo, ["checkout", "-q", "--", "."], fixture.gitEnv);
      git(fixture.repo, ["reset", "-q", "--hard", fixture.sha], fixture.gitEnv);
      rmSync(path.join(fixture.repo, "packages/app/.env"), { force: true });
      rmSync(path.join(fixture.home, ".wrangler"), { recursive: true, force: true });
      const run = deploy(fixture, { env });
      assertRefused(run, status, pattern);
      assert.equal(
        existsSync(fixture.out),
        false,
        `${JSON.stringify(env)}: the export was put in place`,
      );
      assert.deepEqual(stagesLeft(fixture), []);
    }
  },
);

test(
  "files git is told not to look at are refused, because git status does not show them",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    for (const flag of ["--skip-worktree", "--assume-unchanged"]) {
      git(fixture.repo, ["update-index", flag, "packages/app/package.json"], fixture.gitEnv);
      writeFileSync(path.join(fixture.repo, "packages/app/package.json"), '{ "name": "edited" }\n');
      assert.equal(git(fixture.repo, ["status", "--porcelain"], fixture.gitEnv), "", flag);
      const run = deploy(fixture);
      assertRefused(run, 2, /assume-unchanged or skip-worktree/);
      assert.deepEqual(builds(run), []);
      git(
        fixture.repo,
        ["update-index", `--no-${flag.slice(2)}`, "packages/app/package.json"],
        fixture.gitEnv,
      );
      git(fixture.repo, ["checkout", "-q", "--", "packages/app/package.json"], fixture.gitEnv);
    }
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

    // Expo reads every one of these; .gitignore hides them from git status.
    for (const name of [".env", ".env.local", ".env.production"]) {
      writeFileSync(
        path.join(fixture.repo, "packages/app", name),
        "EXPO_PUBLIC_LOCAL_DAEMON=localhost:6768\n",
      );
      const refused = deploy(fixture);
      assertRefused(refused, 2, new RegExp(`packages/app/${escapeRegExp(name)} exists`));
      assert.deepEqual(builds(refused), []);
      rmSync(path.join(fixture.repo, "packages/app", name));
    }

    git(
      fixture.repo,
      [...fixture.identity, "commit", "-q", "--allow-empty", "-m", "Not pushed"],
      fixture.gitEnv,
    );
    assertRefused(deploy(fixture), 2, /is on no origin branch/);
  },
);

test(
  "HEAD on a branch that is gone from origin is not on origin: fetch prunes",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    git(fixture.repo, ["checkout", "-q", "-b", "feature"], fixture.gitEnv);
    commitOnTop(fixture, "Feature work");
    git(fixture.repo, ["push", "-q", "origin", "feature"], fixture.gitEnv);
    git(path.join(fixture.root, "origin.git"), ["branch", "-D", "feature"], fixture.gitEnv);
    // The remote-tracking branch is still here, and still holds HEAD.
    assert.match(
      git(fixture.repo, ["branch", "-r", "--contains", "HEAD"], fixture.gitEnv),
      /origin\/feature/,
    );

    assertRefused(deploy(fixture), 2, /is on no origin branch/);
  },
);

test(
  "EXPO_PUBLIC_LOCAL_DAEMON is refused whatever its value: it would be built into every visitor's browser",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    for (const [value, env] of [
      ["localhost:6768", { WOOW_DRY_RUN: "1" }],
      ["", { WOOW_DRY_RUN: "1" }],
      ["localhost:6768", {}],
    ]) {
      const run = deploy(fixture, { env: { ...env, EXPO_PUBLIC_LOCAL_DAEMON: value } });
      assertRefused(run, 2, /EXPO_PUBLIC_LOCAL_DAEMON is set/);
      assert.deepEqual(builds(run), [], `built with it set to "${value}"`);
      assert.deepEqual(run.npx, []);
    }
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
  assertRefused(
    deploy(fixture, { env: { WOOW_ALLOW_DOWNGRADE: "2" } }),
    2,
    /WOOW_ALLOW_DOWNGRADE must be 1 or unset/,
  );
  assertRefused(
    deploy(fixture, { env: { WOOW_ACK_GUARD_DIFF: "yes" } }),
    2,
    /WOOW_ACK_GUARD_DIFF must be the 12 hexadecimal characters/,
  );
  assertRefused(deploy(fixture, { args: ["--logout", "--preview"] }), 2, /--logout stands alone/);
  assertRefused(
    deploy(fixture, { args: ["--logout", "--brand=apporo"] }),
    2,
    /--logout stands alone/,
  );
  assertRefused(deploy(fixture, { args: ["--nope"] }), 2, /unknown argument --nope/);
  assertRefused(deploy(fixture, { args: ["--brand=paseo"] }), 2, /unknown brand "paseo"/);
  assertRefused(deploy(fixture, { args: ["--brand="] }), 2, /--brand= needs a brand/);
  assertRefused(deploy(fixture, { args: ["--brand", "apporo"] }), 2, /unknown argument --brand/);
  // Another brand is built from HEAD's files: a dirty checkout would not be what it builds.
  assertRefused(
    deploy(fixture, {
      args: ["--brand=apporo"],
      env: { WOOW_DRY_RUN: "1", WOOW_ALLOW_DIRTY: "1" },
    }),
    2,
    /brand apporo is built from HEAD's files: commit first/,
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
    /cannot read the answer/,
  );
  // Before anything is built: a typo in WOOW_CONFIRM_SHA does not cost a build.
  const typo = deploy(fixture, { env: { WOOW_CONFIRM_SHA: "0000000" } });
  assertRefused(typo, 2, /is not this commit/);
  assert.deepEqual(builds(typo), []);
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
      // Nothing beyond the allowed scopes, but not the one that deploys.
      [
        { FAKE_WHOAMI: login({ tokenPermissions: ["account:read", "user:read"] }) },
        /the login has no pages:write scope/,
      ],
      [
        { FAKE_WHOAMI: login({ accounts: [{ id: "0123456789abcdef0123456789abcdef" }] }) },
        /cannot use WOOWTECH's account 9c27f623ee596e0b67be56263bcb1974/,
      ],
      [{ FAKE_WHOAMI: login({ authType: "User API Token" }) }, /not the owner OAuth login/],
      [{ FAKE_PROJECTS: "[]" }, /has no Pages project woowtech-smart-web/],
      [{ FAKE_WRANGLER_VERSION: "4.105.0" }, /wrangler is "4\.105\.0", not 4\.149\.0/],
    ];
    for (const [env, pattern] of cases) {
      const run = deploy(fixture, { env });
      assertRefused(run, 4, pattern);
      assert.deepEqual(builds(run), [], "it built before it looked at the login");
    }

    // wrangler would read a login in ~/.wrangler instead of wrangler-pages.
    mkdirSync(path.join(fixture.home, ".wrangler"));
    const legacy = deploy(fixture);
    assertRefused(legacy, 4, /\.wrangler exists/);
    assert.deepEqual(legacy.wrangler, [], "wrangler ran with ~/.wrangler there");
  },
);

test(
  "the login is checked again right before the upload, after a build of about 20 minutes",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const broader = JSON.stringify({
      ...OWNER_LOGIN,
      tokenPermissions: [...OWNER_LOGIN.tokenPermissions, "workers_scripts:write"],
    });
    const run = deploy(fixture, { env: { FAKE_WHOAMI_LATER: broader } });

    assertRefused(run, 4, /scopes beyond .*workers_scripts:write/);
    assert.equal(builds(run).length, 1, "the first check passed and the build ran");
    assert.equal(run.wrangler.filter((call) => call.args[0] === "whoami").length, 2);
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
  // The export that failed the check is still there for --write-baseline and for a person to look at.
  assert.ok(existsSync(path.join(fixture.out, "index.html")));
});

test(
  "a failed upload, an old deployment or a site that does not match exits 5 or 6, with what to roll back to",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    // Production runs this very commit as deployment d0: nothing to acknowledge.
    const env = { FAKE_PREVIOUS: productionRuns(fixture.sha, "d0") };

    const failed = deploy(fixture, { env: { ...env, FAKE_DEPLOY_EXIT: "1" } });
    assert.equal(failed.status, 5, failed.output);
    // The exact deployment production ran before this upload, its commit and its dashboard page.
    assert.match(
      failed.output,
      new RegExp(`production ran deployment d0 \\(commit ${fixture.sha.slice(0, 7)}\\)`),
    );
    assert.match(
      failed.output,
      new RegExp(`https://dash\\.cloudflare\\.com/${ACCOUNT_ID}/pages/view/woowtech-smart-web/d0`),
    );
    assert.match(failed.output, /Rollback to this deployment/);
    assert.match(failed.output, /wrangler may have made the deployment before it failed/);

    const first = deploy(fixture, { env: { FAKE_DEPLOY_EXIT: "1" } });
    assert.equal(first.status, 5, first.output);
    assert.match(first.output, /nothing to roll back to/);

    const stale = deploy(fixture, { env: { ...env, FAKE_DEPLOYED_SHA: "0".repeat(40) } });
    assert.equal(stale.status, 6, stale.output);
    assert.match(stale.output, /Rollback to this deployment/);

    // The right commit, but not as the production deployment of the main branch.
    for (const change of [{ FAKE_DEPLOYED_ENV: "Preview" }, { FAKE_DEPLOYED_BRANCH: "other" }]) {
      const run = deploy(fixture, { env: { ...env, ...change } });
      assert.equal(run.status, 6, `${JSON.stringify(change)}: ${run.output}`);
      assert.match(run.output, /the latest production deployment is not [0-9a-f]{7} on main/);
      assert.match(run.output, /Rollback to this deployment/);
    }

    const mismatch = deploy(fixture, {
      env: { ...env, FAKE_VERIFY_EXIT: "1", WOOW_VERIFY_ATTEMPTS: "2" },
    });
    assert.equal(mismatch.status, 6, mismatch.output);
    assert.equal(mismatch.verify.length, 2, "verify-live.mjs was not retried");
    assert.match(mismatch.output, /does not serve this export/);
    for (const run of [failed, first, stale, mismatch]) {
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

test(
  "production only goes forward: what it runs now must be an ancestor, or a person at a terminal says otherwise",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const sha7 = fixture.sha.slice(0, 7);
    // A commit that exists here and is not an ancestor of HEAD: work on a side branch.
    git(fixture.repo, ["checkout", "-q", "-b", "side"], fixture.gitEnv);
    const side = commitOnTop(fixture, "Side work");
    git(fixture.repo, ["checkout", "-q", "main"], fixture.gitEnv);
    const answer = (text) => {
      const file = path.join(fixture.root, "answer");
      writeFileSync(file, `${text}\n`);
      return file;
    };
    const sideways = { FAKE_PREVIOUS: productionRuns(side) };
    const allow = { WOOW_ALLOW_DOWNGRADE: "1" };

    const refused = deploy(fixture, { env: sideways });
    assertRefused(refused, 2, /not an ancestor of HEAD/);
    assert.match(refused.output, /WOOW_ALLOW_DOWNGRADE=1/);
    // The switch needs a terminal: an agent without one cannot downgrade production, and
    // WOOW_CONFIRM_SHA is not an answer typed by a person.
    assertRefused(
      deploy(fixture, { env: { ...sideways, ...allow, WOOW_CONFIRM_SHA: fixture.sha } }),
      2,
      /needs a terminal to answer at/,
    );
    // A terminal without the switch is not enough either.
    assertRefused(
      deploy(fixture, { env: { ...sideways, WOOW_TTY: answer(sha7) } }),
      2,
      /not an ancestor of HEAD/,
    );
    assertRefused(
      deploy(fixture, { env: { ...sideways, ...allow, WOOW_TTY: answer("0000000") } }),
      2,
      /is not [0-9a-f]{7}: nothing was uploaded/,
    );
    const allowed = deploy(fixture, { env: { ...sideways, ...allow, WOOW_TTY: answer(sha7) } });
    assert.equal(allowed.status, 0, allowed.output);
    assert.equal(uploads(allowed).length, 1);

    // A commit this repository does not have, even after the fetch.
    const unknown = { FAKE_PREVIOUS: productionRuns("abcdef0") };
    assertRefused(deploy(fixture, { env: unknown }), 2, /a commit this repository does not have/);
    const unknownAllowed = deploy(fixture, {
      env: { ...unknown, ...allow, WOOW_TTY: answer(sha7) },
    });
    assert.equal(unknownAllowed.status, 0, unknownAllowed.output);

    // A list wrangler printed that cannot be read says nothing about the commit either.
    assertRefused(
      deploy(fixture, { env: { FAKE_PREVIOUS: "not json" } }),
      2,
      /could not read which commit production runs/,
    );
    // A newest deployment without a commit, too.
    assertRefused(
      deploy(fixture, { env: { FAKE_PREVIOUS: JSON.stringify([{ Id: "d0", Source: "" }]) } }),
      2,
      /could not read which commit production runs/,
    );

    // Going forward, or redeploying the same commit, asks for nothing.
    const same = deploy(fixture, { env: { FAKE_PREVIOUS: productionRuns(fixture.sha) } });
    assert.equal(same.status, 0, same.output);
  },
);

test(
  "a production upload stops until a change to the guard files is acknowledged, and says how",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    const first = deploy(fixture, { ack: null });
    const hash = guardHash(fixture, EMPTY_TREE);

    // The first deploy has no earlier commit to compare with: every guard file is new.
    assert.equal(first.status, 7, first.output);
    assert.deepEqual(uploads(first), []);
    assert.match(first.output, /there is no earlier production commit/);
    for (const file of GUARD_FILES) {
      assert.match(first.output, new RegExp(`A\\s+${escapeRegExp(file)}`));
    }
    assert.match(first.output, new RegExp(`guard diff hash: ${hash}\\b`));
    assert.match(first.output, /show the diff above to the owner in chat and wait for a yes/);
    assert.match(first.output, new RegExp(`WOOW_ACK_GUARD_DIFF=${hash}`));

    const second = deploy(fixture, { ack: null, env: { WOOW_ACK_GUARD_DIFF: hash } });
    assert.equal(second.status, 0, second.output);
    assert.match(
      second.output,
      new RegExp(`WOOW_ACK_GUARD_DIFF acknowledges the guard diff ${hash}`),
    );
    assertRefused(
      deploy(fixture, { ack: null, env: { WOOW_ACK_GUARD_DIFF: "0".repeat(12) } }),
      7,
      /is not this diff's hash/,
    );

    // A guard file that changed since the commit production runs.
    const previous = fixture.sha;
    const runs = { FAKE_PREVIOUS: productionRuns(previous) };
    const newSha = commitOnTop(fixture, "Loosen the checks", {
      "woowtech/web/verify-live.mjs": `${FAKE_VERIFY}// weaker\n`,
    });
    const changedHash = guardHash(fixture, previous);
    const changed = deploy(fixture, { ack: null, env: runs });
    assert.equal(changed.status, 7, changed.output);
    assert.deepEqual(uploads(changed), []);
    assert.match(
      changed.output,
      new RegExp(`changed since production \\(${previous.slice(0, 7)}\\)`),
    );
    assert.match(changed.output, /M\s+woowtech\/web\/verify-live\.mjs/);
    assert.match(changed.output, /^\+\/\/ weaker$/m);
    assert.match(changed.output, new RegExp(`guard diff hash: ${changedHash}\\b`));

    // At a terminal the hash can be typed instead; WOOW_CONFIRM_SHA covers the commit's own prompt.
    const typed = path.join(fixture.root, "typed");
    writeFileSync(typed, `${changedHash}\n`);
    const confirmed = { WOOW_TTY: typed, WOOW_CONFIRM_SHA: newSha.slice(0, 9) };
    const prompted = deploy(fixture, { ack: null, env: { ...runs, ...confirmed } });
    assert.equal(prompted.status, 0, prompted.output);
    writeFileSync(typed, `${"0".repeat(12)}\n`);
    assertRefused(
      deploy(fixture, { ack: null, env: { ...runs, ...confirmed } }),
      7,
      /is not [0-9a-f]{12}: nothing was uploaded/,
    );

    // A long diff is cut for the screen; the hash still covers all of it.
    const long = Array.from({ length: 400 }, (_, index) => `// line ${index}`).join("\n");
    commitOnTop(fixture, "Much more", {
      "woowtech/web/verify-live.mjs": `${FAKE_VERIFY}${long}\n`,
    });
    const cut = deploy(fixture, { ack: null, env: runs });
    assert.equal(cut.status, 7, cut.output);
    assert.match(cut.output, /\.\.\. \(\d+ more lines; the hash covers the whole diff\)/);
    assert.match(cut.output, new RegExp(`guard diff hash: ${guardHash(fixture, previous)}\\b`));
  },
);

test(
  "a commit subject that starts with a dash is refused, and any other subject reaches wrangler as one argument",
  { skip: needsNode22 },
  (t) => {
    // wrangler reads "--commit-message --cwd=<dir>" as two options: --cwd would make it build
    // <dir>/functions into a Worker in front of the site.
    const dash = deployFixture(t, { subject: "--cwd=/tmp/elsewhere" });
    const refused = deploy(dash);
    assertRefused(refused, 2, /the commit subject starts with "-"/);
    assert.deepEqual(builds(refused), []);
    assert.deepEqual(refused.wrangler, []);

    const subject = 'Ship "the" web app: v2 | 渥屋 $HOME `date` --branch=evil';
    const odd = deployFixture(t, { subject });
    const run = deploy(odd);
    assert.equal(run.status, 0, run.output);
    const { args } = uploads(run)[0];
    assert.equal(args.length, 9);
    assert.deepEqual(
      args.filter((arg) => arg.startsWith("--commit-message=")),
      [`--commit-message=${subject}`],
    );
    assert.equal(args.filter((arg) => arg.startsWith("--branch")).length, 1);
  },
);

// --- at a terminal (macOS's script(1) gives the script a pseudo-terminal) ---

// Runs the command on a pseudo-terminal with `ANSWER` already waiting as its input. The input is
// held open until the command is done: closing it earlier ends it with ^D, which the prompt reads.
const PTY_RUN = `#!/bin/sh
flag=$1
log=$2
shift 2
{
  printf '%s\\n' "$ANSWER"
  i=0
  while [ ! -e "$flag" ] && [ "$i" -lt 3000 ]; do
    i=$((i + 1))
    sleep 0.2
  done
} | {
  script -q /dev/null "$@" >"$log" 2>&1
  rc=$?
  : >"$flag"
  exit "$rc"
}
`;
const ptySkip =
  needsNode22 ||
  (process.platform !== "darwin" && "the pseudo-terminal test drives macOS's script(1)") ||
  (!existsSync("/usr/bin/script") && "script(1) is missing: no pseudo-terminal test");

function deployAtTerminal(fixture, answer, env = {}) {
  resetLogs(fixture);
  const helper = path.join(fixture.root, "pty-run.sh");
  writeTool(helper, PTY_RUN);
  const flag = path.join(fixture.root, `pty-done-${Date.now()}`);
  const log = path.join(fixture.root, `pty-${Date.now()}.log`);
  const fullEnv = runEnv(fixture, {
    WOOW_ACK_GUARD_DIFF: guardHash(fixture, EMPTY_TREE),
    ...env,
    ANSWER: answer,
  });
  const result = spawnSync(
    "/bin/sh",
    [helper, flag, log, path.join(fixture.checkout, DEPLOY_SCRIPT)],
    { env: fullEnv, encoding: "utf8", timeout: 300_000 },
  );
  return collect(fixture, result.status, readFileSync(log, "utf8").replaceAll("\r", ""));
}

test(
  "at a terminal the script asks for the commit, and no wrangler call gets the terminal",
  { skip: ptySkip },
  (t) => {
    const fixture = deployFixture(t);
    const sha7 = fixture.sha.slice(0, 7);

    const wrong = deployAtTerminal(fixture, "0000000");
    assert.match(
      wrong.output,
      new RegExp(`type the first 7 characters of ${fixture.sha} to upload it to production`),
    );
    assertRefused(wrong, 2, /"0000000" is not [0-9a-f]{7}: nothing was uploaded/);
    assert.ok(wrong.wrangler.length > 0);
    // wrangler on a terminal would be interactive: an expired login would start wrangler's own
    // login with its broad default scopes instead of failing.
    assertWranglerEnvironment(fixture, wrong);

    const right = deployAtTerminal(fixture, sha7);
    assert.equal(right.status, 0, right.output);
    assert.equal(uploads(right).length, 1);
    assertWranglerEnvironment(fixture, right);
    assert.doesNotMatch(right.output, /without a confirmation/);
  },
);

test(
  "--logout ends the login in the clean environment and proves it",
  { skip: needsNode22 },
  (t) => {
    const fixture = deployFixture(t);
    // A logout is for emergencies: it does not care about the worktree.
    writeFileSync(path.join(fixture.repo, "stray.txt"), "x\n");
    const pages = deploy(fixture, { args: ["--logout"], env: HOSTILE_WRANGLER_ENV });
    assert.equal(pages.status, 0, pages.output);
    assert.deepEqual(kinds(pages), ["logout", "whoami --json"]);
    assertWranglerEnvironment(fixture, pages);
    assert.match(pages.output, /has no login now/);
    assert.deepEqual(builds(pages), []);

    const reports = deploy(fixture, { args: ["--logout", "reports"], env: HOSTILE_WRANGLER_ENV });
    assert.equal(reports.status, 0, reports.output);
    assertWranglerEnvironment(fixture, reports, "wrangler-reports");

    // A logout that does not take is not a logout.
    const kept = deploy(fixture, { args: ["--logout"], env: { FAKE_LOGOUT_KEEPS: "1" } });
    assert.equal(kept.status, 4, kept.output);
    assert.match(kept.output, /still reports a login/);

    // With ~/.wrangler there, wrangler would log out of that one and report success.
    mkdirSync(path.join(fixture.home, ".wrangler"));
    const legacy = deploy(fixture, { args: ["--logout"] });
    assert.equal(legacy.status, 4, legacy.output);
    assert.match(legacy.output, /\.wrangler exists/);
    assert.deepEqual(legacy.wrangler, []);
  },
);

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

test("check-export refuses the files that change how Pages serves the site, whatever they hold", (t) => {
  // wrangler deploys <export>/_worker.js as an Advanced Mode Worker in front of every request, and
  // verify-live cannot see one that passes the content through unchanged.
  const serving = "it changes how Pages serves the site";
  for (const [file, reason] of [
    ["_worker.js", serving],
    ["_routes.json", serving],
    ["_redirects", serving],
    ["functions/index.js", "Pages Functions"],
    [".env", "an .env file"],
    ["assets/.env.local", "an .env file"],
  ]) {
    const run = checkExport(t, { files: { [file]: "x\n" } });
    assert.equal(run.status, 1, `${file}: ${run.output}`);
    assert.match(
      run.output,
      new RegExp(`${escapeRegExp(file)} must not be in the export: ${escapeRegExp(reason)}`),
      file,
    );
  }
});

test("check-export wants JavaScript only in _expo/static/js/web/", (t) => {
  for (const file of [
    "assets/extra.js",
    "extra.js",
    "_expo/static/js/web/chunk.mjs",
    "_expo/static/js/chunk.js",
    "shell.cjs",
  ]) {
    const run = checkExport(t, { files: { [file]: "export {};\n" } });
    assert.equal(run.status, 1, `${file}: ${run.output}`);
    assert.match(
      run.output,
      new RegExp(`${escapeRegExp(file)} must not be in the export: JavaScript belongs only in`),
      file,
    );
  }
  // A lazy chunk next to the entry is what Expo writes.
  const chunk = checkExport(t, {
    files: { "_expo/static/js/web/native-store-0123abcd.js": "x;\n" },
  });
  assert.equal(chunk.status, 0, chunk.output);
});

test("check-export lets data files through, and names the rest in the baseline with their SHA-256", (t) => {
  const data = {
    "assets/a.PNG": "x",
    "assets/b.woff2": "x",
    "assets/c.ttf": "x",
    "assets/d.jpeg": "x",
    "assets/e.mp3": "x",
    "_expo/static/css/f.css": "x",
    "robots.txt": "x",
    "favicon.ico": "x",
    "metadata.json": "{}",
  };
  const plain = checkExport(t, { files: data });
  assert.equal(plain.status, 0, plain.output);

  // An .svg or .xml document can hold a script, a .wasm file is code, and nothing says what a
  // file without an extension is.
  for (const file of [
    "assets/logo.svg",
    "assets/data.xml",
    "assets/engine.wasm",
    "assets/LICENSE",
  ]) {
    const content = "<svg onload='x()'/>\n";
    const unlisted = checkExport(t, { files: { [file]: content } });
    assert.equal(unlisted.status, 1, `${file}: ${unlisted.output}`);
    assert.match(
      unlisted.output,
      new RegExp(`${escapeRegExp(file)} is a kind of file this check does not allow`),
    );
    const listed = checkExport(t, {
      files: { [file]: content },
      baseline: { ...BASELINE, files: { [file]: sha256(content) } },
    });
    assert.equal(listed.status, 0, `${file}: ${listed.output}`);
    const changed = checkExport(t, {
      files: { [file]: content },
      baseline: { ...BASELINE, files: { [file]: "0".repeat(64) } },
    });
    assert.equal(changed.status, 1, `${file}: ${changed.output}`);
    assert.match(changed.output, /is not the file the baseline lists/);
  }

  // --write-baseline lists them, and what it wrote passes.
  const written = checkExport(t, {
    files: { "assets/logo.svg": "<svg/>\n" },
    args: ["--write-baseline"],
  });
  assert.equal(written.status, 0, written.output);
  assert.deepEqual(JSON.parse(readFileSync(written.baselineFile, "utf8")).files, {
    "assets/logo.svg": sha256("<svg/>\n"),
  });
  const again = spawnSync(
    process.execPath,
    [CHECK_EXPORT, written.dir, "--baseline", written.baselineFile],
    { encoding: "utf8" },
  );
  assert.equal(again.status, 0, again.stdout + again.stderr);
});

// An index.html like the one Expo writes for the single-page export (its layout, not its words).
const EXPO_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
    <link rel="manifest" href="/manifest.json" />
    <title>woowtech smart</title>
    <!-- The \`react-native-web\` recommended style reset: https://necolas.github.io/react-native-web/docs/setup/#root-element -->
    <style id="expo-reset">
      html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
      @media (prefers-color-scheme: dark) { html, body { background-color: #181b1a; } }
      #root { display: flex; width: 100%; height: 100%; flex: 1; }
    </style>
    <style>
      button, a, input, [role="button"], [tabindex], [contenteditable="true"] { -webkit-app-region: no-drag !important; }
      *:focus-visible { outline: 2px solid #20744a; outline-offset: 2px; }
    </style>
  <link rel="preload" href="/_expo/static/css/xterm-3bb1704bf6cb0876640973dc0244b4cb.css" as="style"><link rel="stylesheet" href="/_expo/static/css/xterm-3bb1704bf6cb0876640973dc0244b4cb.css"><link rel="icon" href="/favicon.ico" /></head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  <script src="/${ENTRY}" defer></script>
</body>
</html>
`;

test("check-export reads index.html's tags: the Expo layout passes, and no script, handler or URL hides", (t) => {
  const entry = `<script src="/${ENTRY}" defer></script>`;
  const page = (head, body = "", script = entry) =>
    `<!DOCTYPE html><html><head>${head}</head><body>${body}<div id="root"></div>${script}</body></html>\n`;
  const files = (html) => ({ files: { "index.html": html } });

  const expo = checkExport(t, {
    files: {
      "index.html": EXPO_INDEX_HTML,
      "_expo/static/css/xterm-3bb1704bf6cb0876640973dc0244b4cb.css": "x{}",
    },
  });
  assert.equal(expo.status, 0, expo.output);
  // The same site by its whole address is the same site.
  const absolute = checkExport(t, {
    ...files(page("", "", `<script src="https://smart.woowtech.io/${ENTRY}" defer></script>`)),
  });
  assert.equal(absolute.status, 0, absolute.output);

  const cases = [
    // data-src is not src: this script is inline code.
    [page("", `<script data-src="/${ENTRY}">alert(1)</script>`), /1 inline <script>/],
    [
      page("", "", `<script src="/${ENTRY}" onload="x()" defer></script>`),
      /event handler attribute, onload, on <script>/,
    ],
    [
      page("", "", entry).replace("<body>", '<body onload="x()">'),
      /event handler attribute, onload, on <body>/,
    ],
    // A ">" inside a quoted value does not end the tag, so the handler after it is still seen.
    [page("", '<div title=">" onclick="x()"></div>'), /event handler attribute, onclick, on <div>/],
    [page("", '<a href="javascript:alert(1)">x</a>'), /javascript: URL in href on <a>/],
    [page("", '<a href=" \tJavaScript:alert(1)">x</a>'), /javascript: URL in href on <a>/],
    [page("", '<a href="jav&#x09;ascript:alert(1)">x</a>'), /javascript: URL in href on <a>/],
    [page("", '<a href="javascript&colon;alert(1)">x</a>'), /javascript: URL in href on <a>/],
    [
      page("", "", `${entry}<script src="https://evil.example.invalid/x.js"></script>`),
      /not on this site: https:\/\/evil\.example\.invalid\/x\.js/,
    ],
    [
      page("", "", `${entry}<script src="//evil.example.invalid/x.js"></script>`),
      /not on this site: \/\/evil\.example\.invalid\/x\.js/,
    ],
    [
      page("", "", `${entry}<script src="/\\evil.example.invalid/x.js"></script>`),
      /not on this site/,
    ],
  ];
  for (const [html, pattern] of cases) {
    const run = checkExport(t, files(html));
    assert.equal(run.status, 1, `${pattern}: ${run.output}`);
    assert.match(run.output, pattern);
  }
  // A foreign script the baseline lists is the baseline's decision (the CSP still blocks it).
  const listed = checkExport(t, {
    ...files(page("", "", `${entry}<script src="https://cdn.example.invalid/x.js"></script>`)),
    baseline: { ...BASELINE, scriptUrls: ["https://cdn.example.invalid/x.js"] },
  });
  assert.equal(listed.status, 0, listed.output);
});

test("check-export wants the counts of eval-like calls to match the baseline, up or down", (t) => {
  const more = checkExport(t, { bundle: `${BUNDLE}eval(x);\n` });
  assert.equal(more.status, 1, more.output);
  assert.match(more.output, /"eval\(" appears 1 times; the baseline allows 0/);
  // A baseline that only allows more leaves room for a later addition.
  const fewer = checkExport(t, { baseline: withSinks({ "eval(": 2 }) });
  assert.equal(fewer.status, 1, fewer.output);
  assert.match(fewer.output, /"eval\(" appears 0 times, fewer than the 2 the baseline counts/);
  const exact = checkExport(t, {
    bundle: `${BUNDLE}eval(x);eval(y);\n`,
    baseline: withSinks({ "eval(": 2 }),
  });
  assert.equal(exact.status, 0, exact.output);
});

test("check-export puts ws and wss hosts in the origin baseline", (t) => {
  const bundle = `${BUNDLE}const a="ws://collector.example.invalid/ws",b="wss://stream.example.invalid";\n`;
  const unlisted = checkExport(t, { bundle });
  assert.equal(unlisted.status, 1, unlisted.output);
  assert.match(
    unlisted.output,
    /origins not in the baseline: ws:\/\/collector\.example\.invalid wss:\/\/stream\.example\.invalid/,
  );
  const origins = [
    ...BASELINE.origins,
    "ws://collector.example.invalid",
    "wss://stream.example.invalid",
  ];
  const listed = checkExport(t, { bundle, baseline: { ...BASELINE, origins } });
  assert.equal(listed.status, 0, listed.output);
});

/** The CDN hosts a script URL must not come from, except the one jsQR URL the baseline may list. */
const CDN_SCRIPT = /^https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\b/i;
const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js";

/** Throws unless `baseline` is what check-export reads: empty, or a well-formed real one. */
function assertBaselineShape(baseline) {
  const strings = (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  assert.deepEqual(
    Object.keys(baseline).filter(
      (key) => !["origins", "scriptUrls", "sinks", "files"].includes(key),
    ),
    [],
    "unknown keys",
  );
  assert.ok(strings(baseline.origins), "origins are strings");
  assert.ok(strings(baseline.scriptUrls), "scriptUrls are strings");
  assert.ok(
    baseline.sinks && typeof baseline.sinks === "object" && !Array.isArray(baseline.sinks),
    "sinks is an object",
  );
  for (const [sink, count] of Object.entries(baseline.sinks)) {
    assert.ok(Number.isInteger(count) && count >= 0, `${sink} is a count`);
    assert.ok(Object.keys(NO_SINKS).includes(sink), `${sink} is a sink check-export counts`);
  }
  for (const [file, hash] of Object.entries(baseline.files ?? {})) {
    assert.match(hash, /^[0-9a-f]{64}$/, `${file} has a SHA-256`);
  }
  assert.deepEqual(
    baseline.scriptUrls.filter((url) => CDN_SCRIPT.test(url) && url !== JSQR_URL),
    [],
    "a script URL from a CDN other than the documented jsQR one",
  );
}

test("check-export fails while the baseline is empty", (t) => {
  const run = checkExport(t, { baseline: { origins: [], scriptUrls: [], sinks: {} } });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /not initialized/);
  // The committed baseline is empty until the first real dry run, and a well-formed one after it:
  // committing the real baseline must not turn CI red (README section 27). Whether it is the right
  // one is for the owner's review of its diff; this checks its shape.
  assertBaselineShape(readJson("woowtech/web/export-baseline.json"));
});

test("the baseline shape check catches what it is there for", () => {
  assertBaselineShape({ origins: [], scriptUrls: [], sinks: {} });
  assertBaselineShape({
    origins: ["https://smart.woowtech.io", "wss://relay.woowtech.io"],
    scriptUrls: [JSQR_URL],
    sinks: NO_SINKS,
    files: { "assets/logo.svg": "a".repeat(64) },
  });
  for (const bad of [
    { origins: "https://x", scriptUrls: [], sinks: {} },
    { origins: [], scriptUrls: [], sinks: { "eval(": -1 } },
    { origins: [], scriptUrls: [], sinks: { "eval(": 1.5 } },
    { origins: [], scriptUrls: [], sinks: { "alert(": 1 } },
    { origins: [], scriptUrls: ["https://unpkg.com/evil@1/x.js"], sinks: {} },
    { origins: [], scriptUrls: [], sinks: {}, files: { "a.svg": "not a hash" } },
    { origins: [], scriptUrls: [], sinks: {}, extra: 1 },
  ]) {
    assert.throws(() => assertBaselineShape(bad), JSON.stringify(bad));
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

test("verify-live also asks for a file that does not exist under /_expo/static/js/web/", async (t) => {
  // _headers cannot tell Pages' fallback HTML from a chunk: this answer gets the immutable header
  // and no no-transform, so an injection could be in it while the two pages above stay clean.
  const dir = exportFor(t);
  const asked = [];
  const { status, summary } = await verifyLive(
    await servePages(t, dir, (answer) => asked.push(answer.pathname)),
    dir,
  );
  assert.equal(status, 0, JSON.stringify(summary));
  assert.equal(
    asked.filter((pathname) =>
      /^\/_expo\/static\/js\/web\/verify-live-missing-[0-9a-f]+\.js$/.test(pathname),
    ).length,
    1,
    asked.join(" "),
  );
});

test("verify-live finds an injection that only the answer for a missing chunk carries", async (t) => {
  const dir = exportFor(t);
  const injectIntoFallback = (answer) => {
    if (answer.pathname.startsWith("/_expo/static/js/web/verify-live-missing-")) {
      answer.body = Buffer.from(
        String(answer.body).replace(
          "</body>",
          '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body>',
        ),
      );
    }
  };
  const { status, summary } = await verifyLive(await servePages(t, dir, injectIntoFallback), dir);
  assert.equal(status, 1, JSON.stringify(summary));
  assert.ok(
    summary.failures.some((failure) =>
      /verify-live-missing-[0-9a-f]+\.js: has challenge-platform \(injected into the answer for a missing file\)/.test(
        failure,
      ),
    ),
    JSON.stringify(summary.failures),
  );
  // The two pages were clean: only the fallback probe saw it.
  assert.ok(summary.failures.every((failure) => /verify-live-missing-/.test(failure)));
});

test("verify-live exits 3 when the site does not answer at all, and 1 when it answers wrongly", async (t) => {
  const dir = exportFor(t);
  const badGateway = (answer) => {
    answer.status = 502;
    answer.body = Buffer.from("bad gateway");
  };
  const gateway = await verifyLive(await servePages(t, dir, badGateway), dir);
  assert.equal(gateway.status, 3, JSON.stringify(gateway.summary));
  assert.equal(gateway.summary.unreachable, true);

  // Nothing is listening: a custom domain whose certificate is not ready fails like this.
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));
  const refused = await verifyLive(`http://127.0.0.1:${port}`, dir);
  assert.equal(refused.status, 3, JSON.stringify(refused.summary));
  assert.ok(
    refused.summary.failures.some((failure) => /ECONNREFUSED/.test(failure)),
    JSON.stringify(refused.summary.failures),
  );

  // One page failing is a site that answers, wrongly.
  const half = await verifyLive(
    await servePages(t, dir, (answer) => {
      if (answer.pathname === "/") answer.status = 500;
    }),
    dir,
  );
  assert.equal(half.status, 1, JSON.stringify(half.summary));
  assert.equal(half.summary.unreachable, undefined);
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

const SMOKE = path.join(repoRoot, "woowtech/web/hosted-web-smoke.mjs");
// Importing the smoke test only loads its helpers: it starts Chrome when it is the script run.
const loadSmoke = () => import(pathToFileURL(SMOKE).href);

test("hosted-web-smoke.mjs counts a loopback, private or .local host as local, whatever the port", async () => {
  const { isLocalOrPrivateHost } = await loadSmoke();
  const host = (text) => new URL(`http://${text}`).hostname;
  for (const local of [
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.8.8.8",
    "0.0.0.0",
    "[::1]",
    "[::]",
    "[::ffff:127.0.0.1]",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.5",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "[fe80::1]",
    "[fd12:3456::1]",
    "[fc00::1]",
    "printer.local",
    "2130706433",
  ]) {
    assert.equal(isLocalOrPrivateHost(host(local)), true, local);
  }
  for (const remote of [
    "smart.woowtech.io",
    "relay.woowtech.io",
    "raw.githubusercontent.com",
    "8.8.8.8",
    "11.0.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.169.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "localhost.example.com",
    "example.local.com",
    "[2001:db8::1]",
    "[::ffff:8.8.8.8]",
  ]) {
    assert.equal(isLocalOrPrivateHost(host(remote)), false, remote);
  }
});

test("hosted-web-smoke.mjs fails S1 and S8 on a public page that reaches a local address before anyone presses anything", async () => {
  const { classifyHosts } = await loadSmoke();
  const urls = [
    "https://smart.woowtech.io/",
    "https://smart.woowtech.io/_expo/static/js/web/index-x.js",
    "wss://relay.woowtech.io/ws?serverId=srv_x",
    "https://raw.githubusercontent.com/WOOWTECH/x/CHANGELOG.md",
    "data:text/plain,hello",
    "blob:https://smart.woowtech.io/0000",
  ];
  const clean = classifyHosts(urls, "https://smart.woowtech.io");
  assert.deepEqual(clean, { unexpected: [], local: [] });

  // The old check looked at localhost:6770 and nothing else: a probe of upstream's port, of
  // another loopback address or of the LAN passed it.
  for (const probe of [
    "ws://localhost:6767/ws",
    "http://127.0.0.2:6770/",
    "ws://[::1]:9/ws",
    "http://0.0.0.0:6770/",
    "http://192.168.1.20:6770/",
    "http://10.1.2.3/",
    "http://172.20.0.5/",
    "http://169.254.1.1/",
    "ws://nas.local:6770/ws",
  ]) {
    const seen = classifyHosts([...urls, probe], "https://smart.woowtech.io");
    assert.deepEqual(seen.unexpected, [], probe);
    assert.deepEqual(seen.local, [new URL(probe).host], probe);
  }
  const foreign = classifyHosts(
    [...urls, "https://collector.example.invalid/x"],
    "https://smart.woowtech.io",
  );
  assert.deepEqual(foreign, { unexpected: ["collector.example.invalid"], local: [] });

  // The local E2E page is on loopback and reaches its own daemon there; the LAN is still not expected.
  const local = classifyHosts(
    [
      "http://127.0.0.1:8788/",
      "ws://127.0.0.1:6791/ws",
      "ws://localhost:6770/ws",
      "http://192.168.1.20/",
    ],
    "http://127.0.0.1:8788",
  );
  assert.deepEqual(local, { unexpected: ["192.168.1.20"], local: [] });
});

test("hosted-web-smoke.mjs prints no pairing link, in its summary or in an error", async () => {
  const { redact } = await loadSmoke();
  const payload = Buffer.from(
    JSON.stringify({ serverId: "srv_secret", daemonPublicKeyB64: "k".repeat(43) }),
  ).toString("base64url");
  const link = `https://smart.woowtech.io/#offer=${payload}`;
  for (const text of [
    `page.goto: net::ERR_NAME_NOT_RESOLVED at ${link}`,
    `locator.fill: Timeout 30000ms exceeded.\n  - fill("${link}")`,
    `navigating to "${link}", waiting until "domcontentloaded"`,
    `{"scenario":"S3","error":"${link}"}`,
    `--pair-url ${link} --direct 127.0.0.1:6791`,
  ]) {
    const printed = redact(text, [link, payload]);
    assert.ok(!printed.includes(payload), printed);
    assert.ok(!printed.includes("srv_secret"), printed);
  }
  // A link the secrets list does not know (the forged one of S10) goes too, by its "#offer=".
  assert.equal(
    redact("at https://smart.woowtech.io/#offer=eyJh-_9=, then", []),
    "at https://smart.woowtech.io/#offer=[redacted], then",
  );
  assert.equal(
    redact("S1 ok: https://smart.woowtech.io/settings/general", []),
    "S1 ok: https://smart.woowtech.io/settings/general",
  );
});

// --- the same address and the same wrangler everywhere, for each brand ---

const scriptConstant = (name) => new RegExp(`^${name}=(\\S+)$`, "m").exec(read(DEPLOY_SCRIPT))?.[1];
const BRAND_IDS = readdirSync(path.join(repoRoot, "woowtech/brands"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();
const brandFile = (id) => readJson(`woowtech/brands/${id}.json`);

/** deploy-web.sh's preset for each brand, as { id: { PROJECT, ACCOUNT_ID, ... } }. */
function brandPresets() {
  const cases = /^case "\$BRAND" in\n([\s\S]*?)^esac$/m.exec(read(DEPLOY_SCRIPT))?.[1];
  assert.ok(cases, "deploy-web.sh has no brand presets");
  const presets = {};
  for (const [, id, body] of cases.matchAll(/^ {2}([a-z][a-z0-9-]*)\)\n([\s\S]*?)^ {4};;$/gm)) {
    presets[id] = Object.fromEntries(
      [...body.matchAll(/^ {4}([A-Z_]+)=(?:"([^"]*)"|(\S+))$/gm)].map(([, name, quoted, plain]) => [
        name,
        quoted ?? plain,
      ]),
    );
  }
  return presets;
}

test("each brand has a deploy preset that matches its file, and shares nothing with another", () => {
  const presets = brandPresets();
  assert.deepEqual(Object.keys(presets).sort(), BRAND_IDS);
  for (const id of BRAND_IDS) {
    const brand = brandFile(id);
    const preset = presets[id];
    assert.equal(preset.SITE_ORIGIN, `https://${brand.web.host}`, `${id}: the site`);
    // The address the web app sends reports to (app.config.js reads it at build time).
    assert.equal(preset.REPORT_URL, brand.services.aiContentReportUrl, `${id}: the report URL`);
    assert.match(preset.ACCOUNT_ID, /^[0-9a-f]{32}$/, `${id}: the account`);
    assert.match(preset.BASELINE, /^woowtech\/web\/export-baseline(?:\.[a-z][a-z0-9-]*)?\.json$/);
    assert.match(preset.MARKER_NAME, /^domain-attached(?:-[a-z][a-z0-9-]*)?$/);
  }
  for (const field of ["PROJECT", "ACCOUNT_ID", "SITE_ORIGIN", "BASELINE", "MARKER_NAME"]) {
    const values = BRAND_IDS.map((id) => presets[id][field]);
    assert.equal(new Set(values).size, values.length, `two brands share ${field}: ${values}`);
  }
  // woowtech smart's are the ones its site has run on since 2026-10-28.
  assert.deepEqual(
    {
      PROJECT: presets.woowtech.PROJECT,
      ACCOUNT_ID: presets.woowtech.ACCOUNT_ID,
      BASELINE: presets.woowtech.BASELINE,
      MARKER_NAME: presets.woowtech.MARKER_NAME,
    },
    {
      PROJECT: "woowtech-smart-web",
      ACCOUNT_ID,
      BASELINE: "woowtech/web/export-baseline.json",
      MARKER_NAME: "domain-attached",
    },
  );
  assert.equal(presets.apporo.ACCOUNT_ID, APPORO_ACCOUNT_ID);
  assert.equal(presets.apporo.PROJECT, "apporo-smart-web");
});

test("check-export, the smoke test and deploy-web.sh name the same site for each brand", async () => {
  const { brandChecks, baselineFor } = await import(pathToFileURL(CHECK_EXPORT).href);
  const { brandEndpoints } = await import(
    pathToFileURL(path.join(repoRoot, "woowtech/web/hosted-web-smoke.mjs")).href
  );
  const presets = brandPresets();
  for (const id of BRAND_IDS) {
    const brand = brandFile(id);
    const checks = brandChecks(id);
    assert.equal(checks.site, presets[id].SITE_ORIGIN, id);
    assert.equal(baselineFor(id), path.join(repoRoot, presets[id].BASELINE), id);
    assert.deepEqual(brandEndpoints(id), {
      site: presets[id].SITE_ORIGIN,
      reportUrl: brand.services.aiContentReportUrl,
      relayHost: brand.services.relayHost,
    });
    // Each brand's export must not carry another brand's names or addresses.
    for (const other of BRAND_IDS.filter((candidate) => candidate !== id)) {
      for (const mark of [brandFile(other).web.host, brandFile(other).services.relayHost]) {
        assert.ok(checks.forbidden.includes(mark), `${id}'s export may hold ${mark}`);
      }
    }
  }
});

test("the site is BRAND_WEB_APP's origin, and the reports Worker answers each brand's site", async () => {
  const source = "packages/protocol/src/brand-web-app.ts";
  assert.ok(existsSync(path.join(repoRoot, source)), `${source} is missing`);
  const { BRAND_WEB_APP } = await importSource(source);
  const { BRAND_ID } = await importSource("packages/protocol/src/brand-values.ts");
  const presets = brandPresets();
  assert.equal(BRAND_WEB_APP.origin, `https://${BRAND_WEB_APP.host}`);
  assert.equal(BRAND_WEB_APP.origin, presets[BRAND_ID].SITE_ORIGIN);
  // woowtech smart's Worker answers its site by default; Apporo smart's lists its origins in its
  // wrangler config (woowtech/ai-content-report-cloudrun/worker.test.mjs checks that config).
  const worker = read(
    "woowtech/ai-content-report-cloudrun/deploy/cloudflare-worker-smart-reports.js",
  );
  const origins = /const DEFAULT_ALLOWED_ORIGINS = \[([^\]]*)\]/.exec(worker)?.[1] ?? "";
  assert.ok(
    [...origins.matchAll(/"([^"]+)"/g)].some(
      ([, origin]) => origin === presets.woowtech.SITE_ORIGIN,
    ),
    `DEFAULT_ALLOWED_ORIGINS is [${origins}]`,
  );
  const apporoConfig = read(
    "woowtech/ai-content-report-cloudrun/deploy/cloudflare-worker-smart-reports.apporo.wrangler.jsonc",
  );
  const listed = /"ALLOWED_ORIGINS": "([^"]*)"/.exec(apporoConfig)?.[1].split(/[\s,]+/) ?? [];
  assert.ok(listed.includes(presets.apporo.SITE_ORIGIN), `Apporo's ALLOWED_ORIGINS is ${listed}`);
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

test("section 27 documents every setting and exit code deploy-web.sh has, and the files it hashes", () => {
  const script = read(DEPLOY_SCRIPT);
  const section = readmeSection27();
  const settings = new Set([...script.matchAll(/\bWOOW_[A-Z0-9_]+/g)].map(([name]) => name));
  assert.deepEqual(
    [...settings].filter((name) => !section.includes(name)),
    [],
    "settings the README does not mention",
  );
  const codes = new Set([...script.matchAll(/\bdie (\d+)\b/g)].map(([, code]) => code));
  const exitLine = section.split("\n").find((line) => line.startsWith("- 退出代碼："));
  assert.ok(exitLine, "section 27 has no line with the exit codes");
  for (const code of ["0", ...codes]) {
    assert.match(exitLine, new RegExp(`(?:：|，)${code} `), `exit code ${code} is not explained`);
  }
  for (const file of GUARD_FILES) {
    assert.ok(section.includes(file), `${file} is not named in section 27`);
  }
  for (const word of ["domain-attached", "--logout", "WOOW_CONFIRM_SHA"]) {
    assert.ok(section.includes(word), `${word} is not in section 27`);
  }
});
