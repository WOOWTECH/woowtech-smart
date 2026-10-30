# AI 內容回報接收器（Cloud Run 版）

狀態（2026-10-30）：**已上線。** 2026-10-14 從 6be6f0127 部署，Cloud Run `smart-reports`（revision 00001）＋ Worker `smart-reports-proxy`（`reports.woowtech.io`）。從外部送真回報實測過：收據、讀回、通知信、依收件編號刪除都正常。0.8.1 的正式建置帶這個網址。2026-10-30 照下面的「只更新 Worker」從 `3d288ed63` 重新部署 Worker（版本 `3632b58e`），放行網頁版 `https://smart.woowtech.io`（owner 決定 D4）；V1–V5、V8 全過，細節在 `woowtech/README.md` 的驗證紀錄。Cloud Run 服務沒動。

App 的「回報」按鈕把一則回報 POST 到這裡。做法和 `smart-push` 相同：Cloud Run ＋ Firestore ＋ Cloudflare Worker，專案 `woowtech-smart`，區域 asia-east1（台灣）。不需要主機、磁碟或 Gmail 授權。

```
App ─HTTPS─▶ Cloudflare Worker（reports.woowtech.io）─加上 edge key─▶ Cloud Run smart-reports ─▶ Firestore
                                                                            │
                                                          寫一行 log（只有收件編號）
                                                                            ▼
                                                  Cloud Monitoring 警示 ─▶ 寄信給 woowtech@designsmart.com.tw
```

第一版接收器（檔案佇列＋Gmail）還在 `../ai-content-report-service`，它的 `contract.mjs` 是接收器對 App 的契約（App 端的送出邏輯在 `packages/app/src/components/ai-content-report`）。這裡的 `contract.mjs` 是同一份副本，`contract-sync.test.mjs` 檢查兩份一致；改契約要兩邊一起改。

## 檔案

| 檔案                                                            | 作用                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `server.mjs`                                                    | HTTP 服務：路由、edge key、驗證、每日上限、儲存逾時、log |
| `firestore-store.mjs`                                           | 真正的儲存：寫報告與計數在同一個交易                     |
| `store-port.mjs`                                                | 儲存介面、集合名稱、收件編號格式                         |
| `memory-store.mjs`、`support.mjs`                               | 只給測試用，不進映像檔                                   |
| `admin.mjs`                                                     | 用收件編號在終端機查看或刪除一則回報                     |
| `Dockerfile`、`.dockerignore`、`.gcloudignore`                  | 映像檔只含四個模組；build context 就是這個資料夾         |
| `deploy/woowtech-smart-reports-deploy.sh`                       | 部署腳本（預設只印計畫）；`rollback` 印出移除指令        |
| `deploy/smart-reports-alert-policy.json`                        | 警示政策範本，腳本填入產品名、專案和通知管道後建立       |
| `deploy/cloudflare-worker-smart-reports.js`、`….wrangler.jsonc` | Worker 與它的 wrangler 設定                              |
| `deploy/cloudflare-worker-smart-reports.apporo.wrangler.jsonc`  | Apporo smart 的 Worker 設定（www.apporo.ai 上一條路由）  |

## 資料與保存

- 集合 `aiContentReports`，文件 ID 是伺服器產生的收件編號 `air_<uuid>`，欄位 `receivedAt`、`expiresAt`、`report`（App 送來的內容原樣）。**不存來源 IP、User-Agent 或任何標頭。**
- 集合 `aiContentReportCounters`，每個 UTC 日一份，用來限制每日收件數；兩個集合的 `expiresAt` 都有 Firestore TTL。
- 保存 30 天（`RETENTION_DAYS`）。TTL 通常在到期後 24 小時內刪除，這段時間文件仍然讀得到；公開文字要這樣寫，不要寫「到期即刪」。
- 沒有備份：資料庫的 PITR 關閉、沒有備份排程（2026-10-14 實查），所以刪除就是刪除。
- Cloud Run 日誌只有 `ai_report_stored` 加收件編號、固定錯誤代碼；請求日誌（含 IP）由腳本的 `logs` 步驟排除。

## 保護

Worker：只收 `POST /v1/ai-content-reports`、只收 JSON、body 上限 12,288 bytes、每個 IP 每分鐘 10 次（wrangler 的 `IP_RATE_LIMITER`，或改用 WAF 規則）、不轉送任何用戶標頭、不寫 log。

