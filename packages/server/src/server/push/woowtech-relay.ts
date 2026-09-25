import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type pino from "pino";
import {
  parsePushToken,
  relayNotifyBodyFor,
  validateRelayNotifyBody,
  type WoowtechPushToken,
} from "@getpaseo/protocol/woowtech-push";

import type { PushPayload } from "./push-service.js";

// woowtech smart sends every push through WoowTech's push relay, which picks one fixed
// sentence per reason in the phone's language and sends it with FCM (woowtech/README.md,
// 16). The relay gets the phone's FCM token, its language, a reason code and the ids a tap
// opens; never a title, a body, a folder or any other text from the user's work.

export interface WoowtechRelayDeliverOptions {
  /** POST /api/smart/v1/notify of the relay. */
  relayUrl: string;
  fetch: typeof fetch;
  logger: pino.Logger;
  /** Removes a registered token string from the daemon's push token store. */
  revoke: (token: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** How long one request may take. Defaults to 10 seconds. */
  timeoutMs?: number;
}

export type PushDeliver = (tokens: string[], payload: PushPayload) => Promise<void>;

/** A phone's FCM token and every string it is registered with. */
interface Phone {
  token: WoowtechPushToken;
  registered: string[];
}

/**
 * Names a phone in debug logs by the first 8 hex digits of its FCM token's SHA-256, enough to
 * follow one phone through the log without writing the token anywhere.
 */
function phoneHashOf(token: WoowtechPushToken): string {
  return createHash("sha256").update(token.fcmToken).digest("hex").slice(0, 8);
}

/** The relay's status code, or the error code of a request that got no answer. */
type RelayAnswer =
  | { reached: true; status: number; field?: string }
  | { reached: false; error: string };

function isUnavailable(answer: RelayAnswer): boolean {
  return !answer.reached || answer.status === 503;
}

/** What a log line may say about an answer: codes only. */
function resultOf(answer: RelayAnswer): { status: number } | { error: string } {
  return answer.reached ? { status: answer.status } : { error: answer.error };
}

/** Undici's `fetch failed` names the reason in its cause, such as ECONNREFUSED. */
function errorCodeOf(error: unknown): string {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return error instanceof Error ? error.name : "unknown";
}

// The relay's 400 names the field it refused, and only a plain field path, never text.
const FIELD_PATH = /^[A-Za-z0-9_.]{1,64}$/;

async function refusedFieldOf(response: Response): Promise<{ field?: string }> {
  try {
    const answer: unknown = await response.json();
    const field =
      typeof answer === "object" && answer !== null && "field" in answer ? answer.field : null;
    return typeof field === "string" && FIELD_PATH.test(field) ? { field } : {};
  } catch {
    return {};
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

// The relay answers 503 while FCM or Firestore fails for a moment. A push is a prompt about
// something happening now: one more try a little later, then the next event pushes again.
const RETRY_DELAY_MIN_MS = 2_000;
const RETRY_DELAY_MAX_MS = 4_000;

function retryDelayMs(): number {
  return RETRY_DELAY_MIN_MS + Math.round(Math.random() * (RETRY_DELAY_MAX_MS - RETRY_DELAY_MIN_MS));
}

export function createWoowtechRelayDeliver(options: WoowtechRelayDeliverOptions): PushDeliver {
  const logger = options.logger.child({ component: "woowtech-push-relay" });
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  /** Revokes each string, and says how many the store could not drop. */
  function revokeAll(registered: readonly string[]): void {
    let failed = 0;
    for (const token of registered) {
      try {
        options.revoke(token);
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) logger.warn({ failed }, "Failed to revoke push tokens");
  }

  async function post(body: string): Promise<RelayAnswer> {
    try {
      const response = await options.fetch(options.relayUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        // A redirect would hand the phone's FCM token to another address: an answer like
        // any other, logged and dropped.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 400) {
        return { reached: true, status: 400, ...(await refusedFieldOf(response)) };
      }
      // Nothing else in an answer matters; free the connection.
      await response.body?.cancel().catch(() => undefined);
      return { reached: true, status: response.status };
    } catch (error) {
      return { reached: false, error: errorCodeOf(error) };
    }
  }

  async function notify(phone: Phone, data: PushPayload["data"]): Promise<void> {
    // The relay's closed contract, checked again here: only its four fields leave the machine.
    const checked = validateRelayNotifyBody(relayNotifyBodyFor({ token: phone.token, data }));
    if (!checked.ok) {
      logger.error({ field: checked.field }, "Refused to send a push outside the relay's contract");
      return;
    }
    const body = JSON.stringify(checked.value);
    let attempts = 1;
    let answer = await post(body);
    if (isUnavailable(answer)) {
      await options.sleep(retryDelayMs());
      attempts += 1;
      answer = await post(body);
    }
    logger.debug(
      { phone: phoneHashOf(phone.token), attempts, ...resultOf(answer) },
      "The push relay answered",
    );
    settle(phone, answer);
  }

  function settle(phone: Phone, answer: RelayAnswer): void {
    if (!answer.reached || answer.status === 503) {
      logger.warn(resultOf(answer), "Dropped a push the push relay could not take");
      return;
    }
    const result = { status: answer.status };
    switch (answer.status) {
      case 201:
        return;
      case 410:
        revokeAll(phone.registered);
        logger.info(
          { count: phone.registered.length },
          "Revoked a push token FCM no longer accepts",
        );
        return;
      case 400:
      case 413:
        logger.error(
          { ...result, ...(answer.field ? { field: answer.field } : {}) },
          "The push relay refused a malformed request, a daemon bug",
        );
        return;
      case 403:
        logger.error(result, "The push relay refused the daemon's request");
        return;
      case 429:
        logger.info(result, "The push relay's limit for this phone is reached; dropped the push");
        return;
      case 502:
        logger.warn(result, "The push relay could not reach FCM or APNs; dropped the push");
        return;
      default:
        logger.warn(result, "The push relay gave an unexpected answer; dropped the push");
    }
  }

  return async (tokens, payload) => {
    const phones = new Map<string, Phone>();
    // Expo tokens from the official Paseo app or an older build: the relay cannot use them.
    const unusable: string[] = [];
    for (const registered of tokens) {
      const token = parsePushToken(registered);
      if (!token) {
        unusable.push(registered);
        continue;
      }
      // One push per phone. Two strings for one FCM token means the app changed its language
      // and the revocation of the old string was lost; the store lists the newer one last.
      const strings = phones.get(token.fcmToken)?.registered ?? [];
      phones.set(token.fcmToken, { token, registered: [...strings, registered] });
    }
    if (unusable.length > 0) {
      revokeAll(unusable);
      logger.info({ count: unusable.length }, "Revoked push tokens the push relay cannot use");
    }
    await Promise.all([...phones.values()].map((phone) => notify(phone, payload.data)));
  };
}

export const DEFAULT_WOOWTECH_PUSH_RELAY_URL = "https://push.woowtech.io/api/smart/v1/notify";

/** WOOWTECH_PUSH_RELAY_URL points the daemon at another relay, for tests and staging. */
export function woowtechPushRelayUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.WOOWTECH_PUSH_RELAY_URL?.trim() || DEFAULT_WOOWTECH_PUSH_RELAY_URL;
}

export interface DaemonRelayDeliverOptions {
  logger: pino.Logger;
  revoke: (token: string) => void;
}

/** The daemon's deliver: the relay from the environment, the global fetch and real timers. */
export function createDaemonRelayDeliver(options: DaemonRelayDeliverOptions): PushDeliver {
  return createWoowtechRelayDeliver({
    relayUrl: woowtechPushRelayUrl(),
    // Looked up per request, as upstream's Expo sender did.
    fetch: (input, init) => fetch(input, init),
    logger: options.logger,
    revoke: options.revoke,
    // A pending retry does not keep a stopping daemon alive.
    sleep: (ms) => delay(ms, undefined, { ref: false }),
  });
}
