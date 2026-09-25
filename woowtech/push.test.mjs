// woowtech smart's pushes go through WoowTech's push relay with FCM on both platforms, never
// through Expo (woowtech/README.md, 第 16 節). The fork changes a few upstream files for it, and
// a merge can put any of them back:
// - packages/server/src/server/push/index.ts: without an injected deliver, pushes go to the
//   relay (WOOWTECH_PUSH_RELAY_URL), carrying only token, locale, reason and target.
// - packages/server/src/server/websocket-server.ts and packages/protocol/src/messages.ts:
//   server_info.features.woowtechPush, which the app waits for before it registers a token.
// - packages/app/src/push-notifications/index.native.ts: the phone apps subscribe through
//   woowtech-subscriptions.ts. Upstream's subscriptions.ts stays in the tree, unused: it asks
//   Expo for a push token and registers it with any daemon.
// - packages/app/react-native.config.js (with plugins/woowtech-ios-firebase.js): React Native
//   Firebase stays off Android, where expo-notifications gives the FCM token, and off iOS
//   builds without a GoogleService-Info.plist.
// The relay repo owns the request contract; packages/protocol/tests/fixtures keeps a byte for
// byte copy of its fixture, which the daemon's check must agree with.
//
// These checks run the sources through tsx (source-modules.mjs). Their imports from other
// packages read those packages' dist, so build them first: npm run build:server. Nothing
// leaves the machine: fetch reaches only a local stand-in for the relay.
//
//   node --test woowtech/push.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import diagnosticsChannel from "node:diagnostics_channel";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { findInShippedSources, repoRoot } from "./shipped-sources.mjs";
import { importSource } from "./source-modules.mjs";

// Every fetch the code under test makes lands here, before any source is loaded. Only the
// local stand-in for the relay is reached; any other address is answered here the way the
// relay answers, so a merge that brings back upstream's Expo sender fails these checks
// without sending anything to exp.host.
const fetched = [];
const reachableOrigins = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  fetched.push(url.href);
  if (reachableOrigins.has(url.origin)) return realFetch(input, init);
  return Response.json({ ok: true }, { status: 201 });
};

// Requests that reach the network stack, whether through fetch (undici) or node:http.
const opened = [];
diagnosticsChannel.subscribe("undici:request:create", ({ request }) => {
  opened.push(new URL(request.path, String(request.origin)).href);
});
diagnosticsChannel.subscribe("http.client.request.start", ({ request }) => {
  opened.push(`${request.protocol}//${request.host}${request.path}`);
});

const { createPushNotifications } = await importSource("packages/server/src/server/push/index.ts");
const { VoiceAssistantWebSocketServer } = await importSource(
  "packages/server/src/server/websocket-server.ts",
);
const { Session } = await importSource("packages/server/src/server/session.ts");
const { parseServerInfoStatusPayload, WSInboundMessageSchema } = await importSource(
  "packages/protocol/src/messages.ts",
);
const { validateRelayNotifyBody } = await importSource("packages/protocol/src/woowtech-push.ts");

// Shaped like what the phones register and the daemon generates. Fake.
const FCM_TOKEN = "fake-install-0001:APA91bFAKE_TOKEN_FOR_GUARD_TESTS_ONLY-0001";
const EXPO_TOKEN = "ExponentPushToken[guard-0001]";
const IDS = {
  serverId: "srv_Ab3dEf9hIjK_",
  workspaceId: "wks_0123456789abcdef",
  agentId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
};

// Text from the user's work, where upstream puts it in a push.
const MARKERS = {
  title: "guard-marker-title-Acme-rotation",
  body: "guard-marker-body-rotated-the-Acme-password",
  cwd: "/Users/alex/guard-marker-cwd-secret-project",
};

