export interface AiReportReceipt {
  schemaVersion: 1;
  receiptId: string;
  receivedAt: string;
}
export interface ReportTransportResponse {
  status: number;
  body: unknown;
  retryAfter: string | null;
}
export type ReportTransport = (body: string) => Promise<ReportTransportResponse>;

export function isAiReportReceipt(value: unknown): value is AiReportReceipt {
  if (!value || typeof value !== "object") return false;
  return (
    "schemaVersion" in value &&
    value.schemaVersion === 1 &&
    "receiptId" in value &&
    typeof value.receiptId === "string" &&
    /^air_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.receiptId,
    ) &&
    "receivedAt" in value &&
    typeof value.receivedAt === "string" &&
    !Number.isNaN(Date.parse(value.receivedAt))
  );
}

export async function sendReport(
  body: unknown,
  transport: ReportTransport,
): Promise<AiReportReceipt> {
  const response = await transport(JSON.stringify(body));
  if (response.status !== 201)
    throw new Error(
      response.status === 429 && response.retryAfter
        ? `rate_limited:${response.retryAfter}`
        : `http_${response.status}`,
    );
  if (!isAiReportReceipt(response.body)) throw new Error("invalid_receipt");
  return response.body;
}
