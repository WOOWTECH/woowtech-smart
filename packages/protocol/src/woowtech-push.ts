// woowtech smart's push notifications go through WoowTech's push relay, which sends them
// with FCM on both platforms (woowtech/README.md, 16). The app registers
// "wsp1:<locale>:<FCM token>" with its daemon through the unchanged register_push_token;
// the daemon stores the string as an opaque token and, for each push, sends the relay
// only a reason code and ids. Only this module reads or writes that string.

const TOKEN_VERSION = "wsp1";

export type PushLocale = "zh-TW" | "en";

function isPushLocale(value: unknown): value is PushLocale {
  return value === "zh-TW" || value === "en";
}

/** The relay writes one fixed sentence per reason. */
export type RelayReason = "finished" | "permission" | "attention";

export interface WoowtechPushToken {
  locale: PushLocale;
  fcmToken: string;
}

/** A push notification's `data`, as the daemon builds it for the agent or terminal. */
export type PushData = Readonly<Record<string, unknown>> | undefined;

/** What the app routes a tapped push with (packages/app/src/utils/notification-routing.ts). */
export interface RelayTarget {
  serverId?: string;
  workspaceId?: string;
  agentId?: string;
  terminalId?: string;
}

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The shapes the daemon generates each id in. Anything else could be the user's text:
// PASEO_SERVER_ID sets any server id, and workspaces created before upstream made their
// ids opaque (2026-06-14) keep their folder path as their id. Such an id stays on the
// machine, and the tap opens less deeply.
const TARGET_ID_SHAPES: Record<keyof RelayTarget, RegExp> = {
  serverId: /^srv_[A-Za-z0-9_-]{12}$/, // packages/server/src/server/server-id.ts
  workspaceId: /^wks_[0-9a-f]{16}$/, // packages/server/src/server/workspace-registry-model.ts
  agentId: LOWERCASE_UUID, // randomUUID()
  terminalId: LOWERCASE_UUID, // randomUUID()
};

/**
 * The language the relay writes a phone's pushes in, from the app's language (i18next).
 * Every Chinese language reads Traditional Chinese, as the app shows it (woowtech/README.md, 7).
 */
export function pushLocaleFor(appLocale: string): PushLocale {
  return /^zh(?:[-_]|$)/i.test(appLocale) ? "zh-TW" : "en";
}

// The relay's contract for an FCM registration token (packages/protocol/tests/fixtures/
// smart-notify-v1.fixtures.json): URL-safe characters with at least one colon, which also
// rules out old SNS tokens, and a length the relay's 1 KB request limit leaves room for.
const FCM_TOKEN_CHARACTERS = /^[A-Za-z0-9_:-]+$/;
const FCM_TOKEN_MIN_LENGTH = 20;
const FCM_TOKEN_MAX_LENGTH = 512;

export function isFcmToken(value: string): boolean {
  return (
    value.length >= FCM_TOKEN_MIN_LENGTH &&
    value.length <= FCM_TOKEN_MAX_LENGTH &&
    FCM_TOKEN_CHARACTERS.test(value) &&
    value.includes(":")
  );
}

/** An FCM token outside the relay's contract. The message never includes the token. */
export class InvalidFcmTokenError extends Error {
  constructor(readonly length: number) {
    super(`The FCM token (${length} characters) is outside the push relay's contract`);
    this.name = "InvalidFcmTokenError";
  }
}

/** Throws InvalidFcmTokenError for a token outside the relay's contract (check with isFcmToken). */
export function encodePushToken(token: WoowtechPushToken): string {
  if (!isPushLocale(token.locale)) throw new RangeError("The push locale is not zh-TW or en");
  if (!isFcmToken(token.fcmToken)) throw new InvalidFcmTokenError(token.fcmToken.length);
  return `${TOKEN_VERSION}:${token.locale}:${token.fcmToken}`;
}

/** Splits on the first two colons only: FCM tokens contain colons. */
export function parsePushToken(value: string): WoowtechPushToken | null {
  const versionEnd = value.indexOf(":");
  const localeEnd = value.indexOf(":", versionEnd + 1);
  if (versionEnd === -1 || localeEnd === -1) return null;
  if (value.slice(0, versionEnd) !== TOKEN_VERSION) return null;
  const locale = value.slice(versionEnd + 1, localeEnd);
  const fcmToken = value.slice(localeEnd + 1);
  if (!isPushLocale(locale)) return null;
  if (!isFcmToken(fcmToken)) return null;
  return { locale, fcmToken };
}

