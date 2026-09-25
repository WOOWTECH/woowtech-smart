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
  npm run format:files -- packages/app/src/i18n/resources/zh-TW.ts   # 產生器不排版（第 7 節）
  npx tsx woowtech/tools/generate-skills.mjs  # 上游改了 skills/ 就重新產生我們的 agent 技能（第 13 節）
  npm run build:server              # 守門從原始碼跑，但跨套件的匯入讀各套件的 dist
  node --test woowtech/*.test.mjs   # 合併後確認沒有帶回原版的更新來源、預設值、名稱、指令和連結，也沒有新的 workflow
  ```

  守門發現新的 workflow 檔時，push 之前先照第 18 節處理：GitHub 會啟用新的 workflow，觸發條件有 push 的話，加進它的那次 push 就會跑。

  推播另外要跑的單元測試列在第 16 節的「合併上游之後」。

- 改動原則：新程式放新檔案，接點只改上游很少動的檔案。上游每週大約有 100 個 commit，下面這幾個是熱檔，盡量別碰：
  `packages/server/src/server/agent/providers/claude/agent.ts`、`packages/server/package.json`、`packages/server/src/server/bootstrap.ts`。
- GitHub Actions 目前是關閉的。只開 CI、只跑 Ubuntu 上的測試，其他 10 個上游 workflow 在 GitHub 停用，理由和打開的步驟見第 18 節。

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

| 項目                 | 原版                               | woowtech smart                                       |
| -------------------- | ---------------------------------- | ---------------------------------------------------- |
| daemon 資料夾        | `~/.paseo`                         | `~/.woowtech-smart`                                  |
| 預設 port            | 6767                               | 6770                                                 |
| 連結 scheme          | `paseo://`                         | `woowtech-smart://`                                  |
| 桌面版 appId         | `sh.paseo.desktop`                 | `io.woowtech.smart.desktop`                          |
| 桌面版名稱／執行檔   | `Paseo`                            | `woowtech smart`（`woowtech smart.app`）             |
| 桌面版更新下載快取   | `@getpaseodesktop-updater`         | `io.woowtech.smart.desktop-updater`                  |
| CLI 指令             | `paseo`（`~/.local/bin/paseo`）    | `woowtech-smart`（`~/.local/bin/woowtech-smart`）    |
| daemon 行程名        | `Paseo Supervisor`、`Paseo Daemon` | `woowtech smart Supervisor`、`woowtech smart Daemon` |
| agent 技能           | `paseo`、`paseo-advisor`…          | `woowtech-smart`、`woowtech-smart-advisor`…          |
| 技能儲存的暫存資料夾 | `.paseo-skills-transaction-*`      | `.woowtech-smart-skills-transaction-*`               |

- port 在 daemon、App（本機備援位址、手動新增主機的預設值）、CLI 說明和 SSH 連線的預設值都一致。
- 桌面版啟動時會併入登入 shell 的環境變數，但不採用其中的 `PASEO_HOME` 和 `PASEO_HOST`。使用官方 Paseo 的人可能在 shell 設定檔 export 這兩個值，指向官方的 `~/.paseo` 或 daemon；採用的話，我們的 daemon 會搬進官方的資料夾，桌面版呼叫的 CLI 也會連到官方的 daemon。
  - App 自己啟動時就帶著的值照樣有效，桌面版的 e2e 和 smoke 測試靠這個指定暫存 home。
  - 寫在 `packages/desktop/src/login-shell-daemon-target.ts`，測試是旁邊的 `login-shell-env.daemon-target.test.ts`。`woowtech/coexistence.test.mjs` 也從原始碼實際跑一次，上游合併後跟其他守門一起檢查。
  - CLI 仍然照 `PASEO_HOME`、`PASEO_HOST` 走：在 export 了這兩個值的 shell 裡執行 `woowtech-smart`，會連到它們指的 daemon。
- daemon 的行程名不同，在活動監視器和 `ps` 裡分得出來，`pkill -f 'Paseo Daemon'` 也不會停掉我們的。沒有程式用行程名找 daemon。
  - 本地語音的 worker 叫 `woowtech smart Voice`（上游是 `Paseo Voice`）。本地語音已拿掉（第 2 節），平常不會啟動；企業版裝回去時名稱就是對的。
  - `woowtech/names.test.mjs` 檢查這三個行程名。
- scheme 同時用在桌面版載入介面的來源、系統註冊的連結、手機 App、深層連結、配對連結（第 19 節）和 daemon 的 CORS 白名單。原版的 `paseo://` 連結留給官方 Paseo，我們不接；診斷報告會把兩種連結都遮掉。
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
- agent 技能和它們的暫存資料夾改用我們的名字，兩邊的 daemon 不會改寫、刪除或復原對方的，見第 13 節。
- 還沒處理的：
  - 安裝檔檔名仍是 `Paseo-…`，第二步改名稱時跟 `desktop-updates.ts` 的 DMG 連結一起改。
  - 手機 App 的 bundle id 仍在建置前由 `apply-identity.mjs` 套用。
  - Linux 的執行檔名稱含空白。Linux 不在 v1，要支援時再考慮 `linux.executableName`。

### 6. 看得到的名稱（品牌識別第二步）

- 介面文字：`packages/app/src/i18n/brand.ts` 在語系載入時把「Paseo」換掉，語系檔本身不動（英文語系檔上游 90 天改了 133 次）。
  - 中文顯示「渥屋智能」，「Paseo Desktop」變成「渥屋智能桌面版」。中文字之間的空格會拿掉，與英文單字之間的空格保留。
  - 其他語言顯示「woowtech smart」。
  - 只替換語系資源，不動插入的值，使用者自己叫 Paseo 的專案名稱不會被改。`$PASEO_PORT`、`paseo.json` 這類全大寫或小寫的技術名稱也不受影響。
  - 翻譯裡的 `paseo <指令>` 也在這裡換成 `woowtech-smart`，見第 12 節。
- App 裡寫死的 4 句英文，以及網頁版的名稱和標題都已改。`git/use-actions.tsx` 裡有一句要跟 daemon 的英文錯誤訊息完全一致，是刻意保留的例外；使用者看到的是翻譯後的文字，已經替換過。
- 安裝檔改名為 `woowtech-smart-<版本>-<架構>.dmg` 等，App 的 Apple Silicon 下載連結跟著改。Linux 套件的維護者欄位改成 WoowTech。
- agent 透過 ACP 看到的 `clientInfo.name` 改成 `woowtech smart`。
- 手機 App 的名稱和 bundle id 直接寫在 `app.config.js`：正式版 `io.woowtech.smart`，Debug 版 `io.woowtech.smart.debug`。
  - 中文手機桌面顯示「渥屋智能」（Debug 版是「渥屋智能 Debug」）。iOS 用 Expo 的 `locales`；Expo 只把 `locales` 套到 iOS，Android 由 `plugins/with-localized-app-name.js` 讀同一份設定寫進 Android 資源。
  - `apply-identity.mjs` 現在只處理 Expo 帳號相關的 owner、slug、project id。
- iOS 主畫面的短名稱：顯示名稱放不下時（例如「woowtech smart Debug」），iOS 改用短名稱 `CFBundleName`。Expo 預設是 `$(PRODUCT_NAME)`，也就是去掉空白的 `woowtechsmartDebug`（正式版 `woowtechsmart`），iOS 26.5 模擬器上顯示成「woowtechsmart…」。
  - 現在 `app.config.js` 的 `ios.infoPlist.CFBundleName` 是「woowtech smart」，`locales` 的 zh-Hans、zh-Hant 另外設「渥屋智能」。兩個版本相同，都在 Apple 建議的 15 字以內。Xcode 的 `PRODUCT_NAME`、執行檔和 `.app` 名稱不變。
  - 英文系統上，Debug 版的主畫面標籤也是「woowtech smart」，跟正式版一樣。中文系統仍是「渥屋智能 Debug」，「設定 → App」裡也有完整名稱。
  - 已經 prebuild 過的 `packages/app/ios` 要重新 prebuild 才會套用。
  - 相機、相簿的權限提示仍用 `$(PRODUCT_NAME)`，而且只有英文，見「接下來」。
- App 的 vitest 原本只跑 `src/`，`plugins/` 的測試（包含上游的 `with-paste-input.test.ts`）從來沒被執行過，已加進單元測試的 include。
- `woowtech/names.test.mjs` 檢查安裝檔名稱與下載連結一致、App 裡寫死的文字、agent 看到的名稱，並用 `expo config` 檢查手機 App 的實際設定。
  - iOS 短名稱查兩處，也查不超過 15 字：`expo config --type prebuild` 裡 `app.config.js` 自己設的 `ios.infoPlist.CFBundleName`；`expo config --type introspect`（`woowtech/expo-config.mjs` 的 `expoIntrospectedConfig`）算出的 Info.plist，和 zh-Hans／zh-Hant 的 `CFBundleName`。
  - 只看 introspect 不夠：它會先讀既有的 `packages/app/ios/*/Info.plist` 再蓋上設定。prebuild 過的 `ios/` 裡已經有這個值時，`app.config.js` 的設定被拿掉，檢查照樣通過。
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
  - 產生器寫出的是 JSON 排版。重新產生後要再跑 `npm run format:files -- packages/app/src/i18n/resources/zh-TW.ts`，才會跟提交的檔案逐位元組相同；不跑的話，pre-commit 的格式檢查會擋下。
- 修正表處理 OpenCC 沒轉成台灣習慣的詞：
  - 一般詞彙，例如會話→工作階段、二維碼→QR Code、許可權→權限、日誌→記錄、歸檔→封存、新建→新增、命令→指令、退出→結束、地址→位址、超時→逾時、主機名→主機名稱，引號改成「」。
  - 看上下文的規則：
    - 英文原文講 tab 的「標籤」才改成「分頁」，工作區的 Labels 維持「標籤」。
    - 「通過」後面接東西才改成「透過」，「檢查通過」不變。
    - 插入英文詞時自動在中文前後補空格。
  - 上游簡中句子裡留下的英文名詞改成台灣用語：project 專案、workspace 工作區、provider 供應商、server 伺服器、terminal 終端機、model 模型、script 腳本、client 用戶端、relay 中繼、repository 儲存庫、branch 分支、remote 遠端、mode 模式、feature 功能、thinking 思考、runtime 執行環境、prompt 提示詞（system prompt 系統提示詞）、subagent 子 Agent、review 審查、draft 草稿、skill 技能、tools 工具、commands 指令、setup 初始化、teardown 清理、realtime voice 即時語音、turn 回合、desktop app 桌面版 App；「System Settings > Notifications」改成「系統設定」>「通知」。
  - 維持英文：Agent、Host、Daemon、worktree（Agent、Host、App 一律大寫單數）、Git 指令（commit、push、pull、merge、stash、rebase、squash、auto-merge）、PR、MR、issue、pull request、diff、hooks、token、縮寫、產品和品牌名稱。
- 連線一律用「連線」，「連接」只用在「連接埠」。桌面版連上既有的 daemon 時，顯示「已連線到現有的 daemon」。
- 上游簡中留下的英文，產生器分兩種處理：
  - 句子裡的英文名詞（「新建 project」「设置 providers」）和只有一個英文名詞的標籤（「Workspaces」）：`zh-tw-terms.mjs` 的 `inChinese()` 和 `label()`，詞表見上面。
    - `inChinese()` 只改含中文的字串，依前後是中文還是英文決定要不要空格。
    - 路徑、檔名、網域、`/commands`、`@files`、`{{placeholder}}` 不動。後面接「.」和字母的英文詞也不動（`app.paseo.sh`、`AGENTS.md`、`project.json`），句尾的「.」和「...」不算。
    - 產生器和 `woowtech/zh-tw.test.mjs` 共用 `asWord()` 判斷字的邊界，規則由 `fixTerms()` 套用。
  - 整句沒翻的字串（原本 141 句，例如整個「終端機」設定頁、Daemon 更新卡片、版面配置、診斷、外掛記錄）：`woowtech/tools/zh-tw-untranslated.mjs` 以翻譯 key 記錄「上游英文＋繁中」。
    - 只有 zh-CN 和英文都還是那句英文時才套用。上游翻了或改了英文，產生器會列出「no longer apply」並回傳 1，照提示更新或刪掉那一筆。
    - 刻意保留英文的 key 列在同一個檔案的 `KEEP_ENGLISH`，例如專有名詞、Git 指令與合併方式、語言和主題名稱、輸入範例。
- 產生器只裝在 `woowtech/tools/`（自己的 package.json），不動上游的相依套件。第一次使用先 `npm ci --prefix woowtech/tools`。
- 測試：
  - `packages/app/src/i18n/zh-tw.test.ts` 檢查每個英文鍵值都有繁體、插入值的佔位符一致、沒有簡體專用字，並抽驗實際顯示的句子，包括測試員回報的「新增專案」「設定供應商」「工作區」「終端機」「輸入渥屋智能伺服器的位址。」和「已連線到現有的 daemon」。完整性檢查跟載入後的英文比，fork 自己的字串（第 14 節）也算在內。
  - `woowtech/zh-tw.test.mjs` 確認提交的繁體檔跟重新產生的一致，上游改了簡體卻沒重新產生時會失敗。另外檢查：中文句子裡不再出現上面那些英文名詞，也沒有只寫英文名詞的標籤；`fixTerms()` 不改檔名和網域；沒有中文字的字串都列在 `KEEP_ENGLISH`。

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
- 更新紀錄：App 讀發佈 repo 的 `CHANGELOG.md`，右上角的外部連結開發佈頁。
  - 發佈 repo 還沒有 `CHANGELOG.md`（HTTP 404），或檔案裡還沒有任何版本時，「新功能」顯示「還沒有釋出說明／第一個版本釋出後，釋出說明就會顯示在這裡。」，沒有重試按鈕。狀態是 `changelog-source.ts` 的 `empty`，畫面在 `changelog/internal/changelog-empty.tsx`，文字在 `woowtech-copy.ts`（第 14 節）。
  - 連不上網路或其他 HTTP 錯誤，才顯示「無法載入更新記錄／請檢查網路連線後重試。」和重試按鈕。
- 官網：歡迎頁的連結（只在手機上顯示）改成 aiot.woowtech.io。
- 文案：
  - 上游的翻譯 key 仍叫 `discord`、`github`。顯示的文字在 `packages/app/src/i18n/support-copy.ts` 換掉，10 種語言都有。上游之後新增的語言先顯示英文。
  - 跟改名一樣在載入翻譯時套用，不改上游的語言檔。
  - 啟動失敗畫面的按鈕本來就是寫死的英文，「Open GitHub issue」改成「Email support」。
- 還沒改的：
  - 外掛的相容性訊息和 `plugin init` 的範本仍連到 paseo.sh 的外掛文件。外掛 API 還是上游的，CLI 改名時決定保留。
  - Hub（`hub.paseo.sh`）仍是上游的。配對連結已不再用上游的網頁版（第 19 節）。
  - e2e 測試（`packages/app/e2e/` 的瀏覽器與手機腳本、`packages/desktop/e2e/`）的預期值已改成我們的名稱、連結、port 和 scheme，但還沒實際跑過。
    e2e 用的隔離 daemon 不准用 6767 和 6770；手機 composer 腳本的預設 port 從 6770 改成 6771，因為 6770 現在是 woowtech smart 本身的 daemon。
    Maestro 流程（`packages/app/maestro/`）仍是上游的值。
- 測試：
  - `woowtech/help-links.test.mjs` 掃描出貨的程式，不准出現 paseo.sh 網站（子網域除外）、上游的 GitHub（含贊助頁）和 Discord 邀請連結。
  - `changelog/internal/changelog-source.test.ts` 檢查實際抓取的網址，以及 404、沒有任何版本、網路錯誤、503 各得到什麼狀態。`changelog-sheet.test.tsx` 用繁中 render 整個「新功能」sheet。
  - `utils/open-external-url.test.ts` 和桌面版的 `features/opener.test.ts` 檢查能開 mailto，也仍然擋掉 file: 和 javascript:。
  - `i18n/brand.test.ts` 檢查每種語言的說明選單都不再提 Discord 或 GitHub。

### 11. 自己的 relay：relay.woowtech.io，預設開啟

relay 讓手機不在同一個網路時也連得到 daemon，流量端對端加密，relay 看不到內容。上游的 relay.paseo.sh 不是我們營運的，所以之前預設關閉。現在 WoowTech 自己跑 relay：WoowTech 的 Cloudflare 帳號（`9c27f623ee596e0b67be56263bcb1974`，zone woowtech.io）裡的 Worker `woowtech-smart-relay`，網址 `relay.woowtech.io`。daemon 預設打開 relay、連到這裡，使用者可以關掉。

Worker：

- 程式是上游的 `packages/relay/src/cloudflare-adapter.ts`，沒改：每個 daemon（serverId）一個 Durable Object `RelayDurableObject`，用 WebSocket hibernation 轉送 daemon 和 App 之間的 WebSocket，不存資料。`/health` 回 `{"status":"ok"}`，`/ws` 是 relay。
- 上游的 `wrangler.toml` 設了 `PASEO_RELAY_UPSTREAM = "https://paseo-relay-next.fly.dev"`：上游把正式流量搬到了 Fly，Cloudflare 上的 Worker 只把請求原樣轉過去。沒設這個變數時，Worker 自己當 relay。
- 我們用 fork 自己的 `packages/relay/wrangler.woowtech.toml` 部署，上游的 `wrangler.toml` 不動：
  - 帳號 `9c27…`、Worker 名稱 `woowtech-smart-relay`、custom domain `relay.woowtech.io`（部署時自動建 DNS 記錄和憑證）、`workers_dev = false`（不開 workers.dev 網址）。
  - Durable Object 綁定、SQLite migration（`new_sqlite_classes`）、observability 跟上游一樣，沒有任何變數。
- 方案：不需要付費方案。SQLite 的 Durable Object 在 Workers 免費方案就能用，custom domain 也免費。
  - 免費額度：Worker 和 Durable Object 各是每天 10 萬個請求，Durable Object 另有每天 13,000 GB-s。每條 WebSocket 連線算一個請求，收到的訊息 20 則算 1 個，送出的訊息和 ping 不算。超過就失敗，UTC 00:00（台灣 08:00）重置。用量大了再升 Workers Paid（每月 5 美元）。
  - woowtech.io 的 Pro 是 zone 的方案，跟 Workers 的方案無關。
- Workers Logs 記的是 relay 自己印的連線、斷線、serverId 和 connectionId，沒有內容（內容是加密的）。上游也開著；要關就把 `[observability]` 改成 `enabled = false` 再部署，`relay-worker.test.mjs` 比對 observability 跟上游一致的那一行也要一起改。

部署（在 Cloudflare 帳號的操作由 coordinator 和 owner 做）：

```bash
cd packages/relay
npx wrangler login                                              # 瀏覽器授權 WoowTech 的 Cloudflare 帳號
npx wrangler deploy --config wrangler.woowtech.toml --dry-run   # 綁定只有 env.RELAY，沒有變數
npx wrangler deploy --config wrangler.woowtech.toml
npx wrangler logout                                             # 不再用 wrangler 時撤銷授權
```

- 一定要加 `--config wrangler.woowtech.toml`。不加會讀上游的 `wrangler.toml`，帳號是上游的，部署會因為沒有權限而失敗。
- 第一次部署建立 Worker、Durable Object namespace（migration `v1`），以及 relay.woowtech.io 的 DNS 記錄和憑證。relay.woowtech.io 已經有 DNS 記錄的話，custom domain 會建不起來。
- 不要在儀表板替這個 Worker 加 `PASEO_RELAY_UPSTREAM`。`keep_vars` 沒開，下次部署會清掉；但清掉之前，relay 會轉到上游。
- `.github/workflows/deploy-relay.yml` 是上游的，部署的是上游的設定，在 GitHub 停用（第 18 節）。我們的 relay 照上面手動部署，repo 不放 Cloudflare 的 token。
- 部署後的檢查：`curl https://relay.woowtech.io/health` 回 `{"status":"ok"}`；`/ws?serverId=smoke&role=server&v=2` 不帶 WebSocket 升級時回 426；完整的加密往返用 `RUN_LIVE_RELAY_E2E=1 PASEO_LIVE_RELAY_URL=wss://relay.woowtech.io npx vitest run src/live-relay.e2e.test.ts`（在 `packages/relay` 執行）。

