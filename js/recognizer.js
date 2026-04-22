/* ================================================================
   recognizer.js — $1 Unistroke Recognizer
   參考論文: Wobbrock, Wilson & Li (2007)
   https://depts.washington.edu/madlab/proj/dollar/index.html

   用途: 將玩家繪製的軌跡與預設符文模板比對，回傳最相似的符文名稱與分數
   ================================================================ */

(function (global) {
    'use strict';

    // ==== 參數設定 (可在此調整識別靈敏度) ====
    const NUM_POINTS = 64;              // 重採樣點數
    const SQUARE_SIZE = 250;            // 正規化框尺寸
    const ORIGIN = { x: 0, y: 0 };
    const DIAGONAL = Math.sqrt(2 * SQUARE_SIZE * SQUARE_SIZE);
    const HALF_DIAGONAL = 0.5 * DIAGONAL;
    const ANGLE_RANGE = deg2rad(45);    // 搜尋最佳旋轉角度範圍
    const ANGLE_PRECISION = deg2rad(2); // 搜尋精度
    const PHI = 0.5 * (-1 + Math.sqrt(5)); // 黃金比例

    function deg2rad(d) { return d * Math.PI / 180; }

    // 產生圓形模板 (可指定方向與起始角度)
    function genCircle(cw, startAngle) {
        const pts = [];
        const cx = 40, cy = 40, r = 35;
        const dir = cw ? 1 : -1;
        const start = startAngle !== undefined ? startAngle : -Math.PI / 2;
        for (let i = 0; i <= 24; i++) {
            const a = start + dir * (i / 24) * Math.PI * 2;
            pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
        return pts;
    }

    // 產生螺旋模板 (由內而外, 可指定方向)
    function genSpiral(cw, turns) {
        const pts = [];
        const cx = 40, cy = 40;
        turns = turns || 2.5;
        const steps = 60;
        const dir = cw ? 1 : -1;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = dir * t * Math.PI * 2 * turns;
            const r = t * 35;
            pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
        return pts;
    }

    // ==== 符文模板點集 ====
    // 為了讓玩家畫法更有彈性, 每個符文可有多個模板 (取最接近者)
    const TEMPLATES = {
        // 火球 — 圓形 (順/逆時針皆可)
        fireball: [
            genCircle(true, -Math.PI / 2),    // 順時針從上開始
            genCircle(false, -Math.PI / 2),   // 逆時針
            genCircle(true, Math.PI)          // 順時針從左開始
        ],
        // 閃電 — 多種 Z / 閃電形 (寬鬆識別)
        lightning: [
            // 經典 Z (7 點)
            [{x:0,y:0},{x:40,y:0},{x:80,y:0},{x:40,y:40},{x:0,y:80},{x:40,y:80},{x:80,y:80}],
            [{x:80,y:0},{x:40,y:0},{x:0,y:0},{x:40,y:40},{x:80,y:80},{x:40,y:80},{x:0,y:80}],
            // 簡化 Z (4 點角點版本, 畫法最自然)
            [{x:10,y:10},{x:80,y:10},{x:10,y:80},{x:80,y:80}],
            [{x:80,y:10},{x:10,y:10},{x:80,y:80},{x:10,y:80}],
            // 5 點 Z (上橫 + 斜線 + 下橫)
            [{x:0,y:0},{x:80,y:0},{x:40,y:40},{x:0,y:80},{x:80,y:80}],
            [{x:80,y:0},{x:0,y:0},{x:40,y:40},{x:80,y:80},{x:0,y:80}],
            // 更有角度的閃電鋸齒
            [{x:25,y:0},{x:60,y:30},{x:30,y:45},{x:70,y:80}],
            [{x:60,y:0},{x:25,y:30},{x:55,y:45},{x:20,y:80}],
            // 尖銳 Z (上下極端、中間交叉)
            [{x:5,y:5},{x:75,y:15},{x:15,y:65},{x:75,y:75}]
        ],
        // 冰刺 — 三角形 (向上/向下尖)
        icespike: [
            [{x:40,y:0},{x:20,y:35},{x:0,y:70},{x:40,y:70},{x:80,y:70},{x:60,y:35},{x:40,y:0}],
            [{x:0,y:0},{x:40,y:0},{x:80,y:0},{x:60,y:35},{x:40,y:70},{x:20,y:35},{x:0,y:0}],
            // V / ^ 也視為冰刺
            [{x:0,y:70},{x:40,y:0},{x:80,y:70}]
        ],
        // 治療 — 十字 (只保留清楚的兩種畫法, 避免 X 跟閃電/新符文混淆)
        heal: [
            [{x:0,y:40},{x:40,y:40},{x:80,y:40},{x:40,y:40},{x:40,y:0},{x:40,y:40},{x:40,y:80}],
            [{x:40,y:0},{x:40,y:40},{x:40,y:80},{x:40,y:40},{x:0,y:40},{x:40,y:40},{x:80,y:40}]
        ],
        // 護盾 — 方形 (順/逆時針 + 菱形)
        shield: [
            [{x:0,y:0},{x:40,y:0},{x:80,y:0},{x:80,y:40},{x:80,y:80},{x:40,y:80},{x:0,y:80},{x:0,y:40},{x:0,y:0}],
            [{x:0,y:0},{x:0,y:40},{x:0,y:80},{x:40,y:80},{x:80,y:80},{x:80,y:40},{x:80,y:0},{x:40,y:0},{x:0,y:0}],
            // 菱形 (旋轉 45° 的正方形)
            [{x:40,y:0},{x:80,y:40},{x:40,y:80},{x:0,y:40},{x:40,y:0}]
        ],
        // 隕石 — 螺旋 (順/逆皆可)
        meteor: [
            genSpiral(true, 2.5),
            genSpiral(false, 2.5),
            genSpiral(true, 2),
            genSpiral(false, 2)
        ],
        // 風刃 — 橫線/箭頭
        wind: [
            [{x:0,y:40},{x:20,y:40},{x:40,y:40},{x:60,y:40},{x:80,y:40}],
            // 箭頭版 (橫線尾端微下再上)
            [{x:0,y:40},{x:30,y:40},{x:60,y:40},{x:80,y:40},{x:60,y:30},{x:60,y:50}]
        ],
        // 毒霧 — S 形 (多個寬鬆變體, 大幅降低誤判)
        poison: [
            // 經典 S: 右上→左中→右中→左下
            [{x:70,y:10},{x:30,y:25},{x:70,y:50},{x:30,y:75}],
            // 反 S: 左上→右中→左中→右下
            [{x:30,y:10},{x:70,y:25},{x:30,y:50},{x:70,y:75}],
            // 較平滑的 S (6 點)
            [{x:70,y:10},{x:50,y:15},{x:30,y:30},{x:45,y:45},{x:60,y:60},{x:40,y:75},{x:20,y:85}],
            // 反向平滑 S
            [{x:30,y:10},{x:50,y:15},{x:70,y:30},{x:55,y:45},{x:40,y:60},{x:60,y:75},{x:80,y:85}],
            // 寬版 S (3 段落)
            [{x:80,y:10},{x:20,y:30},{x:80,y:55},{x:20,y:80}],
            [{x:20,y:10},{x:80,y:30},{x:20,y:55},{x:80,y:80}]
        ],
        // 閃現 — V 形
        teleport: [
            [{x:0,y:0},{x:20,y:40},{x:40,y:80},{x:60,y:40},{x:80,y:0}],
            // 倒 V (ʌ)
            [{x:0,y:80},{x:20,y:40},{x:40,y:0},{x:60,y:40},{x:80,y:80}]
        ],
        // 聖光爆 — 五角星 (連筆畫法)
        holynova: [
            [{x:40,y:0},{x:72,y:80},{x:0,y:28},{x:80,y:28},{x:8,y:80},{x:40,y:0}],
            [{x:40,y:0},{x:8,y:80},{x:80,y:28},{x:0,y:28},{x:72,y:80},{x:40,y:0}]
        ],
        // 利刃斬 — 彎弧斬擊 (曲線使其在旋轉正規化後仍具辨識度)
        // 純斜線會與風刃的橫線在 $1 規範化後撞型; 改用弧線區分
        slash: [
            // 右上到左下 (向內彎)
            [{x:80,y:0},{x:70,y:5},{x:58,y:15},{x:48,y:28},{x:38,y:42},{x:28,y:58},{x:20,y:72},{x:10,y:82}],
            // 左上到右下
            [{x:0,y:0},{x:10,y:5},{x:22,y:15},{x:32,y:28},{x:42,y:42},{x:52,y:58},{x:60,y:72},{x:70,y:82}],
            // 向外彎版本 (玩家畫法變體)
            [{x:80,y:10},{x:60,y:18},{x:45,y:32},{x:35,y:48},{x:25,y:62},{x:12,y:75},{x:5,y:85}]
        ],
        // 大地轟擊 — W 形 (近戰 AOE)
        groundslam: [
            [{x:0,y:0},{x:25,y:80},{x:50,y:0},{x:75,y:80}],
            // M 形也接受 (反向 W)
            [{x:0,y:80},{x:25,y:0},{x:50,y:80},{x:75,y:0}]
        ],
        // 吸血之觸 — C 形 (近戰 lifesteal)
        blooddrain: [
            [{x:80,y:10},{x:50,y:0},{x:20,y:15},{x:0,y:40},{x:20,y:65},{x:50,y:80},{x:80,y:70}],
            [{x:0,y:10},{x:30,y:0},{x:60,y:15},{x:80,y:40},{x:60,y:65},{x:30,y:80},{x:0,y:70}]
        ],
        // 魔靈召喚 — Ω 形 (倒 U 底部兩腳)
        summon: [
            // 倒 U
            [{x:0,y:80},{x:0,y:40},{x:20,y:15},{x:40,y:0},{x:60,y:15},{x:80,y:40},{x:80,y:80}],
            // 反向 (從右下開始)
            [{x:80,y:80},{x:80,y:40},{x:60,y:15},{x:40,y:0},{x:20,y:15},{x:0,y:40},{x:0,y:80}],
            // 簡化 5 點
            [{x:0,y:80},{x:10,y:30},{x:40,y:0},{x:70,y:30},{x:80,y:80}]
        ]
    };

    // ================================================================
    // 核心演算法
    // ================================================================

    /** 計算兩點距離 */
    function distance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /** 計算路徑總長 */
    function pathLength(pts) {
        let d = 0;
        for (let i = 1; i < pts.length; i++) d += distance(pts[i - 1], pts[i]);
        return d;
    }

    /**
     * 重新採樣為 n 個等距點，消除繪製速度差異造成的影響
     */
    function resample(pts, n) {
        if (pts.length < 2) return pts.slice();
        const I = pathLength(pts) / (n - 1);
        let D = 0;
        const newPts = [pts[0]];
        const src = pts.slice();
        for (let i = 1; i < src.length; i++) {
            const d = distance(src[i - 1], src[i]);
            if (D + d >= I) {
                const qx = src[i - 1].x + ((I - D) / d) * (src[i].x - src[i - 1].x);
                const qy = src[i - 1].y + ((I - D) / d) * (src[i].y - src[i - 1].y);
                const q = { x: qx, y: qy };
                newPts.push(q);
                src.splice(i, 0, q);
                D = 0;
            } else {
                D += d;
            }
        }
        // 浮點誤差補齊
        while (newPts.length < n) newPts.push(src[src.length - 1]);
        return newPts;
    }

    /** 求指示性角 (起點與質心的連線角度) */
    function indicativeAngle(pts) {
        const c = centroid(pts);
        return Math.atan2(c.y - pts[0].y, c.x - pts[0].x);
    }

    /** 計算質心 */
    function centroid(pts) {
        let x = 0, y = 0;
        for (const p of pts) { x += p.x; y += p.y; }
        return { x: x / pts.length, y: y / pts.length };
    }

    /** 以質心為中心旋轉 */
    function rotateBy(pts, radians) {
        const c = centroid(pts);
        const cos = Math.cos(radians), sin = Math.sin(radians);
        return pts.map(p => {
            const dx = p.x - c.x, dy = p.y - c.y;
            return {
                x: dx * cos - dy * sin + c.x,
                y: dx * sin + dy * cos + c.y
            };
        });
    }

    /** 計算邊界框 */
    function boundingBox(pts) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    /** 縮放至 size x size 正方形 */
    function scaleTo(pts, size) {
        const B = boundingBox(pts);
        return pts.map(p => ({
            x: p.x * (size / (B.width || 1)),
            y: p.y * (size / (B.height || 1))
        }));
    }

    /** 平移到原點 */
    function translateTo(pts, origin) {
        const c = centroid(pts);
        return pts.map(p => ({ x: p.x + origin.x - c.x, y: p.y + origin.y - c.y }));
    }

    /** 計算兩組點的平均距離 (已假設長度相同) */
    function pathDistance(a, b) {
        let d = 0;
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) d += distance(a[i], b[i]);
        return d / n;
    }

    /** 以旋轉角度 theta 後比對 */
    function distanceAtAngle(pts, template, radians) {
        const newPts = rotateBy(pts, radians);
        return pathDistance(newPts, template);
    }

    /** 以黃金分割搜尋最佳旋轉角度，回傳最小距離 */
    function distanceAtBestAngle(pts, template) {
        let a = -ANGLE_RANGE;
        let b = ANGLE_RANGE;
        let x1 = PHI * a + (1 - PHI) * b;
        let f1 = distanceAtAngle(pts, template, x1);
        let x2 = (1 - PHI) * a + PHI * b;
        let f2 = distanceAtAngle(pts, template, x2);
        while (Math.abs(b - a) > ANGLE_PRECISION) {
            if (f1 < f2) {
                b = x2; x2 = x1; f2 = f1;
                x1 = PHI * a + (1 - PHI) * b;
                f1 = distanceAtAngle(pts, template, x1);
            } else {
                a = x1; x1 = x2; f1 = f2;
                x2 = (1 - PHI) * a + PHI * b;
                f2 = distanceAtAngle(pts, template, x2);
            }
        }
        return Math.min(f1, f2);
    }

    /** 完整正規化流程 */
    function preprocess(pts) {
        let processed = resample(pts, NUM_POINTS);
        const radians = indicativeAngle(processed);
        processed = rotateBy(processed, -radians);
        processed = scaleTo(processed, SQUARE_SIZE);
        processed = translateTo(processed, ORIGIN);
        return processed;
    }

    // ==== 預先正規化所有模板 (每個符文可有多個模板) ====
    const PROCESSED_TEMPLATES = {};
    for (const name in TEMPLATES) {
        const arr = TEMPLATES[name];
        PROCESSED_TEMPLATES[name] = arr.map(t => preprocess(t));
    }

    // ================================================================
    // 對外 API
    // ================================================================

    /**
     * 識別玩家繪製的點集 — 附上置信度 margin
     * @returns {{name,score,accuracy,margin,runner}|null}
     *   margin: 最佳與次佳的分差 (越大越明確)
     *   runner: 次佳符文名
     */
    function recognize(points) {
        if (!points || points.length < 5) return null;
        const candidate = preprocess(points);
        // 每個符文取該符文所有模板中的最小距離 (再跨符文比較)
        const runeDists = {};
        for (const name in PROCESSED_TEMPLATES) {
            const templates = PROCESSED_TEMPLATES[name];
            let runeMin = Infinity;
            for (let i = 0; i < templates.length; i++) {
                const d = distanceAtBestAngle(candidate, templates[i]);
                if (d < runeMin) runeMin = d;
            }
            runeDists[name] = runeMin;
        }
        // 排序找出最佳與次佳
        let best = Infinity, bestName = null, second = Infinity, secondName = null;
        for (const name in runeDists) {
            const d = runeDists[name];
            if (d < best) {
                second = best; secondName = bestName;
                best = d; bestName = name;
            } else if (d < second) {
                second = d; secondName = name;
            }
        }
        const score = 1 - best / HALF_DIAGONAL;
        const secondScore = 1 - second / HALF_DIAGONAL;
        return {
            name: bestName,
            score: score,
            accuracy: Math.max(0, score),
            margin: score - secondScore,
            runner: secondName,
            runnerScore: Math.max(0, secondScore)
        };
    }

    /**
     * 取得符文第一個模板 (供練習模式顯示範例)
     */
    function getTemplate(name) {
        const t = TEMPLATES[name];
        if (!t || !t.length) return null;
        return t[0].map(p => ({ x: p.x, y: p.y }));
    }

    /**
     * 列出所有符文名稱
     */
    function listRunes() {
        return Object.keys(TEMPLATES);
    }

    // 匯出
    global.Recognizer = {
        recognize,
        getTemplate,
        listRunes,
        // 預設閾值 (避免誤判，稍嚴一點)
        THRESHOLD: 0.6,
        CRITICAL_THRESHOLD: 0.82,
        // 歧義檢查: 最佳與次佳分差至少要這麼大才能接受
        MIN_MARGIN: 0.04
    };
})(window);