服務：沒有正確 edge key 一律 403，而且先於讀 body；每日最多 `DAILY_MAX_REPORTS`（2000）筆，超過回 429；最多 3 個 instance；寫入超過 8 秒回 500 `storage_unavailable`（log 代碼 `storage_timeout`）。回 201 一定是 Firestore 已確認寫入之後。

**瀏覽器來源**：手機 App 不帶 Origin。桌面版從 `woowtech-smart://app`、網頁版從 `https://smart.woowtech.io` 發出跨來源請求，所以 Worker 只對這兩個來源回預檢和 CORS 標頭（Worker 程式裡的 `DEFAULT_ALLOWED_ORIGINS`）。其他來源的 POST 回 403、預檢回 405，都不帶 CORS 標頭，包括 `woowtech-smart-web.pages.dev` 和預覽部署的網址：在那裡送不出回報是刻意的。比對是整串相同，`*` 和 `null` 永遠不放行。服務本身看不到 Origin，也拒絕任何帶 Origin 的請求。

- 要改允許的來源，改 `DEFAULT_ALLOWED_ORIGINS` 和 `worker.test.mjs`，再重新部署。Worker 的變數 `ALLOWED_ORIGINS` 會整份取代這份清單（空字串＝不放行任何瀏覽器）。下一次 `wrangler deploy` 會把儀表板上設的 Text 值清掉，設成 Secret 的卻會留著，所以只當暫時的開關用，用完就刪掉。
- Origin 只決定要不要回應瀏覽器的跨來源請求，不是防濫用：不帶 Origin 的請求照樣收。防濫用靠每 IP 限流和每天 2000 筆的上限；上限被灌滿時，手機 App 的回報也會一起得到 429，這是已知的取捨。

## 部署

owner 同意之前**不要**加 `--apply`。

```bash
cd woowtech/ai-content-report-cloudrun
./deploy/woowtech-smart-reports-deploy.sh                # 只印計畫和每一條指令，什麼都不呼叫
./deploy/woowtech-smart-reports-deploy.sh --apply        # 問專案 ID，再依序做
./deploy/woowtech-smart-reports-deploy.sh --apply check  # 只做某一步：apis firestore ttl iam secret build logs deploy alert check
./deploy/woowtech-smart-reports-deploy.sh rollback       # 印出移除順序，不執行
./deploy/woowtech-smart-reports-deploy.sh --brand=apporo # Apporo smart 的接收器（見下）
```

- 每個品牌各有一套，`--brand=` 選（預設 woowtech）：

  | 品牌     | GCP 專案           | 區域       | App 送到                                                                    | Cloudflare                 |
  | -------- | ------------------ | ---------- | --------------------------------------------------------------------------- | -------------------------- |
  | woowtech | `woowtech-smart`   | asia-east1 | `https://reports.woowtech.io/v1/ai-content-reports`（自訂網域）             | WOOW 的帳號，Workers Paid  |
  | apporo   | `apporo-smart-app` | us-west1   | `https://www.apporo.ai/api/smart/v1/ai-content-reports`（官網上的一條路由） | 客戶的帳號，用它現有的方案 |

  兩個品牌用同一份 Worker 程式。Apporo 照 Apporo aiot 的做法（owner 2026-10-15：「跟 aiot／platform 一致」）：不開子網域，只在官網 www.apporo.ai 掛一條精確路徑。這條比 aiot 的 `www.apporo.ai/api/*` 更精確，Cloudflare 會把它交給這個 Worker，其他 `/api/` 照舊給 aiot。路由絕不能用萬用字元，不然整個官網都會被接走。Worker 多三個文字變數 `PUBLIC_HOST`、`PUBLIC_PATH`、`ALLOWED_ORIGINS`，`….apporo.wrangler.jsonc` 已經寫好；網址和 App 的回報網址由測試對照 `woowtech/brands/<id>.json`。警示信一律寄渥屋。

