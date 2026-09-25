# woowtech smart（渥屋智能）

這個 repo 是 [getpaseo/paseo](https://github.com/getpaseo/paseo)（Apache-2.0）的商用 fork。
運作方式跟 Home Assistant Core 加 HA App 一樣：使用者在自己的電腦上跑 daemon，App 只連自己的 daemon。
v1 平台是 iOS、Android、macOS 桌面版和 CLI，Windows 延後。

`woowtech/` 放 fork 專屬的東西。上游的檔案盡量不動，之後合併上游才不會一直衝突。

## 分支與上游

- `main` 是我們的產品線：上游 `836f1a9`（v0.8.0）加上我們的 commit。
- 本機的 remote `upstream` 指向 getpaseo/paseo，同步上游用：

  ```bash
  git fetch upstream
  git merge upstream/main   # 或只 cherry-pick 需要的修正
  npx tsx woowtech/tools/generate-zh-tw.mjs   # 上游改了簡體中文就重新產生繁體
  node --test woowtech/*.test.mjs   # 合併後確認沒有帶回原版的更新來源、預設值、名稱和連結
  ```

- 改動原則：新程式放新檔案，接點只改上游很少動的檔案。上游每週大約有 100 個 commit，下面這幾個是熱檔，盡量別碰：
  `packages/server/src/server/agent/providers/claude/agent.ts`、`packages/server/package.json`、`packages/server/src/server/bootstrap.ts`。
- GitHub Actions 目前是關閉的。上游有 11 個 workflow，其中 8 個會在 push 時觸發（CI、部署 App 與網站、發佈版本等），部分用 macOS runner。要打開之前，先把 workflow 改成我們要的。

## 跟上游的差異

### 1. App 身分與 EAS

- `woowtech/apply-identity.mjs` 會把 `packages/app/app.config.js` 裡的 Expo owner、slug、EAS project id 和 bundle id 換成我們的（預設 `io.woowtech.smart`）。
  repo 裡的 `app.config.js` 仍是上游原值，建置前再執行這個腳本，用法寫在檔案開頭。
- 連結 scheme 見第 5 節。
- `packages/app/eas.json` 多了 `preview` profile：產生內部發佈用的 release APK，並略過 lint。

### 2. 拿掉本地語音

- 原因：`sherpa-onnx-node` 靜態連結了 GPL-3.0 的 eSpeak NG，第一次啟動還要下載約 985MB 的模型。
- 做法：`packages/server/src/server/speech/providers/local/local-speech-runtime.ts` 會偵測這個套件有沒有安裝，沒裝就不產生本地語音設定。
  接點在 `local/config.ts` 的 `shouldIncludeLocalProviderConfig`。
- 影響：語音模式不能用，因為輪替偵測只有本地版。聽寫可以改走 OpenAI，要另外設定 `PASEO_DICTATION_STT_PROVIDER=openai`。
- 要恢復地端語音（例如企業版），把 `sherpa-onnx-node` 裝回去就好，不用改程式。
- daemon log 會出現「Local … selected but local provider config is missing」，真正原因是套件沒裝。這則訊息之後再改。

### 3. Claude Agent SDK 第一次用到才下載

- 原因：SDK 是 Anthropic 的專有授權（All rights reserved），不隨產品散佈。
- 載入順序（`packages/server/src/server/agent/providers/claude/claude-agent-sdk-runtime.ts`）：
  1. node_modules 裡有就直接用。開發機會有，因為它是 devDependency。
  2. 否則用 `$PASEO_HOME/runtime-deps/claude-agent-sdk-<版本>/`。
  3. 都沒有才從 npm registry 下載，sha512 對不上就拒絕，什麼都不裝。實測檔案 4.6MB，第一個 Claude 對話會多等約 3 秒。
- `claudeQuery()` 必須立刻回傳 Query，所以 SDK 還沒載入時，它會先回傳 `DeferredQuery`（`deferred-query.ts`）。
  Query 的每個方法都寫明轉發，SDK 升版改了介面時會直接編譯失敗，不會默默漏掉某個呼叫。
- Claude 本身一律使用使用者自己安裝的 `claude`，這是上游原本的設計，SDK 內附的執行檔用不到。
- 升級 SDK 時，這三個地方要一起改：
  - `CLAUDE_AGENT_SDK_VERSION`
  - `CLAUDE_AGENT_SDK_INTEGRITY`，用 `npm view @anthropic-ai/claude-agent-sdk@<版本> dist.integrity` 取得
  - `packages/server/package.json` 的 devDependency
- 不要開 TypeScript 的 `verbatimModuleSyntax`。一開，`agent.ts` 的 `import { type … } from "@anthropic-ai/claude-agent-sdk"` 會被編譯成 `import {} from …`，SDK 又變回啟動必要的相依套件，沒裝的話 daemon 會起不來。
- 使用者第一次用 Claude 時，電腦要連得到 registry.npmjs.org。連不到時，對話裡會顯示錯誤，下次開對話會自動重試。
- 關閉對話時會出現「close query interrupt … ProcessTransport is not ready for writing」的警告，這是上游原本就有的（先 close 再 interrupt），跟這項改動無關。

### 4. 更新來源改成我們自己的

原版有三條路會把我們的產品換回原版 Paseo，都已改掉。手機 App 沒有 OTA 更新，不受影響。

- 桌面版自動更新：`packages/desktop/electron-builder.yml` 的 `publish` 改指向公開的發佈專用 repo `WOOWTECH/woowtech-smart-releases`。
  原始碼 repo 是私有的，使用者電腦上的 App 讀不到它的 Releases，所以安裝檔要放在另一個公開 repo。這個 repo 第一次正式發佈時再建。
- daemon 自我更新：原版會執行 `npm install -g @getpaseo/cli@latest`。
  現在預設改用 `unavailable-npm-global-cli.ts`，一律拒絕並提示改更新桌面版，不會執行 npm。
  v1 的 daemon 跟著桌面版一起發佈。不改成「我們自己的 npm 套件名」，是因為萬一那個名字被別人搶先註冊，對方就能把程式推到使用者電腦上。
- 下載連結：App 的 Apple Silicon 版下載連結（`desktop-updates.ts`）、Rosetta 提示的備用網址、CLI 的 `open` 和 `onboard` 指令，都改成我們的發佈頁。
- `woowtech/update-sources.test.mjs` 會檢查打包設定裡的每一個 `publish`，並掃描 app、cli、desktop、server 的原始碼，確認沒有原版的下載或發佈網址。
- Apple Silicon 版的下載連結用的是 `Paseo-<版本>-arm64.dmg` 這個檔名。之後改品牌、動到 `electron-builder.yml` 的 `mac.artifactName` 時，`desktop-updates.ts` 的 `buildMacAppleSiliconDownloadUrl` 要一起改。

### 5. 跟官方 Paseo 共存（品牌識別第一步）

同一台電腦裝了官方 Paseo 時，原本兩邊共用資料夾、port、連結 scheme 和桌面版身分：後啟動的 daemon 搶不到 port，App 甚至可能連到官方的 daemon。現在全部分開：

| 項目               | 原版                       | woowtech smart                           |
| ------------------ | -------------------------- | ---------------------------------------- |
| daemon 資料夾      | `~/.paseo`                 | `~/.woowtech-smart`                      |
| 預設 port          | 6767                       | 6770                                     |
| 連結 scheme        | `paseo://`                 | `woowtech-smart://`                      |
| 桌面版 appId       | `sh.paseo.desktop`         | `io.woowtech.smart.desktop`              |
| 桌面版名稱／執行檔 | `Paseo`                    | `woowtech smart`（`woowtech smart.app`） |
| 桌面版更新下載快取 | `@getpaseodesktop-updater` | `io.woowtech.smart.desktop-updater`      |

- port 在 daemon、App（本機備援位址、手動新增主機的預設值）、CLI 說明和 SSH 連線的預設值都一致。
- scheme 同時用在桌面版載入介面的來源、系統註冊的連結、手機 App、深層連結和 daemon 的 CORS 白名單。原版的 `paseo://` 連結留給官方 Paseo，我們不接；診斷報告會把兩種連結都遮掉。
- electron-builder 用 `executableName` 命名 `.app` 和主執行檔，用 `productName` 命名 helper，所以兩個設成一樣，跟上游相同。
- 用名稱找桌面版的地方都改了：CLI 的 `open`、`bin/paseo`（透過 helper 執行 CLI）、打包腳本、Linux 啟動器。
- 更新下載快取在系統的快取資料夾底下（macOS 是 `~/Library/Caches/`）。資料夾名稱由 electron-builder 從 `package.json` 的 `name` 算出來寫進 `app-update.yml`，`publish` 裡設的值會被蓋掉。
  上游的 `@getpaseo/desktop` 會算出跟官方 Paseo 同一個資料夾，所以 `electron-builder.yml` 用 `extraMetadata.name` 把打包進去的名稱改成 appId。
  - 跟著改成我們的：Windows 安裝時留給差異更新用的安裝檔副本、解除安裝加上 `--delete-app-data` 時清掉的 `%APPDATA%\<名稱>`。Linux deb/rpm 的套件名稱從 `woowtech smart` 變成 `io.woowtech.smart.desktop`。
  - 不受影響：`main.ts` 一啟動就用 `app.setName` 改名，userData 和 log 資料夾看的是那個名稱。
  - electron-builder 用套件名稱在 workspace 裡找桌面版的相依套件，改名後找不到，會改成逐一走訪 `node_modules`。兩種做法收集到的模組完全相同（277 筆，連版本和來源路徑都一樣），升級 electron-builder 後要再比對一次。
    會退回逐一走訪，是因為在 repo 根目錄也找不到：根目錄的 `package.json` 沒有 `dependencies` 和 `optionalDependencies`（上游 2026-04 才拿掉）。合併上游後如果又出現，electron-builder 會改打包根目錄的相依套件，桌面版自己的（electron-log、electron-updater、`@getpaseo/server` 等）都不會進 app.asar，打包本身不會報錯。
- `woowtech/coexistence.test.mjs` 檢查以上所有值彼此一致，也掃描原始碼裡不能再出現 `~/.paseo` 和 6767。快取資料夾名稱直接交給桌面版的 electron-builder 計算。
- CLI 指令改叫 `woowtech-smart`，兩邊的 CLI 可以裝在同一個 PATH 上，見第 12 節。
- 還沒處理的：
  - 安裝檔檔名仍是 `Paseo-…`，第二步改名稱時跟 `desktop-updates.ts` 的 DMG 連結一起改。
  - 手機 App 的 bundle id 仍在建置前由 `apply-identity.mjs` 套用。
  - Linux 的執行檔名稱含空白。Linux 不在 v1，要支援時再考慮 `linux.executableName`。

### 6. 看得到的名稱（品牌識別第二步）

- 介面文字：`packages/app/src/i18n/brand.ts` 在語系載入時把「Paseo」換掉，語系檔本身不動（英文語系檔上游 90 天改了 133 次）。
  - 中文顯示「渥屋智能」，「Paseo Desktop」變成「渥屋智能桌面版」。中文字之間的空格會拿掉，與英文單字之間的空格保留。
  - 其他語言顯示「woowtech smart」。
  - 只替換語系資源，不動插入的值，使用者自己叫 Paseo 的專案名稱不會被改。`$PASEO_PORT`、`paseo.json` 這類全大寫或小寫的技術名稱也不受影響。
- App 裡寫死的 4 句英文，以及網頁版的名稱和標題都已改。`git/use-actions.tsx` 裡有一句要跟 daemon 的英文錯誤訊息完全一致，是刻意保留的例外；使用者看到的是翻譯後的文字，已經替換過。
- 安裝檔改名為 `woowtech-smart-<版本>-<架構>.dmg` 等，App 的 Apple Silicon 下載連結跟著改。Linux 套件的維護者欄位改成 WoowTech。
- agent 透過 ACP 看到的 `clientInfo.name` 改成 `woowtech smart`。
- 手機 App 的名稱和 bundle id 直接寫在 `app.config.js`：正式版 `io.woowtech.smart`，Debug 版 `io.woowtech.smart.debug`。
  - 中文手機桌面顯示「渥屋智能」（Debug 版是「渥屋智能 Debug」）。iOS 用 Expo 的 `locales`；Expo 只把 `locales` 套到 iOS，Android 由 `plugins/with-localized-app-name.js` 讀同一份設定寫進 Android 資源。
  - `apply-identity.mjs` 現在只處理 Expo 帳號相關的 owner、slug、project id。
- App 的 vitest 原本只跑 `src/`，`plugins/` 的測試（包含上游的 `with-paste-input.test.ts`）從來沒被執行過，已加進單元測試的 include。
- `woowtech/names.test.mjs` 檢查安裝檔名稱與下載連結一致、App 裡寫死的文字、agent 看到的名稱，並用 `expo config` 檢查手機 App 的實際設定。
- CLI 的說明文字跟 CLI 改名一起處理，見第 12 節。
- 刻意沒改的：
  - `maestro/` 的 UI 測試流程還指向 `sh.paseo`：要用 Maestro 時再改 appId。
  - `fastlane/` 是上游的商店上架文案：上架前另外準備。
- bundle id 換了，之前裝在模擬器和手機上的開發版要重新 prebuild、重新建置；新版會以另一個 App 的身分安裝。

### 7. 繁體中文

- 上游只把 zh、zh-CN、zh-Hans 對應到簡體中文，**系統語言是繁體（台灣、香港）的裝置原本會顯示英文**。現在所有中文系統語言都顯示繁體中文，語言選單只列「繁體中文」。
  簡體語系（zh-CN）仍然可以載入，上游有很多測試拿它當範例，所以沒拿掉，只是不再對應也不列在選單上。
- `packages/app/src/i18n/resources/zh-TW.ts` 是產生的檔案，不要手改。
  - 產生方式：`woowtech/tools/generate-zh-tw.mjs` 把上游的簡體中文（連同外掛設定的翻譯）用 OpenCC 轉成台灣用語的繁體，再套 `woowtech/tools/zh-tw-terms.mjs` 的用詞修正。
  - 要改用詞，就改修正表再重新產生。
- 修正表處理 OpenCC 沒轉成台灣習慣的詞：
  - 一般詞彙，例如會話→工作階段、二維碼→QR Code、許可權→權限、日誌→記錄、歸檔→封存、新建→新增、命令→指令、退出→結束、引號改成「」。
  - 看上下文的規則：
    - 英文原文講 tab 的「標籤」才改成「分頁」，工作區的 Labels 維持「標籤」。
    - 「通過」後面接東西才改成「透過」，「檢查通過」不變。
    - 插入英文詞時自動在中文前後補空格。
- 產生器只裝在 `woowtech/tools/`（自己的 package.json），不動上游的相依套件。第一次使用先 `npm ci --prefix woowtech/tools`。
- 上游簡體檔裡本來就有些句子是英文（沒翻譯），繁體也會照樣顯示英文。
- 測試：
  - `packages/app/src/i18n/zh-tw.test.ts` 檢查每個英文鍵值都有繁體、插入值的佔位符一致、沒有簡體專用字，並抽驗實際顯示的句子。
  - `woowtech/zh-tw.test.mjs` 確認提交的繁體檔跟重新產生的一致，上游改了簡體卻沒重新產生時會失敗。

### 8. 圖示與 logo（品牌識別第三步）

- 採白底藍字（WOOW 標誌 #6183fc），跟 WOOW Home 的藍底白字做出區隔。桌面版的開發版用藍底白字，一眼能分辨。
- 來源是 `woowtech/brand/woowtech-symbol.svg`：設計系統的官方字形，是 PDF 轉出的 SVG，已經裁切到字形的範圍。
  - `woowtech/tools/flatten-symbol.py` 把它攤平成 `woowtech-symbol-path.svg`，共 10 筆路徑，畫出來跟原檔逐像素相同。
  - 不能合成一條路徑：筆畫會重疊，合成後在非零環繞規則下，交叉處會被挖成空洞。
- `woowtech/tools/generate-icons.mjs` 產生全部 22 個圖示，需要 Google Chrome、sips 和 iconutil。加 `--out <資料夾>` 可以只輸出預覽。
  - iOS：1024 滿版、沒有透明通道。
  - Android：自適應圖示的字形寬度 40%，落在安全區內，底色白色；通知圖示是白色剪影。
  - favicon：字形放大，16px 也看得出輪廓。狀態點沿用上游的顏色，執行中是 #3b82f6、需要注意是 #22c55e。
  - macOS：照 824/1024 的格線畫，含陰影。
- App 裡的 logo 元件（`paseo-logo.tsx`，有 5 個地方在用）改畫 WOOW 標誌，顏色見第 9 節。
- `woowtech/icons.test.mjs` 檢查以下幾件事，合併上游時如果被換回 Paseo 的圖示就會失敗：
  - 圖示內容：有品牌藍、沒有上游的黑色方塊。
  - 尺寸和格式。
  - Android 的底色和通知的強調色。
  - logo 元件跟品牌檔一致。
- 換 logo 的步驟：
  1. 更新 `woowtech/brand` 裡的來源檔。
  2. 跑 `flatten-symbol.py`。
  3. 跑 `generate-icons.mjs`。
  4. 更新 `paseo-logo.tsx` 的路徑（測試會提醒）。

### 9. 品牌色

- 強調色用品牌藍 #6183fc，出現在主要按鈕（例如歡迎頁的「直接連線」）、開關和選取狀態。
  - 這是看過 A/B 兩版截圖後選定的。
  - 已知取捨：按鈕上的白字對比是 3.4:1，低於無障礙 AA 標準的 4.5:1。
- 深色背景上的連結用比較淡的 #8fa6fd，確保讀得清楚。
- 預設的深色主題原本帶上游的綠色調，現在背景改成中性灰（沿用 Zinc 的灰階），紅色也改用 Zinc 那組中性紅。其他深色主題（Zinc、Midnight、Claude、Ghostty）維持原樣。
- 品牌藍只寫在 `packages/app/src/styles/brand.ts`（`BRAND_BLUE`），主題的強調色直接引用它。
  主題清單裡代表預設深色主題的色塊（上游是綠色 #2D8B62）也引用它。選單上深色主題顯示的是月亮圖示，這個色塊目前沒有畫出來。
- 下面兩個值沒辦法引用 `brand.ts`，改品牌藍時要一起改。上游兩處都是綠色 #20744A：
  - Android 通知的強調色，通知的小圖示會染成這個顏色。寫在 `packages/app/app.config.js` 的 expo-notifications 外掛設定。
  - 網頁版的鍵盤焦點框。桌面版載入的是同一份網頁，所以也一起改了。寫在 `packages/app/public/index.html` 的 `*:focus-visible`。
- 有意義的綠色維持上游原樣，色值也跟品牌綠不同：成功狀態、diff 的新增行、健康檢查通過的執行中腳本、自動接受模式（快速模式是黃色、規劃模式是藍色）、終端機的 ANSI 綠。
- logo 元件不管呼叫端傳什麼顏色，一律畫品牌藍，因為品牌標誌不應該跟著主題變色。
- 測試：
  - `styles/theme.test.ts` 檢查品牌色和中性背景，`components/icons/paseo-logo.test.tsx` 檢查 logo 一律是品牌藍。
  - `woowtech/brand-colors.test.mjs` 掃描出貨的 App、網頁和桌面版檔案，連同 `app.config.js` 和 `electron-builder.yml`，不准出現上游的品牌綠。
    範圍包括 #20744A、上游主題的兩個亮色（淺色 #239956、深色 #7ccba0）和代表色 #2D8B62，十六進位和 `rgb()`／`rgba()` 寫法都算。

### 10. 說明與求助連結（品牌識別第四步）

- 對外連結都寫在 `packages/protocol/src/brand-links.ts`（`BRAND_LINKS`），App 和 CLI 共用。要改連結，只改這個檔案。
- 說明文件：官網 aiot.woowtech.io 還沒有說明頁，App 的 8 處和 CLI 的 2 處都先開官網首頁。哪個主題有了頁面，就改 `docs` 裡對應的那一項。
- 回報問題：寄信到 woowtech@designsmart.com.tw。
  上游的外部連結開啟器只放行 http/https。現在 App 的 `utils/open-external-url.ts` 和桌面版的 `features/opener.ts` 多放行 `mailto:`，`file:`、`javascript:` 照樣擋掉。
- 社群：LINE 官方帳號 @lwo6431z。
  - 說明選單的 Discord 改成 LINE。
  - 設定的「關於」頁和專案首頁底部，原本有 GitHub Star、贊助上游作者、Discord 三個按鈕，現在只留 LINE。
- 更新紀錄：App 讀發佈 repo 的 `CHANGELOG.md`，右上角的外部連結開發佈頁。發佈 repo 放上 `CHANGELOG.md` 之前，打開會顯示「無法載入更新記錄」。
- 官網：歡迎頁的連結（只在手機上顯示）改成 aiot.woowtech.io。
- 文案：
  - 上游的翻譯 key 仍叫 `discord`、`github`。顯示的文字在 `packages/app/src/i18n/support-copy.ts` 換掉，10 種語言都有。上游之後新增的語言先顯示英文。
  - 跟改名一樣在載入翻譯時套用，不改上游的語言檔。
  - 啟動失敗畫面的按鈕本來就是寫死的英文，「Open GitHub issue」改成「Email support」。
- 還沒改的：
  - 外掛的相容性訊息和 `paseo plugin` 的範本仍連到 paseo.sh 的外掛文件，因為外掛 API 還是上游的。跟 CLI 改名一起處理。
  - 配對網頁 `app.paseo.sh` 和 Hub 屬於自架 relay 那一步。
  - e2e 測試（`packages/app/e2e/` 的瀏覽器與手機腳本、`packages/desktop/e2e/`）的預期值已改成我們的名稱、連結、port 和 scheme，但還沒實際跑過。
    e2e 用的隔離 daemon 不准用 6767 和 6770；手機 composer 腳本的預設 port 從 6770 改成 6771，因為 6770 現在是 woowtech smart 本身的 daemon。
    Maestro 流程（`packages/app/maestro/`）仍是上游的值。
- 測試：
  - `woowtech/help-links.test.mjs` 掃描出貨的程式，不准出現 paseo.sh 網站（子網域除外）、上游的 GitHub（含贊助頁）和 Discord 邀請連結。
  - `changelog/internal/changelog-source.test.ts` 檢查實際抓取的網址。
  - `utils/open-external-url.test.ts` 和桌面版的 `features/opener.test.ts` 檢查能開 mailto，也仍然擋掉 file: 和 javascript:。
  - `i18n/brand.test.ts` 檢查每種語言的說明選單都不再提 Discord 或 GitHub。

### 11. Relay 預設關閉

- 原因：我們還沒有自己的 relay，上游的 relay.paseo.sh 不是我們營運的。使用者自己打開之前，daemon 不能連過去。
- 上游只在建立新的 `config.json` 時寫入 `daemon.relay.enabled: false`。`config.json` 已經存在但沒寫這個欄位時，上游當作要開 relay（`relayOptInDefault` 相容規則，上游預計 2027-01-31 後拿掉）。
  `scripts/dev-home.sh` 幫 dev daemon 寫的設定就沒有這個欄位，所以 dev daemon 一直連著上游的 relay，`.dev/paseo-home/daemon.log` 裡有 `relay_control_connected`。
- 做法：`packages/server/src/server/config.ts` 的 `resolveConfigFromPersisted` 在沒寫 `daemon.relay.enabled` 時一律當作關閉，只改這一行。daemon 啟動、重新載入設定、CLI 的 `daemon pair` 和 `daemon status` 都從這裡取值。
- 使用者打開 relay 的方法，打開後連的是上游的 relay：
  - 桌面版「配對裝置」按「啟用中繼」，會寫進 `config.json`。
  - `paseo daemon pair --relay` 或 `paseo onboard --relay`。
  - 在 `config.json` 設 `daemon.relay.enabled: true`。前景執行的 `paseo daemon run` 也可以用 `PASEO_RELAY_ENABLED=true`；`paseo daemon start` 和桌面版啟動的 daemon 不看這個環境變數。
- relay 關閉時看到的畫面都是上游原本的處理，沒有改：
  - 桌面版「配對裝置」不產生 QR Code，顯示「啟用中繼？」和「暫不」「啟用中繼」兩個按鈕，下方提示改用直接連線。
  - `paseo daemon pair` 印出「Relay pairing is disabled for this daemon.」，結束碼是 1。
  - `paseo onboard` 在互動終端機裡問要不要啟用 relay（預設否）。選否，或不是互動終端機時，印出直接連線的說明。
  - 手機 App 歡迎頁的主要按鈕仍是「掃描 QR Code」，但要先在桌面版或 CLI 打開 relay 才有 QR Code 可掃。「直接連線」隨時都能用。
- 直接連線：daemon 預設只監聽 `127.0.0.1:6770`，模擬器連得到，實體手機連不到。要讓手機直接連，把 `daemon.listen` 改成這台電腦的區網 IP 或 Tailscale IP 加 `:6770`，並用 `paseo daemon set-password` 設密碼。
- 測試：
  - `packages/server/src/server/config-relay.test.ts`：什麼都沒設時 relay 是關的，包括 dev daemon 的設定、沒有 `enabled` 的 `relay: {}`，以及重新載入設定之後；`config.json` 或 `PASEO_RELAY_ENABLED` 仍然能打開。上游兩個「沒寫就開」的測試改成預期關閉。
  - `woowtech/relay.test.mjs` 透過 tsx 直接呼叫原始碼裡的 `loadConfig`，不讀 `packages/server/dist`，因為 dist 要另外建置，合併上游後常常是舊的。

### 12. CLI 指令 `woowtech-smart`（品牌識別最後一步）

官方 Paseo 的指令叫 `paseo`，它的桌面版「安裝 CLI」會寫 `~/.local/bin/paseo`。我們的指令叫 `woowtech-smart`，兩邊可以裝在同一個 PATH 上，不會互相覆蓋。

- 指令名只寫在 `packages/protocol/src/brand-cli.ts`（`CLI_COMMAND`），桌面版的安裝、CLI 和 daemon 的訊息都讀這裡。
- 桌面版「安裝 CLI」：
  - 建立 `~/.local/bin/woowtech-smart`（Windows 是 `woowtech-smart.cmd`），指向 App 內的 `Resources/bin/woowtech-smart`。
  - 「已安裝」只看這個路徑，而且連結要解析到這個 App 內附的 CLI，判斷寫在 `cli-install/ownership.ts`。指向官方 Paseo 的連結、App 搬家後留下的舊連結，都算沒裝，設定頁會再給安裝按鈕。
  - 不讀、不建、不改、也不刪 `~/.local/bin/paseo`。上游本來就沒有「解除安裝 CLI」。
  - 加進 shell 設定檔的註解是 `# Added by woowtech smart`。設定檔裡已經有 `.local/bin` 就不加，這是上游原本的判斷，兩邊不會重複加。
- App 內的 CLI shim 打包成兩個名字，內容相同：
  - `bin/woowtech-smart`：安裝的連結指向它，桌面版啟動 daemon 時也把它設成 `PASEO_CLI`。
  - `bin/paseo`：留給上游原樣的 OpenCode hook 外掛，它直接執行 `paseo`。
  - daemon 開的終端機會把 `bin` 放在 PATH 最前面，所以在我們的終端機裡打 `woowtech-smart` 或 `paseo` 都跑我們的 CLI。使用者自己的 PATH 上不會有 `paseo`。
- 終端機活動 hooks 的指令文字和 OpenCode 外掛跟上游一字不差：
  - 兩邊寫進同一批 agent 設定檔，靠文字辨識。文字不同的話，兩邊的 daemon 每次啟動都會改寫對方的。
  - hooks 執行的是 `"${PASEO_HOOK_CLI:-paseo}"`。daemon 開終端機時，把 `PASEO_CLI`（桌面版給的 `bin/woowtech-smart`）交給 `PASEO_HOOK_CLI`，所以我們終端機裡的 hooks 跑的是我們的 CLI。這是上游原本的做法，沒有改。
  - 已知取捨：任一邊關掉 hooks，會把另一邊的一起刪掉，直到另一邊的 daemon 重啟。
- CLI 的輸出：
  - 程式名是 `woowtech-smart`，所有 Usage 行都從這裡來。
  - 說明文字不改上游的字串，在印出時改寫（`packages/cli/src/brand.ts`，`createCli()` 最後呼叫）：`paseo <指令>` 換成 `woowtech-smart <指令>`，產品名 Paseo 換成 woowtech smart。「Paseo Hub」保留，Hub 仍是上游的服務，跟自架 Hub 一起換。上游之後新增的指令也會套用。
  - 錯誤訊息在 `output/render.ts` 的 `renderError` 統一改寫指令名，表格、JSON、YAML 都一樣，agent 讀 JSON 錯誤時拿到的也是我們的指令。錯誤訊息可能帶有使用者自己取的名字，所以這裡只換指令，不換產品名。
  - 只換會執行的指令（`brand-cli.ts` 的 `withCliCommand`）：`paseo` 前面是開頭、空白、引號或括號，後面接已知的子指令或旗標才換。`~/.paseo`、`paseo.json`、`PASEO_*`、`@getpaseo/*`、`paseo://`、路徑，以及叫做 paseo 的 agent 都不動。
  - 子指令清單 `CLI_TOP_LEVEL_COMMANDS` 要跟 CLI 同步，上游新增指令時 `cli/src/brand.test.ts` 會失敗。
  - `hub init` 精靈不經過 `renderError`，自己印訊息，所以它的出口（`reportMessage` 和停止時的 `cancel`）也套同一個改寫。
  - 直接印出或放在結果欄位裡的下一步提示，不經過上面兩個出口，逐條改用 `CLI_COMMAND`：`onboard` 的下一步和 CLI 速查、`daemon pair` 的離線與 relay 提示、`daemon config` 的 `nextCommand`、`daemon reload` 和 `daemon set-password` 的 `restartCommand`、`wait` 逾時訊息（agent 會照著再跑），以及 `attach`、`logs` 找不到 agent 時的提示。
  - CLI 自己寫的產品名也逐條改成 woowtech smart：`onboard` 的歡迎和完成訊息、`daemon pair` 要求更新 daemon 的錯誤、`open` 找不到桌面版、`script` 找不到工作區、`heartbeat` 和 `schedule --target self` 要在 agent 裡執行、`clone` 要求更新主機、`plugin install` 的信任提醒、`hub connect` 要求更新。
  - daemon 的訊息：`server/src/server/daemon-instance.ts` 在 daemon 沒啟動、沒準備好、supervisor 沒發布 lock 時提示的指令直接用 `CLI_COMMAND`，CLI 和桌面版都照原文顯示。server 其他提到 Paseo 產品名的訊息這次沒改。
  - 刻意保留 Paseo 的：Paseo Hub 和它的聊天機器人 `@Paseo`；relay 的加密說明「Paseo cannot read your code or messages」（relay 目前仍是上游經營的）；`onboard` 裡的 `https://app.paseo.sh`；外掛範本（`plugin/scaffold.ts`，外掛 API 仍是上游的）。這些跟自架 relay 和 Hub 一起換。
- 測試：
  - `protocol/src/brand-cli.test.ts`：哪些 `paseo` 會換、哪些不動。
  - `cli/src/brand.test.ts`：程式名和 Usage 行；每個指令的說明都沒有上游的指令和產品名（Paseo Hub 除外）；錯誤在表格、JSON、YAML 都換；子指令清單跟 CLI 一致。
  - `cli/src/commands/hub/init-flow.test.ts`、`init-brand.test.ts`：Hub 精靈的提示和停止訊息。
  - `cli/src/commands/daemon/next-command.test.ts`：`daemon pair` 在暫存 home 印出的下一步（一般輸出和 `--json`）。
  - `server/src/server/daemon-instance.commands.test.ts`：daemon 沒在跑、沒準備好時訊息裡的指令。
  - `cli/tests/17-onboard.test.ts` 的速查預期值已改成 `woowtech-smart`。這是會啟動 daemon 的 e2e，還沒跑過。
  - `desktop/src/integrations/cli-install/install.test.ts` 用暫存 HOME 測安裝：官方 Paseo 的 `paseo` 連結不動、不算我們的；指向別處的 `woowtech-smart` 算沒裝；透過安裝的連結執行時，會經由 `woowtech smart Helper` 啟動 CLI，`PASEO_CLI` 是 App 內的 `woowtech-smart`。
  - `server/src/terminal/terminal-cli-env.test.ts` 確認 `PASEO_CLI` 叫 `woowtech-smart` 時，終端機的 `PASEO_HOOK_CLI` 和 PATH 都指到它。
  - `woowtech/cli-name.test.mjs` 檢查打包設定的兩個 shim 名字、cli-install 沒有寫到 `paseo`，以及 hooks 文字和 OpenCode 外掛仍是上游的原文。
    另外掃描原始碼：直接印提示的那幾個檔案和 server 不准出現 `paseo <指令>`（hooks 標記除外）；CLI 除了說明文字、Hub、relay 說明和外掛範本以外，不准出現產品名 Paseo。上游合併帶回舊字串時會失敗。

## Mac 開發環境

`woowtech/scripts/mac/` 是在 M2、8GB RAM 的 Mac 上建置和測試用的腳本。路徑是寫死的：repo 在 `~/projects/woowtech-smart`，腳本透過 `~/.local/share/woowtech-smart/` 的 symlink 呼叫，log 和截圖也存在那裡。

```bash
mkdir -p ~/.local/share/woowtech-smart
ln -sf ~/projects/woowtech-smart/woowtech/scripts/mac/*.sh ~/.local/share/woowtech-smart/
```

| 腳本                       | 用途                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `env.sh`                   | 用 source 載入：把 Node 22（Homebrew `node@22`）放到最前面，並載入 Android 工具鏈（`~/.local/share/woow-android-toolchain`） |
| `dev-daemon.sh`            | 精簡版 dev daemon，監聽 `127.0.0.1:6768`，資料放在 `.dev/paseo-home`                                                         |
| `run-bg.sh <名稱> <指令…>` | 在背景跑長時間工作，log 寫到 `~/.local/share/woowtech-smart/logs/`，最後一行是 `EXIT=`                                       |
| `build-android.sh [ABI]`   | 建置 Android debug APK，預設只建 arm64-v8a                                                                                   |
| `android-test-up.sh`       | 依序啟動 daemon、模擬器、Metro，然後安裝並開啟 App                                                                           |
| `adb-shot.sh <名稱>`       | 擷取模擬器畫面，存到 `~/.local/share/woowtech-smart/shots/`                                                                  |

注意事項：

- 這台 Mac 記憶體只有 8GB。跑重的建置之前，先確認沒有其他 `xcodebuild` 或 Gradle 在跑：`pgrep -x xcodebuild`。
- Android 建置需要 JDK 17（Homebrew `openjdk@17`）。少了它，Gradle 會改從 GitHub 下載 JDK，而且會卡住但不報錯。
- Android 模擬器映像放在外接碟 WOOW-BUILD 上，沒接的話模擬器開不起來。
- 如果有實體 Android 手機透過無線偵錯配對，adb 一律鎖定 `ANDROID_SERIAL=emulator-*`，腳本已經處理好了。
- 用瀏覽器看網頁版 App：`run-bg.sh web-app bash -c 'cd packages/app && npx expo start --web --port 8081'`。不要設 `CI=1`，那會關掉檔案監看，改了程式也看不到。第一次打包在這台 Mac 上要好幾分鐘。
- commit 時 lefthook 會對所有 workspace 跑 typecheck。desktop 和 cli 依賴 server 的 dist 型別，所以 clone 下來後要先跑一次 `npm run build:server`。

## 驗證紀錄

- 里程碑 0，兩個平台的模擬器實測都通過：iOS 在 2026-09-23，Android 在 2026-09-24。
  App 連上 dev daemon 後，Claude 和 Pi 都在沙盒專案裡成功執行了 Shell 和 Read，熱重載也正常，兩個平台看得到同一批專案。
- 拿掉本地語音：語音相關 37 個測試、設定相關 82 個測試全部通過。用乾淨設定啟動 daemon，沒有下載模型，也沒有啟動語音 worker。
- Claude SDK：載入器 4/4、`claudeQuery` 4/4、相關的 agent 和 rewind 測試 22 個全部通過。
  把 SDK 從 node_modules 移走後實際跑了一輪 Claude 對話：SDK 自動下載、通過驗證，回覆也正確。
- 更新來源：daemon 自我更新相關測試 17 個、App 更新相關測試 49 個全部通過，`update-sources.test.mjs` 2/2。
  防回歸檢查另外用三種寫法驗證過會失敗：平台專屬的 publish 指向原版、`publish: github` 單行簡寫、清單寫法。
- 共存：daemon 預設資料夾與 port、深層連結、daemon 接受的桌面版來源（smoke 測試實際啟動 daemon 驗證）、診斷報告遮罩都有行為測試；
  打包相關測試實際執行 `bin/paseo`，確認能透過 `woowtech smart Helper.app` 啟動 CLI。桌面版 378、App 154、server 85、protocol 37、CLI 12 個測試全部通過。
- 說明與求助連結（2026-09-24）：新測試都先紅後綠。
  9 種突變全部被抓到：帶回 Discord、paseo.sh 說明、贊助連結、上游的更新紀錄，開啟器放行任何協定或拿掉 mailto，翻譯缺語言或沒套用。
  網頁版用繁體中文實測：說明選單的「LINE 官方帳號」開 LINE、「寄信給客服」開 mailto；關於頁的 LINE 按鈕和更新紀錄的外部連結也都正確。
- 品牌綠（2026-09-25）：`brand-colors.test.mjs` 分兩輪，都先紅後綠。第一輪紅燈指到 `index.html:80` 的焦點框，第二輪指到 `theme.ts:777` 的代表色。
  2 種突變都被抓到：焦點框改回 `rgba(32, 116, 74, 0.8)`、深色連結色改回上游的 #7ccba0。`theme.test.ts` 12/12 通過。還沒在瀏覽器裡實際看過焦點框。
- Relay 預設關閉（2026-09-25）：`config-relay.test.ts` 改寫和新增的 3 個測試先紅後綠，紅燈都是 `expected true to be false`，全檔 24/24；`relay.test.mjs` 先紅後綠，2/2。
  2 種突變都被抓到：改回上游「沒寫就開」的規則、忽略 `config.json` 的 `enabled: true`。config 11、persisted-config 44、daemon-config-store 34、relay-runtime 2、daemon-session 11 個測試全部通過。
  還沒實際啟動 daemon 確認它不再連到 relay.paseo.sh。
- 更新下載快取（2026-09-25）：`coexistence.test.mjs` 先紅後綠，紅燈是 electron-builder 算出 `'@getpaseodesktop-updater'`，跟官方 Paseo 的 `app-update.yml` 相同。
  突變被抓到：拿掉 `extraMetadata`、改在 `publish` 設 `updaterCacheDirName`，electron-builder 照樣算出上游的名稱。`auto-updater` 12、`updater` 5、`desktop-packaging` 11 個測試通過，`update-sources.test.mjs` 2/2。
  沒有實際打包，是用 electron-builder 自己的函式確認 mac、Windows、Linux 的 `app-update.yml` 都會寫 `io.woowtech.smart.desktop-updater`。

## 接下來

- 第一次正式發佈：建立公開的 `WOOWTECH/woowtech-smart-releases`，並完成 Developer ID 簽章與公證。沒有簽章，macOS 的自動更新無法運作。
  發佈 repo 要放 `CHANGELOG.md`，App 的更新紀錄才讀得到。
- 桌面版的版權行還是上游作者：electron-builder 預設用 `package.json` 的 author，會出現在 macOS 的「關於」視窗。
  `author`、`homepage`、`repository` 由 `scripts/sync-workspace-versions.mjs` 從根目錄的 `package.json` 同步，發佈前要決定怎麼標示。
- 品牌識別最後一步：CLI 改名（連同說明文字、agent 技能說明、外掛訊息）。
- 自架 Cloudflare relay（拿掉 `wrangler.toml` 裡的 `PASEO_RELAY_UPSTREAM`），配對連結（`app.paseo.sh`）和 Hub（`hub.paseo.sh`）一起換。
- 商標（TIPO）與 D-U-N-S。
