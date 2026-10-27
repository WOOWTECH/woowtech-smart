// Tests for deploy/woowtech-smart-reports-deploy.sh. gcloud, curl and openssl are replaced by
// fakes on PATH that record every call and simulate the project's state, so nothing here talks to
// Google or deploys anything.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_PATH } from "./contract.mjs";
import { COUNTERS_COLLECTION, REPORTS_COLLECTION } from "./store-port.mjs";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const SCRIPT = here("./deploy/woowtech-smart-reports-deploy.sh");
const POLICY = here("./deploy/smart-reports-alert-policy.json");
const FAKE_EDGE_KEY = "FAKEEDGEKEYSENTINEL0123456789abcdef0123456789abcdef0123456789ab";
const RUN_URL = "https://smart-reports-fake-de.a.run.app";
const CHANNEL = "projects/woowtech-smart/notificationChannels/4242";

const FAKE_GCLOUD = String.raw`#!/usr/bin/env bash
# Fake gcloud: records each call and simulates the state of the project in $FAKE_STATE.
printf '%s\n' "$*" >> "$FAKE_LOG"
S="$FAKE_STATE"
group=$(printf '%s' "$*" | sed -n 's/.*--collection-group=\([^ ]*\).*/\1/p')
case "$*" in
  *"auth list"*) echo owner@example.invalid; exit 0 ;;
  *"services enable"*) exit 0 ;;
  *"firestore databases describe"*) [ -f "$S/firestore" ] && cat "$S/firestore" && exit 0; exit 1 ;;
  *"firestore databases create"*) printf 'asia-east1\tFIRESTORE_NATIVE\n' > "$S/firestore"; exit 0 ;;
  *"firestore fields ttls list"*)
    [ -f "$S/ttl-$group" ] && echo "projects/p/databases/(default)/collectionGroups/$group/fields/expiresAt"
    exit 0 ;;
  *"firestore fields ttls update"*) touch "$S/ttl-$group"; exit 0 ;;
  *"iam service-accounts describe"*) [ -f "$S/sa" ]; exit $? ;;
  *"iam service-accounts create"*) touch "$S/sa"; exit 0 ;;
  *"projects add-iam-policy-binding"*) exit 0 ;;
  *"secrets describe"*) [ -f "$S/secret" ]; exit $? ;;
  *"secrets create"*) cat > "$S/secret-value"; touch "$S/secret"; exit 0 ;;
  *"secrets add-iam-policy-binding"*) exit 0 ;;
  *"artifacts repositories describe"*) [ -f "$S/repo" ]; exit $? ;;
  *"artifacts repositories create"*) touch "$S/repo"; exit 0 ;;
  *"logging sinks describe"*) cat "$S/exclusions" 2>/dev/null; exit 0 ;;
  *"logging sinks update"*) echo smart-reports-requests >> "$S/exclusions"; exit 0 ;;
  *"builds submit"*) exit 0 ;;
  *"run deploy"*) touch "$S/service"; exit 0 ;;
  *"run services describe"*status.url*) echo "$FAKE_RUN_URL"; exit 0 ;;
  *"run services describe"*latestReadyRevisionName*) echo smart-reports-00001-abc; exit 0 ;;
  *"channels list"*) cat "$S/channel" 2>/dev/null; exit 0 ;;
  *"channels create"*) echo "$FAKE_CHANNEL" | tee "$S/channel"; exit 0 ;;
  *"channels describe"*) echo "$FAKE_CHANNEL_STATUS"; exit 0 ;;
  *"policies list"*) cat "$S/policy-name" 2>/dev/null; exit 0 ;;
  *"policies create"*)
    file=$(printf '%s' "$*" | sed -n 's/.*--policy-from-file=\([^ ]*\).*/\1/p')
    cp "$file" "$S/policy.json"
    echo projects/woowtech-smart/alertPolicies/777 > "$S/policy-name"
    exit 0 ;;
  *"logging read"*) [ -z "$FAKE_NO_LOG" ] && echo 2026-10-14T10:00:00.000Z; exit 0 ;;
esac
echo "fake gcloud: unexpected call: $*" >&2
exit 99
`;