- 要在乾淨、已提交的 checkout 上執行（映像檔標籤是 commit）；用專案擁有者的帳號登入 gcloud；`alert` 步驟要 `gcloud beta`（Cloud Shell 有；別處先 `gcloud components install beta`）。
- 可重複執行：已存在的不重建，edge key 永遠不重生、不印出。
- 腳本最後印出 Cloud Run 網址和 Cloudflare 要做的事（Worker、`reports.woowtech.io`、關 workers.dev 與 Preview、每 IP 限流、帳號要 Workers Paid）以及 edge key 輪替步驟。輪替看腳本輸出的 “To rotate the key later”，Worker 的 `EDGE_KEY` 永遠只放新的那一把。Worker 用 wrangler 部署時，登入、版本和指令照下面的「只更新 Worker」，腳本印的第 1 步也指到那裡（`RELAY_ORIGIN` 用 `--var` 帶，不改設定檔）。`deploy-script.test.mjs` 檢查腳本印的 wrangler 版本跟 wrangler 設定檔寫的相同。
- 驗證不寫資料：對 Worker 送 `{}` 應得 `400 {"error":"unsupported_schema"}`（腳本結尾有指令）。信件要用一則真的回報才能證明。
- 通知管道若顯示 UNVERIFIED，要點 Google 寄到信箱的確認信，否則收不到警示。Email 管道建好時沒有回報驗證狀態，不用點信也收得到（10/14）。
- 新建的東西要幾分鐘才生效：`logs` 步驟的排除規則約 5–7 分鐘後才擋得住請求日誌，這段時間的請求（含 IP）會留在 Cloud Logging 到保存期滿，所以部署後先別讓真流量進來；警示政策建好後一分鐘內的第一則回報沒有寄信。
- Cloudflare 那半固定用 wrangler 4.149.0（`npx --yes wrangler@4.149.0`，2026-10-08 發佈，有 `login --device`、`--scopes`、`whoami --json`），跟網頁版的 `woowtech/scripts/deploy-web.sh` 同一版。owner 不在這台電腦前就用 `login --device`（owner 在任何裝置開連結按允許）。代碼只活 5 分鐘，先請 owner 登入 Cloudflare 再產生代碼。
  - 登入放在只給這個 Worker 用的 `XDG_CONFIG_HOME=~/.local/share/woowtech-smart/wrangler-reports`，scopes 只要 `account:read user:read workers_scripts:write workers_routes:write zone:read`；`whoami --json` 的 `tokenPermissions` 多了別的就重新登入。不要用舊的 `wrangler-home`，那是 wrangler 預設的一大串 scopes。網頁版部署用的 `wrangler-pages` 是另一組，只有 Pages 的權限。
  - 用 `CLOUDFLARE_ACCOUNT_ID` 指定有 woowtech.io 的那個帳號，在空目錄裡執行，`WRANGLER_CACHE_DIR` 也指到空目錄：wrangler 會先讀快取裡記的帳號。
  - 這組登入改得動 zone 的 Worker 路由，做完一定 `wrangler logout`。
  - 部署前後都到儀表板看 Observability（Workers Logs、Traces 關著，沒有這個 Worker 的 Logpush，也沒有掛 Tail Worker）和限流（`IP_RATE_LIMITER` binding 或 WAF 規則），限流再用 V8 實測。步驟在下面的「只更新 Worker」。
- Worker 的每 IP 限流不精確：同一個 IP 快速送約 30 次才開始回 429（Cloudflare 依地點計數、最終一致），測試時要送夠多。
- 之後 App 建置時帶 `WOOWTECH_AI_CONTENT_REPORT_URL=https://reports.woowtech.io/v1/ai-content-reports`，並在上線前改隱私權政策與商店揭露（草稿在 `plans/ai-report-go-live-pack-1014.md`）。網頁版建置時也要帶同一個網址：它只在 `expo export` 時寫進 bundle（`packages/app/app.config.js` 的 `aiContentReportUrl`），`woowtech/scripts/deploy-web.sh` 會帶，建置後 `woowtech/web/check-export.mjs` 檢查 bundle 裡有它。

### 只更新 Worker

改了 Worker 的程式或 wrangler 設定時（例如 2026-10-27 放行網頁版），只重新部署 Worker。Cloud Run 服務不用動：Worker 不轉送 Origin，服務本來就拒絕帶 Origin 的請求（`server.mjs`）。部署要 owner 登入 Cloudflare 和 gcloud；部署後的 curl 檢查不寫資料，agent 可以代跑。

部署前，在儀表板 Workers → `smart-reports-proxy` 記下這三項，部署後再看一次：

