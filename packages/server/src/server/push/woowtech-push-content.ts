import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { PushPayload } from "./push-service.js";

// woowtech smart: every push is rewritten here before any deliver sees it, so it carries
// none of the user's text: no agent title, message preview or permission details, and no
// project, workspace or file names. It says one generic sentence per reason in the host's
// language and keeps only the reason and the ids the app routes a tap with. The daemon's
// deliver (woowtech-relay.ts) then sends WoowTech's push relay the reason and the ids
// alone; the relay writes the sentence the phone shows, in the phone's language.
// Notifications that stay on the machine (the desktop app's OS notifications, in-app) are
// built before this step and keep their content. woowtech/README.md explains the choices;
// woowtech/push-content.test.mjs guards them.

export type PushLanguage = "zh-TW" | "en";

type PushReason = "finished" | "permission" | "attention";

const PRODUCT_NAME: Record<PushLanguage, string> = {
  "zh-TW": "渥屋智能",
  en: "woowtech smart",
};

const SENTENCE: Record<PushLanguage, Record<PushReason, string>> = {
  "zh-TW": {
    finished: "工作完成了，點一下查看結果。",
    permission: "需要你的授權，點一下查看要求。",
    attention: "需要你的注意，點一下查看。",
  },
  en: {
    finished: "Work finished — tap to see the result.",
    permission: "Permission needed — tap to review the request.",
    attention: "Needs your attention — tap to take a look.",
  },
};

/** The reasons an agent (finished, permission, error) or a terminal (finished, needs_input) pushes. */
const DAEMON_REASONS = new Set(["finished", "permission", "error", "needs_input"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the app routes a tapped notification with (packages/app/src/utils/notification-routing.ts),
 * in the shape the daemon generates each id. Anything else could be text: workspaces created
 * before upstream made their ids opaque (2026-06-14) keep their folder path as their id, and
 * PASEO_SERVER_ID sets any server id. Such an id stays here; the tap then opens less deeply.
 * A PASEO_SERVER_ID in the generated shape (srv_ and 12 URL-safe characters) is kept.
 */
const ROUTING_IDS = {
  serverId: /^srv_[A-Za-z0-9_-]{12}$/, // server-id.ts
  workspaceId: /^wks_[0-9a-f]{16}$/, // workspace-registry-model.ts
  agentId: UUID,
  terminalId: UUID,
} as const;

function pushReasonOf(data: PushPayload["data"]): PushReason {
  if (data?.reason === "finished") return "finished";
  if (data?.reason === "permission") return "permission";
  return "attention";
}

function remoteDataOf(data: PushPayload["data"]): Record<string, unknown> {
  const remote: Record<string, unknown> = {};
  for (const [key, shape] of Object.entries(ROUTING_IDS)) {
    const value = data?.[key];
    if (typeof value === "string" && shape.test(value)) {
      remote[key] = value;
    }
  }
  if (typeof data?.reason === "string" && DAEMON_REASONS.has(data.reason)) {
    remote.reason = data.reason;
  }
  return remote;
}

/** Where the daemon host's locale comes from. */
export interface HostLocaleSources {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** `defaults read -g AppleLanguages`: the Mac's system languages, most preferred first. */
  readAppleLanguages: () => Promise<string>;
  /** Node's default locale. */
  intlLocale: () => string;
}

// POSIX order: LC_ALL overrides LC_MESSAGES, which overrides LANG.
const LOCALE_VARIABLES = ["LC_ALL", "LC_MESSAGES", "LANG"] as const;
const NO_LANGUAGE_LOCALE = /^(?:C|POSIX)(?:[._@]|$)/;

async function hostLocaleOf(host: HostLocaleSources): Promise<string> {
  for (const name of LOCALE_VARIABLES) {
    const value = host.env[name]?.trim();
    if (!value) continue;
    if (!NO_LANGUAGE_LOCALE.test(value)) return value;
    // C or POSIX names no language, so ask the system below.
    break;
  }
  // A daemon the desktop app starts has no LANG on macOS, and Node then reports en-US
  // whatever the system language is.
  if (host.platform === "darwin") {
    try {
      const first = (await host.readAppleLanguages())
        .replace(/[()"]/g, " ")
        .split(/[\s,]+/)
        .find(Boolean);
      if (first) return first;
    } catch {
      // Fall back to Node's locale.
    }
  }
  return host.intlLocale();
}

/** Every Chinese locale reads Traditional Chinese, as the app does (woowtech/README.md, 7). */
export async function pushLanguageOf(host: HostLocaleSources): Promise<PushLanguage> {
  return /^zh(?:[-_]|$)/i.test(await hostLocaleOf(host)) ? "zh-TW" : "en";
}

const execFileAsync = promisify(execFile);

/** Read on every push, so a change of system language applies without restarting the daemon. */
function thisHost(): HostLocaleSources {
  return {
    env: process.env,
    platform: process.platform,
    readAppleLanguages: async () => {
      const { stdout } = await execFileAsync(
        "/usr/bin/defaults",
        ["read", "-g", "AppleLanguages"],
        {
          timeout: 2_000,
        },
      );
      return stdout;
    },
    intlLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  };
}

/** The version of `payload` that may leave this machine, in `language` or else the host's. */
export async function toRemotePushPayload(
  payload: PushPayload,
  language?: PushLanguage,
): Promise<PushPayload> {
  const resolved = language ?? (await pushLanguageOf(thisHost()));
  return {
    title: PRODUCT_NAME[resolved],
    body: SENTENCE[resolved][pushReasonOf(payload.data)],
    data: remoteDataOf(payload.data),
  };
}
