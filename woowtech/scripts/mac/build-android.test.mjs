// build-android.sh against a fake home: a stub env.sh that sets GRADLE_USER_HOME the
// way the shared toolchain does, and a stub gradlew that records its arguments and
// Gradle environment instead of building. Nothing here starts Gradle.
//
//   node --test woowtech/scripts/mac/build-android.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("build-android.sh", import.meta.url));
const JDK17 = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
// The script refuses to start without this JDK, so these checks need it too.
const skip = existsSync(path.join(JDK17, "bin/java")) ? false : `needs ${JDK17}`;

const DEFAULT_ARGS = [
  ":app:assembleDebug",
  "--console=plain",
  `-Porg.gradle.java.installations.paths=${JDK17}`,
  "-Porg.gradle.java.installations.auto-download=false",
  "-PreactNativeArchitectures=arm64-v8a",
  "-Pkotlin.daemon.jvmargs=-Xmx1536m",
  "-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m",
  "--max-workers=4",
];

const homes = [];
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function fakeHome() {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-build-android-"));
  homes.push(home);
  const shared = path.join(home, "toolchain/gradle-home");
  mkdirSync(path.join(shared, "caches"), { recursive: true });
  const scripts = path.join(home, ".local/share/woowtech-smart");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(path.join(scripts, "env.sh"), `export GRADLE_USER_HOME='${shared}'\n`);
  const android = path.join(home, "projects/woowtech-smart/packages/app/android");
  mkdirSync(android, { recursive: true });
  const gradlew = path.join(android, "gradlew");
  writeFileSync(
    gradlew,
    [
      "#!/bin/sh",
      "{",
      "  printf 'GRADLE_USER_HOME=%s\\n' \"${GRADLE_USER_HOME-(unset)}\"",
      "  printf 'GRADLE_RO_DEP_CACHE=%s\\n' \"${GRADLE_RO_DEP_CACHE-(unset)}\"",
      '  for arg in "$@"; do printf \'ARG=%s\\n\' "$arg"; done',
      '} > "$HOME/gradlew-run.txt"',
      "",
    ].join("\n"),
  );
  chmodSync(gradlew, 0o755);
  return { home, shared };
}

/** Runs the script in `home` with only PATH, HOME and `env` set. */
function build(home, args = [], env = {}) {
  const result = spawnSync(SCRIPT, args, {
    env: { PATH: process.env.PATH, HOME: home, ...env },
    encoding: "utf8",
  });
  const runFile = path.join(home, "gradlew-run.txt");
  const lines = existsSync(runFile) ? readFileSync(runFile, "utf8").trimEnd().split("\n") : null;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    gradlew: lines && {
      args: lines.filter((line) => line.startsWith("ARG=")).map((line) => line.slice(4)),
      env: Object.fromEntries(
        lines.filter((line) => !line.startsWith("ARG=")).map((line) => line.split(/=(.*)/s, 2)),
      ),
    },
  };
}

test("without options it builds exactly as before", { skip }, () => {
  const { home, shared } = fakeHome();
  const run = build(home);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.gradlew, {
    args: DEFAULT_ARGS,
    env: { GRADLE_USER_HOME: shared, GRADLE_RO_DEP_CACHE: "(unset)" },
  });
});

test("arguments after the ABI go to gradlew", { skip }, () => {
  const { home } = fakeHome();
  const run = build(home, ["x86_64", "--offline", "--stacktrace"]);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.gradlew.args, [
    ...DEFAULT_ARGS.map((arg) =>
      arg === "-PreactNativeArchitectures=arm64-v8a" ? "-PreactNativeArchitectures=x86_64" : arg,
    ),
    "--offline",
    "--stacktrace",
  ]);
});

test("Gradle options without an ABI keep the default ABI", { skip }, () => {
  const { home } = fakeHome();
  const run = build(home, ["--offline"]);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.gradlew.args, [...DEFAULT_ARGS, "--offline"]);
});

test("WOOW_GRADLE_USER_HOME moves the Gradle home and reads the shared cache", { skip }, () => {
  const { home, shared } = fakeHome();
  const elsewhere = path.join(home, "external/gradle-home");
  mkdirSync(path.dirname(elsewhere), { recursive: true });
  const run = build(home, [], { WOOW_GRADLE_USER_HOME: elsewhere });

  assert.equal(run.status, 0, run.stderr);
  // Downloaded dependencies come from the shared home's caches, read only.
  assert.deepEqual(run.gradlew.env, {
    GRADLE_USER_HOME: elsewhere,
    GRADLE_RO_DEP_CACHE: path.join(shared, "caches"),
  });
  assert.deepEqual(run.gradlew.args, DEFAULT_ARGS);
});

test("a GRADLE_RO_DEP_CACHE the caller set wins", { skip }, () => {
  const { home } = fakeHome();
  const elsewhere = path.join(home, "external/gradle-home");
  mkdirSync(path.dirname(elsewhere), { recursive: true });
  const run = build(home, [], {
    WOOW_GRADLE_USER_HOME: elsewhere,
    GRADLE_RO_DEP_CACHE: "/copied/ro-cache",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.gradlew.env, {
    GRADLE_USER_HOME: elsewhere,
    GRADLE_RO_DEP_CACHE: "/copied/ro-cache",
  });
});

test("a Gradle home on a drive that is not mounted stops before Gradle starts", { skip }, () => {
  const { home } = fakeHome();
  const run = build(home, [], {
    WOOW_GRADLE_USER_HOME: path.join(home, "Volumes/WOOW-BUILD/woowtech-smart/gradle-home"),
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /WOOW_GRADLE_USER_HOME/);
  assert.equal(run.gradlew, null);
});

test("WOOW_DRY_RUN prints the resolved values and runs nothing", { skip }, () => {
  const { home, shared } = fakeHome();
  const elsewhere = path.join(home, "external/gradle-home");
  mkdirSync(path.dirname(elsewhere), { recursive: true });
  const run = build(home, ["x86_64", "--offline"], {
    WOOW_GRADLE_USER_HOME: elsewhere,
    WOOW_DRY_RUN: "1",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.gradlew, null);
  const printed = run.stdout.split("\n");
  assert.ok(printed.includes("ABI=x86_64"), run.stdout);
  assert.ok(printed.includes(`GRADLE_USER_HOME=${elsewhere}`), run.stdout);
  assert.ok(printed.includes(`GRADLE_RO_DEP_CACHE=${path.join(shared, "caches")}`), run.stdout);
  assert.match(run.stdout, /\.\/gradlew :app:assembleDebug .*--max-workers=4 --offline$/m);
});
