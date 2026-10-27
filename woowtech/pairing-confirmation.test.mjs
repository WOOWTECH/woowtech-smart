// woowtech smart asks before a pairing link, a scanned QR code, a pasted link, a probe or a
// direct connection adds or changes a host (woowtech/README.md, 第 19 節; upstream asks since
// 364e6456e). The question lives in fork files (packages/app/src/runtime/woowtech-host-
// confirmations.ts, woowtech-pairing-confirmation.ts, hosts/woowtech-host-confirmation-sheet.tsx);
// upstream's files only call it. A merge can drop one of those calls, move it after the probe or
// the save, bring in a new way to add a host, or put the boot probe back on public pages. These
// checks read the sources; each one is also run against altered copies to show it fails.
//
//   node --test woowtech/pairing-confirmation.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";

const APP_SRC = "packages/app/src";
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\{\/\*)/;

function read(file) {
  return readFileSync(path.join(repoRoot, APP_SRC, file), "utf8");
}

function codeLines(source) {
  return source.split("\n").filter((line) => !COMMENT_LINE.test(line));
}

function withoutCommentLines(source) {
  return codeLines(source).join("\n");
}

/** The text from `header` to the next line that is exactly `closing`, or null. */
function block(source, header, closing) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  const lines = source.slice(start).split("\n");
  const end = lines.findIndex((line, index) => index > 0 && line === closing);
  return end === -1 ? null : lines.slice(0, end + 1).join("\n");
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

// (a) The scanner and the paste field ask before they probe the relay or save the host.
const ASK = /if \(!\(await confirmPairingLink\(\w+\)\)\) return;/;

function asksBeforeConnecting(source) {
  const code = withoutCommentLines(source);
  const asked = code.search(ASK);
  if (asked === -1) return ["never asks: no `if (!(await confirmPairingLink(…))) return;`"];
  const problems = [];
  for (const call of ["connectToDaemon(", "upsertDaemonFromOfferUrl("]) {
    const at = code.indexOf(call);
    if (at === -1) problems.push(`no ${call} call to ask before`);
    else if (at < asked) problems.push(`${call} comes before the question`);
  }
  return problems;
}

// (b) handlePairingLink clears the address bar, then asks, then imports.
function pairingLinkOrder(source) {
  const body = block(source, "export async function handlePairingLink(", "}");
  if (!body) return ["handlePairingLink is gone"];
  const steps = [
    "(handlers.clearLink ?? clearPairingLinkFromAddressBar)()",
    "(handlers.confirm ?? defaultConfirm)(",
    "handlers.importOffer(",
  ].map((step) => ({ step, at: body.indexOf(step) }));
  const problems = steps.filter(({ at }) => at === -1).map(({ step }) => `missing ${step}`);
  for (let index = 1; index < steps.length; index += 1) {
    const before = steps[index - 1];
    const after = steps[index];
    if (before.at !== -1 && after.at !== -1 && before.at > after.at) {
      problems.push(`${after.step} comes before ${before.step}`);
    }
  }
  return problems;
}

// (c) Every way to add or change a host, and every place that parses an offer, with the files
// allowed to use it. A new caller (an upstream merge) must go through the question first.
const ALLOWED_CALLERS = {
  upsertConnectionFromOfferUrl: [
    "runtime/host-runtime.ts",
    "app/_layout.tsx",
    "app/pair-scan.tsx",
    "components/pair-link-modal.tsx",
  ],
  upsertConnectionFromOffer: ["runtime/host-runtime.ts"],
  upsertRelayConnection: ["runtime/host-runtime.ts"],
  probeAndUpsertConnection: ["runtime/host-runtime.ts"],
  upsertDirectConnection: ["runtime/host-runtime.ts"],
  probeAndUpsertDirectConnection: [
    "runtime/host-runtime.ts",
    "components/add-host-modal.tsx",
    "hosts/woowtech-this-computer-action.ts",
  ],
  probeAndUpsertRemoteSshConnection: [
    "runtime/host-runtime.ts",
    "components/add-remote-ssh-host-modal.tsx",
  ],
  upsertConnectionFromListen: ["runtime/host-runtime.ts", "runtime/daemon-start-service.ts"],
  "ConnectionOfferSchema.parse": [
    "runtime/host-runtime.ts",
    "app/pair-scan.tsx",
    "components/pair-link-modal.tsx",
    "runtime/woowtech-offer-link.ts",
  ],
};

