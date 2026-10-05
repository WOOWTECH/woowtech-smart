import { z } from "zod";

// woowtech smart (woowtech/README.md section 16): the client the daemon picked to show an agent
// or terminal notice reports that the system did not show it (notifications turned off, never
// allowed, or no result within 5 seconds), and the daemon sends the push its presence rule had
// skipped, once. Advertised by `server_info.features.woowtechAttentionFallback`; Paseo daemons
// never set it, so the app does not send this request to them.

export const ATTENTION_DISPLAY_FAILURE_REQUEST =
  "attention.notification.report_display_failure.request";
export const ATTENTION_DISPLAY_FAILURE_RESPONSE =
  "attention.notification.report_display_failure.response";

export const AttentionDisplayFailureTargetSchema = z.discriminatedUnion("kind", [
  // `timestamp` is the one on the agent_attention_required message the client was asked to show.
  z.object({ kind: z.literal("agent"), agentId: z.string(), timestamp: z.string() }),
  // terminal_attention_required carries no timestamp: the daemon keeps the latest notice per terminal.
  z.object({ kind: z.literal("terminal"), terminalId: z.string() }),
]);

export type AttentionDisplayFailureTarget = z.infer<typeof AttentionDisplayFailureTargetSchema>;

export const AttentionDisplayFailureReportRequestSchema = z.object({
  type: z.literal(ATTENTION_DISPLAY_FAILURE_REQUEST),
  requestId: z.string(),
  target: AttentionDisplayFailureTargetSchema,
});

/**
 * - `pushed`: the daemon sent the push.
 * - `unknown`: no notice for that target was handed to this client, or it was already reported.
 * - `expired`: the notice is older than the daemon keeps them.
 * A daemon added later may answer with another string; treat anything but `pushed` as not pushed.
 */
export const AttentionDisplayFailureReportResponseSchema = z.object({
  type: z.literal(ATTENTION_DISPLAY_FAILURE_RESPONSE),
  payload: z.object({
    requestId: z.string(),
    outcome: z.string(),
  }),
});

export type AttentionDisplayFailureReportRequest = z.infer<
  typeof AttentionDisplayFailureReportRequestSchema
>;
export type AttentionDisplayFailureReportResponse = z.infer<
  typeof AttentionDisplayFailureReportResponseSchema
>;
