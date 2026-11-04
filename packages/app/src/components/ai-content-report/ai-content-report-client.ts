import Constants from "expo-constants";
import * as ExpoCrypto from "expo-crypto";
import { Platform } from "react-native";
import { getIsElectron } from "@/constants/platform";
import { resolveAppVersion } from "@/utils/app-version";
import {
  reportPlatform,
  sendReport,
  type AiReportReceipt,
  type ReportTransport,
} from "./ai-content-report-logic";
export type { AiReportReceipt } from "./ai-content-report-logic";

export const AI_REPORT_REASONS = [
  "harassment_or_hate",
  "sexual_content",
  "violence_or_self_harm",
  "dangerous_or_deceptive",
  "other",
] as const;
export type AiReportReason = (typeof AI_REPORT_REASONS)[number];

function configuredEndpoint(): string | null {
  const raw = Constants.expoConfig?.extra?.aiContentReportUrl;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim());
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (__DEV__ && url.protocol === "http:" && loopback)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function isAiReportConfigured(): boolean {
  return configuredEndpoint() !== null;
}

export async function submitAiContentReport(
  input: { reason: AiReportReason; locale: string; reportedContent: string | null },
  injected?: { transport: ReportTransport; generateId: () => string },
): Promise<AiReportReceipt> {
  const endpoint = configuredEndpoint();
  if (!endpoint) throw new Error("reporting_not_configured");
  const defaultTransport: ReportTransport = async (body) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        signal: controller.signal,
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
        retryAfter: response.headers.get("retry-after"),
      };
    } finally {
      clearTimeout(timeout);
    }
  };
  return sendReport(
    {
      schemaVersion: 1,
      reportId: (injected?.generateId ?? ExpoCrypto.randomUUID)(),
      reason: input.reason,
      platform: reportPlatform(Platform.OS, getIsElectron()),
      appVersion: resolveAppVersion() ?? "unknown",
      locale: input.locale || "en",
      reportedContent: input.reportedContent,
    },
    injected?.transport ?? defaultTransport,
  );
}