function callersOutsideTheAllowList(files) {
  const names = Object.keys(ALLOWED_CALLERS);
  const hits = [];
  for (const { file, source } of files) {
    const mentioned = names.filter((name) => source.includes(name));
    if (mentioned.length === 0) continue;
    const lines = codeLines(source);
    for (const name of mentioned) {
      if (ALLOWED_CALLERS[name].includes(file)) continue;
      const pattern = new RegExp(`\\b${name.replace(".", "\\.")}\\b`);
      if (lines.some((line) => pattern.test(line))) hits.push(`${file}: ${name}`);
    }
  }
  return hits;
}

function appSources() {
  const root = path.join(repoRoot, APP_SRC);
  return [...shippedSourceFiles(root, /\.[cm]?[jt]sx?$/)].map((absolute) => ({
    file: path.relative(root, absolute).split(path.sep).join("/"),
    source: readFileSync(absolute, "utf8"),
  }));
}

// (d) The sheet is mounted once at the app root, under no condition, so a question asked while
// the app starts is shown.
function sheetMounted(layout) {
  const lines = layout.split("\n");
  const mounts = lines
    .map((text, at) => ({ text, at }))
    .filter((candidate) => candidate.text.includes("<WoowtechHostConfirmationSheet"));
  if (mounts.length !== 1) return [`mounted ${mounts.length} times`];
  const mount = mounts[0];
  const problems = [];
  if (!/^\s*<WoowtechHostConfirmationSheet\s*\/>$/.test(mount.text)) {
    problems.push(`mounted with props or a condition: ${mount.text.trim()}`);
  }
  const previous = lines.slice(0, mount.at).findLast((candidate) => candidate.trim() !== "");
  if (previous && /(?:\(|&&|\?|:)\s*$/.test(previous)) {
    problems.push(`mounted under a condition: ${previous.trim()}`);
  }
  if (
    !layout.includes(
      'import { WoowtechHostConfirmationSheet } from "@/hosts/woowtech-host-confirmation-sheet";',
    )
  ) {
    problems.push("not imported");
  }
  return problems;
}

// (e) The probe asks after it learns who answered and before it saves; the boot probe of
// localhost, and the configured daemon's (EXPO_PUBLIC_LOCAL_DAEMON), run only where the policy
// says so.
const POLICY_RETURN = "if (!shouldAutoProbeLocalhost()) return;";
const BOOT_PROBES = ["this.bootstrapDefaultLocalhost(", "this.bootstrapConfiguredOverride("];

function hostRuntimeHooks(runtime) {
  const problems = [];
  const probe = block(runtime, "  async probeAndUpsertConnection(input: {", "  }");
  if (!probe) {
    problems.push("probeAndUpsertConnection is gone");
  } else {
    const connected = probe.indexOf("await this.deps.connectToDaemon(");
    const asked = probe.search(/await confirmProbedHost\(\{[^}]*\bclient\b[^}]*\}\)/);
    const saved = probe.indexOf("this.upsertHostConnection(");
    if (asked === -1) problems.push("the probe never asks (confirmProbedHost with its client)");
    if (connected === -1 || saved === -1) problems.push("the probe no longer connects and saves");
    if (asked !== -1 && connected !== -1 && asked < connected) {
      problems.push("the probe asks before it knows who answered");
    }
    if (asked !== -1 && saved !== -1 && asked > saved)
      problems.push("the probe saves before it asks");
  }
  const boot = block(runtime, "  private async runBoot(): Promise<void> {", "  }");
  if (!boot) {
    problems.push("runBoot is gone");
  } else {
    const code = withoutCommentLines(runtime);
    const bootCode = withoutCommentLines(boot);
    const policy = bootCode.indexOf(POLICY_RETURN);
    if (policy === -1) problems.push("runBoot does not ask shouldAutoProbeLocalhost()");
    for (const call of BOOT_PROBES) {
      if (count(code, call) !== count(bootCode, call)) {
        problems.push(`${call} is also called outside runBoot, without the policy`);
      }
      const first = bootCode.indexOf(call);
      if (first !== -1 && first < policy) problems.push(`runBoot calls ${call} before the policy`);
    }
  }
  return problems;
}

