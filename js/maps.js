/* ================================================================
   maps.js — 多人對戰地圖
   - 三張美術地圖: 草原 / 沼澤 / 火山
   - 每張圖含:
     - 背景繪製函式 (Canvas 程序化繪製)
     - 障礙物清單 (矩形/圓形, 可擋投射物, 玩家可躲避)
   - 障礙物尺寸皆為 "地圖百分比" 以適應不同畫布解析度
   ================================================================ */

(function (global) {
    'use strict';

    // 障礙物格式: { type:'rect'|'circle', xP, yP, wP/hP or rP, color, art }
    // xP yP wP hP rP 為 0-1 畫布百分比

    const MAPS = {
        grassland: {
            id: 'grassland',
            name: '翠綠草原',
            desc: '開闊的原野上散落幾塊岩石與灌木, 彼此都看得見',
            palette: {
                sky: ['#7ec7e0', '#a8ddd8'],
                ground: ['#6cb04a', '#3d7834'],
                accent: '#c9dc66'
            },
            obstacles: [
                { type: 'circle', xP: 0.25, yP: 0.35, rP: 0.04, art: 'rock' },
                { type: 'circle', xP: 0.72, yP: 0.42, rP: 0.05, art: 'rock' },
                { type: 'circle', xP: 0.5,  yP: 0.58, rP: 0.045, art: 'bush' },
                { type: 'circle', xP: 0.18, yP: 0.78, rP: 0.035, art: 'bush' },
                { type: 'circle', xP: 0.82, yP: 0.75, rP: 0.04, art: 'bush' },
                { type: 'rect',   xP: 0.38, yP: 0.20, wP: 0.08, hP: 0.035, art: 'log' },
                { type: 'rect',   xP: 0.58, yP: 0.72, wP: 0.10, hP: 0.035, art: 'log' }
            ]
        },
        swamp: {
            id: 'swamp',
            name: '暗影沼澤',
            desc: '霧氣迷濛, 腐木與泥灘中遮蔽視線',
            palette: {
                sky: ['#1e2a32', '#2e3a42'],
                ground: ['#3a4438', '#1a241e'],
                accent: '#5a7a48'
            },
            obstacles: [
                { type: 'circle', xP: 0.22, yP: 0.45, rP: 0.06, art: 'tree' },
                { type: 'circle', xP: 0.78, yP: 0.35, rP: 0.055, art: 'tree' },
                { type: 'circle', xP: 0.55, yP: 0.25, rP: 0.05, art: 'tree' },
                { type: 'circle', xP: 0.45, yP: 0.7, rP: 0.06, art: 'tree' },
                // 泥灘 (不擋投射但減速 — 簡化處理為障礙)
                { type: 'circle', xP: 0.35, yP: 0.55, rP: 0.07, art: 'puddle', passable: true },
                { type: 'circle', xP: 0.68, yP: 0.65, rP: 0.065, art: 'puddle', passable: true },
                { type: 'rect',   xP: 0.12, yP: 0.15, wP: 0.08, hP: 0.06, art: 'stump' },
                { type: 'rect',   xP: 0.85, yP: 0.82, wP: 0.08, hP: 0.06, art: 'stump' }
            ]
        },
        volcano: {
            id: 'volcano',
            name: '熔焰火山',
            desc: '熔岩四溢, 黑岩當屏障, 踩到岩漿會受傷',
            palette: {
                sky: ['#2a1208', '#4a1c0e'],
                ground: ['#3a1a10', '#1a0a06'],
                accent: '#ff6622'
            },
            obstacles: [
                { type: 'rect',   xP: 0.20, yP: 0.25, wP: 0.10, hP: 0.08, art: 'blackrock' },
                { type: 'rect',   xP: 0.72, yP: 0.30, wP: 0.10, hP: 0.08, art: 'blackrock' },
                { type: 'circle', xP: 0.50, yP: 0.40, rP: 0.06, art: 'blackrock' },
                { type: 'circle', xP: 0.30, yP: 0.70, rP: 0.07, art: 'blackrock' },
                { type: 'circle', xP: 0.78, yP: 0.72, rP: 0.065, art: 'blackrock' },
                // 岩漿 (damages 玩家, 不擋投射)
                { type: 'circle', xP: 0.45, yP: 0.20, rP: 0.08, art: 'lava', passable: true, damage: 12 },
                { type: 'circle', xP: 0.60, yP: 0.58, rP: 0.08, art: 'lava', passable: true, damage: 12 }
            ]
        },
        brawl: {
            id: 'brawl',
            name: '混沌戰場',
            desc: '大亂鬥專用競技場, 融合草原 / 沼澤 / 火山三種元素',
            // 4 個象限對應不同地形 palette, 由 drawBrawlBackground 分區繪製
            palette: {
                sky: ['#2a1a32', '#3a2a44'],
                ground: ['#2a3a2a', '#1a1e14'],
                accent: '#ff8844',
                grassSky: ['#7ec7e0', '#a8ddd8'],
                grassGround: ['#6cb04a', '#3d7834'],
                swampSky: ['#2e3a42', '#1e2a32'],
                swampGround: ['#3a4438', '#1a241e'],
                volcanoSky: ['#4a1c0e', '#2a1208'],
                volcanoGround: ['#3a1a10', '#1a0a06']
            },
            obstacles: [
                // 左上: 草原區 (岩石 + 灌木 + 小花)
                { type: 'circle', xP: 0.14, yP: 0.18, rP: 0.040, art: 'rock' },
                { type: 'circle', xP: 0.26, yP: 0.12, rP: 0.032, art: 'bush' },
                { type: 'circle', xP: 0.18, yP: 0.32, rP: 0.030, art: 'bush' },
                { type: 'rect',   xP: 0.32, yP: 0.24, wP: 0.07, hP: 0.028, art: 'log' },
                // 右上: 沼澤區 (樹 + 泥灘)
                { type: 'circle', xP: 0.72, yP: 0.15, rP: 0.050, art: 'tree' },
                { type: 'circle', xP: 0.86, yP: 0.22, rP: 0.040, art: 'tree' },
                { type: 'circle', xP: 0.78, yP: 0.32, rP: 0.060, art: 'puddle', passable: true },
                { type: 'rect',   xP: 0.62, yP: 0.30, wP: 0.07, hP: 0.050, art: 'stump' },
                // 左下: 火山區 (黑岩 + 岩漿)
                { type: 'rect',   xP: 0.14, yP: 0.66, wP: 0.09, hP: 0.065, art: 'blackrock' },
                { type: 'circle', xP: 0.24, yP: 0.80, rP: 0.048, art: 'blackrock' },
                { type: 'circle', xP: 0.08, yP: 0.83, rP: 0.060, art: 'lava', passable: true, damage: 10 },
                // 右下: 混合 (樹 + 黑岩)
                { type: 'circle', xP: 0.78, yP: 0.72, rP: 0.045, art: 'tree' },
                { type: 'rect',   xP: 0.68, yP: 0.82, wP: 0.08, hP: 0.055, art: 'blackrock' },
                { type: 'circle', xP: 0.90, yP: 0.68, rP: 0.040, art: 'rock' },
                // 中央區: 核心交戰 (樞紐 + 十字岩漿)
                { type: 'circle', xP: 0.48, yP: 0.50, rP: 0.055, art: 'blackrock' },
                { type: 'circle', xP: 0.40, yP: 0.40, rP: 0.035, art: 'rock' },
                { type: 'circle', xP: 0.58, yP: 0.58, rP: 0.035, art: 'bush' },
                { type: 'circle', xP: 0.50, yP: 0.26, rP: 0.055, art: 'lava', passable: true, damage: 10 },
                { type: 'circle', xP: 0.50, yP: 0.74, rP: 0.055, art: 'lava', passable: true, damage: 10 }
            ]
        }
    };

    /** 取得地圖 (正規化後的絕對座標) */
    function getAbs(mapId, w, h) {
        const m = MAPS[mapId];
        if (!m) return null;
        const obs = m.obstacles.map(o => ({
            type: o.type,
            x: o.xP * w,
            y: o.yP * h,
            w: (o.wP || 0) * w,
            h: (o.hP || 0) * h,
            r: (o.rP || 0) * Math.min(w, h),
            art: o.art,
            passable: !!o.passable,
            damage: o.damage || 0
        }));
        return { id: mapId, map: m, obstacles: obs };
    }

    // ==== 繪圖 ====
    function drawBackground(mapId, ctx, w, h) {
        const m = MAPS[mapId];
        if (!m) return;
        // brawl 自訂繪製 (四象限融合三種地形)
        if (mapId === 'brawl') {
            drawBrawlBackground(ctx, w, h, m.palette);
            return;
        }
        const grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, m.palette.sky[0]);
        grd.addColorStop(0.5, m.palette.sky[1]);
        grd.addColorStop(0.5, m.palette.ground[0]);
        grd.addColorStop(1, m.palette.ground[1]);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);

        if (mapId === 'grassland') drawGrasslandExtras(ctx, w, h);
        else if (mapId === 'swamp') drawSwampExtras(ctx, w, h);
        else if (mapId === 'volcano') drawVolcanoExtras(ctx, w, h);
    }

    // 大亂鬥專屬背景: 四象限融合 (左上草原, 右上沼澤, 左下火山, 右下混合)
    function drawBrawlBackground(ctx, w, h, P) {
        const halfW = w / 2, halfH = h / 2;
        // 左上 — 草原 (明亮綠色)
        drawQuadrantGrad(ctx, 0, 0, halfW, halfH, P.grassSky[0], P.grassGround[1]);
        // 右上 — 沼澤 (墨綠陰沉)
        drawQuadrantGrad(ctx, halfW, 0, halfW, halfH, P.swampSky[0], P.swampGround[1]);
        // 左下 — 火山 (赤紅焦黑)
        drawQuadrantGrad(ctx, 0, halfH, halfW, halfH, P.volcanoSky[0], P.volcanoGround[1]);
        // 右下 — 神祕紫 (混合區)
        drawQuadrantGrad(ctx, halfW, halfH, halfW, halfH, '#4a2a5e', '#1a0a24');

        // 中央圓形聚光 — 提示是競技場中心
        ctx.save();
        const cg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.32);
        cg.addColorStop(0, 'rgba(255, 220, 180, 0.18)');
        cg.addColorStop(0.6, 'rgba(255, 180, 130, 0.08)');
        cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // 象限分界線 (半透明, 提示玩家)
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(halfW, 0); ctx.lineTo(halfW, h);
        ctx.moveTo(0, halfH); ctx.lineTo(w, halfH);
        ctx.stroke();
        ctx.restore();

        // 左上象限: 草原花點
        for (let i = 0; i < 18; i++) {
            const x = (i * 43) % halfW;
            const y = (i * 71) % halfH;
            ctx.fillStyle = i % 3 === 0 ? '#ffe066' : (i % 3 === 1 ? '#ff88aa' : '#ffffff');
            ctx.beginPath();
            ctx.arc(x + 10, y + 10, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
        // 右上象限: 沼澤霧
        ctx.fillStyle = 'rgba(130, 150, 120, 0.18)';
        for (let i = 0; i < 4; i++) {
            const y = (i * halfH / 4) + 15;
            ctx.fillRect(halfW, y, halfW, 22);
        }
        // 左下象限: 火山火花
        for (let i = 0; i < 20; i++) {
            const x = ((i * 97) % halfW);
            const y = halfH + ((i * 41) % halfH);
            ctx.fillStyle = i % 2 === 0 ? '#ff5522' : '#ffcc33';
            ctx.beginPath();
            ctx.arc(x, y, 1.4, 0, Math.PI * 2);
            ctx.fill();
        }
        // 右下象限: 紫色魔光點
        for (let i = 0; i < 15; i++) {
            const x = halfW + ((i * 83) % halfW);
            const y = halfH + ((i * 57) % halfH);
            ctx.fillStyle = i % 2 === 0 ? '#bb77ff' : '#ffddff';
            ctx.beginPath();
            ctx.arc(x, y, 1.6, 0, Math.PI * 2);
            ctx.fill();
        }

        // 地形邊緣柔化 — 在分界線附近疊一點漸層
        ctx.save();
        ctx.globalAlpha = 0.35;
        // 垂直線左右融合帶
        const bg1 = ctx.createLinearGradient(halfW - 60, 0, halfW + 60, 0);
        bg1.addColorStop(0, 'rgba(0,0,0,0)');
        bg1.addColorStop(0.5, 'rgba(60, 40, 80, 0.3)');
        bg1.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bg1;
        ctx.fillRect(halfW - 60, 0, 120, h);
        // 水平線上下融合帶
        const bg2 = ctx.createLinearGradient(0, halfH - 60, 0, halfH + 60);
        bg2.addColorStop(0, 'rgba(0,0,0,0)');
        bg2.addColorStop(0.5, 'rgba(60, 40, 80, 0.3)');
        bg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bg2;
        ctx.fillRect(0, halfH - 60, w, 120);
        ctx.restore();
    }

    function drawQuadrantGrad(ctx, x, y, w, h, topColor, bottomColor) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, topColor);
        g.addColorStop(1, bottomColor);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
    }

    function drawGrasslandExtras(ctx, w, h) {
        // 遠山
        ctx.fillStyle = 'rgba(70, 120, 90, 0.5)';
        ctx.beginPath();
        ctx.moveTo(0, h * 0.42);
        for (let x = 0; x <= w; x += 30) {
            const y = h * (0.38 + 0.04 * Math.sin(x * 0.01));
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h * 0.5);
        ctx.lineTo(0, h * 0.5);
        ctx.closePath();
        ctx.fill();
        // 草地橫紋
        ctx.strokeStyle = 'rgba(200, 240, 120, 0.15)';
        ctx.lineWidth = 1;
        for (let y = h * 0.55; y < h; y += 22) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(w, y);
            ctx.stroke();
        }
        // 小花點
        for (let i = 0; i < 30; i++) {
            const x = ((i * 137.5) % w);
            const y = h * 0.55 + ((i * 73) % (h * 0.45));
            ctx.fillStyle = i % 3 === 0 ? '#ffe066' : (i % 3 === 1 ? '#ff88aa' : '#ffffff');
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawSwampExtras(ctx, w, h) {
        // 霧
        ctx.fillStyle = 'rgba(120, 130, 110, 0.18)';
        for (let i = 0; i < 5; i++) {
            const y = h * (0.3 + i * 0.12);
            ctx.fillRect(0, y, w, 30);
        }
        // 遠景枯枝樹影
        ctx.strokeStyle = 'rgba(30, 40, 30, 0.55)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
            const x = (i + 0.5) * w / 6;
            ctx.beginPath();
            ctx.moveTo(x, h * 0.52);
            ctx.lineTo(x - 10, h * 0.28);
            ctx.lineTo(x - 5, h * 0.22);
            ctx.moveTo(x, h * 0.4);
            ctx.lineTo(x + 12, h * 0.3);
            ctx.stroke();
        }
    }

    function drawVolcanoExtras(ctx, w, h) {
        // 火光 (上方)
        const glow = ctx.createRadialGradient(w / 2, h * 0.1, 0, w / 2, h * 0.1, w * 0.6);
        glow.addColorStop(0, 'rgba(255, 100, 30, 0.5)');
        glow.addColorStop(1, 'rgba(255, 50, 10, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h * 0.6);
        // 火山輪廓
        ctx.fillStyle = '#1a0a04';
        ctx.beginPath();
        ctx.moveTo(0, h * 0.5);
        ctx.lineTo(w * 0.3, h * 0.3);
        ctx.lineTo(w * 0.4, h * 0.34);
        ctx.lineTo(w * 0.45, h * 0.28);
        ctx.lineTo(w * 0.55, h * 0.26);
        ctx.lineTo(w * 0.7, h * 0.32);
        ctx.lineTo(w, h * 0.48);
        ctx.lineTo(w, h * 0.5);
        ctx.closePath();
        ctx.fill();
        // 火山口岩漿
        ctx.fillStyle = '#ff6622';
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.28, 10, 0, Math.PI * 2);
        ctx.fill();
        // 地面火花
        for (let i = 0; i < 25; i++) {
            const x = ((i * 97) % w);
            const y = h * 0.55 + ((i * 41) % (h * 0.45));
            ctx.fillStyle = i % 2 === 0 ? '#ff5522' : '#ffcc33';
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /** 繪製障礙物 (在玩家/敵人之上, 投射物判斷前) */
    function drawObstacles(obstacles, ctx) {
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            drawObstacle(o, ctx);
        }
    }

    function drawObstacle(o, ctx) {
        ctx.save();
        switch (o.art) {
            case 'rock':
                ctx.fillStyle = '#8a8a90';
                drawShape(ctx, o);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath();
                ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.55, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#4a4a50';
                ctx.lineWidth = 2;
                drawShape(ctx, o, true);
                break;
            case 'bush':
                ctx.fillStyle = '#2e5a24';
                ctx.beginPath();
                ctx.arc(o.x - o.r * 0.3, o.y + o.r * 0.1, o.r * 0.9, 0, Math.PI * 2);
                ctx.arc(o.x + o.r * 0.3, o.y + o.r * 0.2, o.r * 0.85, 0, Math.PI * 2);
                ctx.arc(o.x, o.y - o.r * 0.2, o.r * 0.9, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(200, 255, 100, 0.3)';
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    ctx.beginPath();
                    ctx.arc(o.x + Math.cos(a) * o.r * 0.6, o.y + Math.sin(a) * o.r * 0.6, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                break;
            case 'log':
                ctx.fillStyle = '#6b4220';
                ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
                ctx.strokeStyle = '#3a2410';
                ctx.lineWidth = 1;
                for (let i = 1; i < 3; i++) {
                    ctx.beginPath();
                    const y = o.y - o.h / 2 + (i * o.h / 3);
                    ctx.moveTo(o.x - o.w / 2, y);
                    ctx.lineTo(o.x + o.w / 2, y);
                    ctx.stroke();
                }
                break;
            case 'tree': {
                // 樹幹
                ctx.fillStyle = '#3a2614';
                ctx.fillRect(o.x - o.r * 0.2, o.y - o.r * 0.1, o.r * 0.4, o.r * 1.1);
                // 樹冠
                ctx.fillStyle = '#2a3a1c';
                ctx.beginPath();
                ctx.arc(o.x, o.y - o.r * 0.2, o.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#3e5a2a';
                ctx.beginPath();
                ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.4, o.r * 0.6, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'puddle':
                ctx.fillStyle = 'rgba(40, 60, 30, 0.75)';
                ctx.beginPath();
                ctx.ellipse(o.x, o.y, o.r * 1.2, o.r * 0.6, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(100, 140, 70, 0.4)';
                ctx.lineWidth = 1;
                ctx.stroke();
                break;
            case 'stump':
                ctx.fillStyle = '#6b4a28';
                ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
                ctx.fillStyle = '#3a2414';
                ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h * 0.3);
                for (let i = 0; i < 3; i++) {
                    ctx.strokeStyle = 'rgba(90, 60, 30, 0.6)';
                    ctx.beginPath();
                    ctx.ellipse(o.x, o.y - o.h / 2 + 3, o.w / 3 - i * 3, 2, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                break;
            case 'blackrock':
                ctx.fillStyle = '#1a0a08';
                drawShape(ctx, o);
                ctx.strokeStyle = '#ff6622';
                ctx.lineWidth = 2;
                drawShape(ctx, o, true);
                break;
            case 'lava': {
                const grd = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
                grd.addColorStop(0, '#ffff88');
                grd.addColorStop(0.3, '#ff6622');
                grd.addColorStop(1, '#cc2200');
                ctx.fillStyle = grd;
                ctx.beginPath();
                ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
                ctx.fill();
                // 冒泡
                const t = Date.now() / 300;
                for (let i = 0; i < 3; i++) {
                    const a = t + i * Math.PI * 2 / 3;
                    const br = o.r * 0.5 + Math.sin(t * 1.5 + i) * o.r * 0.2;
                    ctx.fillStyle = '#ffff99';
                    ctx.beginPath();
                    ctx.arc(o.x + Math.cos(a) * br, o.y + Math.sin(a) * br, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
                break;
            }
            default:
                ctx.fillStyle = '#666';
                drawShape(ctx, o);
        }
        ctx.restore();
    }

    function drawShape(ctx, o, stroke) {
        if (o.type === 'circle') {
            ctx.beginPath();
            ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
            if (stroke) ctx.stroke(); else ctx.fill();
        } else if (o.type === 'rect') {
            if (stroke) ctx.strokeRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
            else ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
        }
    }

    /** 檢查點是否在障礙物內 (投射物碰撞用) */
    function pointInObstacle(x, y, o) {
        if (o.passable) return false;
        if (o.type === 'circle') {
            const dx = x - o.x, dy = y - o.y;
            return dx * dx + dy * dy < o.r * o.r;
        } else {
            return Math.abs(x - o.x) < o.w / 2 && Math.abs(y - o.y) < o.h / 2;
        }
    }

    /** 圓與障礙物碰撞 (玩家用) */
    function circleHitObstacle(cx, cy, radius, o) {
        if (o.passable) return false;
        if (o.type === 'circle') {
            const dx = cx - o.x, dy = cy - o.y;
            return dx * dx + dy * dy < (radius + o.r) * (radius + o.r);
        } else {
            const nearestX = Math.max(o.x - o.w / 2, Math.min(cx, o.x + o.w / 2));
            const nearestY = Math.max(o.y - o.h / 2, Math.min(cy, o.y + o.h / 2));
            const dx = cx - nearestX, dy = cy - nearestY;
            return dx * dx + dy * dy < radius * radius;
        }
    }

    /** 取得點位置上的踩踏傷害 (lava 等) */
    function getGroundDamage(obstacles, x, y) {
        for (let i = 0; i < obstacles.length; i++) {
            const o = obstacles[i];
            if (o.damage > 0 && pointInObstacleAlways(x, y, o)) {
                return o.damage;
            }
        }
        return 0;
    }

    function pointInObstacleAlways(x, y, o) {
        if (o.type === 'circle') {
            const dx = x - o.x, dy = y - o.y;
            return dx * dx + dy * dy < o.r * o.r;
        }
        return Math.abs(x - o.x) < o.w / 2 && Math.abs(y - o.y) < o.h / 2;
    }

    global.Maps = {
        MAPS: MAPS,
        list: () => Object.keys(MAPS).map(k => MAPS[k]),
        get: (id) => MAPS[id],
        getAbs: getAbs,
        drawBackground: drawBackground,
        drawObstacles: drawObstacles,
        pointInObstacle: pointInObstacle,
        circleHitObstacle: circleHitObstacle,
        getGroundDamage: getGroundDamage
    };
})(window);
