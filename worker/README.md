# Magic Runes — Cloudflare Worker (signaling + TURN)

取代 PeerJS 公用信令,解決:
- 大亂鬥固定 `BRAWL1` 房號被搶 / 只能兩個人
- 公用信令不穩
- 不同網段 (NAT 穿透失敗) 連不上

架構:
```
Browser (Pages) ──WebSocket──► Worker ──► Durable Object (每房一個)
                         └───GET /turn──► 回傳公開 TURN 列表 (預設免費)
```

**Cloudflare Workers / Durable Objects / Pages 完全免費,不用刷卡**
(Durable Objects SQLite 後端也在免費方案內)

---

## 一、本機安裝工具

```bash
# 1. 裝 Node.js (https://nodejs.org 下載 LTS 版, macOS 也可用 brew install node)
node --version   # 確認有 >= 18
npm --version

# 2. 進 worker 資料夾裝 wrangler
cd worker
npm install
```

## 二、部署 Worker (3 行指令)

```bash
cd worker

# 第一次要登入 Cloudflare (會開瀏覽器授權)
npx wrangler login

# 部署! (第一次會問是否要建立 Worker, 按 y)
npx wrangler deploy
```

成功後會印出網址,長這樣:
```
https://magicrunes-signal.<你的帳號>.workers.dev
```

**把這個網址抄下來**,下一步要填進前端。

> **完全免費部署就到這步為止**. Worker 會用內建的公開 TURN 清單 (openrelay + 多組 STUN) —
> 大部分玩家連得上. 若仍遇到極少數不同網段連不上的案例, 再看「進階: 更穩定的 TURN」。

---

## 三、更新前端 `js/multiplayer.js`

打開 [../js/multiplayer.js](../js/multiplayer.js),把檔頭的 `SIGNAL_ORIGIN` 改成你的 Worker 網址:

```js
// 改這行 ↓
const SIGNAL_ORIGIN_PROD = 'https://magicrunes-signal.YOUR_ACCOUNT.workers.dev';
```

---

## 四、部署前端到 Cloudflare Pages

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 選你的 GitHub repo → 下一步
3. Build 設定:
   - **Framework preset**: None
   - **Build command**: (留空)
   - **Build output directory**: `/`
4. 按 **Save and Deploy**

完成! 網址會是 `https://<project>.pages.dev`。

> 每次 `git push`,Pages 會自動重新部署。

---

## 本機開發 (可選)

想在本機測 Worker:

```bash
cd worker
npm run dev     # 開 http://localhost:8787
```

同時把前端用任何 static server 開 (例如 `python3 -m http.server` 在專案根目錄),
`multiplayer.js` 偵測 `localhost` 會自動指向 `http://localhost:8787`。

---

## 進階: 更穩定的 TURN (若有連不上的案例)

預設 TURN 是 **公開免費服務** (openrelay),大部分情境可用,但偶爾會慢 / 被擋。
若需要更穩定,有兩個免費/便宜的升級方案:

### 方案 A: Metered.ca 免費帳號 (每月 50 GB 免費,只要 email 註冊)

1. 去 https://dashboard.metered.ca/signup 註冊 (免刷卡)
2. Dashboard 複製 **API Key**
3. 在 worker 資料夾下跑:
   ```bash
   npx wrangler secret put METERED_API_KEY
   # 貼 API Key, Enter
   ```
4. 重新部署 `npx wrangler deploy`

### 方案 B: Cloudflare Realtime TURN (要綁信用卡,但每月 1 TB 免費額度)

1. Cloudflare Dashboard → Realtime → TURN → Create
2. 取得 **Token ID** + **API Token**
3. ```bash
   npx wrangler secret put TURN_APP_ID
   npx wrangler secret put TURN_APP_TOKEN
   ```
4. 重新部署

> Worker 的 fallback 順序: **Cloudflare → Metered → openrelay 公開**,哪個有設定就用哪個。

---

## 常用指令

```bash
npm run deploy   # = wrangler deploy
npm run tail     # 即時看 Worker 日誌 (debug 用)
```

---

## 費用 (幾乎免費)

| 服務 | 免費額度 | 超過後 |
|---|---|---|
| Workers 呼叫數 | 10 萬次/天 | $0.30 / 100 萬 |
| Durable Objects | 100 萬 request/月 | $0.15 / 100 萬 |
| Realtime TURN | 1 TB/月 | $0.05 / GB |
| Pages | 無限頻寬 + 500 build/月 | — |

遊戲訊息很小 (位置同步 ~50 bytes × 20Hz),10 個人打 30 分鐘 ≈ 18 MB。**幾乎不可能超免費額度**。

---

## 疑難排解

**`wrangler login` 失敗**:瀏覽器沒開 → 複製 terminal 顯示的網址手動開

**部署後連線失敗**:
1. 瀏覽器 console 看是 WebSocket 錯誤還是 fetch `/turn` 錯誤
2. `npm run tail` 看 Worker 日誌
3. 確認 `multiplayer.js` 的 `SIGNAL_ORIGIN_PROD` URL 填對

**TURN 回傳 `source: "public-fallback"`**:正常 — 代表你沒設付費 TURN,用的是公開 openrelay。絕大多數情境都能連上。

**要檢查目前用哪個 TURN**:瀏覽器開 `https://你的worker.workers.dev/turn` 直接看 JSON 的 `source` 欄位。
