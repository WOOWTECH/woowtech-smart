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

  推播、T1 通知導頁和配對連結另外要跑的單元測試，分別列在第 16 節的「合併上游之後」和第 19 節的「上游合併後要再確認」。

  只挑需要的修正時，照「上游同步紀錄」的做法，並在那一節記下拿了什麼、沒拿什麼。

- 改動原則：新程式放新檔案，接點只改上游很少動的檔案。上游每週大約有 100 個 commit，下面這幾個是熱檔，盡量別碰：
  `packages/server/src/server/agent/providers/claude/agent.ts`、`packages/server/package.json`、`packages/server/src/server/bootstrap.ts`。
- GitHub Actions 只開 CI、只跑 Ubuntu 上的測試，其他 10 個上游 workflow 在 GitHub 停用。Playwright 只在手動觸發並勾選時跑。typecheck job 也跑 `woowtech/*.test.mjs` 守門。理由、打開的步驟、前兩次執行的結果和修正見第 18 節。

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
  2. 否則讀 `$PASEO_HOME/runtime-deps/claude-agent-sdk-<版本>.json` 指向的同版本 generation；沒有 pointer 時仍相容舊的 `claude-agent-sdk-<版本>/` 目錄。
  3. 沒有可載入副本，才從 npm registry 或鏡像下載；sha512 對不上就拒絕。下載約 1.33 MB，解壓後約 4.6 MB；首次等待時間取決於網路。
- 受管理副本缺檔、語法錯誤或初始化失敗時，只把選中的副本移到同層 quarantine，重新下載一次。新副本用獨立實體 generation 目錄，完整性驗證與真正 import 成功後才原子更新 pointer，避免 Node 把舊 entry／相對依賴的失敗快取帶回來。local/dev SDK 的其他載入錯誤不自動修復。
- pointer 只接受同版本、合法 UUID 的 basename；格式錯誤、越界或含符號連結的路徑安全拒絕。失敗時清自己的 partial／未發布副本，不刪其他 generation 或整個 runtime-deps；舊副本與 quarantine 不自動回收。這是路徑檢查，不是防同權限惡意程序競態的檔案系統沙箱。
- `claudeQuery()` 必須立刻回傳 Query，所以 SDK 還沒載入時，它會先回傳 `DeferredQuery`（`deferred-query.ts`）。
  Query 的每個方法都寫明轉發，SDK 升版改了介面時會直接編譯失敗，不會默默漏掉某個呼叫。
- Claude 本身一律使用使用者自己安裝的 `claude`，這是上游原本的設計，SDK 內附的執行檔用不到。
- 找 `claude` 的順序：
  1. 使用者在 `agents.providers.claude.command` 手動指定的指令一律優先，解析方式跟上游一樣，不看下面兩步：找不到就顯示不可用，不會改用別的 `claude`。指令寫的是 `claude` 這個名字時也只找 PATH；要在 Dock 啟動的桌面版加自訂參數，請寫絕對路徑。
  2. daemon 的 PATH：`which -a claude`，每個候選各跑一次 `--version`（2 秒逾時），跟上游一樣。
  3. PATH 沒有可用的 `claude`，才依序試 `~/.local/bin/claude`、`~/.claude/local/claude`、`/opt/homebrew/bin/claude`、`/usr/local/bin/claude`。`~` 是 daemon 環境的 home（`os.homedir()`）。
  - 原因：桌面版從 Dock 啟動時用的是登入 shell 的 PATH，裡面不一定有 `~/.local/bin`，而 Claude Code 的原生安裝程式把 `claude` 放在那裡。
  - 備援位置只算存在、可執行、不是資料夾的檔案，也要通過同樣的 `--version`。符號連結指向的檔案也算：原生安裝程式的 `~/.local/bin/claude` 就是指向版本資料夾的連結。回傳連結本身的路徑，Claude Code 更新換版後照樣有效。
  - PATH 查詢本身出錯（不是找不到）時照上游拋出錯誤，不改試備援位置。Windows 不套用備援位置（不在 v1）。
  - 寫在 fork 檔 `packages/server/src/executable-resolution/woowtech-claude-fallback.ts`。接點只有上游 `provider-launch-config.ts` 的 `checkProviderLaunchAvailable`（+4／-2 行）：呼叫端沒給 launch default、指令是預設的 `claude` 時補上備援。Claude 的可用狀態、診斷、版本和啟動都經過這裡；其他 provider 和熱檔 `agent.ts` 都沒動。
  - 測試：`woowtech-claude-fallback.test.ts` 在暫存目錄模擬 home、PATH 和 `/opt/homebrew`、`/usr/local`，不碰真的 home，也不執行真的 `claude`：四個位置各自、前面的位置優先、PATH 優先、手動指令優先（也不會改用備援）、不可執行／資料夾／`--version` 失敗的檔案跳過、原生安裝程式的連結、都沒有時找不到、Windows 不套用。守門 `woowtech/claude-executable.test.mjs` 把 HOME、PATH 指到暫存目錄，從原始碼確認 Claude provider 真的找得到 `~/.local/bin/claude`、版本由那個檔案回報，手動指令照舊；上游改寫 `checkProviderLaunchAvailable` 或 Claude provider 改傳自己的 launch default 時會失敗。
  - 上游測試 `provider-availability.test.ts` 的「Claude reports unavailable when the default command cannot be resolved」原本只把 PATH 指到空資料夾，現在也把 HOME 指過去（+8 行）。`/opt/homebrew/bin`、`/usr/local/bin` 沒辦法用環境變數隔開：在那裡裝了 `claude` 的機器上，這個上游測試會找到它、執行它的 `--version` 而失敗。
- 登入狀態：設定頁的供應商列表（App、桌面版）和 Claude 的診斷會顯示 Claude 的登入狀態。**只顯示，不擋**：可用狀態（ready）、`isAvailable` 和建立 Agent 都不看它。有些 API 設定偵測不到，擋下來反而錯。
  - 判斷順序照 Claude Code 的認證優先序（code.claude.com/docs/en/authentication）。先看 provider 的有效環境：daemon 的環境加上 provider 設定的 `env`，值是空字串等於沒設。環境決定不了，才執行 `claude auth status`（5 秒逾時）：

    | 偵測到的                                                       | 狀態                      | 設定頁（zh-TW／英文）                                                                                                                              |
    | -------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `CLAUDE_CODE_USE_BEDROCK`／`VERTEX`／`FOUNDRY` 為真            | unknown                   | 可用 · 無法確認登入狀態／Login status unknown                                                                                                      |
    | `ANTHROPIC_AUTH_TOKEN`                                         | configured                | 可用 · 已設定 ANTHROPIC_AUTH_TOKEN／ANTHROPIC_AUTH_TOKEN is set                                                                                    |
    | `ANTHROPIC_API_KEY`                                            | configured（api_key）     | 可用 · 使用 API key（按用量計費），不是 Claude 訂閱／Uses an API key (billed per use), not a Claude subscription                                   |
    | `CLAUDE_CODE_OAUTH_TOKEN`                                      | configured                | 可用 · 已設定 CLAUDE_CODE_OAUTH_TOKEN／CLAUDE_CODE_OAUTH_TOKEN is set                                                                              |
    | `ANTHROPIC_PROFILE`，或聯邦的兩個變數都有                      | unknown                   | 可用 · 無法確認登入狀態                                                                                                                            |
    | 登入狀態 `loggedIn:false`                                      | needs_login               | **需要登入**（警告色）· 請在主機上執行 claude auth login，或設定 API key。／Login required · Run claude auth login on the host, or set an API key. |
    | claude.ai 登入、有方案、沒有 API key                           | signed_in（subscription） | 可用 · 已使用 Claude 訂閱登入／Signed in with a Claude subscription                                                                                |
    | Claude 設定檔裡的 API key（`apiKeySource: ANTHROPIC_API_KEY`） | configured（api_key）     | 同上面的 API key                                                                                                                                   |
    | apiKeyHelper、雲端供應商（`third_party`、非 firstParty）       | unknown                   | 可用 · 無法確認登入狀態                                                                                                                            |
    | Claude 設定檔裡的 token（`oauth_token`）                       | configured                | 可用 · 已設定認證資訊／Credentials are set                                                                                                         |
    | 其他已登入（例如 Console 的 API key、沒有方案資訊）            | signed_in                 | 可用 · 已登入／Signed in                                                                                                                           |
    | 找不到 `claude`、逾時、被中止、輸出不是 JSON                   | unknown                   | 可用 · 無法確認登入狀態                                                                                                                            |

  - 先看環境變數的原因：Agent 用的非互動模式只要有 `ANTHROPIC_API_KEY` 就一定用它，即使同時登入了訂閱；這時 `claude auth status` 仍回報 claude.ai 登入。
  - 不外洩：`claude auth status` 的輸出含帳號 email 和組織。程式只把固定欄位分類成上表的狀態，診斷、snapshot、log 和錯誤訊息都不帶原始輸出、email、key 或 token；變數只寫名稱。
  - 更新時機：跟著供應商重新整理（daemon 啟動、在供應商視窗按重新整理或重新跑診斷）。在主機上登入後要按一次重新整理；不另外監看登入檔。
  - 偵測不到、會顯示成別的：同時設了 `CLAUDE_CODE_OAUTH_TOKEN` 和 apiKeyHelper 時，Claude 用 apiKeyHelper，這裡顯示「已設定 CLAUDE_CODE_OAUTH_TOKEN」；Anthropic 的 active profile（`~/.config/anthropic`）和企業的 Claude apps gateway 不讀，gateway 使用者設了 `ANTHROPIC_API_KEY` 時會看到 API key 那一行。都只影響說明文字，不影響能不能用。
  - protocol：provider snapshot 的 entry 多一個選填欄位 `auth: { state, method? }`（fork 檔 `packages/protocol/src/woowtech-provider-auth.ts`，接到 `messages.ts`、`agent-types.ts` 各 +3 行）。兩個值在線上都是字串：App 遇到之後才加的值，顯示成「無法確認登入狀態」，不會整份 snapshot 解析失敗。舊 App 收到新 daemon 的 entry 會略過這欄；新 App 連舊 daemon 沒有這欄，照舊顯示「可用」。
  - 其他接點：
    - server：`AgentClient` 多一個選填的 `getAuthStatus`（`agent-sdk-types.ts`）；`provider-snapshot-manager.ts` 在 provider 可用後跟 `fetchCatalog` 同時讀（fork 檔 `server/agent/woowtech-provider-auth.ts`，失敗一律當沒有，只抄 `state`、`method` 兩欄）；`provider-registry.ts` 的包裝 client 轉接它（+2 行），所以繼承 Claude 的自訂 provider 讀自己的 `env`。
    - Claude：分類寫在 fork 檔 `providers/claude/woowtech-auth.ts`，機器 I/O 走 `woowtech-auth-io.ts`（測試換成假的）。熱檔 `agent.ts` 改了三處：`getDiagnostic` 的 Auth 行改用 fork 檔、刪掉上游把 `auth status` 原始輸出串進診斷的 `resolveClaudeAuth`、多一個 `getAuthStatus`。合併上游時如果上游又改回原始輸出，保留 fork 的版本。
    - App：`screens/settings/providers-section.tsx` 只在 provider 啟用且 ready 時套用（+34／-7 行）；文字與判斷在 fork 檔 `woowtech-provider-auth.ts`、`woowtech-provider-auth-detail.tsx`，文案在 `i18n/woowtech-copy.ts` 的 `claudeAuth`（只譯繁中，其他語言用英文）。CLI 的 `provider ls` 沒改。
      - 手機（compact）的列不畫狀態文字，只有圓點，所以名稱下一行在需要登入時以狀態開頭（「需要登入：請在主機上執行 claude auth login，或設定 API key。」／「Login required: …」）；圓點有無障礙文字（需要登入時是「需要登入」，其他狀態是下一行那句，例如「已使用 Claude 訂閱登入」）；整列的無障礙名稱也接上下一行（「Claude 供應商詳情，需要登入：…」）。
      - 原因（integ0929 iOS、Android 驗收）：手機畫面和無障礙樹都看不到「需要登入」。VoiceOver 把整列當成一個按鈕，只念它的名稱，裡面的圓點和說明都不在無障礙樹裡，所以狀態也要放進列的名稱。桌面寬的列不變。
  - 測試（都不執行真的 `claude`、不讀真的 `~/.claude`，也不看跑測試那台機器的環境變數）：
    - `providers/claude/agent.woowtech-auth.test.ts`：假的 `claude auth status` 含 email、org 和像 key 的字串，逐一驗證上表每個狀態的診斷行和 `getAuthStatus`、環境變數的優先序（含 API key 優先於訂閱）、空字串覆蓋、旗標為 0，以及診斷和結果都不含那些字串（斷言只印布林值）。
    - `server/agent/woowtech-provider-auth.test.ts`：snapshot 帶 `auth` 且仍是 ready、需要登入時 `validateAgentConfiguration`／`resolveCreateConfig` 照常通過、讀取失敗時仍 ready 且沒有這欄、不可用的 provider 不讀、重新整理後更新、繼承 Claude 的自訂 provider 與加了模型的 Claude 都讀得到。
    - `protocol/src/woowtech-provider-auth.test.ts`：新 App 保留、舊 daemon 沒有、舊 App 略過、之後才加的值、compact 編解碼、App 實際用的 generated validator。
    - App：`woowtech-provider-auth.test.ts` 用真的翻譯檢查 zh-TW、英文每個狀態的標籤、顏色和說明；`woowtech-provider-auth-row.test.tsx` 實際 render 供應商列表（zh-TW、英文），確認需要登入、token、API key、訂閱、未知和舊 daemon 的列；手機的列另外確認下一行、圓點的無障礙文字和整列的無障礙名稱，寬的列圓點沒有無障礙文字。

- 升級 SDK 時，這三個地方要一起改：
  - `CLAUDE_AGENT_SDK_VERSION`
  - `CLAUDE_AGENT_SDK_INTEGRITY`，用 `npm view @anthropic-ai/claude-agent-sdk@<版本> dist.integrity` 取得
  - `packages/server/package.json` 的 devDependency
- 不要開 TypeScript 的 `verbatimModuleSyntax`。一開，`agent.ts` 的 `import { type … } from "@anthropic-ai/claude-agent-sdk"` 會被編譯成 `import {} from …`，SDK 又變回啟動必要的相依套件，沒裝的話 daemon 會起不來。
- 第一次使用需要連到 npm registry 或設定的鏡像站。失敗不快取：不論用哪個模型，同一段對話的下一則訊息就會重新下載，不必重開對話，也不會自動重送失敗的訊息。下載連同讀取 body 的總逾時是 120 秒。
  - SDK 還沒載入時，對話的 Query 是 `DeferredQuery`；載入失敗後，它的每個呼叫都只會重複同一個失敗。熱檔 `agent.ts` 的 `ensureQuery()` 遇到這種 Query（`query.ts` 的 `claudeQueryLoadFailed()`）就換一個新的，新的會再向 daemon 的 SDK 來源要一次（+4 行，import 多一個名稱）。
  - 原因（integ0929 桌面驗收）：支援 fast mode 的模型，包括預設的 Opus 5.5（fast mode 關著也一樣），建 Query 時要先等 `applyFlagSettings`，載入失敗就在那裡浮現，失敗的 Query 卻留在對話上：下一則訊息沒有任何網路請求就以同一個錯誤失敗，第三則才重新下載。App 在第一則訊息前查 slash 指令或改權限模式時，也會先碰到失敗，情況相同。
  - 測試 `woowtech-claude-sdk-retry.test.ts`：假的 SDK 來源第一次載入失敗、之後成功。沒有指定模型、Sonnet 5、Opus 5.5（fast mode 關／開）、先查指令或改模式，以及經過 AgentManager 的 Opus 5.5，都要第二則訊息就成功、只載入兩次、不重送第一則。
- App 對 loader 自己的完整錯誤格式提供繁中提示（其他語言顯示英文），說明首次需要下載、來源無法連線，以及下一則訊息會重試；完整性與安裝失敗各有自己的提示。不翻一般 Agent 輸出或未知錯誤，也不把原始 URL、代理認證或 cause 帶進新提示。
  - daemon 把失敗的 turn 寫進時間軸時是一則 Agent 訊息：`[System Error] <錯誤>`（上游 `agent-manager.ts`）。時間軸（熱檔 `agent-stream/view.tsx` 的 `renderAssistantMessageItem`，+4 行）遇到整則剛好是 `[System Error] ` 加上完整自有格式時，改用錯誤通知顯示翻譯後的提示；error notification 本身也照舊翻譯（`utils/claude-sdk-error.ts`）。其他 `[System Error]`、多帶 code 或診斷的訊息照原文顯示。複製按鈕仍複製原文，回報問題時看得到錯誤代碼。
  - 原因（integ0929 桌面驗收）：原本只接在錯誤通知，失敗的 turn 不走那裡，桌面版時間軸一直顯示英文原文。
  - 測試：`utils/claude-sdk-error.test.ts` 用 App 的 reducer 和 i18n 確認 daemon 那一則在 zh-TW、英文顯示的文字，以及不該翻的訊息；`woowtech-claude-sdk-retry.test.ts` 釘住 daemon 經 AgentManager 寫出的那一則；守門 `woowtech/claude-sdk-error-display.test.mjs` 檢查 `view.tsx`、`message.tsx` 的接點，合併上游時接點被拿掉就會失敗。
- 公司網路設定（只影響 SDK 下載，不更換 daemon 的全域 dispatcher）：
  - `https_proxy`／`HTTPS_PROXY`、`http_proxy`／`HTTP_PROXY`：小寫優先；HTTPS 沒有專用代理（或設為空字串）時使用 HTTP 代理。代理 URL 可含認證，錯誤不回傳 URL、headers 或原始網路錯誤。
  - `no_proxy`／`NO_PROXY`：小寫優先（含空字串），支援主機、主機加 port、子網域 suffix、逗號或空白分隔清單，以及 `*` 全部直連。
  - `NODE_EXTRA_CA_CERTS=/absolute/path/company-ca.pem`：在啟動 daemon **之前**設定；使用 Node 預設的額外 CA 機制，不關閉 TLS 驗證。已用測試 CA 在 Node 22.23.2、24.11.0 與 Electron 44.2.0 的 Node 24.20.0 驗證 direct／CONNECT；沒有 CA 時拒絕，有 CA 時成功。這不是實際公司代理的驗收。
  - `npm_config_registry`／`NPM_CONFIG_REGISTRY`：小寫優先，預設 `https://registry.npmjs.org/`。HTTP(S) URL 可含子路徑，尾端有無 `/` 都可以；不支援帶帳密、query 或 fragment 的 registry URL，會明確拒絕。不讀 `.npmrc` 認證，也不讀 registry metadata 的 integrity；版本與 sha512 仍然釘死。
  - 桌面版從 Dock 啟動會繼承登入 shell 的環境變數；請把 registry、代理或 CA 設定寫進 shell 設定檔，再重新啟動桌面版。不要為此設定 `NODE_USE_ENV_PROXY`，它會影響其他連線。
- `woowtech/claude-sdk.test.mjs` 用 TypeScript AST 守住純型別 import 與 loader 唯一的 literal dynamic import；`query.ts`／`rewind.ts` 只能透過 ensure 載入。另檢查 SDK 是 devDependency、undici 是 server 的直接 production dependency，並用 electron-builder 純依賴收集確認包含 undici、排除 SDK。這不是實際 asar 驗證。CI 的 typecheck job 會跑所有 woowtech 守門（第 18 節）。
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
| Linux 的桌面項目     | `Paseo.desktop`                    | `woowtech smart.desktop`                             |
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
- Linux 的桌面項目：electron-builder 用 `executableName` 命名 `.desktop` 檔，打包進去的 package.json 用 `desktopName` 指出哪個是這個 App 的。上游在 `packages/desktop/package.json` 寫死 `Paseo.desktop`，那個檔上游常改，所以同樣用 `extraMetadata` 改成 `woowtech smart.desktop`。`main.ts` 啟動時也設同一個名稱；桌面版的打包 smoke 檢查兩者一致。
- `woowtech/coexistence.test.mjs` 檢查以上所有值彼此一致，也掃描原始碼裡不能再出現 `~/.paseo` 和 6767。快取資料夾名稱和打包後的 `desktopName` 直接交給桌面版的 electron-builder 計算。
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
  - 中文手機桌面顯示「渥屋智能」（Debug 版是「渥屋智能 Debug」），兩個平台都由 Expo 的 `locales` 寫入：`ios` 底下的 `CFBundleDisplayName`、`CFBundleName` 進 iOS 的 `InfoPlist.strings`，`android` 底下的 `app_name` 進 `values-b+zh+Hans`、`values-b+zh+Hant` 的 `strings.xml`（fixes-0928）。
    - Expo 54 的 prebuild 會把 `ios`、`android` 以外的鍵同時寫進兩個平台。原本 `CFBundle*` 放在共用層，Android 多出兩筆預設語系沒有的字串，本機 `assembleRelease` 的 `lintVitalRelease` 報 4 個 ExtraTranslation（2026-09-27 Android 輪次），只能略過 lint 才建得起來。
    - `plugins/with-localized-app-name.js` 和它的單元測試已刪除（integration-0928，協調者決定）。它當初替 Android 補上 `app_name`：那時共用層只有 iOS 的鍵，Expo 寫到 Android 的只是用不到的 `CFBundle*`。現在 `android` 底下直接給 `app_name`、由 Expo 寫入，fixes-0928 已從 `app.config.js` 拿掉註冊；它讀的是共用層的 `CFBundleDisplayName`，分平台之後就算再註冊也不會寫任何東西。
  - `apply-identity.mjs` 現在只處理 Expo 帳號相關的 owner、slug、project id。
- iOS 的主畫面顯示名稱欄位是 `CFBundleDisplayName`，`CFBundleName` 是 bundle 的短名稱（[Apple 欄位說明](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html)）。沒有證據能保證名稱太長時會切換到短名稱，也不能僅憑截圖判斷改讀了 `PRODUCT_NAME`。
  - `app.config.js` 的 `ios.infoPlist.CFBundleName` 是「woowtech smart」，`locales` 的 zh-Hans、zh-Hant 設「渥屋智能」。這次只更正說明，不改顯示名稱、Xcode 的 `PRODUCT_NAME`、執行檔或 `.app` 名稱。
  - iOS 26.5 英文模擬器驗收：Debug 產物的 `CFBundleDisplayName` 已是「woowtech smart Debug」、`CFBundleName` 已是「woowtech smart」，主畫面仍顯示「woowtechsmart…」，「設定 → App」則顯示完整名稱。短名設定沒有修好主畫面標籤；需再確認 SpringBoard 的空白與截斷行為。正式版顯示名稱較短，但主畫面結果尚未驗證，不宣稱兩版相同。中文 Debug 主畫面已觀察到「渥屋智能 Debug」。
  - 已經 prebuild 過的 `packages/app/ios` 要重新 prebuild 才會套用。
  - iOS 的相機、麥克風、照片和區域網路權限提示（`app.config.js` 的 `iosPermissionText`；區域網路是 2026-10-08 補的，第一次連到區網位址的主機時跳出）：寫出 App 名稱和用途，跟著手機語言顯示英文、繁中或簡中。原本是 `$(PRODUCT_NAME)`（Debug 版顯示成 woowtechsmartDebug）加只有英文，照片那句還沒說用途；Apple 曾因權限說明退件渥屋的 App（App Store 審查準則 5.1.1）。
    - 繁中、簡中寫在 `locales` 的 `ios` 底下，進 `InfoPlist.strings`。那裡不會展開 `$(PRODUCT_NAME)`，所以名稱直接寫「渥屋智能」。`android` 底下仍只有 `app_name`。
    - 英文寫在 `ios.infoPlist`；相機那句同時給 `expo-camera` 的 `cameraPermission`，照片那句會蓋過 `expo-image-picker` 的預設文字。
    - 守門 `woowtech/ios-permissions.test.mjs` 用 `expo config` 查兩個版本。prebuild 驗過：`zh-Hans.lproj`、`zh-Hant.lproj` 的 `InfoPlist.strings` 都有三句。已經 prebuild 過的 `packages/app/ios` 要重新 prebuild 才會套用。
  - iOS 的隱私清單 `PrivacyInfo.xcprivacy`（2026-10-08）：清單少宣告「需要理由的 API」（required reason API），App Store Connect 就不收那個建置。
    - API 的理由不用自己寫：`pod install` 時 React Native 把每個 pod 宣告的理由和它自己核心用到的合併進 App 的清單，所以 `expo-build-properties` 的 `ios.privacyManifestAggregationEnabled` 不能關。Firebase 的 SDK 各自帶清單（`.app` 裡的 `*_Privacy.bundle`）。
    - 2026-10-08 掃過 iPad 驗收版（Debug）的執行檔和三個內嵌 framework：`nm -u` 看 C 函式和常數，`strings` 看 selector。用到檔案時間、磁碟空間、UserDefaults 三類，清單都有，另外有 React Native 核心的開機時間；沒用到 `activeInputModes`。正式版上傳前用同樣方法再掃一次。
    - `app.config.js` 的 `ios.privacyManifests` 只寫 App 自己的部分：不追蹤；收集裝置 ID，用途是 App 功能，不連結到使用者身分。裝置 ID 是 FCM token：daemon 把它交給推播中繼，中繼為了每日上限保留它的 SHA-256，到那一天（UTC）結束（第 16 節）。App Store Connect 的「App 隱私權」問卷要跟這裡、跟 Firebase 清單宣告的一致。
    - Apple「常用第三方 SDK」名單上的 `hermes` 是 Imgur 的 SDK，不是 React Native 的 Hermes 引擎（Apple DTS 在開發者論壇的回答），`hermes.framework` 裡沒有清單是正常的。
    - 守門 `woowtech/ios-privacy-manifest.test.mjs`：`ios.privacyManifests` 的內容，以及合併沒有被關掉。
  - Android 的權限（2026-10-08）：Expo prebuild 的範本會要求 `SYSTEM_ALERT_WINDOW`（在其他應用程式上層顯示），只有 React Native 的除錯工具用得到，Google Play 卻會列在商店頁上。`app.config.js` 的 `android.blockedPermissions` 把它拿掉，prebuild 會寫成 `tools:node="remove"`。守門 `woowtech/android-permissions.test.mjs`。
- 桌面版（macOS）的「關於」視窗和 Finder 的「取得資訊」：版權是 `© 2026 WOOW TECH CO., LTD.`，「關於」視窗另外顯示官網 `https://aiot.woowtech.io/`。原本 electron-builder 用 `package.json` 的 author 產生「Copyright © 2026 Mohamed Boudra」，那是上游作者。
  - `electron-builder.yml` 的 `copyright` 寫進 Info.plist 的 `NSHumanReadableCopyright`，Windows 執行檔的版權欄也用它。
  - `main.ts` 在 `app.setName` 後面呼叫 `app.setAboutPanelOptions(woowtechAboutPanelOptions())`（+3 行）。內容在 fork 的 `src/features/woowtech-about-panel.ts`：同一行版權，官網放在 `credits`，因為 macOS 不顯示 `website`（Linux 才顯示）。官網取自 `BRAND_LINKS.website`。App 名稱和版本照預設，從 Info.plist 讀。沒打包的開發版也顯示同樣的版權和官網。
  - 選單的「關於 woowtech smart」是 Electron 原生的 `role: "about"`，顯示的就是這些設定。
  - 不改 `packages/desktop/package.json` 的 `homepage`、`author`：`scripts/sync-workspace-versions.mjs` 同步版本時會從根目錄的 `package.json` 蓋回上游的值，macOS 版也用不到它們（見「接下來」）。
  - 測試 `src/features/woowtech-about-panel.test.ts`。守門 `woowtech/desktop-about.test.mjs`：請 electron-builder 算出寫進 Info.plist 的版權；從原始碼跑 `woowtechAboutPanelOptions`，版權要跟它相同、官網在 `credits`；`main.ts` 在 `app.whenReady()` 之前呼叫一次，沒有別的地方改「關於」的設定；選單仍是 `role: "about"`。
- 桌面版（macOS）的麥克風權限提示（聽寫用）：寫出 App 名稱和用途，跟著系統語言顯示英文、繁中或簡中，句子跟 iOS 相同。原本是 Electron 的「This app needs access to the microphone」。
  - 英文寫在 `electron-builder.yml` 的 `mac.extendInfo`。繁中、簡中是 `packages/desktop/assets/lproj/zh_TW.lproj`、`zh_CN.lproj` 裡的 `InfoPlist.strings`，由 `mac.extraResources` 複製到 App 的 `Contents/Resources/` 同名資料夾。electron-builder 沒有放 `InfoPlist.strings` 的專用設定。
  - 資料夾用 Electron（Chromium）本來就有的 `zh_TW.lproj`、`zh_CN.lproj`，Chrome 也放在這兩個。另外加 `zh-Hant.lproj` 的話，App 會有兩個繁中語系。CoreFoundation 把 zh-Hant-TW、zh-Hant-HK 對到 `zh_TW`，zh-Hans-CN、zh-Hans-SG 對到 `zh_CN`。
  - `electronLanguages` 沒設。設了的話，electron-builder 先刪掉不要的語系資料夾，再複製 `extraResources`，這兩個檔案照樣會放進去。
  - 只加麥克風：桌面版只用到它（`getUserMedia` 只要聲音，`entitlements.mac.plist` 也只有 `audio-input`）。Electron 預設的相機、藍牙、系統聲音擷取說明不動，用不到。
  - 檔案放 `assets/`，不放 `build/`：根目錄的 `.gitignore` 忽略 `build/`，新檔案容易漏加。
  - 守門 `woowtech/desktop-permissions.test.mjs`：請 electron-builder 讀設定，檢查英文句子、兩個 `InfoPlist.strings` 的鍵和開頭（在 macOS 上另外用 `plutil` 讀一次）、`extraResources` 的對應，以及 Electron 有這兩個資料夾。
- App 的 vitest 原本只跑 `src/`，`plugins/` 的測試（包含上游的 `with-paste-input.test.ts`）從來沒被執行過，已加進單元測試的 include。
- `woowtech/names.test.mjs` 檢查安裝檔名稱與下載連結一致、App 裡寫死的文字、agent 看到的名稱，並用 `expo config` 檢查手機 App 的實際設定。
  - iOS 短名稱查兩處，也查不超過 15 字：`expo config --type prebuild` 裡 `app.config.js` 自己設的 `ios.infoPlist.CFBundleName`；`expo config --type introspect`（`woowtech/expo-config.mjs` 的 `expoIntrospectedConfig`）算出的 Info.plist，和 zh-Hans／zh-Hant 的 `ios.CFBundleName`。
  - Android 的中文資源交給 Expo 自己的產生器（`expo/config-plugins` 的 `AndroidConfig.Locales.setLocalesAsync`）用實際設定寫一次，`values-b+zh+Hans`、`values-b+zh+Hant` 只能有 `app_name`：多出預設語系沒有的名字，正式版 lint 就會報 ExtraTranslation。
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
  - 維持英文：Agent、Daemon、worktree（Agent、App 一律大寫單數）、Git 指令（commit、push、pull、merge、stash、rebase、squash、auto-merge）、PR、MR、issue、pull request、diff、hooks、token、縮寫、產品和品牌名稱。
- Host 統一譯為「主機」；Agent 保留英文。localhost、hostname、`--host`、網址、路徑、插值與使用者主機名稱不翻譯。
- Schedules 譯為「排程」。上游簡中把側欄的 Schedules 譯成「计划」，轉出來是「計畫」，跟 Plan 模式的「計畫」撞在一起，測試員也把那一頁當成 Plan。修正表只在英文原文有 schedule 時把「計畫」改成「排程」，Plan 相關的「計畫模式」「建議計畫」不動。
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
- 白色底板只用在 App 圖示（iOS 主圖示、Android 自適應圖示的底色、macOS／Windows 圖示、網頁的主畫面圖示）。標誌放在 App 自己的背景上時一律去背（2026-10-07，owner：「logo 都要用去背的」）：Android 深色模式的啟動畫面原本是黑底上一塊白色圓角底板。
  - 啟動畫面 `splash-icon.png`：透明背景上的藍色標誌，800px。Android 12 以後系統把它畫在一個直徑三分之二畫布的圓裡，所以標誌寬 50%（對角線 64%，不會被切到）。
  - Android 的啟動圖是 prebuild 產生的：`@expo/prebuild-config` 的 `withAndroidSplashImages` 先用啟動畫面的背景色畫一塊 288dp 的方塊，再把標誌疊上去；`dark` 有 `image` 才會產生 `drawable-night-*`。原本 `dark` 只有背景色，深色模式就用淺色那張（白方塊），這才是黑底上出現白方塊的原因。所以 `dark.image` 也指向 `splash-icon.png`，深色版畫在黑方塊上。iOS 直接用原圖疊在背景色上，所以原圖本身也要去背。
  - favicon（網頁和桌面版視窗的小圖示，含執行中、需要注意兩種狀態點）：透明背景，標誌寬 92%。
  - iOS 18 的深色圖示（`ios-icon-dark.png`，透明背景上的藍色標誌，`app.config.js` 的 `ios.icon`）：系統自己畫深色背景。主圖示仍是不透明的白底，App Store 不收有透明通道的圖示。沒有提供染色圖示：prebuild 的 `withIosIcons` 會把染色圖示鋪到白底上（白色剪影就變成一整塊白），iOS 沒拿到染色圖示時會自己把主圖示染色；要做專用的染色圖示，先在實機上確認 iOS 怎麼替白底的圖上色。
  - Android 13 以後的主題圖示（`android-icon-monochrome.png`，`adaptiveIcon.monochromeImage`）：白色剪影，幾何跟自適應前景一樣（寬 40%），使用者開啟「主題圖示」時系統依桌布配色上色。
  - 通知圖示本來就是白色剪影；App 畫面裡的 logo 是向量繪製，本來就沒有底板。
- 來源是 `woowtech/brand/woowtech-symbol.svg`：設計系統的官方字形，是 PDF 轉出的 SVG，已經裁切到字形的範圍。
  - `woowtech/tools/flatten-symbol.py` 把它攤平成 `woowtech-symbol-path.svg`，共 10 筆路徑，畫出來跟原檔逐像素相同。
  - 不能合成一條路徑：筆畫會重疊，合成後在非零環繞規則下，交叉處會被挖成空洞。
- `woowtech/tools/generate-icons.mjs` 產生全部 22 個圖示，需要 Google Chrome、sips 和 iconutil。加 `--out <資料夾>` 可以只輸出預覽。
  - iOS：1024 滿版、沒有透明通道。
  - Android：自適應圖示的字形寬度 40%，落在安全區內，底色白色；通知圖示是白色剪影。
  - Headless Chrome 偶爾在寫完截圖後、關閉時當掉（exit code 2，「Teardown watchdog expired」），所以產生器看截圖檔是否寫出，最多試三次。只想換其中幾張圖時，用 `--out` 輸出到別的資料夾再挑檔案複製：Chrome 版本不同時，沒改的圖也會有像素差異。
  - favicon：字形放大，16px 也看得出輪廓。狀態點沿用上游的顏色，執行中是 #3b82f6、需要注意是 #22c55e。
  - macOS：照 824/1024 的格線畫，含陰影。
- App 裡的 logo 元件（`paseo-logo.tsx`，有 5 個地方在用）改畫 WOOW 標誌，顏色見第 9 節。
- 網頁版和桌面版的啟動畫面用 CSS 遮罩畫標誌，沒有經過 logo 元件，到 2026-09-29 都還是上游 Paseo 的蝴蝶（手機版一直是 WOOW 標誌）。現在遮罩用 `paseo-logo.tsx` 的 `woowSymbolMaskSvg()`，跟元件同樣的 10 筆筆畫。上游留下的 `assets/images/butterfly-*.svg`、`favicon-*.svg` 在整個 repo（含官網）都沒有引用，已刪；App 用的 favicon 是 `generate-icons.mjs` 產生的 PNG。
- `woowtech/icons.test.mjs` 檢查以下幾件事，合併上游時如果被換回 Paseo 的圖示就會失敗：
  - 圖示內容：有品牌藍、沒有上游的黑色方塊。
  - 啟動畫面、favicon、iOS 深色圖示、Android 主題圖示的邊緣是透明的，沒有白色底板；主題圖示是白色剪影；`app.config.js` 接上這些圖，深色啟動畫面有自己的圖。
  - 尺寸和格式。
  - Android 的底色和通知的強調色。
  - logo 元件跟品牌檔一致。
  - 啟動畫面的標誌用品牌藍。
  - 出貨的檔案裡沒有上游 Paseo 蝴蝶的路徑資料（App、網頁、桌面版、server、CLI）。
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
- 預設的深色主題原本帶上游的綠色調，現在背景改成中性灰（沿用 Zinc 的灰階），紅色也改用 Zinc 那組中性紅。其他深色主題（Zinc、Midnight、陶土、Ghostty）維持原樣。陶土原本叫 Claude，改名見第 22 節。
- 品牌藍只寫在 `packages/app/src/styles/brand.ts`（`BRAND_BLUE`），主題的強調色直接引用它。
  主題清單裡代表預設深色主題的色塊（上游是綠色 #2D8B62）也引用它。選單上深色主題顯示的是月亮圖示，這個色塊目前沒有畫出來。
- 下面兩個值沒辦法引用 `brand.ts`，改品牌藍時要一起改。上游兩處都是綠色 #20744A：
  - Android 通知的強調色，通知的小圖示會染成這個顏色。寫在 `packages/app/app.config.js` 的 expo-notifications 外掛設定。
  - 網頁版的鍵盤焦點框。桌面版載入的是同一份網頁，所以也一起改了。寫在 `packages/app/public/index.html` 的 `*:focus-visible`。
- 有意義的綠色維持上游原樣，色值也跟品牌綠不同：成功狀態、diff 的新增行、健康檢查通過的執行中腳本、自動接受模式（快速模式是黃色、規劃模式是藍色）、終端機的 ANSI 綠。
- logo 元件不管呼叫端傳什麼顏色，一律畫品牌藍，因為品牌標誌不應該跟著主題變色。
  - 啟動畫面也一樣。網頁版和桌面版的標誌是 CSS 遮罩，不經過 logo 元件（第 8 節），上游填的是主題的前景色，深色主題是白色、淺色主題是黑色。2026-10-05 起改成品牌藍，跟手機版一致。
- 測試：
  - `styles/theme.test.ts` 檢查品牌色和中性背景，`components/icons/paseo-logo.test.tsx` 檢查 logo 一律是品牌藍。
  - `woowtech/brand-colors.test.mjs` 掃描出貨的 App、網頁和桌面版檔案，連同 `app.config.js` 和 `electron-builder.yml`，不准出現上游的品牌綠。
    範圍包括 #20744A、上游主題的兩個亮色（淺色 #239956、深色 #7ccba0）和代表色 #2D8B62，十六進位和 `rgb()`／`rgba()` 寫法都算。

### 10. 說明與求助連結（品牌識別第四步）

- 對外連結都寫在 `packages/protocol/src/brand-links.ts`（`BRAND_LINKS`），App 和 CLI 共用。要改連結，只改這個檔案。
- 說明文件：官網 aiot.woowtech.io 還沒有說明頁，App 的 8 處和 CLI 的 2 處都先開官網首頁。哪個主題有了頁面，就改 `docs` 裡對應的那一項。
- 回報問題：寄信到 woowtech@designsmart.com.tw。
- 隱私權政策（2026-10-08）：官網 Help Center 網誌的一篇文章（Odoo `blog.post` 391，中英文在同一頁），網址是 `BRAND_LINKS.privacyPolicy`，也是兩個商店要填的隱私權政策網址。
  - 設定「關於」頁的「隱私權政策」那一列打開它（`screens/settings/woowtech-privacy-policy-row.tsx`，`settings-screen.tsx` 的 `AboutSection` 加一行）：App Store 審查準則 5.1.1 和 Google Play 都要求 App 裡找得到隱私權政策。
  - 改政策就在 Odoo 改那篇文章。網址靠結尾的 391 找文章，標題改了，舊網址也會轉到新的。App 的資料流變了（例如加了分析或當機回報 SDK），政策和商店的隱私填答要一起改。
  - 守門 `woowtech/help-links.test.mjs`；測試 `woowtech-privacy-policy-row.test.tsx`（繁中、英文、點了開政策網址）。
    上游的外部連結開啟器只放行 http/https。現在 App 的 `utils/open-external-url.ts` 和桌面版的 `features/opener.ts` 多放行 `mailto:`，`file:`、`javascript:` 照樣擋掉。
- 社群與快速求助：官網首頁 aiot.woowtech.io（`BRAND_LINKS.website`）。2026-09-26 起不再導向 LINE 官方帳號（擁有者決定）。
  - 說明選單的 Discord 改成「官方網站」。
  - 設定的「關於」頁和專案首頁底部，原本有 GitHub Star、贊助上游作者、Discord 三個按鈕，現在只留「官方網站」（地球圖示）。
  - help 技能的「Questions and quick help」也改成官網（`woowtech/tools/skill-rewrites.mjs`，改完用 `generate-skills.mjs` 重新產生）。
  - 標籤是上游 key `sidebar.help.discord`，十種語言的譯文在 `packages/app/src/i18n/support-copy.ts`。
  - `woowtech/help-links.test.mjs` 擋住 LINE：出貨原始碼和技能檔都不准出現 line.me、lin.ee 或帳號 ID；說明選單與「關於」頁的按鈕都要開 `BRAND_LINKS.website`。
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

- 程式是上游的 `packages/relay/src/cloudflare-adapter.ts`，只加一個接點：每個 daemon（serverId）一個 Durable Object `RelayDurableObject`，用 WebSocket hibernation 轉送 daemon 和 App 之間的 WebSocket，不存資料。`/health` 回 `{"status":"ok"}`，`/ws` 是 relay。
- 接點：`webSocketClose` 第一行呼叫 `answerCloseFrame`（`src/woowtech-close-reply.ts`），回覆對方的 Close frame。`compatibility_date` 是 2024-12-01，runtime 不會替 hibernation 的 socket 回覆，關閉的一方只能等到自己逾時：2026-10-07 對 relay.woowtech.io 實測是 20 秒，最後是 1006。停止 daemon 時要等 relay 的 socket 關掉，每次都撐到 10 秒的期限被強制結束（`Forcing shutdown - HTTP server didn't close in time`，worker exit code 1）。對方的代碼是 1004、1005、1006、1015 時（這幾個不能放進 Close frame）回 1000。上游沒有這個接點，`wrangler.toml` 的部署也一樣有這個問題。
- daemon 那邊不再等 relay 回覆：`relay-transport.ts` 的 `stop()` 用 `terminate()` 切斷控制和資料 socket，不做關閉握手（relay 連不上時也永遠等不到）。relay 收到斷線，照原本的邏輯關掉配對的 App socket（1012），App 會重連。
- 上游的 `wrangler.toml` 設了 `PASEO_RELAY_UPSTREAM = "https://paseo-relay-next.fly.dev"`：上游把正式流量搬到了 Fly，Cloudflare 上的 Worker 只把請求原樣轉過去。沒設這個變數時，Worker 自己當 relay。
- 我們用 fork 自己的 `packages/relay/wrangler.woowtech.toml` 部署，上游的 `wrangler.toml` 不動：
  - 帳號 `9c27…`、Worker 名稱 `woowtech-smart-relay`、custom domain `relay.woowtech.io`（部署時自動建 DNS 記錄和憑證）、`workers_dev = false`（不開 workers.dev 網址）。
  - Durable Object 綁定、SQLite migration（`new_sqlite_classes`）跟上游一樣，沒有任何變數。observability 跟上游不同：關閉（見下一項）。
- 方案：不需要付費方案。SQLite 的 Durable Object 在 Workers 免費方案就能用，custom domain 也免費。
  - 免費額度：Worker 和 Durable Object 各是每天 10 萬個請求，Durable Object 另有每天 13,000 GB-s。每條 WebSocket 連線算一個請求，收到的訊息 20 則算 1 個，送出的訊息和 ping 不算。超過就失敗，UTC 00:00（台灣 08:00）重置。用量大了再升 Workers Paid（每月 5 美元）。
  - woowtech.io 的 Pro 是 zone 的方案，跟 Workers 的方案無關。
- Workers Logs 關閉（擁有者 2026-09-26 決定，最終驗收後關）：relay 自己印的是連線、斷線、serverId 和 connectionId，沒有內容（內容是加密的），但沒有必要留在 Cloudflare。`wrangler.woowtech.toml` 的 `[observability]` 是 `enabled = false`，`relay-worker.test.mjs` 擋住它被打開。要除錯時暫時改成 `true` 再部署，查完改回來並重新部署；也可以不開 Logs，改用 `wrangler tail --config wrangler.woowtech.toml` 即時看。上游開著。

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

配對連結的主機：owner 決定直接叫起 App，配對連結和 QR Code 改成 `woowtech-smart:///#offer=…`，CORS 白名單也不再放行上游的網頁版（新 home 不寫，舊 home 解析時拿掉），見第 19 節。當時比較過的其他做法也記在那裡。

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
  - `woowtech/skills.test.mjs`：提交的技能等於重新產生的結果；6 個名字和 frontmatter；不准出現 6767、`~/.paseo`、`Paseo.app`、官方 App 的資料夾、`paseo <指令>`、上游技能名、Discord、GitHub issues 和 discussions，paseo.sh 和上游 GitHub 只准外掛技能用在外掛 API 文件；指令、port、資料夾、log、`$PASEO_CLI`、relay、官網（含「Questions and quick help」的官網連結）、信箱都要出現；`build:lib` 複製的是 `woowtech/skills`；改寫規則對上游日後可能加的文字（`/paseo`、`Paseo Hub`、`/paseo-plugin.json` 這種路徑）也對。
    另外從原始碼在暫存 HOME 跑 daemon 的技能操作，裡面已經有官方的現行和舊名技能：daemon 管理的名字只有 `woowtech-smart*`，安裝和解除安裝都不動官方的，儲存時暫存在 `.woowtech-smart-skills-transaction-*`。開發路徑、舊名清單或暫存前綴在合併時被改回上游的，這項會失敗。
  - `server/src/server/orchestration-skills/internal/coexistence.test.ts`：把真正出貨的技能裝進已經有官方技能（現行和舊名）的暫存 HOME。安裝、啟動時修正、更新、縮小選擇、解除安裝都不碰官方的，舊名只刪我們的；儲存時的暫存資料夾用我們的前綴；官方中斷的交易原樣保留，也不會讓我們的操作失敗。
  - 改了預期值的上游測試：`paths.test.ts`（開發路徑）、`desktop-packaging.test.ts`（`build:lib`）、`operations.test.ts` 和 `controller.test.ts`（舊名和暫存資料夾前綴）。

### 14. fork 自己的介面文字

- `packages/app/src/i18n/woowtech-copy.ts` 放 fork 自己的文字，也用來翻譯上游寫死在程式裡的英文。
  - 跟第 10 節的 `support-copy.ts` 一樣由 `i18n/brand.ts` 在載入翻譯時套用：放在每個語言的 `woowtech` 底下，元件用 `t("woowtech.…")` 取用。
  - 每種語言都提供相同的 key；既有文案保留各語系翻譯。新增專案與主機選擇器提供 zh-TW、zh-CN，其他語言使用英文。上游之後新增的語言先顯示英文。
- 目前的內容：更新紀錄的空狀態（第 10 節）、設定頁的瀏覽器工具卡、「封存 PR 已合併的工作區」、終端機 Agent hooks 開關、「Unknown error」、側欄的「工作區」標題、配對畫面的「停用中繼」（第 11 節）。側欄的「顯示偏好」提示改用上游自己的 `sidebar.display.trigger`。
- `screens/settings/**` 寫死的英文已經全部盤點過，使用者看得到的 14 處都改用 `t()`。刻意沒改的：
  - `daemon-lifecycle.ts` 的技術性錯誤細節，顯示在已經翻譯的失敗訊息裡。
  - `plugins-page.tsx` 裡執行不到的離線錯誤。
  - 外觀預覽的範例程式碼和「px」。
- `browser-tools-config.ts` 回傳的卡片狀態仍帶上游英文，上游的單元測試會檢查它；畫面上的文字由 `browser-tools-card.tsx` 翻譯。
- 新增專案整個流程與主機選擇器的本地文案已接到 `woowtech.addProject`、`woowtech.hostPicker`。繁中「Clone from GitHub」用「從 GitHub 複製專案」，進行中用「正在複製專案…」。原始 daemon 錯誤、儲存庫說明、網址、路徑與使用者名稱不翻譯。
- 主機選擇器顯示與搜尋共用同一份選項文字；包含 `host-filter.tsx` 的觸發器在內，文字快取依賴翻譯函式，切語言時更新。其他設定頁外的硬編碼仍需逐頁盤點。
- Renderer 共用 `utils/confirm-dialog.ts` 的 Cancel 預設使用既有 `common.actions.cancel`；Confirm 沒有通用既有 key，使用 fork 的 `woowtech.confirmDialog.confirm`（繁中「確認」，其他語系沿用英文）。兩者依呼叫當下 App 語言取值，caller 的 label（含空字串）優先。子 Agent 的 archive／detach 確認也使用同一個 Cancel key，其餘文字不在這次範圍。這兩個檔把上游寫死的 `cancelLabel: "Cancel"` 改成 `i18n.t("common.actions.cancel")`，沒有直接刪掉那一行交給 `confirm-dialog.ts` 的預設：上游的 `archive-subagent.test.ts`、`detach-subagent.test.ts` 共 6 處斷言解析出的 `cancelLabel: "Cancel"`，刪掉就要再改這兩個上游測試檔。Electron main 選單／原生對話框 fallback、瀏覽器系統按鈕不改（html lang 後來改了，見下面 fixes-0928）。`utils/woowtech-confirm-dialog.test.ts` 與 `subagents/woowtech-subagent-dialogs.test.ts` 透過 public ports 檢查 label、布林及錯誤行為，不新增 module mock；`woowtech/zh-tw.test.mjs` 守住接點。
- 合併上游後要注意：T5 在 `components/add-project-flow.tsx` 約 171 行差異，另接到 `add-project-flow/options.ts`、`components/hosts/host-picker.tsx`、`host-picker-constants.ts`、`host-filter.tsx`；上游重整這些流程時，保留 fork 翻譯接點與 `t` 的快取依賴，並重跑下列定向測試。
- 2026-09-27 Android 與桌面輪次在繁中介面看到的英文（fixes-0928），原因都是上游寫死或沒用翻譯，不是產生器漏掉；`zh-tw-untranslated.mjs` 和 `KEEP_ENGLISH` 都沒有這些 key。文字只給繁中和英文（`woowtechCopyFor` 用 `language === "zh-TW"` 選），其他語言沿用英文：
  - 「排程」頁（`woowtech.schedules`）：上游整個功能沒有翻譯 key。接點是 `screens/schedules-screen.tsx`、`components/schedules/` 的 row、table、cadence editor、form sheet，以及純函式 `utils/schedule-format.ts`（頻率說明、cron 錯誤、下次執行）、`schedules/schedule-cadence-options.ts`（預設頻率）、`schedule-derivation.ts`、`schedule-form-model.ts`。純函式讀全域 `i18n.t`，英文與上游逐字相同，上游的英文單元測試照樣過；元件用 `t`，切語言時跟著更新。共用的 cron 驗證（protocol）只有一組固定的英文訊息，`validateCron` 依格式換成翻譯。「Schedule／Heartbeat」這兩種產品名的文字改用 `scheduleCopy()`；`scheduleProductName()` 沒改（上游的單元測試還在用），介面不再用它組字。daemon 回的錯誤（例如排程不存在）照原文顯示。
  - 相對時間與時間長度（`woowtech.time`）：`utils/time.ts` 的 `describeTimeAgo`／`formatTimeAgo`（剛剛、N 分鐘前）、`describeCompactTimeAgo`（精簡版）、`formatDuration`（「工作了 25 秒」和進行中的計時）。前兩者共用上游的 `describeAge`，不到一分鐘一律「剛剛」（上游 `05874e289`，第三批）。一週以上的日期用 `woowtech.time.dateLocale` 指定的語系排版（en-US 的「Sep 27」、zh-TW 的「9月27日」）。
    - Agent 清單、排程、匯入工作階段、提交清單和供應商設定的列用 `hooks/use-time-ago.ts` 的 `useTimeAgo`，側欄和分頁用 `useCompactTimeAgo`。標籤存在 state，靠共用的計時器更新；fork 讓它在 App 語言改變時立刻重算（註解 `woowtech smart:`），否則還開著的列會停在舊語言。測試是 `hooks/woowtech-use-time-ago.test.tsx`。
  - 主機狀態徽章「Online」：`utils/daemons.ts` 改用上游本來就有、卻沒人用的 `common.connectionStatus.*`（線上／正在連線／離線）。
  - 「工作區不可用」的內文：daemon 的 recovery inspect 回應有 `reason` 代碼，`workspace-recovery/woowtech-recovery-copy.ts` 依代碼顯示繁中翻譯（`woowtech.workspaceRecovery`）；其他語言和不認得的代碼照舊顯示 daemon 原文。
  - 「Transport not connected (status: disconnected)」：client 連線中斷時的英文錯誤。`utils/error-messages.ts` 的 `toErrorMessage` 遇到它、socket 已關但 client 還沒發現時的「WebSocket not open」，或 `DaemonConnectionError` 的 `DAEMON_CONNECTION_LOST`，改顯示上游的「主機未連線」；檔案總管的清單和預覽錯誤改經 `toErrorMessage`。
  - 「Worked for 15s」：`components/message.tsx` 的 `AssistantTurnFooter`（`woowtech.message`）。
  - `<html lang>`：Expo 的網頁模板固定寫 `en`，中文字會用英文頁面的預設 CJK 字型、報讀也當英文。`i18n/woowtech-document-language.web.ts` 讓它跟著 App 語言變，手機版是空函式；接點是 `i18n/i18next.ts` 的一行呼叫。
- 守門：
  - `woowtech/zh-tw.test.mjs`「the translated schedule screens have no hardcoded English」掃描排程頁的五個元件檔：JSX 文字、使用者看得到或聽得到的屬性、選項物件的 label、英文片語字串、以英文開頭或在插值後接英文的 template literal。上游合併帶進新的英文就會紅，要改成 `t()`。
  - `i18n/woowtech-copy.test.ts` 的 `REPLACED_ENGLISH` 加了純函式和其他接點已經換掉的字面值。
  - `i18n/woowtech-zh-tw-screens.test.ts` 把整個 i18n 切到 zh-TW，檢查上面每一處實際產生的文字，以及 `<html lang>` 跟著語言變。
- 測試：
  - `i18n/woowtech-copy.test.ts`：既有文案與新文案各按上述語言政策驗證，檢查 key、插值一致及英文 fallback；已遷移的硬編碼不能回到原始碼裡。新增專案選項與主機選擇器的純 helper 測試也驗證切語言及使用者資料原樣保留，不以元件 mock 代替 UI 驗收。
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
5. push.woowtech.io 是 Cloudflare Worker（`smart-push-proxy`）：只放行這條路徑、每個 IP 每分鐘 120 次（Worker 的 `IP_RATE_LIMITER` binding，每個 Cloudflare 據點各自計數，沒有建 WAF 規則），加上 edge key 標頭後轉給 Cloud Run。
6. Cloud Run 的 `smart-push`（GCP 專案 `woowtech-smart`，asia-east1）跑中繼 repo `woowtech-push-relay` 的 smart 模式（`RELAY_PROFILE=smart`）：驗證格式、查每個 token 的上限（每分鐘 10 則、每天 500 則）、從 `functions/smart-messages.js` 挑句子，用 Cloud Run 的服務帳戶呼叫 FCM。
7. FCM 送到 Android，中繼依原因指定 App 的通知通道（見下面 Android 的「通知通道」）；iOS 由 FCM 用上傳到 Firebase 的 APNs 金鑰轉給 APNs。
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
- 只有連上宣告 `woowtechPush` 的 daemon 才要通知權限和 FCM token：每個 daemon 的訂閱最多問一次權限，連官方 Paseo 的 daemon 時完全不問，也不碰 Firebase。Android 的通知通道也在這時建立，在拿 token 之前（見下面 Android 的「通知通道」）。
- 快取沿用上游的 key `@paseo:expo-push-token:<serverId>`，存註冊出去的字串。升級後第一次同步會在那裡找到舊的 Expo token，先撤銷它。連的是沒有 `woowtechPush` 的 daemon（官方 Paseo，或這個改版以前的我們）也撤銷：那種 daemon 會把 agent 的回覆送到 Expo，直到舊 token 的 48 小時租約到期。daemon 宣告了 `pushTokenRevocation` 才撤銷並刪掉快取，不問權限、不碰 Firebase；沒宣告的，快取留著。
- 換 token、換語言時先撤銷舊字串（我們的 daemon 宣告了 `pushTokenRevocation`）再註冊新的，同一支手機才不會收到兩則；通知權限被拒時撤銷並刪快取（上游只刪快取）；每次重新連線都再註冊一次，續 48 小時的租約。
- FCM token 更新的監聽在第一次拿到 token 之後才開始，而且只有 token 真的換了才重新同步：Android 的 `expo-notifications` 每次 `getDevicePushTokenAsync` 都會把同一個 token 當成新 token 再發一次事件（`PushTokenModule.kt`），不比對的話，同步取 token、事件又排下一次同步，會一直重新註冊。token 不符契約時不註冊，warn 只寫長度。
- App 啟動時透過 `turnOffExpoPushRegistration` 停用 Expo 自動登記，不管有沒有主機；每個訂閱同步前都等同一次呼叫完成。iOS 的 fork adapter `push-notifications/internal/woowtech-expo-registration.ts` 直接向 `NotificationsServerRegistrationModule` 寫入 `{"isEnabled":false}` 字串；Expo 0.32.16 的公開 `setAutoServerRegistrationEnabledAsync(false)` 會傳 `null`，但 iOS 原生參數是非 optional `String`，因此舊版停用必定失敗，留下的 enabled 登記可能在後續每次啟動與 APNs token 事件回報 exp.host，不只升級第一次。Android 仍使用原公開 API（原生接受 null）。
- 舊登記未清除的風險只影響曾經以相同 bundle ID 登記 Expo 的裝置。使用者已確認目前沒有任何 iPhone 裝過這種舊版，所以本輪只做原生字串的最小修正，不封鎖 Expo import 副作用。
- 這項修正只保證成功寫入後的登記狀態停用，不是零 Expo 請求保證：`expo-notifications` 在 import 時已讀取設定，較早讀到 enabled 的工作可能仍在取 token 或已上傳；直接寫原生設定也不會取消既有上傳。封鎖 import 副作用另行決定。寫入失敗仍會 warn，這次啟動不重試。這條 Expo 更新路徑包含 device token、安裝識別碼、App ID 與環境，不含 agent 內容；不要把 warning 消失當成網路驗證通過。
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
- 通知通道（2026-10-05）：
  - 原因：原本 App 只建一個 `default` 通道，重要性 DEFAULT，中繼每則推播都指定它，所以 Android 從不跳出橫幅（heads-up）。橫幅要重要性 HIGH，而 Android 不讓 App 調高已經存在的通道，所以改用新的通道 ID。
  - 兩個通道，重要性都是 HIGH，定義在 fork 自有的 `push-notifications/internal/woowtech-notification-channels.ts`：

    | 通道 ID           | 繁中名稱   | 英文名稱      | 中繼的推播                 |
    | ----------------- | ---------- | ------------- | -------------------------- |
    | `agent-attention` | 需要你處理 | Needs you     | `permission`、`attention`  |
    | `agent-finished`  | 工作完成   | Work finished | `finished`、每日上限的通知 |

  - 名稱是系統設定裡的通知類別，跟中繼的句子同一種語言，用同一個 `pushLocaleFor` 決定：`zh` 開頭（簡中也算）用繁中，其他用英文。中繼只有這兩種語言，所以名稱不放第 14 節依介面語言給字的 `woowtech-copy.ts`，跟通道 ID 寫在同一個檔。
  - 時機跟原本的 `default` 一樣：連上宣告 `woowtechPush` 的 daemon、有通知權限之後、拿 FCM token 之前，每次同步都設一次。同一個 ID 再設一次只改名稱，不會調高重要性。所以換語言後，把註冊換成新語言的那次同步也改名（daemon 沒連上時等下次連上）；使用者在系統設定調低的通道也不會被調回來。
  - `app.config.js` 的 `expo-notifications` 外掛加上 `defaultChannel: "agent-finished"`，外掛把它寫成 manifest 的 `com.google.firebase.messaging.default_notification_channel_id`。推播指定的通道手機上沒有時，FCM SDK 改用這個通道；manifest 沒寫的話，會落到 FCM 自己建的「Miscellaneous」（重要性 DEFAULT，沒有橫幅）。F-Droid 版沒有這個外掛，也沒有 FCM；它的 `expo-notifications` stub 多了 `AndroidImportance.HIGH`。
  - `default` 不再建立。照 owner 的決定這一版不刪，等中繼部署而且確定不回滾之後，下一版再用 `deleteNotificationChannelAsync` 刪掉。中繼部署前還是指定 `default`：已經有它的手機照舊收在 `default`（沒有橫幅），新裝的手機沒有它，就收在 `agent-finished`。
  - 上線順序：先發 App，再部署中繼（中繼的改動和步驟見「接下來」）。中繼先部署的話，還沒更新的 App 沒有這兩個通道，manifest 也沒有預設通道，推播會落到「Miscellaneous」。
  - 還要實機驗：POCO 上 App 在背景和被滑掉時，`finished` 和 `permission` 的推播都跳出橫幅；系統設定的通知類別是「需要你處理」和「工作完成」（英文介面是 Needs you、Work finished），換語言後跟著換；只把「工作完成」調低時，完成的通知不再跳出，要授權的仍然跳出。從裝過舊版的手機升級也看一次：`default` 還在，新的推播進新通道。沒有橫幅時，先看系統設定裡這個 App 的「懸浮通知」（MIUI、HyperOS 另有這個開關）。

契約 fixture：

- `packages/protocol/tests/fixtures/smart-notify-v1.fixtures.json` 是中繼 repo `functions/test/fixtures/smart-notify-v1.fixtures.json` 的逐位元組副本，列出合法和不合法的請求。中繼 `smart-mode` 分支從 `3363c60` 到部署的 `dff78a1` 這份檔案都相同，`shasum -a 256` 是 `f78591d8…c8f667`。這份檔案不會打包進 npm 套件（`files` 只有 `dist`）。
- 契約由中繼那邊改。改了之後：
  1. 把整份檔案複製過來，不要在這裡改。
  2. 兩份的 `shasum -a 256` 要相同。
  3. 跑 protocol 的 `woowtech-push.test.ts` 和守門 `woowtech/push.test.mjs`：合法的案例要通過 `validateRelayNotifyBody`，而且就是 daemon 會送的位元組；不合法的要在中繼回報的同一個欄位被擋，daemon 也送不出來。
  4. 契約變了，`woowtech-push.ts` 的檢查就要跟著改（例如 FCM token 的上限），App 和 daemon 都要重建。

接點（上游的檔），行數以上游 v0.8.0 為準：

- server 和 protocol：`push/index.ts`（13 行增、4 行刪：預設 `deliver`、`send()` 裡的 `toRemotePushPayload`、`renew` 撤銷同一支手機的其他字串）、`websocket-server.ts`（3 行：`woowtechPush` 旗標 2 行、terminal 推播的 `reason` 1 行）、`protocol/src/messages.ts`（3 行）。
- App：`push-notifications/index.native.ts`（8 行增、1 行刪：import 和載入時呼叫 `turnOffExpoPushRegistration()`）、`app.config.js`（2 行 require、plist 改由 `woowtech-ios-firebase.js` 決定（上游 variants 裡的兩個 `googleServiceInfoPlist` 留著不用，少改上游的行）、外掛 1 行、`expo-build-properties` 的 `ios` 區塊、`expo-notifications` 外掛的 `defaultChannel` 1 行和 2 行註解）、`metro.config.cjs`（3 行）、`src/fdroid/expo-notifications.ts`（F-Droid stub 的 `AndroidImportance` 加 `HIGH`，1 行和 1 行註解）、`package.json`（2 個相依）、`package-lock.json`（只有新增）。
- `knip.json`：server 的 `ignore` 放 `push-service.ts`（它還提供 `PushPayload` 型別，但 `PushService` 沒人用），App 的 `ignoreFiles` 放 `subscriptions.ts`，knip 才不會建議刪掉這兩個上游的檔。`npm run knip` 本身在 main 也會停在 knip 的 Expo 外掛（`app.config.js` 的外掛有函式，knip 5.86 當成字串處理），要看報告就分 workspace 跑，packages/app 要先在暫時的設定裡關掉 Expo 外掛。
- App 根目錄的新檔 `react-native.config.js` 和 `firebase.json` 上游沒有；上游以後加了同名檔會衝突，合併時把兩邊的設定合在一起。
- 上游的測試檔加了案例：`protocol/src/messages.test.ts`（1 組）、`websocket-server.notifications.test.ts`（4 個，兩個是下面「誰收到通知」的）、`websocket-server.terminal-notifications.test.ts`（2 組，一組是停止中不推播）。合併時衝突的話，可以先放掉我們加的測試：守門涵蓋 `send()` 的改寫、terminal 推播的 `reason`、`register_push_token` 的路徑、`woowtechPush` 旗標和 App 的接點（`index.native.ts`、`react-native.config.js`、`app.config.js`、`metro.config.cjs`）。
- fork 自有的檔（各自附測試）：protocol 的 `woowtech-push.ts`；server 的 `push/woowtech-relay.ts`、`push/woowtech-push-content.ts`；App 的 `push-notifications/internal/` 裡的 `woowtech-subscriptions.ts`、`woowtech-notification-channels.ts`、`fcm-token-source.ts`、`fcm-token.ts`、`fcm-token.ios.ts`、`fcm-token.android.ts`，`plugins/` 裡的 `with-woowtech-push.js`、`woowtech-ios-firebase.js`、`woowtech-metro-resolver.js`；守門 `woowtech/push.test.mjs`、`woowtech/push-content.test.mjs`。

測試：

- protocol `woowtech-push.test.ts`：字串來回和冒號、語言、token 契約（長度、字元、冒號）、`reason` 和 `target` 的對應、不帶文字，以及契約 fixture 的每一個案例。`messages.test.ts`：帶 `woowtechPush` 的 server_info 解析得到值，不帶的照樣解析。
- server `push/woowtech-relay.test.ts`：用本機的 `node:http` 伺服器當假中繼，檢查收到的原始位元組。只有四個欄位；標題、內文、`cwd` 裡的標記字串不外流；Expo token 撤銷不送；同一支手機兩種語言只送一次；App 換語言又換回來、兩次撤銷都沒送到時，中繼收到的是最後註冊的語言，store 只剩那個字串；410 撤銷；503、連線被切、連不到、逾時各重試一次；400、403、413、429、502 不重試也不撤銷；307、308、302 轉址不跟著轉，另一個位址收不到任何請求；log 沒有 token，debug 只有雜湊前 8 碼；store 撤銷失敗不影響其他手機。另一個測試不注入 `deliver`，用 `diagnostics_channel`（`undici:request:create`、`http.client.request.start`）記下 `send()` 期間程序發出的每一個請求：只有假中繼那一個。
- server `push/woowtech-push-content.test.ts`、`websocket-server.notifications.test.ts`、`websocket-server.terminal-notifications.test.ts`：通用句子、ID 格式、語言判斷；`woowtechPush` 經 protocol 解析後是 `true`；App 的 attention 訊息保有回覆預覽，交給 `deliver` 的推播只有通用句子；terminal 完成和等輸入的 `reason`。
- App：
  - `plugins/woowtech-ios-firebase.test.ts`：plist 從哪裡來，以及用 `expo-modules-autolinking` 自己的解析函式確認 RNFB 只在有 plist 的 iOS 連結、保留 build phase。
  - `plugins/with-woowtech-push.test.ts`：外掛只加 iOS 的設定，沒有 plist 時什麼都不做。`plugins/woowtech-metro-resolver.test.ts`：用真的 `metro-resolver` 確認包裝前會解析到網頁版的 `nativeModule.js`，包裝後是平台的檔。
  - `src/push-notifications/internal/` 的 `fcm-token.test.ts`、`fcm-token.ios.test.ts`、`fcm-token.android.test.ts`、`woowtech-notification-channels.test.ts`、`woowtech-subscriptions.test.ts`：注入有型別的假模組，不用 `vi.mock`。訂閱的測試涵蓋上面 App 的每一條規則；Android 那一項用真的 `fcm-token.android.ts` 配照 `PushTokenModule.kt` 行為的假 `expo-notifications`（取 token 時也發事件，事件在 token 之前或之後到），每次連線只註冊一次。通道的測試：兩個通道的 ID 和名稱（每種中文都是繁中，其他語言是英文），經 `expo-notifications` 用 `AndroidImportance.HIGH` 設定；訂閱的測試另外確認通道名稱跟著註冊換語言、daemon 沒連上時不改，沒有通知權限時不建立。
  - `src/utils/notification-routing.woowtech-push.test.ts`：兩種點擊資料都開到那個 agent 或 terminal，中繼的每日上限通知開到 `/`。
- 守門 `woowtech/push-content.test.mjs`：從原始碼跑沒有注入 `deliver` 的 `createPushNotifications`，`fetch` 換成記錄器，中英文各一次：只有一個請求，打到 `https://push.woowtech.io/api/smart/v1/notify`；位元組裡沒有 agent 名稱、回覆、權限內容、資料夾、terminal 名稱和工作區名稱；本文不隨內容改變；Expo token 被撤銷；`WOOWTECH_PUSH_RELAY_URL` 蓋得掉網址。注入記錄用的 `deliver`：交給它的標題和內文不含任何使用者的內容、不隨內容改變，`data` 只有 ID 和 `reason`（拿掉 `send()` 裡的 `toRemotePushPayload` 時，只有這一項會失敗）。用最小的 `this` 呼叫 `websocket-server.ts` 的 `broadcastTerminalAttention`：terminal 完成和等輸入的推播帶著 `reason`，中繼分別收到 `finished` 和 `attention`。另外掃描出貨的原始碼：Expo 的網址只在 `push-service.ts`，沒有任何地方 `new PushService` 或呼叫 `.sendPush(`，`push.woowtech.io` 只在 `woowtech-relay.ts`。
- 守門 `woowtech/push.test.mjs`，11 項，接點被蓋回上游時失敗：
  - 沒注入 `deliver` 的 `createPushNotifications` 只打 `WOOWTECH_PUSH_RELAY_URL`（本機的 `node:http` 假中繼），本文正好是那四個欄位，沒有放在標題、內文和 `cwd` 的標記字串。`fetch` 在載入原始碼之前就換掉，只放行假中繼，其他位址在本機回應並記下，接點被改回 Expo 時也不會真的送到 `exp.host`；`diagnostics_channel` 另外記下 undici 和 `node:http` 開出的請求。
  - daemon 的 server_info（從原始碼呼叫 `buildServerInfoStatusPayload`）經 protocol 的 `parseServerInfoStatusPayload` 解析後 `woowtechPush` 是 `true`。
  - App 送的 `register_push_token`（`wsp1:` 字串）經 protocol 的 `WSInboundMessageSchema` 解析，再用最小的 `this` 呼叫 `session.ts` 的 `dispatchMiscMessage`：字串原樣進到 push store，下一則推播交給 `deliver` 的就是它。上游在 schema 或 handler 加上 Expo token 的格式檢查時，這一項會失敗；App 的 `registerPushToken` 不等回應，否則只會靜靜地收不到推播。
  - `index.native.ts` 的 `startSubscription`、`revokeSubscription`、`turnOffExpoPushRegistration` 來自 `woowtech-subscriptions`，而且載入時就呼叫 `turnOffExpoPushRegistration()`；App 的原始碼沒有任何地方引用上游的 `subscriptions.ts`。
  - `woowtech-subscriptions.ts` 在 iOS 用 `woowtech-expo-registration.ts` 的 `disableIosExpoRegistration`（原生模組 `NotificationsServerRegistrationModule`）停用 Expo 登記，不落到 Expo 傳 `null` 的公開 API。
  - `getExpoPushTokenAsync` 只出現在上游的 `subscriptions.ts`（F-Droid stub 的定義那一行除外）。
  - 用 `expo-modules-autolinking` 自己的 `loadConfigAsync` 和 `resolveReactNativeModule`，每種情況開一個乾淨的子程序：Android 不連結 RNFB（有 plist 也一樣），iOS 正式版和 Debug 版沒有 plist 時不連結，有 plist 時連結並保留「[RNFB] Core Configuration」。守門讀的是 `expo-modules-autolinking/build/reactNativeConfig/` 的內部模組，升級 Expo 時如果搬家，守門會失敗，要改路徑。
  - `expo config --type prebuild`（正式版和 Debug 版，plist 變數各指向一個暫存檔和一個不存在的檔）：plugins 有 `[withWoowtechPush, { disableSPM: true }]`；`expo-build-properties` 的 `ios.useFrameworks` 是 `static`，`forceStaticLinking` 有 `RNFBApp`、`RNFBMessaging`、`react-native-paste-input`；`ios.googleServicesFile` 是給的那個 plist，檔案不存在時沒有這個欄位。少了外掛，iOS 照樣連結 RNFB，但 AppDelegate 沒有 `FirebaseApp.configure()`，App 靜靜地註冊不到推播。
  - `expo config --type introspect`（正式版和 Debug 版）產生的 Android manifest：`com.google.firebase.messaging.default_notification_channel_id` 是 `agent-finished`，`woowtech-notification-channels.ts` 建的通道是 `agent-attention` 和 `agent-finished`。F-Droid stub 有 `AndroidImportance.HIGH` 和 `setNotificationChannelAsync`。introspect 在記憶體裡跑 prebuild 會跑的 manifest 外掛，不寫出 `android/`；升級 Expo 後 `_internal.modResults` 搬家時，這一項會失敗，要改讀法。
  - 載入 `metro.config.cjs`（`woowtech-metro-resolver` 換成做記號的替身）：最後的 `resolveRequest` 是 `withNativeRnFirebaseModules` 包過的。包裝實際解析到哪個檔由 `plugins/woowtech-metro-resolver.test.ts` 檢查，也包括用 `metro.config.cjs` 本身解析。
  - 契約 fixture 在，合法和不合法的案例都跟 `validateRelayNotifyBody` 一致。

合併上游之後：

```bash
npm run build:server   # 守門從原始碼跑，但跨套件的匯入讀 dist
node --test woowtech/*.test.mjs
(cd packages/protocol && npx vitest run src/woowtech-push.test.ts src/messages.test.ts --bail=1)
(cd packages/server && npx vitest run src/server/push src/server/websocket-server.notifications.test.ts src/server/websocket-server.terminal-notifications.test.ts src/server/woowtech-attention-presence.test.ts src/server/woowtech-shutdown-push.test.ts src/server/woowtech-attention-fallback.test.ts src/server/woowtech-attention-fallback-daemon.test.ts --bail=1)
(cd packages/protocol && npx vitest run src/woowtech-attention-fallback.test.ts --bail=1)
(cd packages/app && npx --no-install vitest run src/utils/woowtech-notification-fallback.test.ts --project unit --bail=1)
(cd packages/desktop && npx --no-install vitest run src/features/woowtech-notification-settings.test.ts --bail=1)
(cd packages/app && npx vitest run plugins/woowtech-ios-firebase.test.ts plugins/with-woowtech-push.test.ts plugins/woowtech-metro-resolver.test.ts src/push-notifications src/utils/notification-routing.woowtech-push.test.ts --bail=1)
(cd packages/app && npx --no-install vitest run src/screens/workspace/missing-workspace-directory-demand.test.ts src/runtime/directory-sync/index.test.ts src/navigation/woowtech-workspace-open-intent.test.ts src/navigation/woowtech-welcome-host-online.test.ts src/navigation/woowtech-cold-start-tap.test.ts src/navigation/woowtech-notification-response.test.ts --project unit --maxWorkers=1 --no-file-parallelism --bail=1)   # T1，見下面的 T1、T1 S3、「配對後第一次點通知」和 RC-I-21c 小節
```

- 守門失敗時照訊息把接點改回來：預設 `deliver`、`woowtechPush` 旗標、`index.native.ts` 的 import 和載入時的 `turnOffExpoPushRegistration()`、`react-native.config.js`、`app.config.js` 的外掛、`expo-build-properties` 的 `ios` 和 `expo-notifications` 的 `defaultChannel`、plist 由 `iosGoogleServiceInfoPlist()` 決定、`metro.config.cjs` 最後那行包裝、F-Droid stub 的 `AndroidImportance.HIGH`。上游改了 `subscriptions.ts` 的註冊流程（例如新的時機或欄位），要照樣搬到 `woowtech-subscriptions.ts`。
- 升級 RNFB：檢查上面 iOS 外掛的路徑、`woowtech-metro-resolver.js` 改寫的 import、`firebase.json` 的鍵和 `forceStaticLinking` 的 pod 名稱。升級 Expo：檢查 static frameworks 和 SPM 的限制、Android 的點擊（SDK 55），以及守門讀的 autolinking 模組。

- 各種組合：新 App 加新 daemon 正常；新 App 加官方 daemon，不註冊，舊版 App 在那台 daemon 註冊過的 Expo token 在第一次連上時撤銷，之後不推播（撤銷沒送到的話，那台 daemon 會繼續送到 Expo，最多到舊 token 的 48 小時租約到期）；官方 App 或舊測試版加新 daemon，它們註冊的 Expo token 在第一次推播時被撤銷，不送出，更新 App 後重新註冊。
- 留在電腦上的通知照舊有內容：桌面版的系統通知和 App 裡的提醒，用的是 daemon 經自己的連線（直接連線，或端對端加密的 relay）送給 App 的 attention 訊息，裡面仍有回覆預覽和 terminal 名稱。手機 App 不顯示本機通知，只收推播。
- 中繼和 push.woowtech.io 在 2026-09-25 部署：中繼 `smart-mode` 的 `dff78a1`，Cloud Run `smart-push`（`woowtech-smart`、asia-east1，revision `smart-push-00001-8v9`），前面是 Worker `smart-push-proxy`（自訂網域 push.woowtech.io，workers.dev 和 Workers Logs 都關掉）。還沒做的是實機驗收，見「接下來」。

#### T1：通知指向尚未載入的工作區

- C-020 的 Android 既有取證（2026-09-26，非本次修法驗收）：三次卡住時 host、workspace、route key 都正確，但 store 沒有 descriptor、沒有 tab，full demand 為 0、agent route demand 為空，daemon 沒收到 `fetch_workspaces`。只開側欄、不點列就取得 descriptor，同 key 在 8–230 ms 內變 ready，接著消費 agent intent。重裝後首次尚未 hydrated 的「Loading workspace」也由只開側欄解除。這排除了 epoch 去重、#5079、key 和 memo 的先前猜測。
- 根因是未知工作區等 descriptor 才建 tab，沒有 tab 就沒有 agent demand；原 `prepareWorkspaceRoute` 只查 cache。`screens/workspace/use-missing-workspace-directory-demand.ts` 補上暫時的目錄 owner：聚焦且缺 descriptor 時持有既有 `acquireDirectoryDemand`，不等首次 hydration，也不因離線提早放棄；descriptor 到達、失焦或卸載時釋放。已知工作區、cache 準備與原 agent intent／subscriber 交接不改，不加 probe、路由或 protocol。
- 審查找到的 race（2026-09-27 修）：hook 是這台主機唯一的 directory demand 時，descriptor 一到就釋放，這時它自己那次 refresh 還沒結束：`refreshAll()` 最後在等工作區標籤的訂閱，裝置上 descriptor 到達後還要 1.4–2.25 秒。釋放讓 `releaseSubscriptions()` 丟掉所有 live subscription，refresh 結束時卻照樣把這個連線 epoch 記成已滿足。之後直到重連，這台主機的工作區和 agent 清單不再更新，開側欄也不 refresh，同一個連線裡第二則指向另一個新工作區的通知又卡在「Workspace unavailable」。先前裝置測試沒遇到，是因為 agent 清單比 descriptor 早約 100 ms 到，tab 先接手了 demand。
- 修法在上游檔 `runtime/directory-sync/index.ts`（連同下一點共 +14／−2 行，註解以 `woowtech smart:` 開頭），hook 不變、仍在 descriptor 到達時釋放：`releaseSubscriptions()` 每次把 `subscriptionGeneration` 加一；demand refresh 開始時清掉已滿足記號，成功而且期間 generation 沒變才記成已滿足；結束時不論成敗，只要期間 generation 變了又有 demand，就再 refresh 一次。例如 tab 的 route demand 在釋放後才加入同一次 refresh；或從缺工作區 A 切到缺工作區 B：A 的釋放讓還在等的訂閱失敗，B 在同一個 tick 加入那次注定失敗的 refresh。失敗的 refresh（包括換掉原本 live 訂閱的 pull-to-refresh）不留下已滿足記號，也不自己重試；訂閱請求逾時會讓 client 斷線，由重連 refresh 一次；一直等不到的已刪除或封存工作區，每個聚焦期間、每個連線只 refresh 一次（離開再回來會再 refresh 一次）。
- 失敗後有 owner 加入就重試（2026-09-27 第 2 輪）：hook 持有 demand 時 refresh 失敗而連線沒斷（daemon 回錯誤，或 `listProjects`、第二頁這類非訂閱請求逾時），原本開側欄不會再 refresh，因為 `setDemand` 只在 full demand 從 0 變 1 時 refresh；T1 之前，開側欄就是那次 0 變 1。現在 `setDemand` 在已有 full demand 時又有 owner（側欄、專案清單這類 `acquireDirectoryDemand`）加入，只要在線就呼叫 `requestDemandRefresh()`：已滿足直接返回，refresh 進行中就併入，所以只有這個連線還沒滿足時才多送一次請求。沒有 owner 加入時，失敗的 refresh 仍不自己重試，要用側欄的重新整理、重連，或離開再進入。
- 這是上游本來就有的潛在 race，跟 fork 無關：側欄在自己那次 refresh 結束前關掉，同一個連線裡再打開也不 refresh。`missing-workspace-directory-demand.test.ts` 的「upstream: a sidebar reopened after closing mid-refresh…」不經 fork 的 hook 重現它，可以連同 `index.ts` 的差異回報上游。同一段還有一個上游行為沒改：demand 在 refresh 中途離開時，還在等的 agent 訂閱以「Subscription released」失敗，agent 目錄狀態停在錯誤，直到下一個 demand 再 refresh。T1 在 descriptor 比 agent 清單早到時會碰到（裝置上 agent 清單通常早約 100 ms 到）；回報時可以建議把 DirectorySync 自己釋放造成的失敗當成 superseded。
- 另外一個上游本來就有的缺口，fork 不修：
  - 孤兒訂閱：demand 在 refresh 送出訂閱之前就離開（例如同一個 tick 內 acquire 再 release），`fetchAgents` 和 `fetchWorkspaceSnapshot` 照樣訂閱，留下沒有 demand 的 agents、workspaces 訂閱各一條。不會累積，下一個 demand 的 refresh 會換掉，全部釋放後歸 0。T1 主流程碰不到：descriptor 到了才釋放，那時訂閱已經建立。回報上游時可以建議這兩個函式在 generation 已變或沒有 demand 時不再訂閱。「witness: a demand that leaves before its refresh subscribes…」斷言現況：同一個 tick 內 acquire 再 release，剩 2 條訂閱。上游改成不訂閱時它會紅，確認後連同這一點刪掉。
- 維護接點：`workspace-screen.tsx` 的 import 和 cache prepare effect 旁的一次 hook 呼叫，以及 `directory-sync/index.ts` 的 `subscriptionGeneration` 和 `setDemand` 的加入重試。合併上游時保留 hook 的 host／workspace／focus／descriptor-presence 四個依賴與 effect cleanup 回傳；上游改寫 `requestDemandRefresh`、`releaseSubscriptions` 或 `setDemand` 時，保留四件事：refresh 開始時清掉已滿足記號、期間丟過訂閱就不算滿足、期間丟過訂閱而結束時又有 demand 就再 refresh 一次、已有 demand 時新加入的 owner 也要求 refresh。上游自己的 `releaseSubscriptions()` 也必須清掉已滿足記號：refresh 結束後才釋放的非 race 路徑（沒有標籤的主機，或標籤比 React cleanup 早到）靠它，同一個連線的第二則通知、離開再回來才會再 refresh。這一行由 vitest 的「directory demand that leaves after its own refresh finished」和「leaving a deleted or archived workspace and coming back…」守，原始碼守門不看。純 acquisition seam 的測試使用真實 HostRuntimeStore、DirectorySync、DaemonClient 和 typed memory ports（假主機可以支援工作區標籤並延後標籤回覆、延後 agent 清單，或對工作區請求回錯誤；跟真的 daemon 一樣，只有帶 subscribe 的請求才開訂閱），斷言序列化 RPC、訂閱釋放、首次 hydration、新 epoch、agent target，以及上面的 race、非 race、失敗、逾時和不迴圈。race 案例等到「有一個被扣住的標籤請求」（`heldLabelRequests()`）才讓 demand 離開，不數標籤請求總數：合併上游 #5079 後，連線時就會先要一次標籤，那次照常回覆。agent tab 最後離開的案例用 `timeline.dispose()` 結束 route demand：上游 #5040 讓隱藏的 chat 在 tab 關掉前仍保留訂閱，合併後只把可見清單設成空的，route demand 不會歸零，案例會卡在等訂閱歸零，量不到 race。`woowtech/workspace-directory-demand.test.mjs` 只守原始碼：hook 呼叫必須是 `WorkspaceScreenContent` 本體的直接陳述式（不在 if、?:、&&、區塊或 callback 裡），前面沒有 early return，descriptor-presence 傳 `Boolean(workspaceDescriptor)`（跟 cache prepare effect 一樣看真值，查不到時不管回 `null` 還是 `undefined` 都算缺）；hook 自己的 `useEffect` 也必須是 hook 本體的直接陳述式，前面沒有 early return；`index.ts` 的 generation 遞增和上面四件事都在，每個把連線記成已滿足的寫入都在 generation 比對之下。它不能當成 hook runtime 或 GUI 證據。上游如果用別的寫法修好這個 race，這個守門會紅：先確認拿掉 fork 的修法後 T1 vitest 仍全綠，再改守門。
- 首次修法（`ff410974f`）的紅綠：兩個現況見證先綠；cache-only 基線對「owner 應發 request」斷言得到 0 而非 1，補 demand 後 14/14 綠、接線守門 2/2 綠。八個定向突變都 exit 1（cache-only、少 focus、少 missing、丟 cleanup、等 hydration、拔 hook、漏 descriptor dependency、effect 不回 cleanup），還原後再驗。測試 adapter 的 metadata／wire 欄位錯誤與測試期待值修正不算修法紅燈。修後 Android 三情境仍由 Claude 排程；沒有新增裝置驗收結論。
- S1 的「工作區不可用」閃爍（fixes-0928）：通知指向 App 在背景時建立的工作區，App 回前景時重連，工作區清單在新連線的目錄刷新裡才到；在那之前 `hasHydratedWorkspaces` 早就是 true（背景前載過），畫面照舊判定工作區不見了，recovery inspect 也照送，daemon 回 `workspace_not_archived`（工作區在，只是沒封存），「工作區不可用」閃 0.6–0.9 秒後才變成 Agent（`logs/integ0927-android-s1-*.txt`）。
  - 修法：`DirectorySync` 在一次 demand refresh 結束、而且這條連線不會再有下一次時（成功或失敗都算），經新的 callback `markDemandRefreshSettled` 通知 controller；snapshot 多一個選填欄位 `demandRefreshSettledFor`（這次結束的是哪一條連線）。`screens/workspace/woowtech-workspace-directory-settled.ts` 只在它跟目前連線（`clientGeneration`、`connectionEpoch`）相同時算「已結束」。`workspace-screen.tsx` 用「已 hydrate 而且這條連線的刷新已結束」取代原本只看 hydrate 的兩處：要不要做 recovery inspect，以及路由狀態。之前的連線結束的不算，所以重連後要等新連線的刷新；刷新失敗也算結束，畫面不會一直轉圈；離線時照舊是「無法連線到主機」。
  - 上游檔：`runtime/directory-sync/index.ts`（callback 型別和 `finally` 裡的一個 else-if）、`runtime/host-runtime.ts`（snapshot 欄位、controller 方法、兩處建立 `DirectorySync` 的 callback）、`workspace-screen.tsx`（一次 hook 呼叫和兩個參數），註解以 `woowtech smart:` 開頭。上面守門要求的單一 `finally` 和 generation 重試判斷不變。
  - 測試：`screens/workspace/woowtech-workspace-directory-settled.test.ts` 用 T1 的記憶體主機（真的 HostRuntimeStore、DirectorySync、DaemonClient）：S1（重連的刷新還在等時是「載入中」，資料到了變 ready；原本只看 hydrate 會是「工作區不可用」）、主機真的沒有這個工作區時最後仍是「工作區不可用」、刷新失敗後照樣判定、離線是無法連線，新連線要等它自己的刷新。裝置上的 S1 在定向輪（integration-0928）重驗過，見「驗證紀錄」。

定向檢查就是本節「合併上游之後」的 `node --test woowtech/*.test.mjs` 和 T1 那行 vitest；依賴與 dist 已備妥時不需 build。

#### T1 S3：從根層畫面經通知進入工作區後，之後的通知停在前一個 agent

- Android（2026-09-27，`logs/ultra-device.md` 的 S2、S3、S3b、S3c）：重裝後停在主機首頁，點新工作區的通知（S2），T1 讓它載入後開出 agent X。同一個 App 行程裡再點已知工作區 B 的通知（S3），B 先加了通知的 agent，接著又加進 X 並聚焦，畫面停在 X；換成另一個已知工作區也一樣（S3b）。重開 App 行程就正常（S3c）。T1 之前 S2 一直卡在 Loading workspace，意圖從來沒被消費，所以碰不到這條路。
- 原因在上游，跟 fork 的推播無關：中繼只換了送達的路，點擊照樣走上游的 `PushNotificationRouter`、`navigateToAgent`、`navigateToWorkspace`。
  - 重裝後主機還沒有上次的工作區，主機首頁是根層的 Open Project（`/open-project`，歡迎頁連線後也是 `router.replace` 到這裡），根 stack 沒有 `h/[serverId]`。工作區未知，`navigateToWorkspace` 把 agent 延後成 `?open=agent:X`；`navigateToHostWorkspaceRoute` 找不到掛著的主機路由，改用 `router.dismissTo`。
  - expo-router 6.0.23 在根 stack 分歧時用 `getPayloadFromStateRoute` 組 action：每一層的 params 都併進更深路由的 params，所以新建的 `h/[serverId]` 路由也帶著 `open`。在根層畫面點 terminal 通知（`router.navigate(buildNotificationRoute(...))`）一樣會帶。
  - 工作區路由 `app/h/[serverId]/workspace/[workspaceId]/index.tsx` 原本用 `useGlobalSearchParams` 讀 `open`，那是從根到葉合併每一層 params 的結果；消費後只用 `navigation.setParams` 清掉自己那份。之後每次 `dismissTo` 換工作區，工作區路由的 params 整個換掉，主機路由那份又露出來。消費 key 含 workspaceId，於是當成新意圖，在新工作區加開並聚焦 X，直到 App 行程結束。
  - 上游 `5e5fc9779`（2026-05-06）把消費從 `workspace/[workspaceId]/_layout.tsx` 搬到葉路由時沿用了 `useGlobalSearchParams`：搬之前 `open` 在 layout 底下的子路由，layout 才需要合併的 params。merge-base `836f1a9c2` 到 upstream/main `d7b7016cc` 沒動這兩個檔，歷史裡也沒有相關修正。terminal 通知在上游不需要 T1 就碰得到，可以回報上游。
- 修法：工作區路由只讀自己路由上的 `open`。`index.tsx` 拿掉 `useGlobalSearchParams`，改從 `useLocalSearchParams` 經 fork 的 `navigation/woowtech-workspace-open-intent.ts`（`readWorkspaceRouteOpenParam`）取值（+4／−4 行，註解 `woowtech smart:`）。每一條進入的路，工作區路由自己都帶著 `open`：解析網址時 query 只放在葉路由，攤平時葉路由也有一份，`dispatchHostWorkspacePopTo` 只放在巢狀的 params。主機路由那份還在，但沒有人讀；網址列只序列化葉路由的 params。
  - 沒採用：清主機路由的 `open`（`getParent().setParams`）。React Navigation 7.16 看到父路由換成新的 params 物件，會用裡面的 `screen`／`params` 再導覽一次子 stack，把人帶回 S2 的工作區，`open` 也跟著回來。也沒採用只改 `navigateToHostWorkspaceRoute`：terminal 通知不經過它。
- 測試：
  - `navigation/woowtech-workspace-open-intent.test.ts`（7 個）：reader 本身；S1（從工作區畫面點通知，`open` 只在工作區路由）；S2；S3（B 只開通知的 agent）；換到別的工作區再回來都不重開 X；在 Open Project 點 terminal 通知後換工作區，terminal 不跟過去；見證：主機路由的 params 跟裝置的 navstate（`logs/ultra-device-s3b.txt`）一樣，用合併的 params 讀會在 B 的通知 agent 之後再加開 X，就是裝置上的樣子。
  - `navigation/woowtech-workspace-open-intent.test-support.ts`：用真的 App 通知與導覽程式（`resolveNotificationTarget`、`resolveNavigateToAgent`、`navigateToWorkspace`、`navigateToHostWorkspaceRoute`、`buildNotificationRoute`、`prepareWorkspaceTab`）、React Navigation 的 `StackRouter`，以及 expo-router 從 `src/app` 檔名建出的路由樹。expo-router 的路由模組會載入 react-native，unit project 載不起來（`vitest.setup.ts` 也 mock 了 `expo-router`），所以 `router.navigate`、`router.dismissTo` 的 action（`findDivergentState`、`getPayloadFromStateRoute`）和 `useGlobalSearchParams` 的合併照 6.0.23 的原始碼轉寫。另外模型化兩段：巢狀 navigator 依父路由的 `screen`／`params` 啟動，以及工作區路由的 open-intent effect。升級 expo-router 時，對照 `build/global-state/routing.js` 和 `routeInfo.js` 更新轉寫。
  - 守門 `woowtech/workspace-open-intent.test.mjs` 只看原始碼：工作區路由沒有 `useGlobalSearchParams`，`openValue` 是 `readWorkspaceRouteOpenParam` 讀 `useLocalSearchParams` 的結果。vitest 裡的路由讀法照這一行寫，所以把 `index.tsx` 改回上游時，紅的是守門。
- 合併上游：上游改成讀自己的 params，或用別的方式修好時，先確認新測試仍綠，再拿掉 fork 的讀法和守門。

#### 配對後第一次點通知：底下的歡迎頁把工作區換掉

- Android（2026-09-29，`logs/integ0929-real-android.md` 的 run 1 和 mock 對照 M1）：全新 App 用 relay 配對連結加第一台主機、允許通知後進背景。daemon 約 50 秒後關掉連線，約 190 秒後新工作區的 agent 要授權。點「需要你的授權」後 App 重連，卻停在主機首頁（新增專案／匯入工作階段），75 秒內沒有授權卡：lastSelection 是新工作區但 layout 沒有 agent 分頁，router 在 `/open-project`，root stack 是 `[welcome, open-project, *open-project]`。冷啟動後 stack 沒有歡迎頁，同樣的點擊 8.6 秒開出 agent、12.7 秒出現授權卡。
- 原因在上游，跟 fork 的推播無關：
  - `components/welcome-screen.tsx` 的 effect 在 `anyOnlineServerId` 由 null 變成某台主機時 `router.replace(buildOpenProjectRoute())`。expo-router 6.0.23 的 `replace` 不帶 `source`，React Navigation 7.5.3 的 `StackRouter` 換掉的是 stack 最上面那一頁，不是呼叫的那一頁；native stack 不卸載被蓋住的頁，歡迎頁在底下時照樣換。
  - 歡迎頁會被埋在底下：配對連結（第 19 節）進來時，expo-router 的 linking 先把 index 推到歡迎頁上面，`OfferLinkListener` 的 `openProject` 換掉的是那一頁；上游 App 內的「掃描 QR」（歡迎頁的主要按鈕）也是 push `/pair-scan` 再換成主機。兩條路都留下 `[welcome, open-project]`。只有歡迎頁自己的「直接連線」「貼上配對連結」視窗換掉的是歡迎頁本身。
  - 點通知時主機還離線：工作區未知，`navigateToWorkspace` 記住新工作區、把 agent 延後成 `?open=agent:X`，`dismissTo` 把工作區路由放到最上面。主機一上線，底下的歡迎頁就把它換成 `/open-project`，T1 的目錄還沒到，意圖沒被消費。不只通知：歡迎頁在底下時，每次背景回前景重連，使用者正在看的那頁都會被換掉。裝置上多的那層 `open-project`，是 run 1 之前從設定返回時 `returnFromSettings` 換上的。
  - 上游 `68df30486`（2026-03-26）加入這個 effect；`d8243bfb7`（04-01）加過只看 `window.location` 的 `/welcome` 判斷，`5c3cc99d8`（04-18）拿掉；`a49c658d1`（06-26）目標改成 `/open-project`。main `ea9f49e49`、upstream/main `4965af219` 都一樣，不是回歸。9/27 第 5 步沒遇到，是因為那個 App 的第一台主機是在歡迎頁用「直接連線」加的，歡迎頁已經被換掉。
- 修法：歡迎頁只在自己是 focused 畫面時轉頁。fork 的 `navigation/woowtech-welcome-host-online.ts`（`shouldWelcomeMoveOnToHost`）判斷「有主機上線而且 focused」；`welcome-screen.tsx` 加 `useIsFocused`，effect 先問它，依賴加 `isFocused`（+4／−2 行，註解 `woowtech smart:`）。被蓋住時主機上線不動；之後返回露出歡迎頁、主機還在線，就照舊轉到 `/open-project`，例如從歡迎頁的設定加主機再返回（上游是在設定頁裡直接被換走）。
  - 沒採用：只讓配對連結把歡迎頁移出 stack，上游的 QR 掃描一樣會留下；只在有待開的通知時不轉，重連時換掉使用者畫面的問題還在。
- 測試：
  - `navigation/woowtech-welcome-host-online.test.ts`（4 個）：run 1 的路徑（全新 App、配對連結、背景斷線、點權限通知、主機重新上線、目錄到）開出 agent；見證：換成上游的 effect、照 run 1 的步驟（含設定來回），得到裝置記下的 stack `[welcome, open-project, *open-project]`（`logs/integ0929-real-android-tap-probe.txt`），記住的是通知的工作區，沒有 agent 分頁；歡迎頁在最上面時主機上線照樣轉頁；從歡迎頁開設定時主機上線，設定頁不被換掉，返回後轉頁。
  - 共用 T1 S3 的 `woowtech-workspace-open-intent.test-support.ts`：加了 `/`、`/welcome`、`/settings`，`router.push`／`replace` 的 action（沒有 `source`）、返回，以及歡迎頁 effect 的模型，每個掛著的歡迎頁在依賴改變時重跑。
  - 守門 `woowtech/welcome-host-online.test.mjs` 只看原始碼：`isFocused` 來自 `useIsFocused`，`WelcomeScreen` 裡唯一會轉頁的 effect 第一行問 `shouldWelcomeMoveOnToHost({ anyOnlineServerId, isFocused })`，依賴有這兩個。vitest 的歡迎頁 effect 照這幾行寫，所以把 `welcome-screen.tsx` 改回上游時，紅的是守門。
  - 紅綠與突變：修之前主案例的焦點是 `open-project`、設定那個案例也紅，修後 4/4；拿掉修法時 vitest 2 個紅、守門紅，依賴拿掉 `isFocused` 時守門紅。Android 模擬器複驗見 `logs/fix-first-tap.md`。
- 合併上游：上游改成只在 focused 時轉頁，或拿掉這個 effect 時，先確認新測試仍綠，再拿掉 fork 的判斷和守門。

#### 誰收到 agent 和 terminal 的通知

上游的規則（`agent-attention-policy.ts`）：每個連著的 App 用 heartbeat 回報裝置種類（手機是 `mobile`，網頁和桌面版都是 `web`）、`appVisible`、正在看的 agent 和 terminal、最後一次操作的時間。最後一次操作在 180 秒內的算「在場」。有人在場而且正看著那個 agent，誰都不通知；有人在場就只讓最近操作的那一個顯示 App 內或桌面的通知，不推播；沒人在場才推播。fork 改了兩條（owner 2026-10-05 同意）：

- 背景中的手機不算在場：手機 App 只靠推播，不顯示 App 內通知，上游卻在它切到背景後 180 秒內仍選它當通知對象，結果什麼都沒有。`woowtech-attention-presence.ts` 的 `woowtechClientPresenceState()` 把 `mobile` 而且 `appVisible=false` 的 App 當成沒有活動時間；網頁和桌面版照上游（桌面版在背景仍會跳系統通知）。只改 daemon，舊版 App 也有效，因為兩個欄位本來就有送。
- daemon 停止時不通知：停 daemon 會關掉每個 agent，正在跑的 agent 被中斷後從 running 變 idle，上游當成「完成」，每個 agent 多推一則「工作完成了」；等權限的 agent 也會再推一次。`websocket-server.ts` 的兩個 attention 廣播在第一個 `await` 之前讀 `connectionLifecycle === "stopping"`（`bootstrap` 的 `stop()` 先呼叫 `prepareForShutdown()` 再關 agent），停止中交給 `woowtechNotificationPlanWhileStopping()`，誰都不通知；attention 事件本身照送。
- 桌面版和網頁的視窗沒有焦點就不算「正在看」（owner 2026-10-05 的決定 (c)）：上游的 `appVisible` 只看分頁有沒有被藏起來，視窗開著那個 agent、你卻在用別的 App 時，daemon 當成你正在看，Mac 和手機都不通知。`use-client-activity.ts` 改用上游自己的 `getIsAppActivelyVisible()`（看得到而且有焦點；手機照舊看 AppState），視窗的 `focus`／`blur` 也更新，切走和切回來都馬上送 heartbeat（不經 5 秒的操作節流），每次定時 heartbeat 前也重讀一次焦點，掛上 listener 之前錯過的焦點變化不會一直卡著。daemon 的 `appVisible && focusedTerminalId` 清 terminal 提醒也跟著改成要有焦點。
- Mac 顯示不出通知時改推手機（提案 4，owner 2026-10-05 同意；2026-10-06 加上 B：沒人理就補推）：daemon 只交給一個在場的用戶端顯示，不推播；Mac 的通知被關掉、還沒按允許、或 5 秒沒結果時，什麼都不會出現。現在：
  - daemon 交出通知時記下來（`woowtech-attention-fallback.ts`）：agent 用 agent ID 加這則訊息的 `timestamp`，terminal 用 terminal ID（同一個 terminal 只留最新的），也記下交給哪個 session。只記可以推播的（`error` 本來就不推），停止中本來就沒有對象。最多 64 則、60 秒。
  - App 的 `sendOsNotification` 回報沒顯示（桌面版是 `failed` 或 5 秒 `unconfirmed`，丟出錯誤也算）時，`utils/woowtech-notification-fallback.ts` 送 `attention.notification.report_display_failure.request`。手機不送：手機本來就只靠推播。只送給 `server_info.features.woowtechAttentionFallback` 是 true 的 daemon，官方 Paseo 不會有。
  - daemon 只在回報的是當初那個 session、60 秒內、還沒處理過時推一次，回 `pushed`；否則回 `unknown` 或 `expired`。沒有任何手機登記推播（`push/index.ts` 的 `hasActiveTokens()`）時不推，回 `no_device`，側欄提示不提手機。舊 App 不回報，行為跟以前一樣。
  - 不靠偵測（owner 2026-10-06 決定 B）：10/6 在 macOS 26 實測，通知在系統設定被關掉或樣式是「無」時，Electron 的 `show` 事件照樣成功，系統只記 `Presenting … as none`，App 偵測不到，上面的回報不會觸發。所以交給電腦（`deviceType: "web"`：桌面版、瀏覽器）的通知另外等：`ATTENTION_ESCALATION_MS`（3 分鐘，環境變數 `WOOWTECH_ESCALATION_SECONDS` 可改，0 關掉）後再看一次，還沒人理就把原本略過的推播送給手機，一則只推一次（判斷在 `woowtech-attention-escalation.ts`，計時放在 `woowtech-attention-fallback.ts` 的帳本裡）。
  - 「有人理」：接收的用戶端在通知之後有輸入（桌面版的活動時間含系統閒置時間，所以在電腦前用任何 App 的鍵盤滑鼠都算）、可見的 App 正看著那個 agent 或 terminal、agent 的 attention 被清掉（看過或點過通知）、權限請求已回答、agent 不見了。接收的用戶端斷線（睡眠、結束）算沒人理。手機收到的通知不等。到期時沒有任何手機登記推播就什麼都不做。回報失敗和等待誰先到誰推，只推一次。daemon 停止時（`prepareForShutdown`）所有等待取消。
  - 桌面版同一次啟動第一次沒顯示時，側欄出現提示（`desktop/woowtech-notification-display-callout-source.tsx`，文案在 `i18n/woowtech-copy.ts` 的 `notificationDisplay`，只有繁中和英文）。daemon 回 `pushed` 才說「已改送到你的手機」；daemon 沒有旗標（舊版或官方 Paseo）時說這台主機無法改送、請更新；其他情況不提手機。只要這次啟動有一則改送成功，提示就一直這樣說。按鈕用固定網址開系統的通知設定（`desktop/src/features/woowtech-notification-settings.ts`：macOS 的 `x-apple.systempreferences:com.apple.Notifications-Settings.extension`、Windows 的 `ms-settings:notifications`；preload 只在這兩個平台提供，Linux 沒有按鈕）。一般的 `paseo:opener:openUrl` 仍只開 http(s) 和 mailto。關掉提示只到這次結束。
  - terminal 的通知沒有 timestamp，同一個 terminal 只記最新一則：第一則 5 秒沒結果、第二則 2 秒後已顯示時，第一則的回報會推出第二則的內容。很少見，照設計；要分得清楚，得在上游的 `terminal_attention_required` 加通知 ID。
  - 樣式設成「無」（只進通知中心）、通知關掉或專注模式時，系統回報已顯示，App 看不出來，改由等待補推：電腦前沒有動靜、也沒人點，3 分鐘後手機收到；這段時間有任何鍵盤滑鼠活動就不推。
- 全新安裝時通知預設是關的（2026-10-07 用沒見過的 bundle ID 實測，ACCEPTANCE 第 4b 層）：第一次啟動時，上游的 `ensureNotificationCenterRegistration()` 送出啟動探測通知，系統跳出「允許通知」提示。在有人按允許之前，通知都被系統以「無」處理，`show` 照樣成功，App 收到 `shown`。Electron 44 沒有讀取通知授權狀態的 API，App 自己偵測不到。
- 請使用者確認（A，owner 2026-10-07 同意，跟上面的補推一起）：
  - 設定 → 通知的「傳送測試通知」在系統回報顯示後問「你有看到通知橫幅嗎？」。有看到：記在這台電腦（AsyncStorage `@woowtech:notification-banner-confirmed`），那一列下面顯示「已確認」。沒看到，或系統直接回報失敗、5 秒沒結果：說明到「系統設定 → 通知」打開 woowtech smart、選橫幅或提示、確認專注模式沒開，附「打開通知設定」和「再測一次」。狀態在 `utils/woowtech-notification-banner-check.ts`，畫面在 `desktop/components/notification-banner-check-prompt.tsx`。
  - 桌面版側欄（`desktop/woowtech-notification-banner-check-callout-source.tsx`，priority 100，比「這台電腦沒有顯示通知」的 200 低）：這台電腦還沒確認過就出現「確認通知會跳出來」，按「傳送測試通知」後換成同一個問題和說明。回答有看到，或按 ✕ 關掉（`dismissalKey`，記在這台電腦），之後都不再出現。設定頁和側欄共用同一個狀態，在哪裡回答都算。側欄一次只顯示一個提示，同樣優先順序時先登記的贏，而這個提示每換一次內容就重新登記：問問題和說明的時候優先順序是 250（worktree 設定是 100、「這台電腦沒有顯示通知」是 200、Rosetta 是 300），回答到一半不會被別的提示蓋掉（2026-10-07 驗收版上被 worktree 設定的提示蓋掉過）。
  - 回答沒看到，或系統回報測試失敗，就取消之前的「有看到」（狀態和 AsyncStorage 都清掉）：橫幅現在不會跳，設定頁不能同時顯示「已確認」和「通知沒有跳出來」。
  - 文案在 `i18n/woowtech-copy.ts` 的 `notificationBannerCheck`，只有繁中和英文。測試：`utils/woowtech-notification-banner-check.test.ts`、`desktop/components/notification-banner-check-prompt.test.tsx`、`desktop/woowtech-notification-banner-check-callout-source.test.tsx`；守門 `woowtech/desktop-notifications.test.mjs`。
- 接點：`websocket-server.ts` 的 import、`getClientActivityState` 回傳 `woowtechClientPresenceState(activity)`、兩個 attention 廣播外面包 `woowtechNotificationPlanWhileStopping`、交出通知時的 `remember`、terminal 推播抽成 `sendPush`、`woowtechAttentionFallback` 旗標和傳給 Session（+61／−20 行）；`session.ts`（選項、欄位、`dispatchMiscMessage` 的一個 case，+18 行）；`authorization/operation-permissions.ts`（+4 行）；protocol `messages.ts`（import、兩個 union、旗標，+11 行）；client `daemon-client.ts`（兩個方法，+20 行）；App `session-context.tsx`（+24／−1 行）、`_layout.tsx`（+3 行）、`desktop/host.ts`（+2 行）、`hooks/use-client-activity.ts`（+14／−3 行）；desktop `preload.ts`、`features/notifications.ts`（各 +3 行）。
- 測試（改推手機和焦點）：server `woowtech-attention-fallback.test.ts`（記錄、只認原來的 session、只推一次、過期、terminal 只留最新、上限 64）和 `woowtech-attention-fallback-daemon.test.ts`（行程內真的 daemon：桌面版在場、收到 `shouldNotify`、別的用戶端回報是 `unknown`、自己回報後推一次、再報是 `unknown`）；protocol `woowtech-attention-fallback.test.ts`；App `utils/woowtech-notification-fallback.test.ts`（手機不報、已顯示不報、舊 daemon 不送、送不到不丟例外、提示只通知一次）；desktop `features/woowtech-notification-settings.test.ts`。守門 `woowtech/attention-fallback.test.mjs` 看所有接點和焦點規則。突變：拿掉 `remember` 時 daemon 測試紅（`unknown`），拿掉手機的排除時 App 測試紅。
- 測試（在場和停止）：`woowtech-attention-presence.test.ts`（presence 對應和停止中的 plan）、`woowtech-shutdown-push.test.ts`（行程內的 daemon 真的停止：修之前推出 `['permission','finished']` 和 `['finished']`，修之後 0 則）、`websocket-server.notifications.test.ts` 和 `websocket-server.terminal-notifications.test.ts` 各加的案例。守門 `woowtech/attention-presence.test.mjs`：接點被改回上游時失敗。
- 測試（沒人理就補推）：server `woowtech-attention-escalation.test.ts`（等待秒數、誰要等、什麼算有人理）、`woowtech-attention-fallback.test.ts` 的 `a computer's notice nobody deals with`（假計時器：到期才推、推一次、有人理不推、先回報不重複、過期回報不取消、沒手機不推、關掉等待、取代、上限 64、停止時取消）、`woowtech-attention-fallback-daemon.test.ts` 加 4 個（行程內真的 daemon，等待 1 秒：沒人理推一次、之後有輸入不推、看過 agent 不推、等待關掉不推）。守門 `woowtech/attention-fallback.test.mjs` 加一個。紅綠：把「有人理」的判斷拿掉，1 個帳本測試和 2 個 daemon 測試失敗。
- 還要實機：手機切到背景後約 30 秒和 120 秒觸發，兩支手機都要收到推播；Android 的連線在背景保持多久、iOS 多久斷，還沒量過。Mac 簽章的打包版：橫幅、點通知、關窗後點、App 結束後點、視窗開著沒焦點、看著同一個 agent 都在 10/6 測過（ACCEPTANCE 第 4b 層）；系統關掉通知後 3 分鐘補推手機，要讓 Mac 的 App 連 daemon B（有 POCO 的推播）實測。點進桌面版內建瀏覽器的網頁（`<webview>`）時，`document.hasFocus()` 可能是 false，要確認這時不會被當成離開（terminal 通知照跳、提醒不清掉）。

#### RC-I-21c：冷啟動點通知，工作區對了，聚焦的卻是上次記住的 agent

- iOS（2026-09-30 上架候選驗收，舊 Mac 的 `rc0930-ios.md`，`33f2fa8ac`）：App 被滑掉後點 agent B 的通知，開到對的工作區，聚焦的卻是之前記住的 agent A。點到別的工作區時，聚焦那個工作區上次的 agent。同一條 JS 路徑 Android 也走。
- 原因在上游，跟 fork 的推播無關，是兩條上游規則疊在一起：
  - 冷啟動時 `PushNotificationRouter` 在根 layout 第一次 commit 就讀啟動的那次點擊，那時主機清單還沒載入、沒有 session。`navigateToWorkspace` 認不得工作區，把 agent 延後成 `?open=agent:B`。
  - 工作區路由在 `hasHydratedWorkspaces` 之前不消費 agent 意圖（上游 `5da6548af`，#2002，2026-07-16，給封存工作區的 recovery 用）。這個旗標只有 live 目錄的 snapshot 會設。後來加的目錄快取（`workspace-replica.ts` 的 `commitCached`／`commitCachedWorkspace`：上游 #3907 加入，之後經 #3975、#4160、#4421 和撤回 #4421 的 #4436 調整）在主機清單載入後就讓工作區存在，但不設這個旗標。
  - 等的期間路由照樣畫工作區，分頁和聚焦來自持久化的 layout，所以是 A。live snapshot 到了才換成 B，主機連不上時一直停在 A。熱啟動不等：工作區已經在 store，`navigateToWorkspace` 直接開分頁。
  - 一起修的另一個上游缺口：`expo-notifications` 的原生模組一直留著最後一次點擊，App 從不清掉，`PushNotificationRouter` 用 `useRef` 去重，remount 就重置。根 error boundary 的 Reload 或 Fast Refresh 之後會重播那次點擊，把使用者拉回已經離開的 agent。真正的冷啟動碰不到這條。
- 修法：
  - fork 的 `navigation/woowtech-workspace-open-intent.ts` 加 `isAgentOpenIntentWaitingForWorkspace`：agent 意圖只在 store 不認得工作區時等，快取來的也算認得。工作區路由 `index.tsx` 改用它（註解 `woowtech smart:`）。沒見過的工作區照舊等，T1 的目錄 demand 和 recovery 不變；這跟熱啟動點通知的行為一樣。
  - 同一個檔案的 `shouldLatchWorkspaceRecovery`、`isWorkspaceRecoveryLatchHeld`：在 live 目錄之前消費的 agent 意圖，路由記住那個工作區，`WorkspaceDeck` 的 `recoveryRequested` 一直帶著，直到 live 目錄裡有這個工作區（上游消費意圖、不再要 recovery 的那一刻）。live 目錄沒有它（App 被滑掉時封存了）時照上游 #2002 顯示「Workspace archived」和 Restore。換工作區時放掉。路由合計 +32／−5 行。
  - fork 的 `navigation/woowtech-notification-response.ts`（`subscribeToNotificationTaps`）：處理過的那次送達（通知 identifier 加上 `notification.date`）記在模組層，整個 App 行程有效（最多 32 個），處理後呼叫 `clearLastNotificationResponse()`。只用 identifier 不行：relay 把 `apns-collapse-id` 設成 agent ID，iOS 拿它當 request identifier，同一個 agent 的每則通知 identifier 都一樣；date 是那次送達的時間（iOS 的 `UNNotification.date`、Android 的 FCM sent time），listener 和 `getLastNotificationResponse` 送的同一次點擊 date 相同。啟動的那次點擊在掛載 router 的那次 commit 跑完 effect 之後才交出去（下一個 microtask，跟上游 `getLastNotificationResponseAsync().then` 同一個時機）；交出之前 router 就卸載的話，不清原生那份，留給下一次掛載。`_layout.tsx` 的 effect 改成回傳它（+4／−27 行）。F-Droid 的 `expo-notifications` stub 加上 `getLastNotificationResponse` 和 `clearLastNotificationResponse`。
  - 沒採用：等 live 目錄時畫空白，不畫記住的 agent。主機連不上時會一直空白。
- 測試：
  - `navigation/woowtech-cold-start-tap.test.ts`（21 個）：同一個工作區、跨工作區，快取到了就聚焦 B，live 目錄晚到或不來（主機連不上）都一樣；沒見過的工作區等 live 目錄（T1）；啟動還原在程式允許的五種順序下都不蓋掉點擊；點擊比快取晚到時走熱啟動的路；layout hydrate 之前不開分頁；router remount 後不重播、之後的點擊照常。見證：上游的等待規則在 live 目錄之前顯示 A（跨工作區是 C），上游的 router remount 後把人拉回 B，沒帶 ID 的點擊回到記住的工作區（iOS 的 ID 不在 `userInfo["body"]` 時就是這樣）。recovery（7 個）：快取有、live 目錄沒有的工作區（同一個、跨工作區）在 live 目錄到之前就要 recovery、到了之後 inspect；live 目錄有它時放掉，之後再封存也不要；主機連不上時一直要但不 inspect；live 目錄之後的點擊不記住。見證：上游的等待規則在同樣情況也 inspect。
  - `navigation/woowtech-cold-start-tap.test-support.ts`：延伸 T1 S3 的 harness，加上根 index 和主機 index 的啟動還原、比 live 早到的目錄快取（live snapshot 取代快取，跟 `WorkspaceReplica.commitSnapshot` 一樣）、路由的 recovery 要求（真的 latch 函式）、真的 `createWorkspaceLayoutStore`（持久化、hydrate、`reconcileTabs`），以及真的 `subscribeToNotificationTaps`。等待規則用真的 `isAgentOpenIntentWaitingForWorkspace`；T1 S3 的 harness 也改用它，不再轉寫路由那一行。
  - `navigation/woowtech-notification-response.test.ts`（13 個）：啟動的點擊在掛載的那次 commit 之後才送、交出前卸載就留給下一次掛載、只送一次、listener 再送一次不重複、處理後清掉原生那份、remount 不重播（F-Droid stub 清不掉也不重播）、之後的點擊照常、取消訂閱、沒有 data；identifier 相同的不同送達：同一個 agent 的新通知、B→C→B、remount 後同一個 agent 的新通知都照常開。
  - 守門：`woowtech/workspace-open-intent.test.mjs` 多一個，看 `isOpenIntentWaitingForWorkspace` 是 `isAgentOpenIntentWaitingForWorkspace({ openIntent, workspaceExists })`、`workspaceExists` 來自 `useWorkspaceExists`，`hasHydratedWorkspaces` 只出現在 latch 的兩個函式和 effect 的依賴；另一個看 latch 在消費意圖的 effect 裡設、`WorkspaceDeck` 收到 `{isAgentOpenIntent || isRecoveryLatchHeld}`。新的 `woowtech/notification-taps.test.mjs`：`PushNotificationRouter` 的 effect 回傳 `subscribeToNotificationTaps(Notifications, openNotification)`，自己不讀 `getLastNotificationResponseAsync`、不加 listener；F-Droid stub 有那三個函式。把 `index.tsx` 或 `_layout.tsx` 改回上游時，紅的是守門。
  - 紅綠與突變：修之前，新的 vitest 檔載入失敗（還沒有 fork 的函式和模組），三個新守門紅、舊的那個綠；同樣的斷言換成上游的等待規則和 router 時 9/14 紅，畫面是 `wks_w/agent-a`、`wks_w2/agent-c`。修後 vitest 33/33、守門 4/4。六個突變都 exit 1：規則一律等、規則從不等、不清原生那份、每次訂閱各自去重、路由改回上游那行、router 自己讀 `getLastNotificationResponseAsync`。`b1628889`（啟動點擊的時機）之後 vitest 34/34：改回在 effect 裡直接交出時 2 個紅，拿掉卸載的檢查時 1 個紅。harness 的兩種 router 都在下一個 microtask 交出啟動的點擊（上游原本就是），harness 的 container 一直是 ready，所以重現不了下面這個退步，要靠模擬器。
- 審查找到的兩個問題（2026-10-01 修，第二個 commit）：
  - 去重只看 identifier：iOS 上同一個 agent 的通知 identifier 都是 agent ID（`apns-collapse-id`），點過一次之後，同一個 agent 的新通知整個行程都不開，B→C→B 的第三下也不開（上游只漏連續兩次同一個）。改成 identifier 加 date。Android 的 identifier 是 FCM message ID（relay 把 tag 放在 `android.notification`，不在 data），本來就不撞。
  - 提早消費意圖拿掉了上游 #2002 的封存 recovery：快取還列著、live 目錄已經沒有的工作區，`open` 清掉後 `recoveryRequested` 變 false，live 目錄到了只顯示「Workspace unavailable」。所有 `?open=agent` 的入口都會碰到（通知、網頁 deep link、重新整理後的 History），例如 e2e `worktree-restore.spec.ts` 封存後立刻帶 `?open=agent:` 重新載入、刪除還沒寫進 IndexedDB 時。原本寫「熱啟動點通知本來就這樣」不對：live 目錄之後的熱啟動點擊找不到封存的工作區，會延後成 `?open`、等、然後 recovery。改成上面的 latch。
  - 突變：去重改回只看 identifier 時新的 vitest 3 個紅；latch 永遠不設時 3 個紅（兩個封存案例和主機連不上那個）；`WorkspaceDeck` 改回 `{isAgentOpenIntent}`、或等待加回 `!hasHydratedWorkspaces` 時守門紅。
- 還沒處理的：
  - live 目錄之前的熱啟動點擊（例如重連時 store 還留著已封存的工作區）：`navigateToWorkspace` 直接開分頁，不帶 `?open`，所以不要 recovery。這是上游的行為，跟這次的修改無關。
  - Android 從「最近使用」重開被系統殺掉的行程：新行程從啟動 intent 的 extras 重建那次點擊（`ExpoNotificationLifecycleListener`），行程內的去重擋不到，會再開一次那個 agent。要擋得跨行程記住 identifier。
  - 上游 `navigation/workspace-route-navigation.ts`：bridge 註冊時只看 `isReady()` 就 flush 掛著的意圖。同一次 commit 裡比 bridge 先掛的意圖會被吃掉（上面的退步）。上游自己沒有在這個時間點導頁的地方，所以沒改它；在掛載的 effect 裡導頁的新程式要晚一個 microtask。
- Android 模擬器驗收（2026-10-03，release-dev APK：JS 內嵌、沒有 dev launcher；測試 daemon 只有 mock agent、推播擋掉）：
  - 做法：先在 App 裡開記住的 agent，`am force-stop`，再冷啟動。點通知用 FCM 點擊會送的同一個 intent（MAIN／LAUNCHER 到 `.MainActivity`，relay 的 data 當 string extras，`google.sent_time` 是 long）；deep link 用 `woowtech-smart:///h/<srv>/workspace/<wks>?open=agent:<id>`。30 秒內一直讀標題。工作區 W1 有 A、B，W2 有 C、D。
  - main：同一個工作區，點通知和 deep link 各 3 次都是先 A 再 B；跨工作區先 D（W2 記住的）再 C，點通知 1/3、deep link 2/3；點之前讓主機連不上，點通知 3/3 一直停在 A。
  - 修正版第一版（`32fda709`）：deep link 3/3 直接 B；點通知 3/3 停在 A，30 秒內都沒到 B，比 main 還差。
  - 原因（logcat 追蹤，只在本機的除錯分支）：`subscribeToNotificationTaps` 在 router 的 effect 裡直接交出啟動的點擊，`navigateToWorkspace` 掛起 `?open=agent:B` 的意圖時 `WorkspaceRouteNavigationBridge` 還沒註冊。bridge 在同一次 commit 稍後註冊、當場 flush，這時 `isReady()` 已經是 true，但根 stack 還沒進 container 的 state（root state 只有 `__root`，沒有巢狀的 state）。expo-router 據此排了一個對 `__root` 的 `POP_TO`，React Navigation 有處理（不是 noop），根 stack 卻照樣從 `index` 開始，`?open` 從沒出現在導覽 state 裡；接著啟動還原把人帶到記住的工作區，顯示 A。上游用 `.then` 晚一個 microtask，那時整個 commit 的 effect 都跑完了，所以沒事。同一個除錯 APK 改回在 effect 裡交出就重現，在 microtask 交出就直接開到 B。
  - 修正版（`b1628889`）：同一個工作區點通知 3/3、deep link 3/3 直接 B；跨工作區點通知 3/3 直接 C；主機連不上時點通知 3/3 直接 B、跨工作區 3/3 直接 C。都沒有先出現記住的 agent。跨工作區 deep link 8 次都開到 C，第 1 次在 C 之前讀到約 3 秒的 A（W1 記住的 agent），之後 7 次（其中 5 次每次換標題都截圖）沒再出現；帶追蹤的除錯 APK 另跑 3 次，導覽都直接到 W2。那一次的原因沒查到。
  - 還要實機：iPad 和 POCO 照「接下來」的 RC-I-21c 那條做（真的 FCM／APNs 點擊、iOS 啟動點擊的送達時機、Reload、重複通知、封存工作區）。
- 合併上游：上游改成快取到了就消費 agent 意圖，或自己清掉最後一次點擊時，先確認新測試仍綠，再拿掉 fork 的函式、模組和守門。

#### Mac：App 結束後從通知中心點通知，開到那個 agent（D2a）

- owner 2026-10-02 決定 Mac 和 Windows 都要開到那個 agent（D2 選 a）；2026-10-05 決定 Mac 不等 Windows 分支，自己先做。
- macOS 在 App 結束後點通知中心的舊通知時，重新啟動 App，把那則通知的 identifier 放在 Electron `ready` 事件的 launchInfo。`features/notifications.ts` 在 macOS 建 agent 通知時給 `id`：`woowtech-agent:<uuid>:<agent 連結>`（`features/woowtech-notification-launch.ts`，uuid 讓同一個 agent 的兩則通知不互相取代）；`main.ts` 在 `app.whenReady()` 之前掛 `app.once("ready")`，讀回 agent，交給第一個視窗開啟（跟 argv 的 agent 連結同一條路）。沒有 agent 的通知（terminal）照舊只打開 App。
- 同樣的函式也在 Windows 分支的 `features/woowtech-launch-links.ts`（它另外處理 Windows 的 protocol toast）；Windows 分支合進 main 時合成一個檔。
- 接點：`notifications.ts`（import 和 `id`，+11 行）、`main.ts`（import 和 ready listener，+12 行）。測試 `woowtech-notification-launch.test.ts`，守門 `woowtech/desktop-notification-launch.test.mjs`。
- 要實機：簽章的打包版，App 結束後從通知中心點舊的 agent 通知，要直接開到那個 agent；點 terminal 通知只打開 App。

#### 桌面通知的回饋

- Electron 的通知支援不代表系統已授權；設定頁顯示尚未確認，仍可按「傳送測試通知」。不拿瀏覽器的授權值冒充原生通知授權。
- 桌面測試通知分三種結果：原生 `show` 顯示「通知已顯示」；`failed` 或同步錯誤顯示「通知顯示失敗」；5 秒內沒有結果顯示「無法確認通知是否顯示」。`show` 不代表使用者一定看到橫幅。後兩者的說明不重複標題，直接引導到「系統設定 → 通知」，並說明未簽章測試版可能無法顯示；這不表示已證明所有 ad-hoc 版本都會失敗。
- 生命週期放在 `packages/desktop/src/features/woowtech-notification-delivery.ts`；上游接點是 `features/notifications.ts`。一般通知逾時只結束等待，不關通知、不清引用；之後點擊仍導頁，關閉、點擊、失敗時才清引用。晚到的 show 不改已回報的未確認結果。只允許靜音註冊 probe 逾時關閉，它仍是 best effort，不當成授權證據。
- 三態只新增桌面內部 `sendNotificationWithResult` bridge／IPC，接點另有 `preload.ts` 與 App `desktop/host.ts`；沒有修改網路 protocol。App 與 Electron 各自宣告三態 union，由守門核對一致，不跨套件引用 sibling `src`。一般 `sendOsNotification` 與既有 `sendNotification` IPC 仍回布林，僅 show 為 true。舊 bridge 仍能傳送測試，但舊布林不能證明是否收到 show，畫面一律回報未確認；不以重送來猜測結果。相容接點帶 `COMPAT(notificationDeliveryResult)` 標記。
- Renderer 接點是 `desktop-permissions.ts`、`use-desktop-permissions.ts`、`desktop-notifications-section.tsx`；測試狀態放 fork helper，文案放 `i18n/woowtech-copy.ts`，繁中以外先沿用英文。合併上游後跑 `node --test woowtech/desktop-notifications.test.mjs`，再跑同名 fork helper 與 permission 的定向 Vitest。沒有變更手機推播。
- Agent 通知標題由 renderer 依 reason 與當下 App 語言翻譯：繁中 finished「工作完成了」、permission「需要你的授權」、attention「需要你的注意」；其他語言（含簡中）沿用上游英文。`utils/woowtech-agent-notification.ts` 只改 title，不比較或翻譯 body，保留 daemon 預覽與導頁 data。`contexts/session-context.tsx` 是上游接點，保留聚焦抑制、去重與 error 不送出的行為；翻譯函式存入 ref 並在 render 同步更新，通知 callback 只依賴 `serverId`，避免切換語言使 `observeEvents` 拆掉再訂閱；送出時仍讀最新翻譯。
- 通知圖示：上游從 `dist/features` 找 `../assets`，指到從來不會產生的 `dist/assets`，所以圖示一直是空的（macOS 仍用 App 圖示，Windows 與 Linux 橫幅沒有圖示）。改由 `features/woowtech-notification-icon.ts` 決定：打包版讀 resources 的 `icon.png`，開發版讀 `packages/desktop/assets`。`electron-builder.yml` 原本只有 mac 複製 `icon.png`，現在 linux 與 win 也複製；main.ts 打包版的視窗圖示本來就找這個檔，因此 Linux 視窗，以及 Windows 打包版（之前 `icon.ico`、`icon.png` 都沒有出貨）的視窗也會有圖示。macOS 不給通知圖示（`notificationIconCandidates` 對 darwin 回空清單）：橫幅本來就顯示 App 圖示，Electron 在 macOS 會把另外給的圖示畫成右側的內容圖片，等於多出第二個圖示，所以 macOS 維持修正前的外觀。
- 沒有視窗時點通知：macOS 關掉所有視窗後 App 仍在，上游點擊只送給既有視窗，所以沒反應。`features/woowtech-notification-click.ts` 先找發出通知的視窗，再找任何視窗；都沒有時呼叫 `desktopWindowOwner.restoreWhenActivated()` 重開主視窗。目標先排隊，等該視窗 renderer 的 `PushNotificationRouter` 訂閱點擊後，以 `woowtech:notification:takePendingClick` 取走，再走原本的 `openNotification`（agent 或 `buildNotificationRoute`）。視窗重新載入時回到未就緒，關閉時丟棄。macOS 的 activate 與點擊可能同時要求視窗，所以 `restoreWhenActivated` 共用同一次開窗。上游接點：`notifications.ts`、`main.ts`、`preload.ts`、`window/desktop-window-owner.ts`、App 的 `desktop/host.ts` 與 `app/_layout.tsx`（取件放 `utils/woowtech-notification-click.ts`）。
- App 結束後從通知中心點舊通知（冷啟動、macOS `launchInfo`／`getHistory`、Windows `handleActivation`）仍不導頁：通知資料只存在記憶體，要支援得另存 id 對應資料，且只能在簽章產物上驗證，先不做。
- Windows：`features/woowtech-app-user-model-id.ts` 在 `app.setName` 後、whenReady 前呼叫 `app.setAppUserModelId`。打包版用 `io.woowtech.smart.desktop`（與 `electron-builder.yml` 的 appId 一致，NSIS 捷徑用的就是它，守門核對），未打包用 `process.execPath`；macOS 與 Linux 不做事。
- 合併上游後跑 `node --test woowtech/desktop-notifications.test.mjs`，以及 desktop 的 `woowtech-notification-{icon,click}.test.ts`、`woowtech-app-user-model-id.test.ts`、`window/desktop-window-owner.test.ts` 與 App 的 `utils/woowtech-notification-click.test.ts`。
- 正式簽章產物仍須另驗首次授權、拒絕、通知中心／橫幅及點擊；單元測試不能證明 macOS 實際顯示。圖示、關窗後點擊與 Windows AppUserModelID 也只有單元測試與守門，實機驗證待做：macOS 要簽章的打包版；Windows 與 Linux 的圖示和點擊要各自的打包版與機器。

### 17. daemon 自己的訊息用 woowtech smart

- 原因：daemon 寫給人看、或會離開電腦的文字仍叫 Paseo：請舊版 App 更新的提示、「Another Paseo daemon is already running」、App 和 CLI 顯示的 worktree 錯誤、使用者寄給我們的診斷報告，以及本地語音 worker 的行程名。
- 產品名寫在 `packages/protocol/src/brand-name.ts`（`PRODUCT_NAME`），這些訊息都讀它。改了這個檔案，要重建 protocol 和 server 的 dist。行程名照第 5 節寫字面值，守門直接讀。
- 改了的（server 共 19 行）：
  - PR fallback 內文目前留空，不加產品署名，見第 20 節；這行不算在 19 行裡。
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
  - 上游測試改了預期值：`pid-lock.test.ts`（5 處）、`wire-compat.test.ts`（2 處）、`selective-timeline-delivery.e2e.test.ts`。合併時衝突的話，照上游改完再把產品名換成我們的。`session/checkout/git-metadata-generator.test.ts` 和 `session.test.ts` 的 PR fallback 內文期待值是空字串，屬第 20 節。
  - protocol 的 `messages.test.ts` 和 `messages.wire-compat.test.ts` 用「Paseo diagnostics」「Update Paseo…」當範例資料，不是在檢查 daemon 的輸出，沒改。

### 18. GitHub Actions：只跑 Ubuntu 上的 CI 測試

- owner 的決定：只跑 CI 的測試，只用 Ubuntu；Windows 不在 v1；不部署、不發佈。Playwright 的瀏覽器測試只在有人手動觸發並勾選時跑（它有已知的失敗，K-54）。
- 計費：owner 2026-10-08 把 repo 改成公開，標準 runner 不再計分鐘，Linux runner 也和上游一樣是 4 核心、16 GB。在那之前 repo 是私有的，GitHub Free 每月 2,000 分鐘、2 核心 7 GB 的 runner，CI 因此改成每週跑一次，10/8 當天額度用完、CI 跑不了；現在改回上游的 push main 就跑。下面為 2 核心 runner 加的設定（每個 app 測試一分鐘、Metro 4 GB）留著，在 4 核心上也沒壞處。
- 上游的 11 個 workflow 只開 `ci.yml`。其他 10 個留在 repo 裡，合併上游時才不會衝突，在 GitHub 上停用：

| 檔案                      | 做什麼                                                                               | 觸發                                                                                                                                      | 需要的 secret 和外部服務                                        | 不停用的話，在我們的 repo 會怎樣                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`（開著）          | 格式、lint、typecheck、各套件的測試                                                  | 上游：push main、PR、merge queue、手動                                                                                                    | 三把模型 API key，CI 跑的測試用不到（見下面）                   | 上游的設定每次 push main 都跑完整一輪，含 Playwright 和兩個 Windows job，約 415 分鐘，一個工作天就用完當月額度                                                                                |
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

`ci.yml` 跟上游不同的地方：

- 觸發：和上游一樣（push main、PR、merge queue、手動）。個人帳號的 repo 沒有 merge queue，那個觸發不會發生，留著是因為上游的 `scripts/ci-workflow.test.mjs` 檢查它。
- Playwright：4 個分片只在手動觸發、勾了 `run_playwright`（Run workflow 裡的「Also run the Playwright browser tests (4 long shards)」）時跑。每個分片的 `if` 最前面加 `github.event_name == 'workflow_dispatch' && inputs.run_playwright && `，push、PR、merge queue 和沒勾的手動執行都顯示為略過。run 2 的 4 個分片各跑 26～44 分鐘，合計約 150 計費分鐘。沒有 job 依賴這 4 個分片；GitHub 把被 `if` 略過的 job 算成成功，當 required check 也不會擋合併。沒有刪掉，因為上游的 `ci-workflow.test.mjs` 要求它們存在。
- Windows：兩個 Windows job 的 `if` 最前面加上 `vars.WOOWTECH_CI_WINDOWS == 'true' &&`。repo 沒設這個變數，兩個 job 顯示為略過，不佔 runner。沒有刪掉，因為上游的 `ci-workflow.test.mjs` 要求它們存在。要跑 Windows 時，在 Settings → Secrets and variables → Actions → Variables 新增 `WOOWTECH_CI_WINDOWS`，值是 `true`，並把下面 2 核心、7 GB 的設定也加到兩個 Windows job（私有 repo 的 Windows runner 也是 2 核心）。
- Ubuntu 的 job 都固定用 `ubuntu-24.04`（上游只有桌面版 job 固定，其他 15 個用 `ubuntu-latest`）。GitHub 從 2026-10-19 起把 `ubuntu-latest` 改指 Ubuntu 26；固定之後，什麼時候換 Ubuntu 由我們決定，不會在某次 push 時突然換掉。要換時一起改 16 個 `runs-on`，先在分支上手動跑一次。job 名稱 `server-tests (ubuntu-latest)`、`desktop-tests (ubuntu-latest)` 照上游不改：那是 status check 的名稱，上游的 `ci-workflow.test.mjs` 檢查它們。
- 桌面版的 RPM smoke 先用 `dpkg --remove` 移除前一步裝的 deb。我們的 deb 叫 `io.woowtech.smart.desktop`（electron-builder 取 `extraMetadata.name`，第 5 節），上游的叫 `paseo`。用上游的名字時 dpkg 只會警告、不會移除，deb 留下的檔案會補上 RPM 沒裝到的東西，smoke 就看不出 RPM 的問題。
- typecheck job 在「Build server stack」之後多一步「Check woowtech fork guards」（2026-09-29），跑：

  ```bash
  node --test --test-concurrency=1 --test-skip-pattern="^Traditional Chinese is regenerated from upstream's current Simplified Chinese$" woowtech/*.test.mjs
  ```

  - 放在 typecheck job：這個 job 已經跑過 `npm ci` 和 `npm run build:server`，守門跨套件的匯入讀各套件的 dist。沒有新增 job；觸發、排程、Playwright 的手動 gate、Windows 開關、runner、逾時和 concurrency 都沒動。
  - 只跳過一項：zh-TW 重新產生（`zh-tw.test.mjs` 第一項）。它要 OpenCC，OpenCC 裝在 `woowtech/tools`（自己的 package.json），`npm ci` 不裝。用完整名稱跳過，同一個檔的其他 5 項照跑；本機照第 7 節裝好 tools 就會跑到它。`cli-name.test.mjs` 的 Install CLI 那一項照原本的規則只在 macOS 跑。Node 22 會把名稱被跳過的測試整個濾掉，報告裡不會列成 skipped。
  - `--test-concurrency=1`：一次跑一個檔。2 核 runner 的預設本來就是 1（核心數減一），寫出來讓本機的結果跟 CI 一樣。
  - checkout 抓完整歷史（`fetch-depth: 0`，2026-09-30）：第 22 節的廠商圖示檢查用 `git show` 讀 `UPSTREAM_REF` 時的上游圖示檔，`actions/checkout` 預設只抓最新一個 commit。CI #10（run 36642688479）因此失敗：`fatal: invalid object name '130705c02^'`；本機的 clone 有完整歷史，所以沒發現。`woowtech/workflows.test.mjs` 檢查這個設定。
  - typecheck 看 `quality` 這組路徑（`.github/ci-paths.yml`）：PR 只改到 `.md`、`.svg` 這類檔案時它不跑，守門也跟著不跑；push main 和手動執行都會跑。
  - 守門：上游的 `scripts/ci-workflow.test.mjs` 多一項（在 `changes` job 的 Validate CI contracts 跑，不需要安裝）：typecheck 有這一步、指令完全一樣、在 build 之後、沒有 `if` 和 `continue-on-error`。拿掉這一步、加條件、改跳過的條件、縮小 glob 都會失敗。`woowtech/workflows.test.mjs` 另外檢查跳過的條件只對到 zh-TW 重新產生那一項。
  - 本機模擬（2026-09-29，這台 Mac，不是 Ubuntu）：Node 22.23.2、`CI=true`、全新的 HOME、PATH 沒有 `~/.local/bin`，`woowtech/tools/node_modules` 暫時移開（沒有 OpenCC）。先 `npm run build:server`，再跑 `changes` job 的三個契約檔（28 項全過）和這一步（132 項全過，36 秒）；被跳過的那一項單獨跑，因為沒有 OpenCC 而失敗，證明它不能在 CI 跑。macOS 會多跑 Install CLI 那一項。Ubuntu 2 核 runner 上的結果和時間見「驗證紀錄」的 F11 驗證輪（CI #9）。

- 2 核心、7 GB 的設定，前兩次執行後加的（見下面）。上游的 CI 在公開 repo 的 4 核心、16 GB runner 上跑，這些上限在那裡夠用；變數沒設時照上游：
  - Playwright 的 4 個分片和桌面版 job 設 `E2E_METRO_WARMUP_TIMEOUT_MS=600000`，網頁版冷打包最多等 10 分鐘。讀它的是 Playwright 的 globalSetup（`packages/app/e2e/support/global-setup.ts`，上游 120 秒，桌面版的 renderer E2E 也用它）、桌面版 lifecycle E2E 第一次開視窗（`packages/desktop/e2e/daemon-lifecycle-renderer.electron.mjs`，上游 90 秒），以及桌面版 browser E2E 第一次點 Settings 之前等 Settings 按鈕出現（`packages/desktop/e2e/browser-tabs.e2e.mjs`，上游只有點擊本身的 Playwright 預設 30 秒；變數沒設時不多等）。
  - 桌面版 job 的上限從 30 分鐘改成 60 分鐘。
  - app-tests 設 `PASEO_APP_TEST_HOOK_TIMEOUT_MS=120000`，`packages/app/vitest.config.ts` 讀它，unit 和 browser 兩個 project 的 hook 上限（vitest 預設 10 秒和 30 秒）都改成 2 分鐘。沒設時設定檔不給值，照 vitest 的預設；給 10 秒當預設值會把 browser 的 30 秒一起降成 10 秒。在命令列加 `--hookTimeout` 沒用：vitest 4.1.7 只把固定幾個命令列選項傳給 projects，`hookTimeout` 不在裡面。
  - app-tests 的指令加 `-- --testTimeout=60000`，兩個 project 每個 test 的上限（vitest 預設 5 秒和 15 秒）都改成 1 分鐘。`testTimeout` 在 vitest 傳給 projects 的那幾個選項裡，所以不用改上游的檔。旗標要放在 `--` 後面，放在前面會被 npm 自己拿走。
  - Playwright 的測試那一步設 `NODE_OPTIONS=--max-old-space-size=4096`。Node 預設的 heap 上限跟著機器的記憶體走：7 GB 的 runner 約 1.8 GB，上游 16 GB 的 runner 是 4 GB。這是上限不是預留，同一步的 Metro、Playwright 和兩個 daemon 各自用多少還是看需要；Metro、兩個 Chromium、兩個 daemon 連同系統估計 5～6 GB，在 7 GB 內。`global-setup.ts` 用這一步的環境起 Metro，所以 Metro 拿得到。桌面版 job 沒加：它的三個 E2E 各自起的 Metro 都只打包 App 一個入口，run 2 都撐過去了。
  - 桌面版 job 的「Build Linux desktop artifacts」這一步也設 `NODE_OPTIONS=--max-old-space-size=4096`（2026-09-29 起）。它跑 `npm run build:desktop`，裡面的 `expo export` 會打包整個網頁版 App；CI #8 在打包到 81% 時用完 Node 預設的 heap（約 1.8 GB）失敗。F11 和第三批上游讓 App 變大，#7 那時其實已經接近上限。本機打包一直都要 4096 MB，這次把 CI 對齊。守門 `woowtech/workflows.test.mjs` 會檢查這一步的設定。
  - cli-tests 設 `PASEO_CLI_TEST_CONCURRENCY=2`，CLI 的 e2e 一次跑 2 個檔（上游預設 4 個）。分片維持 3 個，job 名稱和上游的 `ci-workflow.test.mjs` 都不用改。
  - Metro 的快取不跨次保存（每週跑一次的那段期間決定的：GitHub 會刪掉 7 天沒用到的快取）。push main 又會跑之後，要不要保存再看執行時間。

secret 和外部服務：

- `ci.yml` 把 `CLAUDE_CODE_OAUTH_TOKEN`、`OPENAI_API_KEY`、`OPENROUTER_API_KEY` 交給 server 測試和 Playwright。CI 跑的是 server 的單元測試（排除 `*.e2e.test.ts`）和 6 個用假 agent 的整合測試，以及 Playwright 的 `browser` project（排除 `*.real.spec.ts`），都不讀這三把 key。
- repo 不要設這三個 secret，也不要設 Cloudflare、Expo、Apple 的 secret：停用的 workflow 被重新打開時會拿去用。
- CI 會連公開的服務：npm registry（安裝、`npm audit signatures`、全域安裝 claude-code、codex、opencode）、Playwright 和 Electron 的下載、Ubuntu 的套件庫，以及測試裡 Expo CLI、opencode 自己連的。不連上游的 relay、Hub 和網站：測試用的 daemon 預設關 relay 或指到本機，Hub 的測試用本機的假伺服器，relay 的 e2e 用 `wrangler dev --local`。CLI 的 e2e 有兩支會打開 relay（`03-daemon`、`17-onboard`），連的是我們的 relay.woowtech.io。

第一次執行（run 36115544173，2026-09-25 在 main `03824427e` 手動觸發）失敗。實際 18 分 50 秒，工作時間合計 1 小時 42 分 39 秒，每個 job 各自進位後約 110 計費分鐘。兩個 Windows job 照設計略過。修正在分支 `woowtech/ci-green`：

| job             | 時間     | 結果 | 原因                                                                                                      | 修正                                  |
| --------------- | -------- | ---- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| changes         | 18s      | 過   |                                                                                                           |                                       |
| format          | 1m52s    | 失敗 | 兩個 fork 的 `.mjs` 沒照 oxfmt 排版                                                                       | 重新排版                              |
| lint            | 2m33s    | 失敗 | `woowtech/png.mjs` 的 `readPng` 複雜度 24、巢狀三元；fork 加的 `echo-client-info-acp-agent.mjs` 的 no-new | `readPng` 拆成小函式；連線存進變數    |
| typecheck       | 4m2s     | 過   |                                                                                                           |                                       |
| server-tests    | 11m0s    | 過   |                                                                                                           |                                       |
| desktop-tests   | 3m7s     | 失敗 | 12 個只在 Linux 跑的測試：launcher 9 個、CLI 安裝 3 個                                                    | 夾具改用我們的名字和 Linux 的安裝位置 |
| app-tests       | 6m11s    | 失敗 | `input-draft.live.test.tsx` 的 beforeAll 超過 10 秒                                                       | hook 上限 2 分鐘                      |
| sdk-tests       | 3m42s    | 過   |                                                                                                           |                                       |
| playwright 1～4 | 各 5～6m | 失敗 | globalSetup 等冷打包 120 秒，停在 91%，測試一個都沒跑                                                     | 等 10 分鐘                            |
| relay-tests     | 1m53s    | 過   |                                                                                                           |                                       |
| cli-tests 1/3   | 15m25s   | 失敗 | `03-daemon` Test 8：IPC 的狀態查詢每次都超過 1.5 秒                                                       | 一次跑 2 個檔                         |
| cli-tests 2/3   | 11m46s   | 過   |                                                                                                           |                                       |
| cli-tests 3/3   | 18m23s   | 失敗 | `25-daemon-restart-supervisor`：重啟後 20 秒內等不到新的 worker                                           | 一次跑 2 個檔                         |

- format、lint：CI 對整個 repo 跑 `npm run format:check` 和 `npm run lint`。這三個檔都是 `.mjs`，lefthook 的 format 和 lint 用的 glob 沒有 `mjs`，commit 時從沒檢查過（`lefthook run pre-commit --job lint --file woowtech/png.mjs` 顯示「no files for inspection」）。`lefthook.yml` 的兩個 glob 已加上 `mjs`（上游的檔，改兩行）：同一個指令現在會檢查這個檔，拿 main 版的 `png.mjs` 來跑，lint 和 format 都失敗，錯誤跟 run 1 相同。`.cjs` 還是不在 glob 裡（repo 只有上游的 3 個），改了要自己跑 `npm run format:files -- <檔案>` 和 `npm run lint -- <檔案>`。
  - 各 worktree 的 `lefthook.yml` 不同時（例如這個改動合進 main 之前），lefthook 每次發現設定跟上次不同，就重裝共用 `.git` 裡的 hook（輸出「sync hooks」），hook 會改成指向執行它的那份 lefthook。手動跑 lefthook 時加 `--no-auto-install`。commit 時 hook 自己呼叫的 `lefthook run` 也會重裝；這時用 hook 支援的 `LEFTHOOK_BIN` 指向一個替 `run` 加上 `--no-auto-install` 的包裝，format、lint、typecheck 照跑，共用的 hook 不動。
- Linux 的桌面版測試：產品碼一致，錯的是夾具。electron-builder 替我們的設定算出的 Linux 執行檔是 `woowtech smart`，after-pack、linux-sandbox 的啟動器、`bin/paseo` 和打包 smoke 都用這個名字，launcher 測試卻還建上游的 `Paseo`，after-pack 改名時 ENOENT。CLI 安裝在 Linux 找 `<安裝資料夾>/resources/bin/woowtech-smart`，測試只建了 macOS 的 `.app`。
- run 1 沒跑到的步驟裡另外修了兩處：
  - 桌面版的打包 smoke 檢查打包後 package.json 的 `desktopName` 是 `woowtech smart.desktop`，實際是上游的 `Paseo.desktop`。改在 `electron-builder.yml` 的 `extraMetadata` 設（第 5 節）。
  - 桌面版的 lifecycle E2E 是 job 裡第一個打包網頁版的步驟，視窗只等 90 秒；Playwright 的同一份冷打包在 120 秒時才到 91%。改成跟 Playwright 一樣讀 `E2E_METRO_WARMUP_TIMEOUT_MS`。
- CLI 的兩個測試：daemon 每次回狀態都會對裝好的 provider 各跑一次 `--version`（CI 裝了 claude、codex、opencode），一次跑 4 個檔時 2 核心忙不過來。

第二次執行（run 36151706446，2026-09-25 在 `woowtech/ci-green` 的 `b6d442a73` 手動觸發）失敗，實際 44 分 45 秒。run 1 的問題都沒再出現，剩下的是 2 核心、7 GB 撐不住的地方。修正在同一個分支：

| job                                                                    | 時間                   | 結果 | 原因                                                                                                                                                                                           | 修正             |
| ---------------------------------------------------------------------- | ---------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| changes、format、lint、typecheck、server-tests、sdk-tests、relay-tests | 沒記                   | 過   | server 5,686 個全過                                                                                                                                                                            |                  |
| cli-tests 1～3                                                         | 19m26s／18m16s／13m52s | 過   | 一次跑 2 個檔，run 1 的兩個計時失敗沒再出現                                                                                                                                                    |                  |
| desktop-tests                                                          | 19m53s                 | 失敗 | vitest 391 個全過（含 run 1 的 12 個 Linux 測試），lifecycle、renderer E2E 過；browser E2E 截隱藏視窗時拿到 retryable 的 `screenshot_no_frame`，沒有重試。後面的 Linux 打包和三個 smoke 沒跑到 | 重試到 90 秒     |
| app-tests                                                              | 7m9s                   | 失敗 | 5,326 個只剩 `unistyles-module-scope.test.ts:71` 超過 5 秒                                                                                                                                     | 每個 test 1 分鐘 |
| playwright 1/4                                                         | 44m19s                 | 失敗 | 151 過、4 失敗（重試也失敗）、1 略過                                                                                                                                                           | 待分類（見下面） |
| playwright 2/4                                                         | 38m46s                 | 失敗 | 153 過、1 失敗、1 flaky、8 略過                                                                                                                                                                | 待分類           |
| playwright 3/4                                                         | 25m59s                 | 過   |                                                                                                                                                                                                |                  |
| playwright 4/4                                                         | 43m6s                  | 失敗 | Metro 的 heap 用完，之後 135 個失敗（`net::ERR_CONNECTION_REFUSED`）                                                                                                                           | heap 4 GB        |

- Playwright 改成手動才跑：owner 的決定（見上面 `ci.yml` 的差異）。push main、PR 和 merge queue 不跑 Playwright；瀏覽器測試的問題要等有人手動勾選才看得到。
- Metro 的 heap：分片 4 的 `root-error-recovery.spec.ts` 要 Metro 另外打包 `e2e/support/recovery-app.tsx`。Metro 同時留著 App 和這個入口，碰到 Node 預設的 heap 上限（log：`[metro] FATAL ERROR: Reached heap limit ... JavaScript heap out of memory`），掛了以後後面的 test 都連不上。其他分片沒有這個 spec。
- app 的 test 上限：`unistyles-module-scope.test.ts` 用 TypeScript 解析 App 的每個原始檔，純 CPU，這台 Mac 1.4 秒。用 CI 的指令加一個檔案篩選實測：`--testTimeout=1` 讓它在 1ms 逾時，`--testTimeout=60000` 通過，旗標有傳到 project。
- browser E2E 的截圖：桌面版每次截圖最多等 5 秒讓分頁畫出一格，隱藏的視窗在 2 核心上沒趕上。腳本裡其他截圖本來就用 `callBrowserToolUntilReady` 重試，只有 `verifyHiddenBrowserScreenshots` 直接呼叫一次，因為它要回應裡的圖（structured 的結果不帶圖）。重試的迴圈抽成回傳整個回應的 `callToolUntilReady`，這個截圖也用它：retryable 就重試到腳本原本的 90 秒，其他錯誤照樣失敗（上游檔，+7／-5 行）。沒用 `E2E_METRO_WARMUP_TIMEOUT_MS`：那是給 Metro 冷打包的 10 分鐘，跟分頁畫不畫得出來無關。
- 待分類：Playwright 分片 1、2 的 5 個失敗都跟時間有關，要在本機對照上游分類（fork 的缺陷，還是 2 核心的環境問題），還沒做：
  - `agent-consecutive-turns.spec.ts:816`（transition violations）
  - `agent-message-rewind.spec.ts:119`
  - `agent-stream-ui.spec.ts:188`
  - `agent-timeline-pagination.spec.ts:182`
  - `daemon-lifecycle.spec.ts:11`「settings restart waits for a replacement worker」
  - 另有 flaky 的 `command-center-host.spec.ts:12`。
  - 分類完之前，勾了 Playwright 的手動執行會是紅的；push main 不受影響。

第三次執行（[run 36163380457](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36163380457)，main `1f4b2b00f`，手動、不勾 Playwright）**成功**。實際 41 分 15 秒，各 job 工作時間合計約 131 分鐘。來源是本機 `/Users/elmolin/.local/share/woowtech-smart/plans/ci-run-1-findings.md` 的「CI 第三次執行」紀錄，本次文件更新沒有重新查詢 GitHub。

| job                           | 時間                  | 結果                            |
| ----------------------------- | --------------------- | ------------------------------- |
| changes                       | 20s                   | 過                              |
| format                        | 2m7s                  | 過                              |
| lint                          | 2m56s                 | 過                              |
| typecheck                     | 4m12s                 | 過                              |
| server-tests                  | 16m41s                | 過                              |
| app-tests                     | 6m19s                 | 過，每個 test 60 秒的上限下全綠 |
| sdk-tests                     | 3m15s                 | 過                              |
| relay-tests                   | 2m2s                  | 過                              |
| cli-tests 1～3                | 19m2s／15m38s／17m58s | 全過                            |
| desktop-tests                 | 40m45s                | 過，包含 Linux 打包與三個 smoke |
| Playwright 1～4、Windows 兩組 | —                     | 照設計略過，不是測試通過        |

桌面版步驟：desktop tests 21s、lifecycle E2E 4m42s、renderer E2E 10m20s、browser E2E 2m31s、Linux 打包 13m52s、三個 smoke 2m20s／2m0s／50s，全部通過。

分鐘估算：repo 私有時為每月 2,000 分鐘額度做的估算和比較表（每週一次約 594 分鐘），2026-10-08 改成公開 repo、標準 runner 不計分鐘後拿掉，要看去 git 歷史。

手動跑一次（在 GitHub 上操作）：Actions → 左邊的 CI → 右邊的 Run workflow → 選分支 → 要跑 Playwright 就勾「Also run the Playwright browser tests (4 long shards)」→ Run workflow。不勾時跟 push main 一樣，跑 Playwright 以外的全部 job。跑的是所選分支上的 `ci.yml`，所以合併前可以先 push 分支、選它跑；這個選項要所選分支的 `ci.yml` 已經有這個輸入才有。登入過的 gh 也可以用 `gh workflow run ci.yml --ref <分支> -f run_playwright=true`（這台 Mac 的 gh 沒登入）。

第三次執行已確認（Linux 結果來自 CI，不是這台 Mac）：

- `desktopName` 的修正經三個打包 smoke 驗到；Linux 打包與安裝 smoke 全過。
- desktop browser E2E 2m31s 通過，截圖重試在這次執行有效。
- app-tests 6m19s 全綠，每個 test 60 秒的設定通過本次驗證。
- Linux 打包 13m52s，含該步的整個 desktop-tests 40m45s，60 分鐘 job 上限足夠完成這次執行；打包的網頁輸出也未再因 heap 中斷。
- 不勾 Playwright 的 job 組合（push main 跑的就是這組）已透過「手動、不勾 Playwright」驗證：Playwright 四組與 Windows 兩組略過，整次綠。

仍待確認：

- Playwright（手動勾選）的完整執行：2026-09-30 在整合分支跑過一次（CI #10，run 36642688479，見「驗證紀錄」的整合輪驗收）。四片都沒有 heap 用完；60 秒上限只有 `creation-old-daemon.spec.ts:95` 碰到一次，重試通過。上面待分類的 6 個裡 4 個通過，`agent-consecutive-turns.spec.ts:816`、`agent-message-rewind.spec.ts:119` 仍失敗；加上 main 既有的 2 個失敗和計時造成的 flaky，還沒有整次綠過。
- 改回 push main 觸發後，第一次由 push 觸發的執行（2026-10-08 合併這項改動時）。
- GitHub 在 run 1 的提示：actions 的 Node 20 已淘汰，被強制改用 Node 24 跑。每個 job 的「Set up job」映像版本未在本次重新核對。

打開 Actions（在 GitHub 上的操作由 coordinator 和 owner 做）：

1. 先 push 含這些改動的 main。這時 Actions 還關著，什麼都不會跑。
2. Settings → Actions → General → Actions permissions：選「Allow WOOWTECH, and select non-WOOWTECH, actions and reusable workflows」，只勾「Allow actions created by GitHub」，允許清單填 `dorny/paths-filter@d1c1ffe0248fe513906c8e24db8ea791d46f8590`。CI 只用 GitHub 自己的 actions 和這一個。不要勾「Require actions to be pinned to a full-length commit SHA」，CI 用的是 `@v4` 這種標籤。
3. 同一頁的 Workflow permissions：選「Read repository contents and packages permissions」，不勾「Allow GitHub Actions to create and approve pull requests」。
4. 馬上到 Actions 分頁，把上表 CI 以外的 10 個 workflow 逐一停用：點 workflow → 右上角 ··· → Disable workflow。停用完之前不要 push、推 tag 或開 PR。
5. 手動跑一次 CI，看每個 job 的結果和用掉的分鐘數，更新上面的估計。前兩次失敗、第三次 main 不勾 Playwright 成功，結果在上面。
6. 確認 Actions 用完免費額度時會停下，而不是收費：帳號沒有付款方式時本來就會停；有的話，在 Billing and licensing → Budgets and alerts 替 Actions 設 0 元預算並選到達上限就停止。

合併上游時：

- `woowtech/workflows.test.mjs` 列出每個 workflow 檔：開著的 `ci.yml`，以及在 GitHub 停用的 10 個和原因。多一個、少一個都會失敗。
- GitHub 會啟用新的 workflow 檔，觸發條件有 push 的話，加進它的那次 push 就會跑。守門發現新檔時，push 之前先看它的觸發條件：
  - 這次 push 不會觸發它（只有手動、tag 或 PR）：照常 push，再到 Actions 停用它。
  - 這次 push 會觸發它：先在 Settings → Actions → General 選「Disable actions」，push 完選回原本的設定（確認允許清單還在），再停用它。
  - 然後把檔名和原因加進守門的 `DISABLED_IN_UI`；CI 需要它的話，改加進 `ENABLED`。
- 同一個守門也檢查：`ci.yml` 的觸發和上游一樣（push main、PR、merge queue、手動）；每個 job 都在 Ubuntu 上，Windows job 要先過變數的條件；`runs-on` 和 matrix 都沒有 `ubuntu-latest`；開著的 workflow 只用那三把 key、不要求寫入權限；lefthook 的 format、lint glob 有 `mjs`；RPM smoke 移除的是 electron-builder 算出的 deb 名稱；上面 2 核心的時間設定都在，程式碼（不算註解）也還在讀那些變數；app 的 hook 上限請 vitest 自己解析設定：設了變數時每個 project 都是 2 分鐘，沒設時照 vitest 的預設；Playwright 的 4 個分片只在手動勾 `run_playwright` 時跑（輸入是預設不勾的 boolean，只有它們的 `if` 看事件和輸入）；Playwright 那一步的 heap 是 4 GB，`global-setup.ts` 用這一步的環境起 Metro；app-tests 在 `--` 後面帶的參數請 vitest 解析，每個 project 的 test 上限都是 1 分鐘；桌面版 browser E2E 的每個 `browser_screenshot` 呼叫都經過 `…UntilReady`；typecheck 跑 fork 守門的那一步只跳過 zh-TW 重新產生（上游的 `scripts/ci-workflow.test.mjs` 另外檢查這一步還在）。上游改到這些時會失敗，照訊息改回來。

### 19. 配對連結直接叫起 App

owner 的決定是「直接叫起 App」：配對連結和 QR Code 打開渥屋智能本身，不再打開上游在 app.paseo.sh 的網頁版。之前用手機相機掃 QR Code 會進到上游的網頁版，配對憑證交到上游的網頁程式手上，使用者在上游品牌的網頁裡操作我們的 daemon。

連結格式：

- `woowtech-smart:///#offer=<base64url JSON>`。JSON 跟以前一樣（serverId、daemon 公鑰、relay 端點），拿到連結就能連上這個 daemon，所以連結要當密碼看待。只換了 `#offer=` 前面的網址，組法仍是 `connection-offer.ts` 的 `encodeOfferToFragmentUrl`：`app.baseUrl` 去掉一個結尾斜線，再接 `/#offer=`。
- 三條斜線是 App 的根網址。Expo Router 把自訂 scheme 連結的 host 和路徑當成路由，fragment 不算：`woowtech-smart:///` 落在 index 路由，這也是 Expo 在一般啟動時用的網址（`Linking.createURL("/")`）。index 不在 `Stack.Protected` 裡，store 還沒準備好的冷啟動也找得到。寫成 `woowtech-smart://pair#offer=…` 的話，`pair` 會變成路由，打開的是找不到頁面的畫面。
- App 收到連結後，`_layout.tsx` 的 `OfferLinkListener` 把連結交給 fork 的 `runtime/woowtech-pairing-link.ts`（`handlePairingLink`）：找 `#offer=`、等 store 載入存好的主機清單、存下這台主機，再轉到「開啟專案」。用相機叫起 App 的冷啟動，連結可能比主機清單先讀到（`OfferLinkListener` 是子元件，effect 比 `HostRuntimeBootstrapProvider` 的 `boot()` 先跑）；先匯入的話，新主機加進空的清單並存檔，蓋掉存好的主機，接著載入的舊清單又蓋掉記憶體：畫面上看不到新主機，下次啟動只剩新主機。不等整個 `boot()`，它還要探測 localhost。App 內的掃描器（`app/pair-scan.tsx`）和「貼上配對連結」（`components/pair-link-modal.tsx`）也只找 `#offer=`。三個都用字串運算，不經過 URL 類別：React Native 內建的 URL 對自訂 scheme 讀不準 host 和路徑，fragment 也靠不住。App 裡的 URL 目前被 Expo 換成完整的實作，但不要依賴它。
- 帶 `#offer=` 的 https 連結照樣能配對，例如 `app.baseUrl` 設成 daemon 自己的網頁版時。程式沒有寫死任何主機。
- 在電腦上點連結只會打開桌面版：macOS 的 `open-url` 只處理 agent 連結，配對連結直接忽略。Windows 和 Linux（不在 v1）的 second-instance 會多開一個視窗，跟上游處理不認得的連結一樣。

連線後補主機名稱：

- 深連結可先離線匯入，不為取名字另開 probe。後續正常連線的 `server_info` 有非空 hostname、serverId 相符時，才把仍是 serverId 或空白的 label 補成主機名稱並存檔；重連與已連線後的新 server_info 都走同一條路。
- 已有名字不覆蓋，等待連線期間的手動 rename 優先；已移除主機不重建，舊連線或舊主機世代的 callback 不處理。registry 尚未載入不寫入，載入完成後再讀目前連線快取的 server_info，避免遺漏先到的名稱。
- 沿用上游 label 判別慣例，沒有新增名稱來源欄位：使用者若刻意把名稱設成完全相同的 serverId，無法與自動 fallback 區分，仍會被 hostname 取代。可先取其他名字以保留手動名稱。
- 政策與監聽在 `runtime/woowtech-host-label.ts`，上游只接 `runtime/host-runtime.ts` 的 controller 生命週期、registry 載入完成與 label 持久化。只改 label 時不呼叫會啟動 probe cycle 的 updateHost；沒有改連線探測、路由或網路 protocol。`woowtech-host-label.test.ts` 只有第一個整合案例使用 15 秒上限，吸收冷啟動成本；其他案例與全域上限不變。

預設值和遷移：

- 常數在 `packages/protocol/src/brand-pairing.ts`：`BRAND_PAIRING.appBaseUrl` 是 `woowtech-smart:///`，`linkExample` 是「貼上配對連結」的範例文字。scheme 要跟 `app.config.js` 的 `scheme` 一致（第 5 節）。改了這個檔案，要重建 protocol 和 server 的 dist。
- 新 home 的 `config.json` 寫入 `app.baseUrl: "woowtech-smart:///"`；`config.ts`、`pairing-offer.ts`、`bootstrap.ts`（三處）的預設也讀這個常數。
- `config.json` 的 `app.baseUrl` 正好是上游的預設 `https://app.paseo.sh`（有沒有結尾斜線都算）時，當成沒設，用我們的預設：那是之前的內部測試版寫進去的，不是使用者選的。其他值都照用，連 app.paseo.sh 底下的路徑也是；`PASEO_APP_BASE_URL` 照樣優先。
  - 寫在 fork 的 `packages/server/src/server/app-base-url.ts`（`appBaseUrlFromConfig`），`config.ts` 解析設定時呼叫。daemon 重新載入設定、CLI 的離線 `daemon pair` 都走這裡。
  - 不改寫 `config.json`，跟 relay 的預設（第 11 節）一樣只在解析時處理：`woowtech-smart daemon config get app.baseUrl` 仍顯示檔案裡的上游網址，實際的連結看 `woowtech-smart daemon pair`。

CORS：

- 新 home 的 `daemon.cors.allowedOrigins` 改成空的，不再放行 `https://app.paseo.sh`。原本上游網站上的程式可以從使用者的瀏覽器直接連本機的 daemon（HTTP 和 WebSocket 都看這份白名單），而 daemon 預設沒有密碼。
- daemon 自己固定放行的照舊（`bootstrap.ts`）：桌面版的 `woowtech-smart://app`、daemon 自己的位址（`http://127.0.0.1:<port>`、`http://localhost:<port>`），WebSocket 另外接受同源。開發用的也照舊：`scripts/dev-home.sh` 寫的 `"*"`、`scripts/dev-daemon.sh` 的 `PASEO_CORS_ORIGINS`。
- 已存在的 home：內部測試版建立的 `config.json` 還列著 `https://app.paseo.sh`。daemon 解析設定時，`daemon.cors.allowedOrigins` 和 `PASEO_CORS_ORIGINS` 裡正好是這個網址的來源（有沒有結尾斜線都算）都拿掉。其他來源照用，包括 app.paseo.sh 的其他寫法（http、別的 port、子網域）。`"*"` 也照用，仍然放行所有來源，只有開發用的 home 會寫。
  - 寫在 fork 的 `packages/server/src/server/woowtech-cors-origins.ts`（`withoutUpstreamWebApp`），網址用 `app-base-url.ts` 匯出的 `UPSTREAM_DEFAULT_APP_BASE_URL`，不另外寫一次。`config.ts` 的 `resolveCorsAllowedOrigins` 把回傳值交給它。daemon 啟動、重新載入設定（例如 `daemon config set` 之後）都走這裡。
  - 跟 `app.baseUrl` 一樣不改寫 `config.json`：`woowtech-smart daemon config get daemon.cors.allowedOrigins` 仍顯示檔案裡的上游網址。要從檔案清掉，執行 `woowtech-smart daemon config set daemon.cors.allowedOrigins '[]'`。

文案：

- `onboard` 的下一步拿掉「Web app: https://app.paseo.sh」，後面重新編號。
- 「貼上配對連結」的範例改成 `woowtech-smart:///#offer=...`，由 `BRAND_PAIRING.linkExample` 提供。範例是連結，每種語言都一樣，所以不放進翻譯：`woowtech-copy.ts` 的測試要求每種語言有自己的譯文。這個視窗的其他文字（「請貼上配對連結（.../#offer=...）」等）本來就沒有提到主機，繁中不用改。

取捨：

- 沒裝 App 時掃了沒反應，也沒有安裝引導；Android 各家相機對自訂 scheme 的處理不一致；別的 App 也能註冊同一個 scheme。這些要在實機驗收時確認。
- 當時比較過的其他做法，相機叫不起 App 時再考慮：
  - 在我們的網域放一頁（官網 aiot.woowtech.io 的 `/pair`，或 relay 的 Worker 提供 `https://relay.woowtech.io/pair`）：頁面讀 `#offer=`，提供「在渥屋智能中開啟」和商店連結，沒裝 App 有引導；之後同網域可以做 universal links 和 App Links（要開 Associated Domains、用 Play 的簽章指紋寫 `assetlinks.json`、重新建置 App）。頁面的程式會碰到配對憑證，不能載入任何第三方程式。
  - 在 app.woowtech.io 自架網頁版：要多維運一個能操作使用者 daemon 的網頁 App，每次發版都要更新。
  - 維持 app.paseo.sh：上游隨時可能改或停掉那個網站。

接點（上游的檔）：`persisted-config.ts`（4 行）、`config.ts`（配對 3 行；CORS 在 `resolveCorsAllowedOrigins`，+4／-2 行）、`pairing-offer.ts`（2 行）、`bootstrap.ts`（4 行，熱檔）、`protocol/src/connection-offer.ts`（1 行註解）、`cli/src/commands/onboard.ts`（4 行）、`app/src/components/pair-link-modal.tsx`（2 行）、`app/src/app/_layout.tsx`（`OfferLinkListener` 的 `handleUrl` 改成呼叫 `handlePairingLink`，加 1 行 import，熱檔），以及上游測試 `app/src/runtime/host-runtime.test.ts` 加的 1 個測試。F6 補名另在 `app/src/runtime/host-runtime.ts` 加 43 行，政策及整合測試留 fork 自有檔。

測試：

- server `pairing-link.test.ts`：新 home 的連結（整段比對 offer）；沒給 `app.baseUrl` 的連結；上游預設兩種寫法的遷移；自己設的值不動（daemon 的網頁版、自己的網站、app.paseo.sh 底下的路徑）；`PASEO_APP_BASE_URL` 優先；`daemon config set` 後重新載入。
- server `cors-defaults.test.ts`：新 home 沒有 web origin、dev 的 `"*"` 和 `PASEO_CORS_ORIGINS` 照舊；實際起 daemon，上游網頁版的 HTTP 拿不到 CORS 標頭、WebSocket 回 403，桌面版和 daemon 自己的網頁版照樣連得上。
- server `woowtech-cors-origins.test.ts`：上游網頁版兩種寫法都拿掉，其他來源照原本的順序留下（含 `"*"` 和 app.paseo.sh 的 http、別的 port、子網域、路徑）；內部測試版的 home 解析後沒有上游網頁版，`config.json` 不變；`PASEO_CORS_ORIGINS` 給的也拿掉；`daemon config set` 後重新載入也一樣；實際起 daemon，這種 home 對上游網頁版不回 CORS 標頭、WebSocket 回 403，留下的來源照樣連得上。
- CLI `commands/daemon/pair.app-link.test.ts`：新 home 和寫著上游預設的 home，`daemon pair` 的連結都是 `woowtech-smart:///`。`utils/daemon-target.app-link.test.ts`：`--host` 帶配對連結時，訊息裡的 offer 會遮掉。
- App：`runtime/woowtech-pairing-link.test.ts` 是 `OfferLinkListener` 收到連結後的每一步：`woowtech-smart:///#offer=` 和帶 offer 的 https 連結都會匯入並轉到「開啟專案」、沒有 offer 的連結不處理、連結不交給 URL 類別、匯入失敗時 warn 不轉頁、監聽已經卸載時不轉頁；用真的 `HostRuntimeStore`（記憶體 storage）照冷啟動的順序先讀連結再 `boot()`，記憶體和存檔都有舊主機和新主機。`host-runtime.test.ts` 的新測試是 `handlePairingLink` 呼叫的匯入（`upsertConnectionFromOfferUrl`）；`components/pair-link-modal.app-link.test.tsx` 和 `components/pair-scan.app-link.test.tsx`（掃描器是 `src/app` 裡的路由，測試放外面，因為 Expo Router 會把 `src/app` 裡的每個檔案當成路由）：貼上和掃描新連結都能配對，範例文字是新連結。三個都把 URL 類別換成會記錄的版本，確認配對連結沒有交給它。
- protocol `brand-pairing.test.ts`：CLI 的 `--host` 和 daemon 匯出的解析函式讀得到新連結的 offer。
- App 補名：`runtime/woowtech-host-label.test.ts` 用真實 HostRuntimeStore、controller、DaemonClient，注入記憶體 transport/storage，驗首次補名及存檔／重開、等待期間 rename/remove、身分不符／空 hostname、離線匯入後恢復、同 client 重連、舊連線與移除後重建的 callback、registry hydration 與冷啟動深連結；沒有打網路或假元件測試。
- 守門 `woowtech/pairing.test.mjs`，8 項：
  - 從原始碼跑 daemon 的設定和配對：新 home 的連結是 `woowtech-smart:///#offer=`，offer 是這個 home 的；沒給 `app.baseUrl` 也一樣。
  - 用 expo-router 自己的函式（`build/fork/extractPathFromURL`）確認連結落在 index 路由；用 `expo config --type introspect` 確認正式版和 Debug 版在 iOS（`CFBundleURLSchemes`）和 Android（VIEW + BROWSABLE，沒有 host 或路徑限制的 intent filter）都註冊了 `woowtech-smart`。
  - `_layout.tsx` 只掛一個 `OfferLinkListener`，不在任何條件裡；它把 `Linking.getInitialURL()` 和 `url` 事件的連結都交給 `handlePairingLink`，裡面沒有平台判斷（`Platform.`、`isWeb`、`isNative`、`getIsElectron`），也沒有 `new URL(`。上游自己的配對連結只會從網頁版進來，所以這個監聽被限定在網頁或改成讀 https 主機時，只有這一項會失敗。
  - 上游預設的 home 改用 App 連結，自己設的值不動。
  - 新 home 沒有 web origin，CLI 讀的預設（`readPersistedConfig` 的 `defaultsIfMissing`）也沒有。
  - 內部測試版的 home（CORS 白名單列著上游網頁版的兩種寫法）解析後只剩其他來源，`PASEO_CORS_ORIGINS` 給的也拿掉，`config.json` 不變。
  - 補名用目前 controller 的正常 server_info；保留 request version／client、主機世代、registry ready、重連快取與持久化接點，不另啟動 probe。
  - 出貨的原始碼不准出現 app.paseo.sh。「出貨的原始碼」是 `shipped-sources.mjs` 的 app、cli、client、desktop、protocol、server 的 `src`（含 App 的翻譯 `src/i18n`），加上 relay、plugin、highlight、expo-two-way-audio 的 `src`（App 和 daemon 相依的套件）、App 的 `plugins/`、`woowtech/skills`，以及 `app.config.js`、`eas.json`、`public/index.html`、`public/manifest.json`、`electron-builder.yml`、`wrangler.woowtech.toml`。不掃：測試、e2e、test-utils，`docs/`、`public-docs/`、`SECURITY.md`、`CHANGELOG.md` 這些說明文件，`scripts/`、`nix/`，以及上游的官網 `packages/website`。唯一的例外是 `app-base-url.ts` 辨認上游預設的那一行（`woowtech-cors-origins.ts` 從那裡匯入），守門也檢查它只有那一行。
  - 突變都被抓到：新 home 的 `app.baseUrl` 或 CORS 改回、`config.ts` 不遷移、遷移少了結尾斜線那種寫法、`pairing-offer.ts` 或 `bootstrap.ts` 的預設改回、`onboard` 加回 Web app、範例文字改回、`app.config.js` 的 scheme 改掉、`BRAND_PAIRING` 改成有 host 的網址（要重建 protocol 的 dist）、`app-base-url.ts` 多一行提到 app.paseo.sh。CORS 的 5 種（2026-10-05）：`config.ts` 不再呼叫 `withoutUpstreamWebApp`、只過濾 `config.json` 的（`PASEO_CORS_ORIGINS` 放行）、少了結尾斜線那種寫法、過濾變成什麼都不拿、`woowtech-cors-origins.ts` 寫出 app.paseo.sh。前四種 `woowtech-cors-origins.test.ts` 也會失敗。

上游合併後要再確認：

```bash
npm run build:server   # 守門從原始碼跑，但跨套件的匯入讀 dist
node --test woowtech/*.test.mjs
(cd packages/protocol && npx vitest run src/brand-pairing.test.ts --bail=1)
(cd packages/server && npx vitest run src/server/pairing-link.test.ts src/server/cors-defaults.test.ts src/server/woowtech-cors-origins.test.ts --bail=1)
(cd packages/cli && npx vitest run src/commands/daemon/pair.app-link.test.ts src/utils/daemon-target.app-link.test.ts --bail=1)
(cd packages/app && npx vitest run src/runtime/woowtech-pairing-link.test.ts src/runtime/host-runtime.test.ts src/components/pair-link-modal.app-link.test.tsx src/components/pair-scan.app-link.test.tsx --bail=1)
```

- 守門的出貨原始碼掃描失敗時，看新出現的地方是誰在用：預設值改用 `BRAND_PAIRING`，給人看的文字改成我們的。
- 上游改了 `encodeOfferToFragmentUrl` 的組法或 `config.ts` 的 `app.baseUrl` 解析：守門第 1、3 項會失敗。照新的組法調整 `BRAND_PAIRING.appBaseUrl`，保持連結是 `woowtech-smart:///#offer=…`。
- 升級 expo-router：守門直接讀 `expo-router/build/fork/extractPathFromURL`，搬家時會失敗。確認新版仍把 `woowtech-smart:///` 對到 index，再改守門的路徑。
- 上游新增 `src/app/+native-intent.tsx`、改了 `src/app/index.tsx`，或把 index 放進 `Stack.Protected`：連結可能不再落在啟動畫面，要在模擬器上用 `xcrun simctl openurl` 和 `adb shell am start` 重新確認。
- 上游讓掃描器或「貼上配對連結」改用 URL 類別讀 fragment：那兩個 App 測試會失敗，改回字串運算。上游改寫 `OfferLinkListener`（限定平台、改用 URL 類別、不再交給 `handlePairingLink`）：守門的 `OfferLinkListener` 那一項會失敗，照訊息改回交給 `handlePairingLink`。
- 上游在新 home 的 CORS 預設或 `bootstrap.ts` 的固定清單加回網頁版：`cors-defaults.test.ts` 和守門會失敗。
- 上游改寫 `resolveCorsAllowedOrigins`（例如多一個來源）：`withoutUpstreamWebApp` 要包住最後的回傳值，接點不見時 `woowtech-cors-origins.test.ts` 和守門的 CORS 那一項會失敗。

### 20. 暫停工作區自動命名與 Git metadata 生成

- 依 owner 的 D4 修正，daemon 暫時完全停用工作區的 LLM 自動命名，不做開關。上游會把第一則 Agent 提示與附件交給 metadata provider，可能與使用者操作的 provider 不同；先停止這條額外內容傳送與額度消耗路徑，之後再另做明確開啟、只用同一家 provider 的功能。
- 政策在 `packages/server/src/server/woowtech-metadata-policy.ts`。`WorkspaceAutoName` 的 directory/worktree 入口都在排程前拒絕：沒有 timer、沒有 generator、provider snapshot 列舉、instructions 載入或 structured generation。新舊 home 一樣關閉，不讀任何命名設定，也不從既有 metadata provider 清單推定使用者同意。
- 保留建立時的名稱、初始 prompt title 與分支；不回改以前的命名，不阻擋手動改名。正常 Agent 工作與 OpenCode 設定頁探測維持現狀；這不是全域禁止 provider 網路使用。
- 上游接點只有 `workspace-auto-name.ts` 的排程 gate 與 typed policy/scheduler ports，以及 `worktree-branch-name-generator.ts` 的 instructions-builder 測試 port。production bootstrap 不傳 policy override；既有上游行為測試明確注入 enabled policy 以保留原斷言，另以真正預設 OFF 的 service 驗零呼叫，不能用測試開啟值當 production 預設。
- OFF 基線與 positive control 放 `woowtech-workspace-auto-name.test.ts`；上游 `workspace-auto-name.test.ts` 僅保留 ON policy 注入，原斷言不變。合併上游後跑這兩檔與 `node --test woowtech/workspace-auto-name.test.mjs`。守門鎖住 production OFF、兩個 daemon 入口、排程前 gate 與 bootstrap 接點，並以 AST 掃 server production sources：命名 generator 只能由 `workspace-auto-name.ts` 存取。守存取而非只找函式呼叫，才能攔住 import alias、間接引用、namespace、dynamic import 與 re-export；函式宣告本身和測試不當作新 caller。
- D5 修正（F8-min）：commit 訊息與 PR 草稿的 AI 產生也先完全關閉，共用 `woowtech-metadata-policy.ts`，但使用獨立的 Git metadata policy。`git-metadata-generator.ts` 兩個入口在讀 diff、載入 metadata instructions、讀 provider 偏好、列舉 provider 或呼叫生成前直接返回既有固定文字：commit `Update files`；PR title `Update changes`、body 空字串（依 C-022 使用者決定，不再加自動產生或品牌文字）。AI 回應 schema 的 body 最小長度仍是 1；OFF 不經該 schema，真實 CheckoutSession 與本機 forge port 測試確認空 body 可以送到建立 PR 路徑。
- 手填 commit 訊息與 PR 文字照舊使用（維持原有 trim）；PR 只有一欄空白時只補空欄。真正的 Git commit、push、建立 PR 流程不變。沒有 env/home 開關，不清除既有磁碟設定；未來明確 provider 選擇與手寫介面依 F8 計畫另做，這次不新增。
- metadata 設定頁保留，用 fork copy 覆寫總說明與三段模型提示，明說目前停用、已存偏好不會啟用生成。比隱藏頁面更少改動，也讓使用者知道舊設定仍保留。專案設定的後設資料區塊也用 fork 說明保留指令但不會用於自動產生，表單與磁碟設定不變。繁中使用「後設資料」及「提交訊息」，英文與其他語系使用英文；不改上游語系檔或 OpenCode 探測流程。
- Git metadata 測試放 `session/checkout/woowtech-git-metadata.test.ts`：預設 OFF 零呼叫、固定值、原 instructions builder 接點、明確 ON 的 positive control，以及真實 handler 的手填／部分手填行為。handler 測試只寫臨時 Git repo 與本機 bare remote，forge 用 typed fake，不發外部請求。原 `git-metadata-generator.test.ts` 僅注入 ON policy 保留原斷言；`session.test.ts` 在既有 mock 區塊以測試端 ON 覆寫保留 prompt 行為測試（C-022 明確核准的既有 mock 例外）。production `session.ts` 不傳 override，守門禁止測試用 policy 覆寫出現在 server production source：提供 policy 的物件成員（屬性、簡寫、方法、getter、有值的 class field）、對同名成員的 `=`、`??=`、`||=`、`&&=`、解構和參數的預設值（`const { name = … } = deps`、`{ name: local = … }`、`(name = …)`），以及用字串寫出 policy 名稱（`defineProperty`、`Reflect.set`、computed key）都算覆寫；唯一放行的是 `x.name = options.name ?? <fork policy>`，也就是 `WorkspaceAutoName` 建構子的接線。字串相加組出的名稱（`deps["isGeneration" + "Enabled"]`）和區域變數的初始值（`const name = deps.name ?? …`）不在範圍內；生成器入口那一行由第 2 項的 regex 釘住。合併上游後務必逐檔跑這兩檔與 fork OFF suite；不要只跑 generator 單元測試而漏掉 Session 接線。另跑 `node --test woowtech/git-metadata.test.mjs woowtech/workspace-auto-name.test.mjs` 鎖住兩個 gate、policy 預設與 production 接點；`woowtech-copy.test.ts` 守住限定語系政策、placeholder 與頁面文案接點。

### 21. 附件上傳撐過重連

- 現象（2026-09-27 Android 輪次，`logs/integ0927-android-u-attach.txt`）：檔案挑選器開超過 daemon 的 socket lease，daemon 斷線；選好檔案時 App 正在重連，上傳中的附件轉一下就消失，沒有錯誤，daemon 也沒收到檔案。logcat 是 daemon 回的「Upload chunks arrived before file begin.」。挑選器只開 20 秒時正常。
- 原因在上游的 client（`packages/client/src/daemon-client.ts` 的 `uploadFile`）：連線中（`connecting`）時，`file.upload.request` 這則 JSON 會排進送出佇列，但 FileBegin 等二進位框不排隊。App 的 client 設了 `suppressSendErrors`，所以 FileBegin 被默默丟掉；第一個 chunk 前連線剛好完成，佇列補送 request，chunk 照送，daemon 就回那個錯誤。App 收到失敗只在 catch 裡跳 toast，並把上傳中的附件拿掉；裝置輪次沒看到任何錯誤訊息。上游 main（`30178c4f5`）這兩處都沒改。
- 修法：
  - client：`uploadFile` 先等連線完成（`waitUntilConnected`，只在 `connecting` 時等，逾時跟送出佇列一樣），整個檔案都走同一條連線；沒連線、連線失敗或逾時就回 `DaemonConnectionError`，什麼都不送。上游檔 +40 行，註解 `woowtech smart:`。
  - App：`composer/woowtech-upload-reconnect.ts`。上傳因為連線中斷（`DAEMON_CONNECTION_LOST`、「Transport not connected」或 socket 已關的「WebSocket not open」）失敗時，附件留在上傳中，等這台主機的 client 重新連上（同一個 client 自己重連，或 host runtime 換成新的 client，最多等 60 秒）再重送，一個檔案最多送 3 次。其他錯誤、逾時和等不到主機照舊失敗。接點是 `composer/actions.ts` 的 `uploadFileAttachments`（多一個 `reconnect` 參數）和 `composer/index.tsx` 的 `uploadSelectedFiles`。
  - 最後還是失敗時，連線中斷的錯誤改顯示「與主機的連線中斷，檔案沒有上傳。主機連回來後請再加入一次。」（`woowtech.composer.uploadConnectionLost`，只有繁中和英文）。
  - 順手修上游的 key：composer 在 client 不在時 toast `composer.errors.daemonClientDisconnected`，但這個 key 不存在，畫面會顯示 key 本身；改用 `common.errors.daemonClientDisconnected`。
- 檔名含 `#`、`?`、`%` 的附件（RC 驗收發現）：上游的 `pathToFileUri` 直接把路徑接成 `file://…`，解析網址的地方（`URL`、fetch、expo-file-system）會把 `shot#1.png` 讀成 `shot`，`100%.png` 直接出錯，`a%20b.png` 被當成 `a b.png`。現在這三個字元先做百分比編碼，`fileUriToPath` 照舊解回來；其他路徑的 URI 不變（`attachments/utils.ts`）。手機版附件的預覽網址原本自己接 `file://`，改用同一個函式（`native-file-attachment-store.ts`）。
- 桌面版的副檔名（9/30 RC-D-12c1，第 25 節）：主程序照副檔名命名附件的複本，只收 1～16 個英數字（`packages/desktop/src/features/attachments.ts` 的 `normalizeExtension`），否則丟英文錯誤、還帶出本機路徑。上游在檔名沒有副檔名時拿整條來源路徑找最後一個點，檔案放在名稱有點的資料夾（`~/.config/tool/Makefile`）就得到 `.config/tool/Makefile`。`desktop/attachments/woowtech-attachment-extension.ts` 只看最後一段，而且只回主程序收的副檔名；`desktop-attachment-store.ts` 的 `extensionForAttachment` 檔名和來源路徑都經過它。10/8 在 Mac 驗收版實際用開檔對話框選檔，發現另一條路還是壞的：「上傳檔案」（`hooks/use-file-picker.ts` → `attachments/selected-file.ts`）和「新增圖片」（`hooks/image-attachment-picker.ts`）用的是上游 `attachments/file-types.ts` 的 `getFileExtension`。它把整串在第一個 `#`、`?` 切斷再找最後一個點：本機的 `shot#1.png`、`what?.png` 被當成不是圖片，選的那批圖整批沒加上，畫面上也沒有提示；`.config-test/x/Makefile` 則得到 `.config-test/x/makefile`，跳出英文錯誤。`getFileExtension` 改由 `pathExtension` 回答：先用完整的檔名，沒有副檔名才去掉 `?query`、`#fragment` 再試，所以上游測的 `/tmp/screenshot.PNG?cache=1` 仍然是 PNG；兩次都只看最後一段、只回主程序收的副檔名。
- 還沒做：上傳最後失敗時附件仍會從 composer 消失，只留 toast。要照 `docs/testing.md` 的 fallible action 規則把失敗的附件留在原處、可以重試，要另外做 composer 的 UI。
- 測試：`packages/client/src/daemon-client.test.ts` 加了兩個（連線中開始的上傳在連上後送出完整的 begin、chunk、end；沒連線時什麼都不送並回連線錯誤）；`composer/woowtech-upload-reconnect.test.ts`（重送、不重送的錯誤、等不到主機、次數上限、等 client 重連或換 client、訊息翻譯）。裝置上的重連重送在定向輪（integration-0928）驗過，見「驗證紀錄」。

### 22. 廠商標誌改用文字徽章（品牌合規）

- 原因：Anthropic 的條款不准把它的名稱或標誌當成產品自己功能的名稱，使用標誌也要書面許可。owner 在 2026-09-27 先把 Claude 標誌換成文字徽章，2026-09-29 決定所有廠商都照這個做法，不逐家做法律審查。git 平台（GitHub、GitLab、Gitea、Forgejo、Codeberg）的圖示保留（2026-09-30 起 GitLab 改用徽章，第 24 節）。owner 之後要逐家查能不能用（上游 Paseo 都用標誌），查過可以用的廠商會改回上游的標誌，做法見下面「改回上游標誌」。
- 徽章：圓角方框裡是廠商名稱的縮寫，一個大寫字母，或大寫加一個小寫（C、Cx、Gh、Ge），線條用呼叫端傳進來的顏色（主題的前景色或次要前景色）。沒有廠商的標誌，也沒有廠商的代表色（Claude 的 #D97757 這類）。
  - 字母是路徑畫的單線字形，不用 `<text>`：iOS、Android 和網頁不必靠字型，畫出來都一樣。viewBox 24 裡，一個字母高 10；兩個字母高 8.5，放不進方框時再縮，但至少 7（12 px 時 3.5 px），線寬至少 1.8。
  - 廠商名稱照舊用文字顯示在徽章旁邊，所以縮寫可以重複；內建 7 家在模型選單裡並列，縮寫都不同。
- fork 檔 `packages/app/src/components/icons/vendor-badge.ts`：方框、字形、縮寫表（`VENDOR_MONOGRAMS`，依 provider id、ACP 圖示 id、終端機設定檔圖示、桌面版編輯器 id）和 SVG 字串。沒列在表上的 id 用 id 的第一個英文字母。`vendor-badge-icon.tsx` 是 react-native-svg 的元件；`claude-badge.ts` 只剩 `CLAUDE_BADGE_SVG` 和哪些 id 算 Claude。
- 哪一家顯示徽章、哪一家顯示上游標誌，是 `woowtech/vendor-marks.mjs` 的資料：每一家一筆，`show` 是 `"badge"` 或 `"upstream"`，另外列出它的圖示檔（`files`）、在 `acp-provider-icons.ts` 的項目（`acpIcons`）和標誌路徑資料的開頭（`logoPaths`，守門用）。`woowtech/tools/write-vendor-badges.mjs` 照這份資料寫檔：顯示徽章的廠商，圖示元件改成 `createVendorBadgeIcon("<id>")`、vendored `.svg` 寫成徽章、ACP 項目寫成 `vendorBadgeSvg("<id>")`、桌面版的 PNG 刪掉；顯示上游標誌的廠商，這些檔和 ACP 項目從 `UPSTREAM_REF`（`130705c02^`，fork 改任何廠商圖示之前的最後一個 commit；除了 Claude 以外內容跟 main `fde226d05` 相同）原樣還原。`--check` 只檢查。
- 用到它的上游檔：
  - `components/icons/{claude,codex,copilot,opencode,pi,omp,minimax,discord}-icon.tsx`：整個換成 `createVendorBadgeIcon("<id>")`，匯出名稱不變，`provider-icons.ts` 的內建對照不用改。Discord 那個沒有地方在用（第 10 節拿掉了 Discord 連結），換掉是為了不出貨它的路徑資料。
  - `assets/acp-provider-icons.ts`：由上面的工具寫，不要手改。repo 裡沒有上游的產生器，上游每次都手改它；合併時上游新增的一筆會帶廠商的 SVG，守門會擋：在 `vendor-marks.mjs` 加那一家，再跑工具。
  - `assets/acp-provider-icons/*.svg`（37 個）、`assets/icons/{claude,codex}.svg`：沒有程式讀，留著是為了合併上游時不衝突，內容由工具寫。
  - `components/provider-icon-name.ts`（+5／-3 行）：已知的 id（內建、ACP、終端機設定檔）先於主機快照的 SVG，主機替這些 id 送來的 SVG 不會用到。
  - `components/provider-icons.ts`（+4／-1 行）：主機送來的 SVG 不畫，改畫這個 provider 的徽章。放在繪製這一層、不放在 `resolveProviderIconName`，是因為上游的 `providers-snapshot.test.ts` 用解析結果裡的 SVG 判斷哪一份快照生效。
- 主機送來的 SVG：外掛 provider 或自訂 provider 的圖示是執行時才拿到的內容，可能是任何廠商的標誌，App 認不出來，所以一律不畫，改畫徽章：縮寫表有的用表（`codex-acp` 顯示 Cx），沒有的用 id 的第一個字母（外掛範例 `direct-example` 顯示 D）。代價是外掛自己設計的圖示看不到（協調者 2026-09-29 同意）。原本「外掛用別的 id 帶 Claude 標誌時照樣顯示」的例外取消。沒有送 SVG 的未知 provider 照舊顯示機器人圖示。
- 桌面版「在…中開啟」：上游其實有出貨編輯器標誌，`packages/desktop/assets/editor-targets/` 的 7 張 PNG（VS Code、Cursor、Zed、WebStorm、Android Studio、Antigravity、Finder），由 electron-builder 打包成 `editor-target-icons`，執行時讀檔。現在：
  - 7 張 PNG 刪掉。`electron-builder.yml` 不改：來源資料夾不在時 electron-builder 只記一行 `file source doesn't exist` 警告，照常打包；哪天某家改回上游標誌，還原它的 PNG 就會打包進去。
  - `runtime.ts` 的 `loadBundledIcon` 改呼叫 fork 檔 `features/editor-targets/woowtech-editor-icons.ts`（+3／-3 行）：PNG 在就照上游顯示圖片，不在就回傳 `{ kind: "badge", vendor }`，App 用同一個徽章畫；Finder 用資料夾符號（Explorer、Files 本來就用它）。
  - 圖示多一種 `badge`：桌面版的 `target.ts`、App 的 `desktop/host.ts` 和 `workspace/desktop-open-targets.ts`；`components/icons/editor-target-icon.tsx` 畫徽章。
  - 上游本來就沒有標誌的編輯器（VSCodium、VS Code Insiders、JetBrains 各 IDE、Kiro、Trae 等）照舊是終端機符號。
- 改回上游標誌（例如 Cursor 查過可以用）：
  1. `woowtech/vendor-marks.mjs` 裡 `cursor` 那一筆的 `show: "badge"` 改成 `show: "upstream"`（一行）。
  2. `node woowtech/tools/write-vendor-badges.mjs`：從 `UPSTREAM_REF` 還原 `acp-provider-icons/cursor.svg`、桌面版的 `editor-targets/cursor.png`，並把 `acp-provider-icons.ts` 的 `cursor` 項目換回上游的 SVG。
  3. `node --test woowtech/*.test.mjs`，再照驗證流程跑 App、桌面版的測試與 typecheck。守門會照資料自動放行這一家的檔案，同時繼續擋其他廠商。Claude 也一樣：改 `claude` 那一筆，守門裡 Claude 專用的三項會自動略過。
  - 改回徽章：把 `show` 改回 `"badge"` 再跑一次工具。
  - 解析和繪製的程式不用改：內建 provider 看圖示元件檔，ACP 看 `acp-provider-icons.ts`，桌面版看 PNG 在不在；主機送來的 SVG 不論哪一家都畫徽章。
- 顯示上游標誌的廠商（2026-09-30，逐家研究的第一部分）：
  - 依據：協調資料夾的 `coord/reports/logo-usage-research.md`（不在 repo 裡）§2.0、§2.2、§3.1 (a)。這 13 家都判 A：圖示是廠商或專案作者自己送進官方 ACP registry 的（作者本人加的 Gajae Code 例外，它不在 registry，是作者在上游 PR #3471 加的），而且找不到相反的規則。registry 要求圖示用 `currentColor`，就是設計來讓 ACP 客戶端照主題色顯示，跟我們的畫法相同。上游的檔案就是 registry 的檔案，工具從 `130705c02^` 原樣還原，沒有下載任何檔案。
  - 13 家與判定：
    - agoragentic（Agoragentic 本人送）、autohand（創辦人送）、crow（作者本人）、dirac（dirac-run）、fast-agent（作者本人）、nova（主要貢獻者）、sigit（第二大貢獻者）、stakpak（Stakpak 工程師重送）、vtcode（作者本人）：A（registry）。
    - cortex-code（Snowflake 員工送）：A（registry，弱）；另外不能把 Snowflake、Cortex 放進自家產品名。
    - dimcode（ArcShips）：A（registry）；條款只禁止會造成混淆的用法。
    - qoder（Qoder 開發者送）：A（registry）。
    - gajae-code（`gjc`）：A（作者本人），作者的 README 把 Paseo 列為支援的客戶端。
  - 條件（研究 §2.2 的 R 條件）：用 registry 原檔；照主題色顯示；旁邊有 agent 名稱，不暗示背書或合作；registry 更新時跟著更新；廠商要求撤下時改回徽章。
  - 「旁邊有 agent 名稱」的現況（只讀程式，沒有改）：
    - 有名稱：設定頁的供應商列表、新增 ACP 供應商的目錄（圖示＋名稱＋版本＋說明）、模型選單的供應商列和供應商頁的標題（混合清單的模型列寫「供應商 · 說明」）、匯入工作階段的供應商篩選、用量卡、指令選單的模型路徑。
    - 圖示旁是標題，不是 agent 名稱：側欄的 Agent 列（對話標題）、工作區的 Agent 分頁（對話標題；供應商名稱只在副標題「{供應商} agent」和 tooltip）、子 Agent 列和分頁（子 Agent 名稱；分頁副標題有供應商）、排程列（排程標題）、匯入工作階段的列（工作階段標題）、composer 的模型按鈕（模型名稱）。終端機設定檔顯示的是使用者自己取的設定檔名稱。
  - 哪一家要求撤下，就把它在 `woowtech/vendor-marks.mjs` 的 `show` 改回 `"badge"`（一行）再跑工具。
  - 其他廠商繼續顯示徽章，等 owner 決定條件怎麼做：junie、zed、webstorm、android-studio 要先加商標歸屬聲明或改標籤；研究 §3.1 (b) 的 opencode、cursor、cline、kilo 要先核對跟官方素材一致；(c) 的 codex、vscode、gemini、antigravity、grok、mistral-vibe 要換官方檔或改色（工具只能還原上游檔）；B、C 兩類照研究維持徽章。
- 主題：內部名稱 `claude` 的深色主題改叫「陶土」，英文 Terracotta。
  - 名稱寫在 fork 檔 `i18n/theme-copy.ts`，跟 `support-copy.ts` 一樣由 `brand.ts` 在載入翻譯時套用，不改上游的語系檔：繁中和簡中「陶土」、英文 Terracotta、日文テラコッタ、韓文테라코타、西班牙文和葡萄牙文 Terracota、法文 Terre cuite、俄文 Терракота、阿拉伯文 تيراكوتا。上游之後新增的語言顯示英文。
  - `zh-TW.ts` 不用重新產生：產生器照舊留英文（`zh-tw-untranslated.mjs` 的 `KEEP_ENGLISH` 把這個 key 從「主題名稱」移到「載入時替換」那組），顯示時換成「陶土」。
  - id、unistyles 名稱 `darkClaude` 和顏色（強調色 #d97757、代表色 #D97757）都不變，已經選了這個主題的人設定照舊。
- 刻意沒改的：
  - git 平台的圖示（owner 決定保留；2026-09-30 起 GitLab 改用徽章，GitHub 和 Codeberg 只畫純黑或純白，第 24 節）。
  - 檔案總管的檔案類型圖示（`components/material-file-icons.ts`，material-icon-theme 的程式語言和工具圖形）：owner 在 2026-09-30 決定換掉 8 個，第一階段審查依所有者原文再換掉 Astro、Gradle、GraphQL、Lua 4 個，其餘保留，見第 24 節。
  - `packages/app/assets/images/editor-apps/*.png`：上游放在 App 套件裡的編輯器標誌，App 沒有任何地方引用，不會打包；上游官網引用其中的 `finder.png`。
  - 上游官網 `packages/website`（我們不部署，第 18 節）。
- 測試（App 和桌面版的測試不看哪一家顯示什麼，改回上游標誌時不用改測試；照資料檢查的都在守門）：
  - `components/woowtech-vendor-badge.test.ts`：縮寫表和沒列在表上的 id；每一種大寫、大寫加小寫都放得進方框並留邊，字高和線寬不低於上面的下限，而且置中；SVG 只用 currentColor；徽章元件在四種圖示尺寸（12、14、16、20）和淺色、深色主題的前景色下畫出正確的縮寫；ACP 目錄的每一家就算主機送了 SVG 也畫目錄自己的圖示；其他 provider 的主機 SVG 畫成徽章；每個 ACP 圖示 id 都有縮寫。
  - `components/woowtech-claude-badge.test.ts`：Claude 的徽章是 C；`claude-acp` 不論主機有沒有送 SVG 都跟 `claude` 同一個圖示。
  - 上游的 `provider-icons.test.ts`：主機 SVG 的預期值改成徽章（註解 `woowtech smart:`）。`provider-icon-name.test.ts`、`providers-snapshot.test.ts` 不用改。
  - e2e `plugin-provider-icons.spec.ts` 的 helper：設定頁、新工作區的模型選單、窄版和既有 Agent 的 composer 都畫 `direct-example` 的徽章，而且沒畫外掛 `icon.svg` 的路徑。本機沒跑（要 Metro 和 daemon），交給 CI。
  - 桌面版 `features/editor-targets/woowtech-editor-icons.test.ts`：用暫存資料夾，PNG 不在時編輯器是徽章、Finder 是資料夾，PNG 在時照上游回傳圖片。
  - `i18n/woowtech-theme-copy.test.ts`：陶土、Terracotta；每種語言的主題名稱都不含 Claude（含各語言的音譯，例如西文的 claudio）；id、unistyles 名稱和顏色不變。
  - 守門 `woowtech/claude-badge.test.mjs`（沿用檔名，範圍擴大到所有廠商，照 `vendor-marks.mjs` 檢查）掃 App（`src`、`assets`、`public`、`plugins`）、桌面版（`src`、`assets`）、server 和 CLI 出貨的檔案：
    1. Claude 顯示徽章時，不准出現 Claude 標誌的兩份路徑資料；其他顯示徽章的廠商也不准出現各自的標誌路徑資料（取自上游，去掉空白和逗號後比對開頭）。
    2. Claude 顯示徽章時，Claude 的圖示檔不准寫死顏色（hex、`rgb()`、`hsl()`），兩個 `.svg` 和 ACP 那一筆等於 Claude 的徽章。
    3. 每個廠商圖示檔都跟資料一致：顯示徽章的是徽章（元件、`.svg`、ACP 項目），PNG 不在；顯示上游標誌的跟 `UPSTREAM_REF` 逐位元組相同。徽章檔不准寫死顏色。
    4. 上游出貨的每個廠商圖示（vendored `.svg`、桌面版 PNG、ACP 項目）都要在資料裡，而且只屬於一家。
    5. 只有白名單的檔案可以有 SVG 路徑資料：徽章的字形、4 個 git 平台標誌（GitLab 改成徽章後由資料檢查）、WOOW 標誌、齒輪、勾和叉、檔案類型圖示、Mermaid、終端機字形，每一項寫了理由；顯示上游標誌的廠商的檔案自動放行。白名單的檔案不再畫圖時也會失敗。
    6. 出貨的點陣圖只能是我們自己的圖示（App、favicon、PWA、桌面版）和資料放行的廠商標誌；`editor-apps` 的編輯器標誌不准被引用。
    7. 只有白名單的地方可以渲染 SVG 文件（`SvgXml`、`SvgCss`、`SvgIcon` 等）：provider 圖示、ACP 目錄、檔案類型圖示、使用者自己的專案圖示、配對 QR Code。上游 main 的 `usage/source-icon.tsx`（用量來源的 SVG）這類新地方合併進來就會失敗，要先決定怎麼換成徽章。
    8. 主機替已知 provider 送 SVG 時解析結果不是那份 SVG，`provider-icons.ts` 在主機 SVG 的位置畫徽章。
    9. 每種語言的主題名稱都不含 Claude（含音譯），繁中「陶土」、英文 Terracotta，`theme.ts` 的 id 和 unistyles 名稱不變。
  - 變異測試（2026-09-30，在 `c057fae60` 上）：每次只改一處，跑 `claude-badge.test.mjs` 和 `icons.test.mjs`（共 18 項），看它變紅，再還原，每次還原後樹都是乾淨的：
    - 放回上游的 Codex 元件：2 項失敗（標誌路徑、圖示檔跟資料不符）。
    - `acp-provider-icons.ts` 的 Cursor 那一筆放回上游的 SVG：3 項（標誌路徑、圖示檔、畫圖白名單）。
    - 放回桌面版的 `cursor.png`：1 項（圖示檔）。
    - `provider-icons.ts` 改回畫主機的 SVG：1 項。
    - 繁中的主題名稱改回 Claude：1 項。
    - 放回上游的 Claude 元件：2 項（Claude 標誌、圖示檔）。
    - 網頁版啟動畫面放回 Paseo 的蝴蝶：2 項（畫圖白名單、Paseo 標誌）。
    - 新增一個用 `SvgXml` 的檔案：1 項（渲染 SVG 的地方）。
    - ACP 圖示資料夾多一個資料沒列的 SVG（上游的 Cursor 圖）：2 項（標誌路徑、資料沒列）。
  - 改回上游標誌的演練（同一天）：把 `cursor` 改成 `"upstream"` 再跑工具。工具改了 3 個檔（`acp-provider-icons/cursor.svg`、`editor-targets/cursor.png`、`acp-provider-icons.ts` 的 cursor 項目），內容跟 `130705c02^` 逐位元組相同。守門 18/18、App 的 5 個廠商相關測試檔 37/37、桌面版 3 檔 14/14、App 的 typecheck 都通過，程式和測試都不用改。改回 `"badge"` 再跑一次工具，樹回到乾淨。
  - 小尺寸和深淺色主題上看不看得清楚，要在實機上看，單元測試證明不了。

### 23. 關掉帳號用量（方案額度）

- 原因：owner 在 2026-09-29 決定隱藏用量頁。上游的用量功能為了查每家 provider 的帳號額度，會讀使用者存下的 provider 憑證，再把 token 送到該家的額度 API。對我們的產品，這是隱私問題。讀的東西（全部在 `packages/server/src/services/quota-fetcher/providers/`，只讀不寫）：
  - Claude：`$CLAUDE_HOME` 或 `~/.claude` 的 `.credentials.json`（不看 Claude Code 的 `CLAUDE_CONFIG_DIR`）；macOS 上沒有這個檔，就用 `security find-generic-password` 讀鑰匙圈的「Claude Code-credentials」，換了 `HOME` 也照樣讀得到。拿到 OAuth token 就呼叫 api.anthropic.com。
  - Codex、Kimi、MiniMax、Grok：各自的 auth／credentials 檔（`~/.codex/auth.json`、`~/.kimi…`、`~/.mmx/…`、`~/.grok/auth.json`）或環境變數的 token。
  - Copilot：`GITHUB_TOKEN` 這類環境變數或 `gh` 的 `hosts.yml`。Cursor：環境變數、Cursor 的 `state.vscdb`（SQLite）或 `~/.config/cursor/auth.json`。Z.AI：`ZAI_API_KEY`、`GLM_API_KEY`。
- 關掉的：
  - daemon：政策在 `packages/server/src/server/woowtech-provider-usage-policy.ts`，固定回 false，不讀 env、home 或設定。上游的 `ProviderUsageService`（`quota-fetcher/service.ts`，+18／−6 行，註解 `woowtech smart:`）關閉時建構子不建任何 fetcher，`listUsage` 第一行就回空清單，不經快取。`provider.usage.list.request` 照樣回 `provider.usage.list.response`，`providers` 是空陣列：沒有 rpc_error、沒有讀鑰匙圈或憑證檔、沒有網路請求。daemon 本來就沒有背景輪詢或主動推送帳號用量，只在收到請求時查。
  - 協定不變，`server_info.features.providerUsageList` 仍是 true。改成 false 的話，舊版 App 每次打開 context 圓環的 tooltip 都會出現紅字「Update the host to see provider usage」；維持 true 加空清單，舊版 App 的 tooltip 不多東西，用量頁顯示「No usage data」。client SDK 的 `providers.listUsage()` 拿到空清單。
  - App：旗標在 `packages/app/src/provider-usage/woowtech-usage-visibility.ts`（`PROVIDER_USAGE_VISIBLE = false`）。設定的主機清單（桌面版側欄和手機設定首頁共用）沒有「用量」這一列；`/settings/hosts/<id>/usage` 當成不認得的區段，開到「連線」；context 圓環的 tooltip 不送用量請求、不顯示用量區塊。連到還開著用量的舊版或上游 daemon 時也一樣，不會讓對方去讀憑證。接點都有 `woowtech smart:` 註解：`screens/settings-screen.tsx` 的 `HOST_SECTION_ITEMS`、`app/settings/hosts/[serverId]/[hostSection].tsx`、`components/context-window-meter.tsx` 三處。`HostUsagePage` 和 `provider-usage/` 的元件留著，走不到。沒有新的介面文字。
- 保留的：每個工作階段自己的 token、context 和費用。它們來自 agent 的事件（`usage_updated`、`turn_completed` 帶的 usage；Pi、OMP 是 poller 向自己的 agent 行程要 `get_session_stats`），不讀帳號憑證，也不打額度 API。context 圓環和 tooltip 的「上下文視窗」、「已使用 N%」、tokens、「工作階段費用」照舊。
- 以後要打開：
  1. 先決定讀哪些憑證、要不要讓使用者自己選（例如設定頁的開關，預設關），再改。不要直接把政策改回 true。
  2. 改 `isProviderUsageFetchingEnabled()` 和 `PROVIDER_USAGE_VISIBLE`（或接到使用者的選擇），同時改兩個守門（`woowtech/provider-usage*.test.mjs`）、fork 測試的 OFF 基線、兩個上游 e2e spec 的 `describe.skip`，並把「Usage」加回桌面版 `settings-memory.electron.mjs` 的設定清單。
  3. 上游的 `792715e76`（#5465，用量來源改成內建外掛、跟著工作階段的帳號）仍延後。它刪掉整個 `quota-fetcher/` 和 `provider-usage/`，也改了這節的三個 App 接點和 `websocket-server.ts`。拿它的時候，這節的 gate 要在新架構重做，守門會先紅。
- 測試：
  - `services/quota-fetcher/woowtech-provider-usage.test.ts`：OFF 基線（政策、service 和 RPC 都回空清單；stub fetcher、鑰匙圈 stub 和 fetch stub 都是 0 次）；ON 對照（同一組 stub 看得到 fetcher 1 次、鑰匙圈 1 次、api.anthropic.com 1 次）；Pi 和 OMP 的每工作階段計數照舊。Claude 的 fetcher 用暫存 home、鑰匙圈 stub 和 fetch stub，政策打開時也碰不到真的 `~/.claude`、鑰匙圈或網路。
  - 上游 `service.test.ts` 每個 `new ProviderUsageService` 都注入 `isUsageFetchingEnabled: () => true`，原斷言不變（同第 20 節的做法）。
  - App：`provider-usage/woowtech-usage-visibility.test.ts`（清單少了用量列、其他列順序不變，用量路由當成不認得，打開時恢復）；`components/woowtech-context-window-meter.test.tsx`（jsdom：主機仍宣告有用量，打開 tooltip 只有上下文、tokens 和費用，`listProviderUsage` 0 次）。
  - 守門 `woowtech/provider-usage.test.mjs`（daemon）和 `provider-usage-app.test.mjs`（App）：政策固定 false；service 的兩個 gate；daemon 建 service 不帶任何 override；server 出貨的程式裡，fetcher 只能由 service 建、service 只能由 daemon 建（AST 掃描，擋 import alias、namespace、re-export、dynamic import、`extends`）；沒有出貨的 server 程式寫到 `isUsageFetchingEnabled`；App 旗標固定 false、三個接點；App 出貨的程式裡，除了現有的擁有者，沒有檔案用到用量的元件、hook、`listProviderUsage`、`provider.usage.list.request` 或 `section: "usage"`。
  - e2e：上游的 `provider-usage-settings.spec.ts`、`provider-usage-tooltip.spec.ts` 改成 `describe.skip`，`helpers/settings.ts` 改成期待沒有用量列；新的 `woowtech-provider-usage-hidden.spec.ts` 驗側欄沒有用量列、用量路由開到「連線」、tooltip 不送請求。CI #10（run 36642688479，含 Playwright）這 2 個都過。
  - 桌面版 browser E2E 的設定輪播（`packages/desktop/e2e/settings-memory.electron.mjs`，上游檔）拿掉「Usage」，其他列照舊輪一遍。CI #10、#11 的 desktop-tests 就是在這裡等不到用量列，30 秒逾時。
  - `provider-usage-app.test.mjs` 也掃 App 和桌面版的 e2e（`packages/app/e2e/`、`packages/desktop/e2e/` 的 JS／TS 與 agent-device 流程），不准再開用量頁：「Usage」字樣、`settings-host-section-usage`、`openSettingsHostSection`／`buildSettingsHostSectionRoute` 帶 `"usage"`、`section: "usage"`、`/settings/hosts/<id>/usage`。例外：`describe.skip` 裡的上游 spec；斷言不存在的 `expect`（`toHaveCount(0)`、`toBeHidden()`、`not.toBeVisible()`、`not.toBeAttached()`）；`woowtech-provider-usage-hidden.spec.ts` 開舊路由、確認落到「連線」的那一行。改 settings-memory 前這項紅（抓到第 28 行），改後綠。
- 合併上游後：跑 `node --test woowtech/provider-usage.test.mjs woowtech/provider-usage-app.test.mjs`、server 的 `woowtech-provider-usage.test.ts` 與 `service.test.ts`、App 的 `woowtech-usage-visibility.test.ts` 與 `woowtech-context-window-meter.test.tsx`。

### 24. 商標與第三方授權（上架合規）

- 依據：協調資料夾的 `coord/reports/logo-usage-research.md`（逐家研究，不在 repo 裡，不是法律意見）。
- owner 的決定（2026-09-30）：
  - 06:5x 同意協調者的四項建議：
    1. 規則允許使用標誌的 14 家（codex、opencode、cursor、cline、kilo、gemini、antigravity（含 agy）、grok、mistral-vibe、junie、zed、webstorm、android-studio、vscode），等 App 符合各家的條件後改回標誌。
    2. GitLab 的 forge 標誌改成文字徽章。
    3. 檔案類型圖示 go、swift、terraform、hcl、vue、sass、dart、elixir 改成通用檔案圖示。
    4. 只去問 GitHub（Copilot）、Pi 和 OMP：協調者擬稿，owner 寄出。對方同意之前維持徽章。
  - 07:0x 補充：「同意前先用徽章，後面可以改版更新再優化，目前以可以先上架為目的」。所以分兩階段：
    - 第一階段是上架前一定要有的，單獨先出：第 2、3 項和授權頁（本節，分支 `woowtech/logo-compliance-0930`）。
    - 第二階段是之後的改版，不能擋第一階段：第 1 項（`woowtech/logo-restore-0930`）。第 4 項不改程式。
- 設定的「商標與第三方授權」頁（英文 Trademarks and third-party notices）：
  - 位置：設定的 App 區段，排在「關於」後面，網址 `/settings/notices`。桌面版在側欄，手機在設定首頁的列表，點進去有返回鍵。iOS、Android、網頁和桌面版是同一份程式。
  - 內容依序：
    1. 商標：渥屋智能跟列出的公司或專案沒有從屬關係，也沒有獲得它們的贊助或背書；名稱與標誌屬於各自的所有者，只用來標示它們代表的 Agent、服務與檔案類型。
    2. Agent：顯示自己標誌的廠商，就是 `vendor-marks.mjs` 裡 `show: "upstream"` 的（目前是 13 家 ACP agent），列名稱和所有者。
    3. Git 平台：GitHub、Gitea、Forgejo、Codeberg。Forgejo 附 CC BY-SA 4.0 署名「Forgejo logo by Caesar Schinas」（照原文），另一行說明改成單色（`changes: "singleColor"`，繁中「修改：重新繪製成單色」）；Codeberg 附它的商標聲明和 CC0；Gitea 的 logo 在它 MIT 授權的 repo 裡，列進 MIT。GitLab 是徽章，不列。
    4. 檔案類型圖示：第一列說明改作（material-icon-theme 重新繪製、渥屋智能調淡顏色；改作自 CC BY-SA 標誌的圖示以同一授權分享），接著 24 個標誌（25 個圖示，React 的 .jsx、.tsx 共用一個），每個都有所有者。授權要求署名的照原文附上署名、授權連結和來源：Rust（CC BY 4.0）、PHP、R、Zig、SVG（CC BY-SA 4.0）、Ruby（CC BY-SA 2.5）、HTML5（「HTML5 Logo by W3C」，CC BY 3.0）、Nix（CC BY 4.0，NixOS 指定的 TASL 格式）。Python 附 PSF 要求放在法律聲明頁的句子；Kotlin、Apache Groovy 附各自的商標聲明。Haskell、Markdown 的標誌屬公眾領域。
    5. MIT 授權：material-icon-theme（Copyright (c) 2025 Material Extensions）、JS、TOML、Gitea 標誌的版權行，加上 MIT 授權全文（MIT 要求隨附）。
  - 名稱、所有者、署名和授權條文照原文，不翻譯；標籤（所有者、授權、來源、修改）、段落標題和說明有繁中和英文（`woowtech.thirdPartyNotices`，其他語言顯示英文）。不是任何所有者原文的字也翻譯：公眾領域（`LICENSES.publicDomain` 用 `nameKey`，不是授權名稱）、渥屋智能改了什麼（`changes`）、MIT 段作品標題裡的「標誌」（`logo: true`，繁中「JS 標誌」）。文字可以選取，方便複製授權網址。
  - 署名的核對：每一項都讀過來源頁原文（2026-09-30），存在協調資料夾外的 `logs/logo-s1-sources/`。研究沒列、原文卻要求署名的有 4 項，已經補上：Nix（CC BY 4.0）、SVG（W3C 的 CC BY-SA 4.0，署名「W3C SVG Logo」）、JS logo 和 TOML logo（MIT）。
  - 檔案：
    - 資料 `screens/settings/woowtech-third-party-notices.ts`：這頁唯一的資料來源（`VENDOR_MARK_NOTICES`、`FORGE_MARK_NOTICES`、`FILE_TYPE_MARK_NOTICES`、`GENERIC_FILE_ICONS`、`MIT_NOTICES`、`MIT_LICENSE_TEXT`），和組出整頁文字的 `buildThirdPartyNotices(t)`。
    - 畫面 `screens/settings/woowtech-third-party-notices-section.tsx`：跟其他設定頁一樣用 `SettingsSection` 和卡片；每段的用途放在標題旁的 info 提示，改作說明和商標聲明是卡片裡的列，一定看得到。
    - 上游檔的接點（註解 `woowtech smart:`）：`utils/host-routes.ts` 的 `SETTINGS_SECTION_SLUGS` 加 `"notices"`；`screens/settings-screen.tsx` 的 `SIDEBAR_SECTION_ITEMS` 加一列（lucide 的 `Scale`），區段的 switch 加 `default`，交給 fork 的 `renderWoowtechSettingsSection`（在 `woowtech-third-party-notices-section.tsx`）。用 `default` 而不是再加一個 `case`，是因為那個函式的 complexity 已經是 lint 的上限 20。
  - 新增一筆（例如第二階段把 codex 改回標誌）：
    1. `woowtech/vendor-marks.mjs` 把它改成 `show: "upstream"`，跑 `node woowtech/tools/write-vendor-badges.mjs`。
    2. `node --test woowtech/third-party-notices.test.mjs` 會紅，列出沒有條目的廠商。
    3. 在 `VENDOR_MARK_NOTICES` 加一筆，key 跟 `vendor-marks.mjs` 相同：`name`（App 在標誌旁顯示的名稱）、`owner`，加上那家規則要求的 `credit`（照原文，例如 OpenAI 要承認標誌屬於 OpenAI、JetBrains 的「X and the X logo are trademarks of JetBrains s.r.o.」、Google 的法律聲明）；有授權時加 `license` 和 `source`，CC BY 系列三者都要有，守門會檢查。
    4. 守門和 `woowtech-third-party-notices.test.ts` 綠了就好，畫面不用改。
    - forge 或檔案類型圖示有增減時一樣：守門從 forge 的 view 模組和 `material-file-icons.ts` 算出會顯示的標誌，新標誌要有條目，通用圖形要列進 `GENERIC_FILE_ICONS`。
    - App 不用 lucide 的品牌圖示（`Github`、`Gitlab`、`Figma` 等 18 個，任何別名，例如 `GithubIcon`、`LucideGitlab`）：lucide 的是自己重畫的線條版，而且跟著呼叫端的顏色（多半是灰），不是各家允許的官方圖。要畫 forge 標誌，用 `components/icons` 的元件，放在旁邊有平台名稱、不會變半透明的地方；其他地方用通用圖示。
- GitLab（研究 §2.5）：GitLab 的商標指引只允許散佈 GitLab CE 時使用 logo，名稱可以用。
  - `vendor-marks.mjs` 加了 `gitlab`（`show: "badge"`、tanuki 的路徑資料），工具把 `components/icons/gitlab-icon.tsx` 寫成 `createVendorBadgeIcon("gitlab")`，縮寫 Gl（`vendor-badge.ts`）。第 22 節的守門照資料一併檢查它，tanuki 的路徑資料不再出貨。
  - `git/forges/gitlab.view.tsx` 的 `brandColor` 改成 `null`：徽章跟著呼叫端的顏色，不用 GitLab 的橘色（第 22 節：徽章沒有廠商的代表色）。
  - 「Open on GitLab」、MR 這些文字不變。
- GitHub、Codeberg（研究 §2.5）：GitHub 只允許黑、白（少數情況灰、綠），Codeberg 不准改色。
  - fork 檔 `components/icons/woowtech-monochrome-mark.tsx` 的 `createMonochromeMarkIcon`：不管呼叫端傳什麼顏色（次要前景色、前景色或品牌色，隨 hover、選取、分頁狀態變），淺色主題畫純黑 #000000、深色主題畫純白 #FFFFFF，看 `theme.colorScheme` 決定，外掛主題也一樣。
  - `github-icon.tsx`、`codeberg-icon.tsx` 改用它，路徑資料不變；`codeberg.view.tsx` 的 `brandColor`（#2185D0）改成 `null`。
  - PR 動作（建立、檢視、合併 PR 和自動合併；分割按鈕、下拉選單和指令中心用同一個圖示）遇到 GitHub、Codeberg 時畫通用的 PR 圖示（lucide `GitPullRequest`，次要前景色），第一階段審查（2026-09-30）時改的：
    - 原因：這些動作停用或無法使用時整列變半透明，分割按鈕停用 `opacity: 0.6`（`git/actions-split-button.tsx`），選單項停用 0.5、無法使用 0.72（`components/ui/menu/menu-item.tsx`）。淺色主題的純黑會變成約 #808080、#666666、#474747 的灰，深色主題的純白也一樣變灰；GitHub 只在少數情況允許灰色，Codeberg 不准染色。這些動作的文字（Create PR、Merge PR）也沒有平台名稱。
    - 做法：`createMonochromeMarkIcon` 登記它做出的元件（`isMonochromeMarkIcon`）；fork 檔 `git/woowtech-forge-marks.ts` 的 `dimmableForgeIconKind` 遇到這種標誌就回傳沒有平台註冊的 icon kind，`ForgeBrandIcon` 對沒註冊的 kind 畫通用 PR 圖示。上游檔只改 `git/use-actions.tsx` 的 `renderForgePrIcon` 一行和一個 import。以後有新的純黑白標誌也自動適用。
    - 其他畫 GitHub、Codeberg 標誌的地方都不會變半透明：「Open on GitHub」這類選單項、「用…開啟」主按鈕（進行中改顯示轉圈）、hover card 的檢查列、輸入框的附加選單、檔案總管的 PR 分頁。
  - Gitea、Forgejo 照上游：一般是次要前景色，PR 動作按鈕上是 Gitea 綠、Forgejo 橘。
- 檔案類型圖示（研究 §2.4）：`material-file-icons.ts` 拿掉 go、swift、terraform、hcl、vue、sass、dart、elixir 八個 SVG 和它們的副檔名對應（.go、.swift、.tf、.hcl、.vue、.scss、.dart、.ex、.exs），這些檔案顯示通用的 `_default`。原因：Go、Swift、HashiCorp（Terraform、HCL）要許可，Vue、Sass 不准商用，Dart、Elixir 不准改色（`file-icon-svg.ts` 會降飽和）。
  - 第一階段審查（2026-09-30）照所有者的原文，另外拿掉 astro、gradle、graphql、lua 四個 SVG 和副檔名對應（.astro、.gradle、.graphql、.gql、.lua）。它們符合研究自己的 B 定義（要事先許可，或明文禁止這種用法，包括禁止改色），跟 Dart、Elixir 同一個理由：
    - Astro（press 頁）：「Don't modify the Astro logo or change its colors」。
    - Gradle（商標使用指引）：「You may not use any of the Trademarks unless you have a written agreement with Gradle」、「A logo should not be displayed with color variations」。
    - Lua（lua.org/images）：允許任何用途，但「The only modification you can make is to adapt the orbiting text」；material 的圖示是重畫、改色的版本。
    - GraphQL（brand 頁）：商標與 logo 受 LF Projects 商標政策約束，「any other commercial purpose」要先許可；研究 §2.2 的 goose 依同一份政策判 B。
    - 原文存在協調資料夾外的 `logs/logo-s1-sources/`（gradle-tm-guidelines、astro-press、lua-images、graphql-brand）。研究把這四個判成 A 或 C，owner 06:5x 的決定是依研究的判定做的，沒看過這些原文；這裡依 owner 07:0x「同意前先用徽章」的原則先換成通用圖示，只降低風險。要改回，等所有者同意，或在第二階段換成不改色、不改形的官方檔（Gradle 仍要書面同意）。
  - 留下 42 個：25 個畫標誌的圖示（24 個標誌）列在授權頁，17 個通用圖形（含 `_default`）列在 `GENERIC_FILE_ICONS`。
- 上架規則：商店截圖、商店的宣傳圖、官網和其他行銷素材，不能出現第三方的標誌（廠商標誌、Git 平台標誌、檔案類型圖示）。
  - 原因：Google 要求含 Android 或 Google 商標的行銷素材先送審（研究 §2.3、§3.4 第 6 點），多數廠商不准把標誌用在行銷或周邊，例如 Kotlin、Astro、LF Projects（goose、GraphQL）、Kimi、Rust。
  - 做法：截圖避開檔案總管的語言圖示、設定的供應商列表、新增 ACP 供應商的目錄、Git 平台的按鈕和這一頁；需要時用只有徽章和通用圖示的示範專案拍。第二階段改回標誌之後同樣適用。
- 守門 `woowtech/third-party-notices.test.mjs`（11 項）：
  1. 顯示自己標誌的 Agent（`vendor-marks.mjs` 的 `show: "upstream"`）都有條目，沒有多的。
  2. 畫自己標誌的 forge（view 模組的圖示不是徽章）都有條目，沒有多的。
  3. App 不畫 lucide 的品牌圖示。名單和別名從 lucide 自己的型別宣告讀（標成 deprecated 的「Brand icons」，0.546.0 有 18 個，各有 3 到 6 個匯出名稱）；擋具名匯入和 re-export（含 `as` 改名）、整包匯入或 `icons` 物件的成員、直接匯入圖示檔。
  4. CC BY 系列的條目都有署名、授權連結和來源；每個條目都有名稱和所有者。
  5. 畫標誌的檔案類型圖示都有條目，通用圖形列在 `GENERIC_FILE_ICONS`，沒有多的或重複的。
  6. MIT 的版權行和條文跟 `material-icon-theme/LICENSE` 一致（升級套件改了年份也會紅）。
  7. 設定從 `/settings/notices` 開這頁：slug、側欄那一列（沒有限平台）、switch 的 case、畫面用 `buildThirdPartyNotices(t)`。
  8. GitLab 是徽章、沒有 brandColor，tanuki 的路徑資料不出貨。
  9. GitHub、Codeberg 用 `createMonochromeMarkIcon`、不收顏色，view 沒有 brandColor。
  10. PR 動作的圖示經過 `dimmableForgeIconKind`（`use-actions.tsx` 的 `renderForgePrIcon`，所有 PR 動作共用它），fork 檔依標誌本身（`isMonochromeMarkIcon`）判斷。
  11. 十二個換掉的檔案類型標誌不在表裡、副檔名不對應、路徑資料不出貨，表裡是 42 個。
  - 第 22 節的 `claude-badge.test.mjs`：`ALLOWED_DRAWINGS` 拿掉 `gitlab-icon.tsx`，GitHub、Codeberg 和檔案類型圖示的理由改成這一節的決定。
  - 變異測試（2026-09-30，在 `dcb7de72d` 上）：每次只改一處，跑 `third-party-notices.test.mjs` 和 `claude-badge.test.mjs`（共 22 項），看它變紅，再還原，每次還原後樹都是乾淨的：
    - `VENDOR_MARK_NOTICES` 少了 agoragentic：1 項（第 1 項）。
    - `FORGE_MARK_NOTICES` 多了 GitLab：1 項（第 2 項）。
    - App 的檔案 import lucide 的 `Gitlab`：1 項（第 3 項）。
    - Rust 那一筆少了 `source`：1 項（第 4 項）。
    - `GENERIC_FILE_ICONS` 少了 lock：1 項（第 5 項）。
    - MIT 版權行的年份改成 2024：1 項（第 6 項）。
    - 設定的這一列加上 `desktopOnly: true`：1 項（第 7 項）。
    - 放回上游的 GitLab 元件（tanuki）：4 項（第 22 節的標誌路徑和圖示檔，這一節的第 2、8 項）。
    - 放回上游的 GitHub 元件（照呼叫端的顏色畫）：1 項（第 9 項）。
    - 放回上游的 `material-file-icons.ts`（八個標誌回來）：2 項（第 5、10 項）。
  - vitest 的對照：`createMonochromeMarkIcon` 改成把呼叫端的顏色傳下去時，`woowtech-forge-marks.test.ts` 的 GitHub、Codeberg 兩項照斷言失敗（呼叫端的 #666666 畫到了標誌上）；還原後 17/17 通過。
- 第一階段審查的修正（2026-09-30）：審查找到四個 blocker，都已修正，每個都先寫測試、看它失敗再改：
  1. 新增專案的「從 GitHub 複製專案」和 GitHub 儲存庫列原本用 lucide 的 `Github` 線條圖示，畫成次要前景色（灰），這一列停用時還會變半透明；授權頁卻寫 GitHub 只用黑白。現在兩處都用通用的 `FolderGit2`（`components/add-project-flow.tsx`，上游檔），列的文字仍寫 GitHub。守門第 3 項改成不准任何 lucide 品牌圖示。
  2. Astro、Gradle、GraphQL、Lua 換成通用圖示，見上面「檔案類型圖示」。
  3. PR 動作遇到 GitHub、Codeberg 畫通用 PR 圖示，見上面「GitHub、Codeberg」。
  4. 繁中頁面原本有 fork 自己寫、沒有繁中的英文：Haskell、Markdown 的「授權：Public domain」，Forgejo 署名後面的「, redrawn in a single color」。現在是「授權：公眾領域」和另一行「修改：重新繪製成單色」，MIT 段的標題也改成「JS 標誌」這種寫法。
  - 變異測試（在修正後的工作樹上，`logs/logo-s1-fix-mutate.sh`）：每次只改一處，跑 `third-party-notices.test.mjs` 和 `claude-badge.test.mjs`（共 23 項），每次都變紅，還原後檔案的 sha256 相同，最後 23/23：
    - 新增專案放回 lucide `Github`：第 3 項。
    - 匯入別名 `GithubIcon`：第 3 項。
    - 匯入別名 `LucideGitlab` 並改名：第 3 項。
    - 整包匯入的成員 `LucideIcons.Github`（`plugins/icons.ts`）：第 3 項。
    - 直接匯入 `lucide-react-native/dist/esm/icons/gitlab`：第 3 項。
    - `renderForgePrIcon` 改回上游那一行：第 10 項。
    - fork 檔不再問標誌是不是純黑白：第 10 項。
    - 放回 Lua 的 SVG 和 .lua 對應：第 5、11 項。
    - 授權頁多一筆 Astro（圖示已不出貨）：第 5 項。
- 測試：
  - `screens/settings/woowtech-third-party-notices.test.ts`：`/settings/notices`；繁中與英文的頁名；商標聲明；13 家 Agent 與所有者；4 個 forge 與 Forgejo 的署名（照原文）和改成單色的說明；8 個檔案類型標誌的署名、授權和來源，Python 的聲明；授權頁列的 24 個檔案類型標誌；MIT 版權行和條文跟 LICENSE 一致；整頁的段落、列和每列的文字（英文和繁中），公眾領域、MIT 段標題的繁中；繁中頁面除了所有者的原文（名稱、所有者、署名、來源、授權名稱、版權行）和 App 刻意保留的「Agent」，沒有英文。
  - `git/woowtech-forge-marks.test.ts`：GitLab 畫 Gl 徽章、沒有品牌色；GitHub、Codeberg 在每個註冊的主題、呼叫端傳任何顏色時都是淺色 #000000、深色 #FFFFFF，而且沒有品牌色；Gitea、Forgejo 照舊；PR 動作對 GitHub、Codeberg 畫通用圖示（次要前景色），其他平台畫自己的圖示和品牌色。
  - `components/woowtech-file-type-logos.test.ts`：十二種標誌的檔案（14 個檔名，含 .exs、.gql）顯示通用圖示；其他 41 種副檔名各有自己的圖示，連同通用圖示共 42 個。
  - `i18n/woowtech-copy.test.ts`：`thirdPartyNotices.` 只翻繁中，其他語言用英文。
- 還沒處理的（列給 owner，不擋這一版）：
  - Rust：研究判 A（標誌是 CC BY 4.0）。rust-artwork 的 README 摘要寫「most commercial uses require permission」，但 Rust Foundation 商標政策的全文只講文字「Rust」可以用來說明軟體用 Rust 寫成，沒有提到在軟體介面裡用標誌。依據比上面四個弱，這次保留，要不要一起換成通用圖示由 owner 決定。
  - 標誌旁沒有平台名稱的地方（審查的建議，不是 blocker）：hover card 的檢查列（標誌＋「Checks」）、輸入框的附加選單（標誌＋「Add issue or PR」）、檔案總管的 PR 分頁（標誌＋PR 編號）、「用…開啟」主按鈕選了 forge 時（標誌＋「Open」，`hideLabels` 時只剩圖示）。研究對 GitHub 的條件之一是旁邊有「GitHub」。
  - 外掛可以用名稱指定任何 lucide 圖示（`plugins/icons.ts` 的 `Reflect.get`），包括品牌圖示；守門只看 App 自己的程式。本 repo 沒有出貨的外掛用到品牌圖示。
  - GitHub 標誌的路徑資料來源不明（上游 `1a01e836b` 加入，沒寫出處），沒有核對是不是官方 Invertocat 原檔；研究的條件是官方原檔、不改形。要換官方檔，由能下載品牌檔的步驟處理。
  - Codeberg 官方 logo 包是藍色和白色兩版；淺色主題畫黑色是照研究「黑或白」的條件。
  - App 沒有開放原始碼授權頁：上游 Paseo（Apache-2.0）和打包進去的 npm 套件的授權聲明，手機版和桌面版都沒有地方顯示。

### 25. 上架候選全面驗收（2026-09-30）找到的介面問題

9/30 在三個模擬器平台驗收 33f2fa8ac（清單和結果 10/8 從舊 Mac 搬到工作資料夾的 `oldmac-0930/`，逐項現況在 `plans/rc-reverify-1008.md`）。owner 2026-10-08 要這些都處理（分支 `woowtech/rc-fixes-1008`）：

- iOS 設定頁不能從左邊緣滑回上一頁（RC-I-09f），標題列的返回鍵照常。兩個原因：一是根 stack 一律不做換頁動畫（`app/_layout.tsx` 的 `ROOT_STACK_SCREEN_OPTIONS`，上游），react-native-screens 把沒有動畫的 pop 交給自己的 animator，滑動推不動它；二是螢幕邊緣手勢在這個 App 裡不會啟動：10/8 在 iOS 27 模擬器用 XCUITest 從左邊緣拖，系統「設定」App 會回上一頁，我們的 App 不管是 UIKit 自己的滑動返回，還是 react-native-screens 給自訂動畫用的邊緣手勢都沒反應，只有它的全畫面拖曳手勢（`fullScreenGestureEnabled`）有。`navigation/woowtech-settings-swipe-back.ts`：iOS、視窗寬度小於 720（unistyles 的 md，跟 `useIsCompactFormFactor` 同一條線）時，設定的 7 個畫面用平台的推入動畫，滑動返回用全畫面拖曳手勢，但只接從左邊緣 50 點以內開始的拖曳（`gestureResponseDistance`），所以還是邊緣滑動，在頁面中間橫拖不會離開。實測（iPhone 17e 模擬器，iOS 27.0）：外觀頁中間橫拖留在原頁，邊緣滑回設定首頁；連線頁邊緣滑回設定首頁；設定首頁再滑回主畫面。較寬的版面不改：設定換頁用的是 replace（`settings-screen.tsx` 的 `handleSelectSection`），有動畫的話每換一個分頁都會滑一次。寬度讀 `useWindowDimensions`，不讀 Unistyles，route tree 才不會每次 Unistyles 更新都重畫（[docs/expo-router.md](../docs/expo-router.md)）。
- 檔案總管斷線後主機回來，仍停在「主機未連線」，要按「重試」（RC-A-14、RC-D-12b；iOS 當時是切到設定再回來才恢復）：上游只在工作區開啟時和按「重試」時載入。`components/woowtech-file-explorer-reconnect.ts`：主機從斷線變成連線、檔案總管正顯示錯誤時，自動重試一次，跟按「重試」一樣。
- 繁中介面寫死的英文（K-37）：側欄工作區選單「Mark as read／unread」、快捷鍵「Pin chat」（`keyboard-shortcuts.ts` 的 `SHORTCUT_HELP_LABEL_KEYS` 沒有 `pin-workspace`，退回英文 label）、新工作區的專案選單「Project」「Search projects」「No projects available.」和主機選單標題「Host」、匯入工作階段的主機選擇「Search hosts...」「No matching hosts」、匯入清單篩選的報讀「Filter: 全部」、新工作區三個選單的報讀「Workspace project」「Host」「Workspace isolation」、問題卡分頁的報讀「Question N of M」。還沒改：底部面板的報讀名稱「Bottom sheet backdrop／handle」「Bottom Sheet」是 @gorhom/bottom-sheet 的預設值，6 個地方各自畫 backdrop，要一起改。文字在 `woowtech-copy.ts` 的 `interfaceText`（繁中和英文，英文照上游）；`woowtech-copy.test.ts` 的 `REPLACED_ENGLISH` 擋住字面值回來。
- 兩台同名主機在選單裡分不出來（K-34）：設定和側欄的主機選單本來就在名字下面顯示連線位址（`showActiveConnection`），新工作區、歷史和排程的主機篩選、排程表單、匯入工作階段的主機選擇沒有（匯入那個顯示完整的 server id）。位址的寫法抽成 `components/hosts/host-picker.tsx` 的 `useHostConnectionLabel`，這幾處都用它。只有位址還不夠：手機經同一個 relay 連每一台主機，兩台同名主機的位址都是 relay.woowtech.io（10/8 POCO 實測）。名字跟另一台相同時，位址後面再加 server id 的前 4 碼（`relay.woowtech.io · 9t3U`，`host-picker-constants.ts` 的 `hostSubtitle`），沒有開位址的選單也會顯示這一行。
- 桌面附件（RC-D-12c1）見第 21 節。
- 10/8 重驗時多找到一個：daemon 的工作目錄被刪掉之後，從 App 設定按「重啟」，daemon 就停了。supervisor 啟動的 worker 沿用 supervisor 的工作目錄，新 worker 一載入就呼叫 `process.cwd()`（相依套件 depd），丟出 ENOENT，還沒就緒就退出，supervisor 隨即結束。當時 Mac 驗收版是從一個之後被刪掉的 worktree 啟動的；從 Finder 或 Dock 開的 App 工作目錄是 `/`，不會遇到，但用 CLI 在某個專案或暫存資料夾啟動 daemon、之後刪掉那個資料夾，就會遇到。`packages/server/scripts/woowtech-worker-cwd.ts`：那個目錄不在了，worker 就改在家目錄啟動（Node 會快取 `process.cwd()`，所以要到磁碟上確認）。`woowtech-worker-cwd.test.ts` 真的跑一個 supervisor：第一個 worker 刪掉 supervisor 的目錄後當掉，第二個 worker 要能讀到自己的工作目錄並就緒；拿掉修正就會紅。
- 10/8 在 iPad 實測時又找到一個：主機沒有語音轉文字服務時，按「開始聽寫」會跳出英文「Dictation is unavailable: speech-to-text service is not ready.」。daemon 用英文說明聽寫和語音模式為什麼不能用（`speech/speech-runtime.ts`），主機資訊裡只有這句話，沒有原因代碼，App 就原樣顯示。`voice/woowtech-voice-readiness-copy.ts`：App 認得的句子換成介面語言（`woowtech.voiceReadiness`，「模型下載中」那句會帶出模型名稱）；沒有自己譯文的語言，和 App 不認得的句子，都維持 daemon 的原文。接點在 `utils/server-info-capabilities.ts` 的 `resolveVoiceUnavailableMessage`，聽寫和語音模式都經過這裡。測試會讀 daemon 的原始碼，句子改了就會紅。
- RC-I-27（composer 長草稿）在 iPad 實測時找到：橫放的 iPad 在「新增工作區」畫面打開螢幕鍵盤，整個置中的表單被推到最上面，蓋住標題列，專案和隔離方式選單被擠出畫面。原因是置中表單整塊位移一個鍵盤高，又預留兩倍鍵盤高的空間，iPad 橫放時鍵盤 353 點、可視區 742 點，算出來的高度上限是 0。上游 2026-10-05 已修（getpaseo/paseo a50e14b69，#6093：表單只位移鍵盤碰到它的部分，高度照鍵盤上方的空間算），這裡照搬。`composer/dock/index.native.tsx` 少了上游 #5680 的內容寬度設定，所以手動搬，其他檔照原樣套用。之後合併上游時以上游為準。實測（iPad 第 9 代橫放）：鍵盤打開時標題、選單、輸入框都在鍵盤上方；30 行時輸入框填滿標題列到鍵盤之間；刪光後回到原本版面。
- RC-A-20（英文走一遍）在 POCO 找到：App 選英文、手機系統是繁中時，回合標籤讀成「Worked for 1s, ended 星期三 下午4:52」。反過來（手機英文、App 選繁中）會是「工作了 1 秒，結束於 Wednesday 4:52 PM」。上游的 `formatMessageTimestamp` 用系統語言排星期、日期和時間（`toLocaleDateString(undefined, …)`），相對時間早就跟著 App 語言走（`formatMonthDay` 用 `woowtech.time.dateLocale`）。`utils/time.ts`：時間戳記也改用 `woowtech.time.dateLocale`，12／24 小時制仍照系統設定。測試：`utils/woowtech-message-timestamp.test.ts`。
- 同一天在 iPad 開終端機分頁，標題是英文「Terminal 1」：daemon 給新終端機的預設名稱是「Terminal N」（`terminal/terminal-manager.ts`），沒給名稱的是「Terminal」（`terminal.ts`），App 拿來當分頁標題。`terminal/woowtech-terminal-name.ts` 把這兩種預設名稱換成介面語言（繁中「終端機 1」「終端機」），別人取的名稱和 shell 設的標題不動。接點：`panels/terminal-panel.tsx` 的分頁標題、`screens/workspace/use-workspace-tab-rename.tsx` 重新命名時預先填入的文字。
- 守門：`woowtech/rc0930-fixes.test.mjs`（上面每個上游接點）。測試：`navigation/woowtech-settings-swipe-back.test.ts`、`components/woowtech-file-explorer-reconnect.test.ts`、`desktop/attachments/woowtech-attachment-extension.test.ts`、`i18n/woowtech-interface-text.test.ts`、`voice/woowtech-voice-readiness-copy.test.ts`、`terminal/woowtech-terminal-name.test.ts`、`utils/woowtech-message-timestamp.test.ts`。每個修正都改回原樣跑過一次，對應的測試或守門都會紅。
- 刻意沒改的（上游，不擋上架）：Android 停止串流時偶發的 `RetryableMountingLayerException`（RC-A-04d，RN 0.81.5＋Reanimated 4.3.1，正式版實測時留意）、新增 ACP 供應商探測逾時的訊息、桌面 App 內瀏覽器的新分頁預設開 example.com、排程表單的 cron 錯誤訊息被鍵盤擋住（RC-A-18）。

### 26. 桌面版的 Electron fuse（2026-10-08）

上游沒設 fuse，全是 Electron 的預設值。設定寫在 `packages/desktop/scripts/woowtech-fuses.js`，`after-pack.js` 一開始就用 electron-builder 的 `addElectronFuses` 翻，在簽章、Linux 啟動腳本和打包冒煙測試之前，每個平台都套用。不用設定檔的 `electronFuses`：它在 afterPack 之後才翻，那時 Linux 的執行檔已經換成啟動腳本，CI 的 Linux 打包就失敗（`Could not find sentinel in the provided Electron binary`）。

| fuse                                  | 設定 | 原因                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RunAsNode                             | 開   | 內建 daemon、supervisor、終端機 worker 和 CLI（`bin/paseo`）都用 `ELECTRON_RUN_AS_NODE` 跑 App 的執行檔                                                                                                                                                                                                      |
| EnableNodeOptionsEnvironmentVariable  | 開   | 它也管 `NODE_EXTRA_CA_CERTS`，在公司 TLS 代理後面的使用者要靠它讓 daemon 連得出去。打包版的主程序本來就只吃 `NODE_OPTIONS` 裡的兩個選項；別的程式用 Node 模式叫起這個執行檔時，Electron 也會忽略這些變數（log：`Node.js environment variables are disabled because this process is invoked by other apps.`） |
| EnableNodeCliInspectArguments         | 關   | 主程序不接受 `--inspect` 和 SIGUSR1。所以對主程序送 SIGUSR1 會照系統預設結束它。Node 模式下 `--inspect` 照樣有效，這個 fuse 管不到                                                                                                                                                                           |
| OnlyLoadAppFromAsar                   | 開   | 只從 `app.asar` 載入程式                                                                                                                                                                                                                                                                                     |
| EnableEmbeddedAsarIntegrityValidation | 開   | `app.asar` 的內容跟 electron-builder 記下的雜湊不符時（Mac 記在 Info.plist 的 `ElectronAsarIntegrity`，Windows 記在執行檔的資源），App 啟動就結束；Node 模式讀到被改過的檔案也會停                                                                                                                           |
| GrantFileProtocolExtraPrivileges      | 關   | 畫面從 App 自己的 `woowtech-smart://` 協定載入，主視窗也不准導到 `file://`                                                                                                                                                                                                                                   |

- 沒動 EnableCookieEncryption：打開之後就不能再關。App 內瀏覽器的 cookie 會改用鑰匙圈加密，簽章不同的版本（驗收版和正式版）在同一台 Mac 上會跳鑰匙圈提示。之後再決定。
- 留下的風險：RunAsNode 開著，本機的惡意程式可以先用 `launchctl setenv` 設好 `ELECTRON_RUN_AS_NODE`，再經 LaunchServices 打開 App，借用 App 的 TCC 權限（桌面版只申請麥克風）。要關掉 RunAsNode，daemon 和 CLI 得改用獨立的 Node 執行環境，原生模組也要針對它重新編譯。上游一樣有這個風險，之後再排。
- 2026-10-08 在 Mac 驗收版的複本上實測：翻好 fuse、用同一個 Apple Development 身分重新簽章後，主視窗從 `woowtech-smart://app` 載入，內建 daemon 和 supervisor 都起得來，`bin/paseo --version` 和 `daemon status` 都正常。把 `app.asar` 改掉一個位元組後，App 一啟動就結束（`ASAR Integrity Violation`），Node 模式讀那個檔也一樣。
- 打包冒煙測試（Linux、Windows 在 afterPack，Mac 在 afterSign）跑的都是翻過 fuse 的執行檔。正式版仍要用 `npx @electron/fuses read --app <.app>` 確認一次。
- Windows：electron-builder 26 會把 asar 雜湊寫進 Windows 執行檔，同一組 fuse 要在 Windows 上再驗一次。
- 守門 `woowtech/desktop-fuses.test.mjs`：fuse 的設定、after-pack 在 Linux 啟動腳本之前翻、設定檔沒有 `electronFuses`、electron-builder 還有這兩個方法，以及 daemon 和 CLI 還用 Node 模式。等兩邊都不用了，就把 RunAsNode 關掉。

## 上游同步紀錄（2026-09-27 起，挑選式）

### 第一批：上游 `836f1a9..d6861f81e`

- 範圍：上游 `836f1a9`（v0.8.0）到本機 `upstream-main` 的 `d6861f81e`（上游 0.9.1），共 79 個 commit。沒有 fetch，`d6861f81e` 不一定是 GitHub 上最新的上游。
- 分支 `woowtech/upstream-picks-0927`，從 `woowtech/integration-0926` 的 `ce3dffa70` 開出，含 T1 修正。沒有 push。
- owner 的原則：只拿產品需要的。我們有出貨的功能，拿它的錯誤、安全、資料完整性、穩定性和效能修正；新功能、我們拿掉的功能（例如本地語音）、網站、Windows、發版、版本號和 lock 簽章／Nix hash 都不拿。
- 做法：照上游的時間順序 `git cherry-pick -x`，每個 commit 保留上游作者，訊息最後有 `(cherry picked from commit …)`。「條件式」的只在程式碼我們有、又不需要不拿的 commit 時才拿。fork 自己的調整各自一個 commit。
- 結果：拿 39 個（32 個原本就要拿、7 個條件式），1 個只拿一部分（`d8dd189b9`），不拿 39 個。9/27 的審查後補拿了其中的 `f9fb992dc`（見第二批的「審查後補拿」），現在不拿的是 38 個。

拿進來的：

| 上游 commit                  | 內容                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `77c5c8f17`（#4839）         | 模型目錄有重複的選項時，Agent 草稿不再當掉；讀舊的目錄時也先去重                               |
| `13979e9c3`（#4862）         | 分支的 remote 寫成網址時，也找得到 fork 來的 PR                                                |
| `0aca3b605`（#4675，條件式） | 外掛的 timeline 轉換拿到完整的項目，在工具分組和 Markdown 切段之前處理                         |
| `c3bcad687`（#4844）         | 工作區版面的存檔壞掉時不再一直當掉，會自己復原；桌面版瀏覽器分頁 resize 後截圖不再卡住         |
| `b21c004ff`（#4863）         | 開著的聊天在背景也保持最新，網頁版凍結隱藏的聊天；重新連線時顯示進度；建立回執不會在替換時被讀 |
| `4be34f05e`（#4701）         | ACP 沒有 messageId 的片段接在同一個 timeline 項目                                              |
| `5ae0c5b83`（#4895）         | 連到舊版主機時，建立工作區和 Agent 照樣可用                                                    |
| `425157595`（#4925）         | 重新連線提示的轉場不中斷                                                                       |
| `7557992df`（#4902，條件式） | composer 高度穩定，打字不再讓整個聊天重繪                                                      |
| `0eac75be7`（#4912）         | application lease 到期不再永久斷掉外掛的連線                                                   |
| `a78949d1d`（#4926）         | 恢復封存的工作區時保留已 commit 的變更（用原本的比較基準和分支 HEAD）                          |
| `0e8a71a5f`（#4946，條件式） | 手機的 composer 編輯後尺寸穩定，長按刪除後回到原本的高度                                       |
| `0f20e6dfe`（#4945，條件式） | 歷史搜尋照時間排序，標出每個欄位命中的地方；選單的進場動畫等位置確定後才開始                   |
| `46529146a`（#4958）         | 上傳中的檔案先顯示載入中的附件，上傳不卡住輸入                                                 |
| `a8a8da047`（#4970，條件式） | 外掛 provider 的巢狀子 Agent 保留直接上層和開它的工具呼叫                                      |
| `6830c46e9`（#4973，條件式） | 聊天、工作區草稿和新增工作區共用 composer 的停靠和鍵盤處理；Android 閒置時捲動不被攔截         |
| `92b92a81c`（#5007）         | 桌面版和 CLI 改從輕量的子入口載入 daemon 管理，不再載入整個 daemon，省記憶體                   |
| `9696f4226`（#5040）         | 只訂閱這次開過的聊天；恢復的 Agent 不再改寫最後使用時間，也不清掉「待檢視」                    |
| `ee7949ae2`（#4413）         | Pi 依每個模型的 thinking 設定篩選和夾限                                                        |
| `83f9fba20`（#5168）         | 從草稿建立聊天時，交接一直保留到新的聊天成為目前的聊天                                         |
| `4c051388e`（#5174）         | 「匯入工作階段」列得出所有 Codex 對話                                                          |
| `c8a7667a0`（#5189）         | 依序補齊（sequenced catch-up）之後，側欄不會少掉對話                                           |
| `aeb98f813`（#5200）         | 加入 Claude Opus 5.5，並依模型版本判斷能力                                                     |
| `d22737c77`                  | heap snapshot 不進 git                                                                         |
| `a3fc59e81`（#5205）         | 資料夾名稱結尾有空白的專案留在側欄                                                             |
| `5db3bc82f`（#5079）         | 連線恢復時重新接上工作區標籤                                                                   |
| `17c505021`（#5221）         | fork 的 checkout 也顯示它的 PR                                                                 |
| `3a36cc33c`（#5227）         | 磁碟或網路分享沒掛上時保留工作區，不當成已刪除                                                 |
| `290306fd1`（#5229）         | worktree 刪掉以後，封存的 Agent 記錄照樣讀得到                                                 |
| `81ad00790`（#5235）         | Pi、OMP 的執行環境已經結束時，按停止能讓 Agent 結束                                            |
| `530331363`（#5238）         | 重新匯入失敗後，封存的 worktree 仍然可以恢復                                                   |
| `8269a0ea7`（#5239）         | Codex 除了 Auto-review，其他模式的核准都留給使用者                                             |
| `3eaf0be0b`（#5240）         | Claude 的斜線指令放在最後一個內容區塊送出                                                      |
| `90737e1de`（#5243）         | OMP 被停止的回合顯示為取消，不是失敗                                                           |
| `d161b5987`（#5245）         | Android 按返回先關掉底部面板，不會離開畫面                                                     |
| `94ab368e4`（#5248）         | daemon 替 ACP 開的終端機帶著該 Agent 的啟動環境                                                |
| `6d37f7fd9`（#5253）         | 關機時先關 Agent 再停外掛，每個關閉最多等 5 秒                                                 |
| `3054f8005`（#5258）         | MiniMax 帳號沒有 token 方案時，用量顯示無法取得                                                |
| `d6861f81e`（#5255，條件式） | 多鍵快捷鍵在兩個按鍵之間重繪也不會中斷                                                         |

`d8dd189b9`（#4868，CI 精簡與去 flaky）只拿一部分，做成 fork 的 `9c7006242`，訊息寫了拿了什麼、沒拿什麼：

- 拿：`client/src/daemon-client.ts` 的修正，`attemptConnect` 清掉排好的重試，重連等待中又明確 `connect()` 時，舊的計時器不會把新連線拆掉（附上游的單元測試）；桌面版 `npm test` 先跑一次 `install-electron`，vitest 的 worker 才不會同時下載 Electron 44；只在 Windows 跑的 OpenCode npm shim 測試改用假的執行環境；Playwright 的 5 個去 flaky：「載入較舊的一頁時即時輸出繼續」改用 30 分鐘的串流並等要驗的那一頁（第 18 節待分類的 `agent-timeline-pagination.spec.ts:182` 就是這個案例）、字型放行後的新請求直接通過、重連回歸測試等 Agent 面板出現才斷線、外掛啟動失敗的指令用 rename 放上去、GitHub 附件 pill 用標題找。
- 不拿：`.github/`（`ci.yml`、新的 `desktop-packages.yml`、`docker.yml`、`nix.yml`）和 `scripts/ci-workflow.test.mjs`；描述 CI 與打包搬家的 `docs/testing.md`；刪掉我們還在跑的測試（startup-wire-metrics、replica-cache-measurement 和它的 helper、user-message 的 ui-contract、command-center-host、檔案總管的透明度測試、pagination 刪掉的案例）；把多個測試併成一個旅程的改寫；Hub relationship 的測試工具從 CLI 子程序改成直接呼叫 client（連同 `hub-cli-contract`、`relationship-controller` 的期待值）：這是合併，不是去 flaky，而且會少掉我們改名後的 CLI 的覆蓋。

不拿的，依原因：

- 新功能：`0c5f472da`（外掛讀伺服器設定）、`174055a63`（Changes 總覽）、`4f710d993`（偵測到 PR 時自動開分頁）、`72e3d6957`、`6ce6f4c96`（外掛跨主機導覽與 SDK）、`c7db3c5a8`（外掛開外部連結和工作區瀏覽器；它也改寫通用的網址開啟器，我們的 mailto 維持第 10 節的做法）、`047f40e62`（npm 外掛安裝與更新審閱）。
- Find（我們沒有這個功能）：`26e0273ac`、`326a37cc8`、`80b4387bc`（還會帶進 markdown-it）、`bb4763b38`、`2c8e8a826`、`135a3b4c9`、`b2ce2bcb8`。
- 串流淡入：`6215e08ef`（之後被 `5d70ab2ab` 還原；0.8 本來就是逐字串流）、`0474c3e0a`（它的測試）、`5d70ab2ab`（還原淡入並加上原生捲動模組）。`5d70ab2ab` 也帶了反轉清單在 Android 上的文字選取修正，這次一起延後。
- 本地語音（第 2 節已拿掉）：`64b1a62ed`。
- 只有 Windows：原本列了 `f9fb992dc`，它其實全平台都改了外掛建置的環境，審查後補拿（見第二批）。
- 外觀：`cb9080604`。
- 網站：`1e4ba65c6`、`3dbbbb535`。
- 發版與版本號：`7c1958f5b`、`e9d32a17d`、`7f7e60bcb`、`818658520`；更新紀錄：`ed9b51f94`、`0fd1db574`、`8b6e9447f`、`eb665a55a`；發佈 workflow（我們的 GitHub 停用）：`0e965bcd7`、`3cc4ae286`。
- lock 簽章／Nix hash：`c5c0536b4`、`7d74916f8`、`dc682adb2`、`2f3272490`、`d636abd7a`、`91d9cf1db`、`bc5bc969c`。

衝突與調整：

- `c3bcad687`：`packages/desktop/e2e/browser-tabs.e2e.mjs` 衝突。上游拿掉 `callBrowserToolUntilReady`，截圖改成只呼叫一次。保留 fork 的兩個重試 helper（`callToolUntilReady` 回傳整個回應，圖留著）；上游新加的 resize 後截圖（含尺寸和 devicePixelRatio 斷言）和閒置分頁的截圖都改用 `callBrowserToolUntilReady`（第 18 節）。
- `b21c004ff`：lock 只多 App 的 `"react-freeze": "1.0.4"` 一行。1.0.4 原本就在 lock 裡（react-native-screens 的相依），沒有新的套件。
- `46529146a`：`composer-attachments.spec.ts` 衝突，因為 `d8dd189b9` 把這個檔併成旅程的改寫沒拿。保留我們的「Plus menu」測試，加上上游新的上傳中附件測試。
- `6830c46e9`：上游在 `e2e/mobile/composer-keyboard/android.sh` 新加的 Agent 連結寫成 `paseo://`，App 只註冊 `woowtech-smart://`（第 5 節），改成我們的 scheme（fork 的 `47956d14b`，1 行）。
- `92b92a81c`：
  - `packages/server/src/server/config.ts`：留上游 re-export persisted config 的區塊，接著是我們的 `DEFAULT_PORT = 6770`。上游的 relay、app 網址常數不放回來：relay 讀 protocol 的 `DEFAULT_RELAY_ENDPOINT`，app 網址走 `appBaseUrlFromConfig`（第 11、19 節）。沒有重複宣告。
  - `packages/cli/src/commands/daemon/lifecycle.e2e.test.ts`：三個符號都從 `@getpaseo/server/daemon-control` 匯入（`daemon-instance.ts` 現在也 re-export `resolvePaseoHome`），第 12 節的 home 斷言不變。
  - `packages/server/package.json` 自動合併：多了 `daemon-control`、`configuration`、`process`、`auth`、`pairing`、`agent-activity`、`agent-response` 七個子入口。SDK 仍是 devDependency，`build:lib` 仍複製 `woowtech/skills`，版本號沒動。
  - 打包：七個子入口和 protocol 新拆出的 `agent-profile`、`plugin-config`、`terminal-profile` 都在 `dist` 底下。用 electron-builder 自己的 minimatch 拿 `electron-builder.yml` 的 10 條排除規則比對，這 13 個目標都會進 app.asar，打包設定不用改。`plugin-config.ts` 跟我們 `messages.ts` 原本的定義相同，只有 directory 來源，沒有帶進 npm 外掛來源。
- `83f9fba20`：`agent-message-submission.spec.ts` 的 import 衝突，留我們的，只加 `recordPanelToasts`。
- `0eac75be7`：server 的 `test:integration` 多跑 `plugin-paseo-api.e2e.test.ts`，這是上游這個修正的回歸測試，用假 agent、不讀 key。第 18 節的整合測試數跟著改成 6 個。
- 繁中：只有 `b21c004ff` 動到語系（`agentPanel.states.reconnecting` 改成「Reconnecting to host」，新增 `updating`「Updating messages」）。照第 7 節用產生器重新產生 zh-TW（fork 的 `10b72a731`）：「正在重新連線主機」「正在更新訊息」。其他挑進來的沒有新的介面文字，用到的 key 都是既有的。
- 檢查過沒有帶回原版的東西：品牌和 CLI 名、home、port、官方版共存、技能路徑；推播（FCM、push.woowtech.io、`woowtechPush`、不帶內容的推播、Expo 登記停用）；配對 scheme、relay 預設與明確 false；LINE 仍拿掉，官網、客服信箱和通用開啟器的 mailto 不變；工作區自動命名、commit 訊息和 PR 的 AI 生成仍關閉，沒有新的入口；Claude Agent SDK 仍第一次用到才下載，出貨程式沒有 SDK 的值 import，沒開 `verbatimModuleSyntax`；沒有本地語音；更新來源不變；`.github/`、`website/` 和版本號都沒動；lock 只多一行。
- cherry-pick 和 commit 都設 `LEFTHOOK=0`：共用 `.git` 的 hook 才不會被重裝成指向這個 worktree（第 18 節），每個 commit 也不用各跑一次全部 workspace 的 typecheck。format、lint 和 typecheck 最後另外跑，見下面。

測試（這台 Mac，Node 22，`--maxWorkers=1 --no-file-parallelism`）：

- 每一步之前確認記憶體至少 25% 空閒，沒有開機的模擬器、Android 模擬器、xcodebuild 或 Gradle。只開著、沒有開機裝置的 Simulator.app 不算。
- 建置：依序 `build:client`（含 protocol）、`build:highlight`、`build:plugin`、`build:relay`、server、CLI 和 `expo-two-way-audio`。沒用 `build:server`，因為它用 `concurrently` 同時建三個套件。
- typecheck：11 個 workspace 逐一跑 `npm run typecheck --workspace=…`，全過（挑選改到的 7 個，加上沒改到的 4 個，等於根目錄的 `npm run typecheck`）。
- format、lint：`BASE..HEAD` 改到的 315 個檔 `format:check:files` 通過，297 個檔 `lint` 0 個 warning、0 個 error。
- 守門 `node --test woowtech/*.test.mjs`：121/121，沒有改任何守門。
- 挑進來的 commit 新增或改過的測試（Playwright、桌面版 e2e 和手機腳本除外）：
  - protocol 4 檔 220/220（含 `woowtech-push`、`messages`）；client 2 檔 145/145（含 `d8dd189b9` 的重試計時器測試）；plugin 1 檔 31/31。
  - server：Claude、Codex、Pi、OMP、ACP、OpenCode 和外掛 provider 等 17 檔，1150 過、1 略過（只在 Windows 跑的 OpenCode 測試）；session、checkout、封存、恢復、重新匯入、磁碟沒掛上和 worktree 等 22 檔，1044 過、6 略過（BASE 就有的 skip）；in-process 的 e2e 6 檔，35 過、1 失敗（見最後一項）。
  - CLI：`lifecycle.e2e.test.ts` 和 pair、onboard、說明頁等 8 檔，30 過、1 略過（Windows 限定）；`tests/32-daemon-set-password` 3/3、`tests/25-daemon-restart-supervisor` 2/2，照 `run-all.ts` 的方式用暫存 HOME、不帶 `PASEO_*`。
  - desktop 7 檔 89/89（含 `desktop-packaging`、`login-shell-env.daemon-target`）。
  - App 24 檔 748/748。`use-agent-history.test.ts` 第一次跑時，beforeAll 冷載入超過 vitest 預設的 10 秒；照 CI 設 `PASEO_APP_TEST_HOOK_TIMEOUT_MS=120000` 後 18/18，之後的 App 測試都用這個設定。
- T1：`missing-workspace-directory-demand` 25/25、`directory-sync/index` 23/23、`host-runtime` 72/72、`sidebar-workspace-list` 3/3、`use-projects` 2/2、`viewed-timeline-sync` 39/39，共 164/164。守門 `workspace-directory-demand.test.mjs` 在上面的 121 項裡。
- fork 自己的：server 的推播、工作區自動命名和 Git metadata 關閉、config、relay、配對、CORS、daemon 指令訊息和 SDK 載入器 17 檔 190/190；App 的推播、配對、主機補名、通知標題、桌面通知權限和 zh-TW／品牌／fork 文案 18 檔 128/128；網址開啟器 App 2/2、桌面版 3/3。更正：`host-page-translations.test.tsx` 從 `8010f71b1` 起整個檔載入失敗、3 個都沒跑（這一批的 `425157595` 讓 toast 在模組載入時就用 `FadeIn`，測試的 mock 沒有），第二批的 fork `f5ae3f039` 補上 mock 才恢復 3/3。
- 打包：7 個子入口和 protocol 的 3 個新檔 build 後都在 `dist`。從桌面版用 Node 解析並載入 7 個子入口都成功，經 `daemon-control` 拿到的 `resolvePaseoHome({})` 是 `.woowtech-smart`。
- 沒過的 1 個：`session.create-agent-worktree-autoarchive.e2e.test.ts` 的「auto-archiving a created worktree keeps the directory when a sibling workspace references it」，錯誤是 `spawn git ENOENT`。假 agent 的第一回合馬上結束，自動封存先刪掉 worktree，測試才建立旁邊的工作區。BASE（`git archive ce3dffa70`，另外建 dist）同樣失敗，2/2。這個檔、`test-utils` 和相關程式跟 upstream-main 相同，不是這次挑選造成的。CI 的 `test:integration` 只跑這個檔的第一個案例，所以 CI 不會報它。

留給 CI 和裝置驗證的：

- push 之後手動跑一次 CI 並勾 Playwright（第 18 節）。這台 Mac 只跑了上面的定向測試，還要看：
  - server 全部的單元測試和 `test:integration`（現在 6 個檔）；CLI 的 e2e 分片，包括改了期待值的 `tests/15-provider.test.ts`（Opus 5.5，會查真的 provider，本機沒跑）和改了 import 的 `tests/e2e/relay-host.test.ts`（`wrangler dev` 會轉到上游的 Fly，本機沒跑）。
  - Playwright：挑進來的 commit 新增或改過的 spec，例如 model-search、plugin-timeline、chat-outline、explorer 的版面復原、viewed-agent-timelines、agent-message-submission、creation-old-daemon、composer-attachments、worktree-restore、sessions-search、keyboard-shortcut-sequence、sidebar-project-name-whitespace、streaming-markdown、command-center-agent-controls、composer-whitespace，以及 `d8dd189b9` 去 flaky 的 5 處。
  - 桌面版：browser-tabs（新的 resize 後截圖和 devicePixelRatio 斷言，都經過 `…UntilReady`）、lifecycle、renderer，以及 Linux 打包和三個 smoke。只有打包後的 smoke 會在 app.asar 裡實際載入新的 server 子入口；打包 smoke 現在先按「Agent」再找輸入框。
  - Windows 限定的測試（Windows 不在 v1）。
- iOS、Android 正式版實機：
  - composer（`7557992df`、`0e8a71a5f`、`6830c46e9`）：長草稿、長按刪除、收起再打開鍵盤、新增工作區的 composer、送出後閒置時捲動（Android 用 `e2e/mobile/composer-keyboard/android.sh`）、iOS 的點擊判定。
  - Android 按返回關掉底部面板（`d161b5987`）。
  - 開著的聊天和重新連線（`b21c004ff`、`425157595`、`9696f4226`、`83f9fba20`）：手機上保留的聊天不凍結、從背景回來後補齊、重新連線提示。T1 的通知導頁在這些改動之後照第 16 節重驗。
  - 上傳中的附件（`46529146a`）。
- 延後：`5d70ab2ab` 裡反轉清單在 Android 上的文字選取修正。
- 這個分支沒有 push。`woowtech/integration-0926` 已經前進到 `30207e6a7`，合回去時再 rebase 或 merge，之後重跑守門和 T1 測試。

### 第二批：上游 `d6861f81e..d7b7016cc`

- 範圍：本機 `upstream-main` 的 `d6861f81e`（第一批的終點）到 9/27 抓的 `upstream/main` `d7b7016cc`，共 67 個 commit，含上游 0.9.2（9/24）。固定用 `d7b7016cc`，不用會移動的 ref，之後沒有再 fetch。
- 接在第一批的 `8010f71b1` 後面，同一條分支。原則和做法照第一批：照上游的時間順序 `cherry-pick -x`，fork 的調整各自一個 commit。
- 挑選清單標了 38 個「拿」、16 個「條件式」、11 個「不拿」、2 個「延後」。
- 結果：拿 55 個：清單上的 38 個「拿」、15 個「條件式」，加上審查後改判要拿的 2 個「不拿」（`e68553f75`、`513f2a9ea`，見下面的「審查後補拿」）。不拿 10 個（清單上其他 9 個「不拿」，加上條件式的 `829cc5e17`），延後 2 個。

拿進來的：

| 上游 commit                      | 內容                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `9a3f3a0dc`（#5272，條件式）     | 多鍵快捷鍵的第二鍵按著修飾鍵時也能完成（第一批拿了 `d6861f81e`）                                                                            |
| `34c9fd03c`（#5273）             | Codex 的 GPT-6 Sol、GPT-6 Luna 顯示 Fast                                                                                                    |
| `ba4595d4e`（#5274，條件式）     | Cursor 在沒有 Fast 版本的模型上也能啟動 Agent                                                                                               |
| `faee1cd95`（#5277）             | 重開機後舊 PID 被別的程序拿走時 daemon 照樣啟動：lock 的時間早於這次開機就當成棄置，也不會對那個 PID 發訊號                                 |
| `c4771ca46`（#5285）             | Claude 對話可以回溯到沒有回應的回合之前                                                                                                     |
| `897a0abb1`（#5286）             | Agent 重新整理時 timeline 只留一份                                                                                                          |
| `ec43e9067`（#5287，條件式）     | 改綁的窗格焦點快捷鍵在打字時也能用                                                                                                          |
| `89073d4c5`（#5289）             | Claude 回溯的錨點不落在子 Agent 的訊息上                                                                                                    |
| `8768500fc`（#5290）             | 副本快取的儲存拒絕寫入時，讀取不再空轉                                                                                                      |
| `9978988e3`                      | 對話關閉後 daemon 的 heap 不再持續增長                                                                                                      |
| `c3e1e084a`                      | 晚出現的忽略目錄會更新 Git 排除規則，Linux 和原生監看的分類工作有上限（CI 的部分沒拿，見下面）                                              |
| `222d45a2f`（#5298）             | 外掛 provider 的請求失敗不讓 daemon 當掉                                                                                                    |
| `2c7b38bc7`（#5296）             | OpenCode Agent 照給定的權限規則執行                                                                                                         |
| `48384cafd`（#5249）             | 新分支不設 upstream，第一次 push 不會推到預設分支                                                                                           |
| `ae42b0afb`（#3258）             | OMP 送出自訂訊息後等終止事件                                                                                                                |
| `e998e0a08`（#5170）             | 監看不到的 repo 不再讓 daemon 吃滿一顆 CPU                                                                                                  |
| `fbe5005aa`（#5224，條件式）     | 自訂快捷鍵可以用 Backspace                                                                                                                  |
| `d615d3d42`（#5190）             | 新增專案的目錄建議掃描變便宜，搜尋不再逾時                                                                                                  |
| `b2bb512b3`（#5231）             | 外掛重新載入時子程序不會當掉                                                                                                                |
| `c976e2e5a`（#5303）             | 測試：等 repo 觀察完成再斷言 ref 更新                                                                                                       |
| `f4efdbded`（#5301）             | schedules 資料夾有不是排程的檔案時 daemon 照樣啟動，那個檔案只記錄一次                                                                      |
| `7fa78244f`（#5305）             | CLI 的 `permit ls`、`allow`、`deny` 顯示完整的權限請求 ID                                                                                   |
| `1bf531229`（#5306）             | 留下空的 `paseo.pid` 時 daemon 照樣啟動                                                                                                     |
| `e6085c1e9`（#5310，條件式）     | CLI 認證失敗時提示設定 `PASEO_PASSWORD`，不再叫人啟動 daemon                                                                                |
| `c356394bf`（#5315）             | 有 UTF-8 BOM 的 `config.json` 也讀得進來                                                                                                    |
| `fbc83613c`（#5317）             | 對話上傳保留原始檔名，只換掉各平台檔名不能用的字元，長度限 255 bytes                                                                        |
| `8e858f0e3`（#5320）             | 多選問題的勾選項和「其他」答案一起送出                                                                                                      |
| `6016ed705`（#5322）             | Agent 建立本機工作區時拒絕不存在或不是資料夾的路徑                                                                                          |
| `bbf8cce3f`（#5326）             | 列出 Claude `settings.json` 對應的 Fable 模型                                                                                               |
| `27d6a7185`（#5332）             | 背景啟動在開 log 之前就失敗時說明原因，也寫進 `daemon.log`                                                                                  |
| `e07da55f8`（#5335，條件式）     | 有密碼的桌面版 daemon 也顯示「在編輯器開啟」：`daemon status` 不用密碼也回報 server id                                                      |
| `49f9cec6b`（#5337）             | CLI 解析失敗時指名 `config.json`                                                                                                            |
| `e3c853df5`（條件式）            | Android 商店建置略過 lint，避免記憶體不足                                                                                                   |
| `db4fd3340`（#5338）             | 舊的 OpenCode server 結束後，Agent 重連新的 server                                                                                          |
| `28507224d`（#5341）             | 上週同一個星期幾的訊息顯示完整日期                                                                                                          |
| `84304b553`（#5343）             | 沒指定模型的 Pi Agent 用 Pi 設定的預設模型                                                                                                  |
| `5c9f767d5`（#5347，條件式）     | `send_agent_prompt` 等超過 30 秒時，結果改用完成通知告訴呼叫者                                                                              |
| `bf4dc22c2`（#5358，條件式）     | `daemon set-password` 的輸入是管線時，說明需要終端機                                                                                        |
| `315803688`（#5372，條件式）     | provider 檢查超過 1.5 秒的 daemon 也能從設定頁更新和重啟                                                                                    |
| `a048094da`（#5374，條件式）     | 外掛主題太多時，主題清單可以捲動                                                                                                            |
| `90d978ab6`（#3628）             | OMP 保留有說明的選項                                                                                                                        |
| `43a2a7969`（#5383）             | Pi 回溯過一次後，仍能回溯到指定的訊息                                                                                                       |
| `dc9799f6f`（#5388，條件式）     | 終端機的 OSC 8 連結和一般網址一樣開                                                                                                         |
| `e68553f75`（#5392，審查後補拿） | `run --host`／`--home` 在帶著別台 daemon 的 `PASEO_AGENT_ID` 的 shell 裡跑時，照樣建立 Agent，不再報「Caller agent not found」              |
| `04c3e003f`（#5404）             | 網頁版模型選擇列不再有巢狀按鈕                                                                                                              |
| `8cd989529`（#5407，條件式）     | 提示還在執行的子 Agent 時，呼叫者只收到一次通知                                                                                             |
| `513f2a9ea`（#5411，審查後補拿） | 一般 ACP Agent 的 / 選單列得出它的斜線指令（原本永遠是空的）；`mcp-server.test.ts` 先清空 AgentManager 和 AgentStorage 的寫入再刪暫存資料夾 |
| `aa3ffaeb6`（#5415，條件式）     | checkout 切換分支後，/ 選單的專案技能重新整理                                                                                               |
| `26f227bed`（#5432）             | daemon 重啟後 Pi 仍能回溯                                                                                                                   |
| `a272a22d7`（#5434）             | 隱藏 OpenCode 標為合成的使用者訊息                                                                                                          |
| `76a9781ba`（#5437）             | 從 provider 自己的設定目錄（`CLAUDE_CONFIG_DIR`）讀 Claude 歷史                                                                             |
| `3dc17b7f3`（#5439）             | ACP Agent 起不來時 daemon 繼續運作                                                                                                          |
| `cb9654a65`（#5445）             | `daemon.log` 寫不進去時 daemon 繼續運作，之後再重試                                                                                         |
| `d2e2154a8`（#5394）             | 目錄重新整理時保留已還原的工作區（directory-sync，T1 的修正保留）                                                                           |
| `fffd76e8f`（#5446，條件式）     | 「匯入工作階段」列出自訂 Codex provider 的對話                                                                                              |

條件式的都先確認過功能我們有、也不需要不拿的 commit：多鍵快捷鍵（第一批拿了 `d6861f81e`）、自訂快捷鍵、Cursor provider、daemon 密碼（`daemon set-password`）、Android 的 EAS 設定、`send_agent_prompt`、設定頁的更新和重啟、外掛主題、終端機連結、/ 選單的專案技能、自訂 Codex provider。

不拿的，依原因：

- 新功能：
  - `829cc5e17`（#5206，條件式）：providerOptions 新增 `extraArgs`，把任意 Claude Code CLI 旗標（例如 `--chrome`）原樣交給 SDK。這是新能力，不是我們出貨功能的修正；後面拿的 commit 都沒用到它，`d7b7016cc` 上 Claude 的 `extraArgs` 只出現在它自己改的 4 個檔。沒拿它，`providerOptions.extraArgs` 會被 strict 的 `ClaudeProviderOptionsSchema` 拒絕，錯誤指出這個路徑。
  - `c081e0350`（#5309，Pi 擴充的轉接，48 檔、5773 行）。
- 放寬 Hub 的權限：`067937bac`（#5302）讓只有 `hub.execute` 的連線也能用 `workspace.title.set` 改工作區標題（原本要 `workspace.manage`）。Hub 仍是上游經營的服務（第 12 節），我們不擴大它的權限。這跟第 20 節的 LLM 自動命名無關。
- 本地語音（第 2 節已拿掉）：`05bfffad4`（#5281）。
- 外觀：`d7b7016cc`（#5459，設定頁的導覽和控制項改版，36 檔）。
- 網站：`373da7069`（#5297）。
- 發版與版本號：`c67b7158b`（0.9.2）；更新紀錄：`91dc92733`。
- lock 簽章／Nix hash：`ea7a74185`、`e2de6df2e`。

延後，要 owner 決定：

- `c906c2f4a`（#5198）：OpenCode v2，並自動選版本。45 檔、5199 行。
- `e1c769c01`（#5393）：有密碼的 daemon 在本機和遠端連線都能用。77 檔、2800 行，動到連線和 relay（第 11 節）。

審查後補拿（9/27 的獨立審查之後，接在上面的帳本 commit 後面）：

- `513f2a9ea`（#5411）：清單把它當成新能力，其實是修正。一般 ACP Agent 在 `session/new` 之後才用 `available_commands_update` 送出斜線指令，新 Agent 的 / 選單一建立就問，所以永遠是空的（Closes #4759）；改成預設等第一批指令，沿用既有的逾時。我們出貨 ACP provider 目錄。同一個 commit 讓 `mcp-server.test.ts` 用到真實儲存的 3 個測試先 flush AgentManager 和 AgentStorage 再刪暫存資料夾，其中 2 個是我們拿的 `5c9f767d5`、`8cd989529` 加的；不 flush 的話，在 Linux CI（我們唯一的 CI）上會偶發 `ENOTEMPTY`。
- `e68553f75`（#5392）：清單把它當成新能力，其實是 `run` 的錯誤修正（Closes #5313）。shell 帶著別台 daemon 的 `PASEO_AGENT_ID` 時，`run --host`／`--home` 會被拒絕（Caller agent not found）。在官方 Paseo 的 Agent 終端機裡跑 `woowtech-smart run` 就是這個情況（第 5 節）。只改 CLI 的 `run.ts`：先問目標 daemon 有沒有這個 Agent，沒有就當頂層 Agent 跑。環境變數照第 12 節不改名，沒有新的訊息文字。
- `f9fb992dc`（#4776，第一批的範圍）：第一批當成只有 Windows。它讓外掛的建置指令改走 `spawnProcess`，而 `spawnProcess` 在每個平台都用 `createExternalCommandProcessEnv` 清掉 daemon 的控制變數。桌面版用 `ELECTRON_RUN_AS_NODE=1` 起 daemon，外掛編譯時也會暫設 `ESBUILD_BINARY_PATH`，以前這些都會傳進外掛的建置指令。在這台 Mac 實測同一個建置指令：拿之前 `ELECTRON_RUN_AS_NODE`、`ESBUILD_BINARY_PATH`、`PASEO_SUPERVISED`、`PASEO_NODE_ENV` 都傳進去，拿之後都沒有，一般的變數照樣在。
- 三個都乾淨套上，跟上游一字不差：`78d8b7398`（`f9fb992dc`）、`477dcfd73`（`e68553f75`）、`5a128efb7`（`513f2a9ea`）。
- fork 的測試修正：
  - `cf4e4cfd4`：`explorer-pane-placement.spec.ts`（`c3bcad687`）和 `sidebar-project-name-whitespace.spec.ts`（`a3fc59e81`）用「Paseo ran into a problem.」出現 0 次確認沒有當掉，在 fork 永遠成立。改數我們的標題「woowtech smart ran into a problem.」，寫法跟 `root-error-recovery.spec.ts` 一樣。Playwright 沒在本機跑。
  - `0cc3bc800`：`daemon-instance.test.ts` 和 `tests/40-daemon-stale-boot-lock.test.ts`（都來自 `faee1cd95`）的假 lock 位址從官方 Paseo 的 `127.0.0.1:6767` 改成沒人聽的 `127.0.0.1:1`。
- 手機終端機的 webview bundle（fork 的 `301b4e894`）：手機的終端機跑的是 repo 裡預先建好的 `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts`，上次重建是上游的 `863090e0d`（2026-08-19）。上游只在 EAS 的 `eas-build-post-install` 重建它，我們在本機建置，所以 `dc9799f6f` 原本到不了手機。用 `npm run build:terminal-webview --workspace=@getpaseo/app` 重建（esbuild 0.28.1，跟 `863090e0d` 同版），再用 `format:files` 排版：
  - 內嵌的 HTML 從 1,212,910 字元變成 1,213,076 字元。跟舊的比，只差 `dc9799f6f` 那一段：OSC 8 連結經過 xterm 的 `linkHandler` 交給 `onOpenExternalUrl`，webview 再用 `openExternalUrl` 訊息交給原生端的 `openExternalUrl()`（只放行 http、https 和 mailto）。以前 xterm 會先問一次，再在 webview 裡 `window.open()`。
  - bundle 的 19 個 esbuild 輸入裡，9 個原始碼（`packages/app` 的 7 個，加上 protocol 的 `terminal-input-mode`、`terminal-snapshot`）從 `863090e0d` 之後只有 `c93cb0053`（`dc9799f6f`）改過，`@xterm` 套件的版本也沒變。所以這次帶進手機的終端機改動只有 OSC 8 這一個。
  - 本機建置前要先重建，寫在「Mac 開發環境」的注意事項。
- 測試（跟下面第二批的測試同樣的環境，重的都經過 `heavy.sh`）：
  - server 6 檔 151 過、2 略過：`generic-acp-agent.commands`（新）2/2、`generic-acp-agent` 2/2、`mcp-server` 121/121、`plugins/preparation`（新）5 過、2 略過（只在 Windows 跑的 `.cmd` 案例）、會跑建置指令的 `plugins/index.posix` 17/17、`daemon-instance` 4/4。
  - CLI：`run.test.ts` 11/11；`tests/40-daemon-stale-boot-lock` 2/2。
  - typecheck：server、cli、app 全過。lint：改到的 13 個檔（含重建的 bundle）0 個 warning、0 個 error。`format:check` 整個 repo 4671 檔通過。守門 121/121。
  - 兩個 Playwright spec 只改了字串，沒在本機跑，留給 CI。

衝突與調整：

- `c3e1e084a`：沒拿 `.github/workflows/ci.yml` 新增的 macOS server 測試 job，和 `scripts/ci-workflow.test.mjs` 對應的一行（第 18 節：`.github/` 不動，CI 只跑 Ubuntu）。其他照上游，commit 訊息有寫。上游用這個 job 在 macOS 上測原生監看，所以這次在這台 Mac 跑了 file-observer 和 Git 觀察的測試（見下面）。
- `3dc17b7f3`：上游把 `acp-agent.ts` 的 ACP 初始化併成一個 helper，搬動了寫著 `clientInfo` 的那兩行；兩處都留我們的 `woowtech smart`（第 17 節）。第二批的 55 個 pick 和補拿的 `f9fb992dc` 都逐一跟上游比對過增刪的行，除了這裡和上面 `c3e1e084a` 少拿的 CI 設定，其他都跟上游一字不差。
- `bf4dc22c2`：新的 `PASSWORD_TTY_REQUIRED` 錯誤寫死 `paseo daemon set-password`。`set-password.ts` 在守門的 `printsHints` 清單裡，改用 `CLI_COMMAND`（fork 的 `20c50018f`，1 行）。說明裡的 `PASEO_PASSWORD` 照第 12 節不改。
- fork 的 `f5ae3f039`：`host-page-translations.test.tsx` 的 reanimated mock 補上 `FadeIn`、`FadeOut`，頁面程式沒改。第一批的 `425157595`（#4925）讓 `toast-host.tsx` 在模組載入時就建立轉場，設定頁經過 `toast-context` 載入它。佐證：把 `8010f71b1` 版的這個測試放成暫存檔在 HEAD 跑，整個檔載入失敗、3 個都沒跑，錯誤是 mock 沒有 `FadeIn`，位置 `toast-host.tsx:56`；`host-page.tsx` 在 `8010f71b1..HEAD` 只改了 1.5 秒逾時，所以 `8010f71b1` 一樣失敗。
- `e6085c1e9`（條件式）：新的提示只提 `PASEO_PASSWORD`，沒有指令名和產品名。同一個函式原本的「Start with: paseo daemon start …」照第 12 節由 `renderError` 換成 `woowtech-smart`。
- `e3c853df5`（條件式）：`eas.json` 的 `production` 改成跟我們的 `preview`、`production-apk` 一樣略過 lint（第 1 節）。
- `dc9799f6f`（條件式）：OSC 8 連結改交給 `onOpenExternalUrl`，也就是我們的 `openExternalUrl`：只放行 http、https 和 mailto，桌面版交給 Electron 的開啟器（第 10 節）。之前 xterm 會自己問一次再 `window.open()`。這個 pick 只改 `terminal-emulator-runtime.ts`，桌面版和網頁版直接用；手機的終端機要等重建 webview bundle 才有，見上面「審查後補拿」。
  - fixes-0928 查證（2026-09-28）：pick 本身沒問題。上游的 `terminal-emulator-runtime.browser.test.ts` 在這台 Mac 改用已安裝的 Chrome 跑，25/25 過；提交的 webview bundle 在 headless Chrome 裡，滑鼠移到 OSC 8 連結上變 pointer，點下去交給 `onOpenExternalUrl`（桌面的滑鼠路徑、DOM 渲染器、⌘-點、分段寫入都一樣）。2026-09-27 裝置上點不開，是下面幾個上游缺口，要改 protocol 或 xterm，fork 不修，開啟器的放行清單也不動：
    - 終端機重新訂閱後就沒有連結。daemon 的畫面快照不帶超連結（`TerminalCellSchema` 只有 `underline`，`renderTerminalSnapshotToAnsi` 只發 SGR 4），重新訂閱（`visible-snapshot` restore）、重連、輸出過量改送快照時，OSC 8 連結都變成一般的底線文字；headless 終端機的公開 API 也讀不到連結。桌面輪次剛印出來時是虛線（`shots/integ0927-desktop-20b-osc8.png`，xterm 的 OSC 8 樣式），點擊之後的 `-20c` 變實線；daemon 在那 30 秒收到 4 次 `subscribe_terminal_request`。純文字網址由 WebLinksAddon 從文字裡找，所以照樣能點。
    - xterm 6.1.0-beta.213 的 Linkifier 按列快取連結結果，那一列的內容變了也不重算：滑鼠先停在某一列，那一列之後才印出 OSC 8 連結，在同一列移動都認不出來，要移到別列再回來（headless Chrome 重現）。
    - 觸控：舊版 WebView 渲染器裡，xterm 的手勢處理（`browser/scrollable/touch.ts`）在 touchstart、touchend 呼叫 `preventDefault`，瀏覽器不產生相容的滑鼠事件，Linkifier 收不到移入和點擊，OSC 8 和純文字網址都點不開（headless Chrome 用觸控 tap 重現）。Android 預設的 native-grid 渲染器本來就沒有連結功能。
    - xterm 只把 http、https 的 OSC 8 目標當成連結（`linkHandler` 沒開 `allowNonHttpProtocols`），OSC 8 的 mailto、file:、javascript: 都不是連結，不會送到開啟器。
- `315803688`（條件式）：只拿掉設定頁讀 daemon 狀態的 1.5 秒逾時。npm 自我更新仍停用（第 4 節）。
- 繁中：這批沒有新的介面文字或翻譯 key，不用重新產生 zh-TW。
- lock：`package-lock.json` 沒變。
- 檢查過沒有帶回原版的東西：品牌和 CLI 名、home、port、官方版共存、技能路徑；推播（FCM、push.woowtech.io、`woowtechPush`、不帶內容的推播、Expo 登記停用）；配對 scheme（沒有新的 `paseo://`）、relay 預設與明確 false；LINE 仍拿掉，官網、客服信箱和通用開啟器的 mailto 不變；工作區自動命名、commit 訊息和 PR 的 AI 生成仍關閉；Claude Agent SDK 仍第一次用到才下載，出貨程式沒有 SDK 的值 import，沒開 `verbatimModuleSyntax`，SDK 仍是 devDependency；沒有本地語音；更新來源不變；`.github/`、`website/` 沒動，版本號都還是 0.8.0。
- 逐檔比對第二批改到的 128 個檔：第一批之後 fork 自己加的行都還在（只有上面 ACP 那行換了縮排），fork 刪掉的上游行沒有回來。
- cherry-pick 和 commit 都設 `LEFTHOOK=0`，理由同第一批。

測試（這台 Mac，Node 22，`--maxWorkers=1 --no-file-parallelism`，每個重的指令都經過 `heavy.sh`，一次一個）：

- 環境：`env -i`，PATH 只有 node@22 和系統資料夾（沒有 claude、codex、opencode、pi、gemini），HOME 和 TMPDIR 用暫存資料夾；除了 `tests/35`（見下面）都在 `sandbox-exec` 裡跑，只准連 loopback，擋 6767、6768、6770，也擋讀寫 `~/.woowtech-smart`、`~/.paseo`。
- typecheck：改到的 4 個 workspace（server、app、cli、desktop）逐一 `npm run typecheck --workspace=…`，全過。
- format、lint：`npm run format:check` 整個 repo 4669 檔通過；改到的 124 個 ts／tsx／js 檔 `lint` 0 個 warning、0 個 error。
- 守門 `node --test woowtech/*.test.mjs`：121/121，沒有改任何守門。
- 挑進來的 commit 新增或改過的測試（Playwright、桌面版 e2e、App 的 browser 模式和要真的 provider 的除外，見最後）：
  - server 36 檔：Claude（含新的 rewind 錨點測試）、Codex、Cursor、OpenCode、Pi、OMP、ACP、外掛 provider、agent manager、MCP 和 in-process 的 agent-mcp e2e 16 檔 1102/1103；daemon 啟動（`pid-lock`、`daemon-instance`、supervisor 的 logging 和 readiness）、config、排程、上傳、目錄建議、file-observer（含 macOS 的 `native-recursive`）、Git 觀察（含 integration）、git-mutation、owned-subscriptions、外掛生命週期 e2e 和新的 `claude-provider-config-dir-history` e2e 20 檔 339/340。沒過的 2 個見下面。
  - App 8 檔 242/242（快捷鍵 131、`directory-sync` 28、副本快取 28、時間 28、checkout 狀態 14、問題表單 6、指令查詢 4、`host-page-translations` 3）。
  - CLI：`lifecycle.e2e.test.ts` 17 過、1 略過（Windows 限定；含這批新加的 2 個），`permit-output` 2/2；`tests/32-daemon-set-password` 4/4（含新的管線輸入）、`tests/40-daemon-stale-boot-lock` 2/2、`tests/41-daemon-auth-command-errors` 2/2，照 `run-all.ts` 的方式用暫存 HOME、不帶 `PASEO_*`。`tests/40` 的假 lock 原本寫官方 Paseo 的 `127.0.0.1:6767`，跑的時候 sandbox 擋了這個埠；審查後改成沒人聽的 `127.0.0.1:1`（見「審查後補拿」）。
- T1：`missing-workspace-directory-demand` 25/25、`directory-sync/index` 28/28、`host-runtime` 72/72、`sidebar-workspace-list` 3/3、`use-projects` 2/2、`viewed-timeline-sync` 39/39，共 169/169。`directory-sync` 比第一批多 5 個，都是 `d2e2154a8` 新加的。
- fork 自己的：
  - server 30 檔 229/229：推播 4 檔、配對 4 檔、relay 5 檔（含 `config-relay`）、工作區自動命名和 Git metadata 關閉 4 檔、daemon 指令訊息、`paseo-home`、config 3 檔、CORS、daemon 設定、bootstrap、supervisor 的 lifecycle、自我更新停用 3 檔和 SDK 載入器。
  - App 17 檔 105/105：推播（含兩個 Expo config plugin、FCM token、Expo 登記停用）、配對連結、relay 關閉時的配對畫面、主機補名、fork 文案、通知導頁和網址開啟器。
  - CLI 7 檔 17/17：品牌和 Usage、`daemon pair` 的 App 連結與 relay、配對輸出、App 連結的 daemon 目標、下一步提示。
- daemon 的啟動、停止和 supervisor（CLI 腳本，照 `run-all.ts` 的方式跑）：`tests/22`、`23`、`24`、`25`、`33`、`34-daemon-status-auth`、`34-daemon-stop-stale-reachable` 全過。`tests/35-daemon-worker-supervisor-disconnect` 用 `/bin/ps` 找 worker，macOS 的 sandbox 不准執行 setuid 的程式，所以在 sandbox 裡失敗；不包 sandbox、其他條件一樣（`env -i`、Node 22、暫存 HOME、系統分配的 port）重跑，2/2。server 端的 `pid-lock`、`daemon-instance` 和 supervisor 的測試在上面。
- 上面 server 沒過的 2 個都要 PATH 上找得到 `claude` 執行檔，這裡照規定不放真的 claude，不是回歸：
  - `claude/agent.test.ts` 的「resolves the installed Claude Code version」直接執行 `claude --version`（c9fb31f70 起就有，`resolveClaudeCodeVersion` 在這個範圍沒改）。
  - 新的 `claude-provider-config-dir-history` e2e 的「an agent's timeline survives a daemon restart」：`extends: "claude"` 的 provider 要找得到 claude 執行檔才算可用（`checkProviderLaunchAvailable` 只找路徑，不執行），否則回 `Provider 'claude-secondary' is not available`。
  - PATH 最前面放一個假的 `claude`（只回答 `--version`，其他呼叫一律失敗並記錄；跑完記錄是空的）重跑這兩個檔，85/85。
  - 裝了真的 claude 以後：`claude/agent.test.ts` 在 CI 的 `test:unit` 裡跑，CI 會先 `npm install -g @anthropic-ai/claude-code`。`claude-provider-config-dir-history` 是 `*.e2e.test.ts`，`test:unit` 排除它，`test:integration` 也沒列，CI 不會跑，要手動跑（本機用假的 claude 是 2/2）。
- 這一批沒有找到回歸，沒有另外的修正 commit。跑過的檔案在 HEAD 沒有剩下的失敗；`8010f71b1` 就壞的只有上面 `f5ae3f039` 修掉的那一個。

留給 CI 和裝置驗證的：

- push 之後手動跑一次 CI 並勾 Playwright（第 18 節）。這台 Mac 只跑了上面的定向測試，還要看：
  - server 全部的單元測試（包括上面要真的 claude 的 `claude/agent.test.ts`）和 `test:integration`；CLI 的 e2e 分片。
  - Playwright：`agent-profiles-picker`、`daemon-lifecycle`、`keyboard-chord-modifier-step`、`plugin-theme`、`sidebar-workspace`；桌面版 e2e 的 `keyboard-shortcut-unassign`。
  - App 的 browser 模式單元測試 `question-form-card.browser.test.tsx`、`terminal-emulator-runtime.browser.test.ts`：要 Playwright 的 Chromium，這台 Mac 沒裝，沒跑。
- CI 不跑、要手動跑的：`claude-provider-config-dir-history.e2e.test.ts`，在 PATH 上有 claude 的機器上跑（見上面）。
- 要真的 provider 才能跑、CI 也不跑的：`codex-custom-provider-import.local.e2e`（codex）、`opencode-bridge.local.e2e`（OpenCode）、`pi-rewind.real.e2e`（Pi）。照規定不在這台 Mac 執行真的 provider，沒跑。
- iOS、Android 正式版實機：多選問題的「其他」答案（`8e858f0e3`）、上傳的檔名（`fbc83613c`）、終端機的 OSC 8 連結（`dc9799f6f`：桌面版在終端機重新訂閱之前，點 http、https 的 OSC 8 連結會交給開啟器；手機點不開，mailto 也不算連結，見上面的 fixes-0928 查證）、訊息日期（`28507224d`）。Android 的 `production` 建置改了 gradle 指令（`e3c853df5`），下一次 EAS 正式建置時確認。
- 桌面版：有密碼的 daemon 顯示「在編輯器開啟」（`e07da55f8`）；多鍵、改綁和 Backspace 的快捷鍵（`9a3f3a0dc`、`ec43e9067`、`fbe5005aa`）；主題清單捲動（`a048094da`）；網頁版模型選擇列（`04c3e003f`）；從設定頁更新和重啟 daemon（`315803688`）。
- daemon：重開機後 PID 被占用（`faee1cd95`）要實際重開機才驗得到；`daemon.log` 寫不進去（`cb9654a65`）；大型 repo 的監看 CPU 和記憶體（`c3e1e084a`、`e998e0a08`、`9978988e3`）。
- 審查後補拿的：用一般 ACP Agent 開新 Agent，/ 選單要列出它的斜線指令（`513f2a9ea`）；在官方 Paseo 的 Agent 終端機裡跑 `woowtech-smart run`，要建立頂層 Agent，不報「Caller agent not found」（`e68553f75`）；桌面版載入有建置指令的目錄外掛，建置照常成功（`f9fb992dc`）。
- 延後的 `c906c2f4a`、`e1c769c01` 要 owner 決定。
- 這個分支沒有 push。`woowtech/integration-0926` 已經前進到 `2a706980b`，從 `ce3dffa70` 起兩邊都改到的只有這個 README；合回去之後重跑守門和 T1 測試。

### 第三批：上游 `d7b7016cc..4965af219`

- 範圍：第二批的終點 `d7b7016cc` 到 `4965af219`（上游 0.10.1 的更新紀錄，9/28），共 30 個 commit，含上游 0.10.0-beta.1（9/27）和 0.10.0（9/28）。commit 已經在本機，這次沒有 fetch。
- 分支 `woowtech/upstream-picks-0929`，從 main 的 `ea9f49e49` 開出（worktree `woowtech-smart-b3`）。原則和做法照前兩批：照上游的時間順序 `cherry-pick -x`，保留上游作者；衝突的解法寫在該 commit 訊息的 `woowtech:` 段落；fork 的調整各自一個 commit。
- 挑選清單標了 6 個「拿」、6 個「條件式」、2 個「延後」、16 個「不拿」。
- 結果：拿 11 個：6 個「拿」和 5 個「條件式」，其中 `940dbfd24` 只拿 OpenCode v1 的部分。不拿 17 個（16 個「不拿」，加上條件式的 `da48803a4`），延後 2 個。fork 的調整 3 個 commit，第 3 個是這批之後補修的分頁提示框。

拿進來的：

| 上游 commit                           | 內容                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `827178df9`                           | Codex 回溯（fork 出新 thread）時帶上原本的設定：自訂 provider 和 Paseo 工具不再掉回預設（Closes #4542、#3205）         |
| `dffde6ae8`（#5450）                  | 自訂 Codex provider 從它自己的 `CODEX_HOME` 讀自訂提示詞和技能，/ 選單不再列出別的 home 的提示詞                       |
| `8de52a3c9`（#5386）                  | 背景的 `send_agent_prompt` 等 provider 接受回合才回報，狀態是執行中，不是閒置                                          |
| `7bb7d4ed0`（#5451，條件式）          | 分割窗格裡，從某個 Agent 開的子 Agent 放在那個 Agent 所在的窗格，不是目前聚焦的窗格                                    |
| `b85b44aea`（#5351，條件式）          | daemon 重啟或升級後，主機頁和說明選單顯示新的版本：每次連線變化都把 server_info 寫進 session store，斷線時保留上次的值 |
| `05874e289`（#5340，條件式）          | Agent 清單、排程、匯入工作階段、提交清單和供應商設定的相對時間會自己更新；不到一分鐘一律「剛剛」                       |
| `9d010211a`（#5572）                  | 封存自訂 Codex provider 的 Agent 時，一併封存它的 Codex 對話，「匯入工作階段」不再列出它                               |
| `f4ba16a0b`（#5577，條件式）          | 串流中的一段以縮排結尾時保留換行，Codex 的 Mermaid 圖不再被併成一行                                                    |
| `849a876bc`（#5579）                  | 外掛重新載入時，已經完成的外掛 provider 工作階段不再多出「Provider connection closed」錯誤，只有進行中的回合會中斷     |
| `434060709`（#5583）                  | 加入 Claude Sonnet 5.5（Claude Code 2.1.284 起才列出），Sonnet 5 改標 Previous release                                 |
| `940dbfd24`（#5587，條件式，只拿 v1） | OpenCode 換模型時，清掉新模型不支援的 thinking 選項，並立刻更新續接資料，重新載入不會回到舊的選項                      |

條件式的都先確認過功能我們有、也不需要不拿或延後的 commit：

- `7bb7d4ed0`：`open-beside.ts` 跟上游的前一版相同，分割窗格、`parentTabId` 和 `findPaneContainingTab` 都是既有的，修的是既有行為（#5433），不是新能力。
- `b85b44aea`：只改 server_info 進 session store 的路（`host-runtime.ts`、`session-store.ts`、`session-context.tsx`）和測試用的 daemon。沒有碰 daemon 自我更新、`unavailable-npm-global-cli.ts` 和桌面版的更新來源（第 4 節）。新的 e2e 只讓測試 daemon 回報 0.8.0 和 0.9.1 兩個版本，不跑 npm。
- `05874e289`：碰到 fixes-0928 的繁中（`time.ts` 的「剛剛」、排程頁），兩邊都保住，見下面。它改的 `usage/card.tsx` 來自延後的 `792715e76`，只是 hook 改名，沒帶。
- `f4ba16a0b`：修的是 `presentation.ts` 裡來自 `0aca3b605`（第一批拿了）的結尾換行處理，不需要第一批沒拿的串流淡入（`6215e08ef`、`5d70ab2ab`）。
- `940dbfd24`：我們出貨的是 OpenCode v1（`providers/opencode-agent.ts`）。v1 的修正用到的 `reconnectIfServerExited`、`parseModel`、`thinking_option_changed`、`refreshSessionPersistence` 和測試 harness 都是既有的，不需要 v2 或 `792715e76`。
- `434060709`（拿）：Sonnet 5.5 的條目跟第一批的 Opus 5.5（`aeb98f813`）同一種形狀：`minimumClaudeCodeVersion`、預設 thinking `medium`、1M context、沒有 `supportsThinkingDisabled`（Sonnet 5.5 拒絕關掉 thinking）。沒有動到 Claude Agent SDK 的 import。

不拿的，依原因：

- 要 OpenCode v2（`c906c2f4a`，第二批延後）：`da48803a4`（#5526，條件式）。改的 4 個檔有 3 個是 `opencode/v2/`，第 4 個（`provider-launch-config.ts`）只把 `createProviderEnv` 的回傳型別改給 v2 的呼叫點用。v1 在 `opencode/server-manager.ts` 用 launch env 起專屬的 `opencode serve`，沒有 v2 重新連線後遺失 session 環境的問題。
- 新的介面能力、廠商標誌：`a43c8d888`（#5379，執行 cursor-agent 的終端機設定檔顯示 Cursor 圖示），要 owner 決定。第 22 節之後它顯示的是 Cursor 的文字徽章（Cu），不再有標誌的顧慮。
- 只有 Windows：`cf4509631`（#1987）。
- 網站：`dec2d861e`（#5538）、`7f5d32cdd`（#5537）、`c54f20e53`（#5138）、`d0a30ed4d`（#5555）、`8b5201fed`（#5575）。
- 發版與版本號：`52d345db7`（0.10.0-beta.1）、`c481ecf3e`（0.10.0）；更新紀錄：`a50a47600`、`dfc9add77`、`4965af219`；發版前的 lock 排序：`6ca001c3e`。
- lock 簽章／Nix hash：`30178c4f5`、`c7e7e52b0`、`dd5df9ec6`。

延後，要 owner 決定：

- `78a0f093e`（#5488）：OpenCode v2 的 helper 結束後恢復對話，要先有 v2（`c906c2f4a`）。
- `792715e76`（#5465）：用量來源改成內建外掛並跟著工作階段的帳號，189 檔、約 1.4 萬行的新能力。這批挑進來的 commit 碰到它的地方都沒帶：`usage/card.tsx`、`formatCompactTimeAgoAsProse`、`opencode-agent.test.ts` 的兩個 usage 測試。

衝突與調整：

- `b85b44aea`：`e2e/support/helpers/isolated-host-daemon.ts` 衝突。上游把挑 port 抽成 `getAvailableHostDaemonPort()`（新的可重啟測試 daemon 也用它）；取上游的寫法，函式裡保留 fork 的保留埠 6767、6768、6770 和 `E2E_DAEMON_PORT`（第 10 節），新的 helper 也不會用到 woowtech smart 自己的 port。`test-utils/paseo-daemon.ts` 自動合併，沒有帶回 `792715e76` 的 `BuiltinPluginLoader`。
- `05874e289`：
  - `utils/time.ts`：用上游的 `describeAge`（散文和精簡兩種共用，不到一分鐘一律「剛剛」），但經過的時間帶單位和數字，不是上游的「5m」，`describeTimeAgo` 和 `describeCompactTimeAgo` 照舊經 `woowtech.time` 的翻譯組字，日期照舊用 `formatMonthDay`。`woowtech-copy.test.ts` 的 `REPLACED_ENGLISH` 擋的上游英文字面值都沒有回來。
  - `components/schedules/schedule-row.tsx`：上游的 `ScheduleMeta` 用 `useTimeAgo`；`buildMeta` 照舊用 `woowtech.schedules.meta` 的翻譯（建立、上次執行、從未執行），`stateBadge` 照舊用 `t`。守門「the translated schedule screens have no hardcoded English」照樣通過。
  - `screens/workspace/workspace-desktop-tabs-row.tsx`：只把 `useCompactTimeAgo` 的 import 改到 `hooks/use-time-ago`。
  - `usage/card.tsx`：來自延後的 `792715e76`，不帶。
- `f4ba16a0b`：測試只是位置衝突。上游下一個測試來自第一批沒拿的 Find（`135a3b4c9`），新測試改放在我們的下一個測試前面，內容一字不差。
- `940dbfd24`：只拿 v1。`opencode/v2/session.ts`、`opencode/v2/agent.test.ts` 不存在（`c906c2f4a` 延後），不帶；`opencode-agent.test.ts` 新的 `test.each` 放在 `buildConfig` 後面，它旁邊的兩個 usage 測試和這個 commit 改的 `model_changed` 期待值來自 `792715e76`，不帶。v1 的修正、`agent-manager.ts` 的一行和兩個測試檔的新測試跟上游一字不差。
- fork 的調整：
  - `04813c06f`：`05874e289` 之後不到一分鐘都是「剛剛」，`i18n/woowtech-zh-tw-screens.test.ts` 原本期待 30 秒前是「30 秒前」，改成「剛剛」，並加上整一分鐘是「1 分鐘前」。沒有人再讀的 `woowtech.time.ago.seconds` 從英文和繁中拿掉。
  - `6bf542525`：`05874e289` 讓這些列改用 `useTimeAgo`，標籤存在 state，只在共用的計時器觸發時重算。fork 的標籤是翻譯過的，換語言後，還開著的列會停在舊語言，直到下一次觸發：最多一分鐘、一小時或一天，一週以上的日期永遠不會觸發；排程列會混成「建立：5m ago」。挑之前這些列在 render 時組字，換語言立刻跟著變。現在 `hooks/use-time-ago.ts` 經 `useTranslation` 讀 App 語言，語言改變時重算（註解 `woowtech smart:`）。`useCompactTimeAgo`（側欄和分頁）共用同一個 hook，fixes-0928 以來就有同樣的缺口，一起修好。新的 `hooks/woowtech-use-time-ago.test.tsx` 在改之前 0/3（切到 zh-TW 後仍是「5m ago」「Jan 15」「5m」），改之後 3/3。
- 這批之後補修（協調者要求；fixes-0928 以來就有，不是這批造成的）：桌面版分頁的 Agent 提示框原本在已經翻譯的精簡標籤後面再接英文的「 ago」，繁中顯示「5 分 ago」「9月27日 ago」。現在提示框經 fork 的 `screens/workspace/woowtech-agent-tab-tooltip.ts`（`useAgentTabTooltipActivity`，內容就是 `useTimeAgo`）取整句翻譯好的時間；上游檔 `workspace-desktop-tabs-row.tsx` 改一個 import 和一行呼叫（註解 `woowtech smart:`），拿掉 `formatAgentTooltipActivity`，英文跟之前一字不差。`woowtech-agent-tab-tooltip.test.tsx` 12 個：把上游原本的算法原封不動搬進 fork 檔時 8/12（繁中 4 個出現「5 分 ago」「2 小時 ago」「3 天 ago」「1月15日 ago」），改用 `useTimeAgo` 後 12/12；最後一個測試從原始碼確認提示框用的就是這個 hook。
- 繁中：這批沒有新的翻譯 key，也沒有改到簡體中文，不用重新產生 zh-TW。
- lock：`package-lock.json` 沒變。
- 檢查過沒有帶回原版的東西：品牌和 CLI 名、home、port（新的測試 helper 也避開 6770）、官方版共存、技能路徑；推播（FCM、push.woowtech.io、`woowtechPush`、不帶內容的推播、Expo 登記停用）；配對 scheme（沒有新的 `paseo://`）、relay；LINE 仍拿掉，官網、客服信箱和通用開啟器的 mailto 不變；工作區自動命名、commit 訊息和 PR 的 AI 生成仍關閉；Claude Agent SDK 仍是 devDependency，出貨程式沒有新的值 import，沒開 `verbatimModuleSyntax`；沒有本地語音；更新來源不變；`.github/`、`packages/website` 沒動，版本號都還是 0.8.0。新加的 `6767` 只在測試的假資料裡（`host-runtime.test.ts` 本來就有 104 處、`codex-app-server-agent.test.ts` 的 MCP 設定網址交給假的 Codex），不會真的連線。
- 11 個 pick 的增刪行逐一跟上游比對：8 個一字不差（`f4ba16a0b` 只換了位置）；`b85b44aea`、`05874e289`、`940dbfd24` 只差上面寫的地方。
- cherry-pick 和 commit 都設 `LEFTHOOK=0`，理由同第一批。

測試（這台 Mac，Node 22，`--maxWorkers=1 --no-file-parallelism`，重的都經過 `heavy.sh`）：

- 環境：同第二批。`env -i`，PATH 只有 node@22 和系統資料夾（沒有 claude、codex、opencode、pi），HOME 和 TMPDIR 用暫存資料夾，在 `sandbox-exec` 裡跑：只准連 loopback，擋 6767、6768、6770，也擋讀寫 `~/.woowtech-smart`、`~/.paseo`。
- 相依套件：沒有 `npm install`。`node_modules` 從相依狀態跟 main 相同的 `woowtech-smart-links` 用 APFS clone（`cp -c -R`）複製，守門要的 `woowtech/tools/node_modules`（opencc-js）一起複製；內部磁碟可用空間前後都是 13 GB。
- 建置：挑之前在 `ea9f49e49` 跑一次 `npm run build:server`，守門 123/123 當基準；挑完再建一次。
- typecheck：改到的 3 個 workspace（server、app、cli）逐一 `npm run typecheck --workspace=…`，全過。desktop、protocol、client 沒有改到。
- format、lint：`npm run format:check` 整個 repo 4690 檔通過；改到的 53 個 ts／tsx 檔 `lint` 0 個 warning、0 個 error。
- 守門 `node --test woowtech/*.test.mjs`：123/123，沒有改任何守門。
- 挑進來的 commit 新增或改過的測試（Playwright 和要真的 provider 的除外，見最後）：
  - server 10 檔 838/839：agent-manager 190、mcp-server 123、codex-app-server-agent 163、opencode-agent 140、provider-registry 50、plugin-provider 26、外掛生命週期 e2e 8、test-utils 的 `paseo-daemon`（新）2、Claude 的 models 53 和 agent 83/84。沒過的 1 個見下面。
  - App 6 檔 144/144：`host-runtime` 73、`time` 34、`presentation` 16、`woowtech-zh-tw-screens` 9、`woowtech-copy` 9、fork 新的 `woowtech-use-time-ago` 3。
- 直接受影響的：
  - server 28 檔 396 過、1 略過（只在 Windows 跑的 OpenCode npm shim）：Codex 另外 7 檔 118、OpenCode 另外 13 檔 135、Claude 的 query、SDK 載入器和子 Agent 重播 7 檔 129、`agent-prompt` 14（`send_agent_prompt` 等回合開始）。
  - App 67 檔 820/820，都是用到這批改的模組的測試：相對時間的計時器 6、排程 6 檔 38 和 `schedule-format` 12、匯入工作階段 2 檔 77、提交清單 1、分割窗格的 `workspace-layout-store` 133 和 `workspace-subagents-integration` 5、設定頁的 `host-page-translations` 3、zh-TW 7、品牌 10，以及其他 import 這些模組（多半是 session store）的 51 檔 528，包括下面 T1 的 5 檔。
- T1：`missing-workspace-directory-demand` 29/29、`directory-sync/index` 28/28、`woowtech-workspace-open-intent` 7/7、`host-runtime` 73/73、`sidebar-workspace-list` 3/3、`use-projects` 2/2、`viewed-timeline-sync` 39/39、`woowtech-workspace-directory-settled` 4/4，共 185/185。`host-runtime` 比之前多 1 個，是 `b85b44aea` 新加的。
- fork 自己的：server 29 檔 225/225（推播、配對、relay、自動命名和 Git metadata 關閉、config、CORS、daemon 指令訊息、自我更新停用、supervisor）；App 16 檔 96/96（推播、配對、主機補名、通知標題、網址開啟器等）。`b85b44aea` 改到的 `session-context.tsx`（通知標題的接點）和 `host-runtime.ts`（主機補名、配對、T1 的接點）都在這些測試裡。
- 沒過的 1 個：`claude/agent.test.ts` 的「resolves the installed Claude Code version」直接執行 `claude --version`，這裡照規定 PATH 上沒有 claude（Claude binary not found）。這個測試的內容在 `ea9f49e49` 和 HEAD 完全相同。PATH 最前面放第二批那個只回答 `--version` 的假 claude 重跑整個檔，84/84，其他呼叫的記錄是空的。跟第二批一樣是環境造成，不是回歸。
- 這一批沒有找到回歸。fork 的 `6bf542525` 補的是 `05874e289` 在 fork 才有的缺口（見上面）。

留給 CI 和裝置驗證的：

- push 之後手動跑一次 CI 並勾 Playwright（第 18 節）。這台 Mac 只跑了上面的定向測試，還要看：
  - server 全部的單元測試（包括要真的 claude 的 `claude/agent.test.ts`）和 `test:integration`；CLI 的 e2e 分片，包括改了期待值的 `tests/15-provider.test.ts`（Sonnet 5.5，會查真的 provider，本機沒跑）。
  - Playwright：新的 `subagent-origin-pane`、`host-version-after-daemon-restart`、`agent-relative-time`、`schedules-relative-time`，改過的 `import-session-flow`、`commit-diff-panel`、`provider-settings-refresh`。新的時間 spec 期待英文的「just now」「3m ago」「Created just now」，跟我們的英文文案相同。
- 要真的 provider 才能跑、CI 也不跑的：`codex-custom-provider-archive.local.e2e`（codex，`9d010211a`）、`opencode-model-switch.real.spec.ts`（OpenCode 和免費模型，`940dbfd24`；Playwright 預設的 project 不跑 `*.real.spec.ts`）。照規定不在這台 Mac 執行真的 provider，沒跑。
- 實機和桌面版：
  - 相對時間（`05874e289`、`6bf542525`）：Agent 清單、排程頁、匯入工作階段、提交清單和供應商設定頁開著不動，標籤從「剛剛」變成「1 分鐘前」再往上走；繁中和英文各看一次；在設定換語言後回到這些畫面，標籤立刻是新語言，排程列不會混成「建立：5m ago」；桌面版分頁的 Agent 提示框在繁中是「5 分鐘前」這種整句，沒有「ago」。
  - daemon 重啟或升級（`b85b44aea`）：主機頁的版本和說明選單的版本不用重開 App 就換成新的；斷線時保留舊版本。這條路也經過 T1 的接點，照第 16 節再點一次指向新工作區和已知工作區的通知。
  - 桌面版分割窗格（`7bb7d4ed0`）：焦點在另一個窗格時，從 Agent 開子 Agent，子 Agent 出現在那個 Agent 的窗格。
  - 模型：Claude Code 2.1.284 以上列出 Sonnet 5.5，thinking 沒有「關閉」；舊版不列。OpenCode 選了 Medium 之後換到沒有這個選項的模型，thinking 選項被清掉，重新載入也不回來（`940dbfd24`）。
  - 自訂 Codex provider（`827178df9`、`dffde6ae8`、`9d010211a`）：回溯後仍是同一個 provider、工具還在；/ 選單列的是它自己 `CODEX_HOME` 的提示詞；封存後「匯入工作階段」不再列出它。
  - Codex 串流中的 Mermaid 圖（`f4ba16a0b`）、背景 `send_agent_prompt` 回報執行中（`8de52a3c9`）、外掛 provider 重新載入後已完成的工作階段沒有錯誤（`849a876bc`）。
- 延後的 `78a0f093e`、`792715e76` 和不拿的 `a43c8d888`（Cursor 圖示）要 owner 決定。2026-09-29 owner 決定先關掉用量功能，`792715e76` 仍延後，見第 23 節。
- 這個分支沒有 push。main 仍在 `ea9f49e49`；合進 main 之後重跑守門和 T1 測試，並重建 server 的 dist。

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
- 在本機建 iOS 或 Android 之前，先跑 `npm run build:terminal-webview --workspace=@getpaseo/app`，有變動就 commit。手機的終端機跑的是 repo 裡預先建好的 `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts`，上游只在 EAS 的 `eas-build-post-install` 重建它；本機的 prebuild、`xcodebuild` 和 `build-android.sh` 都不會重建，`src/terminal/` 的改動就不會進手機。
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

- 桌面版的「關於」視窗和麥克風權限提示（2026-10-05，分支 `woowtech/desktop-about-cors-1005`，第 6 節）：每次突變只改一個地方，改完用 sha256 確認還原。
  - 守門 `desktop-about.test.mjs` 先紅（electron-builder 算出「Copyright © 2026 Mohamed Boudra」、`main.ts` 沒有呼叫）後綠 3/3。8 種突變都被抓到：yml 的版權拿掉或改年份、fork 檔的版權或 `credits` 改掉、`main.ts` 的呼叫拿掉、移到 `app.whenReady()` 之後、之後又設別的值、選單的「關於」改成自訂項目。
  - 守門 `desktop-permissions.test.mjs` 先紅後綠 1/1。10 種突變都被抓到：拿掉 `extendInfo`、英文改回 Electron 的、多一句沒有翻譯的相機說明、少一個 `extraResources`、對到 `zh-Hans.lproj`、繁中改成英文、簡中用 `$(PRODUCT_NAME)`、少分號、清空檔案、鍵拼錯。
  - 桌面版 `woowtech-about-panel.test.ts` 先紅（yml 沒有 `copyright`）後綠 2/2；`desktop-packaging`、AppUserModelID 的測試照樣全過。全部守門 `node --test woowtech/*.test.mjs` 189/189。
  - 沒有完整打包（`electron-builder --mac` 太重）。改用 electron-builder 26.8.1 自己的 `createMacApp` 和 extraResources 複製，在去掉 Electron Framework 的 Electron.app 副本上跑：Info.plist 的 `NSHumanReadableCopyright` 是 `© 2026 WOOW TECH CO., LTD.`，`NSMicrophoneUsageDescription` 是新的英文句子，Electron 其他的說明不變；`Contents/Resources/zh_TW.lproj`、`zh_CN.lproj` 各有 `InfoPlist.strings`，沒有多出別的中文語系資料夾。
  - 再用 CoreFoundation（`CFBundleCopyLocalizationsForPreferences`）查這個副本：zh-Hant-TW、zh-Hant-HK 選 `zh_TW`，zh-Hans-CN、zh-Hans-SG 選 `zh_CN`，讀到的都是我們的句子；英文沒有翻譯檔，用 Info.plist 的句子。`plutil -lint` 兩個檔都過。
  - 沒看到的：實際的「關於」視窗和權限提示，要在打包、簽章後的 App 上看（接下來）。
- 舊 home 的 CORS 白名單拿掉上游網頁版（2026-10-05，分支 `woowtech/desktop-about-cors-1005`，第 19 節）：`npm run build:server` 之後，`woowtech-cors-origins.test.ts` 先紅（4 個：解析、`PASEO_CORS_ORIGINS`、重新載入、實際起 daemon，上游網頁版拿到 CORS 標頭）後綠 6/6；`cors-defaults`、`pairing-link` 和 config 相關 6 檔照樣全過。守門 `pairing.test.mjs` 9/9，5 種突變都被抓到（第 19 節），每次只改一個地方，改完用 sha256 確認還原。
- 第一階段驗收：商標與第三方授權（2026-09-30，分支 `woowtech/logo-compliance-0930` 的 `33f2fa8ac`，第 22、24 節）：main `7aee17b77` 加上第一階段從 `8c19faee0` 起的 11 個 commit（建置 6 個 `85775f63b`～`272aabfa9`、審查後的修正 5 個 `223de0c69`～`a0d8eec29`）和合併 main 的 `33f2fa8ac`，共 12 個 commit，都有 Co-Authored-By。對 main 改 24 檔（+1926／−77，新增 8 檔，沒有刪檔）：App 的 `packages/app/src` 20 檔、`woowtech/` 4 檔（README、`vendor-marks.mjs` 和兩個守門）；沒有 e2e、server、桌面版的檔案，package.json 和 lock 沒有變更，`.github` 跟 main 相同。每一步的步驟紀錄和證據在 `~/.local/share/woowtech-smart/logs/logo-s1-*`（`logo-s1-<步驟>.md`），截圖在 `~/.local/share/woowtech-smart/shots/logo-s1-*`，CI 的 API 回應和 job log 在同一個 logs 目錄的 `logo-s1-ci-*`。
  - 為什麼：協調資料夾的逐家研究 `coord/reports/logo-usage-research.md`（不在 repo 裡，不是法律意見），和 owner 在 2026-09-30 的決定：06:5x 同意協調者的四項建議，07:0x 補充「同意前先用徽章，後面可以改版更新再優化，目前以可以先上架為目的」。所以分兩階段：第一階段只做上架前一定要有的，廠商標誌改回是第二階段。
  - 這一輪的內容（細節在第 24 節）：
    - 設定 App 區段「關於」後面的「商標與第三方授權」頁（英文 Trademarks and third-party notices，`/settings/notices`）：商標聲明；顯示自己標誌的 13 家 Agent、4 個 Git 平台、24 個檔案類型標誌的所有者，各家要求的署名、授權和來源照原文；MIT 條文。
    - GitLab 的 forge 標誌改成文字徽章 Gl，不用 GitLab 的橘色，tanuki 的路徑資料不再出貨。
    - GitHub、Codeberg 的標誌不管呼叫端傳什麼顏色，淺色主題畫純黑、深色主題畫純白。PR 動作遇到這兩家改畫通用的 PR 圖示，新增專案的「從 GitHub 複製專案」和 GitHub 儲存庫列改用通用的 `FolderGit2`（都是審查後的修正）。
    - 檔案總管 12 種檔案類型改畫通用檔案圖示：owner 決定的 go、swift、terraform、hcl、vue、sass、dart、elixir，加上審查依所有者原文換掉的 astro、gradle、graphql、lua；表裡留 42 個。
    - 上架規則：商店截圖、宣傳圖、官網和其他行銷素材不出現第三方的標誌。
    - 守門 `woowtech/third-party-notices.test.mjs`（11 項）照資料檢查授權頁跟 App 畫的標誌一致；第 22 節的 `claude-badge.test.mjs` 白名單跟著改。
  - 審查與修正：
    - 三份獨立審查（`272aabfa9`，測試、合規、介面三個角度，`logo-s1-review-*.md`）共 4 個 blocker。合規 3 個：新增專案用 lucide 的 GitHub 線條圖示（灰色）；Astro、Gradle、GraphQL、Lua 依所有者原文要事先許可或不准改色，卻還保留；PR 動作停用或無法使用時，GitHub、Codeberg 的標誌跟著變成 0.5／0.6／0.72 的半透明灰。介面 1 個：繁中頁有 fork 自己寫的英文（「Public domain」「redrawn in a single color」）。測試 0 個。
    - 修正（`logo-s1-fix.md`，每個都先寫測試、看它失敗再改）：`223de0c69`（新增專案改用 `FolderGit2`，守門第 3 項改成不准任何 lucide 品牌圖示）、`22e227a00`（PR 動作的通用圖示）、`07f62a056`（換掉 Astro、Gradle、GraphQL、Lua）、`74e007f88`（繁中頁的「公眾領域」「修改：重新繪製成單色」）、`a0d8eec29`（README）。
    - 複查（`logo-s1-recheck.md`，`a0d8eec29`）：4 個 blocker 都已修正，沒有新的 blocker。守門 172/172；App 9 檔 69/69；typecheck app、lint、format 檢查通過；舊實作配新測試有 7 個失敗，forge 標誌的測試檔載入失敗；三種變異共 5 個失敗。
    - 合進 main 前的審查（`logo-s1-final-review.md`，兩輪）blocker 0，守門（`logo-s1-gate.md`）go。留下的建議，不是 blocker：授權頁元件沒有畫面或 e2e 測試；守門抓不到 import 大括號裡夾註解的 lucide 品牌圖示，也抓不到不經 `renderForgePrIcon`、直接畫 forge 標誌的 PR 動作；繁中的結構測試信任資料欄位。記錄下來的規則偏差（低，都不影響證據）：桌面版輪的腳本用 `pgrep`、`lsof`、`ps -axo` 查程序，Android 輪的資源監看用 `pgrep -g` 看自己的 process group；修正輪用 `perl` 的 `setsid` 在背景排 heavy 鎖，沒用 `run_in_background`。
  - 合併 main（`logo-s1-merge.md`，`33f2fa8ac`，父 `a0d8eec29`＋`7aee17b77`）：只有 README 的「接下來」衝突，兩邊都保留（第一階段 +115／−5、main +33／−6）。本機（`env -i`、只准連 loopback 的 sandbox）：`build:server` 通過；守門 175/175，照 CI 拿掉 OpenCC 那一項後 174/174；`write-vendor-badges.mjs --check` 通過；typecheck 11 個 workspace；App 20 檔 227/227；`format:check` 4747 檔、lint 26 檔 0 個 warning、0 個 error。`a0d8eec29..33f2fa8ac` 只改 `ci.yml`、桌面版的 e2e 腳本、README 和兩個守門，`packages/app/src` 的樹跟 `a0d8eec29` 相同，所以下面在 `a0d8eec29` 上的裝置結果也適用 `33f2fa8ac`。
  - CI：[run 36697759152](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36697759152)（CI #13，`33f2fa8ac`，手動、勾 Playwright）：失敗，失敗的只有 Playwright 分片 1/4、4/4。18 個 job：14 個成功、2 個失敗，Windows 兩組照設計略過；attempt 1，沒有重跑。typecheck 的「Check woowtech fork guards」成功：174 項、173 通過、0 失敗、1 略過（只在 macOS 跑的「Install CLI」那一項），`third-party-notices.test.mjs` 的 11 項都過。desktop-tests（ubuntu）的 browser E2E、Linux 打包和三個打包 smoke 都成功。
    - Playwright 四片共 669 個：630 通過、7 失敗、4 個 flaky、28 略過。CI #10（`8c19faee0`，第一階段之前）是 633、5、3、28，一樣是 669 個 test、188 個 spec 檔，略過的 28 個也相同。第一階段沒改任何 e2e 的 spec 和 helper（`packages/app/e2e` 的樹跟 main、CI #10 相同），兩次的差別只在第一階段的 App 原始碼和 runner。下面 7 個失敗、4 個 flaky 沒有一個是第一階段造成的。PR 分頁、附件和新工作區的 11 個 test 照舊略過（多半要 GitHub 認證，CI 沒有）。
    - main 既有、CI #10 同樣失敗（兩次嘗試的錯誤和行號都相同）：`sidebar-help.spec.ts:80`（官網 `/` 轉到 `/en`，期待值不接受）、`viewed-agent-timelines.spec.ts:384`（fork 把錯誤改成「Host is not connected」，spec 還期待「Transport not connected」）。
    - CI #10 同樣兩次都失敗、錯誤和堆疊行號相同，整合輪驗收歸為原因不明或計時造成：`agent-consecutive-turns.spec.ts:816`、`agent-message-rewind.spec.ts:119`、`agent-message-submission.spec.ts:1298`。
    - `creation-old-daemon.spec.ts:95`（已發佈的 0.7.2 daemon）：CI #10 重試才過，這次重試也失敗。第一次跟 CI #10 一樣在 `page.goto` 逾時，那時另一個 worker 的 `root-error-recovery.spec.ts` 正讓 Metro 冷打包 recovery-app；重試失敗在 spec 第 122 行的 `expectPromptOnce`：第一個 agent 的 timeline 還沒有使用者訊息（前一步的 `waitForFinish` 逾時只回傳狀態、不丟錯）。同一個 spec 的 0.2.5、0.8.0 兩組都過。本機沒跑（要從 npm 下載已發佈的上游 daemon）。
    - `agent-stream-ui.spec.ts:188`：CI #10 通過，這次兩次都失敗，串流中往上捲以後 `distanceFromBottom` 一直是 0（要大於 300）。第 18 節的 run 2（`b6d442a73`，第一階段之前）就兩次都失敗；spec 和 helper 在 run 2、CI #10 和這次是同一個 blob，第一階段沒碰 agent 串流和捲動。本機（`logo-s1-final-repair.md`）在 `33f2fa8ac` 跑 6 次過 5 次，失敗的是 Metro 冷打包後的第一個 test，錯誤跟 CI 相同；App 原始碼換成 main 的跑 4 次、換回來再跑 4 次，都過。判定是間歇的計時問題，不是第一階段造成。
    - 重試才過的 flaky：`provider-settings-refresh.spec.ts:122`（CI #10 同錯，也是 flaky）、`command-center-host.spec.ts:12`（run 2 也是 flaky）、`launcher-tab.spec.ts:217`（終端機分頁出現後只讀一次分頁、沒有輪詢；本機 2/2）、`root-error-recovery.spec.ts:83`（`beforeAll` 等 Metro 冷打包 recovery-app 的 120 秒上限被超過：這一片的 runner 比 CI #10 慢約三分之一，主 bundle 134.6 秒對 101.1 秒、recovery-app 136.7 秒對 103.0 秒；重試 16.5 秒通過，本機 2/2）。CI #10 是 flaky 的 `sidebar-context-menu.spec.ts:17` 這次通過。
    - 沒有重跑：只重跑失敗的 job 仍是同一個 commit，分片 4/4 的 main 既有失敗每次都紅，分片 1/4 的三個計時失敗在 CI #10 和這次都兩次失敗，重跑看不到第一階段的新資訊（`logo-s1-final-repair.md`）。
  - 平台矩陣（證據在 `~/.local/share/woowtech-smart/logs/logo-s1-desktop*`、`logo-s1-android*` 和 `shots/` 底下同樣的前綴；逐項結果表在各步驟紀錄的最後，「未測」都寫了原因）：
    - Mac 桌面版（`logo-s1-desktop.md`，打包 `a0d8eec29`，未簽章、`--dir`、arm64，用假 claude、假 gh，git 的傳輸協定全部擋掉）：通過。包裡 tanuki 的路徑資料 0、12 個換掉的檔案類型標誌 0，授權頁的文字在 web bundle 裡（負向對照：`8c19faee0` 的包找得到 tanuki 和 12 個標誌，沒有授權頁）。授權頁在繁中的淺色、深色和 English 的深色、淺色：`/settings/notices`、5 段 48 列、沒有截斷，捲到底 MIT 條文完整，側欄的英文列名 228 px 放得進 263 px。GitHub、Codeberg 在「在…中開啟」選單、附件選單和標題列主按鈕（一般和 hover）淺色純黑、深色和陶土純白，切主題時即時變色；GitLab 三處都是 Gl 徽章；「建立 PR」是通用的 PR 圖示。檔案總管 12 種類型的 14 個檔案和檔案分頁是通用圖示，.py、.rs、.ts、.md 照舊；新增專案流程的 GitHub 那一列是 `FolderGit2`。回歸：供應商列表、ACP 目錄的 22 個徽章和 13 家上游圖示，設定沒有用量。daemon 背景的 `git fetch` 18 次都在連線前被擋。
    - Android 模擬器（`logo-s1-android.md`，`a0d8eec29`，沿用 Debug App，JS 從這個分支的 Metro 載入，daemon 用 mock）：通過。授權頁在繁中的淺色、深色和 English 的深色、淺色（聲明、5 段、info 提示、抽查的署名、捲到底、可選取、返回鍵回設定）；附件選單的 GitHub、Codeberg 淺色純黑、深色純白（GitHub 按下時也一樣），GitLab 是 Gl 徽章，「建立 PR」是通用圖示；12 種類型的 13 個檔案，圖示跟沒有對應的 `a.zzz`（通用圖示）逐像素相同；ACP 目錄 38 列（徽章 22、上游圖示 13、通用符號 3），設定沒有用量。
    - 兩個平台都未測：要有 PR 才出現的地方（PR 分頁、hover card 的檢查列、PR 面板），要主機的 gh 登入和真的 open PR，這一輪照規則不登入、不連網；這些地方在 CI 也略過，只有 vitest 檢查標誌元件本身。另外 Android 沒測小螢幕上的長段落。
    - iOS 模擬器：第一階段的 iOS 輪還沒跑，等 owner 回到 Mac 前重開機再做（FileVault 開著，遠端重開會連不回來）。另一條線的上架候選驗收（`rc0930-ios.md`，`33f2fa8ac`）只看到設定 App 區段有「商標與第三方授權」這一列，19:57 內建碟降到 1.4 GB 照停止規則停下，授權頁的內容、forge 標誌和檔案圖示都還沒在 iOS 上看。
  - 還沒做的：
    - iOS 輪（見上）。
    - 第二階段（`woowtech/logo-restore-0930`）：研究判定規則允許的 14 家補齊條件後改回標誌，放之後的改版，不擋第一階段上架。
    - 授權信：GitHub（Copilot 的圖示）、Pi、OMP 三份草稿在協調資料夾的 `coord/reports/vendor-permission-drafts.md`（不在 repo 裡），都還沒寄，寄不寄由 owner 決定；對方同意前維持徽章。
    - 要實機或正式簽章才驗得到的：手機實機上的授權頁、純黑白標誌和通用圖示；桌面版 Developer ID 簽章與公證後的正式版、Android 正式簽章版、TestFlight。實機項目列在「接下來」。
    - 上架規則：拍商店截圖、做宣傳圖和其他行銷素材時照第 24 節，不出現第三方的標誌；第二階段改回標誌以後也一樣。
    - 第 24 節「還沒處理的」等 owner 決定：Rust 標誌、旁邊沒有平台名稱的 forge 標誌、外掛用名稱指定的 lucide 品牌圖示、GitHub 標誌路徑資料的出處、Codeberg 的顏色、開放原始碼授權頁。
    - Playwright 還沒有整次綠過，見「接下來」。
  - 同一個 commit 也改了：第 22 節「刻意沒改的」檔案類型圖示改成換掉 12 個；「接下來」授權頁實機那一項照第 24 節改（PR 動作是通用的 PR 圖示，標誌列在實際會畫的地方），上架前那一項拿掉已經換掉的 lucide GitHub 圖示，Playwright 那一項加上 CI #13。
- 整合輪驗收（2026-09-30，整合分支 `woowtech/integration-0930` 的 `917fa512b`，第 8、9、18、22、23 節）：main `fde226d05` 加上帳號用量關掉（`woowtech/usage-off-0929` 的 4 個 commit）、廠商徽章（`woowtech/vendor-badges-0929` 的 8 個 commit）、兩次合併和 CI 的兩個修正（`63f74cf62`、`917fa512b`），共 16 個 commit、98 檔（+3266／−482）。新增的 17 檔都是文字；刪掉的 15 檔是上游的 8 個蝴蝶和 favicon SVG、桌面版的 7 張編輯器 PNG；package.json 和 lock 沒有變更，版本都是 0.8.0；`.github` 只改了 `ci.yml` 一處（`63f74cf62`）。每一步的步驟紀錄和證據在 `~/.local/share/woowtech-smart/logs/integ0930-*`（`integ0930-<步驟>.md`），截圖在 `~/.local/share/woowtech-smart/shots/integ0930-*`，CI 的 log 在同一個 logs 目錄的 `ci-0930/`。
  - 這一輪的內容：
    - 帳號用量關掉（第 23 節）：設定的主機清單沒有「用量」，舊的用量路由開到「連線」，context 圓環的 tooltip 只有上下文；daemon 收到用量請求回空清單，不讀憑證和鑰匙圈，也不打額度 API。
    - 廠商徽章（第 22 節）：`woowtech/vendor-marks.mjs` 的 48 家裡 35 家顯示文字徽章；桌面版「在…中開啟」的 7 張編輯器 PNG 刪掉，改畫徽章，Finder 是資料夾。
    - 研究後改回上游圖示的 13 家（第 22 節「顯示上游標誌的廠商」；除了 Gajae Code，都是廠商或作者自己送進 ACP registry 的檔案）：工具從 `130705c02^` 原樣還原，13 個 `.svg` 跟 `130705c02^`、`fde226d05` 是同一個 blob。
    - 深色主題 `claude` 改叫「陶土」，英文 Terracotta（第 22 節）；id、unistyles 名稱和顏色不變。
    - 網頁版和桌面版的啟動畫面改畫 WOOW 標誌，上游的蝴蝶拿掉（第 8 節）。
  - 本機（`integ0930-merge.md`，`8c19faee0`，`env -i`、只准連 loopback 的 sandbox）：`build:server` 通過；守門 161/161，照 CI 拿掉 OpenCC 那一項後 160/160；`write-vendor-badges.mjs --check` 通過；typecheck app、server、client、cli、desktop 各一次；App 34 檔 364/364、server 32 檔 422/422、desktop 3 檔 14/14；`format:check` 4739 檔、lint 53 檔 0 個 warning、0 個 error。`8c19faee0..917fa512b` 只改 `ci.yml`、桌面版的 e2e 腳本、README 和兩個守門，沒有 App、server、桌面版的執行程式，所以下面在 `8c19faee0` 上的裝置結果也適用 `917fa512b`（`integ0930-review.md`）。
  - CI：
    - [run 36642688479](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36642688479)（CI #10，`8c19faee0`，手動、勾 Playwright）：Playwright 四片 633 個通過、5 個失敗、3 個 flaky、28 個略過，四片都沒有 heap 用完。兩條分支加或改的 spec 都過：`woowtech-provider-usage-hidden.spec.ts` 2/2、`plugin-provider-icons.spec.ts`、`appearance-theme-picker.spec.ts` 4 個、`settings-host-page.spec.ts` 9 個；上游兩個用量 spec 的 5 個照設計略過。失敗和 flaky 的 8 個 spec 這一輪都沒改，協調資料夾的分類報告（`coord/reports/ci-0930-triage.md`，不在 repo 裡）判定是 main 既有或 flaky，見下面「還沒做的」。另外兩個 job 失敗，都是這一輪造成、已修：typecheck 的守門（淺層 checkout 讀不到 `130705c02^`）和 desktop-tests 的 browser E2E（設定輪播還在找「Usage」，30 秒逾時）。
    - [run 36645249296](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36645249296)（CI #11，`63f74cf62`，不勾 Playwright）：驗守門的修正。typecheck 轉綠；desktop-tests 仍在設定輪播逾時。
    - [run 36659321759](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36659321759)（CI #12，`917fa512b`，手動、不勾 Playwright）：成功。第 1 次 attempt 只有 cli-tests（shard 2/3）失敗，是已知的 `lifecycle.e2e.test.ts:368` race（「Unexpected end of JSON input」，CI #9 同一行同錯，`packages/cli` 這一輪沒改）；attempt 2 只重跑這個 job，11 分 18 秒通過。最後 18 個 job：12 個成功；Playwright 四片和 Windows 兩組照設計略過，不算通過；沒有失敗。typecheck 的「Check woowtech fork guards」64 秒成功；desktop-tests（ubuntu）的 browser E2E、Linux 打包（`editor-targets` 資料夾刪掉後第一次在 CI 打包）和三個打包 smoke 都成功。
    - 兩個修正：`63f74cf62` 讓 typecheck job 的 checkout 抓完整歷史（第 18 節），`woowtech/workflows.test.mjs` 檢查這個設定；`917fa512b` 把「Usage」從桌面版的設定輪播拿掉（第 23 節），`provider-usage-app.test.mjs` 掃 App 和桌面版的 e2e，不准再開用量頁。
  - 平台矩陣（逐項結果表在各步驟紀錄的最後，「未測」都寫了原因）：
    - Mac 桌面版（`integ0930-desktop.md`，打包 `8c19faee0`，未簽章、`--dir`、arm64，用假 claude、假 ACP agent 和 dev 的 mock）：通過：包裡顯示徽章的廠商標誌路徑資料、Claude 標誌、蝴蝶、編輯器 PNG、`wrangler*.toml`、relay.paseo.sh 都是 0（審查再用每家所有的路徑元素掃一次，也是 0：`integ0930-review-pkg-allpaths.json`）；徽章在繁中的淺色和深色、English 的淺色和陶土都對，看了供應商列表、ACP 目錄、模型選單、歷史的 Agent 列和 Agent 分頁；還原的 13 家顯示上游圖示；外掛送來的 SVG 不畫，改畫徽章 D；主題選單是「陶土」／Terracotta，選了以後重開仍是它；設定沒有用量，`/usage` 開到「連線」，tooltip 沒有用量、App 送出 0 次用量請求，直接問 daemon 也回空清單；第一次啟動（淺色）和重開（陶土）的啟動畫面都是 WOOW；「在…中開啟」是 Cu、Vs、Z、As 的徽章和 Finder 的資料夾。
    - Android 模擬器（`integ0930-android.md`，`8c19faee0`，沿用 Debug App，JS 從這個分支的 Metro 載入，daemon 用 mock）：通過：徽章的淺色、深色（供應商列表、ACP 目錄、模型選單、Agent 列、Agent header）；還原的 13 家；主題「陶土」／Terracotta，重開 App 後仍選著；設定沒有用量、tooltip 只有上下文、`/usage` 開到「連線」（繁中、English），daemon 沒有用量查詢（正向對照有記到）。啟動畫面、「在…中開啟」和打包掃描只有網頁、桌面版有，未測。
    - iOS 模擬器（`integ0930-ios.md`，`8c19faee0`）：守門 161/161、Metro、兩個 daemon、外開攔截通過。11:57 內建碟剩 1.6 GiB，照停止規則停下，徽章、主題、用量都未測；協調者改排在 `woowtech/logo-compliance-0930` 的 iOS 實測一起看。
    - Playwright 只在 CI 跑（上面的 CI #10），本機沒跑。
  - 審查與合併前守門（`integ0930-review.md`、`integ0930-gate.md`）：審查的 blocker 0；守門 go。記錄下來的規則偏差：Android 步驟的 adb server 自動連上別人的模擬器約 3 分鐘，沒有對它下指令，之後自己關掉；審查用了一次 `pgrep -f`，兩個暫存 SVG 寫到 `/tmp` 後同一個指令就刪掉。都不影響這一輪的證據。
  - 還沒做的：
    - 標誌：上架前必做的合規（授權與第三方聲明頁、GitLab 徽章、GitHub 和 Codeberg 改純黑白、8 個檔案類型圖示換成通用圖示）在 `woowtech/logo-compliance-0930`；另外 14 家補齊條件後改回標誌是之後的版本，在 `woowtech/logo-restore-0930`。
    - Playwright（CI #10，分類報告）：main 既有的失敗 2 個：`sidebar-help.spec.ts:80`（官網 `/` 轉到 `/en`，期待值不接受）、`viewed-agent-timelines.spec.ts:384`（fork 把錯誤改成「Host is not connected」，spec 還期待「Transport not connected」）。不是這一輪造成、原因不明或計時造成：`agent-consecutive-turns.spec.ts:816`、`agent-message-rewind.spec.ts:119`（第 18 節的 run 2 就已失敗）、`agent-message-submission.spec.ts:1298`。重試才過的 flaky：`provider-settings-refresh.spec.ts:122`、`creation-old-daemon.spec.ts:95`、`sidebar-context-menu.spec.ts:17`。修法建議在分類報告；要一次綠的 Playwright，先修 main 既有的 2 個。
    - 發現、跟這一輪無關：新工作區的專案選單搜尋欄在繁中顯示英文「Search projects」（main 既有）；從主機清單新增主機後，在外觀換主題又跳出「新增連線」sheet（同 F11 驗證輪）；autohand 的 registry 圖示在 12～16 px 認不出內容（廠商原檔）。
    - 要實機或正式簽章才驗得到的：手機實機上的徽章（12～24 px 讀不讀得出縮寫）、主題選單和沒有用量的設定；用舊版 App 連新的 daemon 時 tooltip 沒有紅字、用量頁只顯示「No usage data」；瀏覽器裡的網頁版啟動畫面；桌面版 Developer ID 簽章與公證後的正式版、Android 正式簽章版、TestFlight。徽章、主題、用量和啟動畫面的實機項目列在「接下來」。
  - 「接下來」的兩項 Playwright 合成一項、照 CI #10 改寫，第 18 節「仍待確認」的 Playwright 完整執行也照 CI #10 改寫；「接下來」第 23 節那一項的 Playwright 已拿掉。
- 帳號用量關掉（2026-09-29，分支 `woowtech/usage-off-0929` 的 `8dfa03bd2`，第 23 節）：步驟紀錄在 `~/.local/share/woowtech-smart/logs/usage-off.md`，log 在同目錄的 `usage-off-*`。
  - 先紅後綠：實作前，server 的 fork 測試 2 紅 4 綠（OFF 基線的 service 和 RPC 都拿到 stub 與 Claude 的用量，fetcher、鑰匙圈 stub 和 fetch stub 都被叫到）；App 的 meter 測試 tooltip 多出「ClaudeMax 20xSession42%」，visibility 測試還沒有模組；兩個守門 13 個紅 5 個。實作後 server 32 檔 421/422、App 4 檔 47/47、守門 13/13；`format:check`、改到的檔的 lint、server 和 App 的 typecheck 都通過。
  - server 唯一的紅是 `omp/agent.diagnostic.test.ts`：它斷言診斷輸出不含 `.pi/agent`，這台 Mac 的 PATH 有 `~/.pi/agent/bin`。9/25 的 main 一樣紅，跟這次改動無關；PATH 拿掉那一段後 5/5。
  - 突變（`usage-off-mutation.sh`，每個之後從 HEAD 還原，最後樹是乾淨的）：
    - 政策改回 true：daemon 守門紅，fork 測試 5 紅（OFF 基線 3 個，Pi、OMP 的計數測試也斷言政策是關的）。
    - service 的預設改成打開：守門紅，fork 測試 OFF 基線的 service 和 RPC 紅。
    - meter 換回上游：App 守門紅，meter 測試紅（tooltip 又出現方案卡）。
    - 設定清單和路由換回上游：App 守門紅。
  - 最終驗證（`8dfa03bd2`）：`build:server` 通過；全部 `woowtech/*.test.mjs`（比照 CI 略過 zh-TW 重新產生那一個）150/150；server 32 檔 421/422（同上，只有 OMP 診斷那一個）；App 4 檔 47/47。
  - 沒跑：Playwright（`woowtech-provider-usage-hidden.spec.ts`、`settings-host-page.spec.ts`）和實機，見「接下來」的第 23 節那一項。
- F11 驗證輪（2026-09-29，整合分支 `woowtech/integration-0929` 的 `b8c8f4954`，第 3、16、18、22 節與「上游同步紀錄」第三批）：main `ea9f49e49` 加上 F11 Claude 補強（`woowtech/f11-b` 的 10 個 commit，含 pi 在 `woowtech/pi-fixes-4` 的 2 個）、上游第三批（`woowtech/upstream-picks-0929` 的 15 個）和整合分支自己的 6 個（兩次合併、徽章那節改成第 22 節、合併 F11 驗收發現的 D1～D3 修正、首次點通知修正 `7ccdd372e`、CI 的 heap 設定 `b8c8f4954`），共 31 個 commit、115 檔（+7021／−420）。沒有刪檔和二進位檔，依賴只多 server 的 undici，版本都是 0.8.0，金鑰掃描沒有真的金鑰。每一步的步驟紀錄和證據在 `~/.local/share/woowtech-smart/logs/integ0929-*`（`integ0929-<步驟>.md`）、`fix-first-tap*` 和 `first-tap-real*`，截圖在 `~/.local/share/woowtech-smart/shots/` 底下同樣的前綴。
  - 本機（`env -i`、只准連 loopback 的 sandbox）：
    - 合併（`integ0929-merge.md`，`06bf83240`）：守門 134/134，照 CI 拿掉 OpenCC 那一項後 133/133；CI 契約 28/28；typecheck app、server、client、cli、desktop 各一次，三次 commit hook 的 11 個 workspace 也過；App 117 檔 1453/1453；server 非 Claude 的 67 檔 1541/1542、1 略過；Claude provider 36 檔 506/506（假 claude 只回 `--version`）；protocol 218/218；CLI 15/15；`format:check` 4718 檔、lint 100 檔 0 個 warning、0 個 error。沒過的 1 個是 `provider-availability` 的「Codex Microsoft Store」：Homebrew 的 node@22 複製到別的資料夾後載不到 libnode，給 dyld 路徑就 6/6，受測程式沒改，CI 用官方的 Node，不受影響。main 和 f11-b 都新增了第 21 節，`06bf83240` 把徽章那節改成第 22 節。
    - 合併 D1～D3 的修正（`integ0929-fixmerge.md`，`b828b79c5`）：守門 136/136；server 的 F11 8 檔 95/95、`agent.test.ts` 84/84；App 7 檔 65/65；typecheck server、app，`format:check`、lint 通過。
    - 最終 head `b8c8f4954` 的守門 138/138（`integ0929-repair-guards.log`、`integ0929-review-r3-guards.log`）。
  - CI（`integ0929-ci3.md`、`integ0929-ci3-final.txt`、`integ0929-gate.md`）：[run 36542041624](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36542041624) 是第 9 次，手動、不勾 Playwright，commit `b8c8f4954`，成功。
    - 第 1 次 attempt 從建立（08:19:56Z）到最後一個 job 結束（08:58:39Z）約 38 分 43 秒，只有 cli-tests（shard 3/3）失敗：1 個失敗、314 個通過。`lifecycle.e2e.test.ts:368` 一看到 `paseo.pid` 就 `JSON.parse`，上游的 `writeNewPidLock` 先建空檔再寫入，讀到空檔就是「Unexpected end of JSON input」。這是上游測試的 race，這個分支沒改那個測試和 pid lock。attempt 2 只重跑這個 job，09:49:44Z～10:01:22Z（11 分 38 秒）通過。
    - 最後 18 個 job：12 個成功；Windows 兩個（沒開 `vars.WOOWTECH_CI_WINDOWS`）和 Playwright 四片照設計略過，不算通過；沒有失敗。最久的是 desktop-tests（ubuntu）38 分 14 秒、server-tests（ubuntu）14 分 41 秒、cli-tests（shard 1/3）14 分 37 秒。
    - typecheck 的「Check woowtech fork guards」成功，59 秒（08:23:14Z～08:24:13Z）。這一輪只准下載失敗 job 的 log，所以沒有取得 CI 上的測試數。`changes` job 的 Validate CI contracts 也成功。
    - desktop-tests 的「Build Linux desktop artifacts」13 分 26 秒成功。CI #8（run 36533790263，`7ccdd372e`）在這一步用完 heap，其他 11 個 job 通過；owner 同意加 4 GB（第 18 節）後再跑一次完整 CI，就是這一次。同一個 job 的「Run desktop browser E2E」2 分 33 秒成功。
  - 真的 Claude（owner 在 2026-09-29 授權）：Claude Code 2.1.284、訂閱登入。daemon 用 `env -i`、真的 HOME（claude 要讀登入）、暫存的 PASEO_HOME 和 scratch repo，不設 API key，claude 的指令加 `--strict-mcp-config`（R2 例外）。共 6 個回合，Claude Code 工作階段檔裡的 `mcp__` 呼叫都是 0：
    - `integ0929-real-desktop.md`（打包 `b828b79c5`）：R3 用 Sonnet 5.5（`claude-sonnet-5-5`）1 個，回「ok」，SDK 估算 0.0619596 USD。R2 用 Haiku 4.5（`claude-haiku-4-5`）1 個：daemon 用 Dock 式的最小 PATH，從 `~/.local/bin/claude` 備援找到 claude，經本機代理第一次下載 SDK 0.3.246，回「ok」，0.0215864 USD。R1 只跑 `--version` 和 `auth status`。
    - `integ0929-real-android.md`（`b828b79c5`）：Haiku 4.5 2 個，背景約 199 秒後的權限推播，接受後執行 Bash 的 `touch`，0.0251732、0.018481 USD。
    - `first-tap-real.md`（`b8c8f4954`）：Haiku 4.5 2 個，複驗首次點通知修正。這一步沒記 SDK 的費用，token 是 in 18／out 554 和 in 18／out 322。
    - 有記的 4 個回合 SDK 估算共約 0.127 USD。訂閱登入時這是 SDK 算的估計值，不是帳單。
    - 偏離（owner 已知悉）：`integ0929-desktop` 的 GUI 第一次啟動時，daemon 的探測執行了真的 claude 的 `--version`、`auth status`（0 回合，HOME 是暫存的），之後改成 `env -i` 加上明確的假 claude 重做。R2 為了走備援不設 command，不能加 `--strict-mcp-config`，owner 的 user-scope MCP 被載入，home-assistant 經代理找 pypi.org 被擋，沒有 `mcp__` 呼叫。
  - 首次點通知修正（`7ccdd372e`，第 16 節「配對後第一次點通知」）：`integ0929-real-android` 的 run 1 發現（高）：配對第一台主機後，第一次點權限通知停在主機首頁，root stack 是 `[welcome, open-project, *open-project]`；mock 也重現，App 冷啟動後正常。原因是上游歡迎頁「主機上線就轉頁」的 effect，不是回歸。
    - 測試（`fix-first-tap.md`）：修之前 11 個 2 紅（`fix-first-tap-red.json`），修之後 11/11（`-green.json`）；拿掉修法時 vitest 2 紅、守門紅，依賴拿掉 `isFocused` 時守門紅，還原後跟開始時相同（`-mutation.log`）。App 17 檔 271/271、protocol 152/152、App typecheck、`format:check` 4722 檔、守門 137/137。
    - Android 模擬器：mock（`fix-first-tap.md` 的 run 1）背景 201.6 秒後點通知，15.9 秒出現 agent 分頁、27.3 秒出現計畫卡，stack 是 `[welcome, *h/[serverId] → workspace]`。真的 Haiku（`first-tap-real.md` 的 R1、R2，每次都 `pm clear` 後重新配對）背景 201.4、208.7 秒，點後 2.8、5.5 秒 router 已在工作區、之後沒被換掉，agent 分頁 53.8、51.8 秒，授權卡 87.5～115.5、85.6 秒，接受後檔案建立。S1（mock）錄影 1233 格，沒有「工作區不可用」。
    - 慢的原因是這台 Mac 當時的記憶體壓力（swap 6.6～7.2 GB、load average 約 9）：daemon 都在毫秒內回，慢在 App 的 JS。正常負載下要再量一次。`fix-first-tap` 的 run 2 和 S1 沒做完（WOOW-BUILD 在 16:15 卸載），由 `first-tap-real` 補上；它留下的 adb server 和暫存由協調者清掉（`integ0929-coordinator-cleanup.txt`）。
  - 平台矩陣（逐項結果表在各步驟紀錄的最後，「未測」都寫了原因）：
    - Mac 桌面版（`integ0929-desktop.md` 打包 `06bf83240`、用假 claude；`integ0929-real-desktop.md` 打包 `b828b79c5`）：未簽章、`--dir`、arm64。通過：app.asar 有 undici、沒有 SDK，SDK 的載入、下載和修復模組都在；Claude 標誌的路徑資料 0，沒有 `wrangler*.toml`、relay.paseo.sh；Dock 式的最小 PATH 從 `~/.local/bin` 找到 claude，PATH 和手動指令優先，裸名不備援，不可執行的檔跳過；登入狀態在 CLI 的 11 種情況和 GUI 的淺色、深色、英文都對，也不外洩；未登入時建立 agent 不被擋；代理走 `CONNECT registry.npmjs.org:443`，`NO_PROXY` 直連；壞的 SDK 副本移到 quarantine 後重新下載；徽章在挑選器、設定和 agent 分頁的淺色、深色；R1 顯示「已使用 Claude 訂閱登入」，email、組織名稱和 id 在診斷、snapshot、daemon.log、PASEO_HOME 和頁面裡都是 0；第三批的 Sonnet 5.5、相對時間、串流縮排、分頁提示框的整句繁中。第一次不通過、已修：D1 SDK 下載錯誤在時間軸顯示英文原文（`7a18b6005`）；D2 Opus 5.5 這類支援 fast mode 的模型，下一則不重試、第三則才重新下載（`68dd77afb`）。`b828b79c5` 的包複驗 D1（繁中、英文）和 D2（Opus 5.5 的 GUI 和 CLI、Sonnet 5.5 的 CLI）都通過。部分通過：重啟後的主機版本（版本號改變只在 iOS 驗）。未測：分割窗格的子 Agent、自訂 Codex、OpenCode thinking、背景 `send_agent_prompt`、外掛重載（要真的 provider 或子 Agent）；R1 的全螢幕截圖（TCC 不讓這個工作階段錄製螢幕）。最終 head 沒有重新打包：`b828b79c5` 之後出貨的程式只有歡迎頁的修正，守門重掃了 `b828b79c5` 的包（`integ0929-gate-pkg2.txt`）。
    - Android 模擬器（`integ0929-android.md` 在 `06bf83240`，`integ0929-real-android.md` 在 `b828b79c5`）：沿用 Debug APK，JS 從這個分支的 Metro 載入。通過：徽章的淺色、深色；登入狀態的繁中、英文和重新整理；未登入時建立 agent 不被擋；上一輪未測的斷線檔案總管「主機未連線」；第三批的 Sonnet 5.5、相對時間、串流，T1 的 S1、S3；背景約 199 秒後的權限推播「需要你的授權」送到模擬器，推播和 relay 不帶 prompt 或指令，App 冷啟動後點通知 8.6 秒開出 agent、12.7 秒出現授權卡，接受後檔案建立。第一次不通過、已修：D3 手機的 Claude 列沒有「需要登入」、圓點沒有無障礙文字（`676ef9f93`），`b828b79c5` 複驗繁中、英文通過；配對後第一次點通知（見上）。部分通過：重啟後的主機版本。未測：提交清單的相對時間（沒有領先 base 的提交，iOS 補了）；D1、D2（dev daemon 從 node_modules 載入 SDK，不會下載）。
    - iOS 模擬器（`integ0929-ios.md`，`06bf83240`）：沿用 Debug 建置，不重建，通知用 `simctl push`。通過：徽章的淺色、深色；登入狀態、重新整理、診斷的 Auth 行；未登入時建立 agent；第三批的 Sonnet 5.5、相對時間（含提交清單）、串流、daemon 重啟和升級後的主機版本（v0.8.0 換成 v0.9.1，不用重開 App）、T1 的 S1（點擊到分頁約 1.1 秒）和 S3。不通過：D3，同 Android，修正沒在 iOS 複驗。未測：首次點通知修正、真的 Claude、D1、D2。
  - 審查與合併前守門（`integ0929-review.md`、`integ0929-repair.md`、`integ0929-gate.md`）：審查的 blocker 1 個：merge 步驟的 4 個 log 有 owner 的 email（git 提交身分，9 處），`integ0929-repair` 遮掉後，重新審查 blocker 0。守門第一次 no-go：內建碟在 20:47 低於 3 GB；`fix-first-tap` 留下 adb server 和含 token 的暫存；`first-tap-real` 的真 Claude 要 owner 本人確認；ship 的規則沒寫 NODE_OPTIONS。殘留清掉、owner 確認之後，第二次只因磁碟 no-go（21:20～21:33 別的工作階段的模擬器讓 swap 長到 12 GB，最低剩 2.28 GB），第三次 go。
  - 發現、還沒修：
    - 上游 `lifecycle.e2e.test.ts:368` 的 race（見上面的 CI）：改成輪詢到 JSON 能解析，再回報上游。
    - 上游的用量頁和 composer 的 context 圓環 tooltip 會讀 macOS 鑰匙圈的「Claude Code-credentials」、不看 HOME，拿到就呼叫 api.anthropic.com。這台 Mac 上任何測試 daemon 都可能用到 owner 的 Claude 帳號，這一輪刻意不開。2026-09-29 已關掉，見第 23 節。
    - `config.json` 的 claude 只能整個取代 command（會關掉備援），不能只加參數；dev 限定的 mock、mock-slow 在 config 裡關不掉。
    - 切換 App 語言後，設定頁的主機跳回第一台；在外觀換主題後，設定頁又跳出「新增連線」sheet。
    - 兩台主機時「從主機匯入」的搜尋框寫死英文「Search hosts...」，兩台同名時副標題顯示完整 server id；zh-TW 有兩處把 Agent 譯成「代理」；VoiceOver 念英文的「Filter: 全部」和側欄工作區的狀態；iPhone 17 的排程列第三行被截斷。
  - 要實機、正式簽章或公司網路才驗得到的：
    - 手機實機：iOS 的 APNs／FCM token 登記和推播送達、Android 實機的推播和點擊（這一輪都是模擬器）；首次點通知修正在實機上的點擊和正常負載下的時間（iOS 連模擬器都還沒驗）；徽章在 12～20 px 讀不讀得出來；VoiceOver、TalkBack 念不念得出「需要登入」。
    - 正式簽章：桌面版 Developer ID 簽章與公證（這一輪都是未簽章的 `--dir`）後的通知授權和自動更新，從 Dock 實際開正式版時的 claude 備援和 SDK 第一次下載；Android 正式簽章版（EAS `production`）；TestFlight 的 production APNs。
    - 公司網路：真的公司代理、SDK 鏡像站和 `NODE_EXTRA_CA_CERTS`，這一輪只有單元測試和本機代理。
  - 待 owner 決定：深色主題「Claude」（#D97757）要不要改名換色、其他廠商的標誌（第 22 節）；用量頁要不要改成看 `CLAUDE_CONFIG_DIR` 或 HOME，或改成選用（2026-09-29 決定先關掉，第 23 節）；config 要不要能只加參數（例如 `strictMcpConfig`）；「上游同步紀錄」第二、三批延後和不拿的 commit。Playwright 這一輪照 owner 的決定沒跑，仍在「接下來」。
  - 「接下來」的 CI fork 守門步驟就是上面的 CI，已從清單拿掉。

- 定向輪驗收（2026-09-28～29，整合分支 `woowtech/integration-0928` 的 `8985ff2a7`，第 6、7、14、16、21 節與「上游同步紀錄」的 OSC 8 查證）：main `f272fc8b6` 加上 `woowtech/fixes-0928`（`b7bd33075`，7 個 fork commit）和刪掉 `with-localized-app-name` 外掛的 `8985ff2a7`，共 9 個 commit、41 檔（+2008／−344）。只驗 fixes-0928 改到的五項：F1 繁中、F2 App 名稱的 locales 分平台、F3 附件撐過重連、F4 OSC 8、F5 S1 的「工作區不可用」閃爍；pi 的 F11 不在這一輪。每一步的步驟紀錄和證據在 `~/.local/share/woowtech-smart/logs/integ0928-*`（`integ0928-<步驟>.md`），截圖在 `~/.local/share/woowtech-smart/shots/integ0928-*`。
  - 本機（`integ0928-merge.md`，`env -i`、只准連 loopback 的 sandbox）：守門 123/123；typecheck app、server、client、cli、desktop 各一次，commit hook 的 11 個 workspace 也過；App 57 檔 672/672，含 T1 203、路由 119、fixes-0928 改到的 4 檔 34；client 的 `daemon-client` 138/138；server 33 檔 537/537；protocol 180/180；CLI 15/15；`format:check` 4681 檔、lint 38 檔 0 個 warning、0 個 error。`.github/` 沒動，版本都是 0.8.0，金鑰掃描 0 筆，沒有二進位檔。
  - CI（`integ0928-ci.md`）：[run 36374983426](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36374983426) 是第 7 次，手動、不勾 Playwright，commit `8985ff2a7`，成功，總時長 37 分 23 秒。有執行的 12 個 job 都過，最久的是 desktop-tests（ubuntu）36 分 58 秒和 server-tests（ubuntu）14 分 50 秒；測試報告裡 server 5929 個、desktop 401 個、App 5586 個通過，沒有失敗。Windows 兩個（沒開 `vars.WOOWTECH_CI_WINDOWS`）和 Playwright 四片照設計略過，不算通過。12 則 annotation 都是 Node.js 20 淘汰警告。
  - 平台矩陣（逐項結果表在各步驟紀錄的最後，「未測」都寫了原因）：
    - Android 模擬器（`integ0928-android.md`、`integ0928-repair.md`、`integ0928-gatefix-android.md`）：原生只差中文名稱資源，沿用上一輪的 Debug APK，JS 從這個分支的 Metro 載入。通過：連線後推播剛好登記一筆，T1 的通知經 push.woowtech.io 和 FCM 真的送到模擬器，重裝後舊 token 回 410、daemon 撤銷；F5 的 S1 三次逐格都沒有「工作區不可用」（上一輪 0.61–0.78 秒），S2、S3、S4、S5 沒有退步，真的刪除兩種（專案被刪、主機不認得的工作區 id）最後停在「工作區不可用」、內文繁中；同一個 App 行程 S2、S3、S3b 加側欄切換，沒有工作區加開或聚焦 S2 的 agent；F1 的側欄「排程」、排程頁、表單、頻率選單、cron 錯誤、「剛剛」、「線上」、「工作了 N 秒」、「工作區不可用」的內文；F2 prebuild 後 `values-b+zh+Hans`、`values-b+zh+Hant` 只有 `app_name`，不略過 lint 的本機 `:app:assembleRelease` 18 分 29 秒建置成功（`lintVitalRelease` 有執行、0 個錯誤），aapt 的 zh-TW 標籤是「渥屋智能 Debug」；F3 三種情境（repair 用同一個 commit、APK、AVD 和檔案重跑）：挑選器開超過 lease、daemon 斷線後選 14.2 MB 的檔，重連後約 26 秒傳完、內容相同，挑選器開 27 秒也正常，主機回不來時約 62 秒後出現繁中錯誤。主輪的 F3 第一種不通過：當時 memory free 30–34%、swap 在長，上傳約 190 KB/s，60 秒逾時只傳了 11 MiB，附件消失；repair 判定是環境加上上游整個檔案共用一個 60 秒回應逾時，不是這個分支的回歸。未測：斷線檔案總管的「主機未連線」（模擬器兩次在 memory free 約 30% 時當掉；同一份 JS 在 iOS 和桌面版通過）。
    - iOS 模擬器（`integ0928-ios.md`、`integ0928-gatefix-ios.md`）：不重建，沿用 `b103338e7` 的 Debug 建置（iOS 原生沒變），JS 從這個分支的 Metro 載入，通知用 `simctl push`。通過：F2 prebuild 後 zh-Hans、zh-Hant 的 `InfoPlist.strings` 仍是 `CFBundleDisplayName`、`CFBundleName`，跟上一輪的 prebuild 逐位元相同；F5 的 S1 兩次逐格都沒有「工作區不可用」（上一輪 0.33、0.32 秒），S2、S3、S3b、S4、S5 和真的刪除兩種；F1 的排程頁、表單、頻率選單、10 種 cron 錯誤、「剛剛」、「線上」、「工作了 N 秒」、「工作區不可用」的內文、斷線檔案總管的「主機未連線」；F3：挑選器開 144 秒後選檔，2 秒傳完、內容相同；挑選器開著時停掉主機、主機不在時選檔，主機回來後上傳完成、內容相同；主機回不來時約 61 秒後出現繁中錯誤。iOS 的文件挑選器在 App 行程裡，App 一直 ping，daemon 的 lease 不會到期，所以「挑選器開超過 lease」做不出來，用停掉主機代替。S3 切回的觀察：通知第一次打開 App 還沒開過的已知工作區時聚焦被推的 agent，從側欄切走再切回，改成顯示工作區原本那個「需要注意」的 agent。main `f272fc8b6` 和 Android 都重現：上游 `navigateToWorkspace` 沒帶目標時由 `pickAttentionAgent` 挑 agent（上游測試 `navigation.test.ts` 的「focuses the attention agent's tab when a workspace has one」），不是這個分支造成。
    - Mac 桌面版（`integ0928-desktop.md`）：從這個分支重新打包，未簽章、`--dir`、arm64。通過：靜態檢查（app.asar 沒有 `wrangler*.toml`、沒有 relay.paseo.sh、Claude Agent SDK 不在 app.asar、SDK 載入器在）；F1 的 `<html lang="zh-TW">`、排程頁、表單、cron 錯誤、排程列「剛剛」、暫停與刪除確認、「線上」、「工作了 N 秒」、斷線檔案總管的「主機未連線」；F3：上傳到一半重啟 daemon，重連後自動重送，uploads 只多一個檔、SHA-256 相同，原生開啟面板開約 63 秒後選檔正常，主機回不來時 60.1 秒後出現繁中錯誤。F4 記為上游限制、不算不通過：剛印出的 OSC 8 連結點下去交給我們的開啟器；切到別的工作區再回來，daemon 收到 1 次 `subscribe_terminal_request`，連結變成實線、點不開，純文字網址照常；只切到別的 App 再回來不會重新訂閱，連結仍可點。
  - 審查與合併前守門（`integ0928-review.md`、`integ0928-gate.md`、`integ0928-gate2.md`）：第二次審查 blocker 0。第一次守門 no-go：缺 Android 的 S3b 與側欄切換和 F2 Gradle 建置，iOS S3 切回的原因不明，另有兩項流程偏離（owner 已接受）。補證（`integ0928-gatefix-android.md`、`integ0928-gatefix-ios.md`，Android 另補了 F1）之後，第二次守門 go。
  - 發現、還沒修：F3 最後失敗時三個平台都只跳約 3 秒的 toast，待上傳的附件同時被移除（第 21 節「還沒做」）；整個檔案是一個 `file.upload.request`、回應只等 60 秒（上游），連線慢時會逾時，逾時不算連線中斷、不會重送；重連時會短暫出現「無法連線」畫面（Android 每次約 0.2–0.8 秒、iOS 不到 0.04 秒），錯誤原文是英文的「Transport closed (code 1006)」「Stream end encountered」；桌面版 daemon worker 重啟後終端機分頁不見（重啟確認只說 Agent 會繼續執行），內建 daemon 停掉後主機頁的「重啟」停用、也沒有「啟動」。
  - 要實機或正式簽章才驗得到的：iOS 真的 APNs／FCM token 登記、推播送達、第二次啟動重新登記、TestFlight 的 production APNs 和正式版冷啟動；Android 正式簽章版（EAS `production`）在實機上的推播與點擊，這一輪的 F2 是本機 development 設定（`io.woowtech.smart.debug`）的 release 建置，沒有裝到模擬器；兩個平台正式版的中文名稱「渥屋智能」（這一輪只看了 Debug 版）；F3 在真的手機網路上的上傳速度（模擬器的速度跟著這台 Mac 的負載走）；桌面版 Developer ID 簽章與公證後的通知授權、橫幅、點擊與自動更新。上一輪列的其他實機項目（例如相機掃配對 QR Code）不變。不綁實機、還沒做的：Android 的「主機未連線」；CI 手動勾 Playwright 完整跑一次。

- 合併輪驗收（2026-09-27～28，整合分支 `woowtech/integration-0927` 的 `b103338e7`，第 16、20 節與「上游同步紀錄」）：main `a6d169ee3` 之後 126 個 commit，三條線一起驗。每一步的步驟紀錄和證據在 `~/.local/share/woowtech-smart/logs/integ0927-*`（`integ0927-<步驟>.md`），截圖在 `~/.local/share/woowtech-smart/shots/integ0927-*`。
  - 三條線：T1 通知路由（第 16 節），含 directory-sync 的 race 修正、三輪審查和 S3 open-intent 修正 `885ee8790`；metadata 政策（第 20 節），commit 與 PR 的 AI 產生關閉，守門另外抓複合、反射、解構和參數預設值的覆寫；挑選式上游同步 `836f1a9..d7b7016cc`，95 個 `cherry-pick -x`、`d8dd189b9` 的部分移植和 11 個 fork commit。合併 `24d70ea89` 沒有衝突，`b103338e7` 刪掉 #5079 合進來後照預期變紅的 T1 標籤見證。跟 main 比 464 檔、+24550／−4822，沒有二進位檔，`.github/` 沒動，金鑰掃描 0 筆。
  - 本機（`integ0927-merge.md`，`env -i`、只准連 loopback 的 sandbox）：守門 122/122；typecheck app、server、cli、desktop 各一次，commit hook 的 11 個 workspace 也過；App 38 檔 445/445（T1 203、路由 119、fork 推播／配對／relay／metadata 123）；server 33 檔 537/537；protocol 180/180；CLI 15/15；`format:check` 4675 檔、lint 401 檔 0 個 warning、0 個 error。
  - CI（`integ0927-ci.md`）：[run 36313608117](https://github.com/WOOWTECH/woowtech-smart/actions/runs/36313608117) 是第 5 次，手動、不勾 Playwright，commit `b103338e7`，成功，總時長 37 分 57 秒。有執行的 12 個 job 都過，最久的是 desktop-tests（ubuntu）37 分 32 秒和 server-tests（ubuntu）15 分 11 秒。Windows 兩個（沒開 `vars.WOOWTECH_CI_WINDOWS`）和 Playwright 四片照設計略過，不算通過。12 則 annotation 都是 Node.js 20 淘汰警告。
  - 平台矩陣（逐項結果表在各步驟紀錄的最後，「未測」都寫了原因）：
    - Android 模擬器（`integ0927-android.md`）：原生沒變，沿用 main `1f4b2b00f` 的 Debug APK，JS 從這個分支的 Metro 載入。通過：官網連結、繁中用語、配對連結的主機名稱、確認框的「取消」、commit「Update files」與命名關閉；T1 的 S1 三次、S2、S3 兩次加側欄切換、S4、S5（S1 仍閃 0.61–0.78 秒「工作區不可用」）；推播經 push.woowtech.io 和 FCM 真的送到模擬器，換成 English 後只收到 1 則英文通知；Claude 授權推播（1 個 Haiku 回合），通知只有「需要你的授權／點一下查看要求。」；release 建置（`assembleRelease`、debug 簽章）冷啟動點通知開到被推的 agent，沒有 dev launcher；daemon 啟動韌性 3 項（空 pid、非排程檔、BOM）。不通過：OSC 8 連結。未測：PR（要 GitHub 與 gh）、多選問題的「其他」、舊 PID 與 `daemon.log` 寫不進去（桌面版、iOS 驗了）。
    - iOS 模擬器（`integ0927-ios.md`）：Debug 重建，xcodebuild 16 分 02 秒。通過：官網連結、繁中用語、Expo 登記停用（4 次啟動都沒有「Failed to turn off Expo push registration」，exp.host 0 次）、配對連結的主機名稱、確認框的「取消」、commit「Update files」、daemon 啟動韌性 5 項；T1 的背景新工作區兩次（閃 0.33、0.32 秒「工作區不可用」）、同一連線的第二個新工作區、已知工作區、重裝後、S3 加側欄切換、冷啟動；英文主畫面名稱：標籤取 CFBundleDisplayName，正式版的「woowtech smart」完整顯示，Debug 的「woowtechsmart…」是截斷時拿掉空格。不通過：OSC 8 連結。未測：真的推播（模擬器拿不到 APNs／FCM token，T1 用 `simctl push` 只驗點擊導頁）、PR、多選問題的「其他」、上週日期（模擬器時鐘跟 Mac 走）。
    - Mac 桌面版（`integ0927-desktop.md`）：從這個分支重新打包，未簽章、`--dir`、arm64。通過：靜態檢查（沒有 relay.paseo.sh、名稱、bundle id、URL scheme、SDK 不在 app.asar）、新 home 的 relay 開啟、官網連結、繁中用語、確認框的「取消」、通知標題（繁中與 English）、命名不呼叫 provider、commit「Update files」、配對 QR、快捷鍵 3/3、daemon 啟動韌性 5/5（含舊 PID、`daemon.log` 寫不進去）、ACP 的 / 選單（`513f2a9ea`）、`e68553f75`。不通過：OSC 8 連結。測試通知只出現「通知顯示失敗」那一態：未簽章的版本 macOS 不詢問就拒絕通知授權。未測：PR、上週日期、封存與恢復、多選問題的「其他」。
    - 上傳的原檔名（`fbc83613c`）三個平台都通過；訊息日期（`28507224d`）只在 Android 驗過。
  - 審查與合併前守門（`integ0927-review.md`、`integ0927-gate.md`）：blocker 0，結論 go。不通過的只有 OSC 8（`dc9799f6f`，三個平台都點不開，純文字網址正常）。app.asar 沒有 undici 是測試預期不符：代理下載的修正在 pi 的分支，還沒合進來。
  - 發現、還沒修：Android 的檔案挑選器開超過約 50 秒再選檔，附件上傳失敗後無聲消失；本機 `assembleRelease` 不略過 lint 會失敗，因為 prebuild 把 iOS 的 CFBundleDisplayName、CFBundleName 寫進 Android 的中文資源（eas.json 都略過 lint）；繁中畫面還有英文：主機狀態「Online」、「工作區不可用」畫面的內文、「just now」、桌面版的「計畫」頁。
  - 要實機或正式簽章才驗得到的：iOS 真的 APNs／FCM token 登記、推播送達、第二次啟動重新登記、TestFlight 的 production APNs；iOS 正式版冷啟動（Debug 點通知冷啟動，啟動畫面之後約 3.5 秒全白）；Android 正式簽章版（EAS `production`，`e3c853df5` 改過 gradle 指令）在實機上的推播與點擊，這輪的 release 建置用 debug 簽章；兩個平台用相機掃配對 QR Code；桌面版 Developer ID 簽章與公證後的通知授權、橫幅、點擊（另外兩種測試通知結果和「需要你的注意」）與自動更新。不綁實機、還沒做的：CI 手動勾 Playwright 完整跑一次；真的重開機後的舊 PID（這輪是模擬的）。
  - 「接下來」的 T1 S3 Android 重驗就是上面 Android 的 S2、S3、側欄切換、S1、S5，已從清單拿掉。

- F11 SDK repair／retry：在 `b103338e7` 新基準重建 server 後，transport、runtime、managed repair、同 session retry、query、rewind、runtime-exit、error mapper、copy 九個定向檔合計 88/88，SDK 守門 5/5。測試使用隔離 HOME／CLAUDE_CONFIG_DIR／PASEO_HOME 與本機 synthetic SDK，沒有執行真 Claude 或外部下載；既有與新 generation 的相對依賴失敗快取、一次修復上限、pointer／symlink 邊界、失敗後下一則訊息和不重送舊提示均有定向案例。完整 typecheck 由提交 hook 另驗；GUI、公司代理與實際 asar 留待整合驗收。

- T1 S3 修正（2026-09-27，整合分支 `woowtech/integration-0926`，第 16 節 T1 S3）：
  - 紅：新測試的路由先照上游的讀法（合併的 params），7 個裡 3 紅、原因跟裝置一樣：S3 的工作區收到通知的 agent 之後又收到 S2 的 agent（pin 在後，等於聚焦它）；換到別的工作區收到 S2 的 agent，回到 S2 的工作區又收到一次；從 Open Project 點的 terminal 換工作區時跟過去。S2 和見證綠，見證的主機路由 params 跟 `logs/ultra-device-s3b.txt` 的 navstate 一樣。守門對上游的 `index.tsx` 紅在「must not read useGlobalSearchParams」。
  - 綠：`index.tsx` 改讀自己的 params、路由讀法跟著改之後，新測試 7/7、守門 1/1。
  - 突變（都照備份還原，`shasum` 相同）：只把 `index.tsx` 改回上游，守門紅、新測試 7/7（它不讀 `index.tsx`）；`index.tsx` 和測試的路由讀法一起改回合併的 params，守門紅、新測試 3 紅（同紅燈）；reader 丟掉所有意圖，新測試 4 紅（reader、S1、S2、terminal）。
  - 逐檔跑：新測試 7/7；既有的 11 個檔 239/239（`workspace-route-navigation`、`host-runtime-bootstrap`、`workspace-deck-retention`、`host-routes`、`notification-routing`、`notification-routing.woowtech-push`、導覽 store 的 `navigation`、`navigate-to-agent/resolve`、T1 的 `missing-workspace-directory-demand`、`directory-sync`、`host-runtime`）；`node --test woowtech/*.test.mjs` 122/122；App 的 typecheck、format（含 `format:check`）、lint 通過。沒跑 build、全套測試、裝置或模擬器，也沒有 fetch 上游。紀錄在 `/Users/elmolin/.local/share/woowtech-smart/logs/t1-s3-open-intent.md`。

- T1 審查修正第 3 輪（2026-09-27，整合分支 `woowtech/integration-0926`，第 14、16、20 節）：
  - 非 race 路徑：審查的突變「`releaseSubscriptions()` 不清已滿足記號」（上游的行）讓原本的 T1 25/25 照綠。新增三個案例：owner 在自己的 refresh 結束後才釋放、同一個連線再開第二個缺工作區路由（標籤關、開各一），以及已刪除或封存的工作區離開再回來。HEAD 綠；這個突變只紅這三個（工作區請求停在 1 次），其餘 27 綠。
  - 上游缺口的見證：假主機加上延後 agent 清單；agents、workspaces 的回覆改成只有帶 subscribe 的請求才開訂閱，跟真的 daemon 一樣（原本 plain fetch 也配訂閱 ID，「沒有 demand 就不訂閱」的修法會被算成剩 2 條，孤兒見證抓不到）。兩個見證都斷言現況，沒用 `it.fails`，因為它遇到任何失敗都算通過。套上 #5079 那一行（`connectionChanged` 裡的 `connectWorkspaceLabels()`）只紅標籤見證；讓 `fetchAgents`、`fetchWorkspaceSnapshot` 沒有 demand 時不訂閱，只紅孤兒見證（剩 0 條）。拿掉 fork 修法（main 的 `index.ts`）時 30 個裡 9 紅：原本 8 個加標籤見證。
  - 合併上游：merge-base `836f1a9c2`，`index.ts` 跟 upstream/main `d7b7016cc`（含 #5394）用 `git merge-file` 合併 0 衝突，fork 的 5 個 `woowtech smart:` 註解都在。用審查建好的 `d7b7016cc` 合併樹（跟 HEAD 不同、沒有衝突的 App 檔 254 個，T1 載入其中 47 個）跑新的 T1：29/30，只有標籤見證紅，符合設計。
  - `git-metadata.test.mjs`：用守門自己的 `policyOverrides()` 探測，兩種解構預設值、改名的解構、參數預設值都沒被標出。先加進應標出的清單（紅），再補解構和參數預設值的規則；另加兩個不應標出的寫法（沒有預設值的解構和參數）。5 個突變（拿掉規則、不看預設值、只看 name、只看 propertyName、不含參數）都紅在第 4 項，identity 綠，production 掃描仍是 []。
  - 不改的：archive／detach 只刪 `cancelLabel` 那一行時，上游的 `archive-subagent.test.ts` 4 紅、`detach-subagent.test.ts` 2 紅，理由寫進第 14 節。
  - 逐檔跑 T1 30/30（連跑 3 次，shuffle seed 11、4242 各一次）、`node --test woowtech/*.test.mjs` 121/121，format（含 `format:check`）、lint 通過。沒跑 build、commit hook 以外的 typecheck、全套測試、裝置或模擬器，也沒有 fetch 上游。紀錄在 `/Users/elmolin/.local/share/woowtech-smart/logs/ultra-fix-round-3.md`。

- T1 審查修正第 2 輪（2026-09-27，整合分支 `woowtech/integration-0926`，第 16 節 T1、第 20 節）：
  - 合併上游的模擬範圍：用 `git merge-tree` 把 HEAD 分別和 upstream-main（`d6861f81e`）、upstream/main（當時是 `bbf8cce3f`；2026-09-27 11:43 fetch 後前進到 `d7b7016cc`，見第 3 輪）合併，`packages/app/src` 底下跟 HEAD 不同、沒有衝突的檔（192／202 個）在 scratch 用 vitest 的 resolve 蓋上去，T1 實際載入其中 38 個。原本的 agent tab 案例在兩棵合併樹都是 23/24，卡在等訂閱歸零（上游 #5040）。改用 `timeline.dispose()` 後，HEAD 和兩棵合併樹都 24/24；三棵拿掉 fork 修法的樹（HEAD 和兩棵合併樹）都是同樣 7 紅，這個案例紅在 race 斷言。「遞增搬到 `setDemand`」突變在 HEAD 和合併樹各紅這一個案例。
  - 失敗後有 owner 加入就重試：新案例「hook 持有時 refresh 失敗，開側欄會重試」先紅（工作區請求停在 1 次），`setDemand` 加上 else 分支後 25/25。拿掉分支、改成釋放時才 refresh 兩個突變都紅這個案例；不看連線狀態的寫法 25/25（在線時等價）。兩棵合併樹 25/25；拿掉 fork 修法的 HEAD 和兩棵合併樹都是 8 紅（原本 7 個加這個）。用 `git merge-file` 合出的 `index.ts` 跑上游版 directory-sync 23/23、host runtime 72/72；HEAD 的 directory-sync 18/18、host runtime 72/72、側欄清單 3/3、`use-projects` 2/2。審查的 fuzz（真實 HostRuntimeStore 上的隨機交錯）1000 個 seed，以及加上失敗注入和專案清單的 1000 個 seed 都綠，單一序列最多 6 次工作區請求（改前 5 次，上限 22 次）。守門第 4 項：拿掉分支、改成只讀 cache、條件不看 `demanded` 三個突變都紅；寫成獨立的 if、不看連線狀態兩種等價寫法照綠；「釋放時才 refresh」守門抓不到，由 vitest 抓。
  - 接線：畫面傳給 hook 的 descriptor-presence 從 `workspaceDescriptor !== null` 改成 `Boolean(workspaceDescriptor)`。改之前，把 `selectWorkspace` 缺工作區時的回傳改成 `undefined` 的突變讓 `selectors.test.ts` 19/19、T1 25/25 都綠，hook 卻永遠不會 acquire；看真值之後就不再依賴 `null`。守門先改期待值（紅），再改畫面（綠）；改回 `!== null`、改成 `!== undefined`、`!!`（等價但字面不同）、固定 `false` 四個突變都紅在第 1 項。hook 自己的 `useEffect` 前加 early return，第 1 輪的守門 3/3 綠；第 2 項補上後，early return、包進 if 區塊、`&&`、try、callback 五個突變都紅，effect 之後的 return 照綠。這個守門的突變連同第 4 項共 20 個，全部符合預期。
  - `git-metadata.test.mjs`：用守門自己的 `policyOverrides()` 探測，`??=`、`||=`、`&&=`、別的物件的 `x.name ?? <fork policy>`、`defineProperty`、`Reflect.set`、computed key、class field、getter 12 種寫法原本都不會被標出。先把其中 9 種，連同本來就會標出、用來守去重的字串鍵，加進應標出的清單（紅），再補規則：複合賦值一律標出、例外只限 `=` 且來源是 `options.<同名>`、字串寫出的 policy 名稱也算（`x["name"]` 的讀取不算）、getter 和有值的 class field 也算，另加 4 個不應標出的寫法（interface 成員、沒有值的 class field、呼叫、用中括號讀）。production 掃描仍是 []，探測的 17 種寫法全部符合預期。守門自身的 9 個突變（只看 `=`、例外不限運算子、例外不限 `options`、拿掉 getter、拿掉 class field、沒有值的 field 也標、拿掉字串規則、中括號讀取也標、拿掉去重）都紅在第 4 項，identity 綠。
  - 上游既有的兩個缺口（第 16 節 T1 新增的兩點）用審查的 race 測試在現行 HEAD 重跑確認：descriptor 先到時，開側欄後標籤請求 0 次、狀態 none，pull-to-refresh 後才 online，agent 清單先到的順序正常；同一個 tick 內 acquire 再 release 三輪，每輪都剩 agents、workspaces 訂閱各一條、events 0，下一個 demand 會換掉，全部釋放後歸 0。只記在 README，不改程式。
  - 逐檔跑 T1 25/25（連跑 3 次，另用兩個 shuffle seed）、directory-sync 18/18、host runtime 72/72、側欄清單 3/3、`use-projects` 2/2，`node --test woowtech/*.test.mjs` 121/121，format（含 `format:check`）、lint 通過。全 glob 有一次在 `coexistence.test.mjs` 出現 node test runner 的「Unable to deserialize cloned data」，單跑 7/7，重跑全 glob 121/121。沒跑 build、commit hook 以外的 typecheck、全套測試、裝置或模擬器。紀錄在 `/Users/elmolin/.local/share/woowtech-smart/logs/ultra-fix-round-2.md`。

- T1 審查修正第 1 輪（2026-09-27，整合分支 `woowtech/integration-0926`，第 16、17、18、20 節）：
  - 合併上游後的同步點：把 HEAD 和 upstream-main 合併出的 `directory-sync/index.ts`、`agent-replica.ts`、`workspace-labels/index.ts` 在 scratch 用 vitest 的 resolve 蓋上去，原測試 19/22，3 個紅都在「標籤請求數到 1」之後（#5079 讓連線時先要一次標籤）。同步點改成 `heldLabelRequests()` 後，現行 HEAD 和這個三檔合併版都 24/24；兩邊拿掉 fork 修法都是同樣 7 紅。這只模擬了三個檔，沒有包含上游 #5040；整個 App 的合併結果是 23/24，更正見第 2 輪。
  - 新增兩個案例：從缺工作區 A 切到 B、A 的釋放讓 refresh 失敗；agent tab 是最後離開的 demand。「只在成功時再 refresh」和「遞增搬到 `setDemand`」兩個突變原本 22/22，現在各紅對應的一個。審查的 13 個 directory-sync 突變全部被抓，identity 對照 24/24。
  - 守門：`workspace-directory-demand.test.mjs` 加 directory-sync 修法的原始碼守門，21 個變體都符合預期：14 個應紅的都紅在新項目、訊息對得上；合併上游版、`++`、條件寫成一行等 5 個應綠；「多一個檢查前的清除」和「只在成功時再 refresh」刻意交給 vitest。`git-metadata.test.mjs` 補簡寫屬性和成員賦值；照字面加成員賦值會把 production `workspace-auto-name.ts` 的建構子接線當成違規，所以只放行 `x.name = options.name ?? <fork policy>`，6 個突變都紅。這一輪的例外其實只比對成員名稱（任何物件的同名成員都放行），也沒檢查 `??=` 這類複合賦值，第 2 輪修正。
  - 逐檔跑 T1 24/24（連跑 3 次）、directory-sync 18/18、`node --test woowtech/*.test.mjs` 120/120，format、lint 通過。`index.ts` 只改註解，沒重跑 host runtime 和側欄。沒跑 build、commit hook 以外的 typecheck、全套測試、裝置或模擬器。紀錄在 `/Users/elmolin/.local/share/woowtech-smart/logs/ultra-fix-round-1.md`。

- T1 race 修正（2026-09-27，整合分支 `woowtech/integration-0926`，第 16 節 T1）：`missing-workspace-directory-demand.test.ts` 新增 8 個案例。先紅的五個：唯一 demand 在 refresh 等標籤時離開後，側欄、第二則通知路由和上游的側欄重開都停在 1 次請求、拿不到新工作區；tab 的 route demand 加入那次 refresh 後剩 0 條訂閱、沒有再 refresh；pull-to-refresh 失敗後 route demand 不 refresh。改 `directory-sync/index.ts` 後 22/22。首次失敗不自己重試、已刪除工作區每個連線一次、訂閱逾時（fake timers 推 60 秒，client 斷線）重連一次，這三個到場就綠，用突變確認會失敗；假主機超過 10 次工作區請求就不回，refresh 迴圈會變成斷言失敗而不是卡住（原本 60 秒被強殺）。offline 案例改成直接斷言請求數：require-online 突變原本 5 秒 timeout，改後 1.1 秒「expected +0 to be 1」。接線守門：舊版放過 if 區塊和 early return，新版對拔掉、if 區塊、單行 if、&&、?:、early return 六種都紅。revert 整個修法或其中任一段、cleanup 不釋放、effect 不回 cleanup、有 descriptor 仍持有、取得後立刻釋放、失敗也記滿足、兩種迴圈，全部 exit 1，每次用 sha256 確認改回原檔。逐檔跑 directory-sync（18、10、5、7）、host runtime 72、timeline replica 14、sidebar（3、3、40）、route（7、10、8）、notification routing（10、4）和 `node --test woowtech/*.test.mjs` 119/119 都綠，format、lint 通過。沒跑 build、commit hook 以外的 typecheck、全套測試、裝置或模擬器；Android 修後驗收仍待排。紀錄與原始 log 在 `/Users/elmolin/.local/share/woowtech-smart/logs/ultra-t1fix.md`。

- C-022 修正與盤點 checkpoint（2026-09-26）：Session 的 ON prompt 測試與通知回饋舊期待先紅後綠；PR 空 body 先以精確期待驗紅，再由真實 CheckoutSession／本機 bare remote／typed forge port 驗綠，手填與部分手填不變。專案設定停用文案與台灣用詞同步守門。已逐檔、單 worker 驗過 15 個 server 檔（509 passed、4 個既有 skip）及 3 個 App 檔（39 passed）；7 個突變均被攔截並還原。較廣的 import／process 可達候選不代表實際走 gate；隔離 loopback／臨時 daemon 與外部 forge／真 provider／Playwright 分開列未執行，不宣稱候選全部綠。清單、原始 log 與限制見 `/Users/elmolin/.local/share/woowtech-smart/coord/reports/C22-test-inventory.md`、`C22-implementation.md`。未跑 build/typecheck、整 workspace suite、外部 API、裝置或程序管理；測試沒有新增 auth skip。

- C-017 review a–g（2026-09-26）：移除 sibling src 型別引用、去除通知描述重複首句、只提高 host-label 首例上限、搬移 F5 OFF/positive-control 到 fork 測試、補 production caller AST 守門、用最新翻譯 ref 維持通知 callback 身分、補子 Agent Cancel 與通用 Confirm 預設。a/b/c/d/f/g 先有預期紅燈；e 注入異地 alias caller 驗紅後刪除，另驗 namespace／間接引用等案例。20 個定向突變均 exit 1 且已還原；還原後 App 定向 51/51、server 3/3、相關 node 守門 14/14，format/lint 通過。上游命名測試相對 `836f1a9` 只多一行 ON 注入。c 的紅燈是 timeout 契約守門，不以 sleep 模擬負載；f 的訂閱穩定性由 source guard 檢查，語言內容另有行為測試。未跑 build/typecheck、完整套件、GUI、裝置或外部服務；h 的 probe wrapper 搬移未做，不影響 a–g。完整命令與原始證據在 `/Users/elmolin/.local/share/woowtech-smart/coord/reports/C17-review-implementation.md`。

- F8-min 停用 commit／PR AI 產生（2026-09-26）：server 先紅，確認預設路徑仍讀 diff、列舉 provider；接 gate 後 fork 行為 11/11、上游 ON 行為 6/6。App copy 先紅後綠 8/8；相關 node 守門 6/6。分別移除 commit gate、移除 PR gate、policy 改 ON、factory 繞過預設 policy，行為測試與守門均 exit 1；production 注入 ON 的突變由接點守門抓到。還原後同組測試全綠。`npm run format:files`、定向 `npm run lint` 與 `git diff --check` 通過；依 C-017 資源限制未跑 build/typecheck、全套測試、裝置／模擬器、真實 provider 或外部 forge。原始紀錄與限制見 `/Users/elmolin/.local/share/woowtech-smart/coord/reports/F8-min-implementation.md`；本切片不含 C-017 第 2 項或 T1。

- F5-min 停用工作區自動命名（2026-09-26）：先紅確認 directory/worktree 仍排程，接入預設 OFF policy 後真實 service 測試 3/3；OFF 的 scheduler、generator、snapshot、instructions、structured generation、設定讀取與命名寫入全部零呼叫，另用明確 enabled 的測試 policy 驗證觀測 ports 能收到呼叫。上游 session 定向 7/7、MCP 定向 5/5，保留原斷言與手動 title 行為；fork 守門 3/3。拿掉 gate、policy 預設開啟、constructor 繞過預設 policy 三個突變都讓 service 與守門 exit 1，還原後 3/3、3/3。實作階段未跑完整套件、build、真實 provider 或網路測試；提交另由既有 hook 執行完整 typecheck。

- F7a 共用取消鈕（2026-09-26）：先紅確認繁中呼叫真正 renderer helper 仍送 Cancel，再改用既有 `common.actions.cancel`；沒有新增翻譯 key。定向 Vitest 4/4、繁中守門新增項 1/1。英文硬編碼、忽略 caller override、空字串 override 被當缺值、固定繁中不隨語言切換四個突變皆 exit 1；英文硬編碼也讓接點守門失敗，還原後 4/4、1/1。format/lint 通過；未跑 build/typecheck、Electron UI 或原生裝置驗收。

- F6 主機補名（2026-09-26）：先紅確認正常 server_info 到達後 label 仍是 serverId；補名後 fork 整合測試 11/11、配對守門新增項 1/1。移除 store 接點、rename 保護、身分檢查、連線世代檢查、hydration gate／補查、持久化、持續監聽、主機世代及卸載接點共 10 個突變均 exit 1；還原後 11/11、1/1。App 測試使用既有 unit 設定，未跑完整配對／host-runtime suite、build 或實機；提交時另由既有 hook 執行完整 typecheck。沒有新 probe 或外部網路。

- F3 追加修正 C-014（2026-09-26，F4 之後）：先紅確認逾時會 close、三態字串被舊布林邏輯當 success，以及缺少三態文案，再修正。生命週期／測試回饋／共用 copy 定向 Vitest 25/25，桌面接點守門 3/3。timeout close、release、late click、late show 清引用、錯誤 settlement、三個 UI 結果、舊布林推定成功、IPC 布林契約、probe 接點、畫面接點、timeout 文案、語言 fallback 共 14 個突變皆 exit 1；還原後 25/25、3/3。未跑 typecheck/build 或 Electron UI，實際 macOS 通知仍待另驗。

- F4 桌面 Agent 通知標題（2026-09-26）：先驗缺少文案 key 與原 sender 仍傳英文的紅燈，再接 renderer reason 翻譯。helper／共用 fork copy 定向 Vitest 11/11、桌面通知守門 3/3；移除接點、移除語言依賴、移除 error 抑制、改 body、讓簡中套繁中五個突變皆 exit 1；還原後 11/11、3/3。format、lint 通過；未驗實際系統橫幅，未改手機推播、protocol 或 daemon。

- F3 桌面通知回饋（2026-09-26）：permission 的 supported→granted、request 的 browser→granted、sender 的 show()→true、unknown 禁止測試四個行為先紅後綠。定向 Vitest 三檔 24/24；fork 接點守門 2/2。送出接點、permission、unknown 按鈕、失敗文案與 show 後清掉 click listener 共五個突變均 exit 1，逐項還原；還原後守門 2/2、生命週期 7/7。審查再補 optional native bridge 的 unknown 邊界、文案確切值／英文 fallback／placeholder 與既有翻譯政策，兩檔 20/20；再做五個突變均 exit 1，還原後 20/20。沒有啟動 Electron、沒有檢驗簽章產物或實際通知橫幅；typecheck 由提交者執行。

- T5（C-007，2026-09-26）：新增專案／主機選擇器文案、繁中 Host 術語完成定向紅→綠驗證；術語、placeholder、主要新增專案文字與主機搜尋選項的突變都被測試擋下並已還原。`node --test woowtech/zh-tw.test.mjs` 檢查產生器同步與技術字保留；定向 Vitest 覆蓋 `add-project-flow/model.test.ts`、`components/hosts/host-picker.test.tsx`、`i18n/woowtech-copy.test.ts`、`i18n/zh-tw.test.ts`。實作階段只跑限定格式／lint，提交另由既有 pre-commit 執行完整 typecheck；未建置、執行完整測試套件或 UI／裝置驗收。iOS、Android 與桌面 Browse 的實際畫面和語言切換仍待獨立驗收。

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
- 三份獨立審查（隱私與 daemon、App 原生、配對與合併）的修正（2026-09-25，分支 `woowtech/push`）：行為改動都先紅後綠，守門和上游接點的新檢查都用突變確認會失敗，改完用備份還原。
  - 紅燈原因：中繼回 307、308 時另一個位址收到 `POST /collect`（含 FCM token），302 收到 GET；App 換語言又換回、兩次撤銷沒送到時，中繼收到 `en`；Android 取 token 也發事件，10 輪註冊 10 次（拿掉比對的突變在「事件先到」時 worker 記憶體耗盡）；iOS 已註冊過時 `getToken` 失敗、兩個訂閱同時要 token 時一個拿到 null、沒有重試、warn 沒有錯誤代碼；沒有 `woowtechPush` 的 daemon 收不到舊 Expo token 的撤銷；`turnOffExpoPushRegistration` 不存在、`index.native.ts` 載入時不呼叫；冷啟動先讀配對連結再 `boot()`，記憶體只剩舊主機、存檔只剩新主機。
  - 守門新增 6 項（`push-content` 2、`push` 3、`pairing` 1），配對掃描多讀 3 個套件；突變都被抓到：拿掉 `send()` 的 `toRemotePushPayload`、拿掉 terminal 推播的 `reason`、schema 或 handler 只收 Expo token、拿掉 `withWoowtechPush`、`useFrameworks` 改 dynamic、`forceStaticLinking` 少 `react-native-paste-input`、plist 改回讀 `variant.googleServiceInfoPlist`、拿掉 Metro 包裝、`OfferLinkListener` 加平台條件或改用 URL 類別或不交給 `handlePairingLink`、plugin／highlight／expo-two-way-audio 的原始碼出現 app.paseo.sh。
  - `npm run build:server` 之後：守門 `node --test woowtech/*.test.mjs` 82/82；第 16 節「合併上游之後」的三條 vitest 指令 protocol 2 檔 177、server 6 檔 72、App 8 檔 59；第 19 節的配對指令 protocol 3、server 12、CLI 3、App 4 檔 84；完整 typecheck 通過；這個分支改過的檔 lint 和排版都乾淨。
  - 沒改的：已存在的 home 的 CORS 白名單（owner 待決定，見「接下來」）。要實機確認的：iOS 第二次啟動拿得到 token（滑掉重開）、冷啟動掃 QR Code 後兩台主機都在。

- CI 第一次執行後的修正（2026-09-25，分支 `woowtech/ci-green`，第 18 節）：新測試和守門都先紅後綠，行為改動都做了突變。
  - format、lint：整個 repo 的 `npm run format:check` 和 `npm run lint` 都乾淨。`readPng` 改寫前後比對 1,029 個輸入，結果完全相同：repo 的 64 張 PNG 用路徑和 buffer 各讀一次、.icns 和 .ico 裡的 15 張，以及合成圖（每種 filter 值、兩種色彩型態、分段的 IDAT、截斷的資料、列數不夠、不支援的格式）。repo 的圖用到 filter 0～4 全部。兩個突變（Paeth 的比較、RGB 的 alpha）分別差 182 和 462 個，比對抓得到。
  - Linux 的桌面版測試：這台 Mac 上把 `process.platform` 設成 linux，12 個失敗照樣重現，ENOENT 的訊息跟 CI 一樣；修完 14 個有 13 個過。剩下的要讀 `/proc/self/status`，把 launcher 裡那個路徑換成假檔手動跑，結果跟測試預期相同。突變：launcher 找 `Paseo`（9 個紅）、Linux 的 CLI 放到 `Resources/`（2 個紅）。Mac 原生：CLI 安裝 5/5，launcher 9 個略過。
  - `desktopName`：`coexistence.test.mjs` 先紅（`'Paseo.desktop'`）後綠 6/6。用 electron-builder 自己的 file transformer 產生打包後的 package.json：改前是 `Paseo.desktop`，改後是 `woowtech smart.desktop`。`desktop-packaging` 11/11。
  - Metro 暖機：`e2e-metro-readiness.test.ts` 先紅（`metroWarmupTimeoutMs is not a function`）後綠 3/3。突變：打包的請求不理設定，紅。
  - app 的 hook 上限：命令列的 `--hookTimeout=1` 沒有作用，hook 仍在 10000ms 逾時；改成變數後設 1 就在 1ms 逾時。這台 Mac 很忙的時候（load average 40～80、swap 用了 5.2/6.1 GB），`input-draft.live.test.tsx` 的 beforeAll 要 35～40 秒，上限放寬後 7/7 通過。
  - `workflows.test.mjs` 新的 4 項先紅後綠，10/10；CI 第一個 job 跑的三個 node 測試 27/27。
  - 跑過的：守門 68 個全過（`node --test woowtech/*.test.mjs`，含 zh-TW）；改過或受影響的 vitest 檔逐一跑；`npm run lint`、`npm run format:check`、`npm run typecheck` 全 repo 通過。
  - 沒跑的：Linux 上的一切和 GitHub 上的執行，當時未驗項目後續狀態見第 18 節「第三次執行已確認」與「仍待確認」。
- `woowtech/ci-green` 獨立驗證（2026-09-25）：
  - 重跑：整個 repo 的 `npm run lint`、`npm run format:check`、`npm run typecheck` 通過，守門 68 個全過。main 的副本 lint 3 個錯、format 2 個檔，跟 run 1 相同。
  - `readPng`：main 版和分支版比對 664 個輸入（repo 的 64 張 PNG、400 張合成圖、200 個壞檔），結果和錯誤訊息都相同；`encodeOpaquePng` 200/200 相同。排版那個 commit 前後的語法樹相同。
  - Linux 桌面版：electron-builder 自己的 `LinuxPackager` 算出執行檔 `woowtech smart`、安裝在 `/opt/woowtech smart`、`desktopName` 是 `woowtech smart.desktop`，跟 after-pack、launcher、`bin/paseo`、CLI 安裝和打包 smoke 用的一致。`process.platform` 設成 linux：main 的兩個測試檔 12 個失敗，分支 14 個過 13 個，剩下的要讀 `/proc/self/status`。
  - `ci.yml`：展開 anchor 後跟 main 只差這 10 處時間設定，觸發和 Windows 的條件沒變。每個變數都有程式在讀，Playwright 和桌面版 renderer E2E 經過 `globalSetup`，lifecycle E2E 在第一次點 Settings；browser E2E 不讀，記在第 18 節。
  - 發現並修正：`vitest.config.ts` 沒設變數時給 10 秒，browser project 的 hook 上限從 vitest 預設的 30 秒變成 10 秒。守門改成請 vitest 解析設定，先紅（browser 10000）後綠；設了變數時兩個 project 都是 120000。
  - 守門突變：`ci.yml` 的設定刪掉或改弱 9 種、`vitest.config.ts` 改回 10 秒或刪掉那行、`electron-builder.yml` 拿掉 `desktopName`，都紅。程式不讀變數、只剩註解提到的 2 種原本抓不到；守門改成只看程式碼後抓得到，`run-all.ts` 讀別的名稱也紅。每次都用 sha256 確認改回原檔。
  - 沒做的：當時未驗項目的後續狀態見第 18 節「第三次執行已確認」與「仍待確認」；run 1 各 job 的時間和原因當時沒有到 GitHub 上核對。
- CI 第二次執行前的三項（2026-09-25，分支 `woowtech/ci-green`，第 18 節）：守門都先紅後綠，都做了突變，每次都用 sha256 確認改回原檔。
  - browser E2E：守門要求 `browser-tabs.e2e.mjs` 的程式碼讀變數，先紅（`ignores the setting`）後綠。突變：改讀別的名稱但註解照寫、改成固定 30 秒、整段改回上游，都紅。
  - lefthook：守門先紅（format、lint 都是 false）後綠。`lefthook run pre-commit --job lint|format --file woowtech/png.mjs` 改之前兩個都「no files for inspection」，改之後都有檢查、都過；換成 main 版的 `png.mjs`，兩個都失敗（complexity 24、巢狀三元；排版不符）。突變：兩個 glob 各拿掉 `mjs`，都紅。
  - Ubuntu 版本：守門先紅，列出 15 個用 `ubuntu-latest` 的 job，改完變綠。展開 anchor 後跟改之前只差這 15 個 `runs-on`，觸發和 Windows 的條件沒變。突變：`changes` 和桌面版改回 `ubuntu-latest`、寫成陣列 `[ubuntu-latest]`、改成 matrix 的 `os` 清單和 `include`，都紅，每次都指到正確的 job。
  - 跑過的：守門 70 個全過（`node --test woowtech/*.test.mjs`）；CI 第一個 job 的三個 node 測試 27/27，上游的 `ci-workflow.test.mjs` 不用改；全 repo 的 `npm run lint`、`npm run format:check` 通過；每個 commit 的 pre-commit 都跑了完整 typecheck。
  - 沒跑的：browser E2E 本身（要起 daemon、Metro 和 Electron）和 GitHub 上的執行。
- CI 第二次執行後的四項（2026-09-26，分支 `woowtech/ci-green`，第 18 節）：守門都先紅後綠，都做了突變，每次都用 sha256 確認改回原檔。
  - Playwright 改成手動：守門先紅（沒有 `run_playwright` 輸入；加了輸入後，有閘門的 job 是空的），改完變綠。9 種突變都紅：預設勾選、型別改成 string、分片 3 改回上游的 `if`、分片 2 在最外層加 `|| github.event_name == 'schedule'`、`!inputs.run_playwright`、改讀字串的 `github.event.inputs.run_playwright`、app-tests 也加閘門、relay-tests 排程時略過、輸入改名。展開 anchor 後跟改之前只差輸入和 4 個 `if`。
  - Metro 的 heap：守門先紅（4 個分片都沒有上限）後綠。突變：拿掉、改成 2048、拼錯旗標、搬到裝瀏覽器那一步、`global-setup.ts` 起 Metro 時只給 PATH，都紅。
  - app 的 test 上限：守門請 vitest 解析 app 的 test script 加上 CI 在 `--` 後面的參數，先紅（unit 5000、browser 15000）後綠。突變：拿掉旗標、放到 `--` 前面、改成 `--hookTimeout`、改成 30 秒、暫時從 vitest 的 cliOverrides 拿掉 `testTimeout`，都紅。這台 Mac 上用 CI 的指令加一個檔案篩選：`--testTimeout=1` 讓 `unistyles-module-scope.test.ts` 在 1ms 逾時，`60000` 通過；旗標放在 `--` 前面時 vitest 收不到。
  - browser E2E 的截圖：守門先紅（`callTool`，隱藏視窗那個直接呼叫）後綠。突變：改回直接呼叫、改走不重試的 `callBrowserTool`、非作用中分頁那個改成直接呼叫、重試函式改名，都紅。重試函式的內容被改壞（例如不重試）守門抓不到；另外把新舊兩版的函式切出來、用假的 MCP client 比對：`callBrowserToolUntilReady` 在 6 種回應序列下結果和呼叫次數都相同，新的呼叫點遇到 retryable 會重試、其他錯誤照樣失敗、一直 retryable 到期會失敗。
  - 跑過的：守門 74 個全過（`node --test woowtech/*.test.mjs`）；CI 第一個 job 的三個 node 測試 27/27，上游的 `ci-workflow.test.mjs` 不用改；全 repo 的 `npm run lint`、`npm run format:check` 通過；每個 commit 的 pre-commit 都跑了完整 typecheck。
  - 沒跑的：Playwright、桌面版 browser E2E 本身和 GitHub 上的執行。

- 2026-09-26 說明與求助連結改成官網（分支 `woowtech/website-links`）：原本導向 LINE 官方帳號的三處（說明選單、關於頁與專案首頁的按鈕、help 技能）都改開 https://aiot.woowtech.io 首頁，十種語言的標籤改成「官方網站」一類的譯文，`BRAND_LINKS` 拿掉 LINE 的連結。
  - 守門 `help-links.test.mjs` 先紅（技能檔還有 LINE、兩處按鈕沒開 `BRAND_LINKS.website`、標籤還寫 LINE）後綠；`brand.test.ts` 先紅（仍是 LINE official account）後綠 10/10；`skills.test.mjs` 更新期望後綠；`generate-skills.mjs --check` 一致。
  - 瀏覽器 e2e `sidebar-help.spec.ts` 的預期已改成官網，還沒實跑（Playwright 改成手動觸發）。
- 2026-09-26 關掉 relay.woowtech.io 的 Workers Logs（分支 `woowtech/relay-logs-off`）：守門 `relay-worker.test.mjs` 新增「沒有 Workers Logs」先紅後綠，比對 observability 跟上游一致的那一項拿掉；relay 程式碼從 9/25 部署後沒有變動，只重新部署設定。

## 接下來

- 第一次正式發佈：建立公開的 `WOOWTECH/woowtech-smart-releases`，並完成 Developer ID 簽章與公證。沒有簽章，macOS 的自動更新無法運作。
  發佈 repo 要放 `CHANGELOG.md`，App 的更新紀錄才讀得到。
- 桌面版打包進去的 `package.json` 仍是上游的 `author`、`homepage`、`repository`，由 `scripts/sync-workspace-versions.mjs` 從根目錄的 `package.json` 同步。macOS 版的版權和「關於」視窗已改用 WOOW TECH（第 6 節）；Windows 執行檔的公司名稱、安裝程式的網址和 Linux 套件的網址還讀這些值，發佈 Windows、Linux 版之前要決定怎麼標示（可以用 `electron-builder.yml` 的 `extraMetadata` 只改打包進去的值）。
- 桌面版的「關於」視窗和麥克風權限提示（第 6 節）要在打包、簽章後的 App 上看：選單「關於 woowtech smart」顯示 `© 2026 WOOW TECH CO., LTD.` 和 `https://aiot.woowtech.io/`，Finder「取得資訊」的版權也是這一行；系統語言設成繁中、簡中、英文各一次，第一次按聽寫時的提示是對應的句子（重問一次：`tccutil reset Microphone io.woowtech.smart.desktop`）。提示的標題是系統的句子加上 App 名稱 woowtech smart，中文說明裡寫的是「渥屋智能」，看過再決定要不要一致。
- 品牌識別：CLI（第 12、13 節）和 daemon 自己的訊息（第 17 節）都改完了。刻意保留上游名稱的列在第 17 節；企業版裝回本地語音時，語音模式給 agent 的指示（`voice-config.ts`）要一起改。
- CLI 改名合回 main 之後：
  - 重建 server 的 dist，跑 CLI 的 e2e（`tests/17-onboard.test.ts`、`03-daemon.test.ts`）和桌面版打包後的 smoke。`src/commands/daemon/lifecycle.e2e.test.ts` 已在 `woowtech/services` 跑過（驗證紀錄）。
  - 在桌面版實際按「安裝 CLI」和安裝技能（用測試帳號或暫存 HOME），確認 `~/.local/bin` 和三個技能資料夾只多出 `woowtech-smart*`，設定的命令列那一列顯示 `woowtech-smart`。
- iOS 權限提示（第 6 節）已改成品牌名加繁中、簡中；要在模擬器或實機上各看一次三個提示的實際文字（英文、繁中、簡中）。
- 附件檔名含 `#`、`?`、`%`（第 21 節）：RC 的原始報告在舊 Mac 上，修正是從程式找到的原因。要在桌面版附加 `shot#1.png`、`what?.png`、`100%.png` 各一次，確認預覽和送出都正常，也在手機上附加一次。
- 盤點設定頁以外上游寫死的英文，照第 14 節的做法一頁一頁處理。
- 用詞待決定：
  - 已處理：原本「28 處主機／87 處 Host」的混用已統一為「主機」（C-007）；由產生器來源修正並重生繁中，Agent 保留英文。
  - PR 狀態 open 的「開啟」讀起來像動作，建議改「開啟中」（目前沒用到這個 key）。
  - 腳本網址的「好記網址」和「直接位址」建議統一用「網址」。
- 更新紀錄：HTTP 200、內容卻不是 changelog 時（例如會攔截 TLS 的公司 proxy 回的封鎖頁），現在顯示「還沒有釋出說明」，沒有重試按鈕。要不要跟 404 分開處理，還沒決定。
- 第 15 節「還沒處理的」兩項（`GIT_EDITOR`、其他 agent 宿主的變數）要不要處理，還沒決定。終端機的環境已處理。
- 在模擬器上確認：英文系統的主畫面標籤、「新功能」的空狀態、繁中的設定頁和側欄。
- 部署 relay.woowtech.io（第 11 節），部署後照第 11 節檢查，再發佈這個分支的版本；部署前發佈的話，daemon 會一直重試連不上的 relay。
- 配對連結直接叫起 App（第 19 節）的實機驗收：iOS 和 Android 的相機掃 QR Code、`xcrun simctl openurl`、`adb shell am start`，冷啟動和 App 已開著各一次；已經有一台主機、App 關著時掃新的 QR Code，再重開 App，兩台都在；沒裝 App 時掃描的反應；桌面版點連結不會有反應。Android 相機叫不起 App 時，照第 19 節的「取捨」決定要不要改成在我們網域放一頁。
- 之前內部測試版建立的 home 寫著 `daemon.relay.enabled: false`，要不要遷移成開，還沒決定。
- 推播（第 16 節）：protocol、daemon、App 和守門都做完了（分支 `woowtech/push`，2026-09-26 已合進 main），接下來：
  - 中繼的 smart 模式和 push.woowtech.io 已在 2026-09-25 部署（第 16 節）。部署後的檢查：`POST {}` 回 400 `invalid_request`（field `token`）、假的 FCM token 回 410、直接打 run.app 回 403、GET 回 405、其他路徑回 404。
  - 通知用字寫在中繼的 `smart-messages.js`，owner 在 2026-09-26 確認維持現在的句子。
  - Android 通知通道（第 16 節 Android 的「通知通道」）：App 這邊在分支 `woowtech/android-channels-1005`。中繼這邊做在本機 clone `~/.local/share/woowtech-smart/wt/relay-channels-1005` 的分支 `smart-channels-1005`（`9b7a344`，從 `smart-mode` 的 `dff78a1` 開出：`smart-payload.js` 依原因指定通道、測試、中繼 README），還沒推上 GitHub，也還沒部署。照這個順序：
    1. App 合進 main，新版裝到測試手機，連上 daemon、允許通知後，系統設定裡有兩個通道。
    2. 中繼的分支推上 `WOOWTECH/woowtech-push-relay`、合進 `smart-mode`，在 Cloud Shell 用乾淨的 clone 先跑 `deploy/woowtech-smart-deploy.sh --dry-run`，再跑 `deploy/woowtech-smart-deploy.sh`（中繼 README 的「WoowTech: the woowtech smart profile」）。部署後照上面的檢查跑一次，第 16 節的部署紀錄改成新的 commit 和 revision。
    3. 照第 16 節的「還要實機驗」在 POCO 上驗。
  - 兩個平台都用實機驗收（設計 6.6）：
    - 通知只顯示中繼的句子，點下去開到那個 agent 或 terminal，App 在背景和被滑掉各試一次；換語言後只收到一則新語言的通知；解除安裝後中繼回 410、daemon 刪掉那筆；桌面版的系統通知仍有回覆預覽。
    - iPhone 上 `registerDeviceForRemoteMessages` 會回來（RNFB 和 `expo-notifications` 都接了 AppDelegate）；TestFlight 版（production APNs）和 Xcode 裝的開發版（sandbox）都拿得到 token。
    - 把 App 滑掉再重開：第二次啟動時 daemon 的 log 又出現「Registered push token」，裝置 log 沒有「No FCM token on this device」。48 小時後仍收得到推播。
    - 通知權限只在連上 woowtech smart 的 daemon 時才問。
    - 從相同 bundle ID、呼叫過 `getExpoPushTokenAsync` 的舊測試版升級：驗證 iOS 原生寫入 disabled 成功、下次啟動與 APNs token 事件維持停用；另驗證首次 import 已讀到 enabled、仍等待 token 或已開始上傳的競速。原生字串 adapter 不取消這些工作，尚不能宣稱升級首次啟動零 Expo 請求。移除 App 也不能當成清除 Keychain 登記的可靠方式。
    - 打一次真正的 iOS bundle，確認裡面沒有 `@firebase/app`，並量 IPA 大小的差距。
    - RC-I-21c（第 16 節）：iPad 和 POCO 各自先在 main 重現，再換修正版。App 被滑掉後點通知，同一個工作區、跨工作區、點之前讓主機連不上各 3 次，B 聚焦後不再跳回 A；開到 B 後切到 A，在 Debug 版 Reload，不會被拉回 B；開到 B 後讓 B 再完成一次，點新的通知仍開 B（iOS 同一個 agent 的 identifier 相同）；App 被滑掉時在桌面版封存工作區 W，再點 W 裡 agent 的舊通知，要顯示 Restore。
  - 待決定：
    - 手動分兩步跑 prebuild 和 `pod install` 時，要不要讓 `react-native.config.js` 也看 prebuild 產生的 `ios/` 裡有沒有 plist，而不只看環境變數。
    - F-Droid 版的 `expo-notifications` stub 要不要補上 `setAutoServerRegistrationEnabledAsync`、`getDevicePushTokenAsync`、`addPushTokenListener`。程式已經能處理沒有它們的情況（記 warn 或拿不到 token）。
    - Firebase 在 2026 年 10 月以後不再發到 CocoaPods，要停在最後一版，還是規劃回到 SPM。
    - EAS 的上游專案值要保留還是拿掉（第 1 節）。
- Playwright：2026-09-30 在整合分支勾選跑過一次完整執行（CI #10，見「驗證紀錄」的整合輪驗收），5 個失敗、3 個 flaky 都不是那一輪的改動造成。先修 main 既有的 `sidebar-help.spec.ts:80`、`viewed-agent-timelines.spec.ts:384`，再決定 `agent-consecutive-turns.spec.ts:816`、`agent-message-rewind.spec.ts:119`、`agent-message-submission.spec.ts:1298` 怎麼處理（修法建議在 `coord/reports/ci-0930-triage.md`），之後再勾一次 Playwright，要整次綠。第一階段的 CI #13（run 36697759152，見「驗證紀錄」的第一階段驗收）是 7 個失敗、4 個 flaky，也都不是那一輪造成；其中 `agent-stream-ui.spec.ts:188`（第 18 節的 run 2 就失敗過）和 `creation-old-daemon.spec.ts:95` 的 0.7.2（這次重試也失敗）要一起處理。
- Claude 執行檔的備援位置（第 3 節）要實機驗收：從 Dock 開桌面版、登入 shell 的 PATH 沒有 `~/.local/bin` 時，設定頁的 Claude 顯示可用，診斷的 Resolved path 是 `~/.local/bin/claude`，Agent 能建立。
- 廠商的文字徽章（第 22 節）要在實機上看：桌面版、iOS、Android 的淺色和深色主題，設定頁的供應商列表和新增 ACP 供應商的目錄、側欄的 Agent 列、模型選單、匯入工作階段、排程、終端機設定檔這些 12～24 px 的地方都讀得出縮寫（C、Cx、Gh、Oc、Pi、Om、Mm 等），桌面版「在…中開啟」選單的 VS Code、Cursor 等是徽章、Finder 是資料夾；外觀設定的主題選單顯示「陶土」／Terracotta，原本選了這個主題的裝置更新後仍是同一個主題。
- 網頁版和桌面版的啟動畫面（第 8 節）要在實機上看：淺色和深色主題都是 WOOW 標誌在閃，不是蝴蝶。
- 帳號用量關掉（第 23 節）要在實機看：桌面版、iOS、Android 的設定主機清單都沒有「用量」，其他列照舊；舊的 `/settings/hosts/<id>/usage` 連結開到「連線」；context 圓環的 tooltip 只有上下文、tokens 和費用，沒有「Loading plan usage…」或方案卡；用舊版 App 連新的 daemon，tooltip 不出現紅字，用量頁只顯示「No usage data」。
- 商標與第三方授權頁（第 24 節）要在實機看：iOS、Android、桌面版的淺色和深色主題，繁中和英文各一次（Android 模擬器和未簽章的桌面版已在驗證紀錄的第一階段驗收看過，iOS 模擬器等 owner 回到 Mac 前重開機再看）。設定列表（手機）或側欄（桌面版）有這一列、點進去標題對、返回鍵回設定；五段都在，長的聲明和 MIT 條文完整換行、不被截斷，文字選得起來；側欄的英文列名放得下。GitHub、Codeberg 的標誌在 PR 分頁、「在…中開啟」選單和主按鈕、hover card 的檢查列、輸入框的附加選單各種狀態下都是純黑（淺色主題）或純白（深色主題），PR 動作（建立、合併 PR）是通用的 PR 圖示，GitLab 的遠端顯示 Gl 徽章；.go、.swift、.vue、.astro、.lua 等檔案在檔案總管是通用圖示。
- 上架前（第 24 節）：商店截圖和宣傳圖不含第三方標誌；決定開放原始碼授權頁怎麼做。
- 商標（TIPO）與 D-U-N-S。
