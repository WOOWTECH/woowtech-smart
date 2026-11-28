import type pino from "pino";
import {
  normalizeNotificationPreferences,
  shouldDeliverNotification,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationPreferencesInput,
} from "@getpaseo/protocol/notification-preferences";

import type { PushPayload } from "./push-service.js";
import { PushTokenStore, type PushTokenSubscription } from "./token-store.js";
import { toRemotePushPayload, type PushLanguage } from "./woowtech-push-content.js";
import { createDaemonRelayDeliver, revokeSupersededPushTokens } from "./woowtech-relay.js";

export type { PushPayload };

const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;

// COMPAT(pushNotificationPreferences): added in v0.18.0, remove after 2027-06-01.
// Mobile apps predating notification preferences cannot opt back into finished pushes, so
// tokens registered without explicit preferences retain the pre-v0.18 push filter.
// woowtech smart: that filter already pushed errors (owner 2026-11-14, woowtech/README.md 16),
// and every store build up to 0.10.x registers without preferences.
const LEGACY_PUSH_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  events: {
    agentPermission: true,
    agentError: true,
    agentFinished: true,
    terminalNeedsInput: true,
    terminalFinished: true,
  },
  plugins: {
    enabled: true,
    muted: [],
  },
};

export interface PushNotifications {
  renew(token: string, preferences?: NotificationPreferencesInput): void;
  revoke(token: string): void;
  send(payload: PushPayload, kind?: NotificationKind): Promise<void>;
  /**
   * woowtech smart: whether any phone would get this kind of push now, so a computer shows the
   * notice when none would (woowtech-attention-fallback.ts). Without a kind, any phone counts.
   */
  hasActiveTokens(kind?: NotificationKind): boolean;
}

export type PushNotificationSender = Pick<PushNotifications, "send">;

/** The tokens whose saved preferences let this kind of push through. */
function deliverableTokens(
  subscriptions: PushTokenSubscription[],
  kind?: NotificationKind,
): string[] {
  return subscriptions
    .filter((entry) => {
      const preferences =
        entry.preferences !== undefined
          ? normalizeNotificationPreferences(entry.preferences)
          : LEGACY_PUSH_NOTIFICATION_PREFERENCES;
      return kind ? shouldDeliverNotification(preferences, kind) : preferences.enabled;
    })
    .map((entry) => entry.token);
}

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
    renew(token, preferences) {
      store.renewToken(token, preferences);
      // woowtech smart: a phone keeps one string, the one registered last (woowtech/README.md, 16).
      revokeSupersededPushTokens({ renewed: token, store });
    },
    revoke(token) {
      store.revokeToken(token);
    },
    hasActiveTokens(kind) {
      return deliverableTokens(store.getActiveSubscriptions(), kind).length > 0;
    },
    async send(payload, kind) {
      const subscriptions = store.getActiveSubscriptions();
      const tokens = deliverableTokens(subscriptions, kind);
      options.logger.info(
        { tokenCount: tokens.length, activeTokenCount: subscriptions.length, kind },
        "Sending push notification",
      );
      if (tokens.length === 0) return;
      // woowtech smart: a push leaves the machine without the user's text (woowtech/README.md, 16).
      await deliver(tokens, await toRemotePushPayload(payload, options.language));
    },
  };
}
