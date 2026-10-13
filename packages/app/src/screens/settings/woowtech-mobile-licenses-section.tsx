import { useCallback, useMemo, useReducer } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import mobileLicenseData from "./mobile-third-party-licenses.json";

interface MobileLicense {
  name: string;
  url?: string;
}

interface MobileLicenseEntry {
  id: string;
  name: string;
  version: string;
  platforms: string[];
  licenses: MobileLicense[];
  documentIds: string[];
}

interface MobileLicenseCatalog {
  entries: MobileLicenseEntry[];
  documents: Record<string, string>;
}

interface State {
  query: string;
  page: number;
  expandedId: string | null;
}

type Action =
  | { type: "search"; query: string }
  | { type: "page"; page: number }
  | { type: "toggle"; id: string };

interface Copy {
  title: string;
  info: string;
  searchPlaceholder: string;
  noResults: string;
  version: string;
  platforms: string;
  license: string;
  show: string;
  hide: string;
  noFullText: string;
  previous: string;
  next: string;
  page: string;
}

const PAGE_SIZE = 20;
const catalog: MobileLicenseCatalog = mobileLicenseData;
const initialState: State = { query: "", page: 0, expandedId: null };
const COPY: Readonly<Record<"en" | "zh-TW", Copy>> = {
  en: {
    title: "Mobile third-party software",
    info: "Third-party software license texts and official references for mobile versions.",
    searchPlaceholder: "Search package name or version",
    noResults: "No packages match your search.",
    version: "Version",
    platforms: "Platforms",
    license: "License",
    show: "Show license",
    hide: "Hide license",
    noFullText: "Full license text is not included. Use the official reference above.",
    previous: "Previous",
    next: "Next",
    page: "Page {{current}} of {{total}}",
  },
  "zh-TW": {
    title: "行動版第三方軟體",
    info: "行動版第三方軟體的授權條款與官方參考網址。",
    searchPlaceholder: "搜尋套件名稱或版本",
    noResults: "沒有符合搜尋條件的套件。",
    version: "版本",
    platforms: "平台",
    license: "授權",
    show: "顯示授權",
    hide: "收合授權",
    noFullText: "此處未包含授權全文，請參考上方官方網址。",
    previous: "上一頁",
    next: "下一頁",
    page: "第 {{current}} 頁，共 {{total}} 頁",
  },
};

function reducer(state: State, action: Action): State {
  if (action.type === "search") return { query: action.query, page: 0, expandedId: null };
  if (action.type === "page") return { ...state, page: action.page, expandedId: null };
  return { ...state, expandedId: state.expandedId === action.id ? null : action.id };
}

function LicenseReference({ license, copy }: { license: MobileLicense; copy: Copy }) {
  return (
    <View style={styles.reference}>
      <Text selectable style={styles.detailLabel}>
        {copy.license}: {license.name}
      </Text>
      {license.url ? (
        <Text selectable style={styles.url}>
          {license.url}
        </Text>
      ) : null}
    </View>
  );
}

interface LicenseEntryRowProps {
  entry: MobileLicenseEntry;
  documents: Record<string, string>;
  copy: Copy;
  expanded: boolean;
  bordered: boolean;
  onToggle: (id: string) => void;
}

