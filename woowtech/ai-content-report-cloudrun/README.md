# AI 內容回報接收器（Cloud Run 版）

狀態（2026-10-14）：**已上線。** 6be6f0127 部署，Cloud Run `smart-reports`（revision 00001）＋ Worker `smart-reports-proxy`（`reports.woowtech.io`）。從外部送真回報實測過：收據、讀回、通知信、依收件編號刪除都正常。0.8.1 的正式建置帶這個網址。

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

**瀏覽器來源**：手機 App 不帶 Origin。桌面版從 `woowtech-smart://app` 發出跨來源請求，所以 Worker 對這個來源回預檢和 CORS 標頭，其他來源一律 403；服務本身看不到 Origin，也拒絕任何帶 Origin 的請求。要改允許的來源，設 Worker 的 `ALLOWED_ORIGINS`。網頁版（一般瀏覽器）不支援。

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
- 腳本最後印出 Cloud Run 網址和 Cloudflare 要做的事（Worker、`reports.woowtech.io`、關 workers.dev 與 Preview、每 IP 限流、帳號要 Workers Paid）以及 edge key 輪替步驟。輪替看腳本輸出的 “To rotate the key later”，Worker 的 `EDGE_KEY` 永遠只放新的那一把。
- 驗證不寫資料：對 Worker 送 `{}` 應得 `400 {"error":"unsupported_schema"}`（腳本結尾有指令）。信件要用一則真的回報才能證明。
- 通知管道若顯示 UNVERIFIED，要點 Google 寄到信箱的確認信，否則收不到警示。Email 管道建好時沒有回報驗證狀態，不用點信也收得到（10/14）。
- 新建的東西要幾分鐘才生效：`logs` 步驟的排除規則約 5–7 分鐘後才擋得住請求日誌，這段時間的請求（含 IP）會留在 Cloud Logging 到保存期滿，所以部署後先別讓真流量進來；警示政策建好後一分鐘內的第一則回報沒有寄信。
- Cloudflare 那半用 wrangler 4.144 以上：owner 不在這台電腦前就用 `wrangler login --device`（owner 在任何裝置開連結按允許）。代碼只活 5 分鐘，先請 owner 登入 Cloudflare 再產生代碼。登入看得到好幾個帳號時，用 `CLOUDFLARE_ACCOUNT_ID` 指定有 woowtech.io 的那個。做完 `wrangler logout`。
- Worker 的每 IP 限流不精確：同一個 IP 快速送約 30 次才開始回 429（Cloudflare 依地點計數、最終一致），測試時要送夠多。
- 之後 App 建置時帶 `WOOWTECH_AI_CONTENT_REPORT_URL=https://reports.woowtech.io/v1/ai-content-reports`，並在上線前改隱私權政策與商店揭露（草稿在 `plans/ai-report-go-live-pack-1014.md`）。

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

涵蓋服務、Firestore 儲存（用假的 Firestore）、admin、Worker（假的 fetch）、部署腳本（假的 gcloud／curl／openssl）、警示範本。CI 目前只跑 `woowtech/*.test.mjs`，不含子資料夾。

## 還沒做、或要知道的

- 單元測試用假的 Firestore；真的 Firestore 在 10/14 上線時用三則測試回報驗過（兩則直連 Cloud Run、一則經 Worker），都已刪除。
- 逾時的請求可能其實已存；使用者重試可能產生重複回報。
- 沒有「接收器壞了」的警示（可另建一個 severity 為 ERROR 的 log 警示政策）；目前壞了只會看到 App 送不出去。
- 備份：沒有，刻意的。