const FAKE_CURL = String.raw`#!/usr/bin/env bash
# Fake curl: answers the checks as the deployed receiver would, unless told otherwise.
printf 'curl %s\n' "$*" >> "$FAKE_LOG"
url=$(printf '%s' "$*" | sed 's/.* //')
method=$(printf '%s' "$*" | sed -n 's/.*-X \([A-Z]*\).*/\1/p')
case "$method $url" in
  "GET "*/health) printf '%s' "$FAKE_HEALTH" ;;
  "POST "*/v1/ai-content-reports) printf '%s' "$FAKE_POST_NO_KEY" ;;
  "GET "*/v1/ai-content-reports) printf '%s' "$FAKE_GET_REPORT" ;;
  "POST "*/) printf '%s' "$FAKE_POST_ROOT" ;;
  *) printf '000' ;;
esac
`;

const FAKE_OPENSSL = `#!/usr/bin/env bash
printf 'openssl %s\\n' "$*" >> "$FAKE_LOG"
printf '%s\\n' "${FAKE_EDGE_KEY}"
`;

/** A scratch directory with the fakes on PATH, an empty project state and a call log. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "smart-reports-deploy-test-"));
  const bin = join(dir, "bin");
  const state = join(dir, "state");
  mkdirSync(bin);
  mkdirSync(state);
  for (const [name, body] of [
    ["gcloud", FAKE_GCLOUD],
    ["curl", FAKE_CURL],
    ["openssl", FAKE_OPENSSL],
  ]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  return {
    dir,
    bin,
    state,
    log,
    calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

/**
 * A clean git checkout laid out like the monorepo (the app in woowtech/ai-content-report-cloudrun,
 * something else beside it) holding a copy of the script, like a fresh clone in Cloud Shell.
 */
function cleanCheckout(dir) {
  const repo = join(dir, "repo");
  const app = join(repo, "woowtech", "ai-content-report-cloudrun");
  mkdirSync(join(app, "deploy"), { recursive: true });
  mkdirSync(join(repo, "elsewhere"));
  copyFileSync(SCRIPT, join(app, "deploy", "woowtech-smart-reports-deploy.sh"));
  copyFileSync(POLICY, join(app, "deploy", "smart-reports-alert-policy.json"));
  writeFileSync(join(app, "Dockerfile"), "FROM node:22-alpine\n");
  writeFileSync(join(repo, "elsewhere", "notes.txt"), "not part of the image\n");
  const git = (...args) =>
    spawnSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo, encoding: "utf8" },
    );
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  return { repo, app, script: join(app, "deploy", "woowtech-smart-reports-deploy.sh") };
}

