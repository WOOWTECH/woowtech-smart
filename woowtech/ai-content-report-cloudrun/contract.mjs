export const REPORT_SCHEMA_VERSION = 1;
export const REPORT_PATH = "/v1/ai-content-reports";
export const REPORT_REASONS = Object.freeze([
  "harassment_or_hate",
  "sexual_content",
  "violence_or_self_harm",
  "dangerous_or_deceptive",
  "other",
]);
export const REPORT_PLATFORMS = Object.freeze(["ios", "android", "web", "desktop"]);
export const MAX_CONTENT_BYTES = 8192;
export const MAX_BODY_BYTES = 12288;

const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "reportId",
  "reason",
  "platform",
  "appVersion",
  "locale",
  "reportedContent",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isShortString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function validateReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "body_not_object";
  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_FIELDS.has(key)) return `unexpected_field:${key}`;
  }
  if (value.schemaVersion !== REPORT_SCHEMA_VERSION) return "unsupported_schema";
  if (typeof value.reportId !== "string" || !UUID_RE.test(value.reportId))
    return "invalid_report_id";
  if (!REPORT_REASONS.includes(value.reason)) return "invalid_reason";
  if (!REPORT_PLATFORMS.includes(value.platform)) return "invalid_platform";
  if (!isShortString(value.appVersion, 40)) return "invalid_app_version";
  if (!isShortString(value.locale, 35)) return "invalid_locale";
  if (value.reportedContent !== null && typeof value.reportedContent !== "string") {
    return "invalid_reported_content";
  }
  if (typeof value.reportedContent === "string") {
    const size = Buffer.byteLength(value.reportedContent, "utf8");
    if (size === 0 || size > MAX_CONTENT_BYTES) return "invalid_reported_content_size";
  }
  return null;
}
