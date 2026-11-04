import type { AgentPermissionAction } from "@getpaseo/protocol/agent-types";
import type { TFunction } from "i18next";

// woowtech smart: Claude and Codex send the buttons of their plan approval card with English
// labels ("Reject", "Dismiss", "Implement", "Implement with <mode>"), and the card showed them
// as they came in every language. A button with a known intent now takes the app's own words;
// English keeps the provider's wording. Unknown intents keep their label (woowtech/README.md,
// section 25).
const IMPLEMENT_WITH = /^Implement with (.+)$/;

function isEnglish(language: string): boolean {
  return language === "en" || language.startsWith("en-");
}

function localizeAction(action: AgentPermissionAction, t: TFunction): AgentPermissionAction {
  switch (action.intent) {
    case "dismiss":
      return { ...action, label: t("agentStream.permission.deny") };
    case "implement":
      return { ...action, label: t("agentStream.permission.implement") };
    case "implement_resume": {
      const mode = IMPLEMENT_WITH.exec(action.label)?.[1];
      return mode
        ? { ...action, label: t("woowtech.permissionActions.implementWith", { mode }) }
        : action;
    }
    default:
      return action;
  }
}

/** The provider's permission buttons with labels in the app's language. */
export function localizePermissionActions(
  actions: AgentPermissionAction[],
  t: TFunction,
  language: string,
): AgentPermissionAction[] {
  if (isEnglish(language)) {
    return actions;
  }
  return actions.map((action) => localizeAction(action, t));
}