/**
 * Agents push when they finish, need a permission or hit an error; terminals when they
 * finish or need input, and upstream's terminal pushes carried no reason at all.
 */
export function relayReasonFor(data: PushData): RelayReason {
  if (data?.reason === "finished") return "finished";
  if (data?.reason === "permission") return "permission";
  return "attention";
}

function targetIdOf(data: PushData, key: keyof RelayTarget): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && TARGET_ID_SHAPES[key].test(value) ? value : undefined;
}

/** The ids of `data` in the daemon's shapes, and nothing else from the push. */
export function relayTargetFor(data: PushData): RelayTarget {
  const target: RelayTarget = {};
  const serverId = targetIdOf(data, "serverId");
  const workspaceId = targetIdOf(data, "workspaceId");
  const agentId = targetIdOf(data, "agentId");
  const terminalId = targetIdOf(data, "terminalId");
  if (serverId) target.serverId = serverId;
  if (workspaceId) target.workspaceId = workspaceId;
  // The relay accepts one of the two; the app opens the agent when a push names both.
  if (agentId) target.agentId = agentId;
  else if (terminalId) target.terminalId = terminalId;
  return target;
}

/** The body of POST /api/smart/v1/notify. The relay rejects any other field. */
export interface RelayNotifyBody {
  token: string;
  locale: PushLocale;
  reason: RelayReason;
  target: RelayTarget;
}

export interface RelayNotifyInput {
  token: WoowtechPushToken;
  data: PushData;
}

/** Reads only the reason and the ids of `data`: the title, the body and cwd never leave. */
export function relayNotifyBodyFor(input: RelayNotifyInput): RelayNotifyBody {
  return {
    token: input.token.fcmToken,
    locale: input.token.locale,
    reason: relayReasonFor(input.data),
    target: relayTargetFor(input.data),
  };
}

/** `field` names what the relay would refuse, as its 400 answer does. */
export type RelayNotifyBodyCheck =
  | { ok: true; value: RelayNotifyBody }
  | { ok: false; field: string };

const RELAY_NOTIFY_FIELDS = new Set(["token", "locale", "reason", "target"]);
const TARGET_KEYS = Object.keys(TARGET_ID_SHAPES) as (keyof RelayTarget)[];
// Like the relay, name an unexpected key only when it is a plain identifier, never other text.
const NAMEABLE_KEY = /^[A-Za-z0-9_]{1,32}$/;

function isRelayReason(value: unknown): value is RelayReason {
  return value === "finished" || value === "permission" || value === "attention";
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function checkTarget(
  target: unknown,
): { ok: true; value: RelayTarget } | { ok: false; field: string } {
  if (!isPlainObject(target)) return { ok: false, field: "target" };
  const unexpected = Object.keys(target).find((key) => !hasOwn(TARGET_ID_SHAPES, key));
  if (unexpected !== undefined) {
    return { ok: false, field: NAMEABLE_KEY.test(unexpected) ? `target.${unexpected}` : "target" };
  }
  const ids: RelayTarget = {};
  for (const key of TARGET_KEYS) {
    if (!hasOwn(target, key)) continue;
    const id = target[key];
    if (typeof id !== "string" || !TARGET_ID_SHAPES[key].test(id)) {
      return { ok: false, field: `target.${key}` };
    }
    ids[key] = id;
  }
  if (ids.agentId !== undefined && ids.terminalId !== undefined) {
    return { ok: false, field: "target" };
  }
  return { ok: true, value: ids };
}

/**
 * The relay's closed request contract (packages/protocol/tests/fixtures/
 * smart-notify-v1.fixtures.json), checked in the relay's order. `value` is a fresh copy
 * with only the contract's fields.
 */
export function validateRelayNotifyBody(body: unknown): RelayNotifyBodyCheck {
  if (!isPlainObject(body)) return { ok: false, field: "request" };
  const unexpected = Object.keys(body).find((key) => !RELAY_NOTIFY_FIELDS.has(key));
  if (unexpected !== undefined) {
    return { ok: false, field: NAMEABLE_KEY.test(unexpected) ? unexpected : "request" };
  }
  const { token, locale, reason } = body;
  if (typeof token !== "string" || !isFcmToken(token)) return { ok: false, field: "token" };
  if (!isPushLocale(locale)) return { ok: false, field: "locale" };
  if (!isRelayReason(reason)) return { ok: false, field: "reason" };
  const target = checkTarget(body.target);
  if (!target.ok) return target;
  return { ok: true, value: { token, locale, reason, target: target.value } };
}