function LicenseEntryRow({
  entry,
  documents,
  copy,
  expanded,
  bordered,
  onToggle,
}: LicenseEntryRowProps) {
  const toggle = useCallback(() => onToggle(entry.id), [entry.id, onToggle]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const toggleLabel = `${expanded ? copy.hide : copy.show}: ${entry.name} ${entry.version}`;
  const licenseDocuments = useMemo(
    () =>
      entry.documentIds.flatMap((id) => {
        const text = documents[id];
        return text ? [{ id, text }] : [];
      }),
    [documents, entry.documentIds],
  );
  const hasReferenceUrl = entry.licenses.some((license) => Boolean(license.url));

  return (
    <View style={[settingsStyles.row, bordered && settingsStyles.rowBorder]}>
      <View style={[settingsStyles.rowContent, styles.rowContent]}>
        <Text selectable style={settingsStyles.rowTitle}>
          {entry.name}
        </Text>
        <Text selectable style={settingsStyles.rowHint}>
          {copy.version}: {entry.version}
        </Text>
        <Text selectable style={settingsStyles.rowHint}>
          {copy.platforms}: {entry.platforms.join(", ")}
        </Text>
        <View style={styles.references}>
          {entry.licenses.map((license) => (
            <LicenseReference
              key={`${entry.id}:${license.name}:${license.url ?? ""}`}
              license={license}
              copy={copy}
            />
          ))}
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={toggle}
          style={styles.toggleButton}
          accessibilityLabel={toggleLabel}
          accessibilityState={accessibilityState}
        >
          {expanded ? copy.hide : copy.show}
        </Button>
        {expanded ? (
          <View style={styles.documents}>
            {licenseDocuments.map((document) => (
              <Text selectable key={document.id} style={styles.documentText}>
                {document.text}
              </Text>
            ))}
            {licenseDocuments.length === 0 && hasReferenceUrl ? (
              <Text style={settingsStyles.rowHint}>{copy.noFullText}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function MobileLicensesSection() {
  const { i18n } = useTranslation();
  const copy = i18n.resolvedLanguage === "zh-TW" ? COPY["zh-TW"] : COPY.en;
  const [state, dispatch] = useReducer(reducer, initialState);
  const query = state.query.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(() => {
    if (!query) return catalog.entries;
    return catalog.entries.filter((entry) => {
      const name = entry.name.toLocaleLowerCase();
      const version = entry.version.toLocaleLowerCase();
      return name.includes(query) || version.includes(query);
    });
  }, [query]);
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const page = Math.min(state.page, pageCount - 1);
  const pageEntries = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredEntries.slice(start, start + PAGE_SIZE);
  }, [filteredEntries, page]);
  const search = useCallback((value: string) => dispatch({ type: "search", query: value }), []);
  const toggle = useCallback((id: string) => dispatch({ type: "toggle", id }), []);
  const previous = useCallback(() => dispatch({ type: "page", page: page - 1 }), [page]);
  const next = useCallback(() => dispatch({ type: "page", page: page + 1 }), [page]);
  const pageLabel = copy.page
    .replace("{{current}}", String(page + 1))
    .replace("{{total}}", String(pageCount));

  return (
    <SettingsSection title={copy.title} info={copy.info} testID="mobile-third-party-licenses">
      <View style={styles.controls}>
        <AdaptiveTextInput
          initialValue=""
          onChangeText={search}
          placeholder={copy.searchPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          testID="mobile-license-search"
        />
      </View>
      {pageEntries.length ? (
        <View style={settingsStyles.card}>
          {pageEntries.map((entry, index) => (
            <LicenseEntryRow
              key={entry.id}
              entry={entry}
              documents={catalog.documents}
              copy={copy}
              expanded={state.expandedId === entry.id}
              bordered={index > 0}
              onToggle={toggle}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>{copy.noResults}</Text>
      )}
      {filteredEntries.length > PAGE_SIZE ? (
        <View style={styles.pagination}>
          <Button variant="outline" size="sm" onPress={previous} disabled={page === 0}>
            {copy.previous}
          </Button>
          <Text style={styles.pageLabel}>{pageLabel}</Text>
          <Button variant="outline" size="sm" onPress={next} disabled={page >= pageCount - 1}>
            {copy.next}
          </Button>
        </View>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: { marginBottom: theme.spacing[3] },
  searchInput: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.base,
  },
  rowContent: { gap: theme.spacing[2] },
  references: { gap: theme.spacing[1] },
  reference: { gap: theme.spacing[1] },
  detailLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  url: { color: theme.colors.accent, fontSize: theme.fontSize.sm },
  toggleButton: { alignSelf: "flex-start" },
  documents: { gap: theme.spacing[4], paddingTop: theme.spacing[2] },
  documentText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
  },
  pageLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