const silentLogger = {
  child: () => silentLogger,
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const cleanups = [];
after(async () => {
  for (const cleanup of cleanups.toReversed()) await cleanup();
});

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A local stand-in for push.woowtech.io: keeps each request and answers 201 as the relay does. */
async function startFakeRelay() {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        path: request.url,
        contentType: request.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/smart/v1/notify`;
  reachableOrigins.add(new URL(url).origin);
  return { url, requests };
}

/** The requests made while `action` runs: what fetch was asked for, and what got opened. */
async function requestsDuring(action) {
  fetched.length = 0;
  opened.length = 0;
  await action();
  return { fetched: [...fetched], opened: [...opened] };
}

test("the daemon pushes to WOOWTECH_PUSH_RELAY_URL with four fields, and nowhere else", async () => {
  const relay = await startFakeRelay();
  const configuredUrl = process.env.WOOWTECH_PUSH_RELAY_URL;
  process.env.WOOWTECH_PUSH_RELAY_URL = relay.url;
  try {
    // As the daemon creates it (websocket-server.ts): no deliver of its own.
    const push = createPushNotifications({
      logger: silentLogger,
      filePath: path.join(tempDir("woowtech-push-"), "push-tokens.json"),
    });
    push.renew(`wsp1:zh-TW:${FCM_TOKEN}`);
    // What the official Paseo app registers. The relay cannot use it, and Expo never gets it.
    push.renew(EXPO_TOKEN);

    const requests = await requestsDuring(() =>
      push.send({
        title: `Agent finished: ${MARKERS.title}`,
        body: MARKERS.body,
        data: { ...IDS, reason: "finished", cwd: MARKERS.cwd },
      }),
    );

    assert.deepEqual(
      requests,
      { fetched: [relay.url], opened: [relay.url] },
      "one request, to the relay",
    );
    assert.equal(relay.requests.length, 1);
    const [{ method, path: requestPath, contentType, body }] = relay.requests;
    assert.deepEqual(
      [method, requestPath, contentType],
      ["POST", "/api/smart/v1/notify", "application/json"],
    );
    for (const [field, marker] of Object.entries(MARKERS)) {
      assert.ok(!body.includes(marker), `the push's ${field} left the machine: ${body}`);
    }
    assert.deepEqual(JSON.parse(body), {
      token: FCM_TOKEN,
      locale: "zh-TW",
      reason: "finished",
      target: IDS,
    });
  } finally {
    if (configuredUrl === undefined) delete process.env.WOOWTECH_PUSH_RELAY_URL;
    else process.env.WOOWTECH_PUSH_RELAY_URL = configuredUrl;
  }
});

test("the daemon's server_info tells the app that it pushes through the relay", () => {
  // buildServerInfoStatusPayload reads a few fields of the running server; these are enough.
  const daemon = { serverId: IDS.serverId, daemonVersion: "0.0.0-guard" };
  const session = { getPermissions: () => [] };
  const serverInfo = VoiceAssistantWebSocketServer.prototype.buildServerInfoStatusPayload.call(
    daemon,
    session,
  );

  // As the app reads it: the protocol's schema drops the fields it does not know.
  assert.equal(
    parseServerInfoStatusPayload(serverInfo)?.features?.woowtechPush,
    true,
    "server_info.features.woowtechPush, without which the app registers no push token",
  );
});

test("the daemon stores the app's register_push_token string as it is, a wsp1 string too", async () => {
  // As DaemonClient.registerPushToken sends it, and as websocket-server.ts parses it.
  const token = `wsp1:en:${FCM_TOKEN}`;
  const parsed = WSInboundMessageSchema.safeParse({
    type: "session",
    message: { type: "register_push_token", token },
  });
  assert.ok(parsed.success, `the daemon refuses the app's register_push_token: ${parsed.error}`);

  const delivered = [];
  const push = createPushNotifications({
    logger: silentLogger,
    filePath: path.join(tempDir("woowtech-push-register-"), "push-tokens.json"),
    language: "en",
    deliver: async (tokens) => {
      delivered.push(tokens);
    },
  });
  // The session's message dispatch, with the few fields it reads for this message.
  const clientMetadata = { pushToken: null };
  const session = {
    pushNotifications: push,
    sessionLogger: silentLogger,
    currentClientMetadata: () => clientMetadata,
    handleRegisterPushToken: Session.prototype.handleRegisterPushToken,
    emit() {},
  };
  await Session.prototype.dispatchMiscMessage.call(session, parsed.data.message);
  await push.send({ title: "t", body: "b", data: { ...IDS, reason: "finished" } });

  assert.deepEqual(delivered, [[token]], "the push store's tokens at the next push");
  assert.equal(clientMetadata.pushToken, token, "the string the heartbeat renews");
});

