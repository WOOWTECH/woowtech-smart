// woowtech smart (woowtech/README.md section 16): when someone is present, upstream asks one client
// to show an agent or terminal notice as a system notification and skips the push. A Mac whose
// notifications are off, or never allowed, then shows nothing and the phone gets nothing either.
// This ledger sends the push that was skipped, once, in two ways: right away when the client
// reports that its system did not show the notice, and after a few minutes when a computer's
// notice is still unattended (woowtech-attention-escalation.ts), because the system often reports
// a notice shown that it put away without a banner.
import {
  ATTENTION_DISPLAY_FAILURE_RESPONSE,
  type AttentionDisplayFailureReportRequest,
  type AttentionDisplayFailureReportResponse,
  type AttentionDisplayFailureTarget,
} from "@getpaseo/protocol/woowtech-attention-fallback";
import { ATTENTION_ESCALATION_MS } from "./woowtech-attention-escalation.js";

/** A report later than this is too late for the push to be useful. */
export const ATTENTION_FALLBACK_WINDOW_MS = 60_000;
const MAX_REMEMBERED_NOTICES = 64;

/** `no_device`: no phone has a push token, so nothing was sent. */
export type AttentionDisplayFailureOutcome = "pushed" | "unknown" | "expired" | "no_device";

interface WoowtechAttentionFallbackOptions {
  now?: () => number;
  /** Whether a push would reach any phone now; without it, every push counts as sent. */
  hasPushTargets?: () => boolean;
  /** How long an unattended notice waits before it is pushed; 0 or less never pushes it. */
  escalationMs?: number;
  /** Called just before an unattended notice is pushed. */
  onEscalated?: (target: AttentionDisplayFailureTarget) => void;
}

/** A notice that is pushed to the phone if nobody has dealt with it when the timer ends. */
interface NoticeEscalation {
  /** Someone saw or answered the notice since it was shown. */
  isAttendedTo: () => boolean;
}

interface RememberedNotice {
  recipient: object;
  push: () => void;
  rememberedAtMs: number;
  escalationTimer: ReturnType<typeof setTimeout> | null;
  isAttendedTo: (() => boolean) | null;
}

function noticeKey(target: AttentionDisplayFailureTarget): string {
  return target.kind === "agent"
    ? `agent\u0000${target.agentId}\u0000${target.timestamp}`
    : `terminal\u0000${target.terminalId}`;
}

export class WoowtechAttentionFallback {
  private readonly notices = new Map<string, RememberedNotice>();

  private readonly now: () => number;
  private readonly hasPushTargets: () => boolean;
  private readonly escalationMs: number;
  private readonly onEscalated: (target: AttentionDisplayFailureTarget) => void;

  constructor(options: WoowtechAttentionFallbackOptions = {}) {
    this.now = options.now ?? Date.now;
    this.hasPushTargets = options.hasPushTargets ?? (() => true);
    this.escalationMs = options.escalationMs ?? ATTENTION_ESCALATION_MS;
    this.onEscalated = options.onEscalated ?? (() => {});
  }

  /**
   * `recipient` (the client's session) was asked to show the notice for `target` instead of a
   * push. A later notice for the same terminal replaces the earlier one. With `escalation`, the
   * push is sent anyway when the notice is still unattended after the wait.
   */
  remember(input: {
    target: AttentionDisplayFailureTarget;
    recipient: object;
    push: () => void;
    escalation?: NoticeEscalation;
  }): void {
    const key = noticeKey(input.target);
    this.forget(key);
    const escalates = input.escalation !== undefined && this.escalationMs > 0;
    const escalationTimer = escalates
      ? setTimeout(() => this.escalate(key, input.target), this.escalationMs)
      : null;
    escalationTimer?.unref();
    this.notices.set(key, {
      recipient: input.recipient,
      push: input.push,
      rememberedAtMs: this.now(),
      escalationTimer,
      isAttendedTo: escalates ? (input.escalation?.isAttendedTo ?? null) : null,
    });
    this.prune();
  }

  /** `reporter` could not show the notice for `target`: push it, once, while it is fresh. */
  report(input: {
    target: AttentionDisplayFailureTarget;
    reporter: object;
  }): AttentionDisplayFailureOutcome {
    const key = noticeKey(input.target);
    const notice = this.notices.get(key);
    if (!notice || notice.recipient !== input.reporter) {
      return "unknown";
    }
    if (this.now() - notice.rememberedAtMs > ATTENTION_FALLBACK_WINDOW_MS) {
      // Too late for a report to matter, but a notice that is waiting to escalate still does.
      if (!notice.escalationTimer) {
        this.forget(key);
      }
      return "expired";
    }
    this.forget(key);
    if (!this.hasPushTargets()) {
      return "no_device";
    }
    notice.push();
    return "pushed";
  }

  /** Stops every wait; the daemon is stopping and nobody should be pushed for that. */
  close(): void {
    for (const key of this.notices.keys()) {
      this.forget(key);
    }
  }

  private escalate(key: string, target: AttentionDisplayFailureTarget): void {
    const notice = this.notices.get(key);
    if (!notice) {
      return;
    }
    this.forget(key);
    if (notice.isAttendedTo?.() || !this.hasPushTargets()) {
      return;
    }
    this.onEscalated(target);
    notice.push();
  }

  private forget(key: string): void {
    const notice = this.notices.get(key);
    if (!notice) {
      return;
    }
    if (notice.escalationTimer) {
      clearTimeout(notice.escalationTimer);
    }
    this.notices.delete(key);
  }

  private prune(): void {
    const oldestKept = this.now() - ATTENTION_FALLBACK_WINDOW_MS;
    // A notice that waits to escalate stays until its timer ends; the others only for the window.
    for (const [key, notice] of this.notices) {
      if (!notice.escalationTimer && notice.rememberedAtMs < oldestKept) {
        this.forget(key);
      }
    }
    // Insertion order is age order.
    for (const key of this.notices.keys()) {
      if (this.notices.size <= MAX_REMEMBERED_NOTICES) {
        return;
      }
      this.forget(key);
    }
  }
}

interface AnswerAttentionDisplayFailureInput {
  fallback: WoowtechAttentionFallback | undefined;
  request: AttentionDisplayFailureReportRequest;
  reporter: object;
}

/** The session's answer to a report; a daemon without a ledger knows no notice. */
export function answerAttentionDisplayFailure({
  fallback,
  request,
  reporter,
}: AnswerAttentionDisplayFailureInput): AttentionDisplayFailureReportResponse {
  const outcome = fallback ? fallback.report({ target: request.target, reporter }) : "unknown";
  return {
    type: ATTENTION_DISPLAY_FAILURE_RESPONSE,
    payload: { requestId: request.requestId, outcome },
  };
}
