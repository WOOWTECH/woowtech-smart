// Better Paseo keeps its own string tables, so the app's rebranding (packages/app/src/i18n/brand.ts)
// and its Traditional Chinese regeneration never reach them. Its zh-TW text came from a
// character-only conversion of the Simplified strings, which left Mainland vocabulary and upstream's
// product name on screen in every client. These checks read the plugin sources directly.
//
//   node --test woowtech/better-paseo-zh-tw.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const clientRoot = fileURLToPath(new URL("../plugins/better-paseo/client/", import.meta.url));

// Mainland wording and the Taiwan wording the app's own zh-TW uses. Words the app's zh-TW also
// uses (回退, 高亮, 列表) are not listed.
const MAINLAND_TERMS = {
  當前: "目前",
  實時: "即時",
  示例: "範例",
  信息: "資訊",
  設備: "裝置",
  宿主: "主機",
  協議: "協定",
  彈窗: "彈出視窗",
  導航: "導覽",
  繪制: "繪製",
  啓: "啟",
  默認: "預設",
  設置: "設定",
  文件夾: "資料夾",
  視頻: "影片",
  屏幕: "螢幕",
  鏈接: "連結",
  用戶: "使用者",
  數據: "資料",
  軟件: "軟體",
  菜單: "選單",
  搜索: "搜尋",
  粘貼: "貼上",
  窗口: "視窗",
  創建: "建立",
  加載: "載入",
  調用: "呼叫",
  緩存: "快取",
  網絡: "網路",
  字段: "欄位",
  代碼: "程式碼",
  光標: "游標",
  剪貼板: "剪貼簿",
  字體: "字型",
  圖標: "圖示",
  懸停: "停留",
  拖拽: "拖曳",
  函數: "函式",
  變量: "變數",
  內存: "記憶體",
  鼠標: "滑鼠",
  登錄: "登入",
  折疊: "摺疊",
  歸檔: "封存",
  帳戶: "帳號",
  插件: "外掛",
  自定義: "自訂",
  文檔: "文件",
  內置: "內建",
  工具欄: "工具列",
  響應: "回應",
  時間線: "時間軸",
  回車: "Enter 鍵",
  發送: "傳送",
  快捷鍵: "快速鍵",
  客戶端: "用戶端",
  會話: "工作階段",
  首條: "第一則",
  選中: "選取",
  點擊: "點選",
  命令: "指令",
  "“": "「",
  "”": "」",
};

const LITERAL = /"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g;
const BLOCK_START = /^\s*("zh-TW"\s*:\s*\{|(export\s+)?const\s+(zhTW|zhTw|ZH_TW)\b[^=]*=\s*\{)/;
const INLINE = /"zh-TW"\s*\?\s*("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
// Upstream's product name as a word, except the plugin's own name and references to upstream.
const PRODUCT_NAME = /(?<![A-Za-z])(?<!Better )Paseo(?![A-Za-z])(?! 上游)/;

function sourceFiles() {
  return readdirSync(clientRoot, { recursive: true })
    .filter(
      (name) => /\.tsx?$/.test(name) && !name.includes(".test.") && !name.includes("node_modules"),
    )
    .sort();
}

/** Every zh-TW string in the plugin, with the file and line it came from. */
function traditionalStrings() {
  const found = [];
  for (const name of sourceFiles()) {
    const lines = readFileSync(clientRoot + name, "utf8").split("\n");
    let depth = 0;
    let inBlock = false;
    lines.forEach((line, index) => {
      const where = `${name}:${index + 1}`;
      if (!inBlock && BLOCK_START.test(line)) {
        inBlock = true;
        depth = 0;
      }
      if (inBlock) {
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (!/^\s*(\/\/|\*|\/\*)/.test(line)) {
          for (const literal of line.match(LITERAL) ?? [])
            found.push({ where, text: literal.slice(1, -1) });
        }
        if (depth <= 0) inBlock = false;
        return;
      }
      for (const match of line.matchAll(INLINE)) found.push({ where, text: match[1].slice(1, -1) });
    });
  }
  return found;
}

test("the plugin's Traditional Chinese strings are found", () => {
  // Guards the scanner itself: an empty result would let every check below pass.
  assert.ok(traditionalStrings().length > 500);
});

test("Better Paseo's Traditional Chinese uses Taiwan wording", () => {
  const offending = traditionalStrings().flatMap(({ where, text }) => {
    // 用戶端 is the Taiwan word for client; only a bare 用戶 means user.
    const checked = text.replaceAll("用戶端", "");
    return Object.entries(MAINLAND_TERMS)
      .filter(([term]) => checked.includes(term))
      .map(([term, taiwan]) => `${where}: ${term} → ${taiwan}`);
  });
  assert.deepEqual(offending, []);
});

test("Better Paseo's Traditional Chinese never names upstream's product", () => {
  // The plugin cannot know the brand, so it says 主機 or App. "Better Paseo" is the plugin's name.
  const offending = traditionalStrings()
    .filter(({ text }) => PRODUCT_NAME.test(text))
    .map(({ where, text }) => `${where}: ${text.slice(0, 60)}`);
  assert.deepEqual(offending, []);
});
