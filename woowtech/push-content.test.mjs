// woowtech smart's push notifications leave the machine through Expo, Apple and Google,
// so they carry no text from the user's work: no agent title, message preview or
// permission details, no project, workspace or file names (README, 16). The daemon
// rewrites every push in packages/server/src/server/push/woowtech-push-content.ts,
// called from createPushNotifications in push/index.ts. Upstream sends the assistant's
// message and the terminal's name and folder, so a merge can bring them back by dropping
// that call or by adding another way to Expo. These checks run the push module from
// source through tsx, with Expo's endpoint answered by a recorder, and scan the shipped
// sources for other ways to Expo.
//
//   node --test woowtech/push-content.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { tsImport } from "tsx/esm/api";

import { findInShippedSources } from "./shipped-sources.mjs";

const { createPushNotifications } = await tsImport(
  "../packages/server/src/server/push/index.ts",
  import.meta.url,
);
const { buildAgentAttentionNotificationPayload } = await tsImport(
  "../packages/protocol/src/agent-attention-notification.ts",
  import.meta.url,
);

const IDS = {
  serverId: "srv_Ab3dEf9hIjK_",
  workspaceId: "wks_0123456789abcdef",
  agentId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
};
const TERMINAL_ID = "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b";
const ROUTING_KEYS = new Set(["serverId", "workspaceId", "agentId", "terminalId", "reason"]);
const PRODUCT_NAME = { "zh-TW": "渥屋智能", en: "woowtech smart" };

// The user's text, each piece in the field upstream puts it.
const SECRET = {
  agentTitle: "Rotate Acme credentials",
  assistantMessage: "Rotated the Acme database password in secret-project",
  permissionTitle: "Run deploy-acme-prod",
  permissionDescription: "Deploys acme-billing to production",
  permissionInput: "kubectl-apply-acme",
  folder: "/Users/alex/secret-project",
  terminalName: "vim acme-notes.md",
  workspaceName: "acme-billing",
};

const silentLogger = {
  child: () => silentLogger,
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const homes = [];
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** The requests the daemon's push notifications make for `payload`, with Expo recorded. */
async function requestsToExpo(payload, language) {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-push-content-"));
  homes.push(home);
  const push = createPushNotifications({
    logger: silentLogger,
    filePath: path.join(home, "push-tokens.json"),
    language,
  });
  push.renew("ExponentPushToken[guard]");
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: String(init?.body) });
    return Response.json({ data: [{ status: "ok", id: "ticket" }] });
  };
  try {
    await push.send(payload);
  } finally {
    globalThis.fetch = realFetch;
  }
  return requests;
}

/** The one message the daemon sent to Expo, after checking that no secret is in the bytes. */
async function messageToExpo(payload, language) {
  const requests = await requestsToExpo(payload, language);
  assert.equal(requests.length, 1, "one request to Expo");
  const [{ url, body }] = requests;
  assert.match(url, /^https:\/\/exp\.host\//);
  for (const [field, text] of Object.entries(SECRET)) {
    assert.ok(!body.includes(text), `the ${field} left the machine: ${body}`);
  }
  const messages = JSON.parse(body);
  assert.equal(messages.length, 1);
  const [message] = messages;
  assert.equal(message.title, PRODUCT_NAME[language]);
  assert.deepEqual(
    Object.keys(message.data).filter((key) => !ROUTING_KEYS.has(key)),
    [],
    "data keeps only the ids the app routes a tap with, and the reason",
  );
  return message;
}

function finishedAgent(assistantMessage) {
  const notification = buildAgentAttentionNotificationPayload({
    reason: "finished",
    ...IDS,
    assistantMessage,
  });
  // Upstream could name the agent in the title and add its folder and workspace.
  return {
    ...notification,
    title: `${SECRET.agentTitle} finished`,
    data: { ...notification.data, cwd: SECRET.folder, workspaceName: SECRET.workspaceName },
  };
}

function permissionRequest() {
  return buildAgentAttentionNotificationPayload({
    reason: "permission",
    ...IDS,
    permissionRequest: {
      id: "permission-1",
      provider: "claude",
      name: "Bash",
      kind: "tool",
      title: SECRET.permissionTitle,
      description: SECRET.permissionDescription,
      input: { command: SECRET.permissionInput },
    },
  });
}

function terminalNeedsInput() {
  // As websocket-server.ts builds it.
  return {
    title: "Terminal needs input",
    body: SECRET.terminalName,
    data: {
      serverId: IDS.serverId,
      terminalId: TERMINAL_ID,
      cwd: SECRET.folder,
      workspaceId: IDS.workspaceId,
      reason: "needs_input",
    },
  };
}

for (const language of ["zh-TW", "en"]) {
  test(`a push in ${language} reaches Expo with one generic sentence per reason and the ids`, async () => {
    const finished = await messageToExpo(finishedAgent(SECRET.assistantMessage), language);
    const finishedAgain = await messageToExpo(finishedAgent("Something else entirely"), language);
    const permission = await messageToExpo(permissionRequest(), language);
    const attention = await messageToExpo(terminalNeedsInput(), language);

    assert.equal(finishedAgain.body, finished.body, "the sentence does not depend on the work");
    assert.equal(new Set([finished.body, permission.body, attention.body]).size, 3);
    assert.deepEqual(finished.data, { ...IDS, reason: "finished" });
    assert.deepEqual(permission.data, { ...IDS, reason: "permission" });
    assert.deepEqual(attention.data, {
      serverId: IDS.serverId,
      workspaceId: IDS.workspaceId,
      terminalId: TERMINAL_ID,
      reason: "needs_input",
    });
  });
}

/** `path:line` results as the files they are in. */
function filesOf(matches) {
  return [...new Set(matches.map((match) => match.replace(/:\d+$/, "")))];
}

test("the only way to Expo is createPushNotifications", () => {
  assert.deepEqual(filesOf(findInShippedSources([/exp\.host|api\/v2\/push/])), [
    "packages/server/src/server/push/push-service.ts",
  ]);
  assert.deepEqual(filesOf(findInShippedSources([/new PushService\b/])), [
    "packages/server/src/server/push/index.ts",
  ]);
  assert.deepEqual(
    findInShippedSources([/\.sendPush\(/]).map((match) => match.replace(/:\d+$/, "")),
    ["packages/server/src/server/push/index.ts"],
    "one call into the Expo sender, the default deliver",
  );
});