function run(box, script, args, env = {}) {
  const inherited = { ...process.env };
  delete inherited.PROJECT_ID;
  delete inherited.NOTIFY_EMAIL;
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    input: "",
    env: {
      ...inherited,
      PATH: `${box.bin}:${process.env.PATH}`,
      FAKE_LOG: box.log,
      FAKE_STATE: box.state,
      FAKE_RUN_URL: RUN_URL,
      FAKE_CHANNEL: CHANNEL,
      FAKE_CHANNEL_STATUS: "UNVERIFIED",
      FAKE_NO_LOG: "",
      FAKE_HEALTH: "200",
      FAKE_POST_NO_KEY: "403",
      FAKE_GET_REPORT: "405",
      FAKE_POST_ROOT: "404",
      SMOKE_RETRY_SECONDS: "0",
      IAM_RETRY_SECONDS: "0",
      ...env,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const gcloudCalls = (box) => box.calls().filter((line) => line.startsWith("--project "));
const curlCalls = (box) => box.calls().filter((line) => line.startsWith("curl "));
const indexOf = (calls, fragment) => calls.findIndex((line) => line.includes(fragment));

test("by default it prints the plan and every command, and calls no gcloud, curl or openssl", () => {
  for (const args of [[], ["--dry-run"], ["--apply", "--dry-run"], ["--yes"]]) {
    const box = sandbox();
    const { script } = cleanCheckout(box.dir);

    const { status, output } = run(box, script, args);

    assert.equal(status, 0, output);
    assert.deepEqual(box.calls(), [], args.join(" "));
    assert.ok(output.includes("DRY RUN: nothing is called"), output);
    assert.ok(output.includes("Add --apply to run it."), output);
    for (const expected of [
      "woowtech-smart",
      "asia-east1",
      "run.googleapis.com",
      "monitoring.googleapis.com",
      "secretmanager.googleapis.com",
      "firestore databases create",
      "--type=firestore-native",
      `firestore fields ttls update expiresAt --collection-group=${REPORTS_COLLECTION} --enable-ttl`,
      `firestore fields ttls update expiresAt --collection-group=${COUNTERS_COLLECTION} --enable-ttl`,
      "iam service-accounts create smart-reports",
      "--role=roles/datastore.user",
      "secrets add-iam-policy-binding smart-reports-edge-key",
      "--role=roles/secretmanager.secretAccessor",
      "builds submit",
      "name=smart-reports-requests",
      "run deploy smart-reports",
      "--max-instances 3",
      "--concurrency 80",
      "--memory 512Mi",
      "--set-env-vars RETENTION_DAYS=30,DAILY_MAX_REPORTS=2000,GOOGLE_CLOUD_PROJECT=woowtech-smart",
      "--set-secrets EDGE_KEYS=smart-reports-edge-key:latest",
      "--allow-unauthenticated",
      "beta monitoring channels create",
      "--type=email",
      "email_address=woowtech@designsmart.com.tw",
      "monitoring policies create --policy-from-file=",
      `${REPORT_PATH}`,
    ]) {
      assert.ok(output.includes(expected), `the plan lacks: ${expected}\n${output}`);
    }
    assert.ok(!/DEBUG=/.test(output), "the receiver must never be deployed with DEBUG");
    // The plan names no role beyond the one the receiver needs, and in particular no logging role.
    const changes = output.split("\n").filter((line) => line.startsWith("   + gcloud"));
    assert.ok(changes.length > 10, output);
    assert.ok(!changes.some((line) => line.includes("logWriter")), "no logging role is granted");
    const roles = changes.flatMap((line) => line.match(/--role=\S+/g) ?? []);
    assert.deepEqual(roles.sort(), [
      "--role=roles/datastore.user",
      "--role=roles/secretmanager.secretAccessor",
    ]);
  }
});

test("a first run on an empty project creates everything, in order, and deploys the receiver", () => {
  const box = sandbox();
  const { script, app } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--apply", "--yes"]);

  assert.equal(status, 0, output);
  const calls = gcloudCalls(box);
  assert.ok(
    calls.every((line) => line.startsWith("--project woowtech-smart ")),
    calls.join("\n"),
  );
  const order = [
    "services enable",
    "firestore databases create --database=(default) --location=asia-east1 --type=firestore-native",
    `firestore fields ttls update expiresAt --collection-group=${REPORTS_COLLECTION} --enable-ttl`,
    `firestore fields ttls update expiresAt --collection-group=${COUNTERS_COLLECTION} --enable-ttl`,
    "iam service-accounts create smart-reports",
    "--role=roles/datastore.user",
    "secrets create smart-reports-edge-key --replication-policy=user-managed --locations=asia-east1 --data-file=-",
    "secrets add-iam-policy-binding smart-reports-edge-key",
    "artifacts repositories create smart-reports --repository-format=docker --location=asia-east1",
    `builds submit ${app} --tag asia-east1-docker.pkg.dev/woowtech-smart/smart-reports/smart-reports:`,
    "logging sinks update _Default --add-exclusion=name=smart-reports-requests",
    "run deploy smart-reports",
    "beta monitoring channels create",
    "monitoring policies create --policy-from-file=",
  ].map((fragment) => [fragment, indexOf(calls, fragment)]);
  for (const [fragment, index] of order) {
    assert.ok(index >= 0, `missing gcloud call: ${fragment}\n${calls.join("\n")}`);
  }
  const indexes = order.map(([, index]) => index);
  assert.deepEqual(
    indexes,
    [...indexes].sort((a, b) => a - b),
    "calls are out of order",
  );

  const deploy = calls[indexOf(calls, "run deploy smart-reports")];
  for (const flag of [
    "--region asia-east1",
    "--service-account smart-reports@woowtech-smart.iam.gserviceaccount.com",
    "--allow-unauthenticated",
    "--max-instances 3",
    "--concurrency 80",
    "--memory 512Mi",
    "--set-env-vars RETENTION_DAYS=30,DAILY_MAX_REPORTS=2000,GOOGLE_CLOUD_PROJECT=woowtech-smart",
    "--set-secrets EDGE_KEYS=smart-reports-edge-key:latest",
  ]) {
    assert.ok(deploy.includes(flag), `run deploy lacks ${flag}: ${deploy}`);
  }

  // Roles: the project gets Firestore access and nothing else; the secret is granted on the secret.
  const bindings = calls.filter((line) => line.includes("add-iam-policy-binding"));
  assert.equal(bindings.length, 2, bindings.join("\n"));
  assert.ok(
    bindings.some((line) =>
      /add-iam-policy-binding woowtech-smart .*--role=roles\/datastore\.user/.test(line),
    ),
  );
  assert.ok(
    !calls.some((line) => / add-iam-policy-binding woowtech-smart .*secretAccessor/.test(line)),
    "the secret accessor role must be granted on the secret, not on the project",
  );
  assert.ok(!calls.some((line) => line.includes("logWriter")), "no logging role");

  // The alert: the policy file gcloud was given names the channel that was just created.
  const policy = JSON.parse(readFileSync(join(box.state, "policy.json"), "utf8"));
  assert.deepEqual(policy.notificationChannels, [CHANNEL]);
  assert.equal(policy.conditions.length, 1);
  assert.ok(policy.conditions[0].conditionMatchedLog.filter.includes("ai_report_stored"));

  // The checks ran against the service URL, store nothing, and the result is reported.
  const curls = curlCalls(box);
  assert.equal(curls.length, 4, curls.join("\n"));
  assert.ok(
    curls.every((line) => line.includes(RUN_URL)),
    curls.join("\n"),
  );
  const posts = curls.filter((line) => line.includes("-X POST"));
  assert.equal(posts.length, 2);
  assert.ok(
    posts.every((line) => line.includes("-d {}") && !line.includes("x-woowtech-edge-key")),
    "the checks post an empty object and carry no edge key",
  );
  assert.ok(output.includes(`Cloud Run URL: ${RUN_URL}`), output);
  assert.ok(output.includes("start-up log line found"), output);
});

test("the edge key reaches gcloud only on stdin and is never printed", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--apply", "--yes"]);

  assert.equal(status, 0, output);
  assert.equal(readFileSync(join(box.state, "secret-value"), "utf8"), FAKE_EDGE_KEY);
  assert.ok(!output.includes(FAKE_EDGE_KEY), "the edge key was printed");
  assert.ok(
    !box.calls().some((line) => line.includes(FAKE_EDGE_KEY)),
    "the edge key was an argument",
  );
});

test("a second run changes nothing that exists and only builds and deploys again", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);
  run(box, script, ["--apply", "--yes"]);
  writeFileSync(box.log, "");
  const secretBefore = readFileSync(join(box.state, "secret-value"), "utf8");

  const { status, output } = run(box, script, ["--apply", "--yes"]);

  assert.equal(status, 0, output);
  const calls = gcloudCalls(box);
  for (const creation of [
    "firestore databases create",
    "firestore fields ttls update",
    "iam service-accounts create",
    "secrets create",
    "secrets versions add",
    "artifacts repositories create",
    "logging sinks update",
    "channels create",
    "policies create",
  ]) {
    assert.equal(indexOf(calls, creation), -1, `second run repeated: ${creation}`);
  }
  assert.ok(indexOf(calls, "builds submit") >= 0);
  assert.ok(indexOf(calls, "run deploy smart-reports") >= 0);
  assert.equal(readFileSync(join(box.state, "secret-value"), "utf8"), secretBefore);
});

