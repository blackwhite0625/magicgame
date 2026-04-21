/* ================================================================
   particles.js — 粒子特效系統 (效能優化版)
   - Free-list 物件池 O(1) 分配/回收
   - 預解析顏色 (rgb) 避免每幀 string parse
   - 批次渲染 (按 blend mode 分組，減少狀態切換)
   - 取消個別粒子 shadowBlur，改用疊加混合產生光暈
   - 離屏剔除 (off-screen culling)
   ================================================================ */

(function (global) {
    'use strict';

    const POOL_SIZE = 2500;

    // 預建 particle 物件 (避免執行期 allocation)
    function createParticle() {
        return {
            active: false,
            x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
            life: 0, maxLife: 0,
            size: 0, sizeDecay: 0,
            // 預解析後的 RGB
            r1: 255, g1: 255, b1: 255,
            r2: 255, g2: 255, b2: 255,
            dragCoeff: 0,         // 預計算的阻力係數
            fade: true,
            blend: 'lighter',
            shape: 0,             // 0=circle 1=spark 2=star (整數比較比字串快)
            rotation: 0,
            spin: 0
        };
    }

    const pool = new Array(POOL_SIZE);
    const freeList = [];
    for (let i = 0; i < POOL_SIZE; i++) {
        pool[i] = createParticle();
        freeList.push(pool[i]);
    }

    const activeParticles = [];

    // 色彩解析快取
    const colorCache = new Map();

    function parseColor(c) {
        if (colorCache.has(c)) return colorCache.get(c);
        let r = 255, g = 255, b = 255;
        if (typeof c === 'string' && c.startsWith('#')) {
            let hex = c.slice(1);
            if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            r = parseInt(hex.slice(0, 2), 16);
            g = parseInt(hex.slice(2, 4), 16);
            b = parseInt(hex.slice(4, 6), 16);
        }
        const result = { r, g, b };
        colorCache.set(c, result);
        return result;
    }

    function shapeIndex(s) {
        if (s === 'spark') return 1;
        if (s === 'star') return 2;
        return 0;
    }

    // 用於池耗盡回收的索引 (避免 shift O(n))
    let recycleIdx = 0;

    /**
     * 產生粒子 — 與舊 API 相容
     * 池耗盡時以環狀索引覆蓋舊粒子，O(1)
     */
    function spawn(opts) {
        let p;
        if (freeList.length) {
            p = freeList.pop();
        } else if (activeParticles.length > 0) {
            // 環狀索引 — 覆蓋某個活動粒子 (不需 shift)
            recycleIdx = (recycleIdx + 1) % activeParticles.length;
            p = activeParticles[recycleIdx];
            // 由於 p 仍在 activeParticles 中，後面不能再 push
            p.active = true;
            setParticleProps(p, opts);
            return p;
        } else {
            p = createParticle();
        }
        p.active = true;
        setParticleProps(p, opts);
        activeParticles.push(p);
        return p;
    }

    function setParticleProps(p, opts) {
        p.x = opts.x || 0;
        p.y = opts.y || 0;
        p.vx = opts.vx || 0;
        p.vy = opts.vy || 0;
        p.ax = opts.ax || 0;
        p.ay = opts.ay || 0;
        p.life = opts.life || 1;
        p.maxLife = p.life;
        p.size = opts.size || 3;
        p.sizeDecay = opts.sizeDecay !== undefined ? opts.sizeDecay : 0.5;
        const drag = opts.drag !== undefined ? opts.drag : 0.98;
        p.dragCoeff = (1 - drag) * 60;
        p.fade = opts.fade !== undefined ? opts.fade : true;
        p.blend = opts.blend || 'lighter';
        p.shape = shapeIndex(opts.shape);
        p.rotation = opts.rotation || 0;
        p.spin = opts.spin || 0;
        const c1 = parseColor(opts.color || '#fff');
        const c2 = parseColor(opts.color2 || opts.color || '#fff');
        p.r1 = c1.r; p.g1 = c1.g; p.b1 = c1.b;
        p.r2 = c2.r; p.g2 = c2.g; p.b2 = c2.b;
    }

    /**
     * 更新粒子 — 使用倒序 swap-pop 以 O(1) 移除
     */
    function update(dt) {
        for (let i = activeParticles.length - 1; i >= 0; i--) {
            const p = activeParticles[i];
            p.vx += p.ax * dt;
            p.vy += p.ay * dt;
            // 線性阻力近似 (快於 Math.pow)
            const dragMul = 1 - p.dragCoeff * dt;
            if (dragMul > 0) {
                p.vx *= dragMul;
                p.vy *= dragMul;
            } else {
                p.vx = 0; p.vy = 0;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.spin) p.rotation += p.spin * dt;
            p.life -= dt;
            if (p.life <= 0) {
                p.active = false;
                const last = activeParticles.length - 1;
                activeParticles[i] = activeParticles[last];
                activeParticles.pop();
                freeList.push(p);
            }
        }
    }

    // 渲染邊界 (可由外部設定以啟用剔除)
    let viewW = 3000, viewH = 3000;
    function setViewport(w, h) {
        viewW = w;
        viewH = h;
    }

    /**
     * 批次渲染 — 以 blend mode 分組，避免逐粒子 state 切換
     */
    function render(ctx) {
        if (activeParticles.length === 0) return;

        ctx.save();
        // 先渲染所有 additive 粒子 (大宗)
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = 0;
        renderGroup(ctx, 'lighter');
        // 再渲染 source-over
        ctx.globalCompositeOperation = 'source-over';
        renderGroup(ctx, 'source-over');
        ctx.restore();
    }

    function renderGroup(ctx, blend) {
        const cullMin = -80;
        const cullX = viewW + 80;
        const cullY = viewH + 80;
        const TWO_PI = 6.283185307179586;
        for (let i = 0; i < activeParticles.length; i++) {
            const p = activeParticles[i];
            if (p.blend !== blend) continue;
            if (p.x < cullMin || p.x > cullX || p.y < cullMin || p.y > cullY) continue;
            const t = p.life / p.maxLife;
            if (t <= 0) continue;
            const alpha = p.fade ? t : 1;
            if (alpha < 0.02) continue;
            const size = p.size * (1 - (1 - t) * p.sizeDecay);
            if (size < 0.5) continue;
            const r = (p.r2 + (p.r1 - p.r2) * t) | 0;
            const g = (p.g2 + (p.g1 - p.g2) * t) | 0;
            const b = (p.b2 + (p.b1 - p.b2) * t) | 0;
            ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
            if (p.shape === 0) {
                // 發光模擬: 外圈大半透明 + 內核不透明 (比 shadowBlur 快 10x)
                if (blend === 'lighter') {
                    ctx.globalAlpha = alpha * 0.35;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, size * 2.2, 0, TWO_PI);
                    ctx.fill();
                }
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, size, 0, TWO_PI);
                ctx.fill();
            } else if (p.shape === 1) {
                ctx.globalAlpha = alpha;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                ctx.fillRect(-size, -size * 0.15, size * 2, size * 0.3);
                ctx.restore();
            } else {
                ctx.globalAlpha = alpha;
                drawStar(ctx, p.x, p.y, size);
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawStar(ctx, cx, cy, outerR) {
        const innerR = outerR * 0.4;
        let rot = -1.5707963267948966;
        const step = Math.PI / 5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        for (let i = 0; i < 5; i++) {
            rot += step;
            ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
            rot += step;
            ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        }
        ctx.closePath();
        ctx.fill();
    }

    // ==== 特效預設 (生成量調低) ====

    function emitTrail(x, y, color) {
        color = color || '#bb88ff';
        spawn({
            x: x + (Math.random() - 0.5) * 3,
            y: y + (Math.random() - 0.5) * 3,
            vx: (Math.random() - 0.5) * 25,
            vy: (Math.random() - 0.5) * 25 - 8,
            life: 0.35,
            size: 2.5 + Math.random() * 2.5,
            color: color,
            color2: '#ffffff',
            drag: 0.92
        });
    }

    function emitCore(x, y, color) {
        spawn({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 0.2,
            size: 3.5,
            color: color || '#ffffff',
            color2: color || '#ffffff',
            drag: 0.9
        });
    }

    function burst(x, y, opts) {
        opts = opts || {};
        const count = opts.count || 24;
        const spread = opts.spread || 200;
        const life = opts.life || 0.8;
        const color = opts.color || '#ffcc66';
        const color2 = opts.color2 || '#ff4422';
        const size = opts.size || 4;
        const shape = opts.shape || 'circle';
        for (let i = 0; i < count; i++) {
            const a = (i / count) * 6.283185307179586 + Math.random() * 0.3;
            const s = spread * (0.5 + Math.random() * 0.5);
            spawn({
                x: x, y: y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life: life * (0.7 + Math.random() * 0.6),
                size: size * (0.6 + Math.random() * 0.8),
                color: color, color2: color2,
                drag: 0.94, shape: shape
            });
        }
    }

    function emitFireTrail(x, y) {
        // 由原本 2 顆降為 1 顆
        spawn({
            x: x + (Math.random() - 0.5) * 6,
            y: y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15 - 15,
            life: 0.4,
            size: 4 + Math.random() * 3,
            color: '#ffcc44', color2: '#ff2200',
            drag: 0.9
        });
    }

    function emitLightningBolt(x1, y1, x2, y2) {
        const segments = 6;
        const jitter = 20;
        let px = x1, py = y1;
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const lx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * jitter;
            const ly = y1 + (y2 - y1) * t + (Math.random() - 0.5) * jitter;
            const dx = lx - px, dy = ly - py;
            const len = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(1, Math.floor(len / 10));
            for (let s = 0; s < steps; s++) {
                const pt = s / steps;
                spawn({
                    x: px + dx * pt,
                    y: py + dy * pt,
                    vx: (Math.random() - 0.5) * 30,
                    vy: (Math.random() - 0.5) * 30,
                    life: 0.3,
                    size: 3,
                    color: '#ffffff',
                    color2: '#88ccff',
                    drag: 0.85
                });
            }
            px = lx; py = ly;
        }
    }

    function emitIceShatter(x, y) {
        for (let i = 0; i < 18; i++) {
            const a = Math.random() * 6.283185307179586;
            const s = 60 + Math.random() * 160;
            spawn({
                x: x, y: y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life: 0.7,
                size: 4 + Math.random() * 3,
                color: '#bbeeff',
                color2: '#4488cc',
                drag: 0.95,
                shape: 'spark',
                rotation: a,
                spin: (Math.random() - 0.5) * 8
            });
        }
    }

    function emitHealGlow(x, y) {
        for (let i = 0; i < 22; i++) {
            spawn({
                x: x + (Math.random() - 0.5) * 60,
                y: y + 40 + (Math.random() - 0.5) * 80,
                vx: (Math.random() - 0.5) * 25,
                vy: -60 - Math.random() * 80,
                ay: 20,
                life: 1.0,
                size: 3 + Math.random() * 2,
                color: '#aaffaa',
                color2: '#ffffff',
                drag: 0.98
            });
        }
        for (let i = 0; i < 8; i++) {
            spawn({
                x: x + (Math.random() - 0.5) * 20,
                y: y + (Math.random() - 0.5) * 80,
                vy: -30, life: 0.6, size: 8,
                color: '#88ff88', color2: '#ffffff',
                drag: 0.99
            });
        }
    }

    function emitShieldForm(x, y, radius) {
        radius = radius || 60;
        for (let i = 0; i < 26; i++) {
            const a = (i / 26) * 6.283185307179586;
            const startR = radius * 2;
            spawn({
                x: x + Math.cos(a) * startR,
                y: y + Math.sin(a) * startR,
                vx: -Math.cos(a) * 200,
                vy: -Math.sin(a) * 200,
                life: 0.45,
                size: 4,
                color: '#88ddff', color2: '#ffffff',
                drag: 0.9
            });
        }
    }

    function emitMeteorTrail(x, y) {
        // 由原本 5 顆降為 2 顆
        for (let i = 0; i < 2; i++) {
            spawn({
                x: x + (Math.random() - 0.5) * 15,
                y: y + (Math.random() - 0.5) * 15,
                vx: (Math.random() - 0.5) * 30,
                vy: (Math.random() - 0.5) * 30 - 25,
                life: 0.55,
                size: 5 + Math.random() * 3,
                color: '#ffdd88', color2: '#ff2200',
                drag: 0.92
            });
        }
    }

    function emitMeteorImpact(x, y) {
        burst(x, y, {
            count: 50, spread: 400, life: 1.0,
            color: '#ffcc66', color2: '#ff2200', size: 6
        });
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * 6.283185307179586;
            const s = 100 + Math.random() * 220;
            spawn({
                x: x, y: y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s - 25,
                life: 1.2,
                size: 10,
                color: '#554433', color2: '#221100',
                drag: 0.9, blend: 'source-over'
            });
        }
    }

    function emitHitSplash(x, y, color) {
        color = color || '#ff4466';
        for (let i = 0; i < 10; i++) {
            const a = Math.random() * 6.283185307179586;
            const s = 80 + Math.random() * 120;
            spawn({
                x: x, y: y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life: 0.45,
                size: 3 + Math.random() * 2,
                color: color, color2: '#ffffff',
                drag: 0.9
            });
        }
    }

    function clear() {
        for (let i = 0; i < activeParticles.length; i++) {
            const p = activeParticles[i];
            p.active = false;
            freeList.push(p);
        }
        activeParticles.length = 0;
    }

    function count() { return activeParticles.length; }

    global.Particles = {
        spawn, update, render, setViewport,
        emitTrail, emitCore, emitFireTrail, emitLightningBolt,
        emitIceShatter, emitHealGlow, emitShieldForm,
        emitMeteorTrail, emitMeteorImpact, emitHitSplash,
        burst, clear, count
    };
})(window);
