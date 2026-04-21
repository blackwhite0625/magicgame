# 魔法符文對戰 — Magic Runes

滑動滑鼠 / 觸控板繪製符文，施放魔法擊敗來襲的怪物，或與朋友線上 1v1 對戰。

**跨平台** — Mac、Windows、Linux 的 Chrome / Edge / Safari / Firefox 皆可直接執行。

---

## 開始遊玩

1. 雙擊 `index.html`，或用瀏覽器開啟（Chrome / Safari / Edge 皆可）
2. 點一下畫面任意處（啟用音效）
3. 在主選單選擇 **開始冒險** 或 **符文練習**
4. 用觸控板按住並滑動，繪製對應符文

## 符文一覽

| 符文 | 形狀 | 效果 | MP | 冷卻 |
|------|------|------|----|------|
| 🔥 火球 | 圓形（順時針） | 中等傷害，單體攻擊 | 15 | 2 秒 |
| ⚡ 閃電 | Z 字 | 高傷害、近乎瞬發 | 20 | 4 秒 |
| ❄️ 冰刺 | 三角形 | 低傷害、附加減速 | 10 | 2 秒 |
| ✚ 治療 | 十字（先橫後豎） | 恢復自身生命 | 30 | 8 秒 |
| 🛡️ 護盾 | 方形 | 擋下下一次攻擊 | 25 | 10 秒 |
| ☄️ 隕石 | 螺旋（2.5 圈） | 高傷害、範圍攻擊 | 50 | 15 秒 |

建議先到 **符文練習** 熟悉畫法！練習模式會顯示範例供描摹。

## 操作方式

| 動作 | 按鍵 / 輸入 |
|------|-------------|
| 移動 | **W A S D** 或方向鍵 |
| 繪製符文 | **按住滑鼠左鍵拖曳**（或觸控板按住滑動） |
| 暫停 | **Esc** |
| 施法目標 | 自動鎖定最近敵人 |

- **繪製準確度 ≥ 60%** 才會成功施放（設定中可切換「輔助/簡單/普通/困難」）
- **準確度 ≥ 82%** 觸發**暴擊**（傷害 ×1.5~2.5）
- **連擊系統**：連續成功施法累計傷害加成
- **石像鬼** 等敵人會蓄力重擊（紅條 + ⚠️ 圖示），需畫**護盾**擋下

## 關卡

1. **墓園** — 教學關，擊退亡靈戰士
2. **暗影森林** — 遠程術士出沒
3. **古代神殿** — 石像鬼登場，學會護盾
4. **詛咒深淵** — 多敵圍攻
5. **惡魔王座** — 最終 BOSS

## 檔案結構

```
magic-runes/
├── index.html          主頁面
├── css/
│   └── style.css       暗色魔法學院風格
├── js/
│   ├── main.js         遊戲主邏輯 (狀態 / 主迴圈 / 輸入)
│   ├── recognizer.js   $1 Unistroke 符文識別
│   ├── spells.js       六種魔法定義與效果
│   ├── enemies.js      敵人 AI 與關卡波次
│   ├── particles.js    粒子特效系統
│   └── ui.js           介面管理 + WebAudio 合成音效
├── assets/             (預留外部素材)
└── README.md
```

## 擴充指南

### 新增一種符文

1. 在 `js/recognizer.js` 的 `TEMPLATES` 裡加入模板點集
2. 在 `js/spells.js` 的 `SPELL_CONFIG` 加入參數 (冷卻、傷害、顏色…)
3. 在 `js/main.js` 的 `castSpell()` 加入對應的施放邏輯
4. 在 `js/ui.js` 的 `playSfx()` 加入對應的合成音效

### 調整平衡性

所有魔法參數都集中在 `js/spells.js` 的 `SPELL_CONFIG`，所有敵人參數在 `js/enemies.js` 的 `ENEMY_TYPES`，一個檔案就能調完。

### 更換音效

目前使用 WebAudio 合成音效，不需外部檔案。若要接入真實音檔：
1. 把 mp3/ogg 放進 `assets/sounds/`
2. 修改 `js/ui.js` 的 `playSfx()`，改用 `new Audio('assets/sounds/fireball.mp3').play()`

### 識別難度

`設定` 畫面可切換「簡單 / 普通 / 困難」，對應 `$1` 識別閾值 0.6 / 0.7 / 0.8。

## 技術細節

- **識別演算法**: $1 Unistroke Recognizer (Wobbrock, Wilson & Li, 2007)
  - 重採樣 → 指示性旋轉 → 縮放 → 平移 → 黃金分割搜尋最小距離
- **粒子系統**: 物件池 (2000 粒子上限)，避免 GC 抖動
- **音效**: WebAudio 合成 (Oscillator + Noise)，零依賴
- **Canvas 解析度**: 依 `devicePixelRatio` 自動縮放，在 Retina 螢幕下保持銳利

## 瀏覽器手勢問題

已在 CSS 設定 `touch-action: none`、`overscroll-behavior: none`，並在 JS 攔截 `wheel` + `ctrlKey`（縮放）與 `gesturestart`，應能避免觸控板雙指滑動觸發瀏覽器導航。

若仍遇到問題：
- **Mac Safari**: 系統偏好設定 → 觸控板 → 關閉「用兩指向左/右滑動切換頁面」
- **Mac Chrome**: 網址列按 F11 進入全螢幕
- **Windows Chrome / Edge**: 按 F11 進入全螢幕避免右鍵選單干擾
- **Windows 觸控板**: 若滑動會跳頁，可在控制台 → 裝置和印表機 → 觸控板設定關閉邊緣滑動手勢

## 已知限制

- 此版本無存檔，重新整理後會從第 1 關解鎖狀態重新開始
- 螢幕寬度低於 900px 可能 UI 擁擠（專為 MacBook 設計）

## 上架 / 部署到網站

遊戲是純前端（HTML + CSS + JavaScript），不需要後端，可以部署到任何靜態站主機。推薦三種免費方案：

### 🥇 方案 A：GitHub Pages（最簡單）

```bash
# 1. 把整個 game claude 資料夾推上一個 GitHub repo
cd "/Users/user/Desktop/game claude"
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/你的帳號/magic-runes.git
git push -u origin main

# 2. 在 GitHub repo 設定頁 → Pages → Source 選 "main" branch root
# 3. 等 1~2 分鐘, 網址會是 https://你的帳號.github.io/magic-runes/
```

### 🥈 方案 B：Netlify 拖曳部署（不用 Git）

1. 到 [netlify.com](https://app.netlify.com/drop)
2. 把整個 `game claude` 資料夾 **直接拖進去**
3. 立即得到隨機網址如 `amazing-rune-xxx.netlify.app`
4. 可在 Netlify 設定自訂網域

### 🥉 方案 C：Cloudflare Pages / Vercel

兩者都支援 Git 連動自動部署，流程類似 GitHub Pages，速度更快（全球 CDN）。

---

### 注意事項

- **多人連線** 會需要 HTTPS，上述三家都預設 HTTPS ✅
- **音效** 需要使用者先點擊一下畫面才會啟動（瀏覽器 autoplay policy）
- **localStorage** 每個網域獨立，換網域需重新儲存進度

祝你施法愉快 ✨