test("stops before building when Firestore already exists in another location", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);
  writeFileSync(join(box.state, "firestore"), "nam5\tFIRESTORE_NATIVE\n");

  const { status, output } = run(box, script, ["--apply", "--yes"]);

  assert.notEqual(status, 0);
  assert.match(output, /cannot be moved/);
  const calls = gcloudCalls(box);
  assert.equal(indexOf(calls, "firestore databases create"), -1);
  assert.equal(indexOf(calls, "builds submit"), -1);
  assert.equal(indexOf(calls, "run deploy"), -1);
});

test("refuses to build or deploy uncommitted changes of the app folder, before calling anything", () => {
  const box = sandbox();
  const { script, app } = cleanCheckout(box.dir);
  writeFileSync(join(app, "extra.mjs"), "export default 1;\n");

  for (const args of [
    ["--apply", "--yes"],
    ["--apply", "--yes", "build"],
    ["--apply", "--yes", "deploy"],
  ]) {
    const { status, output } = run(box, script, args);
    assert.notEqual(status, 0, args.join(" "));
    assert.match(output, /uncommitted changes/);
    assert.deepEqual(box.calls(), []);
  }

  // Steps that put nothing from the folder into an image do not care.
  const { status, output } = run(box, script, ["--apply", "--yes", "ttl"]);
  assert.equal(status, 0, output);
});