還原：

- 回到前一版 Worker：`npx wrangler rollback --config wrangler.woowtech.toml`，或指定 `npx wrangler versions list --config wrangler.woowtech.toml` 列出的版本 ID。版本還原不會撤銷 Durable Object 的 migration。
- 整個停掉：儀表板的 Worker → Settings → Domains & Routes 拿掉 relay.woowtech.io，或 `npx wrangler delete --config wrangler.woowtech.toml`。relay 不存資料，停掉只會斷開現在的連線，daemon 會每 1～30 秒重試。
- daemon 這邊：使用者照下面的方法關 relay；要讓新版預設不連，還原 commit `00fe79933`。

daemon 的預設：

- 端點寫在 `packages/protocol/src/brand-relay.ts`（`BRAND_RELAY`：`relay.woowtech.io:443`，port 443 表示 TLS）。protocol 的 `DEFAULT_RELAY_ENDPOINT` 讀它；`config.ts`、`pairing-offer.ts`、`bootstrap.ts` 原本各自寫死 relay.paseo.sh，現在都用這個常數。改了這個檔案，要重建 protocol 和 server 的 dist。
- 什麼時候開：
  - 新的 home：`persisted-config.ts` 在 `config.json` 寫入 `daemon.relay.enabled: true`。
  - `config.json` 沒寫 `enabled`（例如 `scripts/dev-home.sh` 寫的 dev 設定）：一律開，重新載入設定後也一樣，寫在 `config.ts` 的 `resolveConfigFromPersisted`。上游只對「啟動時就沒寫」的設定開（`relayOptInDefault`），而且打算 2027-01-31 後改成關。
  - 寫了 `enabled: false` 的照樣關。之前的內部測試版建立的 home 都寫著 `false`（舊預設），要自己打開。
- 關掉的方法：
  - 桌面版「配對裝置」：QR Code 下方的「停用中繼」（fork 的 `desktop/components/relay-off-action.tsx`）。寫進 `config.json` 並立刻停掉 relay，畫面回到上游的「啟用中繼？」。
  - `woowtech-smart daemon config set daemon.relay.enabled false`，或 `woowtech-smart onboard --no-relay`。`daemon config unset daemon.relay.enabled` 則回到預設的開。
  - 直接改 `config.json`，再 `woowtech-smart daemon reload`。
  - 前景執行的 `woowtech-smart daemon run` 還可以用 `PASEO_RELAY_ENABLED=false`，只管那一次啟動；`daemon start` 和桌面版啟動的 daemon 不看這個環境變數。
- 打開的方法：桌面版「配對裝置」的「啟用中繼」、`woowtech-smart daemon pair --relay`、`woowtech-smart onboard --relay`、`config.json`。
- relay 開著時：桌面版「配對裝置」直接顯示 QR Code 和「停用中繼」；`woowtech-smart daemon pair` 印出 QR Code 和配對連結（daemon 沒在跑時是離線的配對連結）；`onboard` 不再先問。
- relay 關著時，畫面是上游原本的：桌面版顯示「啟用中繼？」；`daemon pair` 印出「Relay pairing is disabled for this daemon.」，結束碼 1；`onboard` 在互動終端機裡問要不要打開（預設否），說明文字改成「WoowTech cannot read your code or messages」。
- 先部署 relay，再發佈這一版：relay.woowtech.io 還沒有 DNS 時，daemon 連不上，每 1～30 秒重試一次，log 裡一直有連線錯誤。
- 直接連線不受影響：daemon 預設只監聽 `127.0.0.1:6770`。要讓手機直接連，把 `daemon.listen` 改成區網或 Tailscale 的位址，並用 `woowtech-smart daemon set-password` 設密碼。

配對連結的主機：owner 決定直接叫起 App，配對連結和 QR Code 改成 `woowtech-smart:///#offer=…`，新 home 的 CORS 白名單也拿掉上游的網頁版，見第 19 節。當時比較過的其他做法也記在那裡。

測試：

- `packages/server/src/server/config-relay.test.ts`：什麼都沒設、dev daemon 的設定、沒有 `enabled` 的 `relay: {}` 都是開的，重新載入設定後也一樣；預設端點是 relay.woowtech.io:443 和 TLS；`enabled: false` 和 `PASEO_RELAY_ENABLED=false` 會關。上游「拿掉 enabled 就保持關閉」的測試改成預期開。
- `persisted-config.test.ts`：新 home 寫入 `enabled: true`（上游預期 `false`）。`pairing-offer.relay.test.ts`：沒指定端點的配對連結指向 relay.woowtech.io:443、TLS。`daemon-config-store.test.ts` 有兩個上游測試原本靠新 home 預設關，改成自己寫好狀態。
- CLI：`commands/daemon/pair.relay.test.ts` 檢查新 home 的離線配對連結和 `daemon pair` 的輸出；`pair.test.ts` 和 `next-command.test.ts` 改在 relay 關著的 home 裡跑。e2e 的 `tests/03-daemon.test.ts`（Test 2、4）改成預期離線配對連結，`tests/17-onboard.test.ts` 先把 relay 關掉再測直接連線的說明；這兩支會連到 relay，還沒跑過。
- App：`desktop/components/pair-device-section.relay-off.test.tsx` render 配對畫面，按「停用中繼」後確認送出 `relay.enabled: false` 並回到「啟用中繼？」，也檢查繁中文字。
- relay：`packages/relay/src/e2e.test.ts` 用 `wrangler dev --local --config wrangler.woowtech.toml` 跑，只改了這個參數。上游的設定會把測試流量轉到 Fly。
- 守門：
  - `woowtech/relay-worker.test.mjs` 用 wrangler 自己的讀取函式讀 `wrangler.woowtech.toml`：帳號、網域、沒有 workers.dev、daemon 的預設端點就是這個網域；沒有 `PASEO_RELAY_UPSTREAM`、沒有 `[env.*]`、沒開 `keep_vars`，並用設定裡的變數實際跑 Worker，確認 `/health` 和 `/ws` 不會往外轉；程式、Durable Object、migration、observability 跟上游的設定一致（上游改了 migration 時會失敗，照著改）；relay 的 e2e 用的是我們的設定。
  - `woowtech/relay.test.mjs` 透過 tsx 從原始碼呼叫 `loadConfig`、`editPersistedConfig` 和 `generateLocalPairingOffer`：新 home、沒寫 `enabled` 的設定都是開、連 relay.woowtech.io；`enabled: false`、環境變數和 `daemon config set` 都能關；配對連結指向我們的 relay；出貨的原始碼（連同 Worker 程式和設定）不准出現 relay.paseo.sh。跨套件的匯入讀 dist，合併上游後先 `npm run build:server`。
- 其他還用上游設定的測試工具，都不出貨：`packages/cli/tests/e2e/relay-host.test.ts` 起的 `wrangler dev` 會轉到 Fly；server 的 `daemon-e2e/relay-transport.e2e.test.ts` 只有一個測試用 `--var PASEO_RELAY_UPSTREAM:` 在本機跑，其他的也轉到 Fly；`test-utils` 的測試 daemon 預設連 relay.paseo.sh。

### 12. CLI 改名（品牌識別最後一步）

官方 Paseo 的指令叫 `paseo`，它的桌面版「安裝 CLI」會寫 `~/.local/bin/paseo`，daemon 也把同名的 agent 技能裝進同一批資料夾。我們的指令叫 `woowtech-smart`，兩邊可以裝在同一台電腦、同一個 PATH 上，不會互相覆蓋或刪掉對方的。技能見第 13 節，daemon 行程名和登入 shell 的 `PASEO_HOME` 見第 5 節。

- 指令名只寫在 `packages/protocol/src/brand-cli.ts`（`CLI_COMMAND`），桌面版的安裝、CLI、daemon 的訊息和 App 都讀這裡。
- 桌面版「安裝 CLI」：
  - 建立 `~/.local/bin/woowtech-smart`（Windows 是 `woowtech-smart.cmd`），指向 App 內的 `Resources/bin/woowtech-smart`。
  - 「已安裝」只看這個路徑，而且連結要解析到這個 App 內附的 CLI，判斷寫在 `cli-install/ownership.ts`。指向官方 Paseo 的連結、App 搬家後留下的舊連結，都算沒裝，設定頁會再給安裝按鈕。
  - 不讀、不建、不改、也不刪 `~/.local/bin/paseo`。上游本來就沒有「解除安裝 CLI」。
  - 加進 shell 設定檔的註解是 `# Added by woowtech smart`。設定檔裡已經有 `.local/bin` 就不加，這是上游原本的判斷，兩邊不會重複加。
- App 內的 CLI shim 打包成兩個名字，內容相同：
  - `bin/woowtech-smart`：安裝的連結指向它，桌面版啟動 daemon 時也把它設成 `PASEO_CLI`。
  - `bin/paseo`：留給上游原樣的 OpenCode hook 外掛，它直接執行 `paseo`。
  - daemon 開的終端機會把 `bin` 放在 PATH 最前面，所以在我們的終端機裡打 `woowtech-smart` 或 `paseo` 都跑我們的 CLI。使用者自己的 PATH 上不會有 `paseo`。
  - 例外：使用者的 shell 設定檔（例如 `~/.zshrc` 的 `export PATH="$HOME/.local/bin:$PATH"`）在終端機啟動後又把別的資料夾放到更前面。裝了官方 Paseo 的 CLI 時，OpenCode 外掛執行的 `paseo` 就是官方的；它照樣回報到我們 daemon 給的 `PASEO_TERMINAL_ACTIVITY_URL`。Claude 和 Codex 的 hooks 用 `PASEO_HOOK_CLI` 的絕對路徑，不受 PATH 順序影響。
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
  - `onboard` 顯示 daemon 資料夾的那個框，標題是「Daemon data folder」。上游是「Paseo home」，照上面的規則換成「woowtech smart home」會被讀成智慧家庭。
  - daemon 的訊息：`server/src/server/daemon-instance.ts` 在 daemon 沒啟動、沒準備好、supervisor 沒發布 lock 時提示的指令直接用 `CLI_COMMAND`，CLI 和桌面版都照原文顯示。daemon 自己的訊息裡的產品名見第 17 節。
- App 的文字：
  - 翻譯載入時，`i18n/brand.ts` 除了換產品名，也套同一個 `withCliCommand`。桌面版設定「完整狀態」的說明在 10 種語言都顯示 `woowtech-smart daemon status`，上游之後新增的翻譯也會套用。插入的值、`paseo.json`、`PASEO_*`、`@getpaseo`、網址都不動。
  - 寫死在程式裡的介面文字沒有 `paseo` 指令。
  - 設定 →「整合」→「命令列」在說明下面顯示指令名 `woowtech-smart`。安裝前後都顯示，狀態載入時版面不會跳動。安裝位置 `~/.local/bin` 沒有顯示，要顯示得改桌面版回傳的安裝狀態。
- 沒改的：
  - `PASEO_*` 環境變數、`paseo.json`、`@getpaseo/*` 套件名、testID、翻譯 key：程式和設定檔用的名字，使用者不用打。
  - App 內的 `bin/paseo`（見上面的 shim），和 `packages/cli` 的 `paseo` bin：後者只給 workspace 開發和 CLI 的 e2e（`packages/cli/tests/` 用 zx 執行 `paseo`）。我們不發 npm 套件，它不會進使用者的 PATH。
  - 終端機活動 hooks 的文字和 OpenCode 外掛，原因見上面。
  - Paseo Hub（`hub.paseo.sh`）和它的聊天機器人 `@Paseo`：Hub 仍是上游經營的，跟自架 Hub 一起換。
  - 外掛範本（`plugin/scaffold.ts`）和外掛文件連結 `paseo.sh/docs/plugins`：外掛 API 仍是上游的（第 10 節）。
  - agent 看到的 MCP server 名 `paseo`：protocol 的工具名稱轉換（`tool-name-normalization.ts`）靠它辨識。
- 沒寫遷移：之前的內部測試版按過「安裝 CLI」的電腦，`~/.local/bin/paseo` 會指向 `woowtech smart.app` 裡的 `bin/paseo`，新版不會動它，要手動刪。刪之前先用 `readlink ~/.local/bin/paseo` 確認指向的不是 `Paseo.app`。
- 上游合併後：
  - 上游改了 `skills/`，照最上面的步驟跑 `generate-skills.mjs` 重新產生技能（第 13 節）。
  - 上游新增 CLI 子指令時，`cli/src/brand.test.ts` 會失敗，把新指令加進 `CLI_TOP_LEVEL_COMMANDS`。
  - CLI 直接印出的提示（`console.*`、`process.stderr.write`、`log.*`、`note`）不經過 `renderError`。守門只掃描 `cli-name.test.mjs` 的 `printsHints` 列出的檔案，上游在別的檔案新增這類提示時抓不到：合併時看一下 CLI 新增的輸出，有 `paseo <指令>` 就改用 `CLI_COMMAND`，並把檔案加進 `printsHints`。
  - 守門測試會從原始碼實際跑 CLI 的說明和錯誤、App 的翻譯、桌面版的安裝、登入 shell 環境和 daemon 的技能操作，改名的接點在合併時被蓋掉就會失敗。
- 測試：
  - `protocol/src/brand-cli.test.ts`：哪些 `paseo` 會換、哪些不動。
  - `cli/src/brand.test.ts`：程式名和 Usage 行；每個指令的說明都沒有上游的指令和產品名（Paseo Hub 除外）；錯誤在表格、JSON、YAML 都換；子指令清單跟 CLI 一致。
  - `cli/src/commands/hub/init-flow.test.ts`、`init-brand.test.ts`：Hub 精靈的提示和停止訊息。
  - `cli/src/commands/daemon/next-command.test.ts`：`daemon pair` 在暫存 home 印出的下一步（一般輸出和 `--json`）。
  - `cli/src/commands/onboard.home-note.test.ts`：在互動終端機跑 `onboard`，顯示 daemon 資料夾的框標題是「Daemon data folder」，不含 smart home。停在那個框，不問語音、不啟動 daemon。
  - `cli/src/commands/daemon/lifecycle.e2e.test.ts` 檢查 CLI 在 HOME 底下自己的 home 權限是 700。資料夾名稱從 `resolvePaseoHome({})` 取，上游和 fork 都成立（上游寫死 `.paseo`，在 fork 會 ENOENT）。
  - `server/src/server/daemon-instance.commands.test.ts`：daemon 沒在跑、沒準備好時訊息裡的指令。
  - `cli/tests/17-onboard.test.ts` 的速查預期值已改成 `woowtech-smart`。這是會啟動 daemon 的 e2e，還沒跑過。
  - `cli/tests/32-daemon-set-password.test.ts` 和 `03-daemon.test.ts` 的 `restartCommand` 預期值也改成 `woowtech-smart daemon restart`。32 從原始碼在暫存 home 跑，已實跑；03 會從 server 的 dist 起 daemon 並透過 relay 配對，還沒跑過。
  - `desktop/src/integrations/cli-install/install.test.ts` 用暫存 HOME 測安裝：官方 Paseo 的 `paseo` 連結不動、不算我們的；指向別處的 `woowtech-smart` 算沒裝；透過安裝的連結執行時，會經由 `woowtech smart Helper` 啟動 CLI，`PASEO_CLI` 是 App 內的 `woowtech-smart`。
  - `server/src/terminal/terminal-cli-env.test.ts` 確認 `PASEO_CLI` 叫 `woowtech-smart` 時，終端機的 `PASEO_HOOK_CLI` 和 PATH 都指到它。
  - `desktop/e2e/packaged-app-smoke.js` 改成執行打包後的 `bin/woowtech-smart`，打包設定有沒有真的產生這個檔案，只有它會實際確認。要打包後才能跑，還沒跑過。
  - `app/src/i18n/brand.test.ts`：「完整狀態」的說明在英文、繁中、日文、阿拉伯文顯示 `woowtech-smart`；每種語言的翻譯都沒有 `paseo <指令>`；插入的值和技術名稱不動。
  - `app/src/desktop/components/integrations-section.test.tsx`：命令列那一列在安裝前後都顯示 `woowtech-smart`。
  - `woowtech/cli-name.test.mjs`：
    - 透過 `woowtech/source-modules.mjs` 用 tsx 從原始碼跑：CLI 每個指令印出的說明頁（含 `addHelpText` 加的文字）；錯誤的表格、JSON、YAML 輸出；App 每種語言的翻譯；桌面版在暫存 HOME「安裝 CLI」，旁邊已有官方 Paseo 的 `paseo` 連結和 App 搬家留下的舊連結。
    - 檢查打包設定的兩個 shim 名字、cli-install 沒有寫到 `paseo`，以及 hooks 文字和 OpenCode 外掛仍是上游的原文。
    - 掃描原始碼：直接印提示的那幾個檔案，以及 server、desktop、app、client、protocol，不准出現 `paseo <指令>`（hooks 標記除外；翻譯另外照顯示的結果檢查）；CLI 除了說明文字、Hub、relay 說明和外掛範本以外，不准出現產品名 Paseo。
    - 偵測 `paseo <指令>` 的條件比改寫寬：上游新增的指令，或前面沒有空白的寫法，也會被抓到。

### 13. agent 技能 `woowtech-smart*`

