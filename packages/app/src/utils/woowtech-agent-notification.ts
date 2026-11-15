import type { TFunction } from "i18next";
import type {
  AgentAttentionNotificationPayload,
  AgentAttentionReason,
} from "@getpaseo/protocol/agent-attention-notification";

interface LocalizedAgentNotificationInput {
  notification: AgentAttentionNotificationPayload;
  reason: AgentAttentionReason;
  t: TFunction;
}

export function localizeAgentNotification(
  input: LocalizedAgentNotificationInput,
): AgentAttentionNotificationPayload {
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