test("changes elsewhere in the repository do not block a deploy: only this folder is in the image", () => {
  const box = sandbox();
  const { script, repo } = cleanCheckout(box.dir);
  writeFileSync(join(repo, "elsewhere", "notes.txt"), "edited\n");

  const { status, output } = run(box, script, ["--apply", "--yes"]);

  assert.equal(status, 0, output);
  assert.ok(indexOf(gcloudCalls(box), "run deploy smart-reports") >= 0);
});

test("refuses to build or deploy outside a git checkout", () => {
  const box = sandbox();
  const loose = join(box.dir, "loose", "app", "deploy");
  mkdirSync(loose, { recursive: true });
  copyFileSync(SCRIPT, join(loose, "woowtech-smart-reports-deploy.sh"));
  copyFileSync(POLICY, join(loose, "smart-reports-alert-policy.json"));

  const { status, output } = run(
    box,
    join(loose, "woowtech-smart-reports-deploy.sh"),
    ["--apply", "--yes"],
    {
      GIT_CEILING_DIRECTORIES: box.dir,
    },
  );

  assert.notEqual(status, 0);
  assert.match(output, /not a git checkout/);
  assert.deepEqual(box.calls(), []);
});

test("--apply without a terminal needs --yes, and calls nothing otherwise", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--apply"]);

  assert.notEqual(status, 0);
  assert.match(output, /--yes/);
  assert.deepEqual(box.calls(), []);
});

test("a step named on the command line runs alone", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--apply", "--yes", "ttl"]);

  assert.equal(status, 0, output);
  const calls = gcloudCalls(box).filter((line) => !line.includes("auth list"));
  assert.ok(calls.length > 0);
  assert.ok(
    calls.every((line) => line.includes("firestore fields ttls")),
    calls.join("\n"),
  );
  assert.equal(curlCalls(box).length, 0);
  assert.ok(output.includes("1/1 ttl"), output);

  const checkOnly = sandbox();
  const checkout = cleanCheckout(checkOnly.dir);
  const checked = run(checkOnly, checkout.script, ["--apply", "--yes", "check"]);
  assert.equal(checked.status, 0, checked.output);
  assert.equal(indexOf(gcloudCalls(checkOnly), "run deploy"), -1);
  assert.equal(curlCalls(checkOnly).length, 4);
});