- Settings → Variables and Secrets：`RELAY_ORIGIN` 是 Text 還是 Secret；`ALLOWED_ORIGINS` 有沒有設，有的話是 Text 還是 Secret、值是什麼；`EDGE_KEY` 是 Secret。
- Settings → Observability：Workers Logs 和 Traces 都是關的，Logpush 沒有這個 Worker 的 job，也沒有掛 Tail Worker（Tail Worker 收得到每個請求的網址和標頭；它在儀表板的哪一頁沒有查證）。新建的 Worker 預設開 Workers Logs（log 裡有請求和回應的細節），10/14 又可能是從儀表板部署的，所以不能假設是關的。
- 限流：Worker 有 `IP_RATE_LIMITER` binding，或 Security → WAF → Rate limiting rules 有涵蓋 `reports.woowtech.io/v1/ai-content-reports` 的規則。

`ALLOWED_ORIGINS` 有設的話，不論 Text 或 Secret，都會整份取代程式裡的清單，網頁版照樣被擋。wrangler 部署會清掉 Text 的值，Secret 卻會留著；下面儀表板貼程式的備案兩種都留著。先問 owner 當初為什麼設：不需要了，就在部署前到 Variables and Secrets 刪掉它，程式裡的清單才會生效（線上的舊版沒有它時照樣放行桌面版）；要留著，值就要同時列出 `woowtech-smart://app` 和 `https://smart.woowtech.io`。

```bash
REPO=<已合併這次修改、推上 origin 的 checkout，絕對路徑>
test -z "$(git -C "$REPO" status --porcelain)" && git -C "$REPO" branch -r --contains HEAD | grep -q origin/ && echo ok   # 沒印 ok 就停
git -C "$REPO" log -1 --format='%h %s'            # 記進驗證紀錄
git -C "$REPO" diff 6be6f0127..HEAD -- woowtech/ai-content-report-cloudrun/deploy/cloudflare-worker-smart-reports.js woowtech/ai-content-report-cloudrun/deploy/cloudflare-worker-smart-reports.wrangler.jsonc
# owner 看過才往下：跟 10/14 部署的 6be6f0127 比，DEFAULT_ALLOWED_ORIGINS 只多了 https://smart.woowtech.io，其他都是註解
CFG=$REPO/woowtech/ai-content-report-cloudrun/deploy/cloudflare-worker-smart-reports.wrangler.jsonc
export XDG_CONFIG_HOME=$HOME/.local/share/woowtech-smart/wrangler-reports
export CLOUDFLARE_ACCOUNT_ID=9c27f623ee596e0b67be56263bcb1974 WRANGLER_CACHE_DIR=$(mktemp -d)
cd "$(mktemp -d)"
wr() { npx --yes wrangler@4.149.0 "$@"; }       # 用函式：zsh 不會把放著整行指令的變數拆開來執行
wr login --device --scopes account:read user:read workers_scripts:write workers_routes:write zone:read
wr whoami --json                                 # tokenPermissions 只有上面五項和 offline_access
wr deployments list --name smart-reports-proxy   # 上一次是從儀表板還是 wrangler 部署的
RUN_URL=$(gcloud --project woowtech-smart run services describe smart-reports --region asia-east1 --format='value(status.url)')
echo "$RUN_URL"   # RELAY_ORIGIN 是 Text 時要跟儀表板上的值相同，不同就停下來查
wr deploy --config "$CFG" --var "RELAY_ORIGIN:$RUN_URL" --dry-run
wr deploy --config "$CFG" --var "RELAY_ORIGIN:$RUN_URL"
```

- `RUN_URL` 一律取自 gcloud，不要照抄儀表板：Worker 會把每則回報和 edge key 送到這個網址，而任何回 400 `unsupported_schema` 的上游都能讓下面的 V2 通過。
- 用 wrangler 部署時（依據是 wrangler 4.149.0 的原始碼，2026-10-27 在這台 Mac 的 npx 快取裡讀過；沒有實際部署過）：
  - wrangler 先把新版以 100% 上線，再套用設定，最後才處理 custom domain 和 workers.dev。印出 `Uploaded` 時，新版已經在服務 reports.woowtech.io；之後的步驟報錯也一樣，先照樣跑下面的檢查、套用處理規則，再決定要不要加 scopes。不確定時，`wr deployments list --name smart-reports-proxy` 最新的一筆就是線上的版本。
  - 儀表板上設的 Text 變數（例如 `ALLOWED_ORIGINS`）會被換掉；Secret 都留著，包括 `EDGE_KEY`。會加上 `IP_RATE_LIMITER`（namespace 4102）。
  - 設定檔要求關掉 Observability 和 Logpush，但這一步失敗時 wrangler 只印一句不相干的警告（`Could not apply service and environment tags…`），然後照樣繼續。看到這句就當作沒有關，部署後到儀表板關掉。設定檔沒有 Tail Worker 的設定，已經掛上的會留著。