// The phone apps' code, as Metro bundles it from the app's entry point.
const APP_SOURCES = { dirs: ["packages/app/src"], files: ["packages/app/index.ts"] };
const PUSH_ENTRY = "packages/app/src/push-notifications/index.native.ts";
const UPSTREAM_SUBSCRIPTIONS = "packages/app/src/push-notifications/internal/subscriptions.ts";
// A module specifier that names upstream's subscriptions.ts, relative or through the @/ alias.
const NAMES_UPSTREAM_SUBSCRIPTIONS = /["'](?:\.{1,2}\/|@\/)(?:[^"']*\/)?subscriptions(?:\.ts)?["']/;

/** The module each name of `source`'s `import { … } from "…"` statements comes from. */
function importedFrom(source) {
  const from = {};
  for (const [, names, specifier] of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    for (const name of names.split(",")) {
      const imported = name
        .replace(/^\s*type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (imported) from[imported] = specifier;
    }
  }
  return from;
}

/** `path:line` results as the files they are in. */
function filesOf(matches) {
  return [...new Set(matches.map((match) => match.replace(/:\d+$/, "")))];
}

test("the phone apps subscribe through woowtech-subscriptions, never upstream's", () => {
  const entry = readFileSync(path.join(repoRoot, PUSH_ENTRY), "utf8");
  const from = importedFrom(entry);

  assert.deepEqual(
    {
      startSubscription: from.startSubscription,
      revokeSubscription: from.revokeSubscription,
      turnOffExpoPushRegistration: from.turnOffExpoPushRegistration,
    },
    {
      startSubscription: "./internal/woowtech-subscriptions",
      revokeSubscription: "./internal/woowtech-subscriptions",
      turnOffExpoPushRegistration: "./internal/woowtech-subscriptions",
    },
    PUSH_ENTRY,
  );
  // At app start, whether or not the app has hosts: an older build left expo-notifications
  // uploading the device token to Expo at every launch.
  assert.match(
    entry,
    /^void turnOffExpoPushRegistration\(\);$/m,
    `${PUSH_ENTRY} no longer turns Expo's push registration off when it loads`,
  );
  assert.deepEqual(
    findInShippedSources([NAMES_UPSTREAM_SUBSCRIPTIONS], APP_SOURCES),
    [],
    "app code that loads upstream's subscriptions.ts",
  );
});

test("only upstream's unused subscriptions.ts asks Expo for a push token", () => {
  // The F-Droid build's stand-in for expo-notifications (src/fdroid/expo-notifications.ts)
  // defines the function, which is not a call.
  const mentions = findInShippedSources([/getExpoPushTokenAsync/], {
    ...APP_SOURCES,
    allowLines: [/^export async function getExpoPushTokenAsync\(\) \{$/],
  });

  assert.deepEqual(filesOf(mentions), [UPSTREAM_SUBSCRIPTIONS], mentions.join(", "));
});

const APP_ROOT = path.join(repoRoot, "packages/app");
const RN_FIREBASE = ["@react-native-firebase/app", "@react-native-firebase/messaging"];

// What `expo-modules-autolinking react-native-config` links of each React Native Firebase package,
// with the steps it takes for one package (build/reactNativeConfig/reactNativeConfig.js): load the
// app's react-native.config.js, merge its entry over the package's own config, resolve.
const AUTOLINKING_CHILD = `
const path = require("node:path");
const { createRequire } = require("node:module");
const [appRoot, platform, ...names] = process.argv.slice(1);
const appRequire = createRequire(path.join(appRoot, "package.json"));
const { loadConfigAsync } = appRequire("expo-modules-autolinking/build/reactNativeConfig/config");
const { resolveReactNativeModule } = appRequire(
  "expo-modules-autolinking/build/reactNativeConfig/reactNativeConfig",
);
(async () => {
  const projectConfig = await loadConfigAsync(appRoot);
  const linked = {};
  for (const name of names) {
    const packageJson = appRequire.resolve(name + "/package.json");
    const packagePath = path.dirname(packageJson);
    const resolution = {
      name,
      version: appRequire(packageJson).version,
      path: packagePath,
      originPath: packagePath,
      duplicates: null,
      depth: 0,
      source: 0,
    };
    const module = await resolveReactNativeModule(resolution, projectConfig, platform, new Set());
    const config = module?.platforms?.[platform] ?? null;
    linked[name] = config && {
      podspec: config.podspecPath ? path.basename(config.podspecPath) : null,
      scriptPhases: (config.scriptPhases ?? []).map((phase) => phase.name),
    };
  }
  process.stdout.write(JSON.stringify(linked));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

/**
 * React Native Firebase as autolinking links it for `platform`, in a fresh process with only
 * the app variant and its GoogleService-Info.plist variable set (react-native.config.js reads
 * them when it loads). The plist is a path to a file that exists or not.
 */
function autolinkedRnFirebase(platform, { variant, plist }) {
  const plistVariable =
    variant === "development"
      ? "GOOGLE_SERVICE_INFO_PLIST_DEBUG"
      : "GOOGLE_SERVICE_INFO_PLIST_PROD";
  const stdout = execFileSync(
    process.execPath,
    ["-e", AUTOLINKING_CHILD, APP_ROOT, platform, ...RN_FIREBASE],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        APP_VARIANT: variant,
        [plistVariable]: plist,
      },
      encoding: "utf8",
      // The resolver warns about a missing plist; the checks read only stdout.
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(stdout);
}

test("React Native Firebase links on iOS only, and only with a GoogleService-Info.plist", () => {
  const dir = tempDir("woowtech-push-plist-");
  const plist = path.join(dir, "GoogleService-Info.plist");
  writeFileSync(plist, "<plist/>");
  const missing = path.join(dir, "missing.plist");
  const nowhere = Object.fromEntries(RN_FIREBASE.map((name) => [name, null]));

  assert.deepEqual(
    autolinkedRnFirebase("android", { variant: "production", plist }),
    nowhere,
    "Android, where a second FirebaseMessagingService would take expo-notifications' messages",
  );
  for (const variant of ["production", "development"]) {
    assert.deepEqual(
      autolinkedRnFirebase("ios", { variant, plist: missing }),
      nowhere,
      `an iOS ${variant} build without a plist`,
    );
  }

  // With a plist, iOS keeps the package's own settings: "[RNFB] Core Configuration" applies
  // firebase.json, which turns FCM auto-init and APNs auto-registration off.
  const ios = autolinkedRnFirebase("ios", { variant: "production", plist });
  assert.equal(ios["@react-native-firebase/app"]?.podspec, "RNFBApp.podspec");
  assert.ok(
    ios["@react-native-firebase/app"].scriptPhases.includes("[RNFB] Core Configuration"),
    `iOS build phases without [RNFB] Core Configuration: [${ios["@react-native-firebase/app"].scriptPhases.join(", ")}]`,
  );
  assert.equal(ios["@react-native-firebase/messaging"]?.podspec, "RNFBMessaging.podspec");
});

const CONTRACT_FIXTURE = "packages/protocol/tests/fixtures/smart-notify-v1.fixtures.json";

test("the relay's contract fixture is here, and the daemon's check agrees with every case", () => {
  // A copy of the relay repo's functions/test/fixtures/smart-notify-v1.fixtures.json.
  const fixturePath = path.join(repoRoot, CONTRACT_FIXTURE);
  assert.ok(existsSync(fixturePath), `${CONTRACT_FIXTURE} is missing`);
  const contract = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.deepEqual([contract.contract, contract.version], ["POST /api/smart/v1/notify", 1]);
  assert.ok(contract.valid.length > 0 && contract.invalid.length > 0, "the fixture has no cases");

  for (const { name, body } of contract.valid) {
    assert.deepEqual(validateRelayNotifyBody(body), { ok: true, value: body }, name);
  }
  for (const { name, body, field } of contract.invalid) {
    assert.deepEqual(validateRelayNotifyBody(body), { ok: false, field }, name);
  }
});
