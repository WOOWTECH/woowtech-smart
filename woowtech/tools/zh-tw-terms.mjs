// woowtech's fixes on top of OpenCC's Simplified to Traditional (Taiwan) conversion,
// where the Taiwan software vocabulary differs from OpenCC's output. Fixes apply in
// order to every converted string. `when` limits a fix to strings whose key or
// English source matches, for words whose meaning depends on the context.

const HAN = /[㐀-鿿]/;
// Chinese characters and the full-width punctuation around them.
const CJK = /[　-〿㐀-鿿＀-￯]/;
const LATIN = /[A-Za-z0-9]/;

/** A Latin term in place of `find`, spaced from the Chinese characters around it. */
function latin(find, term) {
  return {
    find: new RegExp(find, "g"),
    replace: (match, offset, text) => {
      const before = text[offset - 1];
      const after = text[offset + match.length];
      return `${before && HAN.test(before) ? " " : ""}${term}${after && HAN.test(after) ? " " : ""}`;
    },
  };
}

/** The space between `left` and `right`: none within Chinese, one between Chinese and Latin. */
function spacing(left, right, original) {
  if (!left || !right) return "";
  if (CJK.test(left) && CJK.test(right)) return "";
  if ((HAN.test(left) && LATIN.test(right)) || (LATIN.test(left) && HAN.test(right))) return " ";
  return original;
}

/**
 * `term` in place of the English `words` (regular expression source) upstream's
 * Simplified Chinese left inside a Chinese sentence, spaced like the sentence.
 * Strings with no Chinese stay English, and so do words that are part of a path,
 * file name, command or {{placeholder}}.
 */
function inChinese(words, term, flags = "gi") {
  return {
    find: new RegExp(`( ?)(?<![\\w./~$@\`'{}-])(?:${words})(?![\\w/\`'{}-])( ?)`, flags),
    replace: (match, before, after, offset, text) => {
      if (!HAN.test(text)) return match;
      const left = text[offset - 1];
      const right = text[offset + match.length];
      return `${spacing(left, term[0], before)}${term}${spacing(term.at(-1), right, after)}`;
    },
  };
}

/** `term` for a label upstream left as just the English word. */
function label(words, term) {
  return { find: new RegExp(`^(?:${words})$`), replace: term };
}

const aboutTabs = ({ key, english }) => /tab/i.test(key) || /\btabs?\b/i.test(english);

