// woowtech smart's push notifications go through WoowTech's push relay (push.woowtech.io),
// which writes one fixed sentence per reason in the phone's language and sends it with FCM
// (README, 16). Nothing from the user's work leaves the machine: the daemon sends the relay
// only {token, locale, reason, target}, and it never contacts Expo (exp.host). The daemon's
// deliver is wired in createPushNotifications (packages/server/src/server/push/index.ts),
// from push/woowtech-relay.ts. Upstream sends the assistant's message and the terminal's name
// and folder to Expo, so a merge can bring them back by restoring upstream's default deliver
// or by adding another way out. These checks run the push module from source through tsx,
// with every fetch answered by a recorder, and scan the shipped sources for other ways out.
//
//   node --test woowtech/push-content.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const { VoiceAssistantWebSocketServer } = await tsImport(
  "../packages/server/src/server/websocket-server.ts",
  import.meta.url,
);

const RELAY_URL = "https://push.woowtech.io/api/smart/v1/notify";
// Shaped like tokens the phones register. Fake.
const FCM_TOKEN = "fake-install-0001:APA91bFAKE_TOKEN_FOR_GUARD_TESTS_ONLY-0001";
const EXPO_TOKEN = "ExponentPushToken[guard]";

const IDS = {
  serverId: "srv_Ab3dEf9hIjK_",
  workspaceId: "wks_0123456789abcdef",
  agentId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
};
const TERMINAL_ID = "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b";

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

/**
 * Every request the daemon's push notifications make for `payload` with `registered` push
 * tokens, and the tokens left afterwards. The recorder stands in for fetch before the push
 * module exists and answers as the relay does, so nothing reaches the network.
 */
async function pushWithRecordedFetch(payload, registered, relayUrl) {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-push-content-"));
  homes.push(home);
  const filePath = path.join(home, "push-tokens.json");
  const requests = [];
  const realFetch = globalThis.fetch;
  const configuredUrl = process.env.WOOWTECH_PUSH_RELAY_URL;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method, body: String(init?.body) });
    return Response.json({ ok: true }, { status: 201 });
  };
  if (relayUrl) process.env.WOOWTECH_PUSH_RELAY_URL = relayUrl;
  else delete process.env.WOOWTECH_PUSH_RELAY_URL;
  try {
    const push = createPushNotifications({ logger: silentLogger, filePath });
    for (const token of registered) push.renew(token);
    await push.send(payload);
  } finally {
    globalThis.fetch = realFetch;
    if (configuredUrl === undefined) delete process.env.WOOWTECH_PUSH_RELAY_URL;
    else process.env.WOOWTECH_PUSH_RELAY_URL = configuredUrl;
  }
  const left = JSON.parse(readFileSync(filePath, "utf8")).subscriptions.map(({ token }) => token);
  return { requests, left };
}

/**
 * What the daemon sent the relay for `payload` and a phone registered in `locale` (next to
 * an Expo token from the official app), after checking that no secret is in the bytes.
 */
