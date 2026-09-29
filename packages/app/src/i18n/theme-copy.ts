// The name of the dark theme whose id is "claude": 陶土, Terracotta in English. woowtech smart
// does not name its own features after Claude, because Anthropic's terms forbid using its names
// as part of a product's own feature names (woowtech/README.md section 22). The id, the
// unistyles name and the colors stay, so a user who picked the theme keeps it. Keyed by dotted
// translation key and applied as the translations load, like support-copy.ts.
type ThemeCopy = Readonly<Record<string, string>>;

const CLAUDE_THEME = "settings.appearance.theme.options.claude";

const ENGLISH: ThemeCopy = { [CLAUDE_THEME]: "Terracotta" };

const THEME_COPY: Readonly<Record<string, ThemeCopy>> = {
  en: ENGLISH,
  "zh-TW": { [CLAUDE_THEME]: "陶土" },
  "zh-CN": { [CLAUDE_THEME]: "陶土" },
  ja: { [CLAUDE_THEME]: "テラコッタ" },
  ko: { [CLAUDE_THEME]: "테라코타" },
  es: { [CLAUDE_THEME]: "Terracota" },
  fr: { [CLAUDE_THEME]: "Terre cuite" },
  "pt-BR": { [CLAUDE_THEME]: "Terracota" },
  ru: { [CLAUDE_THEME]: "Терракота" },
  ar: { [CLAUDE_THEME]: "تيراكوتا" },
};

/** The theme names for `language`. A language upstream adds later reads the English name. */
export function themeCopyFor(language: string): ThemeCopy {
  return THEME_COPY[language] ?? ENGLISH;
}