daemon 把 agent 技能裝進 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills`，每次啟動時修正有差異的檔案，按「解除安裝」時刪掉。官方 Paseo 用同樣的資料夾，技能叫 `paseo`、`paseo-advisor`…。名字相同的話，兩邊的 daemon 每次啟動都會改寫對方的技能，任一邊解除安裝也會刪掉另一邊的。上游的 `paseo-help` 還會叫 agent 去看 6767、`~/.paseo`、`Paseo.app`、GitHub 和 Discord。

- 出貨的技能是 `woowtech/skills/` 底下的 6 個：`woowtech-smart`、`woowtech-smart-advisor`、`-committee`、`-handoff`、`-help`、`-plugin`。
  - 由 `woowtech/tools/generate-skills.mjs` 從上游的 `skills/` 產生，不要手改。上游改了 `skills/` 就重新產生：`npx tsx woowtech/tools/generate-skills.mjs`。
  - 改寫規則在 `woowtech/tools/skill-rewrites.mjs`，分兩種：
    - 到處套用的：技能名和互相引用（`**paseo**`、`/paseo-advisor`）、`paseo <指令>`（跟 CLI 用同一個 `withCliCommand`）、`~/.paseo`、6767、產品名 Paseo。`Paseo Hub` 和 `Paseo SDK` 不換：Hub 仍是上游的服務（跟 CLI 一樣），SDK 是外掛 API 的名字。
    - 手寫的段落：指令找不到時改用 `"$PASEO_CLI"`、help 技能的說明文件（官網）、relay 是 WoowTech 的 relay.woowtech.io（預設開，關掉後怎麼打開）和 daemon 只聽 `127.0.0.1:6770`、App 內附 CLI 的位置和「Settings → Integrations → Command line → Install」、Docker、求助管道（客服信箱、LINE）。每段都要在上游原文裡剛好出現一次。上游改了那段，產生器會停下來，要你更新規則。
  - 連結、指令名、relay 網址、daemon 資料夾和 port 從原始碼讀（`brand-links.ts`、`brand-cli.ts`、`brand-relay.ts`、`paseo-home.ts`、`config.ts` 的 `DEFAULT_PORT`），改了這些要重新產生。
  - 產生器用 oxfmt 排版，跟 pre-commit 的格式檢查一致。
  - 外掛 API 仍是上游的，所以 `woowtech-smart-plugin` 保留 paseo.sh 的外掛文件、`llms.txt`、SDK 文件和 GitHub 上的外掛範例；`usePaseo()`、`{ paseo }`、`requirements.paseo`、`@getpaseo/plugin` 也不動。
- `"$PASEO_CLI"`：桌面版啟動 daemon 時把 App 內附的 `bin/woowtech-smart` 設成 `PASEO_CLI`，daemon 開的 agent 會繼承。使用者沒按「安裝 CLI」時，agent 用它也叫得到我們的 CLI。從原始碼跑的開發 daemon 沒有這個變數。
- 接線：
  - server 的 `build:lib` 把 `../../woowtech/skills` 複製到 `dist/server/skills`，桌面版打包的就是這份。只改了熱檔 `packages/server/package.json` 裡的一個路徑。
  - 從原始碼跑的 daemon（`npm run dev`、還沒建 dist 的桌面版開發模式）讀 `woowtech/skills`，寫在 `orchestration-skills/internal/paths.ts`。
  - 設定頁的技能清單直接顯示 daemon 回報的名字，所以是 `woowtech-smart*`。「Update Paseo skills?」這類文字由第 6 節的載入時替換改成我們的名稱。
- daemon 只管自己的名字：
  - 出貨的技能資料夾就是技能清單，所以現在只裝、只修、只刪 `woowtech-smart*`。
  - 以前出貨過的名字：上游的 `paseo-chat`、`paseo-epic`、`paseo-orchestrate`、`paseo-orchestrator` 經過 `brandSkillName`（`packages/protocol/src/brand-skills.ts`）變成 `woowtech-smart-chat` 等。官方舊版留下的 `paseo-chat` 等不算我們的，不會出現在刪除確認裡，也不會被刪。
  - 儲存技能選擇時的暫存資料夾叫 `.woowtech-smart-skills-transaction-*`，隔離區叫 `.woowtech-smart-skills-recovered-*`。每個技能操作都會先復原中斷的交易；共用前綴的話，我們會把官方 Paseo 中斷的交易丟掉，或因為選擇對不上而讓所有技能操作失敗。交易檔的 owner 欄位維持上游的值，兩邊靠前綴分開。
  - 技能資料夾裡的 `.paseo-managed-files.json` 沒改名，它在我們自己的資料夾裡。
- 沒寫遷移：內部測試時裝過的 `paseo*` 技能要手動刪，刪之前先確認不是官方 Paseo 裝的。
- 合併到 main 之後要重建 server 的 dist（至少 `build:lib`），不然開發模式的桌面版會從舊的 `dist/server/skills` 裝上游名字的技能。
- 測試：
  - `woowtech/skills.test.mjs`：提交的技能等於重新產生的結果；6 個名字和 frontmatter；不准出現 6767、`~/.paseo`、`Paseo.app`、官方 App 的資料夾、`paseo <指令>`、上游技能名、Discord、GitHub issues 和 discussions，paseo.sh 和上游 GitHub 只准外掛技能用在外掛 API 文件；指令、port、資料夾、log、`$PASEO_CLI`、relay、官網、信箱、LINE 都要出現；`build:lib` 複製的是 `woowtech/skills`；改寫規則對上游日後可能加的文字（`/paseo`、`Paseo Hub`、`/paseo-plugin.json` 這種路徑）也對。
    另外從原始碼在暫存 HOME 跑 daemon 的技能操作，裡面已經有官方的現行和舊名技能：daemon 管理的名字只有 `woowtech-smart*`，安裝和解除安裝都不動官方的，儲存時暫存在 `.woowtech-smart-skills-transaction-*`。開發路徑、舊名清單或暫存前綴在合併時被改回上游的，這項會失敗。
  - `server/src/server/orchestration-skills/internal/coexistence.test.ts`：把真正出貨的技能裝進已經有官方技能（現行和舊名）的暫存 HOME。安裝、啟動時修正、更新、縮小選擇、解除安裝都不碰官方的，舊名只刪我們的；儲存時的暫存資料夾用我們的前綴；官方中斷的交易原樣保留，也不會讓我們的操作失敗。
  - 改了預期值的上游測試：`paths.test.ts`（開發路徑）、`desktop-packaging.test.ts`（`build:lib`）、`operations.test.ts` 和 `controller.test.ts`（舊名和暫存資料夾前綴）。

### 14. fork 自己的介面文字

- `packages/app/src/i18n/woowtech-copy.ts` 放 fork 自己的文字，也用來翻譯上游寫死在程式裡的英文。
  - 跟第 10 節的 `support-copy.ts` 一樣由 `i18n/brand.ts` 在載入翻譯時套用：放在每個語言的 `woowtech` 底下，元件用 `t("woowtech.…")` 取用。
  - 10 種語言都要有每一個 key，型別會檢查。上游之後新增的語言先顯示英文。
- 目前的內容：更新紀錄的空狀態（第 10 節）、設定頁的瀏覽器工具卡、「封存 PR 已合併的工作區」、終端機 Agent hooks 開關、「Unknown error」、側欄的「工作區」標題、配對畫面的「停用中繼」（第 11 節）。側欄的「顯示偏好」提示改用上游自己的 `sidebar.display.trigger`。
- `screens/settings/**` 寫死的英文已經全部盤點過，使用者看得到的 14 處都改用 `t()`。刻意沒改的：
  - `daemon-lifecycle.ts` 的技術性錯誤細節，顯示在已經翻譯的失敗訊息裡。
  - `plugins-page.tsx` 裡執行不到的離線錯誤。
  - 外觀預覽的範例程式碼和「px」。
- `browser-tools-config.ts` 回傳的卡片狀態仍帶上游英文，上游的單元測試會檢查它；畫面上的文字由 `browser-tools-card.tsx` 翻譯。
- 設定頁以外，上游寫死的英文還沒盤點，這次只改了測試員看到的側欄標題。
- 測試：
  - `i18n/woowtech-copy.test.ts`：每種語言都有自己的翻譯，不能只是英文；上游寫死的那些英文不能回到原始碼裡。
  - `screens/settings/host-page-translations.test.tsx`：用 zh-TW 實際 render「終端機」「工作區」設定頁和瀏覽器工具卡，也檢查「終端機設定檔」和空狀態的文字。

### 15. agent 和終端機不繼承啟動 daemon 的 Claude Code 工作階段

- 原因：從 Claude Code 裡（Bash 指令或 hook）啟動的 daemon，會繼承那個工作階段的環境變數，再傳給它啟動的每個 agent 和開的每個終端機。驗收時 dev daemon 把工作階段的 `CLAUDE_CODE_MESSAGING_TOKEN` 交給了 Claude agent。有了這個 token，agent 執行的指令可以投遞訊息到上層工作階段的收件匣，而且會被當成那個工作階段自己的子程序。
- 上游只拿掉 `CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT`、`CLAUDE_CODE_SSE_PORT`、`CLAUDE_AGENT_SDK_VERSION` 四個：
  - Pi 和 OMP 經 JSONL RPC 啟動，連這四個也沒拿掉。
  - Claude 用 node 執行時（例如 provider 的 command 設成 `["node", "cli.js"]`），環境從 daemon 自己的重新組起，拿掉的變數又全部回來。
  - 終端機一個都沒拿掉。終端機裡跑 `claude`（包括終端機設定檔啟動的），會因為 `CLAUDECODE` 把自己當成巢狀工作階段。
- 做法：其餘的工作階段變數只列在 fork 檔 `packages/server/src/server/agent/parent-claude-session-env.ts`，接點有四處：
  - `provider-launch-config.ts` 把清單展開進上游的清單。Claude、Codex、OpenCode、ACP 系列和診斷都經過這裡。
  - `providers/jsonl-rpc-process.ts` 改用 `createProviderEnvSpec` 產生環境，涵蓋 Pi 和 OMP。
  - `providers/claude/query.ts` 用 node 執行 Claude 時，把要拿掉的變數也交給 `buildSelfNodeCommand`。
  - 終端機：`packages/server/src/terminal/terminal.ts` 的 `buildTerminalEnvironment` 把組好的環境交給 `withoutClaudeCodeSession()`，拿掉上游的四個加上 fork 清單（`CLAUDE_CODE_SESSION_ENV_VARS`）。終端機的 pty 環境只從這裡來；終端機 worker 是 daemon fork 出來的，繼承 daemon 的環境。daemon 明確交給終端機的變數也照樣拿掉，跟 agent 一樣。
- 拿掉的變數，依據是 Claude Code 2.1.282 加給 Bash 工具和 hook 子程序、或自己匯出的變數，以及 code.claude.com/docs/en/env-vars：
  - 工作階段身分與上層程序標記：`CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_CODE_SESSION_ATTENDED`、`CLAUDE_PID`、`CLAUDE_EFFORT`、`CLAUDE_CODE_EXECPATH`、`CLAUDE_CODE_INVOKED_SKILLS`、`AI_AGENT`。
  - 收件匣：`CLAUDE_CODE_MESSAGING_SOCKET`、`CLAUDE_CODE_MESSAGING_TOKEN`。
  - Remote Control 與背景工作：`CLAUDE_CODE_BRIDGE_SESSION_ID`、`CLAUDE_JOB_DIR`。
  - 上層程序啟動時拿到的檔案描述符：`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`、`CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`、`CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR`、`CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR`。agent 只拿到 stdin、stdout、stderr，這些編號在 agent 裡指不到原本的檔案。
- 沒拿掉時的影響舉例：巢狀的互動式 `claude` 看到 `CLAUDE_CODE_CHILD_SESSION`，會把自己排除在 `--resume`、`--continue` 和歷史紀錄之外；讀 `CLAUDE_PID` 的腳本會對上層的 Claude Code 發訊號。
- 照常傳給 agent 和終端機的：
  - 使用者設定：`CLAUDE_CODE_OAUTH_TOKEN`、`CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX`、`ANTHROPIC_MODEL`、`CLAUDE_CODE_MAX_OUTPUT_TOKENS`、`CLAUDE_CODE_SUBAGENT_MODEL`、`CLAUDE_CODE_EFFORT_LEVEL`、`CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_TMPDIR` 等。
  - Agent SDK 自己設給子程序的旗標，例如 `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`。這些不能列進清單：spawn 時會再套一次清單，SDK 自己要傳的也會被刪掉。
  - 雲端工作階段的 `CLAUDE_CODE_REMOTE*`，它描述的是整個容器。
  - 終端機另外保留 shell 要用的一切（`PATH`、`HOME`、`SHELL`、語系、`TMPDIR`、`SSH_AUTH_SOCK`、`EDITOR`、`PASEO_CLI` 等），以及 daemon 交給終端機的 `PASEO_*`（活動回報、hooks 用的 `PASEO_HOOK_CLI`、工作區和 worktree 的變數）。
- 升級 Claude Code 後，如果文件新增了標示「Set automatically」或「Set by Claude Code, not by you」的變數，要加進這份清單。
- 還沒處理的：
  - Claude Code 也把 `GIT_EDITOR=true` 加給每個 Bash 指令。這不是 Claude 專屬的變數，所以沒拿掉：從 Claude Code 裡啟動的 daemon，agent 執行 `git commit` 時不會開編輯器，終端機裡不帶 `-m` 的 `git commit` 會因為訊息是空的而中止。要避免，就從一般終端機啟動 daemon。`TRACEPARENT`（開了 trace 轉送才會有）同樣沒拿掉。
  - 清單只有 Claude Code 的變數。從別的 agent 宿主裡啟動 daemon 時，它的變數照樣會傳給 agent，例如 Omnigent 的 `OMNIGENT_*`（包含 `OMNIGENT_RUNNER_DELEGATED_AUTH`）。
- 測試：
  - `provider-launch-config.test.ts`：20 個工作階段變數全部拿掉，10 個使用者設定全部保留。
  - `providers/jsonl-rpc-process.test.ts`：經 JSONL RPC 啟動的子程序（Pi、OMP）拿不到工作階段變數。
  - `providers/claude/query.test.ts`：用 node 執行的 Claude 拿不到工作階段變數。
  - `terminal/terminal-parent-session-env.test.ts`（fork 的檔）：20 個工作階段變數都不會進到終端機；使用者的 shell 設定、憑證和 Claude 設定，以及 daemon 給終端機的 `PASEO_*`、`PATH`、`TERM` 都保留。只比對測試的名字，失敗時不會印出整個環境。
  - `woowtech/agent-env.test.mjs` 透過 tsx 直接呼叫原始碼，檢查前兩個接點和終端機。合併上游後，如果清單沒展開、Pi 和 OMP 又繞過 `createProviderEnvSpec`，或 `buildTerminalEnvironment` 被改回上游，這個測試就會失敗。
  - 前兩個是上游的測試檔，這次共加了 96 行，合併上游時可能衝突。衝突時可以放掉這兩個檔案裡我們加的測試，`agent-env.test.mjs` 涵蓋同樣兩個接點。

### 16. 推播：走 WoowTech 的推播中繼，不帶使用者的內容

- 原因：手機推播要經過 Google（FCM）和 Apple（APNs）才到手機，會離開使用者的電腦。上游經 Expo（`exp.host`）送出，帶著 agent 回覆的前 220 字、權限要求的標題和說明（沒有的話是指令內容），terminal 的推播帶著 terminal 名稱和資料夾路徑。owner 決定：
  - 推播不帶任何使用者的內容：沒有 agent 名稱、回覆預覽、權限內容，也沒有專案、工作區和檔案名稱。
  - 不用 Expo。兩個平台都經 WoowTech 的推播中繼用 FCM 送出，daemon 從不連 `exp.host`。
  - 通知文字由中繼組：每種原因一句固定的句子，語言跟著手機 App 的介面語言（繁中或英文）。

整條路：

1. App 取得這支手機的 FCM token：iOS 用 React Native Firebase（RNFB），Android 用 `expo-notifications`。
2. App 把 `wsp1:<zh-TW|en>:<FCM token>` 經既有的 `register_push_token` 交給 daemon，訊息格式不變。只對 `server_info.features.woowtechPush === true` 的 daemon 註冊：官方 Paseo 的 daemon 沒有這個旗標，token 交給它的話，它會連同 agent 的回覆送到 Expo。
3. daemon 把整個字串當成不透明的 token，照舊存在 `push-tokens.json`，48 小時租約。
4. 有推播時，daemon 對每支手機發一個 `POST https://push.woowtech.io/api/smart/v1/notify`，本文只有 `{ token, locale, reason, target }`。
5. push.woowtech.io 是 Cloudflare Worker：只放行這條路徑、每個 IP 限流（WAF 規則），加上 edge key 標頭後轉給 Cloud Run。
6. Cloud Run 的 `smart-push`（GCP 專案 `woowtech-smart`，asia-east1）跑中繼 repo `woowtech-push-relay` 的 smart 模式（`RELAY_PROFILE=smart`）：驗證格式、查每個 token 的上限（每分鐘 10 則、每天 500 則）、從 `functions/smart-messages.js` 挑句子，用 Cloud Run 的服務帳戶呼叫 FCM。
7. FCM 送到 Android；iOS 由 FCM 用上傳到 Firebase 的 APNs 金鑰轉給 APNs。
8. 點通知：`expo-notifications` 回報點擊，`notification-routing.ts`（沒改）開到那個 agent 或 terminal。iOS 的 ID 放在 APNs payload 的 `body`（`expo-notifications` 只讀 `userInfo["body"]`），Android 的在 FCM `data`，點下去時成為啟動 intent 的 extras。

中繼的程式、文字和部署步驟在中繼 repo（`WOOWTECH/woowtech-push-relay`，`smart-mode` 分支），這裡只記 smart 這邊。

token 字串：

- `wsp1:<zh-TW|en>:<FCM token>`，`wsp1` 是 woowtech smart push 第 1 版。編碼、解析和語言對應都在 `packages/protocol/src/woowtech-push.ts`（fork 自有，App 和 daemon 共用，只有它讀寫這個字串）。解析時只切前兩個冒號，因為 FCM token 本身含冒號。
- FCM token 的契約：20 到 512 字元，只能有英數字、`_`、`-`、`:`，而且要含冒號。不符的 token App 不註冊，daemon 收到也會撤銷。
- 語言跟著 App 的介面語言（i18next）：中文（`zh` 開頭，簡體也算，跟 App 一樣，第 7 節）對到 `zh-TW`，其他對到 `en`。

離開電腦的只有中繼要的四個欄位：

- `token`：FCM token。`locale`：`zh-TW` 或 `en`。
- `reason`：

  | 推播                     | `data.reason` | `reason`     |
  | ------------------------ | ------------- | ------------ |
  | agent 完成               | `finished`    | `finished`   |
  | agent 要權限             | `permission`  | `permission` |
  | agent 出錯（目前不推播） | `error`       | `attention`  |
  | terminal 完成            | `finished`    | `finished`   |
  | terminal 等輸入          | `needs_input` | `attention`  |
  | 其他或沒有原因           | —             | `attention`  |

- `target`：一定送，可能是 `{}`，只放 daemon 產生格式的 ID：`serverId` 是 `srv_` 加 12 個字元、`workspaceId` 是 `wks_` 加 16 個十六進位數字、`agentId` 和 `terminalId` 是小寫 UUID，後兩者最多一個（都有時留 agent）。不合格的 ID 不送：2026-06-14 以前，上游把工作區的資料夾路徑當成工作區 ID，舊的 ID 不會重新產生；`PASEO_SERVER_ID` 也能設成任何文字。少了 ID，點通知就開得淺一點。格式分不出 ID 是誰取的：`PASEO_SERVER_ID`（上游說是給測試用，設過一次就寫進 `$PASEO_HOME/server-id`，之後不設也沿用）剛好是 `srv_` 加 12 個 URL 安全字元時，例如 `srv_alexs-laptop`，會跟產生的 ID 一樣送出。
- 不會離開電腦的：推播的標題和內文（agent 回覆預覽、權限要求、terminal 名稱）、`data.cwd` 和其他路徑、專案和工作區名稱，以及不合格的 ID。

daemon：`packages/server/src/server/push/woowtech-relay.ts`

- 接點：`push/index.ts` 的 `createPushNotifications` 沒注入 `deliver` 時用 `createDaemonRelayDeliver`，上游 90 天只改過這個檔案 1 次。上游的 Expo 送出器 `push-service.ts` 留著不動，沒有人呼叫，`index.ts` 只從它拿 `PushPayload` 型別。
- 網址寫死 `https://push.woowtech.io/api/smart/v1/notify`。環境變數 `WOOWTECH_PUSH_RELAY_URL` 可以蓋掉，給測試和預備環境用，daemon 啟動時讀一次。
- 不是 `wsp1:` 的字串（官方 App 或舊測試版註冊的 Expo token）和格式不合的 `wsp1:` 字串：從 store 撤銷，不送。
- 每支手機只留一個字串，也就是最後註冊的那個：daemon 收到註冊或 heartbeat 續約時，撤銷同一個 FCM token 的其他字串（`push/index.ts` 的 `renew` 呼叫 `revokeSupersededPushTokens`）。App 換語言時自己也會先撤銷舊字串，但那個請求可能逾時沒送到，而 store 照字串第一次加入的順序排，不能拿順序當成註冊先後。送出時同一個 FCM token 仍只送一次：舊版 daemon 留下兩個字串時，用 store 排在後面的那個。
- 完全不讀 `title`、`body` 和 `data.cwd`。送出前再用 `validateRelayNotifyBody` 檢查一次，送的是檢查後只剩四個欄位的那份。
- 中繼的回應，逾時 10 秒：

  | 回應                                                      | daemon                                    |
  | --------------------------------------------------------- | ----------------------------------------- |
  | 201                                                       | 完成                                      |
  | 410 `token_invalid`                                       | 撤銷這個 FCM token 的每一個字串           |
  | 503、網路錯誤、逾時                                       | 2 到 4 秒後重試一次，再失敗就丟棄（warn） |
  | 400、413                                                  | 記 error，代表 daemon 有 bug，不重試      |
  | 403                                                       | 記 error，不重試                          |
  | 429                                                       | 丟棄（info），不重試                      |
  | 502 `upstream_auth`（APNs 金鑰，或說不清的 FCM 權限錯誤） | 記 warn，不重試，不撤銷                   |
  | 其他，包括轉址（3xx，不跟著轉）                           | 記 warn，不重試                           |

- log 只記數量和結果代碼，不記 token。要追查時開 debug：每支手機一行「The push relay answered」，用 FCM token 的 SHA-256 前 8 碼代表那支手機。
- `send()` 裡照樣先跑 `woowtech-push-content.ts`：交給任何 `deliver` 的推播都已經換成產品名和每種原因一句的通用句子，`data` 只留 ID 和 `reason`。手機上顯示的是中繼的句子，所以這一步的句子和它的語言判斷（依序看 `LC_ALL`、`LC_MESSAGES`、`LANG`，macOS 讀系統語言）現在只影響注入的 `deliver`。留著是多一層保護：測試注入的、或以後改接的送出器也拿不到使用者的內容。中繼的送出器不讀文字，中繼收到的位元組有沒有這一步都一樣，所以守門另外注入記錄用的 `deliver` 來釘住這一步。
- `server_info.features.woowtechPush`：`packages/protocol/src/messages.ts` 加了一個 optional 的旗標（註解標明 fork 自有），`websocket-server.ts` 設成 `true`（2 行）。舊 App 看不到就忽略；沒有這個旗標的 daemon（官方 Paseo，或這個改版以前的我們），新 App 不註冊推播，照 `docs/protocol-compatibility.md` 不做退路。
- 上游 terminal 的推播沒有帶原因，`websocket-server.ts` 加了一行 `reason`（main 上就有）。沒有它，terminal 完成時中繼也會說「需要你的注意」。

App：`packages/app/src/push-notifications/internal/woowtech-subscriptions.ts`

- 接點：`push-notifications/index.native.ts` 的 import 從上游的 `./internal/subscriptions` 改成它（1 行），匯出的函式名稱跟上游一樣。上游的 `subscriptions.ts`（向 Expo 要 push token，註冊給任何 daemon）留著不動、沒有人引用。
- 只有連上宣告 `woowtechPush` 的 daemon 才要通知權限和 FCM token：每個 daemon 的訂閱最多問一次權限，連官方 Paseo 的 daemon 時完全不問，也不碰 Firebase。
- 快取沿用上游的 key `@paseo:expo-push-token:<serverId>`，存註冊出去的字串。升級後第一次同步會在那裡找到舊的 Expo token，先撤銷它。連的是沒有 `woowtechPush` 的 daemon（官方 Paseo，或這個改版以前的我們）也撤銷：那種 daemon 會把 agent 的回覆送到 Expo，直到舊 token 的 48 小時租約到期。daemon 宣告了 `pushTokenRevocation` 才撤銷並刪掉快取，不問權限、不碰 Firebase；沒宣告的，快取留著。
- 換 token、換語言時先撤銷舊字串（我們的 daemon 宣告了 `pushTokenRevocation`）再註冊新的，同一支手機才不會收到兩則；通知權限被拒時撤銷並刪快取（上游只刪快取）；每次重新連線都再註冊一次，續 48 小時的租約。
- FCM token 更新的監聽在第一次拿到 token 之後才開始，而且只有 token 真的換了才重新同步：Android 的 `expo-notifications` 每次 `getDevicePushTokenAsync` 都會把同一個 token 當成新 token 再發一次事件（`PushTokenModule.kt`），不比對的話，同步取 token、事件又排下一次同步，會一直重新註冊。token 不符契約時不註冊，warn 只寫長度。
- App 啟動時呼叫一次 `setAutoServerRegistrationEnabledAsync(false)`：舊測試版呼叫過 `getExpoPushTokenAsync` 的話，`expo-notifications` 會記住「每次啟動把 device token 回報 exp.host」，這一步清掉它。呼叫放在 `index.native.ts` 載入時（`turnOffExpoPushRegistration`），不管有沒有主機；每個訂閱同步前都等同一次呼叫完成，不會再呼叫。清不掉升級後第一次啟動的那一次：`expo-notifications` 在 import 時就讀這份設定（`DevicePushTokenAutoRegistration.fx.js`），比我們的呼叫早，有可能已經開始上傳。
- 各平台的 FCM token 來源，Metro 依副檔名只打包對應的檔：
  - iOS `fcm-token.ios.ts`：RNFB 的 modular API，先 `registerDeviceForRemoteMessages` 再 `getToken`（`firebase.json` 關掉了自動註冊，見下面）。
    - 第二次以後的啟動，iOS 回報 App 已經註冊過，RNFB 就直接回來、不呼叫 UIKit 的 `registerForRemoteNotifications`，而 Firebase 的 APNs token 只放在記憶體，沒有它 `getToken` 就失敗。所以 `getAPNSToken` 是 null 時，改用 `expo-notifications` 的 `getDevicePushTokenAsync()`（一定會呼叫 UIKit）等 iOS 交出 APNs token，最多等 10 秒，跟 RNFB 自己的註冊一樣。這一段在模擬器上測不到，實機驗收要看第二次啟動。
    - 同時要 token 的呼叫共用同一次註冊：每台 daemon 的訂閱各要一次，換語言和第一次允許通知時幾乎同時，而 RNFB 會把被後來的呼叫蓋掉的註冊以 `registration-superseded` 拒絕。`registration-superseded` 和 `registration-timeout` 再試一次；拿不到 token 時 warn 寫出錯誤代碼。ARM64 模擬器上 RNFB 刻意不呼叫 UIKit，註冊 10 秒逾時、再試一次，約 20 秒後放棄。
    - RNFB 在函式裡才 `require`：沒連結原生模組的建置，import RNFB 就會丟錯（「Native module RNFBAppModule is not registered」），靜態 import 會讓 App 一啟動就當掉。
  - Android `fcm-token.android.ts`：`expo-notifications` 的 `getDevicePushTokenAsync()`，在 Android 上回傳的就是 FCM token；更新用 `addPushTokenListener`。一樣延遲 `require`：F-Droid 版用的 stub 沒有這些函式，vitest 也載入不了 `expo-notifications`。
  - 其他平台（網頁、桌面版）`fcm-token.ts`：沒有 token。
  - 拿不到 token 時回 null，App 不會當掉；快取裡的舊字串先留著，是 Expo token 的話 daemon 第一次推播時會撤銷。
- 點通知導頁：`notification-routing.ts` 沒改。`src/utils/notification-routing.woowtech-push.test.ts` 鎖住兩種點擊資料的形狀：Android extras（字串值，混著 `google.message_id` 這類鍵）和 iOS 的 `body` 字典。
- 上游的 Expo 專案值（`extra.eas.projectId`、`owner`）App 執行時已經沒人用，只剩 EAS 的建置工具在用（`eas.json`、`.eas/workflows`、`woowtech/apply-identity.mjs`，第 1 節），所以留著。

iOS 的原生設定：

- `@react-native-firebase/app` 和 `messaging` 固定在同一個精確版本（26.4.0，Firebase iOS SDK 12.18.0），升級時兩個一起改。
- Firebase SDK 從 CocoaPods 來，不用 Swift Package Manager：`app.config.js` 的 `[withWoowtechPush, { disableSPM: true }]`，加上 `expo-build-properties` 的 `ios.useFrameworks: "static"` 和 `forceStaticLinking: ["RNFBApp", "RNFBMessaging", "react-native-paste-input"]`。
  - 不能用 dynamic：Expo 54 用預編譯的 React Native 時，會把 ExpoModulesCore 等 pod 做成 static library，CocoaPods 在 dynamic 下不接受，`pod install` 就失敗（SPM 需要 dynamic）。
  - `react-native-paste-input` 也要留在 static library：改成 framework 之後，bridging header 裡上游 `with-paste-input` 外掛加的 `<react-native-paste-input/PasteInputModule.h>` 會找不到。
  - Firebase 在 2026 年 10 月以後不再把新版發到 CocoaPods（`pod install` 會警告），這條路會停在 CocoaPods 上的最後一版。要回到 SPM，得等 Expo 支援預編譯模組（RNFB 已經為後續 SDK 的 `Expo::PrecompiledModules` 寫好處理），或改成從原始碼建 React Native。
- `plugins/with-woowtech-push.js` 只套 RNFB app 外掛的 iOS 部分：AppDelegate 加 `FirebaseApp.configure()`、把 plist 放進 Xcode 專案、SPM 開關。RNFB 的 `package.json` `exports` 只公開 `app.plugin.js`（它也會改 Android 的 Gradle），所以用檔案路徑載入 `@react-native-firebase/app/plugin/build/ios`。升級 RNFB 時要確認這個路徑還在，而且仍匯出 `withFirebaseAppDelegate`、`withIosGoogleServicesFile`、`withIosDisableSPM`。
- `packages/app/firebase.json` 把 `messaging_auto_init_enabled` 和 `messaging_ios_auto_register_for_remote_messages` 都設成 `false`：App 註冊推播之前不會自己連 FCM 或 APNs。這份設定由 RNFB 的「[RNFB] Core Configuration」build phase 寫進 Info.plist（`FirebaseMessagingAutoInitEnabled = false`）。
- 沒有 `GoogleService-Info.plist` 的建置完全不連結 RNFB：`plugins/woowtech-ios-firebase.js` 同時替 `app.config.js`（`ios.googleServicesFile` 和上面的外掛）和 `react-native.config.js`（autolinking）決定。
  - plist 從 `GOOGLE_SERVICE_INFO_PLIST_PROD` 或 `GOOGLE_SERVICE_INFO_PLIST_DEBUG`（依 `APP_VARIANT`）來，沒設就找 `.secrets/GoogleService-Info.prod.plist` 或 `.debug.plist`。
  - 變數指向不存在的檔，當成沒有 Firebase，只印 warning（上游其他 secret 檔的變數寫錯時會讓 prebuild 失敗）：autolinking 不能失敗，兩邊要用同一種方式判斷。
  - `pod install` 要帶跟 prebuild 一樣的 `APP_VARIANT` 和 plist 變數，否則 AppDelegate 會 import FirebaseCore 卻沒有連結 pod，或反過來。`expo run:ios` 和 EAS 會自動一致，手動分兩步跑時要自己帶。
  - autolinking 把 `react-native.config.js` 的設定蓋在套件自己的設定上，只合併一層：只寫 `platforms: { android: null }` 會把 iOS 的「[RNFB] Core Configuration」build phase 一起弄掉，所以要把套件自己的設定展開回去。
  - `react-native.config.js` 丟錯時，autolinking 不會失敗，而是當成沒有設定，兩個平台都連結 RNFB。
- Metro：RNFB messaging import `@react-native-firebase/app/dist/module/internal/nativeModule`，Metro 經套件的 `exports` 直接解析成網頁版的 `nativeModule.js`，把 Firebase JS SDK（`firebase/app`、`@firebase/*`）拉進 iOS bundle：`exports` 會略過旁邊的 `nativeModule.ios.js`。`plugins/woowtech-metro-resolver.js` 只把這一個 import 在 iOS 和 Android 改成平台的檔，`metro.config.cjs` 加 3 行包住 `resolveRequest`。

Android：

- 不連結 RNFB，`react-native.config.js` 在 Android 設成 `null`，有沒有 plist 都一樣。`expo-notifications` 本來就依賴 `firebase-messaging`，`google-services.json` 照上游放在 `.secrets/`。
- 不能多一個 FCM 服務：`expo-notifications` 的 FirebaseMessagingService 在 manifest 裡的優先序是 -1，有 RNFB 的服務時會讓給它，前景訊息和 token 更新就不會進 `expo-notifications`。
- App 在背景時由 FCM SDK 顯示通知。點擊由 `expo-notifications` 的 `ExpoNotificationLifecycleListener` 從啟動 intent 的 extras 轉成點擊事件；它的原始碼註解說 SDK 55 可能拿掉這個 class，升 Expo SDK 55 時要重測 Android 的點擊。

契約 fixture：

- `packages/protocol/tests/fixtures/smart-notify-v1.fixtures.json` 是中繼 repo `functions/test/fixtures/smart-notify-v1.fixtures.json` 的逐位元組副本，列出合法和不合法的請求。現在對應中繼 `smart-mode` 分支的 `3363c60`，`shasum -a 256` 是 `f78591d8…c8f667`。這份檔案不會打包進 npm 套件（`files` 只有 `dist`）。
- 契約由中繼那邊改。改了之後：
  1. 把整份檔案複製過來，不要在這裡改。
  2. 兩份的 `shasum -a 256` 要相同。
  3. 跑 protocol 的 `woowtech-push.test.ts` 和守門 `woowtech/push.test.mjs`：合法的案例要通過 `validateRelayNotifyBody`，而且就是 daemon 會送的位元組；不合法的要在中繼回報的同一個欄位被擋，daemon 也送不出來。
  4. 契約變了，`woowtech-push.ts` 的檢查就要跟著改（例如 FCM token 的上限），App 和 daemon 都要重建。

接點（上游的檔），行數以上游 v0.8.0 為準：

- server 和 protocol：`push/index.ts`（11 行增、4 行刪：預設 `deliver` 和 `send()` 裡的 `toRemotePushPayload`）、`websocket-server.ts`（3 行：`woowtechPush` 旗標 2 行、terminal 推播的 `reason` 1 行）、`protocol/src/messages.ts`（3 行）。
- App：`push-notifications/index.native.ts`（1 行）、`app.config.js`（2 行 require、plist 改由 `woowtech-ios-firebase.js` 決定、外掛 1 行、`expo-build-properties` 的 `ios` 區塊）、`metro.config.cjs`（3 行）、`package.json`（2 個相依）、`package-lock.json`（只有新增）。
- `knip.json`：server 的 `ignore` 放 `push-service.ts`（它還提供 `PushPayload` 型別，但 `PushService` 沒人用），App 的 `ignoreFiles` 放 `subscriptions.ts`，knip 才不會建議刪掉這兩個上游的檔。`npm run knip` 本身在 main 也會停在 knip 的 Expo 外掛（`app.config.js` 的外掛有函式，knip 5.86 當成字串處理），要看報告就分 workspace 跑，packages/app 要先在暫時的設定裡關掉 Expo 外掛。
- App 根目錄的新檔 `react-native.config.js` 和 `firebase.json` 上游沒有；上游以後加了同名檔會衝突，合併時把兩邊的設定合在一起。
- 上游的測試檔加了案例：`protocol/src/messages.test.ts`（1 組）、`websocket-server.notifications.test.ts`（2 個）、`websocket-server.terminal-notifications.test.ts`（1 組）。合併時衝突的話，可以先放掉我們加的測試：守門涵蓋 `send()` 的改寫、terminal 推播的 `reason`、`woowtechPush` 旗標和 App 的接點。
- fork 自有的檔（各自附測試）：protocol 的 `woowtech-push.ts`；server 的 `push/woowtech-relay.ts`、`push/woowtech-push-content.ts`；App 的 `push-notifications/internal/` 裡的 `woowtech-subscriptions.ts`、`fcm-token-source.ts`、`fcm-token.ts`、`fcm-token.ios.ts`、`fcm-token.android.ts`，`plugins/` 裡的 `with-woowtech-push.js`、`woowtech-ios-firebase.js`、`woowtech-metro-resolver.js`；守門 `woowtech/push.test.mjs`、`woowtech/push-content.test.mjs`。

測試：

- protocol `woowtech-push.test.ts`：字串來回和冒號、語言、token 契約（長度、字元、冒號）、`reason` 和 `target` 的對應、不帶文字，以及契約 fixture 的每一個案例。`messages.test.ts`：帶 `woowtechPush` 的 server_info 解析得到值，不帶的照樣解析。
- server `push/woowtech-relay.test.ts`：用本機的 `node:http` 伺服器當假中繼，檢查收到的原始位元組。只有四個欄位；標題、內文、`cwd` 裡的標記字串不外流；Expo token 撤銷不送；同一支手機兩種語言只送一次；App 換語言又換回來、兩次撤銷都沒送到時，中繼收到的是最後註冊的語言，store 只剩那個字串；410 撤銷；503、連線被切、連不到、逾時各重試一次；400、403、413、429、502 不重試也不撤銷；307、308、302 轉址不跟著轉，另一個位址收不到任何請求；log 沒有 token，debug 只有雜湊前 8 碼；store 撤銷失敗不影響其他手機。另一個測試不注入 `deliver`，用 `diagnostics_channel`（`undici:request:create`、`http.client.request.start`）記下 `send()` 期間程序發出的每一個請求：只有假中繼那一個。
- server `push/woowtech-push-content.test.ts`、`websocket-server.notifications.test.ts`、`websocket-server.terminal-notifications.test.ts`：通用句子、ID 格式、語言判斷；`woowtechPush` 經 protocol 解析後是 `true`；App 的 attention 訊息保有回覆預覽，交給 `deliver` 的推播只有通用句子；terminal 完成和等輸入的 `reason`。
- App：
  - `plugins/woowtech-ios-firebase.test.ts`：plist 從哪裡來，以及用 `expo-modules-autolinking` 自己的解析函式確認 RNFB 只在有 plist 的 iOS 連結、保留 build phase。
  - `plugins/with-woowtech-push.test.ts`：外掛只加 iOS 的設定，沒有 plist 時什麼都不做。`plugins/woowtech-metro-resolver.test.ts`：用真的 `metro-resolver` 確認包裝前會解析到網頁版的 `nativeModule.js`，包裝後是平台的檔。
  - `src/push-notifications/internal/` 的 `fcm-token.test.ts`、`fcm-token.ios.test.ts`、`fcm-token.android.test.ts`、`woowtech-subscriptions.test.ts`：注入有型別的假模組，不用 `vi.mock`。訂閱的測試涵蓋上面 App 的每一條規則；Android 那一項用真的 `fcm-token.android.ts` 配照 `PushTokenModule.kt` 行為的假 `expo-notifications`（取 token 時也發事件，事件在 token 之前或之後到），每次連線只註冊一次。
  - `src/utils/notification-routing.woowtech-push.test.ts`：兩種點擊資料都開到那個 agent 或 terminal，中繼的每日上限通知開到 `/`。
- 守門 `woowtech/push-content.test.mjs`：從原始碼跑沒有注入 `deliver` 的 `createPushNotifications`，`fetch` 換成記錄器，中英文各一次：只有一個請求，打到 `https://push.woowtech.io/api/smart/v1/notify`；位元組裡沒有 agent 名稱、回覆、權限內容、資料夾、terminal 名稱和工作區名稱；本文不隨內容改變；Expo token 被撤銷；`WOOWTECH_PUSH_RELAY_URL` 蓋得掉網址。注入記錄用的 `deliver`：交給它的標題和內文不含任何使用者的內容、不隨內容改變，`data` 只有 ID 和 `reason`（拿掉 `send()` 裡的 `toRemotePushPayload` 時，只有這一項會失敗）。用最小的 `this` 呼叫 `websocket-server.ts` 的 `broadcastTerminalAttention`：terminal 完成和等輸入的推播帶著 `reason`，中繼分別收到 `finished` 和 `attention`。另外掃描出貨的原始碼：Expo 的網址只在 `push-service.ts`，沒有任何地方 `new PushService` 或呼叫 `.sendPush(`，`push.woowtech.io` 只在 `woowtech-relay.ts`。
- 守門 `woowtech/push.test.mjs`，7 項，接點被蓋回上游時失敗：
  - 沒注入 `deliver` 的 `createPushNotifications` 只打 `WOOWTECH_PUSH_RELAY_URL`（本機的 `node:http` 假中繼），本文正好是那四個欄位，沒有放在標題、內文和 `cwd` 的標記字串。`fetch` 在載入原始碼之前就換掉，只放行假中繼，其他位址在本機回應並記下，接點被改回 Expo 時也不會真的送到 `exp.host`；`diagnostics_channel` 另外記下 undici 和 `node:http` 開出的請求。
  - daemon 的 server_info（從原始碼呼叫 `buildServerInfoStatusPayload`）經 protocol 的 `parseServerInfoStatusPayload` 解析後 `woowtechPush` 是 `true`。
  - App 送的 `register_push_token`（`wsp1:` 字串）經 protocol 的 `WSInboundMessageSchema` 解析，再用最小的 `this` 呼叫 `session.ts` 的 `dispatchMiscMessage`：字串原樣進到 push store，下一則推播交給 `deliver` 的就是它。上游在 schema 或 handler 加上 Expo token 的格式檢查時，這一項會失敗；App 的 `registerPushToken` 不等回應，否則只會靜靜地收不到推播。
  - `index.native.ts` 的 `startSubscription`、`revokeSubscription`、`turnOffExpoPushRegistration` 來自 `woowtech-subscriptions`，而且載入時就呼叫 `turnOffExpoPushRegistration()`；App 的原始碼沒有任何地方引用上游的 `subscriptions.ts`。
  - `getExpoPushTokenAsync` 只出現在上游的 `subscriptions.ts`（F-Droid stub 的定義那一行除外）。
  - 用 `expo-modules-autolinking` 自己的 `loadConfigAsync` 和 `resolveReactNativeModule`，每種情況開一個乾淨的子程序：Android 不連結 RNFB（有 plist 也一樣），iOS 正式版和 Debug 版沒有 plist 時不連結，有 plist 時連結並保留「[RNFB] Core Configuration」。守門讀的是 `expo-modules-autolinking/build/reactNativeConfig/` 的內部模組，升級 Expo 時如果搬家，守門會失敗，要改路徑。
  - 契約 fixture 在，合法和不合法的案例都跟 `validateRelayNotifyBody` 一致。

合併上游之後：

```bash
npm run build:server   # 守門從原始碼跑，但跨套件的匯入讀 dist
node --test woowtech/*.test.mjs
(cd packages/protocol && npx vitest run src/woowtech-push.test.ts src/messages.test.ts --bail=1)
(cd packages/server && npx vitest run src/server/push src/server/websocket-server.notifications.test.ts src/server/websocket-server.terminal-notifications.test.ts --bail=1)
(cd packages/app && npx vitest run plugins/woowtech-ios-firebase.test.ts plugins/with-woowtech-push.test.ts plugins/woowtech-metro-resolver.test.ts src/push-notifications src/utils/notification-routing.woowtech-push.test.ts --bail=1)
```

- 守門失敗時照訊息把接點改回來：預設 `deliver`、`woowtechPush` 旗標、`index.native.ts` 的 import、`react-native.config.js`。上游改了 `subscriptions.ts` 的註冊流程（例如新的時機或欄位），要照樣搬到 `woowtech-subscriptions.ts`。
- 升級 RNFB：檢查上面 iOS 外掛的路徑、`woowtech-metro-resolver.js` 改寫的 import、`firebase.json` 的鍵和 `forceStaticLinking` 的 pod 名稱。升級 Expo：檢查 static frameworks 和 SPM 的限制、Android 的點擊（SDK 55），以及守門讀的 autolinking 模組。

- 各種組合：新 App 加新 daemon 正常；新 App 加官方 daemon，不註冊，舊版 App 在那台 daemon 註冊過的 Expo token 在第一次連上時撤銷，之後不推播（撤銷沒送到的話，那台 daemon 會繼續送到 Expo，最多到舊 token 的 48 小時租約到期）；官方 App 或舊測試版加新 daemon，它們註冊的 Expo token 在第一次推播時被撤銷，不送出，更新 App 後重新註冊。
- 留在電腦上的通知照舊有內容：桌面版的系統通知和 App 裡的提醒，用的是 daemon 經自己的連線（直接連線，或端對端加密的 relay）送給 App 的 attention 訊息，裡面仍有回覆預覽和 terminal 名稱。手機 App 不顯示本機通知，只收推播。
- 還沒做的：中繼和 push.woowtech.io 的部署，以及實機驗收，見「接下來」。

### 17. daemon 自己的訊息用 woowtech smart

- 原因：daemon 寫給人看、或會離開電腦的文字仍叫 Paseo：自動產生 PR 文字失敗時的內文「Automated PR generated by Paseo.」（會出現在 GitHub 上）、請舊版 App 更新的提示、「Another Paseo daemon is already running」、App 和 CLI 顯示的 worktree 錯誤、使用者寄給我們的診斷報告，以及本地語音 worker 的行程名。
- 產品名寫在 `packages/protocol/src/brand-name.ts`（`PRODUCT_NAME`），這些訊息都讀它。改了這個檔案，要重建 protocol 和 server 的 dist。行程名照第 5 節寫字面值，守門直接讀。
- 改了的（server 共 20 行）：
  - 會出現在 GitHub 上的：PR 內文的 fallback（`session/checkout/git-metadata-generator.ts`）。
  - App 和 CLI 顯示的：
    - 舊版 App 打開子 agent 對話時的「Please upgrade the woowtech smart app…」，以及 fork 來的 PR 在等核准時給舊版 App 的「Update woowtech smart to review and run setup.」（`session.ts`）。
    - 「Another woowtech smart daemon is already running」（`pid-lock.ts`）。
    - worktree 錯誤（`worktree/commands.ts`、`agent/create-agent/create.ts`、`agent/create-agent-lifecycle-dispatch.ts`、`utils/worktree.ts`、`utils/worktree-metadata.ts`）。兩句「not a Paseo-owned worktree」和「non-Paseo worktree」改寫成「not managed by woowtech smart」：產品名中間有空白，接連字號讀起來不順。
  - 診斷報告的標題「woowtech smart diagnostics」（`session/daemon/diagnostics.ts`、`daemon-session.ts`）。欄位「Paseo home」改成「Daemon data folder」，跟 `onboard` 一樣避開 smart home（第 12 節）。
  - 本地語音 worker 的行程名 `woowtech smart Voice`，以及它當掉時的提示（`speech/providers/local/`）。
- 保留上游原文的（48 行），各有理由：
  - 外掛 API（4 行）：API 就叫 Paseo（`usePaseo()`、`{ paseo }`），外掛寫的是 Paseo 的版本號，遷移指南在 paseo.sh（第 10、12 節）。
  - 只有 agent 看的工具說明和工具結果（30 行，`agent/tools/paseo-tools.ts`、`browser-tools/tools.ts`）：agent 透過名叫 `paseo` 的 MCP server 用這些工具，上游的工具名稱轉換靠這個名字（第 12 節）。
  - 寫給 agent 的提示（6 行）：語音模式的指示（`voice-config.ts`；語音模式要本地語音，我們不出貨），以及 fork 出來的 agent 收到的對話紀錄、review 留言的開頭。App 把後兩者顯示成附件，不顯示內文。
  - daemon 和 provider 自己的外掛或擴充之間的訊息（7 行）：OpenCode 橋接、Pi 的內部指令、OMP 的 host tool。錯誤只會到 agent 那裡。
  - daemon.log 的一行記錄。
  - Hub：server 裡 Hub 的程式沒有提到 Paseo。
- `session.ts` 是熱檔（上游 90 天改了 82 次），只動了兩句和一行 import。
- 測試：
  - `woowtech/names.test.mjs` 掃描 server 出貨的原始碼：上面保留的幾類以外，不准出現 Paseo。上游改回、或新增一句提到 Paseo 的文字時會失敗。這時看那句是誰在讀：人看得到的改用 `PRODUCT_NAME`，只給 agent 或外掛的，在守門的清單加一條並寫理由。同一個檔案也檢查三個行程名（第 5 節）。
  - 上游測試改了預期值：`pid-lock.test.ts`（5 處）、`session/checkout/git-metadata-generator.test.ts`、`session.test.ts`、`wire-compat.test.ts`（2 處）、`selective-timeline-delivery.e2e.test.ts`。合併時衝突的話，照上游改完再把產品名換成我們的。
  - protocol 的 `messages.test.ts` 和 `messages.wire-compat.test.ts` 用「Paseo diagnostics」「Update Paseo…」當範例資料，不是在檢查 daemon 的輸出，沒改。

### 18. GitHub Actions：只跑 Ubuntu 上的 CI 測試

- owner 的決定：只跑 CI 的測試，只用 Ubuntu；Windows 不在 v1；不部署、不發佈。
- 計費：repo 是私有的，GitHub Free 每月 2,000 分鐘，WOOWTECH 帳號的私有 repo 共用。私有 repo 的標準 Linux runner 是 2 核心（上游是公開 repo，用 4 核心）。Windows 的分鐘算 2 倍、macOS 算 10 倍，每個 job 各自進位到整分鐘。
- 上游的 11 個 workflow 只開 `ci.yml`。其他 10 個留在 repo 裡，合併上游時才不會衝突，在 GitHub 上停用：

| 檔案                      | 做什麼                                                                               | 觸發                                                                                                                                      | 需要的 secret 和外部服務                                        | 不停用的話，在我們的 repo 會怎樣                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`（開著）          | 格式、lint、typecheck、各套件的測試                                                  | 上游：push main、PR、merge queue、手動                                                                                                    | 三把模型 API key，CI 跑的測試用不到（見下面）                   | 上游的設定每次 push main 都跑完整一輪，含兩個 Windows job，約 390 分鐘，一個工作天就用完當月額度                                                                                              |
| `android-apk-release.yml` | 在 EAS 建 APK，上傳到 GitHub Release                                                 | 推 `v*`、`android-v*` tag；手動                                                                                                           | `EXPO_TOKEN`、可寫的 `GITHUB_TOKEN`                             | 先在我們的 repo 建「Paseo v…」草稿 release，再因為沒有 `EXPO_TOKEN` 在 EAS 失敗。`app.config.js` 裡仍是上游的 Expo 專案                                                                       |
| `deploy-app.yml`          | 建網頁版 App，部署到 Cloudflare Pages 專案 `paseo-app`                               | 推 `v*`（beta 除外）、`app-v*` tag；手動                                                                                                  | `CLOUDFLARE_API_TOKEN`，帳號 ID 寫死成上游的                    | 建置約 10 分鐘後，部署因為沒有 token 而失敗                                                                                                                                                   |
| `deploy-relay.yml`        | 用上游的 `wrangler.toml` 部署 relay                                                  | 只有手動                                                                                                                                  | `CLOUDFLARE_API_TOKEN`，上游的帳號和 relay.paseo.sh             | 沒人按就不跑；按了會因為沒有上游帳號的權限而失敗。我們的 relay 照第 11 節手動部署                                                                                                             |
| `deploy-website.yml`      | 把 paseo.sh 官網（`packages/website`）部署到 Cloudflare Workers                      | push main 且改到 `CHANGELOG.md`、`public-docs/`、`packages/website/`、`package.json`、`package-lock.json`、`patches/`；release 發佈；手動 | `CLOUDFLARE_API_TOKEN`，上游的帳號和 paseo.sh                   | 改到 `package-lock.json` 就跑，每次在部署那步失敗                                                                                                                                             |
| `desktop-release.yml`     | 建 macOS（arm64、x64）、Linux、Windows 桌面版，上傳到 GitHub Release，全部成功就發佈 | 推 `v*`、`desktop-v*` 等 tag；手動                                                                                                        | Apple 的簽章憑證和帳號（`APPLE_*`）、可寫的 `GITHUB_TOKEN`      | 推一個 `v*` tag，光兩個 macOS job（10 倍）就可能用掉幾百分鐘；沒有憑證也照樣建出沒簽章的安裝檔，放進我們 repo 的「Paseo v…」release。桌面版看的是 `woowtech-smart-releases`，已安裝的不會拿到 |
| `desktop-rollout.yml`     | 改已發佈 release 的分批更新時數                                                      | 只有手動                                                                                                                                  | 可寫的 `GITHUB_TOKEN`                                           | 沒人按就不跑                                                                                                                                                                                  |
| `docker.yml`              | 用 QEMU 建 amd64、arm64 兩種 daemon 映像，tag 時推到 GHCR                            | PR（改到大部分套件）、push main、推 `v*` tag；手動                                                                                        | 可寫 packages 的 `GITHUB_TOKEN`                                 | 每次 push main 都建兩種架構的映像（arm64 是模擬的，很慢）；推 `v*` tag 會把映像發佈到 `ghcr.io/woowtech/paseo`                                                                                |
| `nix-update-hash.yml`     | 更新 Nix 的相依 hash，commit 並 push 回 main                                         | push main 且改到 `package-lock.json`、`packages/server/`、`packages/cli/` 等                                                              | 上游 bot app 的 `PASEO_BOT_APP_ID`、`PASEO_BOT_APP_PRIVATE_KEY` | 第一步就因為沒有 secret 失敗，幾乎每次 push 都多一個紅叉                                                                                                                                      |
| `nix.yml`                 | 在 Linux 用 Nix 建 daemon 並試跑，在 macOS 建桌面版                                  | PR（改到大部分套件）                                                                                                                      | 無                                                              | 每個 PR 都跑一個 macOS job（10 倍）；Nix 的桌面版找 `Paseo.app`（`nix/desktop-package.nix`），我們的是 `woowtech smart.app`，會失敗                                                           |
| `release-notes-sync.yml`  | 用 `CHANGELOG.md` 更新 GitHub Release 的內文                                         | 推 `v*` tag；push main 且改到 `CHANGELOG.md`；手動                                                                                        | 可寫的 `GITHUB_TOKEN`                                           | 推 `v*` tag 會在我們的 repo 建草稿 release，內文是上游的更新紀錄                                                                                                                              |

`ci.yml` 改了四處，其他照上游：

- 觸發：拿掉 push main，改成每週一次（週日 18:17 UTC，台灣週一 02:17），PR、merge queue、手動照舊。個人帳號的私有 repo 沒有 merge queue，那個觸發不會發生，留著是因為上游的 `scripts/ci-workflow.test.mjs` 檢查它。
- 排程的那一次不跑 `changes` job 裡的 `dorny/paths-filter`：它從事件內容讀預設分支，排程事件沒有帶 repository，會直接失敗，連帶跳過後面的 CI 規則檢查。PR 以外的事件本來就跑全部的 job，不需要它的結果。
- Windows：兩個 Windows job 的 `if` 最前面加上 `vars.WOOWTECH_CI_WINDOWS == 'true' &&`。repo 沒設這個變數，兩個 job 顯示為略過，不佔 runner。沒有刪掉，因為上游的 `ci-workflow.test.mjs` 要求它們存在。要跑 Windows 時，在 Settings → Secrets and variables → Actions → Variables 新增 `WOOWTECH_CI_WINDOWS`，值是 `true`。
- 桌面版的 RPM smoke 先用 `dpkg --remove` 移除前一步裝的 deb。我們的 deb 叫 `io.woowtech.smart.desktop`（electron-builder 取 `extraMetadata.name`，第 5 節），上游的叫 `paseo`。用上游的名字時 dpkg 只會警告、不會移除，deb 留下的檔案會補上 RPM 沒裝到的東西，smoke 就看不出 RPM 的問題。

secret 和外部服務：

- `ci.yml` 把 `CLAUDE_CODE_OAUTH_TOKEN`、`OPENAI_API_KEY`、`OPENROUTER_API_KEY` 交給 server 測試和 Playwright。CI 跑的是 server 的單元測試（排除 `*.e2e.test.ts`）和 5 個用假 agent 的整合測試，以及 Playwright 的 `browser` project（排除 `*.real.spec.ts`），都不讀這三把 key。
- repo 不要設這三個 secret，也不要設 Cloudflare、Expo、Apple 的 secret：停用的 workflow 被重新打開時會拿去用。
- CI 會連公開的服務：npm registry（安裝、`npm audit signatures`、全域安裝 claude-code、codex、opencode）、Playwright 和 Electron 的下載、Ubuntu 的套件庫，以及測試裡 Expo CLI、opencode 自己連的。不連上游的 relay、Hub 和網站：測試用的 daemon 預設關 relay 或指到本機，Hub 的測試用本機的假伺服器，relay 的 e2e 用 `wrangler dev --local`。CLI 的 e2e 有兩支會打開 relay（`03-daemon`、`17-onboard`），連的是我們的 relay.woowtech.io。

分鐘估計：上游的執行時間拿不到（不查 GitHub），用本機的測試時間推算 2 核心私有 runner 上的時間。

| job                           | 估計分鐘           |
| ----------------------------- | ------------------ |
| changes                       | 1                  |
| format、lint                  | 5、6               |
| typecheck                     | 10                 |
| server-tests (ubuntu-latest)  | 28                 |
| desktop-tests (ubuntu-latest) | 30                 |
| app-tests                     | 10                 |
| sdk-tests                     | 8                  |
| playwright，4 個分片          | 4 × 25             |
| relay-tests                   | 5                  |
| cli-tests，3 個分片           | 3 × 18             |
| 合計，16 個 job               | 約 250（180～320） |

- 依據：每個 job 都要 `npm ci`（約 3 分鐘）。vitest 預設用「CPU 數減一」個 worker，2 核心只有 1 個，server 的單元測試一個檔一個檔跑：本機 384 個檔的測試時間加起來 1,008 秒，其中 `hub/relationship-controller.test.ts` 一個就要 4～6 分鐘。App 的 603 個檔，載入時間加起來 168 秒。CLI 的 e2e 35 個檔在本機同時跑 2 個要 596 秒。網頁版冷打包在本機要 215 秒（5,136 個模組），每個 Playwright 分片都要打包一次。
- 兩個 Windows job 打開的話，每次再加約 140 分鐘（已算 2 倍）。
- 每月（約 22 個工作天，每個工作天 push main 約 10 次）：

| 觸發                   | 每月次數 | 每月分鐘                                 |
| ---------------------- | -------- | ---------------------------------------- |
| 上游的：每次 push main | 約 220   | 約 55,000（27 倍；含 Windows 約 86,000） |
| 工作日每晚一次         | 約 22    | 約 5,500（2.75 倍）                      |
| 每週一次（採用）       | 約 4.3   | 約 1,090                                 |
| 只有 PR 和手動         | 看用量   | 每次最多約 250                           |

- 採用每週一次加手動，剩約 900 分鐘，大約還能手動或用 PR 跑 3 次完整的。取捨：
  - main 上的問題最慢一週後才發現。合併上游和發佈之前，手動跑一次（Actions → CI → Run workflow）。
  - PR 依改到的路徑只跑相關的 job（`.github/ci-paths.yml`），但改到很多套件的 PR 接近一次完整的。
- 排程的 CI 失敗時，GitHub 通知最後修改 cron 那一行的使用者。
- 第一次跑要注意的，都是上游的設定，實際跑過再決定要不要放寬：
  - `desktop-tests (ubuntu-latest)` 設了 30 分鐘上限，估計剛好在邊緣。
  - Playwright 的 globalSetup 要在 120 秒內打包好網頁版（`packages/app/e2e/support/global-setup.ts` 的 `warmMetro`），本機冷打包要 215 秒，4 個分片可能都停在這裡。

打開 Actions（在 GitHub 上的操作由 coordinator 和 owner 做）：

1. 先 push 含這些改動的 main。這時 Actions 還關著，什麼都不會跑。
2. Settings → Actions → General → Actions permissions：選「Allow WOOWTECH, and select non-WOOWTECH, actions and reusable workflows」，只勾「Allow actions created by GitHub」，允許清單填 `dorny/paths-filter@d1c1ffe0248fe513906c8e24db8ea791d46f8590`。CI 只用 GitHub 自己的 actions 和這一個。不要勾「Require actions to be pinned to a full-length commit SHA」，CI 用的是 `@v4` 這種標籤。
3. 同一頁的 Workflow permissions：選「Read repository contents and packages permissions」，不勾「Allow GitHub Actions to create and approve pull requests」。
4. 馬上到 Actions 分頁，把上表 CI 以外的 10 個 workflow 逐一停用：點 workflow → 右上角 ··· → Disable workflow。停用完之前不要 push、推 tag 或開 PR。
5. 手動跑一次 CI，看每個 job 的結果和用掉的分鐘數，更新上面的估計。
6. 確認 Actions 用完免費額度時會停下，而不是收費：帳號沒有付款方式時本來就會停；有的話，在 Billing and licensing → Budgets and alerts 替 Actions 設 0 元預算並選到達上限就停止。

合併上游時：

- `woowtech/workflows.test.mjs` 列出每個 workflow 檔：開著的 `ci.yml`，以及在 GitHub 停用的 10 個和原因。多一個、少一個都會失敗。
- GitHub 會啟用新的 workflow 檔，觸發條件有 push 的話，加進它的那次 push 就會跑。守門發現新檔時，push 之前先看它的觸發條件：
  - 這次 push 不會觸發它（只有手動、tag 或 PR）：照常 push，再到 Actions 停用它。
  - 這次 push 會觸發它：先在 Settings → Actions → General 選「Disable actions」，push 完選回原本的設定（確認允許清單還在），再停用它。
  - 然後把檔名和原因加進守門的 `DISABLED_IN_UI`；CI 需要它的話，改加進 `ENABLED`。
- 同一個守門也檢查：`ci.yml` 沒有 push 觸發、排程每週一次，排程時不跑 `dorny/paths-filter`；每個 job 都在 Ubuntu 上，Windows job 要先過變數的條件；開著的 workflow 只用那三把 key、不要求寫入權限；RPM smoke 移除的是 electron-builder 算出的 deb 名稱。上游改到這些時會失敗，照訊息改回來。

### 19. 配對連結直接叫起 App

owner 的決定是「直接叫起 App」：配對連結和 QR Code 打開渥屋智能本身，不再打開上游在 app.paseo.sh 的網頁版。之前用手機相機掃 QR Code 會進到上游的網頁版，配對憑證交到上游的網頁程式手上，使用者在上游品牌的網頁裡操作我們的 daemon。

連結格式：

- `woowtech-smart:///#offer=<base64url JSON>`。JSON 跟以前一樣（serverId、daemon 公鑰、relay 端點），拿到連結就能連上這個 daemon，所以連結要當密碼看待。只換了 `#offer=` 前面的網址，組法仍是 `connection-offer.ts` 的 `encodeOfferToFragmentUrl`：`app.baseUrl` 去掉一個結尾斜線，再接 `/#offer=`。
- 三條斜線是 App 的根網址。Expo Router 把自訂 scheme 連結的 host 和路徑當成路由，fragment 不算：`woowtech-smart:///` 落在 index 路由，這也是 Expo 在一般啟動時用的網址（`Linking.createURL("/")`）。index 不在 `Stack.Protected` 裡，store 還沒準備好的冷啟動也找得到。寫成 `woowtech-smart://pair#offer=…` 的話，`pair` 會變成路由，打開的是找不到頁面的畫面。
- App 收到連結後，`_layout.tsx` 的 `OfferLinkListener` 找 `#offer=`、存下這台主機，再轉到「開啟專案」。App 內的掃描器（`app/pair-scan.tsx`）和「貼上配對連結」（`components/pair-link-modal.tsx`）也只找 `#offer=`。三個都用字串運算，不經過 URL 類別：React Native 內建的 URL 對自訂 scheme 讀不準 host 和路徑，fragment 也靠不住。App 裡的 URL 目前被 Expo 換成完整的實作，但不要依賴它。
- 帶 `#offer=` 的 https 連結照樣能配對，例如 `app.baseUrl` 設成 daemon 自己的網頁版時。程式沒有寫死任何主機。
- 在電腦上點連結只會打開桌面版：macOS 的 `open-url` 只處理 agent 連結，配對連結直接忽略。Windows 和 Linux（不在 v1）的 second-instance 會多開一個視窗，跟上游處理不認得的連結一樣。

預設值和遷移：

- 常數在 `packages/protocol/src/brand-pairing.ts`：`BRAND_PAIRING.appBaseUrl` 是 `woowtech-smart:///`，`linkExample` 是「貼上配對連結」的範例文字。scheme 要跟 `app.config.js` 的 `scheme` 一致（第 5 節）。改了這個檔案，要重建 protocol 和 server 的 dist。
- 新 home 的 `config.json` 寫入 `app.baseUrl: "woowtech-smart:///"`；`config.ts`、`pairing-offer.ts`、`bootstrap.ts`（三處）的預設也讀這個常數。
- `config.json` 的 `app.baseUrl` 正好是上游的預設 `https://app.paseo.sh`（有沒有結尾斜線都算）時，當成沒設，用我們的預設：那是之前的內部測試版寫進去的，不是使用者選的。其他值都照用，連 app.paseo.sh 底下的路徑也是；`PASEO_APP_BASE_URL` 照樣優先。
  - 寫在 fork 的 `packages/server/src/server/app-base-url.ts`（`appBaseUrlFromConfig`），`config.ts` 解析設定時呼叫。daemon 重新載入設定、CLI 的離線 `daemon pair` 都走這裡。
  - 不改寫 `config.json`，跟 relay 的預設（第 11 節）一樣只在解析時處理：`woowtech-smart daemon config get app.baseUrl` 仍顯示檔案裡的上游網址，實際的連結看 `woowtech-smart daemon pair`。

CORS：

- 新 home 的 `daemon.cors.allowedOrigins` 改成空的，不再放行 `https://app.paseo.sh`。原本上游網站上的程式可以從使用者的瀏覽器直接連本機的 daemon（HTTP 和 WebSocket 都看這份白名單），而 daemon 預設沒有密碼。
- daemon 自己固定放行的照舊（`bootstrap.ts`）：桌面版的 `woowtech-smart://app`、daemon 自己的位址（`http://127.0.0.1:<port>`、`http://localhost:<port>`），WebSocket 另外接受同源。開發用的也照舊：`scripts/dev-home.sh` 寫的 `"*"`、`scripts/dev-daemon.sh` 的 `PASEO_CORS_ORIGINS`。
- 已存在的 home 不動：內部測試版建立的 `config.json` 還列著 `https://app.paseo.sh`，要自己拿掉，例如 `woowtech-smart daemon config set daemon.cors.allowedOrigins '[]'`。要不要自動拿掉還沒決定（接下來）。

文案：

- `onboard` 的下一步拿掉「Web app: https://app.paseo.sh」，後面重新編號。
- 「貼上配對連結」的範例改成 `woowtech-smart:///#offer=...`，由 `BRAND_PAIRING.linkExample` 提供。範例是連結，每種語言都一樣，所以不放進翻譯：`woowtech-copy.ts` 的測試要求每種語言有自己的譯文。這個視窗的其他文字（「請貼上配對連結（.../#offer=...）」等）本來就沒有提到主機，繁中不用改。

取捨：

- 沒裝 App 時掃了沒反應，也沒有安裝引導；Android 各家相機對自訂 scheme 的處理不一致；別的 App 也能註冊同一個 scheme。這些要在實機驗收時確認。
- 當時比較過的其他做法，相機叫不起 App 時再考慮：
  - 在我們的網域放一頁（官網 aiot.woowtech.io 的 `/pair`，或 relay 的 Worker 提供 `https://relay.woowtech.io/pair`）：頁面讀 `#offer=`，提供「在渥屋智能中開啟」和商店連結，沒裝 App 有引導；之後同網域可以做 universal links 和 App Links（要開 Associated Domains、用 Play 的簽章指紋寫 `assetlinks.json`、重新建置 App）。頁面的程式會碰到配對憑證，不能載入任何第三方程式。
  - 在 app.woowtech.io 自架網頁版：要多維運一個能操作使用者 daemon 的網頁 App，每次發版都要更新。
  - 維持 app.paseo.sh：上游隨時可能改或停掉那個網站。

接點（上游的檔）：`persisted-config.ts`（4 行）、`config.ts`（3 行）、`pairing-offer.ts`（2 行）、`bootstrap.ts`（4 行，熱檔）、`protocol/src/connection-offer.ts`（1 行註解）、`cli/src/commands/onboard.ts`（4 行）、`app/src/components/pair-link-modal.tsx`（2 行），以及上游測試 `app/src/runtime/host-runtime.test.ts` 加的 1 個測試。

測試：

- server `pairing-link.test.ts`：新 home 的連結（整段比對 offer）；沒給 `app.baseUrl` 的連結；上游預設兩種寫法的遷移；自己設的值不動（daemon 的網頁版、自己的網站、app.paseo.sh 底下的路徑）；`PASEO_APP_BASE_URL` 優先；`daemon config set` 後重新載入。
- server `cors-defaults.test.ts`：新 home 沒有 web origin、dev 的 `"*"` 和 `PASEO_CORS_ORIGINS` 照舊；實際起 daemon，上游網頁版的 HTTP 拿不到 CORS 標頭、WebSocket 回 403，桌面版和 daemon 自己的網頁版照樣連得上。
- CLI `commands/daemon/pair.app-link.test.ts`：新 home 和寫著上游預設的 home，`daemon pair` 的連結都是 `woowtech-smart:///`。`utils/daemon-target.app-link.test.ts`：`--host` 帶配對連結時，訊息裡的 offer 會遮掉。
- App：`host-runtime.test.ts` 的新測試是 `OfferLinkListener` 用的匯入；`components/pair-link-modal.app-link.test.tsx` 和 `components/pair-scan.app-link.test.tsx`（掃描器是 `src/app` 裡的路由，測試放外面，因為 Expo Router 會把 `src/app` 裡的每個檔案當成路由）：貼上和掃描新連結都能配對，範例文字是新連結。三個都把 URL 類別換成會記錄的版本，確認配對連結沒有交給它。
- protocol `brand-pairing.test.ts`：CLI 的 `--host` 和 daemon 匯出的解析函式讀得到新連結的 offer。
- 守門 `woowtech/pairing.test.mjs`，5 項：
  - 從原始碼跑 daemon 的設定和配對：新 home 的連結是 `woowtech-smart:///#offer=`，offer 是這個 home 的；沒給 `app.baseUrl` 也一樣。
  - 用 expo-router 自己的函式（`build/fork/extractPathFromURL`）確認連結落在 index 路由；用 `expo config --type introspect` 確認正式版和 Debug 版在 iOS（`CFBundleURLSchemes`）和 Android（VIEW + BROWSABLE，沒有 host 或路徑限制的 intent filter）都註冊了 `woowtech-smart`。
  - 上游預設的 home 改用 App 連結，自己設的值不動。
  - 新 home 沒有 web origin，CLI 讀的預設（`readPersistedConfig` 的 `defaultsIfMissing`）也沒有。
  - 出貨的原始碼不准出現 app.paseo.sh。「出貨的原始碼」是 `shipped-sources.mjs` 的 app、cli、client、desktop、protocol、server 的 `src`（含 App 的翻譯 `src/i18n`），加上 relay 的 `src`、App 的 `plugins/`、`woowtech/skills`，以及 `app.config.js`、`eas.json`、`public/index.html`、`public/manifest.json`、`electron-builder.yml`、`wrangler.woowtech.toml`。不掃：測試、e2e、test-utils，`docs/`、`public-docs/`、`SECURITY.md`、`CHANGELOG.md` 這些說明文件，`scripts/`、`nix/`，以及上游的官網 `packages/website`。唯一的例外是 `app-base-url.ts` 辨認上游預設的那一行，守門也檢查它只有那一行。
  - 突變都被抓到：新 home 的 `app.baseUrl` 或 CORS 改回、`config.ts` 不遷移、遷移少了結尾斜線那種寫法、`pairing-offer.ts` 或 `bootstrap.ts` 的預設改回、`onboard` 加回 Web app、範例文字改回、`app.config.js` 的 scheme 改掉、`BRAND_PAIRING` 改成有 host 的網址（要重建 protocol 的 dist）、`app-base-url.ts` 多一行提到 app.paseo.sh。

上游合併後要再確認：

- 守門的出貨原始碼掃描失敗時，看新出現的地方是誰在用：預設值改用 `BRAND_PAIRING`，給人看的文字改成我們的。
- 上游改了 `encodeOfferToFragmentUrl` 的組法或 `config.ts` 的 `app.baseUrl` 解析：守門第 1、3 項會失敗。照新的組法調整 `BRAND_PAIRING.appBaseUrl`，保持連結是 `woowtech-smart:///#offer=…`。
- 升級 expo-router：守門直接讀 `expo-router/build/fork/extractPathFromURL`，搬家時會失敗。確認新版仍把 `woowtech-smart:///` 對到 index，再改守門的路徑。
- 上游新增 `src/app/+native-intent.tsx`、改了 `src/app/index.tsx`，或把 index 放進 `Stack.Protected`：連結可能不再落在啟動畫面，要在模擬器上用 `xcrun simctl openurl` 和 `adb shell am start` 重新確認。
- 上游讓 `OfferLinkListener`、掃描器或「貼上配對連結」改用 URL 類別讀 fragment：三個 App 測試會失敗，改回字串運算。
- 上游在新 home 的 CORS 預設或 `bootstrap.ts` 的固定清單加回網頁版：`cors-defaults.test.ts` 和守門會失敗。

## Mac 開發環境

`woowtech/scripts/mac/` 是在 M2、8GB RAM 的 Mac 上建置和測試用的腳本。路徑是寫死的：repo 在 `~/projects/woowtech-smart`，腳本透過 `~/.local/share/woowtech-smart/` 的 symlink 呼叫，log 和截圖也存在那裡。

```bash
mkdir -p ~/.local/share/woowtech-smart
ln -sf ~/projects/woowtech-smart/woowtech/scripts/mac/*.sh ~/.local/share/woowtech-smart/
```

| 腳本                                     | 用途                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `env.sh`                                 | 用 source 載入：把 Node 22（Homebrew `node@22`）放到最前面，並載入 Android 工具鏈（`~/.local/share/woow-android-toolchain`） |
| `dev-daemon.sh`                          | 精簡版 dev daemon，監聽 `127.0.0.1:6768`，資料放在 `.dev/paseo-home`                                                         |
| `run-bg.sh <名稱> <指令…>`               | 在背景跑長時間工作，log 寫到 `~/.local/share/woowtech-smart/logs/`，最後一行是 `EXIT=`                                       |
| `build-android.sh [ABI] [gradlew 參數…]` | 建置 Android debug APK，預設只建 arm64-v8a。ABI 之後的參數原樣交給 gradlew；第一個參數是 `-` 開頭時，ABI 用預設              |
| `android-test-up.sh`                     | 依序啟動 daemon、模擬器、Metro，然後安裝並開啟 App                                                                           |
| `adb-shot.sh <名稱>`                     | 擷取模擬器畫面，存到 `~/.local/share/woowtech-smart/shots/`                                                                  |

注意事項：

- 這台 Mac 記憶體只有 8GB。跑重的建置之前，先確認沒有其他 `xcodebuild` 或 Gradle 在跑：`pgrep -x xcodebuild`。
- Android 建置需要 JDK 17（Homebrew `openjdk@17`）。少了它，Gradle 會改從 GitHub 下載 JDK，而且會卡住但不報錯。
- 內部磁碟不夠時，把 Gradle home 放到外接碟 WOOW-BUILD。冷建置光 transforms 就要約 3.7 GB，2026-09-25 驗收時就這樣把內部磁碟寫滿，建置中途停掉。`env.sh` 固定把 `GRADLE_USER_HOME` 指到內部磁碟的共用 gradle-home，所以要用 `WOOW_GRADLE_USER_HOME` 覆寫：

  ```bash
  G=/Volumes/WOOW-BUILD/woowtech-smart/gradle-home
  # 第一次：複製 Gradle 本體（約 146 MB），免得 gradlew 重新下載。
  # 版本看 packages/app/android/gradle/wrapper/gradle-wrapper.properties，目前是 8.14.3。
  mkdir -p "$G/wrapper/dists"
  ditto ~/.local/share/woow-android-toolchain/gradle-home/wrapper/dists/gradle-8.14.3-bin "$G/wrapper/dists/gradle-8.14.3-bin"
  # 先看解析出來的設定，不會建置
  WOOW_DRY_RUN=1 WOOW_GRADLE_USER_HOME="$G" ~/.local/share/woowtech-smart/build-android.sh
  # 建置
  WOOW_GRADLE_USER_HOME="$G" ~/.local/share/woowtech-smart/run-bg.sh android-build ~/.local/share/woowtech-smart/build-android.sh
  ```

  - 已經下載過的相依套件，直接從共用 gradle-home 的 `caches` 讀取（腳本會自動設 `GRADLE_RO_DEP_CACHE`），不會重新下載。Gradle 讀這個快取時不上鎖，所以這時不要再用共用 gradle-home 跑其他 Gradle 建置。如果自己設了 `GRADLE_RO_DEP_CACHE`，就用你設的。
  - 外接碟沒掛載（`/Volumes/WOOW-BUILD/woowtech-smart` 不存在）或給的是相對路徑時，腳本會在啟動 Gradle 之前停下。
  - WOOW-BUILD 至少要留 5 GB。
  - `WOOW_DRY_RUN=1` 只印出 ABI、`JAVA_HOME`、`GRADLE_USER_HOME`、`GRADLE_RO_DEP_CACHE`、工作目錄和 gradlew 指令，不建置，也不建立資料夾。
  - 不設 `WOOW_GRADLE_USER_HOME` 時，行為跟以前一樣。

- 改了 `build-android.sh` 之後，跑 `node --test woowtech/scripts/mac/build-android.test.mjs`。它用假的 HOME 和只記錄參數的假 gradlew，不會真的建置；沒有 Homebrew 的 JDK 17 時會略過。
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
  還沒實際啟動 daemon 確認它不再連到 relay.paseo.sh。後來有了自己的 relay，改成預設開啟，見下面的「自己的 relay」。
- 更新下載快取（2026-09-25）：`coexistence.test.mjs` 先紅後綠，紅燈是 electron-builder 算出 `'@getpaseodesktop-updater'`，跟官方 Paseo 的 `app-update.yml` 相同。
  突變被抓到：拿掉 `extraMetadata`、改在 `publish` 設 `updaterCacheDirName`，electron-builder 照樣算出上游的名稱。`auto-updater` 12、`updater` 5、`desktop-packaging` 11 個測試通過，`update-sources.test.mjs` 2/2。
  沒有實際打包，是用 electron-builder 自己的函式確認 mac、Windows、Linux 的 `app-update.yml` 都會寫 `io.woowtech.smart.desktop-updater`。

- CLI 改名第一部分（2026-09-25，分支 `woowtech/cli-rename`）：指令名、CLI 輸出、桌面版安裝 CLI、登入 shell 環境、行程名。新測試都先紅後綠。
  - 紅燈原因：桌面版把官方 Paseo 的 `paseo` 連結當成已安裝、裝成 `paseo`、rc 註解寫 Paseo；CLI 程式名是 paseo，說明有 138 行上游名字，錯誤沒有改寫；Hub 精靈 6 個案例；直接印出的提示 20 行、CLI 自己寫的產品名 19 行；daemon 訊息 2 個測試和 3 行；登入 shell 的 `~/.paseo` 會滲入，還會蓋掉 App 自己啟動時帶的值；行程名是 `Paseo Supervisor`。
  - 14 種突變都被抓到：安裝狀態改回只看檔案在不在、目標檔名改回 paseo、hooks 不跟 `PASEO_CLI`、OpenCode 外掛改名、改寫規則放寬成任何小寫字、拿掉 `renderError` 的改寫、Hub 停止訊息不改寫、拿掉 `applyCliBrand`、拿掉說明改寫、pair 提示改回、onboard 歡迎詞改回、daemon 訊息改回（兩處）、只丟 `PASEO_HOME`、Daemon 行程名改回。
  - 跑過的測試：protocol 5、CLI 14 檔 86 個、desktop 8 檔 48 個、server 5 檔 41 個；守門測試 cli-name 6、coexistence 5、names 5、help-links 1、update-sources 2、brand-colors 1、relay 2。
  - 沒跑的：CLI 的 e2e（`tests/17-onboard.test.ts` 只改了預期值）和桌面版打包 smoke。沒有實際打包，也沒有在真的 HOME 裡安裝 CLI。
- CLI 改名第二部分，agent 技能（2026-09-25，分支 `woowtech/cli-rename`）：新測試都先紅後綠。
  - 紅燈原因：
    - 只改名、還沒改內容的產出有 78 行指向官方 Paseo（help 25、plugin 26、主技能 19、其他 8）。
    - daemon 的技能清單是上游的 `paseo*`，`woowtech-smart` 沒有裝；開發路徑指向 repo 的 `skills/`；`build:lib` 複製 `../../skills`。
    - 官方舊名被算成已安裝、出現在刪除確認、被解除安裝刪掉，我們自己的舊名反而留著。
    - 儲存時暫存在 `.paseo-skills-transaction-*`；官方中斷的交易讓我們的技能操作失敗（「Cannot safely recover interrupted skills transaction」）。
  - 9 種突變都被抓到：拿掉 6767 的改寫、手改產出、上游改了手寫段落、開發路徑改回、`build:lib` 改回、舊名不經 `brandSkillName`、交易前綴改回、隔離區前綴改回、拿掉 `Paseo Hub` 例外。
  - 跑過的測試：守門 skills 6、cli-name 6、coexistence 5、names 5、help-links 1、update-sources 2、brand-colors 1、relay 2、icons 5；server orchestration-skills 6 檔 99 個（1 個上游原本就 skip）；desktop-packaging 11。
  - 實際跑了 `build:lib` 的複製步驟：worktree 的 `dist/server/skills` 跟 `woowtech/skills` 完全相同。
  - 沒跑的：zh-tw 守門（worktree 沒有裝 `woowtech/tools` 的 OpenCC）；沒有打包桌面版，也沒有在真的 HOME 裝技能。
- CLI 改名第三部分，App 文字和守門（2026-09-25，分支 `woowtech/cli-rename`）：
  - 紅燈原因：10 種語言的「完整狀態」說明都顯示 `paseo daemon status`；設定的命令列那一列找不到 `woowtech-smart`。
  - 突變都被抓到：翻譯不套 `withCliCommand`、指令名只在安裝後顯示。
  - 新的守門檢查先用突變確認會失敗，9 種都被抓到：`createCli()` 不套 `applyCliBrand`、`renderError` 不改寫、`i18next.ts` 不套 `rebrandResources`、安裝目標改回 `paseo`、安裝狀態改回只看檔案在不在、登入 shell 的 `PASEO_HOME` 照單全收、舊名不經 `brandSkillName`、交易前綴改回、desktop 多一句 `Run paseo daemon start`。
  - Hermes 支援 `withCliCommand` 用的 lookbehind：用 RN 0.81.5 內附的 `hermes` 實跑過，字面值和 `new RegExp` 都正確，手機 App 載入翻譯時不會出錯。
  - 跑過的測試：守門全部 40 個（含 zh-tw）；這個分支改過的單元測試 protocol 1 檔 5 個、App 2 檔 11 個、CLI 4 檔 21 個、desktop 3 檔 18 個、server 6 檔 85 個（1 個上游原本就 skip）；完整 typecheck。
  - 守門的桌面版安裝在暫存 HOME 跑，跑完確認真的 `~/.local/bin`、shell 設定檔和三個技能資料夾都沒有多出東西。
  - 沒跑的：CLI 的 e2e 和桌面版打包 smoke（同第一部分）；沒有在瀏覽器或桌面版裡實際看設定頁。
- CLI 改名審查（2026-09-25，分支 `woowtech/cli-rename`）：
  - 發現上游 CLI e2e 還預期 `paseo daemon restart`：`tests/32-daemon-set-password.test.ts` 和 `03-daemon.test.ts`，已改。32 先紅後綠（實跑 3/3），`set-password.ts` 改回上游時再次失敗；03 沒跑。
  - 另外兩項突變確認新測試會失敗：`login-shell-env.ts` 改回上游，`login-shell-env.daemon-target.test.ts` 2/2 失敗；`operations.ts` 改回上游（舊名不經 `brandSkillName`），server 的技能 `coexistence.test.ts` 3/7 失敗。
  - 跑過的測試：守門 10 檔 40 個；分支改過的單元測試 16 檔逐一跑；相關的上游測試（CLI 說明、錯誤輸出、Hub、daemon 指令、i18n、技能、hooks、登入 shell、桌面版 daemon 管理）逐檔跑；完整 typecheck。全部通過。
  - 真實 HOME 檢查過：`~/.local/bin`、shell 設定檔、`~/.agents` 和 `~/.claude` 的技能資料夾都沒有多出東西。
- 驗收發現修正（2026-09-25，分支 `woowtech/fixes`，已合進 main）：新測試都先紅後綠，每一項的突變都被抓到。
  - 紅燈原因：iOS 短名稱是 `$(PRODUCT_NAME)`；更新紀錄 404 得到 `error` 而不是 `empty`；設定頁在繁中仍顯示英文；繁中句子裡的英文名詞 255 個、整句英文 141 個；啟動 agent 的環境漏出 16 個工作階段變數，Pi、OMP 和用 node 執行的 Claude 收到 `CLAUDECODE` 和 `CLAUDE_CODE_MESSAGING_TOKEN`；`build-android.sh` 的 7 個新測試有 6 個紅。
  - 繁中重新產生後改了 404 個值（詞彙 263、整句 141），逐條看過。
  - 獨立審查把正式碼換回 main 版，做了 7 個還原檢查，新測試都失敗、原因正確。審查另外修了 3 項，都先紅後綠：詞彙規則不動檔名和網域、「已連線」、短名稱守門不受舊的 `ios/` 影響。
  - 在暫存副本 prebuild iOS 兩個版本：Info.plist 的 `CFBundleName` 是「woowtech smart」，zh-Hans／zh-Hant 是「渥屋智能」，`PRODUCT_NAME` 不變。
  - 跑過的測試：App 9 檔 70 個；server 相關 9 檔 214 個（1 個 win32 限定的略過）；`build-android.test.mjs` 7 個。合進 main 時完整 typecheck 通過，守門 11 檔 46 個全過。
  - 沒做的：還沒在模擬器或實機上看過這些畫面；還沒從 Claude Code 裡實際啟動 daemon、檢查 agent 拿到的環境。
- 自己的 relay（2026-09-25，分支 `woowtech/services`，第 11 節）：新測試都先紅後綠，每一項都做了突變。
  - Worker 設定：`relay-worker.test.mjs` 先紅（`wrangler.woowtech.toml` 不存在）。突變都被抓到：加上 `PASEO_RELAY_UPSTREAM`、改回上游的帳號和網域、relay 的 e2e 換回上游的設定。
  - relay 的 e2e 在只准連 loopback 的 `sandbox-exec` 裡跑：用上游的 `wrangler.toml` 時，Worker 要轉到 Fly、被擋，60 秒內 WebSocket 起不來；改用 `wrangler.woowtech.toml` 後 3/3 通過，wrangler 列出的綁定只有 `env.RELAY`，log 有 `[Relay DO] v2:server(control) connected`。
  - daemon 預設：config-relay 5 個、persisted-config 1 個、pairing-offer 1 個測試先紅，紅燈是 `expected false to be true` 和 `relay.paseo.sh:443` 不等於 `relay.woowtech.io:443`；3 檔 70/70。突變都被抓到：沒寫 `enabled` 時改回關、新 home 寫回 `false`、改回上游「啟動時沒寫才開」的規則。
  - `daemon-config-store.test.ts` 有兩個上游測試靠新 home 預設關才成立，改成自己寫好狀態後 34/34。config 等 5 檔 59 個相關測試通過。
  - CLI：`pair.relay.test.ts` 對舊的 server dist 紅，`build:server` 後和 `pair.test.ts`、`next-command.test.ts` 共 5/5。用建好的 CLI 在暫存 home、sandbox 裡重跑 e2e 03 的 `daemon pair` 和 `daemon pair --json`：結束碼 0，配對連結指向 `relay.woowtech.io:443`、TLS。
  - 桌面版「停用中繼」：先紅（找不到按鈕）後綠 2/2；突變：拿掉接線、送出 `enabled: true`，都被抓到。i18n 3 檔 20/20。
  - 守門：`relay.test.mjs` 4/4，出貨原始碼的掃描先紅在 `host-picker.tsx:41` 的註解；`skills.test.mjs` 先紅（技能過時、help 沒提 relay.woowtech.io），重新產生後 7/7；`cli-name.test.mjs` 拿掉 relay 的例外後先紅在 `pair.ts:145`。全部守門 53 個通過 52 個，沒過的 zh-TW 守門是 worktree 沒裝 OpenCC。
  - 本機整合（腳本不進 repo）：sandbox 裡、暫存 HOME 和 PASEO_HOME，用 `wrangler dev --local --config wrangler.woowtech.toml` 跑 relay，用建好的 CLI `daemon run` 起 daemon，relay 開關用預設，只用 `PASEO_RELAY_ENDPOINT` 指到本機的 relay。新 home 的 `config.json` 是 `{"enabled":true}`，daemon.log 有 `relay_control_connected`，`daemon pair --json` 結束碼 0，`woowtech-smart --host <配對連結> ls -a --json` 經 relay 和 E2EE 連上 daemon；relay 看到 server(control)、client、server(data) 三條連線。跑了兩次，結果相同。
  - 沒做的：沒有部署，relay.woowtech.io 還沒有 DNS；沒有對真的 relay.woowtech.io 測試；CLI e2e 03 和 17 只改了預期值，沒跑（會連到 relay）；沒有模擬器或實機測試。
- 推播不帶內容（2026-09-25，分支 `woowtech/services`，第 16 節）：新測試都先紅後綠，每一項都做了突變。
  - 紅燈原因，依切片順序：交給 Expo 的推播是「Agent finished」加上回覆內容；權限要求也拿到完成的句子（前一片只做了完成）；terminal 的推播句子不對，還帶著 `cwd`；舊式工作區 ID（資料夾路徑）和自訂的 server ID 照送；語言判斷還不存在；terminal 的推播沒有 `reason`。
  - 到場就綠的（實作先寫了）：中文四種原因、不認得的原因、daemon 照 `LC_ALL` 選語言、本機訊息保留預覽。都用突變確認會失敗。
  - 突變都被抓到：`send()` 直接送原本的推播（12 個測試失敗）、權限當成「需要注意」、`cwd` 放行、工作區 ID 不驗格式、不讀 macOS 系統語言、把 `C` 當成語言、daemon 固定用英文、terminal 推播拿掉 `reason`、新版 App 的 attention 訊息改成通用句子、整個 daemon 不帶預覽。
    本機訊息那一項第一次用舊版 App 的連線測，改 `agent_attention_required` 的突變沒被抓到（舊版 App 走 `agent_stream`），所以改用新版 App 的連線。
  - 守門 `push-content.test.mjs` 3/3。三種突變都讓它失敗：`send()` 直接送原本的推播（中英文兩項，錯誤訊息裡看得到 agent 名稱、回覆、資料夾和工作區名稱）、`push/index.ts` 多一個直接呼叫 `sendPush` 的方法、`data` 原樣送出。
  - 實測語言判斷（這台 Mac 的系統語言是繁中）：shell 的 `LANG=C.UTF-8` 和完全沒有語系變數時都是「渥屋智能」和繁中，讀 `defaults` 約 10 毫秒；`LANG=en_US.UTF-8` 是英文。
  - 跑過的測試：server 4 檔 45 個（`woowtech-push-content` 24、`push/index` 2、`websocket-server.notifications` 7、`websocket-server.terminal-notifications` 12）；守門 `push-content.test.mjs` 3 個。
  - 沒做的：沒有真的送到 Expo，也沒有在手機上看通知和點通知導頁（這次不做實體手機測試）。
- 收尾四項（2026-09-25，分支 `woowtech/services`，第 12、15、17 節）：行為改動都先紅後綠，每一項都做了突變。
  - `onboard` 的框標題：`onboard.home-note.test.ts` 先紅，標題是「woowtech smart home」；改成「Daemon data folder」後 1/1。突變成「woowtech smart home folder」（之前審查建議的寫法）也紅。
  - 終端機環境：`terminal-parent-session-env.test.ts` 先紅，20 個工作階段變數全部進到終端機；綠 1/1，`terminal-cli-env`、Claude hooks 共 13 個也過。突變：終端機的清單拿掉上游四個，紅在 `CLAUDECODE` 等 4 個。守門 `agent-env.test.mjs` 3/3，把 `terminal.ts` 改回上游時紅。
  - daemon 的訊息：守門先紅，列出 20 行；上游測試改了預期值後先紅 7 個（pid-lock 5、wire-compat 1、git-metadata-generator 1）。改完 21/21，`session.test.ts` 的 PR fallback 1/1，守門 7/7。突變：PR 內文改回 Paseo，單元測試和守門都紅。相關的 10 個檔 229 個測試通過（4 個上游原本就略過）。
  - `lifecycle.e2e.test.ts`（第 12 節）：重建 server 和 CLI 的 dist 後跑一次，15 個通過、1 個 Windows 專用的略過，共 216 秒。上一輪驗收失敗的「managed two-home restart」這次通過。在只准連 loopback 的 `sandbox-exec` 裡跑，PATH 只有 node@22 和系統資料夾，沒有 claude、codex、opencode、pi、gemini、hermes，daemon 的可用性探測找不到東西可執行。每個 daemon 都在 `config.json` 關掉 relay（`daemon start` 會拿掉 `PASEO_RELAY_ENABLED` 這類設定用的環境變數），不會連任何 relay。跑完沒有殘留的 daemon 行程和暫存 home。
  - server 的測試、守門和 e2e 都用 `env -i` 的乾淨環境跑，這個 Claude Code 工作階段的變數不會進到測試，失敗時也不會被印出來。
- GitHub Actions（2026-09-25，分支 `woowtech/services`，第 18 節）：守門 `woowtech/workflows.test.mjs` 6 項，都做了突變。
  - 先紅後綠：兩個 Windows job 沒有變數的條件；`ci.yml` 有 push 觸發、沒有排程；`dorny/paths-filter` 沒有排除排程；RPM smoke 移除的是 `paseo`，electron-builder 算出的 deb 名稱是 `io.woowtech.smart.desktop`。
  - 到場就綠：workflow 清單（突變：多一個 `preview-deploy.yml`，紅）；不部署不發佈（突變：加一步讀 `secrets.CLOUDFLARE_API_TOKEN`、typecheck job 要 `contents: write`，都紅）。
  - 其他突變：拿掉桌面版 Windows job 的條件、加回 push 觸發、paths-filter 的條件改成排除手動、dpkg 改回 `paseo`，都紅。
  - 上游的 `scripts/ci-workflow.test.mjs` 8/8 沒改，CI 第一個 job 跑的三個 node 測試 27/27。全部守門 64 個通過 63 個，沒過的 zh-TW 守門是 worktree 沒裝 OpenCC。
  - 沒做的：Actions 還沒打開，沒有在 GitHub 上跑過，分鐘數是估計的。排程事件會讓 paths-filter 失敗，是照它讀事件內容的方式推斷的，沒有實際看過。Linux 的 dpkg、rpm 步驟在這台 Mac 上跑不了。
- `woowtech/services` 獨立審查（2026-09-25）：逐項對照 owner 的決定和程式，沒有發現行為上的問題。
  - 還原檢查：把正式碼換回 main 版，新測試都失敗、原因正確，換回後工作區乾淨。
    - `push/index.ts`：`woowtech-push-content` 11 個、`websocket-server.notifications` 1 個、守門 `push-content` 2 個失敗，送出的是「Agent finished」和 agent 的回覆。
    - `terminal.ts`：`terminal-parent-session-env` 失敗，20 個工作階段變數進到終端機。
    - `config.ts`、`persisted-config.ts`、`pairing-offer.ts`：`config-relay` 5 個、`persisted-config` 1 個、`pairing-offer.relay` 1 個、守門 `relay` 3 個失敗（`false` 不等於 `true`，`relay.paseo.sh:443` 不等於 `relay.woowtech.io:443`）。
    - `pair-device-section.tsx`：「停用中繼」的 2 個測試找不到按鈕。
  - 跑過的測試，都用 `env -i` 的乾淨環境、一次一個檔：server 13 檔 324 個、CLI 4 檔 6 個、App 4 檔 22 個；relay 的 e2e 在只准連 loopback 的 sandbox 裡 3/3，綁定只有 `env.RELAY`；CI 第一個 job 的三個 node 測試 27/27；完整 typecheck 通過。
  - 守門 64 個通過 63 個。沒過的 zh-TW 守門是 worktree 沒裝 OpenCC；產生器只讀 `zh-CN.ts` 和 `en.ts`，這個分支都沒動。
  - 沒跑的：`lifecycle.e2e.test.ts`，收尾任務在最後一次改它、重建 dist 之後跑過（15 通過、1 略過），`resolvePaseoHome({})` 的資料夾名稱確認是 `.woowtech-smart`；CLI e2e 03 和 17，會啟動真的 daemon 並連 relay。
  - 順手改的：`03-daemon.test.ts` 開頭的說明還寫著沒同意就不產生配對連結；第 11 節補上關掉 Workers Logs 時守門要一起改。
- 推播走 WoowTech 的推播中繼，protocol 和 daemon（2026-09-25，分支 `woowtech/push`，第 16 節）：新測試都先紅後綠；一到場就綠的都用突變確認會失敗。
  - 紅燈原因，依切片順序：`encodePushToken` 收下 `zh-CN`；`validateRelayNotifyBody` 不存在；server_info 的 `woowtechPush` 被 zod 剝掉；`woowtech-relay.ts` 不存在；Expo token 沒撤銷；同一支手機送兩次；410 沒撤銷；503 沒重試；連線被切、連不到時 `fetch failed` 直接丟出；中繼不回應時卡到測試逾時（30 秒）；400、403、413、429、502 沒有 log；debug 沒有手機的雜湊；沒注入 `deliver` 時推播打到 `https://exp.host/--/api/v2/push/send`；daemon 的 server_info 沒有 `woowtechPush`。
  - 沒注入 `deliver` 的那個紅燈會真的打 Expo，所以用只准連 loopback 的 `fetch` 當安全網跑（`NODE_OPTIONS=--import`，先用 `.invalid` 網址確認它在 vitest 的 fork 裡有效）。紅燈時被擋下的就是 `exp.host`，沒有任何請求離開本機。
  - 上一個工作階段留下的 P1 草稿（18 個測試）用 7 種突變確認：切最後一個冒號、上限改回 4096、UUID 不分大小寫、agent 和 terminal 都留、只認 `zh-TW`、`reason` 原樣送、不要求冒號，都被抓到。
  - 其他突變都被抓到：fixture 那幾組（agent 和 terminal 都留、送出 `title`、`error` 原樣送、ID 順序改變、App 端上限改回 4096）；送出器帶上 `title` 和 `cwd`；拿掉 store 撤銷失敗的保護；守門那邊把 `push/index.ts` 換回 main 版（預設送 Expo），守門 4/4 失敗。
  - 跑過的測試：protocol 3 檔 186 個（`woowtech-push` 151、`messages` 25、`ws-outbound` 10）；重建 server 的 dist 之後，server 7 檔 93 個（`woowtech-relay` 19、`woowtech-push-content` 24、`push/index` 2、`token-store` 3、`websocket-server.notifications` 8、`websocket-server.terminal-notifications` 12、`websocket-server.relay-reconnect` 25）；守門 65 個全過（`push-content` 4，zh-TW 守門也過）；每個 commit 的完整 typecheck。
  - 兩個 package 的測試檔不在 typecheck 範圍，新測試檔另外用 `tsc` 檢查過，沒有錯誤。
  - 沒做的：沒有連真的 push.woowtech.io（還沒部署）；沒有實機；App 端還沒做。
- 推播，App 端（2026-09-25，分支 `woowtech/push`，第 16 節）：
  - iOS 建置探路（分支 `woowtech/push-ios-spike`，cherry-pick 進來）：設計首選的 SPM 加 dynamic frameworks 在 `pod install` 就失敗（ExpoModulesCore 是 static library）；CocoaPods、static、`forceStaticLinking` 在模擬器建置成功（xcodebuild 19 分鐘，137 個 pod），App 能啟動，log 裡沒有 Google、Firebase、APNs 或 Expo 的主機。paste-input 的 bridging header 要 static，是建置前看產生的專案時發現的。
  - 新測試都先紅後綠：本分支 App 新增 8 檔 46 個測試，連同相關的舊測試 36 檔 178 個通過。突變都被抓到：拿掉 `woowtechPush` 閘門、先撤銷再註冊、權限被拒時撤銷、語言訂閱、token 更新訂閱；autolinking 拿掉 `ios = null`、拿掉展開套件設定、拿掉外掛的 plist 判斷；點擊資料改讀巢狀的 `body`。
  - autolinking CLI：有 plist 時 iOS 18 個模組（含 RNFB 兩個和「[RNFB] Core Configuration」），變數指向不存在的檔時 16 個；Android 三種情況都是 16 個，跟 main 一樣。`expo config --type prebuild` 兩個變體的 plist、外掛和 build properties 都正確。
  - Metro 追蹤（從 `fcm-token.ios.ts` 出發）：包裝前 iOS 會拉進 Firebase JS SDK 6 個檔（約 147 KB 原始碼），包裝後 0 個。
  - 沒做的：實機（FCM token、推播顯示、點擊導頁、權限提示的時機）、真正的 iOS bundle 和 IPA 大小。
- 推播的守門（2026-09-25，分支 `woowtech/push`，第 16 節）：`woowtech/push.test.mjs` 6 項，在乾淨環境（`env -i`、Node 22）和只准連 loopback 的 `sandbox-exec` 裡跑。每一項都用突變確認會失敗，每次只改一個地方，改完用 sha256 確認還原：
  - `push/index.ts` 換回 main 版（上游的 Expo 送出器）：請求打到 `https://exp.host/--/api/v2/push/send`，被守門的 `fetch` 在本機接住，沒有請求離開本機。
  - 送出器的本文多帶 `data`：紅在四個欄位；再讓 `send()` 不經 `toRemotePushPayload`：紅在 `cwd`；再帶上標題和內文：紅在標題。只拿掉 `toRemotePushPayload` 時照樣綠，送出器本身只送四個欄位。
  - `websocket-server.ts` 拿掉 `woowtechPush: true`、`messages.ts` 拿掉 schema 的欄位：都紅。
  - `index.native.ts` 換回 main 版、`host-runtime.ts` 多一行引用上游的 `subscriptions.ts`、`woowtech-subscriptions.ts` 多一行 `getExpoPushTokenAsync`：都紅。
  - `react-native.config.js` 清空，或讓它丟錯（autolinking 會當成沒有設定）：紅在 Android；拿掉 `ios = null`：紅在沒有 plist 的 iOS；`platforms` 只寫 `android: null`：紅在 build phase。
  - fixture 移走：紅；FCM token 的上限改回 4096：紅在 513 字元的案例。
  - knip：`npm run knip` 在 Expo 外掛當掉（main 也一樣），所以分 workspace 跑。改 `knip.json` 之前，server 報 `push-service.ts` 的 `PushService` 沒人用，App 報 `subscriptions.ts` 是沒用的檔；改了之後兩個都不報，其他結果不變。
- 配對連結直接叫起 App（2026-09-25，分支 `woowtech/pairing-scheme`，第 19 節）：行為改動都先紅後綠，到場就綠的都用突變確認會失敗。
  - 紅燈原因，依切片順序：新 home 和沒給 `app.baseUrl` 的連結開頭是 `https://app.paseo.sh/`；寫著上游預設（兩種寫法）的 home 和重新載入後照用上游網址；CLI 的 `daemon pair` 對舊的 server dist 也是 `https://app.paseo.sh/`；「貼上配對連結」的範例是 `https://app.paseo.sh/#offer=...`；新 home 的 CORS 白名單有 app.paseo.sh，daemon 對它回 CORS 標頭；守門的出貨原始碼掃描紅在 `onboard.ts:123` 和 `connection-offer.ts:49` 的註解。
  - 到場就綠的：消費端（`OfferLinkListener` 用的匯入、掃描器、「貼上配對連結」、protocol 的解析、CLI 的遮罩）本來就只找 `#offer=`；自己設的 `app.baseUrl` 和 `PASEO_APP_BASE_URL` 照用；dev 的 CORS 設定。突變都被抓到：只收 https 連結（protocol、貼上、掃描）、用 URL 類別讀 fragment（host-runtime、貼上、掃描）、CLI 不遮 fragment、遷移改成整個上游網域、一律用預設、忽略 `PASEO_APP_BASE_URL`、拿掉桌面版的固定來源、固定清單加回上游網頁版。
  - 守門 `pairing.test.mjs` 5 項，11 種突變都被抓到（列在第 19 節），每次只改一個地方，改完用 `cmp` 確認還原。
  - 跑過的測試，都用 `env -i` 的乾淨環境、一次一個檔、`npm run build:server` 之後：server 18 檔 193 個（含 `bootstrap.smoke` 22、`websocket-server.origin` 4）、CLI 10 檔 24 個、App 6 檔 91 個（`host-runtime.test.ts` 72）、protocol 3 檔 13 個；守門 `node --test woowtech/*.test.mjs` 69/69；完整 typecheck。
  - 在這台 Mac 上確認過：`expo config --type introspect` 的正式版和 Debug 版，iOS 的 `CFBundleURLSchemes` 和 Android `MainActivity` 的 VIEW + BROWSABLE intent filter 都有 `woowtech-smart`；expo-router 把 `woowtech-smart:///#offer=…` 對到空路徑（index）。
  - 沒做的：沒有模擬器或實機測試（相機掃描、`simctl openurl`、`adb shell am start`），沒有實際啟動 6770 的 daemon，CLI e2e 沒跑。已存在的 home 的 CORS 白名單沒有遷移。
- 合併配對連結分支，推播分支的完整驗證（2026-09-25，分支 `woowtech/push`）：
  - 合併 `woowtech/pairing-scheme`（`0724aa586`）：只有這份 README 的驗證紀錄衝突，兩邊加的條目都留。
  - `npm run build:server` 重建 protocol、client、server、CLI 的 dist 之後：守門 `node --test woowtech/*.test.mjs` 16 檔 76/76；這個分支改過的 22 個 vitest 檔逐檔跑，357 個全過（App 12 檔 124、CLI 2 檔 3、protocol 3 檔 179、server 5 檔 51）；第 16 節「合併上游之後」的三條 vitest 指令照寫的跑也全過；完整 typecheck 通過。守門和測試都在乾淨環境（`env -i`、Node 22）和只准連 loopback 的 `sandbox-exec` 裡跑。
  - `npm run lint` 有 3 個錯、`npm run format:check` 有 2 個檔不過，都在這個分支沒動的檔：`woowtech/png.mjs`、`woowtech/tools/generate-icons.mjs` 和上游的 `packages/server/src/server/agent/providers/test-utils/echo-client-info-acp-agent.mjs`。這些檔、`.oxlintrc.json`、`.oxfmtrc.json` 和兩個工具的版本都跟 main 相同，main 上一樣不過。這個分支改過的 58 個檔 lint 和排版都乾淨。
  - 契約 fixture 跟中繼 repo 的仍相同（中繼 `smart-mode` 已到 `dff78a1`，fixture 從 `3363c60` 之後沒改）。

## 接下來

- 第一次正式發佈：建立公開的 `WOOWTECH/woowtech-smart-releases`，並完成 Developer ID 簽章與公證。沒有簽章，macOS 的自動更新無法運作。
  發佈 repo 要放 `CHANGELOG.md`，App 的更新紀錄才讀得到。
- 桌面版的版權行還是上游作者：electron-builder 預設用 `package.json` 的 author，會出現在 macOS 的「關於」視窗。
  `author`、`homepage`、`repository` 由 `scripts/sync-workspace-versions.mjs` 從根目錄的 `package.json` 同步，發佈前要決定怎麼標示。
- 品牌識別：CLI（第 12、13 節）和 daemon 自己的訊息（第 17 節）都改完了。刻意保留上游名稱的列在第 17 節；企業版裝回本地語音時，語音模式給 agent 的指示（`voice-config.ts`）要一起改。
- CLI 改名合回 main 之後：
  - 重建 server 的 dist，跑 CLI 的 e2e（`tests/17-onboard.test.ts`、`03-daemon.test.ts`）和桌面版打包後的 smoke。`src/commands/daemon/lifecycle.e2e.test.ts` 已在 `woowtech/services` 跑過（驗證紀錄）。
  - 在桌面版實際按「安裝 CLI」和安裝技能（用測試帳號或暫存 HOME），確認 `~/.local/bin` 和三個技能資料夾只多出 `woowtech-smart*`，設定的命令列那一列顯示 `woowtech-smart`。
- iOS 相機、相簿的權限提示仍用 `$(PRODUCT_NAME)`（Debug 版顯示成 woowtechsmartDebug），而且只有英文。要不要改成品牌名並加上中文，還沒決定。
- 盤點設定頁以外上游寫死的英文，照第 14 節的做法一頁一頁處理。
- 用詞待決定：
  - 28 處仍用「主機」指 daemon（例如新增主機、切換主機、此主機離線），其他 87 處用「Host」。
  - PR 狀態 open 的「開啟」讀起來像動作，建議改「開啟中」（目前沒用到這個 key）。
  - 腳本網址的「好記網址」和「直接位址」建議統一用「網址」。
- 更新紀錄：HTTP 200、內容卻不是 changelog 時（例如會攔截 TLS 的公司 proxy 回的封鎖頁），現在顯示「還沒有釋出說明」，沒有重試按鈕。要不要跟 404 分開處理，還沒決定。
- 第 15 節「還沒處理的」兩項（`GIT_EDITOR`、其他 agent 宿主的變數）要不要處理，還沒決定。終端機的環境已處理。
- 在模擬器上確認：英文系統的主畫面標籤、「新功能」的空狀態、繁中的設定頁和側欄。
- 部署 relay.woowtech.io（第 11 節），部署後照第 11 節檢查，再發佈這個分支的版本；部署前發佈的話，daemon 會一直重試連不上的 relay。
- 配對連結直接叫起 App（第 19 節）的實機驗收：iOS 和 Android 的相機掃 QR Code、`xcrun simctl openurl`、`adb shell am start`，冷啟動和 App 已開著各一次；沒裝 App 時掃描的反應；桌面版點連結不會有反應。Android 相機叫不起 App 時，照第 19 節的「取捨」決定要不要改成在我們網域放一頁。
- 已存在的 home 的 `config.json` 還在 CORS 白名單列著 `https://app.paseo.sh`，要不要自動拿掉，還沒決定（第 19 節）。Hub（`hub.paseo.sh`）仍是上游的。
- 之前內部測試版建立的 home 寫著 `daemon.relay.enabled: false`，要不要遷移成開，還沒決定。
- 推播（第 16 節）：protocol、daemon、App 和守門都做完了（分支 `woowtech/push`），接下來：
  - 部署中繼的 smart 模式和 push.woowtech.io（步驟在中繼 repo）。新版 App 註冊 `wsp1:` 字串之前，daemon 不會發出任何推播請求；之後、中繼部署之前，推播會在連不上或逾時、重試一次後被丟棄。
  - 通知用字寫在中繼的 `smart-messages.js`，請 owner 確認。
  - 兩個平台都用實機驗收（設計 6.6）：
    - 通知只顯示中繼的句子，點下去開到那個 agent 或 terminal，App 在背景和被滑掉各試一次；換語言後只收到一則新語言的通知；解除安裝後中繼回 410、daemon 刪掉那筆；桌面版的系統通知仍有回覆預覽。
    - iPhone 上 `registerDeviceForRemoteMessages` 會回來（RNFB 和 `expo-notifications` 都接了 AppDelegate）；TestFlight 版（production APNs）和 Xcode 裝的開發版（sandbox）都拿得到 token。
    - 把 App 滑掉再重開：第二次啟動時 daemon 的 log 又出現「Registered push token」，裝置 log 沒有「No FCM token on this device」。48 小時後仍收得到推播。
    - 通知權限只在連上 woowtech smart 的 daemon 時才問。
    - 從呼叫過 `getExpoPushTokenAsync` 的舊測試版升級後，第一次啟動會不會把 device token 送到 exp.host 一次：`expo-notifications` 在 import 時跑的程式可能搶在我們關掉之前。
    - 打一次真正的 iOS bundle，確認裡面沒有 `@firebase/app`，並量 IPA 大小的差距。
  - 待決定：
    - 手動分兩步跑 prebuild 和 `pod install` 時，要不要讓 `react-native.config.js` 也看 prebuild 產生的 `ios/` 裡有沒有 plist，而不只看環境變數。
    - F-Droid 版的 `expo-notifications` stub 要不要補上 `setAutoServerRegistrationEnabledAsync`、`getDevicePushTokenAsync`、`addPushTokenListener`。程式已經能處理沒有它們的情況（記 warn 或拿不到 token）。
    - Firebase 在 2026 年 10 月以後不再發到 CocoaPods，要停在最後一版，還是規劃回到 SPM。
    - EAS 的上游專案值要保留還是拿掉（第 1 節）。
- 打開 GitHub Actions：照第 18 節的步驟設定權限、停用 10 個 workflow，手動跑一次 CI，用實際的分鐘數和結果（桌面版 job 的 30 分鐘上限、Playwright 的 120 秒打包）更新第 18 節。
  打開之前先修好 main 上既有的 lint 和排版問題（`woowtech/png.mjs`、`woowtech/tools/generate-icons.mjs`、上游的 `echo-client-info-acp-agent.mjs`，見驗證紀錄），否則 CI 的 format 和 lint job 會紅。
- 商標（TIPO）與 D-U-N-S。
