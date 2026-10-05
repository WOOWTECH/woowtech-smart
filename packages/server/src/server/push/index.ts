import type pino from "pino";

import type { PushPayload } from "./push-service.js";
import { PushTokenStore } from "./token-store.js";
import { toRemotePushPayload, type PushLanguage } from "./woowtech-push-content.js";
import { createDaemonRelayDeliver, revokeSupersededPushTokens } from "./woowtech-relay.js";

export type { PushPayload };

const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;

export interface PushNotifications {
  renew(token: string): void;
  revoke(token: string): void;
  send(payload: PushPayload): Promise<void>;
  /** woowtech smart: whether any phone would get a push now (woowtech-attention-fallback.ts). */
  hasActiveTokens(): boolean;
}

export type PushNotificationSender = Pick<PushNotifications, "send">;

export function createPushNotifications(options: {
  logger: pino.Logger;
  filePath: string;
  now?: () => number;
  deliver?: (tokens: string[], payload: PushPayload) => Promise<void>;
  language?: PushLanguage;
}): PushNotifications {
  const now = options.now ?? Date.now;
  const store = new PushTokenStore(options.logger, options.filePath, now, PUSH_TOKEN_LEASE_MS);
  // woowtech smart: pushes go through WoowTech's push relay, never Expo (woowtech/README.md, 16).
  const deliver =
    options.deliver ??
    createDaemonRelayDeliver({
      logger: options.logger,
      revoke: (token) => store.revokeToken(token),
    });

  return {
    renew(token) {
      store.renewToken(token);
      // woowtech smart: a phone keeps one string, the one registered last (woowtech/README.md, 16).
      revokeSupersededPushTokens({ renewed: token, store });
    },
    revoke(token) {
      store.revokeToken(token);
    },
    hasActiveTokens() {
      return store.getActiveTokens().length > 0;
    },
    async send(payload) {
      const tokens = store.getActiveTokens();
      options.logger.info({ tokenCount: tokens.length }, "Sending push notification");
      if (tokens.length === 0) return;
      // woowtech smart: a push leaves the machine without the user's text (woowtech/README.md, 16).
      await deliver(tokens, await toRemotePushPayload(payload, options.language));
    },
  };
}
