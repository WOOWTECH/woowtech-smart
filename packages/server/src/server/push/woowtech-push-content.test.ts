import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildAgentAttentionNotificationPayload } from "@getpaseo/protocol/agent-attention-notification";

import { createPushNotifications, type PushPayload } from "./index.js";
import { pushLanguageOf, type HostLocaleSources } from "./woowtech-push-content.js";

// Ids shaped like the ones the daemon generates (server-id.ts, workspace-registry-model.ts,
// randomUUID for agents and terminals).
const SERVER_ID = "srv_Ab3dEf9hIjK_";
const WORKSPACE_ID = "wks_0123456789abcdef";
const AGENT_ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const TERMINAL_ID = "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b";

// Text from the user's work, which must stay on this machine.
const ASSISTANT_MESSAGE = "Rotated the **Acme** database password in `secret-project/.env`.";

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

const homes: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

/**
 * Push notifications with one phone registered, recording what leaves for Expo. Without
 * a language they speak the host's, as in the daemon.
 */
function pushNotificationsFor(language?: "zh-TW" | "en") {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-push-content-"));
  homes.push(home);
  const delivered: PushPayload[] = [];
  const push = createPushNotifications({
    logger: createLogger(),
    filePath: path.join(home, "push-tokens.json"),
    language,
    deliver: async (_tokens, payload) => {
      delivered.push(payload);
    },
  });
  push.renew("ExponentPushToken[phone]");
  return { push, delivered };
}

describe("push notifications leave the machine without the user's text", () => {
  test("a finished agent says the work finished, not what the agent wrote", async () => {
    const { push, delivered } = pushNotificationsFor("en");

    await push.send(
      buildAgentAttentionNotificationPayload({
        reason: "finished",
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        agentId: AGENT_ID,
        assistantMessage: ASSISTANT_MESSAGE,
      }),
    );

    expect(delivered).toEqual([
      {
        title: "woowtech smart",
        body: "Work finished — tap to see the result.",
        data: {
          serverId: SERVER_ID,
          workspaceId: WORKSPACE_ID,
          agentId: AGENT_ID,
          reason: "finished",
        },
      },
    ]);
  });

  test("a permission request says permission is needed, not what the agent asks to do", async () => {
    const { push, delivered } = pushNotificationsFor("en");

    await push.send(
      buildAgentAttentionNotificationPayload({
        reason: "permission",
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        agentId: AGENT_ID,
        permissionRequest: {
          id: "permission-1",
          provider: "claude",
          name: "Bash",
          kind: "tool",
          title: "Run rm -rf secret-project/build",
          description: "Deletes /Users/alex/secret-project/build",
          input: { command: "rm -rf secret-project/build" },
        },
      }),
    );

    expect(delivered).toEqual([
      {
        title: "woowtech smart",
        body: "Permission needed — tap to review the request.",
        data: {
          serverId: SERVER_ID,
          workspaceId: WORKSPACE_ID,
          agentId: AGENT_ID,
          reason: "permission",
        },
      },
    ]);
  });

  test("a terminal waiting for input asks for attention, without its name or folder", async () => {
    const { push, delivered } = pushNotificationsFor("en");

    // The terminal push as websocket-server.ts builds it.
    await push.send({
      title: "Terminal needs input",
      body: "vim secret-project/notes.md",
      data: {
        serverId: SERVER_ID,
        terminalId: TERMINAL_ID,
        cwd: "/Users/alex/secret-project",
        workspaceId: WORKSPACE_ID,
        reason: "needs_input",
      },
    });

    expect(delivered).toEqual([
      {
        title: "woowtech smart",
        body: "Needs your attention — tap to take a look.",
        data: {
          serverId: SERVER_ID,
          workspaceId: WORKSPACE_ID,
          terminalId: TERMINAL_ID,
          reason: "needs_input",
        },
      },
    ]);
  });

  test("ids that are not the daemon's random ids stay on the machine", async () => {
    const { push, delivered } = pushNotificationsFor("en");

    // Workspaces created before upstream's opaque ids (2026-06-14) keep their folder as
    // their id, and PASEO_SERVER_ID sets any server id.
    await push.send(
      buildAgentAttentionNotificationPayload({
        reason: "finished",
        serverId: "alex-macbook",
        workspaceId: "/Users/alex/secret-project",
        agentId: AGENT_ID,
        assistantMessage: ASSISTANT_MESSAGE,
      }),
    );

    expect(delivered).toEqual([
      {
        title: "woowtech smart",
        body: "Work finished — tap to see the result.",
        data: { agentId: AGENT_ID, reason: "finished" },
      },
    ]);
  });

  test.each([
    ["finished", "工作完成了，點一下查看結果。"],
    ["permission", "需要你的授權，點一下查看要求。"],
    ["error", "需要你的注意，點一下查看。"],
    ["needs_input", "需要你的注意，點一下查看。"],
  ])(
    "in Chinese a push reads 渥屋智能 and one Traditional Chinese sentence for %s",
    async (reason, body) => {
      const { push, delivered } = pushNotificationsFor("zh-TW");

      await push.send({
        title: "Agent needs attention",
        body: ASSISTANT_MESSAGE,
        data: { serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID, reason },
      });

      expect(delivered).toEqual([
        {
          title: "渥屋智能",
          body,
          data: { serverId: SERVER_ID, workspaceId: WORKSPACE_ID, agentId: AGENT_ID, reason },
        },
      ]);
    },
  );

  test("a push without a reason the daemon uses asks for attention and drops the reason", async () => {
    const { push, delivered } = pushNotificationsFor("en");

    await push.send({
      title: "Deploy secret-project",
      body: ASSISTANT_MESSAGE,
      data: { serverId: SERVER_ID, reason: "Deploy secret-project to production" },
    });

    expect(delivered).toEqual([
      {
        title: "woowtech smart",
        body: "Needs your attention — tap to take a look.",
        data: { serverId: SERVER_ID },
      },
    ]);
  });
});

