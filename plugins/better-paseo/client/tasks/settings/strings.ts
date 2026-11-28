import type {
  CardField,
  Density,
  DoneWindow,
  LabelLimit,
  LaneWidth,
  SidebarCount,
} from "../../../shared/tasks-settings";
import type { CardTitleLineCount } from "../device-store";
import type { TasksLanguage } from "../i18n";

/** The words of the Tasks board's half of the settings page. */
export interface TasksSettingsStrings {
  loading: string;
  error: (message: string) => string;
  invalid: (message: string) => string;
  saving: string;
  saveError: (message: string) => string;
  conflict: string;
  enabled: string;
  /** One line: what turning it on adds. */
  enabledHint: string;
  /** After the switch went on: where the entry appeared. */
  enabledConfirm: string;
  enabledConfirmHint: string;
  openBoard: string;
  openShortcut: string;
  shortcutHint: string;
  shortcutRecord: string;
  shortcutRecording: string;
  shortcutClear: string;
  shortcutDefault: string;
  shortcutNone: string;
  previewTitle: string;
  previewOffHint: string;
  previewOnHint: string;
  /** The off preview's tag: what it is a preview of. */
  previewOffTag: string;
  previewLanes: string;
  density: string;
  densityHint: string;
  densities: Record<Density, string>;
  cardTitle: string;
  fieldsTitle: string;
  fieldPreviewTitle: string;
  fieldPreviewHint: string;
  fieldPreviewHidden: string;
  fieldPreviewOffHint: string;
  fieldsHint: string;
  fields: Record<CardField, string>;
  moduleReset: (module: string) => string;
  moduleResetHint: string;
  moduleResetConfirmHint: string;
  labelLimit: string;
  labelLimits: Record<LabelLimit, string>;
  titleLines: string;
  titleLinesHint: string;
  titleLineCounts: Record<CardTitleLineCount, string>;
  compactCards: string;
  compactCardsHint: string;
  boardTitle: string;
  doneWindow: string;
  doneWindows: Record<DoneWindow, string>;
  showSubtasks: string;
  showSubtasksHint: string;
  showSubtasksTips: ReadonlyArray<{ label: string; text: string }>;
  showArchived: string;
  showArchivedHint: string;
  showEmptyGroups: string;
  showEmptyGroupsHint: string;
  showEmptyGroupsTips: ReadonlyArray<{ label: string; text: string }>;
  laneWidth: string;
  /** Says the phone ignores it: there one lane fills the screen. */
  laneWidthHint: string;
  laneWidths: Record<LaneWidth, string>;
  sidebarTitle: string;
  sidebarCount: string;
  sidebarCounts: Record<SidebarCount, string>;
  resetTitle: string;
  reset: string;
  resetHint: string;
  resetConfirmHint: string;
  resetCancel: string;
  /** The cancel row's own label, so it does not repeat its button's "Cancel". */
  resetKeep: string;
  resetInvalidHint: string;
}