- `RELAY_ORIGIN` 是 Secret，或部署時出現 binding 名稱衝突：改用儀表板的 Edit code，貼上新的 `cloudflare-worker-smart-reports.js` 再按 Deploy。這樣設定和 secret 都不變：`ALLOWED_ORIGINS` 要照上面先處理；不會有 `IP_RATE_LIMITER`，要靠 WAF 規則限流；Observability 和 Tail Worker 也維持原樣，一定要人工確認。
- 這五個 scopes 夠不夠帶 custom domain 和 ratelimits 部署，還沒實測。不夠時 wrangler 會報錯：先照上面看新版有沒有上線，再請 owner 決定要不要加。

部署後馬上檢查：

```bash
U=https://reports.woowtech.io/v1/ai-content-reports; W=https://smart.woowtech.io
# V1 網頁版的預檢：204；ACAO=$W；ACAM POST；ACAH content-type, accept；max-age 600；ACEH retry-after；Vary Origin
curl -sSi -X OPTIONS "$U" -H "Origin: $W" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
# V2 網頁版送空 JSON：400 {"error":"unsupported_schema"}，而且帶 ACAO（網頁版的來源放行了，上游也收下了 edge key）
curl -sSi -X POST "$U" -H "Origin: $W" -H 'content-type: application/json' --data '{}'
# V3 桌面版的預檢仍然是 204，標頭同 V1（ACAO 是 woowtech-smart://app）
curl -sSi -X OPTIONS "$U" -H 'Origin: woowtech-smart://app' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
# V4 不帶 Origin：400，沒有 ACAO
curl -sSi -X POST "$U" -H 'content-type: application/json' --data '{}'
# V5 長得像的來源：每一行都要是「POST 403 OPTIONS 405 ACAO 0」
for o in http://smart.woowtech.io https://www.smart.woowtech.io https://smart.woowtech.io.evil.invalid https://woowtech-smart-web.pages.dev "$W/"; do
  p=$(curl -s -D - -o /dev/null -w '%{http_code}' -X POST "$U" -H "Origin: $o" -H 'content-type: application/json' --data '{}')
  f=$(curl -s -D - -o /dev/null -w '%{http_code}' -X OPTIONS "$U" -H "Origin: $o" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type')
  echo "$o POST ${p: -3} OPTIONS ${f: -3} ACAO $(printf '%s\n%s\n' "$p" "$f" | grep -ci '^access-control-allow-origin')"
done
# V8 限流：同一個 IP 連送 40 次 {}，結果裡要有 429（約 30 次後才開始）；{} 只會得到 400、不寫資料。這台的 IP 會被限 1 分鐘
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}\n' -X POST "$U" -H 'content-type: application/json' --data '{}'; done | sort | uniq -c
```

不符合時：

- V1–V5 有一項得到 429：被限流了，等一分鐘再跑那一項。
- V1 不是 204，或 V2 是 403 `origin_not_allowed`：網頁版沒被放行。不要 rollback：上一版也擋網頁版，手機和桌面版不受影響（看 V3、V4）。先看 `ALLOWED_ORIGINS`，和 `wr deployments list` 最新的一筆是不是這一次。
- V2（上面那種 403 除外）或 V4 不是 400 `unsupported_schema`：所有平台都送不出回報（500 `edge_misconfigured` 是 `RELAY_ORIGIN` 或 `EDGE_KEY` 沒設好，403 `forbidden` 是服務不認這把 edge key，503 是連不到服務）。執行 `wr rollback --name smart-reports-proxy`，選上一版（或在儀表板的 Deployments 選上一版）。
- V3 不是 204：已發佈的桌面版（0.8.1）送不出回報。rollback，再看 `ALLOWED_ORIGINS`。
- V5 有一行不是 `POST 403 OPTIONS 405 ACAO 0`，或 V1、V3 是 204 但標頭跟上面寫的不同：線上跑的不是測過的程式。rollback。
- V8 沒有 429：限流沒生效，隱私權政策網頁版那一段（P3）不能發佈，先補 WAF 規則或 binding。
- 都符合之後，再到儀表板看一次 Observability（含 Tail Worker）和限流，把部署的 commit、部署前後兩次的結果記進 `woowtech/README.md` 的驗證紀錄。兩項都確認過、V8 也看到 429，隱私權政策才能發佈網頁版那一段（「轉送程式只用來源決定要不要回應，不轉給回報服務，也不保存」；草稿在 `plans/web-server-20261026/privacy-391-web-draft.md`）。
- 最後 `wr logout`。