test("an unknown option or step prints the usage and calls nothing", () => {
  for (const args of [["--force"], ["deploy2"], ["rollback", "apis"]]) {
    const box = sandbox();
    const { script } = cleanCheckout(box.dir);

    const { status, output } = run(box, script, args);

    assert.equal(status, 2, args.join(" "));
    assert.match(output, /--apply/);
    assert.match(output, /rollback/);
    assert.ok(!output.includes("set -euo pipefail"), "the usage text shows script code");
    assert.deepEqual(box.calls(), []);
  }
});

test("--help prints the usage", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--help"]);

  assert.equal(status, 0);
  assert.match(output, /--apply\s+run the steps/);
  assert.match(output, /apis\s+enable the Google APIs/);
  assert.deepEqual(box.calls(), []);
});

test("rollback lists what to remove and runs none of it, even with --apply", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--apply", "--yes", "rollback"]);

  assert.equal(status, 0, output);
  assert.deepEqual(box.calls(), []);
  for (const expected of [
    "run services delete smart-reports --region asia-east1",
    "monitoring policies delete",
    "beta monitoring channels delete",
    "logging sinks update _Default --remove-exclusions=smart-reports-requests",
    "artifacts repositories delete smart-reports",
    "secrets delete smart-reports-edge-key",
    `--collection-group=${REPORTS_COLLECTION} --disable-ttl`,
    `--collection-group=${COUNTERS_COLLECTION} --disable-ttl`,
    "projects remove-iam-policy-binding woowtech-smart",
    "iam service-accounts delete smart-reports@woowtech-smart.iam.gserviceaccount.com",
    "reports.woowtech.io",
  ]) {
    assert.ok(output.includes(expected), `rollback lacks: ${expected}\n${output}`);
  }
  // The stored reports go first: with the TTL policy off nothing removes them any more.
  assert.ok(output.indexOf("Delete collection") < output.indexOf("--disable-ttl"), output);
});

test("fails loudly when the deployed service does not behave like the receiver", () => {
  // The STOPPED line names what failed.
  const cases = [
    [{ FAKE_POST_NO_KEY: "201" }, /should \([^)]*\/v1\/ai-content-reports[^)]*\)/],
    [{ FAKE_HEALTH: "403" }, /should \([^)]*\/health[^)]*\)/],
    [{ FAKE_HEALTH: "000" }, /should \([^)]*\/health[^)]*\)/],
    [{ FAKE_NO_LOG: "1" }, /should \([^)]*start-up-log-line[^)]*\)/],
  ];
  for (const [env, message] of cases) {
    const box = sandbox();
    const { script } = cleanCheckout(box.dir);

    const { status, output } = run(box, script, ["--apply", "--yes"], env);

    assert.notEqual(status, 0, JSON.stringify(env));
    assert.match(output, message, JSON.stringify(env));
    assert.match(output, /edge key is not enforced/);
    assert.match(output, /allUsers/);
    assert.match(output, /container did not start/);
    assert.match(output, /grant the service account the logging role/);
    assert.match(output, /Do not point Cloudflare at it/);
    assert.ok(!output.includes("Next, in Cloudflare"), "no next steps after a failed check");
  }
});

test("PROJECT_ID points every gcloud call at another project", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--apply", "--yes"], {
    PROJECT_ID: "woowtech-smart-staging",
  });

  assert.equal(status, 0, output);
  const calls = gcloudCalls(box);
  assert.ok(calls.length > 10);
  assert.ok(
    calls.every((line) => line.startsWith("--project woowtech-smart-staging ")),
    calls.join("\n"),
  );
  assert.ok(
    calls.some((line) =>
      line.includes("smart-reports@woowtech-smart-staging.iam.gserviceaccount.com"),
    ),
  );
  assert.ok(calls.some((line) => line.includes("GOOGLE_CLOUD_PROJECT=woowtech-smart-staging")));
});