export const TASKS_SETTINGS_STRINGS: Readonly<Record<TasksLanguage, TasksSettingsStrings>> = {
  en: {
    loading: "Loading the Tasks settings…",
    error: (message) => `The Tasks settings could not be loaded: ${message}`,
    invalid: (message) => `The saved Tasks settings are unusable: ${message}`,
    saving: "Saving…",
    saveError: (message) => `Could not save: ${message}`,
    conflict: "Settings changed elsewhere; reloaded the latest.",
    enabled: "Enable the Tasks board",
    enabledHint: "Adds Tasks to the sidebar: every task on this host, in lanes by status.",
    enabledConfirm: "Tasks is now at the top of the sidebar.",
    enabledConfirmHint: "Leave Settings to see it, or open the board from here.",
    openBoard: "Open board",
    openShortcut: "Quickly open the Tasks board",
    shortcutHint:
      "Works while Paseo is focused and Tasks is enabled. Saved on this device only. Choose a combination not used by Paseo or your system.",
    shortcutRecord: "Change shortcut",
    shortcutRecording: "Press a key with Command, Ctrl or Option / Alt. Escape cancels.",
    shortcutClear: "Clear shortcut",
    shortcutDefault: "Restore default shortcut",
    shortcutNone: "Not assigned",
    previewTitle: "Preview",
    previewOffHint:
      "What the board looks like once it is on: sample tasks, drawn with the options below.",
    previewOnHint: "Sample tasks, drawn with the options below as you change them.",
    previewOffTag: "Sample",
    previewLanes: "Lane",
    density: "Card density",
    densityHint: "Presets set card fields and the label limit.",
    densities: { minimal: "Minimal", standard: "Standard", full: "Full", custom: "Custom" },
    cardTitle: "Cards",
    fieldsTitle: "Fields",
    fieldPreviewTitle: "Card preview",
    fieldPreviewHint: "Follows the switches above; click the capsule for the list",
    fieldPreviewHidden: "Hidden",
    fieldPreviewOffHint: "Plan capsule is off",
    fieldsHint: "What each card shows. Phones keep the essentials whatever is picked here.",
    moduleReset: (module) => `Reset ${module} settings`,
    moduleResetHint: "Only settings in this section will be restored.",
    moduleResetConfirmHint: "This restores only this section's settings to their defaults.",
    fields: {
      provider: "Agent brand mark",
      model: "Model",
      thinking: "Thinking level",
      project: "Project",
      projectIcon: "Project icon",
      workspace: "Workspace name",
      branch: "Branch",
      gitStatus: "Git status",
      folder: "Folder",
      path: "Full path",
      labels: "Labels",
      pullRequest: "Linked PR",
      timer: "Timer / finished at",
      context: "Context usage ring",
      plan: "Plan capsule",
      subtasks: "Subtask summary",
    },
    labelLimit: "Labels shown",
    labelLimits: { "1": "1", "2": "2", "3": "3", all: "All" },
    titleLines: "Title lines",
    titleLinesHint: "Saved on this device only.",
    titleLineCounts: { "1": "1", "2": "2", "3": "3", "4": "4", all: "All" },
    compactCards: "Use minimal cards on phones",
    compactCardsHint: "Phones draw the Minimal card whatever the density above.",
    boardTitle: "Board",
    doneWindow: "Done lane window",
    doneWindows: { "24h": "Last 24 hours", "7d": "Last 7 days", all: "All" },
    showSubtasks: "Show subtasks",
    showSubtasksTips: [
      {
        label: "Visibility",
        text: "When off, running, waiting and failed subtasks still show in their lane, unless their parent’s card is there too.",
      },
      { label: "Storage", text: "Saved on this device only." },
    ],
    showSubtasksHint:
      "When off, running, waiting and failed subtasks still show in their lane, unless their parent's card is there too. Saved on this device only.",
    showArchived: "Show the archived lane",
    showArchivedHint:
      "Saved on this device only. A lane after Done with archived tasks and those of archived workspaces, in the same time window.",
    showEmptyGroups: "Show all",
    showEmptyGroupsTips: [
      {
        label: "Visibility",
        text: "The filters and the sidebar list every Agent, label, project and workspace in Paseo, with 0 where the board has none, including Done and Archived.",
      },
      { label: "Storage", text: "Saved on this device only." },
    ],
    showEmptyGroupsHint:
      "The filters and the sidebar list every Agent, label, project and workspace in Paseo, with 0 where the board has none, including Done and Archived. Saved on this device only.",
    laneWidth: "Lane width",
    laneWidthHint:
      "Saved on this device only. On desktop, web and tablets. Phones show one lane at a time.",
    laneWidths: { narrow: "Narrow", default: "Default", wide: "Wide" },
    sidebarTitle: "Sidebar",
    sidebarCount: "Sidebar entry count",
    sidebarCounts: {
      all: "Waiting · Running · Review",
      "input-only": "Waiting only",
      none: "Hidden",
    },
    resetTitle: "Reset",
    reset: "Restore the Tasks defaults",
    resetHint:
      "Restore card, board and sidebar options. The board switch and automatic titles are unchanged.",
    resetConfirmHint: "This restores card, board and sidebar options to their defaults.",
    resetCancel: "Cancel",
    resetKeep: "Keep the current options",
    resetInvalidHint: "Restoring the defaults replaces the unusable record.",
  },
  zh: {
    loading: "正在加载任务看板设置…",
    error: (message) => `任务看板设置加载失败：${message}`,
    invalid: (message) => `已保存的任务看板设置无法使用：${message}`,
    saving: "正在保存…",
    saveError: (message) => `保存失败：${message}`,
    conflict: "设置已在别处更改，已重新载入最新内容。",
    enabled: "启用任务看板",
    enabledHint: "在侧边栏加入「任务」，把这台主机上的所有任务按状态分泳道排列。",
    enabledConfirm: "「任务」已加入侧边栏顶部。",
    enabledConfirmHint: "退出设置即可看到，也可以直接从这里打开看板。",
    openBoard: "打开看板",
    openShortcut: "快速打开任务面板",
    shortcutHint:
      "Paseo 窗口有焦点且任务看板启用时生效，仅保存在当前设备。请选择未被 Paseo 或系统占用的组合键。",
    shortcutRecord: "修改快捷键",
    shortcutRecording: "请按下包含 Command、Ctrl 或 Option / Alt 的组合键；Esc 取消。",
    shortcutClear: "清除快捷键",
    shortcutDefault: "恢复默认快捷键",
    shortcutNone: "未设置",
    previewTitle: "实时预览",
    previewOffHint: "开启后看板就是这个样子：示例任务，按下面的选项绘制。",
    previewOnHint: "示例任务，随下面的选项实时变化。",
    previewOffTag: "示例",
    previewLanes: "泳道",
    density: "卡片信息密度",
    densityHint: "预设卡片字段和标签数量。",
    densities: { minimal: "精简", standard: "标准", full: "完整", custom: "自定义" },
    cardTitle: "卡片",
    fieldsTitle: "显示字段",
    fieldPreviewTitle: "卡片预览",
    fieldPreviewHint: "随上面的开关变化；点胶囊查看清单",
    fieldPreviewHidden: "已隐藏",
    fieldPreviewOffHint: "计划胶囊已关闭",
    fieldsHint: "每张卡片显示哪些信息。手机上始终保留最关键的几项。",
    moduleReset: (module) => `恢复「${module}」默认设置`,
    moduleResetHint: "只恢复本组设置，不影响其他组。",
    moduleResetConfirmHint: "这只会把本组设置恢复为默认值。",
    fields: {
      provider: "Agent 品牌标识",
      model: "模型",
      thinking: "思考等级",
      project: "项目",
      projectIcon: "项目图标",
      workspace: "工作区名称",
      branch: "分支",
      gitStatus: "Git 状态",
      folder: "文件夹",
      path: "完整路径",
      labels: "标签",
      pullRequest: "关联 PR",
      timer: "计时 / 完成于",
      context: "上下文占用环",
      plan: "计划胶囊",
      subtasks: "子任务摘要",
    },
    labelLimit: "标签数量",
    labelLimits: { "1": "1 个", "2": "2 个", "3": "3 个", all: "全部" },
    titleLines: "标题行数",
    titleLinesHint: "仅保存在当前设备。",
    titleLineCounts: { "1": "1 行", "2": "2 行", "3": "3 行", "4": "4 行", all: "全部" },
    compactCards: "手机上使用精简卡片",
    compactCardsHint: "手机上无论上面选哪种密度，都按精简卡片显示。",
    boardTitle: "看板",
    doneWindow: "已完成默认时间窗口",
    doneWindows: { "24h": "近 24 小时", "7d": "近 7 天", all: "全部" },
    showSubtasks: "显示子任务",
    showSubtasksTips: [
      {
        label: "显示范围",
        text: "关闭后，运行中、待输入和失败的子任务仍会显示，除非父任务在同一泳道。",
      },
      { label: "保存位置", text: "仅保存在当前设备。" },
    ],
    showSubtasksHint:
      "关闭后，运行中、待输入和失败的子任务仍会显示，除非父任务在同一泳道。仅保存在当前设备。",
    showArchived: "显示已归档泳道",
    showArchivedHint: "在已完成之后显示归档任务，时间窗口与已完成相同。仅保存在当前设备。",
    showEmptyGroups: "显示全部",
    showEmptyGroupsTips: [
      {
        label: "显示范围",
        text: "筛选菜单和侧栏也显示看板上没有任务的 Agent、标签、项目和工作区，已完成和已归档计入。",
      },
      { label: "保存位置", text: "仅保存在当前设备。" },
    ],
    showEmptyGroupsHint:
      "筛选菜单和侧栏也显示看板上没有任务的 Agent、标签、项目和工作区，已完成和已归档计入。仅保存在当前设备。",
    laneWidth: "泳道宽度",
    laneWidthHint: "用于桌面和非手机布局；仅保存在当前设备。",
    laneWidths: { narrow: "紧凑", default: "默认", wide: "宽松" },
    sidebarTitle: "侧边栏",
    sidebarCount: "侧边栏入口计数",
    sidebarCounts: {
      all: "待输入 · 运行中 · 待查看",
      "input-only": "只显示待输入",
      none: "不显示",
    },
    resetTitle: "恢复",
    reset: "恢复任务看板默认设置",
    resetHint: "恢复卡片、看板和侧栏选项；看板开关和自动标题设置不变。",
    resetConfirmHint: "这会把卡片、看板和侧栏选项恢复为默认值。",
    resetCancel: "取消",
    resetKeep: "保留当前选项",
    resetInvalidHint: "恢复默认设置会替换无法使用的记录。",
  },

  "zh-TW": {
    loading: "正在載入任務看板設定…",
    error: (message) => `任務看板設定載入失敗：${message}`,
    invalid: (message) => `已儲存的任務看板設定無法使用：${message}`,
    saving: "正在儲存…",
    saveError: (message) => `儲存失敗：${message}`,
    conflict: "設定已在別處更改，已重新載入最新內容。",
    enabled: "啟用任務看板",
    enabledHint: "在側邊欄加入「任務」，把這台主機上的所有任務按狀態分泳道排列。",
    enabledConfirm: "「任務」已加入側邊欄頂部。",
    enabledConfirmHint: "退出設定即可看到，也可以直接從這裡開啟看板。",
    openBoard: "開啟看板",
    openShortcut: "快速開啟任務面板",
    shortcutHint:
      "App 視窗有焦點且任務看板啟用時生效，僅儲存在目前裝置。請選擇未被 App 或系統佔用的組合鍵。",
    shortcutRecord: "修改快速鍵",
    shortcutRecording: "請按下包含 Command、Ctrl 或 Option / Alt 的組合鍵；Esc 取消。",
    shortcutClear: "清除快速鍵",
    shortcutDefault: "恢復預設快速鍵",
    shortcutNone: "未設定",
    previewTitle: "即時預覽",
    previewOffHint: "開啟後看板就是這個樣子：範例任務，按下面的選項繪製。",
    previewOnHint: "範例任務，隨下面的選項即時變化。",
    previewOffTag: "範例",
    previewLanes: "泳道",
    density: "卡片資訊密度",
    densityHint: "預設卡片欄位和標籤數量。",
    densities: { minimal: "精簡", standard: "標準", full: "完整", custom: "自訂" },
    cardTitle: "卡片",
    fieldsTitle: "顯示欄位",
    fieldPreviewTitle: "卡片預覽",
    fieldPreviewHint: "隨上面的開關變化；點膠囊檢視清單",
    fieldPreviewHidden: "已隱藏",
    fieldPreviewOffHint: "計劃膠囊已關閉",
    fieldsHint: "每張卡片顯示哪些資訊。手機上始終保留最關鍵的幾項。",
    moduleReset: (module) => `恢復「${module}」預設設定`,
    moduleResetHint: "只恢復本組設定，不影響其他組。",
    moduleResetConfirmHint: "這只會把本組設定恢復為預設值。",
    fields: {
      provider: "Agent 品牌標識",
      model: "模型",
      thinking: "思考等級",
      project: "專案",
      projectIcon: "專案圖示",
      workspace: "工作區名稱",
      branch: "分支",
      gitStatus: "Git 狀態",
      folder: "資料夾",
      path: "完整路徑",
      labels: "標籤",
      pullRequest: "關聯 PR",
      timer: "計時 / 完成於",
      context: "上下文佔用環",
      plan: "計劃膠囊",
      subtasks: "子任務摘要",
    },
    labelLimit: "標籤數量",
    labelLimits: { "1": "1 個", "2": "2 個", "3": "3 個", all: "全部" },
    titleLines: "標題行數",
    titleLinesHint: "僅儲存在目前裝置。",
    titleLineCounts: { "1": "1 行", "2": "2 行", "3": "3 行", "4": "4 行", all: "全部" },
    compactCards: "手機上使用精簡卡片",
    compactCardsHint: "手機上無論上面選哪種密度，都按精簡卡片顯示。",
    boardTitle: "看板",
    doneWindow: "已完成預設時間視窗",
    doneWindows: { "24h": "近 24 小時", "7d": "近 7 天", all: "全部" },
    showSubtasks: "顯示子任務",
    showSubtasksTips: [
      {
        label: "顯示範圍",
        text: "關閉後，執行中、待輸入和失敗的子任務仍會顯示，除非父任務在同一泳道。",
      },
      { label: "儲存位置", text: "僅儲存在目前裝置。" },
    ],
    showSubtasksHint:
      "關閉後，執行中、待輸入和失敗的子任務仍會顯示，除非父任務在同一泳道。僅儲存在目前裝置。",
    showArchived: "顯示已封存泳道",
    showArchivedHint: "在已完成之後顯示封存任務，時間視窗與已完成相同。僅儲存在目前裝置。",
    showEmptyGroups: "顯示全部",
    showEmptyGroupsTips: [
      {
        label: "顯示範圍",
        text: "篩選選單和側欄也顯示看板上沒有任務的 Agent、標籤、專案和工作區，已完成和已封存計入。",
      },
      { label: "儲存位置", text: "僅儲存在目前裝置。" },
    ],
    showEmptyGroupsHint:
      "篩選選單和側欄也顯示看板上沒有任務的 Agent、標籤、專案和工作區，已完成和已封存計入。僅儲存在目前裝置。",
    laneWidth: "泳道寬度",
    laneWidthHint: "用於桌面和非手機版面；僅儲存在目前裝置。",
    laneWidths: { narrow: "緊湊", default: "預設", wide: "寬松" },
    sidebarTitle: "側邊欄",
    sidebarCount: "側邊欄入口計數",
    sidebarCounts: {
      all: "待輸入 · 執行中 · 待檢視",
      "input-only": "只顯示待輸入",
      none: "不顯示",
    },
    resetTitle: "恢復",
    reset: "恢復任務看板預設設定",
    resetHint: "恢復卡片、看板和側欄選項；看板開關和自動標題設定不變。",
    resetConfirmHint: "這會把卡片、看板和側欄選項恢復為預設值。",
    resetCancel: "取消",
    resetKeep: "保留目前選項",
    resetInvalidHint: "恢復預設設定會替換無法使用的記錄。",
  },
};
