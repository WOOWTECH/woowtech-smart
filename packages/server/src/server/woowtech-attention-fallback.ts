// woowtech smart (woowtech/README.md section 16): when someone is present, upstream asks one client
// to show an agent or terminal notice as a system notification and skips the push. A Mac whose
// notifications are off, or never allowed, then shows nothing and the phone gets nothing either.
// The client reports a notice its system did not show, and this ledger sends the push that was
// skipped, once.
import {
  ATTENTION_DISPLAY_FAILURE_RESPONSE,
  type AttentionDisplayFailureReportRequest,
  type AttentionDisplayFailureReportResponse,
  type AttentionDisplayFailureTarget,
} from "@getpaseo/protocol/woowtech-attention-fallback";

/** A report later than this is too late for the push to be useful. */
export const ATTENTION_FALLBACK_WINDOW_MS = 60_000;
const MAX_REMEMBERED_NOTICES = 64;

export type AttentionDisplayFailureOutcome = "pushed" | "unknown" | "expired";

interface RememberedNotice {
  recipient: object;
  push: () => void;
  rememberedAtMs: number;
}

function noticeKey(target: AttentionDisplayFailureTarget): string {
  return target.kind === "agent"
    ? `agent\u0000${target.agentId}\u0000${target.timestamp}`
    : `terminal\u0000${target.terminalId}`;
}

export class WoowtechAttentionFallback {
  private readonly notices = new Map<string, RememberedNotice>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * `recipient` (the client's session) was asked to show the notice for `target` instead of a
   * push. A later notice for the same terminal replaces the earlier one.
   */
  remember(input: {
    target: AttentionDisplayFailureTarget;
    recipient: object;
    push: () => void;
  }): void {
    const key = noticeKey(input.target);
    this.notices.delete(key);
    this.notices.set(key, {
      recipient: input.recipient,
      push: input.push,
      rememberedAtMs: this.now(),
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
    this.notices.delete(key);
    if (this.now() - notice.rememberedAtMs > ATTENTION_FALLBACK_WINDOW_MS) {
      return "expired";
    }
    notice.push();
    return "pushed";
  }

  private prune(): void {
    const oldestKept = this.now() - ATTENTION_FALLBACK_WINDOW_MS;
    // Insertion order is age order, so stop at the first notice that stays.
    for (const [key, notice] of this.notices) {
      if (notice.rememberedAtMs >= oldestKept && this.notices.size <= MAX_REMEMBERED_NOTICES) {
        return;
      }
      this.notices.delete(key);
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
