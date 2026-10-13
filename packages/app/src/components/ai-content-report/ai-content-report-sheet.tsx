import { useCallback, useMemo, useReducer } from "react";
import { Pressable, Text, View } from "react-native";
import { Flag } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { getUtf8ByteLength } from "@/components/assistant-message-render-limit";
import {
  AI_REPORT_REASONS,
  type AiReportReason,
  isAiReportConfigured,
  submitAiContentReport,
} from "./ai-content-report-client";

interface State {
  visible: boolean;
  reason: AiReportReason | null;
  includeContent: boolean;
  preview: string;
  pending: boolean;
  error: string | null;
  receipt: string | null;
}
type Action =
  | { type: "open"; content: string }
  | { type: "close" }
  | { type: "reason"; value: AiReportReason }
  | { type: "include"; value: boolean }
  | { type: "preview"; value: string }
  | { type: "pending" }
  | { type: "error"; value: string }
  | { type: "success"; value: string };
const initialState: State = {
  visible: false,
  reason: null,
  includeContent: false,
  preview: "",
  pending: false,
  error: null,
  receipt: null,
};
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "open":
      return { ...initialState, visible: true, preview: action.content };
    case "close":
      return state.pending ? state : initialState;
    case "reason":
      return { ...state, reason: action.value, error: null };
    case "include":
      return { ...state, includeContent: action.value, error: null };
    case "preview":
      return { ...state, preview: action.value, error: null };
    case "pending":
      return { ...state, pending: true, error: null };
    case "error":
      return { ...state, pending: false, error: action.value };
    case "success":
      return { ...state, pending: false, receipt: action.value };
  }
}

const COPY = {
  en: {
    title: "Report AI content",
    action: "Report",
    intro: "Tell the developer about this assistant message.",
    unavailable: "Reports can't be sent right now. Please try again later.",
    reason: "Reason",
    reasons: [
      "Harassment or hate",
      "Sexual content",
      "Violence or self-harm",
      "Dangerous or deceptive",
      "Other",
    ],
    include: "Include this message",
    excluded: "The message is not attached by default.",
    preview: "Review and edit exactly what will be attached",
    send: "Send report",
    sending: "Sending…",
    required: "Select a reason.",
    tooLarge: "The attached content must be 8 KB or less.",
    failed: "Delivery could not be confirmed. You can retry with this draft.",
    received: "Report received",
    receipt: "Receipt: {{id}}",
    close: "Close",
    retry: "Retry",
  },
  "zh-TW": {
    title: "回報 AI 內容",
    action: "回報",
    intro: "向開發者回報這則 AI 回覆。",
    unavailable: "目前無法送出，請稍後再試。",
    reason: "原因",
    reasons: ["騷擾或仇恨", "色情內容", "暴力或自我傷害", "危險或欺騙", "其他"],
    include: "附上這則訊息",
    excluded: "預設不附上訊息內容。",
    preview: "檢查並編輯實際要附上的內容",
    send: "送出回報",
    sending: "正在送出…",
    required: "請選擇原因。",
    tooLarge: "附加內容不可超過 8 KB。",
    failed: "無法確認是否送達。你可以保留這份草稿重試。",
    received: "已收到回報",
    receipt: "收據：{{id}}",
    close: "關閉",
    retry: "重試",
  },
} as const;

const ThemedFlag = withUnistyles(Flag);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface ReasonOptionProps {
  reason: AiReportReason;
  label: string;
  selected: boolean;
  onSelect: (reason: AiReportReason) => void;
}

function ReasonOption({ reason, label, selected, onSelect }: ReasonOptionProps) {
  const handlePress = useCallback(() => onSelect(reason), [onSelect, reason]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);
  const style = useMemo(() => [styles.reason, selected ? styles.reasonSelected : null], [selected]);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={style}
    >
      <Text style={styles.bodyText}>{label}</Text>
    </Pressable>
  );
}