// `defaults read -g AppleLanguages` on a Mac whose system language is Traditional Chinese.
const MAC_LANGUAGES_ZH = '(\n    "zh-Hant-TW",\n    "en-US"\n)\n';
const MAC_LANGUAGES_EN = '(\n    "en-US",\n    "zh-Hant-TW"\n)\n';

function host(overrides: Partial<HostLocaleSources>): HostLocaleSources {
  return {
    env: {},
    platform: "linux",
    readAppleLanguages: async () => {
      throw new Error("not a Mac");
    },
    intlLocale: () => "en-US",
    ...overrides,
  };
}

describe("the push language follows the host's locale", () => {
  test.each([
    ["zh_TW.UTF-8", "渥屋智能", "工作完成了，點一下查看結果。"],
    ["en_US.UTF-8", "woowtech smart", "Work finished — tap to see the result."],
  ])(
    "the daemon's pushes on a host with LC_ALL=%s",
    async (locale, expectedTitle, expectedBody) => {
      vi.stubEnv("LC_ALL", locale);
      const { push, delivered } = pushNotificationsFor();

      await push.send(
        buildAgentAttentionNotificationPayload({
          reason: "finished",
          serverId: SERVER_ID,
          workspaceId: WORKSPACE_ID,
          agentId: AGENT_ID,
          assistantMessage: ASSISTANT_MESSAGE,
        }),
      );

      expect(delivered.map(({ title, body }) => ({ title, body }))).toEqual([
        { title: expectedTitle, body: expectedBody },
      ]);
    },
  );

  test.each([
    ["LANG", host({ env: { LANG: "zh_TW.UTF-8" } })],
    ["LANG in Simplified Chinese", host({ env: { LANG: "zh_CN.UTF-8" } })],
    ["LC_ALL over LANG", host({ env: { LC_ALL: "zh_HK.UTF-8", LANG: "en_US.UTF-8" } })],
    ["LC_MESSAGES over LANG", host({ env: { LC_MESSAGES: "zh_TW.UTF-8", LANG: "en_US.UTF-8" } })],
    [
      "the Mac's system language when the shell's locale is C",
      host({
        env: { LANG: "C.UTF-8" },
        platform: "darwin",
        readAppleLanguages: async () => MAC_LANGUAGES_ZH,
      }),
    ],
    [
      "the Mac's system language when nothing is set, as for the desktop app's daemon",
      host({ platform: "darwin", readAppleLanguages: async () => MAC_LANGUAGES_ZH }),
    ],
    ["Node's locale elsewhere", host({ intlLocale: () => "zh-TW" })],
  ])("a Chinese host pushes in Chinese: %s", async (_case, chineseHost) => {
    expect(await pushLanguageOf(chineseHost)).toBe("zh-TW");
  });

  test.each([
    ["LANG", host({ env: { LANG: "en_US.UTF-8" } })],
    ["another language", host({ env: { LANG: "ja_JP.UTF-8" } })],
    ["LC_ALL over LANG", host({ env: { LC_ALL: "en_GB.UTF-8", LANG: "zh_TW.UTF-8" } })],
    [
      "the Mac's system language",
      host({ platform: "darwin", readAppleLanguages: async () => MAC_LANGUAGES_EN }),
    ],
    [
      "Node's locale when the Mac's languages cannot be read",
      host({
        platform: "darwin",
        readAppleLanguages: async () => {
          throw new Error("defaults failed");
        },
      }),
    ],
    ["Node's locale when LANG is C", host({ env: { LANG: "C" } })],
  ])("any other host pushes in English: %s", async (_case, otherHost) => {
    expect(await pushLanguageOf(otherHost)).toBe("en");
  });
});
