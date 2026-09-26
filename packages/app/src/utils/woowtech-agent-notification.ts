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
  return { ...input.notification, title: input.t(`woowtech.agentNotificationTitles.${titleKey}`) };
}
