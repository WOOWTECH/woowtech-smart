// woowtech smart (woowtech/README.md section 16): a computer that is asked to show a notice cannot
// say whether the person saw it. The system may have put the banner away (notifications off, alert
// style None, Focus) and still report it shown. So the daemon does not rely on detection: if
// nobody deals with the notice within a few minutes, the phone gets the push that was skipped.
/** How long a notice shown on a computer waits for someone to deal with it. */
export const ATTENTION_ESCALATION_MS = 180_000;

const ESCALATION_SECONDS_ENV = "WOOWTECH_ESCALATION_SECONDS";

/**
 * The wait before the phone gets an unattended notice. `WOOWTECH_ESCALATION_SECONDS` overrides
 * it for tests and device rounds; 0 turns the wait off. Anything unreadable keeps the default.
 */
export function readEscalationDelayMs(env: Record<string, string | undefined>): number {
  const raw = env[ESCALATION_SECONDS_ENV]?.trim();
  if (!raw) {
    return ATTENTION_ESCALATION_MS;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return ATTENTION_ESCALATION_MS;
  }
  return Math.round(seconds * 1000);
}

export interface NoticeRecipientActivity {
  deviceType: "web" | "mobile";
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
  lastActivityAt: Date;
  appVisible: boolean;
}

export type NoticeTarget = { kind: "agent"; id: string } | { kind: "terminal"; id: string };

/**
 * Only a computer waits. Its notice is an OS banner the system can drop without telling the
 * app. A phone that was asked to show the notice is the phone already.
 */
export function waitsBeforePhoneGetsNotice(activity: NoticeRecipientActivity | null): boolean {
  return activity?.deviceType === "web";
}

interface RecipientAttendedInput {
  /** The recipient's activity now; null when it has disconnected, which nobody saw the notice on. */
  activity: NoticeRecipientActivity | null;
  noticedAtMs: number;
  target: NoticeTarget;
}

/**
 * Someone is dealing with the notice: the recipient saw input after it was shown (on a computer
 * this is the system's idle time, so any keyboard or mouse use counts), or it is looking at the
 * very agent or terminal.
 */
export function recipientAttendedTo({
  activity,
  noticedAtMs,
  target,
}: RecipientAttendedInput): boolean {
  if (!activity) {
    return false;
  }
  if (activity.lastActivityAt.getTime() > noticedAtMs) {
    return true;
  }
  const focusedId = target.kind === "agent" ? activity.focusedAgentId : activity.focusedTerminalId;
  return activity.appVisible && focusedId === target.id;
}