export const TERM_FIXES = [
  // Browser and terminal tabs are 分頁; workspace labels stay 標籤.
  { find: "標籤頁", replace: "分頁" },
  { find: "標籤", replace: "分頁", when: aboutTabs },
  { find: "會話", replace: "工作階段" },
  latin("二維碼", "QR Code"),
  latin("守護程序", "daemon"),
  latin("智慧體", "Agent"),
  latin("工作樹", "worktree"),
  { find: "倉庫", replace: "儲存庫" },
  { find: "指令碼", replace: "腳本" },
  { find: "日誌檔案", replace: "記錄檔" },
  { find: "日誌", replace: "記錄" },
  { find: "計劃", replace: "計畫" },
  { find: "撤銷", replace: "復原" },
  { find: "滾動", replace: "捲動" },
  { find: "回滾", replace: "捲動記錄" },
  { find: "許可權", replace: "權限" },
  { find: "快捷鍵", replace: "快速鍵" },
  { find: /(?<!連接)埠/g, replace: "連接埠" },
  { find: "當前", replace: "目前" },
  { find: /終端(?!機)/g, replace: "終端機" },
  { find: "歸檔", replace: "封存" },
  { find: "新建", replace: "新增" },
  { find: "獲取", replace: "取得" },
  { find: "幫助與支援", replace: "說明與支援" },
  { find: /^幫助$/g, replace: "說明" },
  // "via" when a word follows; "passed" (檢查通過) stays.
  { find: /通過(?=\s*[㐀-鿿A-Za-z0-9$])/g, replace: "透過" },
  { find: "本地網路", replace: "區域網路" },
  { find: "本地", replace: "本機" },
  { find: /應用(?!程式)/g, replace: "應用程式" },
  { find: "訪問", replace: "存取" },
  { find: "批准", replace: "核准" },
  { find: "構建", replace: "版本" },
  { find: "配置檔案", replace: "設定檔" },
  { find: "配置", replace: "設定" },
  { find: "放棄更改", replace: "捨棄變更" },
  { find: "更改", replace: "變更" },
  { find: "丟棄", replace: "捨棄" },
  { find: "丟失", replace: "遺失" },
  { find: "文本", replace: "文字" },
  { find: "生成", replace: "產生" },
  { find: "客戶端", replace: "用戶端" },
  { find: "全域性", replace: "全域" },
  { find: "源目錄", replace: "來源目錄" },
  { find: "匹配", replace: "符合" },
  { find: "自定義", replace: "自訂" },
  { find: "二進位制", replace: "二進位" },
  { find: "時間線", replace: "時間軸" },
  { find: "開發者工具", replace: "開發人員工具" },
  { find: "命令", replace: "指令" },
  { find: "運行", replace: "執行" },
  { find: "選中", replace: "選取" },
  { find: "賬號", replace: "帳號" },
  { find: "重置", replace: "重設" },
  { find: "桌面端", replace: "桌面版" },
  // Quit is 結束 on Taiwanese macOS; signing out is 登出.
  { find: "退出登入", replace: "登出" },
  { find: "退出", replace: "結束" },
  // Taiwan quotes with corner brackets.
  { find: "“", replace: "「" },
  { find: "”", replace: "」" },
  { find: "‘", replace: "『" },
  { find: "’", replace: "』" },
  // Network addresses and timeouts.
  { find: "地址", replace: "位址" },
  { find: "超時", replace: "逾時" },
  { find: /主機名(?!稱)/g, replace: "主機名稱" },
  // English nouns upstream's Simplified Chinese keeps inside Chinese sentences, and
  // labels it leaves as just the English noun. These stay English: the named terms
  // Agent, Host, Daemon and worktree; Git commands (commit, push, pull, merge, stash)
  // and forge terms (PR, MR, issue, pull request); diff, hooks, tokens, acronyms, and
  // product and brand names. Phrases come before the words they contain.
  inChinese("System Settings > Notifications", "「系統設定」>「通知」"),
  inChinese("host/port", "Host、連接埠"),
  inChinese("system prompts?", "系統提示詞"),
  inChinese("realtime voice", "即時語音"),
  inChinese("web runtime", "網頁執行環境"),
  inChinese("desktop app", "桌面版 App"),
  inChinese("projects?", "專案"),
  inChinese("workspaces?", "工作區"),
  inChinese("providers?", "供應商"),
  inChinese("servers?", "伺服器"),
  inChinese("terminals?", "終端機"),
  inChinese("models?", "模型"),
  inChinese("scripts?", "腳本"),
  inChinese("clients?", "用戶端"),
  inChinese("relays?", "中繼"),
  inChinese("repository|repositories", "儲存庫"),
  inChinese("branch(?:es)?", "分支"),
  inChinese("remotes?", "遠端"),
  inChinese("modes?", "模式"),
  inChinese("features?", "功能"),
  inChinese("thinking", "思考"),
  inChinese("runtimes?", "執行環境"),
  inChinese("prompts?", "提示詞"),
  inChinese("sub-?agents?", "子 Agent"),
  inChinese("reviews?", "審查"),
  inChinese("drafts?", "草稿"),
  inChinese("skills?", "技能"),
  inChinese("tools", "工具"),
  // Lowercase only: Command is the macOS key in "Command/Ctrl+Enter".
  inChinese("commands", "指令", "g"),
  inChinese("setup", "初始化"),
  inChinese("teardown", "清理"),
  inChinese("turn", "回合", "g"),
  // The named terms, capitalized and singular: Chinese has no plural.
  inChinese("[Aa]gents|agent", "Agent", "g"),
  inChinese("[Hh]osts|host", "Host", "g"),
  inChinese("app", "App", "g"),
  label("Agents", "Agent"),
  label("Hosts", "Host"),
  label("Providers?", "供應商"),
  label("Workspaces?", "工作區"),
  label("Terminals?", "終端機"),
  label("Model", "模型"),
  label("Mode", "模式"),
  label("Thinking", "思考"),
  label("Features", "功能"),
  label("Scripts", "腳本"),
  label("Client", "用戶端"),
  label("Relay", "中繼"),
  label("Skills", "技能"),
  label("Subagent", "子 Agent"),
  label("Setup", "初始化"),
  label("Teardown", "清理"),
  label("Reviews", "審查"),
  label("Draft", "草稿"),
  label("Prompt", "提示詞"),
  label("\\{\\{scriptName\\}\\} script", "{{scriptName}} 腳本"),
  label("Prompt \\{\\{name\\}\\}", "給 {{name}} 的提示詞"),
];