// (f) A probe the user said no to closes quietly: no "unable to connect", the form stays open.
function declinedCatch(source, call) {
  const at = source.indexOf(call);
  if (at === -1) return [`no ${call}`];
  const catchAt = source.indexOf("} catch (error) {", at);
  if (catchAt === -1) return [`no catch after ${call}`];
  const first = codeLines(source.slice(catchAt).split("\n").slice(1).join("\n")).find(
    (line) => line.trim() !== "",
  );
  return first?.trim() === "if (isHostConfirmationDeclined(error)) return;"
    ? []
    : [`the catch after ${call} starts with ${first?.trim()}`];
}

// (g) "Connect to this computer" probes the address the boot probe used.
function thisComputerEndpoint(runtime, action) {
  const bootEndpoint = /const LOCALHOST_FALLBACK_ENDPOINT = "([^"]+)";/.exec(runtime)?.[1];
  const buttonEndpoint = /const THIS_COMPUTER_ENDPOINT = "([^"]+)";/.exec(action)?.[1];
  const problems = [];
  if (!bootEndpoint || bootEndpoint !== buttonEndpoint) {
    problems.push(`the button probes ${buttonEndpoint}, the boot probe ${bootEndpoint}`);
  }
  if (
    !/probeAndUpsertDirectConnection\(\{\s*endpoint: THIS_COMPUTER_ENDPOINT,?\s*\}\)/.test(action)
  ) {
    problems.push("the button does not probe THIS_COMPUTER_ENDPOINT");
  }
  return problems;
}

