import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  encodePushToken,
  InvalidFcmTokenError,
  parsePushToken,
  pushLocaleFor,
  relayNotifyBodyFor,
  relayReasonFor,
  relayTargetFor,
  validateRelayNotifyBody,
  type PushLocale,
  type RelayNotifyBody,
  type RelayReason,
  type WoowtechPushToken,
} from "./woowtech-push.js";

// Shaped like an FCM registration token: an install id, a colon, then the rest. Fake.
const FCM_TOKEN = "fake-install-0001:APA91bFAKE_TOKEN_FOR_CONTRACT_TESTS_ONLY-0001";

describe("the push token string the app registers with its daemon", () => {
  it("carries the app's language and the FCM token, and parses back", () => {
    const value = encodePushToken({ locale: "zh-TW", fcmToken: FCM_TOKEN });

    expect(value).toBe(`wsp1:zh-TW:${FCM_TOKEN}`);
    expect(parsePushToken(value)).toEqual({ locale: "zh-TW", fcmToken: FCM_TOKEN });
  });

  it("keeps every colon of the FCM token", () => {
    const fcmToken = "fake-install-0002:APA91b:FAKE:TOKEN_WITH_COLONS-0002";

    expect(parsePushToken(encodePushToken({ locale: "en", fcmToken }))).toEqual({
      locale: "en",
      fcmToken,
    });
  });

  it("is not a token the official Paseo app or an older woowtech smart build registers", () => {
    expect(parsePushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBeNull();
    expect(parsePushToken(`wsp2:en:${FCM_TOKEN}`)).toBeNull();
    expect(parsePushToken(`WSP1:en:${FCM_TOKEN}`)).toBeNull();
    expect(parsePushToken(`:en:${FCM_TOKEN}`)).toBeNull();
    expect(parsePushToken("wsp1")).toBeNull();
    expect(parsePushToken("wsp1:en")).toBeNull();
    expect(parsePushToken("")).toBeNull();
  });

  it("names zh-TW or en and nothing else", () => {
    for (const locale of ["zh-CN", "zh-tw", "zh", "ja", "EN", ""]) {
      expect(parsePushToken(`wsp1:${locale}:${FCM_TOKEN}`)).toBeNull();
    }
  });

  it("cannot be encoded with any other language, which the daemon would refuse", () => {
    for (const locale of ["zh-CN", "zh-tw", "ja", ""]) {
      expect(() => encodePushToken({ locale: locale as PushLocale, fcmToken: FCM_TOKEN })).toThrow(
        RangeError,
      );
    }
  });
});

describe("the language a phone's pushes are written in", () => {
  it("is Traditional Chinese for every Chinese app language, as the app shows them", () => {
    for (const appLocale of ["zh-TW", "zh-CN", "zh", "zh-Hant", "zh-Hans", "zh-HK", "zh_TW"]) {
      expect(pushLocaleFor(appLocale)).toBe("zh-TW");
    }
  });

  it("is English for every other language", () => {
    for (const appLocale of ["en", "en-US", "ja", "ko", "fr", "pt-BR", "zhx", "", "unknown"]) {
      expect(pushLocaleFor(appLocale)).toBe("en");
    }
  });
});

describe("why the relay says the daemon pushed", () => {
  it("follows the reason the agent or terminal gave", () => {
    expect(relayReasonFor({ reason: "finished" })).toBe("finished");
    expect(relayReasonFor({ reason: "permission" })).toBe("permission");
  });

  it("asks for attention for every other reason, or none", () => {
    expect(relayReasonFor({ reason: "error" })).toBe("attention");
    expect(relayReasonFor({ reason: "needs_input" })).toBe("attention");
    expect(relayReasonFor({ reason: "Finished" })).toBe("attention");
    expect(relayReasonFor({ reason: 1 })).toBe("attention");
    expect(relayReasonFor({})).toBe("attention");
    expect(relayReasonFor(undefined)).toBe("attention");
  });
});

describe("where a tapped push opens (the target sent to the relay)", () => {
  const SERVER_ID = "srv_Ab3dEf9hIjK_";
  const WORKSPACE_ID = "wks_0123456789abcdef";
  const AGENT_ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
  const TERMINAL_ID = "00000000-0000-4000-8000-000000000000";

  it("keeps the ids of an agent or a terminal in the shapes the daemon generates", () => {
    expect(
      relayTargetFor({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID }),
    ).toEqual({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID });
    expect(
      relayTargetFor({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, terminalId: TERMINAL_ID }),
    ).toEqual({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, terminalId: TERMINAL_ID });
    expect(relayTargetFor({ serverId: "srv_-_0aZ9zA-_09" })).toEqual({
      serverId: "srv_-_0aZ9zA-_09",
    });
  });

  it("drops an id in any other shape, which could be the user's text", () => {
    const otherShapes = [
      { serverId: "my-laptop" }, // PASEO_SERVER_ID can be any text
      { serverId: "srv_Ab3dEf9hIjK_x" },
      { serverId: "srv_Ab3dEf9hIj.K" },
      { serverId: 1 },
      { workspaceId: "/Users/alex/secret-project" }, // workspaces from before opaque ids
      { workspaceId: "wks_0123456789ABCDEF" },
      { workspaceId: "wks_0123456789abcde" },
      { workspaceId: "wks_../../etc/pas" },
      { agentId: "1B4E28BA-2FA1-41D2-883F-0016D3CCA427" },
      { agentId: "1b4e28ba2fa141d2883f0016d3cca427" },
      { agentId: "{1b4e28ba-2fa1-41d2-883f-0016d3cca427}" },
      { agentId: null },
      { terminalId: "term-1" },
      { terminalId: 7 },
    ];
    for (const data of otherShapes) {
      expect(relayTargetFor(data)).toEqual({});
    }
  });

  it("names an agent or a terminal, not both, and the app opens the agent then", () => {
    expect(
      relayTargetFor({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        agentId: AGENT_ID,
        terminalId: TERMINAL_ID,
      }),
    ).toEqual({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID });
  });

  it("never carries the title, the body, the folder or anything else from the push", () => {
    expect(
      relayTargetFor({
        title: "Rotate Acme credentials finished",
        body: "Rotated the Acme database password",
        cwd: "/Users/alex/secret-project",
        workspaceName: "acme-billing",
        reason: "finished",
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        agentId: AGENT_ID,
      }),
    ).toEqual({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID });
    expect(relayTargetFor(undefined)).toEqual({});
  });
});

describe("the request the daemon sends the relay for one phone", () => {
  it("is the FCM token, the phone's language, the reason and the target, and nothing else", () => {
    const body = relayNotifyBodyFor({
      token: { locale: "zh-TW", fcmToken: FCM_TOKEN },
      data: {
        serverId: "srv_Ab3dEf9hIjK_",
        workspaceId: "wks_0123456789abcdef",
        agentId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
        reason: "finished",
      },
    });

    expect(JSON.stringify(body)).toBe(
      `{"token":"${FCM_TOKEN}","locale":"zh-TW","reason":"finished",` +
        `"target":{"serverId":"srv_Ab3dEf9hIjK_","workspaceId":"wks_0123456789abcdef",` +
        `"agentId":"1b4e28ba-2fa1-41d2-883f-0016d3cca427"}}`,
    );
  });

  it("always sends a target, empty when no id qualifies", () => {
    expect(
      relayNotifyBodyFor({ token: { locale: "en", fcmToken: FCM_TOKEN }, data: undefined }),
    ).toEqual({ token: FCM_TOKEN, locale: "en", reason: "attention", target: {} });
  });

  it("carries none of the user's text from the push", () => {
    const markers = ["MARKER-TITLE", "MARKER-BODY", "/Users/marker/secret-project", "MARKER-NAME"];
    const body = relayNotifyBodyFor({
      token: { locale: "en", fcmToken: FCM_TOKEN },
      data: {
        title: markers[0],
        body: markers[1],
        cwd: markers[2],
        terminalName: markers[3],
        workspaceId: markers[2],
        reason: markers[1],
        terminalId: "00000000-0000-4000-8000-000000000000",
      },
    });
    const bytes = JSON.stringify(body);

    for (const marker of markers) {
      expect(bytes).not.toContain(marker);
    }
    expect(Object.keys(body)).toEqual(["token", "locale", "reason", "target"]);
  });
});

describe("the FCM tokens a push token string may carry (the relay's contract)", () => {
  // A token of `length` characters that the relay accepts apart from its length.
  function fcmTokenOfLength(length: number): string {
    return `fake:${"A".repeat(length - 5)}`;
  }

  it("runs from 20 to 512 characters", () => {
    for (const length of [20, 163, 512]) {
      const fcmToken = fcmTokenOfLength(length);
      expect(parsePushToken(`wsp1:en:${fcmToken}`)).toEqual({ locale: "en", fcmToken });
    }
    for (const length of [19, 513, 4096]) {
      expect(parsePushToken(`wsp1:en:${fcmTokenOfLength(length)}`)).toBeNull();
    }
    expect(parsePushToken("wsp1:en:")).toBeNull();
  });

  it("is checked when the app encodes one, without echoing the token", () => {
    const tooLong = fcmTokenOfLength(513);

    expect(() => encodePushToken({ locale: "en", fcmToken: tooLong })).toThrow(
      InvalidFcmTokenError,
    );
    expect(() => encodePushToken({ locale: "en", fcmToken: tooLong })).not.toThrow(tooLong);
    expect(() => encodePushToken({ locale: "en", fcmToken: "no colon at all here" })).toThrow(
      InvalidFcmTokenError,
    );
  });

  it("uses letters, digits, _, - and : only, with at least one colon", () => {
    for (const fcmToken of [
      "fake-install-0001APA91bFAKE_TOKEN_NO_COLON",
      "fake-install-0001:APA91b FAKE_TOKEN_SPACE",
      "fake-install-0001:APA91b/FAKE_TOKEN_SLASH",
      "fake-install-0001:APA91b.FAKE_TOKEN_DOT",
      "fake-install-0001:APA91b+FAKE_TOKEN_PLUS",
      "fake-install-0001:APA91b=FAKE_TOKEN_EQUALS",
      "fake-install-0001:APA91bFAKE_TOKEN_NEWLINE\n",
      "fake-install-0001:APA91bFAKE_TOKEN_ÜMLAUT",
    ]) {
      expect(parsePushToken(`wsp1:en:${fcmToken}`)).toBeNull();
    }
  });
});

// The relay's request contract. The relay repo keeps the original
// (functions/test/fixtures/smart-notify-v1.fixtures.json); this copy stays byte-identical.
interface ContractCase {
  name: string;
  body: unknown;
}
interface ValidContractCase extends ContractCase {
  body: RelayNotifyBody;
}
interface InvalidContractCase extends ContractCase {
  field: string;
}
const CONTRACT = JSON.parse(
  readFileSync(new URL("../tests/fixtures/smart-notify-v1.fixtures.json", import.meta.url), "utf8"),
) as {
  contract: string;
  version: number;
  valid: ValidContractCase[];
  invalid: InvalidContractCase[];
};

describe("the relay's request contract (smart-notify-v1, shared with the relay)", () => {
  it("is version 1 of POST /api/smart/v1/notify", () => {
    expect([CONTRACT.contract, CONTRACT.version]).toEqual(["POST /api/smart/v1/notify", 1]);
    expect(CONTRACT.valid.length).toBeGreaterThan(0);
    expect(CONTRACT.invalid.length).toBeGreaterThan(0);
  });

  it.each(CONTRACT.valid)("passes the daemon's check: $name", ({ body }) => {
    expect(validateRelayNotifyBody(body)).toEqual({ ok: true, value: body });
  });

  it.each(CONTRACT.invalid)(
    "fails the daemon's check on the field the relay names: $name",
    ({ body, field }) => {
      expect(validateRelayNotifyBody(body)).toEqual({ ok: false, field });
    },
  );

  it.each(CONTRACT.valid)("is what the daemon sends: $name", ({ body }) => {
    const sent = relayNotifyBodyFor({
      token: tokenTheDaemonHolds({ locale: body.locale, fcmToken: body.token }),
      data: {
        title: "Rotate Acme credentials finished",
        body: "Rotated the Acme database password",
        cwd: "/Users/alex/secret-project",
        reason: DAEMON_REASON[body.reason],
        ...body.target,
      },
    });

    expect(JSON.stringify(sent)).toBe(JSON.stringify(body));
  });

  it.each(CONTRACT.invalid.filter(hasStringTokenAndLocale).filter(isAbout("token")))(
    "cannot be registered by the app: $name",
    ({ body }) => {
      expect(() =>
        encodePushToken({ locale: body.locale as PushLocale, fcmToken: body.token }),
      ).toThrow(InvalidFcmTokenError);
    },
  );

  it.each(CONTRACT.invalid.filter(hasStringTokenAndLocale).filter(isAbout("locale")))(
    "cannot be registered by the app: $name",
    ({ body }) => {
      expect(() =>
        encodePushToken({ locale: body.locale as PushLocale, fcmToken: body.token }),
      ).toThrow(RangeError);
    },
  );

  it.each(CONTRACT.invalid)("is never what the daemon sends: $name", ({ body }) => {
    const sent = requestsTheDaemonSendsFor(body);

    expect(sent).not.toContainEqual(body);
    expect(sent.map(validateRelayNotifyBody)).toEqual(sent.map((value) => ({ ok: true, value })));
  });
});

// The reasons agents and terminals give that the relay reads as each of its reasons.
const DAEMON_REASON: Record<RelayReason, string> = {
  finished: "finished",
  permission: "permission",
  attention: "needs_input",
};

/** The token the daemon parses from the string the app registered. */
function tokenTheDaemonHolds(token: WoowtechPushToken): WoowtechPushToken {
  const held = parsePushToken(encodePushToken(token));
  if (!held) throw new Error("The daemon refused the token string the app registered");
  return held;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStringTokenAndLocale(
  contractCase: InvalidContractCase,
): contractCase is InvalidContractCase & { body: { token: string; locale: string } } {
  return (
    isRecord(contractCase.body) &&
    typeof contractCase.body.token === "string" &&
    typeof contractCase.body.locale === "string"
  );
}

function isAbout(field: string): (contractCase: InvalidContractCase) => boolean {
  return (contractCase) => contractCase.field === field;
}

/**
 * What the daemon sends when the app registered the case's language and token, and the
 * push carried every field of the case, its target's fields included, as data.
 */
function requestsTheDaemonSendsFor(caseBody: unknown): RelayNotifyBody[] {
  const fields = isRecord(caseBody) ? caseBody : {};
  const data = { ...fields, ...(isRecord(fields.target) ? fields.target : {}) };
  const token = parsePushToken(`wsp1:${String(fields.locale)}:${String(fields.token)}`);
  return token ? [relayNotifyBodyFor({ token, data })] : [];
}