test("NOTIFY_EMAIL changes the alert address, and a bad one stops the alert step", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, ["--apply", "--yes", "alert"], {
    NOTIFY_EMAIL: "reports@example.invalid",
  });
  assert.equal(status, 0, output);
  assert.ok(
    gcloudCalls(box).some((line) => line.includes("email_address=reports@example.invalid")),
  );

  const bad = sandbox();
  const checkout = cleanCheckout(bad.dir);
  const refused = run(bad, checkout.script, ["--apply", "--yes", "alert"], {
    NOTIFY_EMAIL: "nobody",
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.output, /not an e-mail address/);
  assert.equal(indexOf(gcloudCalls(bad), "channels create"), -1);
});

test("the alert step says whether the e-mail channel still needs confirming", () => {
  const unverified = sandbox();
  const first = cleanCheckout(unverified.dir);
  const { output: openOutput } = run(unverified, first.script, ["--apply", "--yes", "alert"]);
  assert.match(
    openOutput,
    /the channel is UNVERIFIED: open the mail Google sent to woowtech@designsmart\.com\.tw/,
  );

  const verified = sandbox();
  const second = cleanCheckout(verified.dir);
  const { output: doneOutput } = run(verified, second.script, ["--apply", "--yes", "alert"], {
    FAKE_CHANNEL_STATUS: "VERIFIED",
  });
  assert.match(doneOutput, /the channel is verified/);
});

test("the alert policy file is removed from the temporary directory afterwards", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);
  const scratch = mkdtempSync(join(tmpdir(), "smart-reports-tmp-"));

  const { status, output } = run(box, script, ["--apply", "--yes", "alert"], { TMPDIR: scratch });

  assert.equal(status, 0, output);
  const left = spawnSync("ls", ["-A", scratch], { encoding: "utf8" }).stdout.trim();
  assert.equal(left, "", "the temporary directory was left behind");
});

test("the Cloudflare steps turn off the Worker's workers.dev and Preview URLs", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, []);

  assert.equal(status, 0, output);
  assert.ok(output.includes("Next, in Cloudflare"), output);
  // Those addresses are outside the woowtech.io zone, whose rule holds the per-IP rate limit.
  const cloudflare = output.slice(output.indexOf("Next, in Cloudflare")).replace(/\s+/g, " ");
  assert.ok(cloudflare.includes("Settings > Domains & Routes"), cloudflare);
  assert.ok(cloudflare.includes("turn off workers.dev and Preview URLs"), cloudflare);
  assert.ok(cloudflare.includes("must be on Workers Paid"), cloudflare);
  assert.ok(cloudflare.includes("100,000 requests a day"), cloudflare);
  assert.ok(cloudflare.includes("error 1027"), cloudflare);
  assert.ok(cloudflare.includes("reports.woowtech.io"), cloudflare);
  assert.ok(cloudflare.includes('"error":"unsupported_schema"'), cloudflare);
});

test("the Cloudflare steps name the Worker config's wrangler and pass the URL with --var", () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, []);

  assert.equal(status, 0, output);
  const cloudflare = output.slice(output.indexOf("Next, in Cloudflare")).replace(/\s+/g, " ");
  // The wrangler config and the README pin one wrangler. The step printed here names the same one:
  // an open-ended "4.36+" lets any release in, and the config's RELAY_ORIGIN placeholder is left
  // alone because the URL goes in with --var.
  const config = readFileSync(
    here("./deploy/cloudflare-worker-smart-reports.wrangler.jsonc"),
    "utf8",
  );
  const pinned = [...new Set([...config.matchAll(/wrangler@(\d+\.\d+\.\d+)/g)].map((m) => m[1]))];
  assert.equal(pinned.length, 1, `the wrangler config pins ${pinned.length} versions`);
  assert.ok(cloudflare.includes(`wrangler ${pinned[0]}`), cloudflare);
  assert.doesNotMatch(cloudflare, /wrangler \d+\.\d+\+/, cloudflare);
  assert.ok(cloudflare.includes('--var "RELAY_ORIGIN:'), cloudflare);
  assert.ok(cloudflare.includes("ai-content-report-cloudrun/README.md"), cloudflare);
});