export function AiContentReportAction({ getContent }: { getContent: () => string }) {
  const { i18n } = useTranslation();
  const copy = i18n.resolvedLanguage === "zh-TW" ? COPY["zh-TW"] : COPY.en;
  const [state, dispatch] = useReducer(reducer, initialState);
  const configured = isAiReportConfigured();
  const open = useCallback(() => dispatch({ type: "open", content: getContent() }), [getContent]);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const selectReason = useCallback(
    (reason: AiReportReason) => dispatch({ type: "reason", value: reason }),
    [],
  );
  const changeIncludeContent = useCallback(
    (value: boolean) => dispatch({ type: "include", value }),
    [],
  );
  const changePreview = useCallback((value: string) => dispatch({ type: "preview", value }), []);
  const submit = useCallback(async () => {
    if (!state.reason) return dispatch({ type: "error", value: copy.required });
    const content = state.includeContent ? state.preview : null;
    if (content !== null && getUtf8ByteLength(content) > 8192)
      return dispatch({ type: "error", value: copy.tooLarge });
    dispatch({ type: "pending" });
    try {
      const receipt = await submitAiContentReport({
        reason: state.reason,
        locale: i18n.resolvedLanguage ?? "en",
        reportedContent: content,
      });
      dispatch({ type: "success", value: receipt.receiptId });
    } catch {
      dispatch({ type: "error", value: copy.failed });
    }
  }, [copy, i18n.resolvedLanguage, state.includeContent, state.preview, state.reason]);
  const handleSubmit = useCallback(() => {
    void submit();
  }, [submit]);
  const header = useMemo(() => ({ title: copy.title }), [copy.title]);
  let submitLabel: string = copy.send;
  if (state.pending) submitLabel = copy.sending;
  else if (state.error) submitLabel = copy.retry;
  return (
    <>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={copy.action}
        hitSlop={8}
        style={styles.trigger}
        testID="assistant-report-trigger"
      >
        <ThemedFlag size={ICON_SIZE.sm} uniProps={muted} />
      </Pressable>
      <AdaptiveModalSheet
        visible={state.visible}
        onClose={close}
        header={header}
        testID="ai-content-report-sheet"
      >
        <Text style={styles.bodyText}>{copy.intro}</Text>
        {!configured ? <Text style={styles.error}>{copy.unavailable}</Text> : null}
        {state.receipt ? (
          <View style={styles.section}>
            <Text style={styles.heading}>{copy.received}</Text>
            <Text selectable style={styles.receipt}>
              {copy.receipt.replace("{{id}}", state.receipt)}
            </Text>
            <Button onPress={close}>{copy.close}</Button>
          </View>
        ) : (
          <>
            <Text style={styles.heading}>{copy.reason}</Text>
            <View style={styles.section}>
              {AI_REPORT_REASONS.map((reason, index) => (
                <ReasonOption
                  key={reason}
                  reason={reason}
                  label={copy.reasons[index]}
                  selected={state.reason === reason}
                  onSelect={selectReason}
                />
              ))}
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchCopy}>
                <Text style={styles.heading}>{copy.include}</Text>
                <Text style={styles.muted}>{copy.excluded}</Text>
              </View>
              <Switch
                value={state.includeContent}
                onValueChange={changeIncludeContent}
                disabled={state.pending}
                accessibilityLabel={copy.include}
              />
            </View>
            {state.includeContent ? (
              <View style={styles.section}>
                <Text style={styles.heading}>{copy.preview}</Text>
                <AdaptiveTextInput
                  initialValue={state.preview}
                  resetKey={state.visible ? 1 : 0}
                  onChangeText={changePreview}
                  multiline
                  editable={!state.pending}
                  style={styles.preview}
                  testID="ai-content-report-preview"
                />
              </View>
            ) : null}
            {state.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {state.error}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Button variant="secondary" onPress={close} disabled={state.pending}>
                {copy.close}
              </Button>
              <Button
                variant="default"
                onPress={handleSubmit}
                disabled={!configured || state.pending}
              >
                {submitLabel}
              </Button>
            </View>
          </>
        )}
      </AdaptiveModalSheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: { padding: theme.spacing[1], alignItems: "center", justifyContent: "center" },
  section: { gap: theme.spacing[2] },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  bodyText: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
  receipt: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  reason: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  reasonSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  switchCopy: { flex: 1, gap: theme.spacing[1] },
  preview: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