async function requestToRelay(payload, locale) {
  const phone = `wsp1:${locale}:${FCM_TOKEN}`;
  const { requests, left } = await pushWithRecordedFetch(payload, [EXPO_TOKEN, phone]);
  assert.deepEqual(
    requests.map(({ url, method }) => ({ url, method })),
    [{ url: RELAY_URL, method: "POST" }],
    "one request, to the relay, and none to Expo",
  );
  const [{ body }] = requests;
  for (const [field, text] of Object.entries(SECRET)) {
    assert.ok(!body.includes(text), `the ${field} left the machine: ${body}`);
  }
  assert.deepEqual(left, [phone], "the Expo token is revoked, not sent");
  return JSON.parse(body);
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

for (const locale of ["zh-TW", "en"]) {
  test(`a push for a phone in ${locale} reaches the relay as a reason and ids only`, async () => {
    const finished = await requestToRelay(finishedAgent(SECRET.assistantMessage), locale);
    const finishedAgain = await requestToRelay(finishedAgent("Something else entirely"), locale);
    const permission = await requestToRelay(permissionRequest(), locale);
    const attention = await requestToRelay(terminalNeedsInput(), locale);

    const phone = { token: FCM_TOKEN, locale };
    assert.deepEqual(finished, { ...phone, reason: "finished", target: IDS });
    assert.deepEqual(finishedAgain, finished, "the request does not depend on the work");
    assert.deepEqual(permission, { ...phone, reason: "permission", target: IDS });
    assert.deepEqual(attention, {
      ...phone,
      reason: "attention",
      target: {
        serverId: IDS.serverId,
        workspaceId: IDS.workspaceId,
        terminalId: TERMINAL_ID,
      },
    });
  });
}

// send() rewrites every push before a deliver sees it (woowtech-push-content.ts), so a deliver
// injected in a test or wired in later cannot get the user's text either.
test("send() hands a deliver a generic sentence, the reason and the ids, nothing else", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-push-content-"));
  homes.push(home);
  const delivered = [];
  const push = createPushNotifications({
    logger: silentLogger,
    filePath: path.join(home, "push-tokens.json"),
    language: "en",
    deliver: async (tokens, payload) => {
      delivered.push({ tokens, payload });
    },
  });
  push.renew(`wsp1:en:${FCM_TOKEN}`);

  const pushes = [
    finishedAgent(SECRET.assistantMessage),
    finishedAgent("Something else entirely"),
    permissionRequest(),
    terminalNeedsInput(),
  ];
  for (const payload of pushes) await push.send(payload);

  assert.equal(delivered.length, pushes.length);
  for (const { payload } of delivered) {
    const text = JSON.stringify(payload);
    for (const [field, secret] of Object.entries(SECRET)) {
      assert.ok(!text.includes(secret), `the ${field} reached the deliver: ${text}`);
    }
    assert.deepEqual(
      Object.keys(payload.data).filter(
        (key) => !["serverId", "workspaceId", "agentId", "terminalId", "reason"].includes(key),
      ),
      [],
      `data beyond the ids and the reason: ${text}`,
    );
  }
  const [finished, finishedAgain, permission, terminal] = delivered.map(({ payload }) => payload);
  assert.deepEqual(finishedAgain, finished, "the sentence does not depend on the work");
  assert.deepEqual(finished.data, { ...IDS, reason: "finished" });
  assert.deepEqual(permission.data, { ...IDS, reason: "permission" });
  assert.deepEqual(terminal.data, {
    serverId: IDS.serverId,
    workspaceId: IDS.workspaceId,
    terminalId: TERMINAL_ID,
    reason: "needs_input",
  });
  assert.notEqual(permission.body, finished.body, "one sentence per reason");
});

// Upstream's terminal pushes carried no reason, and the relay reads a missing reason as
// "needs your attention": a finished terminal must say so (websocket-server.ts).
test("a terminal's push names why it asks for attention", async () => {
  const sent = [];
  const daemon = {
    sessions: new Map(),
    serverId: IDS.serverId,
    logger: silentLogger,
    pushNotificationSender: {
      send: async (payload) => {
        sent.push(payload);
      },
    },
  };
  for (const reason of ["finished", "needs_input"]) {
    await VoiceAssistantWebSocketServer.prototype.broadcastTerminalAttention.call(daemon, {
      terminalId: TERMINAL_ID,
      cwd: SECRET.folder,
      workspaceId: IDS.workspaceId,
      terminalName: SECRET.terminalName,
      reason,
    });
  }

  assert.deepEqual(
    sent.map(({ data }) => data.reason),
    ["finished", "needs_input"],
  );
  // One at a time: each swaps the global fetch for its recorder.
  assert.equal((await requestToRelay(sent[0], "en")).reason, "finished");
  assert.equal((await requestToRelay(sent[1], "en")).reason, "attention");
});

test("WOOWTECH_PUSH_RELAY_URL points the daemon at another relay, still not at Expo", async () => {
  const staging = "https://staging.example.invalid/api/smart/v1/notify";
  const { requests } = await pushWithRecordedFetch(
    permissionRequest(),
    [EXPO_TOKEN, `wsp1:en:${FCM_TOKEN}`],
    staging,
  );

  assert.deepEqual(
    requests.map(({ url }) => url),
    [staging],
  );
});

/** `path:line` results as the files they are in. */
function filesOf(matches) {
  return [...new Set(matches.map((match) => match.replace(/:\d+$/, "")))];
}

test("upstream's Expo sender is the only code that names Expo, and nothing calls it", () => {
  assert.deepEqual(filesOf(findInShippedSources([/exp\.host|api\/v2\/push/])), [
    "packages/server/src/server/push/push-service.ts",
  ]);
  assert.deepEqual(findInShippedSources([/new PushService\b/, /\.sendPush\(/]), []);
  assert.deepEqual(filesOf(findInShippedSources([/push\.woowtech\.io/])), [
    "packages/server/src/server/push/woowtech-relay.ts",
  ]);
});
