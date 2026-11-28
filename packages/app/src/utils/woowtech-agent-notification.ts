import type { TFunction } from "i18next";
import type { AgentAttentionReason } from "@getpaseo/protocol/agent-attention-notification";

/** The notice as the session hands it to the OS; the rest of it passes through unchanged. */
interface NotificationText {
  title: string;
  body?: string;
}

interface LocalizedAgentNotificationInput<Notification extends NotificationText> {
  notification: Notification;
  reason: AgentAttentionReason;
  t: TFunction;
}

export function localizeAgentNotification<Notification extends NotificationText>(
  input: LocalizedAgentNotificationInput<Notification>,
): Notification {
  const titleKey = input.reason === "error" ? "attention" : input.reason;
  const title = input.t(`woowtech.agentNotificationTitles.${titleKey}`);
  // An error's body is always upstream's fixed sentence, never the agent's text (README section 16).
  if (input.reason === "error") {
    return {
      ...input.notification,
      title,
      body: input.t("woowtech.agentNotificationBodies.error"),
    };
  }
  return { ...input.notification, title };
}