#### Apporo smart 的 Worker

網頁版 `https://smart.apporo.ai` 上線後（上線順序第 4 步），Apporo 的回報 Worker 也要放行它。程式同一份，步驟同上，換掉這些：

- 設定檔是 `deploy/cloudflare-worker-smart-reports.apporo.wrangler.jsonc`：`ALLOWED_ORIGINS` 從 2026-10-30 起是 `apporosmart://app https://smart.apporo.ai`，`PUBLIC_HOST`、`PUBLIC_PATH` 也寫在裡面（wrangler 部署會用這份的值換掉儀表板上的 Text 變數）。
- `CLOUDFLARE_ACCOUNT_ID=9f14a17191df1e77889566d848f063ad`（Alan 的帳戶，apporo.ai 的 zone 在這裡）。登入用同一個 `wrangler-reports` 目錄，`whoami --json` 的帳戶清單要列著它。
- `RUN_URL=$(gcloud --project apporo-smart-app run services describe smart-reports --region us-west1 --format='value(status.url)')`
- 部署前的三項（變數、Observability、限流）到 Alan 帳戶的儀表板看。這個 Worker 之前是用 wrangler 還是儀表板部署的、從哪個 commit 部署的，都沒有紀錄：先跑 `wr deployments list --name smart-reports-proxy`。不知道上次的 commit 時，部署前至少確認線上的 `ALLOWED_ORIGINS` 是 `apporosmart://app`，這次只多 `https://smart.apporo.ai`。
- 檢查：`U=https://www.apporo.ai/api/smart/v1/ai-content-reports; W=https://smart.apporo.ai`。V3 的桌面版來源是 `apporosmart://app`；V5 的來源換成 `http://smart.apporo.ai https://www.smart.apporo.ai https://smart.apporo.ai.evil.invalid https://apporo-smart-web.pages.dev "$W/"`。V8 只會讓這台的 IP 在這條路徑上被限 1 分鐘，官網其他頁面不受影響。
- Apporo 隱私權政策的網頁版段落（P3）要等這些都過了才發佈，稿子在 `~/.local/share/woowtech-smart/plans/apporo-smart-web-20261030/privacy-apporo-web-draft.md`。

## 日常

- **收到信**：信裡有收件編號。每個警示政策每天最多寄 20 封，超過就不再寄信，但回報照常存入；所以也要定期（至少每週）看 Firestore。
- **查看**：Google Cloud 主控台（專案 woowtech-smart）→ Firestore → 資料庫 (default) → Data → 集合 `aiContentReports` → 該文件。或在終端機：先 `gcloud auth application-default login`、`npm ci --omit=dev`，再 `node admin.mjs show air_<uuid>`。`show` 只在互動終端機跑（導向檔案或管線會拒絕），輸出不要貼進對話、工單或 CI。
- **刪除**（使用者寫信要求時）：`node admin.mjs delete air_<uuid>` 會刪除後讀回確認；或在主控台刪文件。
- **限額**：當天滿 2000 筆後回 429 與 `Retry-After`（到 UTC 午夜）。要調整就改部署腳本的 `DAILY_MAX` 後重跑 `deploy`。

## 測試

```bash
cd woowtech/ai-content-report-cloudrun
node --test        # Node 22；不需要 npm install
```

涵蓋服務、Firestore 儲存（用假的 Firestore）、admin、Worker（假的 fetch）、部署腳本（假的 gcloud／curl／openssl）、警示範本。CI 也跑這些測試（`.github/workflows/ci.yml` 的 “Test the AI content report receiver”）。

## 還沒做、或要知道的

- 單元測試用假的 Firestore；真的 Firestore 在 10/14 上線時用三則測試回報驗過（兩則直連 Cloud Run、一則經 Worker），都已刪除。
- 逾時的請求可能其實已存；使用者重試可能產生重複回報。
- 沒有「接收器壞了」的警示（可另建一個 severity 為 ERROR 的 log 警示政策）；目前壞了只會看到 App 送不出去。
- 備份：沒有，刻意的。