// (h) host-runtime.ts imports the confirmation store, so the store imports host-runtime.ts for
// types only; anything more is an import cycle.
function importsHostRuntimeAtRuntime(source) {
  const problems = [];
  const statements = source.match(/^\s*(?:import|export)\b[^;]*?["'][^"']+["'];?/gm) ?? [];
  for (const statement of statements) {
    if (!/["'](?:\.\/|@\/runtime\/)host-runtime["']/.test(statement)) continue;
    if (!/^\s*import\s+type\s/.test(statement)) problems.push(statement.trim());
  }
  if (/\b(?:import|require)\(\s*["'][^"']*host-runtime["']/.test(source)) {
    problems.push("loads host-runtime at run time");
  }
  return problems;
}

const PAIR_SCAN = read("app/pair-scan.tsx");
const PAIR_LINK_MODAL = read("components/pair-link-modal.tsx");
const PAIRING_LINK = read("runtime/woowtech-pairing-link.ts");
const LAYOUT = read("app/_layout.tsx");
const HOST_RUNTIME = read("runtime/host-runtime.ts");
const ADD_HOST_MODAL = read("components/add-host-modal.tsx");
const ADD_SSH_HOST_MODAL = read("components/add-remote-ssh-host-modal.tsx");
const THIS_COMPUTER = read("hosts/woowtech-this-computer-action.ts");
const CONFIRMATIONS = read("runtime/woowtech-host-confirmations.ts");

function replaceOnce(source, from, to) {
  assert.equal(count(source, from), 1, `the fixture expects one ${JSON.stringify(from)}`);
  return source.replace(from, to);
}

test("the scanner and the paste field ask before they connect", () => {
  assert.deepEqual(asksBeforeConnecting(PAIR_SCAN), []);
  assert.deepEqual(asksBeforeConnecting(PAIR_LINK_MODAL), []);

  const question = /^.*if \(!\(await confirmPairingLink\(\w+\)\)\) return;\n/m;
  const probed = "await client.close().catch(() => undefined);\n";
  for (const source of [PAIR_SCAN, PAIR_LINK_MODAL]) {
    const line = question.exec(source)?.[0];
    assert.ok(line, "the fixture needs the question");
    const unasked = source.replace(line, "");
    assert.notDeepEqual(asksBeforeConnecting(unasked), [], "question removed");
    const late = replaceOnce(unasked, probed, `${probed}${line}`);
    assert.notDeepEqual(asksBeforeConnecting(late), [], "question moved after the probe");
  }
});

test("a pairing link is cleared from the address bar, then asked about, then imported", () => {
  assert.deepEqual(pairingLinkOrder(PAIRING_LINK), []);

  const clear = "(handlers.clearLink ?? clearPairingLinkFromAddressBar)();\n";
  const confirm = "const approved = await (handlers.confirm ?? defaultConfirm)(url, hosts);\n";
  const importing = "const profile = await handlers.importOffer(url);\n";
  assert.notDeepEqual(pairingLinkOrder(replaceOnce(PAIRING_LINK, clear, "\n")), []);
  assert.notDeepEqual(pairingLinkOrder(replaceOnce(PAIRING_LINK, confirm, "\n")), []);
  const confirmAfterImport = replaceOnce(
    replaceOnce(PAIRING_LINK, confirm, "\n"),
    importing,
    `${importing}    ${confirm}`,
  );
  assert.notDeepEqual(pairingLinkOrder(confirmAfterImport), [], "asks after importing");
  // The handlers interface names importOffer( before the function: only the body counts.
  assert.ok(
    PAIRING_LINK.indexOf("importOffer(") <
      PAIRING_LINK.indexOf("export async function handlePairingLink("),
  );
});

test("only the known files add hosts or parse offers", () => {
  assert.deepEqual(callersOutsideTheAllowList(appSources()), []);

  const newEntry = {
    file: "components/new-pairing-entry.tsx",
    source: "  void store.upsertConnectionFromOfferUrl(link);\n",
  };
  const quietRelay = {
    file: "screens/import.ts",
    source: "const host = await upsertRelayConnection(input);\n",
  };
  const ownParse = {
    file: "utils/offer.ts",
    source: "return ConnectionOfferSchema.parse(payload);\n",
  };
  const comment = {
    file: "utils/notes.ts",
    source: "// upsertConnectionFromOfferUrl saves the host\n",
  };
  assert.deepEqual(callersOutsideTheAllowList([newEntry, quietRelay, ownParse, comment]), [
    "components/new-pairing-entry.tsx: upsertConnectionFromOfferUrl",
    "screens/import.ts: upsertRelayConnection",
    "utils/offer.ts: ConnectionOfferSchema.parse",
  ]);
  // upsertConnectionFromOffer is not upsertConnectionFromOfferUrl.
  assert.deepEqual(
    callersOutsideTheAllowList([
      { file: "app/pair-scan.tsx", source: "upsertConnectionFromOfferUrl(" },
    ]),
    [],
  );
});

test("the app root mounts the confirmation sheet once, under no condition", () => {
  assert.deepEqual(sheetMounted(LAYOUT), []);

  const mount = "        <WoowtechHostConfirmationSheet />\n";
  assert.notDeepEqual(sheetMounted(replaceOnce(LAYOUT, mount, "")), [], "removed");
  assert.notDeepEqual(sheetMounted(replaceOnce(LAYOUT, mount, `${mount}${mount}`)), [], "twice");
  assert.notDeepEqual(
    sheetMounted(
      replaceOnce(LAYOUT, mount, "        {isWeb ? <WoowtechHostConfirmationSheet /> : null}\n"),
    ),
    [],
    "conditional on one line",
  );
  assert.notDeepEqual(
    sheetMounted(replaceOnce(LAYOUT, mount, `        {isNative && (\n  ${mount}        )}\n`)),
    [],
    "conditional over lines",
  );
});

test("the host runtime asks after a probe and probes localhost at boot only by the policy", () => {
  assert.deepEqual(hostRuntimeHooks(HOST_RUNTIME), []);

  const hook =
    /^\s*\/\/ woowtech smart: a probe cannot prove who answered[^\n]*\n\s*await confirmProbedHost\([\s\S]*?\}\);\n/m;
  const hookText = hook.exec(HOST_RUNTIME)?.[0];
  assert.ok(hookText, "the fixture needs the probe hook");
  assert.notDeepEqual(hostRuntimeHooks(HOST_RUNTIME.replace(hookText, "")), [], "hook removed");

  const connect = "    const { client, serverId, hostname } = await this.deps.connectToDaemon({";
  const early = HOST_RUNTIME.replace(hookText, "").replace(connect, `${hookText}${connect}`);
  assert.notDeepEqual(hostRuntimeHooks(early), [], "asks before it knows who answered");

  const policy = "    if (!shouldAutoProbeLocalhost()) return;\n";
  const unconditional = replaceOnce(HOST_RUNTIME, policy, "");
  assert.notDeepEqual(hostRuntimeHooks(unconditional), [], "unconditional");
  // The old shape guarded the default probe only; the configured daemon probed on every page.
  const defaultOnly = replaceOnce(
    unconditional,
    "    } else {\n      await this.bootstrapDefaultLocalhost();",
    "    } else if (shouldAutoProbeLocalhost()) {\n      await this.bootstrapDefaultLocalhost();",
  );
  assert.notDeepEqual(hostRuntimeHooks(defaultOnly), [], "the configured daemon is not covered");
  const late = replaceOnce(
    HOST_RUNTIME,
    `${policy}    if (override) {\n      this.bootstrapConfiguredOverride(override);`,
    `    if (override) {\n      this.bootstrapConfiguredOverride(override);\n    }\n${policy}    if (override) {\n      this.bootstrapConfiguredOverride(override);`,
  );
  assert.notDeepEqual(hostRuntimeHooks(late), [], "the policy comes after a probe");
  const extra = replaceOnce(
    HOST_RUNTIME,
    policy,
    `    void this.bootstrapDefaultLocalhost();\n${policy}`,
  );
  assert.notDeepEqual(hostRuntimeHooks(extra), [], "another call before the policy");
  const elsewhere = replaceOnce(
    HOST_RUNTIME,
    "  private markHostRegistryLoaded(): void {",
    "  private warm(): void {\n    void this.bootstrapDefaultLocalhost();\n  }\n\n  private markHostRegistryLoaded(): void {",
  );
  assert.notDeepEqual(hostRuntimeHooks(elsewhere), [], "another call outside runBoot");
});

test("the direct and SSH forms close quietly when the user says no", () => {
  assert.deepEqual(declinedCatch(ADD_HOST_MODAL, "await probeAndUpsertDirectConnection("), []);
  assert.deepEqual(
    declinedCatch(ADD_SSH_HOST_MODAL, "await probeAndUpsertRemoteSshConnection("),
    [],
  );

  const declined = "      if (isHostConfirmationDeclined(error)) return;\n";
  assert.notDeepEqual(
    declinedCatch(
      replaceOnce(ADD_HOST_MODAL, declined, ""),
      "await probeAndUpsertDirectConnection(",
    ),
    [],
  );
  assert.notDeepEqual(
    declinedCatch(
      replaceOnce(ADD_SSH_HOST_MODAL, declined, ""),
      "await probeAndUpsertRemoteSshConnection(",
    ),
    [],
  );
});

test("Connect to this computer probes the boot probe's address", () => {
  assert.deepEqual(thisComputerEndpoint(HOST_RUNTIME, THIS_COMPUTER), []);

  const moved = replaceOnce(
    THIS_COMPUTER,
    'const THIS_COMPUTER_ENDPOINT = "localhost:6770";',
    'const THIS_COMPUTER_ENDPOINT = "localhost:6767";',
  );
  assert.notDeepEqual(thisComputerEndpoint(HOST_RUNTIME, moved), []);
  const elsewhere = THIS_COMPUTER.replace(
    "endpoint: THIS_COMPUTER_ENDPOINT",
    'endpoint: "127.0.0.1:6770"',
  );
  assert.notDeepEqual(thisComputerEndpoint(HOST_RUNTIME, elsewhere), []);
});

test("the confirmation store imports the host runtime for its types only", () => {
  assert.deepEqual(importsHostRuntimeAtRuntime(CONFIRMATIONS), []);

  assert.deepEqual(
    importsHostRuntimeAtRuntime('import type { HostRuntimeStore } from "./host-runtime";\n'),
    [],
  );
  for (const statement of [
    'import { getHostRuntimeStore } from "./host-runtime";\n',
    'import { type HostRuntimeStore } from "@/runtime/host-runtime";\n',
    'import {\n  getHostRuntimeStore,\n} from "./host-runtime";\n',
    'export { getHostRuntimeStore } from "./host-runtime";\n',
    'const runtime = await import("./host-runtime");\n',
  ]) {
    assert.notDeepEqual(importsHostRuntimeAtRuntime(statement), [], statement);
  }
});
