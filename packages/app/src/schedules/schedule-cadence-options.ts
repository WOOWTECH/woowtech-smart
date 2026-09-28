import type { TFunction } from "i18next";
import type { ScheduleCadence } from "@getpaseo/protocol/schedule/types";
import { i18n } from "@/i18n/i18next";
import { everyMsToParts } from "@/utils/schedule-format";

type CronCadence = Extract<ScheduleCadence, { type: "cron" }>;

export interface CadencePresetOption {
  id: string;
  label: string;
  expression: string;
}

export const CUSTOM_CRON_PRESET_ID = "custom";

// woowtech smart: preset labels come from the woowtech.schedules translations.
const CADENCE_PRESETS = [
  { id: "every-minute", labelKey: "everyMinute", expression: "* * * * *" },
  { id: "every-hour", labelKey: "everyHour", expression: "0 * * * *" },
  { id: "daily-9", labelKey: "daily9", expression: "0 9 * * *" },
  { id: "weekdays-9", labelKey: "weekdays9", expression: "0 9 * * 1-5" },
  { id: "mondays-9", labelKey: "mondays9", expression: "0 9 * * 1" },
] as const;

/** A preset's label, or the custom cron label for any other id, in the language of `t`. */
export function cadencePresetLabel(id: string, t: TFunction = i18n.t): string {
  const labelKey = CADENCE_PRESETS.find((preset) => preset.id === id)?.labelKey ?? "custom";
  return t(`woowtech.schedules.cadence.presets.${labelKey}`);
}

export const CADENCE_PRESET_OPTIONS: CadencePresetOption[] = CADENCE_PRESETS.map(
  ({ id, expression }) => ({
    id,
    expression,
    get label() {
      return cadencePresetLabel(id);
    },
  }),
);

export function resolveCronPresetId(cadence: CronCadence): string {
  const expression = cadence.expression.trim();
  return (
    CADENCE_PRESET_OPTIONS.find((option) => option.expression === expression)?.id ??
    CUSTOM_CRON_PRESET_ID
  );
}

export function resolveCronPresetDisplay(
  cadence: CronCadence,
  t: TFunction = i18n.t,
): { label: string } {
  return { label: cadencePresetLabel(resolveCronPresetId(cadence), t) };
}

export function normalizeScheduleFormCadence(
  cadence: ScheduleCadence,
  timezone: string,
): CronCadence {
  if (cadence.type === "cron") {
    return { ...cadence, timezone: cadence.timezone ?? timezone };
  }

  return {
    type: "cron",
    expression: everyMsToCronExpression(cadence.everyMs),
    timezone,
  };
}

function everyMsToCronExpression(everyMs: number): string {
  const { value, unit } = everyMsToParts(everyMs);
  if (unit === "minutes") {
    return value === 1 ? "* * * * *" : `*/${Math.min(value, 59)} * * * *`;
  }
  if (unit === "hours") {
    return value === 1 ? "0 * * * *" : `0 */${Math.min(value, 23)} * * *`;
  }
  return value === 1 ? "0 9 * * *" : `0 9 */${Math.min(value, 31)} * *`;
}
