import type pino from "pino";

import type { PushPayload } from "./push-service.js";
import { PushTokenStore } from "./token-store.js";
import { toRemotePushPayload, type PushLanguage } from "./woowtech-push-content.js";
import { createDaemonRelayDeliver } from "./woowtech-relay.js";

export type { PushPayload };

const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;

export interface PushNotifications {
  renew(token: string): void;
  revoke(token: string): void;
  send(payload: PushPayload): Promise<void>;
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
    },
    revoke(token) {
      store.revokeToken(token);
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