test('the rotation steps give the Worker the new key alone, never the "old new" pair', () => {
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);

  const { status, output } = run(box, script, []);

  assert.equal(status, 0, output);
  assert.ok(output.includes("To rotate the key later"), output);
  const rotation = output.slice(output.indexOf("To rotate the key later"));
  // While rotating, the secret's latest version holds "old new". The Worker sends EDGE_KEY as one
  // header value, so pasting that whole string would make the receiver refuse every request.
  assert.match(rotation, /EDGE_KEY to the NEW key only/);
  assert.match(rotation, /Never paste the whole "old new" string/);
  assert.match(rotation, /403/);

  // The command the steps give prints the new key alone from a version holding "old new".
  const command = rotation
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("gcloud ") && line.includes("| cut "));
  assert.ok(command, rotation);
  const OLD = "OLD-FAKE-EDGE-KEY-0123456789abcdef0123456789";
  const NEW = "NEW-FAKE-EDGE-KEY-0123456789abcdef0123456789";
  writeFileSync(
    join(box.bin, "gcloud"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$FAKE_LOG"\nprintf '%s %s\\n' '${OLD}' '${NEW}'\n`,
  );
  const printed = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_LOG: box.log },
  });
  assert.equal(printed.stdout, `${NEW}\n`);
  assert.deepEqual(box.calls(), [
    "--project woowtech-smart secrets versions access latest --secret smart-reports-edge-key",
  ]);
});

test("the alert policy template is the log-based policy the receiver's log line feeds", () => {
  const template = readFileSync(POLICY, "utf8");
  assert.ok(template.includes("__CHANNEL__"));
  const policy = JSON.parse(template.replace("__CHANNEL__", CHANNEL));

  // The name the script looks the policy up by is the template's.
  const box = sandbox();
  const { script } = cleanCheckout(box.dir);
  const { output } = run(box, script, []);
  assert.ok(output.includes(`displayName="${policy.displayName}"`), output);

  // One log-match condition: Google allows no other condition next to it.
  assert.equal(policy.conditions.length, 1);
  const match = policy.conditions[0].conditionMatchedLog;
  assert.ok(match.filter.includes('resource.type="cloud_run_revision"'));
  assert.ok(match.filter.includes('resource.labels.service_name="smart-reports"'));
  assert.ok(match.filter.includes('jsonPayload.event="ai_report_stored"'));
  assert.deepEqual(match.labelExtractors, { receipt_id: "EXTRACT(jsonPayload.receiptId)" });
  // Log-based policies must carry a notification rate limit; auto close has a 30 minute minimum.
  const seconds = (duration) => Number(duration.replace(/s$/, ""));
  assert.ok(seconds(policy.alertStrategy.notificationRateLimit.period) >= 300);
  assert.ok(seconds(policy.alertStrategy.autoClose) >= 1800);
  assert.equal(policy.combiner, "OR");
  assert.equal(policy.enabled, true);
  assert.deepEqual(policy.notificationChannels, [CHANNEL]);

  // The mail carries the receipt number and nothing of the report.
  const text = `${policy.documentation.subject}\n${policy.documentation.content}`;
  const variables = text.match(/\$\{[^}]*\}/g) ?? [];
  assert.ok(variables.length >= 1);
  assert.ok(
    variables.every((variable) => variable === "${log.extracted_label.receipt_id}"),
    variables.join(),
  );
  assert.ok(!/reportedContent|reason|locale/.test(text));
  assert.equal(policy.documentation.mimeType, "text/markdown");
  assert.ok(policy.documentation.subject.length <= 255);
});

test("the names in the script are the ones the code uses", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.ok(source.includes(`REPORT_PATH=${REPORT_PATH}\n`));
  assert.ok(source.includes(`REPORTS_GROUP=${REPORTS_COLLECTION}\n`));
  assert.ok(source.includes(`COUNTERS_GROUP=${COUNTERS_COLLECTION}\n`));
  assert.ok(source.includes("RETENTION_DAYS=30\n"));
  assert.ok(source.includes("DAILY_MAX=2000\n"));
});
