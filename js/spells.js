/* ================================================================
   spells.js — 魔法系統
   集中管理六種符文的參數、視覺、傷害邏輯。
   調整遊戲平衡性請直接修改此處的 SPELL_CONFIG。
   ================================================================ */

(function (global) {
    'use strict';

    // ==== 魔法參數設定表 ====
    // 所有可調整數值集中於此，方便平衡性調整
    const SPELL_CONFIG = {
        fireball: {
            name: '火球',
            symbol: '🔥',
            color: '#ff6622',
            mpCost: 15,
            cooldown: 2.0,           // 秒
            damage: 25,
            critMultiplier: 1.8,
            projectileSpeed: 700,
            radius: 18,
            description: '圓形 — 中等傷害，單體火焰攻擊'
        },
        lightning: {
            name: '閃電',
            symbol: '⚡',
            color: '#aaccff',
            mpCost: 20,
            cooldown: 4.0,
            damage: 45,
            critMultiplier: 2.0,
            projectileSpeed: 1400,   // 近乎瞬發
            radius: 12,
            description: 'Z 字 — 高傷害，快速命中'
        },
        icespike: {
            name: '冰刺',
            symbol: '❄️',
            color: '#88ccff',
            mpCost: 10,
            cooldown: 2.0,
            damage: 15,
            critMultiplier: 1.5,
            projectileSpeed: 650,
            radius: 14,
            slowDuration: 2.5,       // 秒
            slowFactor: 0.4,         // 40% 速度
            description: '三角形 — 低傷害，附加減速'
        },
        heal: {
            name: '治療',
            symbol: '✚',
            color: '#aaffaa',
            mpCost: 30,
            cooldown: 8.0,
            healAmount: 40,
            critMultiplier: 1.5,
            description: '十字 — 恢復自身生命'
        },
        shield: {
            name: '護盾',
            symbol: '🛡️',
            color: '#88ddff',
            mpCost: 25,
            cooldown: 10.0,
            duration: 6.0,           // 持續時間
            blocks: 1,               // 可擋下的攻擊數
            description: '方形 — 擋下下一次攻擊'
        },
        meteor: {
            name: '隕石',
            symbol: '☄️',
            color: '#ff8844',
            mpCost: 50,
            cooldown: 15.0,
            damage: 80,
            critMultiplier: 2.5,
            castDelay: 1.2,          // 隕石落下時間
            radius: 140,             // AOE 範圍
            description: '螺旋 — 高傷害、範圍攻擊'
        },
        wind: {
            name: '風刃',
            symbol: '🌪️',
            color: '#aaffcc',
            mpCost: 18,
            cooldown: 3.0,
            damage: 30,
            critMultiplier: 1.8,
            projectileSpeed: 900,
            radius: 22,
            pierce: 3,               // 可穿透敵人數
            description: '橫線 — 快速穿透多個敵人'
        },
        poison: {
            name: '毒霧',
            symbol: '☠️',
            color: '#88dd44',
            mpCost: 28,
            cooldown: 7.0,
            damage: 12,              // 每 tick
            critMultiplier: 1.5,
            duration: 4.0,
            tickInterval: 0.5,
            radius: 90,
            description: 'S 形 — 持續範圍傷害'
        },
        teleport: {
            name: '閃現',
            symbol: '✨',
            color: '#ddccff',
            mpCost: 20,
            cooldown: 6.0,
            range: 320,
            invulnerability: 0.4,    // 無敵幀
            description: 'V 形 — 瞬間位移，短暫無敵'
        },
        holynova: {
            name: '聖光爆',
            symbol: '✦',
            color: '#ffee99',
            mpCost: 45,
            cooldown: 12.0,
            damage: 60,
            critMultiplier: 2.2,
            radius: 220,
            healAmount: 25,
            description: '五角星 — 範圍爆發 + 自癒'
        },
        // ==== 近戰系 (商城購買) ====
        slash: {
            name: '利刃斬',
            symbol: '⚔',
            color: '#ff99bb',
            mpCost: 15,
            cooldown: 1.5,
            damage: 55,
            critMultiplier: 2.0,
            range: 150,              // 近戰距離
            arcAngle: Math.PI * 0.7, // 扇形攻擊角度
            description: '斜線 — 近戰扇形重擊，低冷卻'
        },
        groundslam: {
            name: '大地轟擊',
            symbol: '💥',
            color: '#cc8844',
            mpCost: 35,
            cooldown: 5.0,
            damage: 45,
            critMultiplier: 2.0,
            radius: 180,             // 玩家四周 AOE
            stunDuration: 0.8,
            description: 'W 形 — 玩家周圍 AOE + 短暫暈眩'
        },
        blooddrain: {
            name: '吸血之觸',
            symbol: '🩸',
            color: '#aa1122',
            mpCost: 22,
            cooldown: 3.5,
            damage: 35,
            critMultiplier: 1.8,
            range: 170,
            lifesteal: 0.8,          // 傷害的 80% 轉為治療
            description: 'C 形 — 近戰吸血，回復 80% 造成傷害'
        }
    };

    // ==== 鎖定加成 — 依符文等級 (1-5) 計算 ====
    // 等級 1: 基礎 / 每級 +20% 傷害, -7% 冷卻
    function getScaledDamage(kind, baseDamage, level) {
        level = level || 1;
        return baseDamage * (1 + 0.2 * (level - 1));
    }
    function getScaledCooldown(kind, baseCooldown, level) {
        level = level || 1;
        return baseCooldown * Math.max(0.55, 1 - 0.09 * (level - 1));
    }
    function getScaledHeal(baseHeal, level) {
        level = level || 1;
        return baseHeal * (1 + 0.15 * (level - 1));
    }

    // ==== 投射物清單 ====
    const projectiles = [];
    // 毒霧場 (持續性 AOE)
    const poisonFields = [];
    // 衝擊波環 (視覺特效)
    const shockwaves = [];

    /**
     * 建立投射物 (火球、閃電、冰刺、風刃)
     */
    function createProjectile(kind, fromX, fromY, targetX, targetY, critical, level) {
        const cfg = SPELL_CONFIG[kind];
        if (!cfg) return null;
        const dx = targetX - fromX, dy = targetY - fromY;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const scaledDmg = getScaledDamage(kind, cfg.damage, level) * (critical ? cfg.critMultiplier : 1);
        const proj = {
            kind: kind,
            x: fromX, y: fromY,
            vx: (dx / len) * cfg.projectileSpeed,
            vy: (dy / len) * cfg.projectileSpeed,
            radius: cfg.radius,
            damage: scaledDmg,
            critical: critical,
            level: level || 1,
            life: 1.8,
            color: cfg.color,
            targetX: targetX, targetY: targetY,
            dead: false,
            slowDuration: cfg.slowDuration,
            slowFactor: cfg.slowFactor,
            pierce: cfg.pierce || 0,
            hitSet: null  // 穿透用: 已擊中的敵人集合
        };
        if (proj.pierce) proj.hitSet = new Set();
        projectiles.push(proj);
        return proj;
    }

    /** 更新所有投射物 */
    function updateProjectiles(dt, enemies, onHit) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;

            if (p.kind === 'fireball') global.Particles.emitFireTrail(p.x, p.y);
            else if (p.kind === 'icespike') global.Particles.emitTrail(p.x, p.y, '#88ccff');
            else if (p.kind === 'wind') global.Particles.emitTrail(p.x, p.y, '#aaffcc');

            // PvP 遠端投射物: 僅視覺, 不做命中判定 (傷害來自對方的 hit 訊息)
            if (p._remote) {
                if (p.life <= 0 || p.x < -80 || p.x > 4000 || p.y < -80 || p.y > 4000) {
                    projectiles.splice(i, 1);
                }
                continue;
            }

            // 碰撞檢測 (穿透投射物可打多個)
            if (p.pierce > 0) {
                for (let j = 0; j < enemies.length; j++) {
                    const e = enemies[j];
                    if (e.dead || p.hitSet.has(e)) continue;
                    const ddx = p.x - e.x, ddy = p.y - e.y;
                    const r = p.radius + e.radius;
                    if (ddx * ddx + ddy * ddy < r * r) {
                        p.hitSet.add(e);
                        onHit(p, e);
                        p.pierce--;
                        if (p.pierce <= 0) { p.dead = true; break; }
                    }
                }
            } else {
                let hit = null;
                for (let j = 0; j < enemies.length; j++) {
                    const e = enemies[j];
                    if (e.dead) continue;
                    const ddx = p.x - e.x, ddy = p.y - e.y;
                    const r = p.radius + e.radius;
                    if (ddx * ddx + ddy * ddy < r * r) { hit = e; break; }
                }
                if (hit) { onHit(p, hit); p.dead = true; }
            }
            if (p.dead || p.life <= 0 || p.x < -80 || p.x > 4000 || p.y < -80 || p.y > 4000) {
                projectiles.splice(i, 1);
            }
        }
    }

    // ==== 毒霧場 ====
    function createPoisonField(x, y, critical, level) {
        const cfg = SPELL_CONFIG.poison;
        const mult = critical ? cfg.critMultiplier : 1;
        poisonFields.push({
            x: x, y: y,
            radius: cfg.radius,
            damage: getScaledDamage('poison', cfg.damage, level) * mult,
            life: cfg.duration,
            maxLife: cfg.duration,
            tickTimer: 0,
            tickInterval: cfg.tickInterval
        });
    }

    function updatePoisonFields(dt, enemies, onHit) {
        for (let i = poisonFields.length - 1; i >= 0; i--) {
            const f = poisonFields[i];
            f.life -= dt;
            f.tickTimer -= dt;
            // 隨機冒泡顆粒
            if (Math.random() < 0.6) {
                const a = Math.random() * Math.PI * 2;
                const rr = Math.random() * f.radius;
                global.Particles.spawn({
                    x: f.x + Math.cos(a) * rr,
                    y: f.y + Math.sin(a) * rr,
                    vx: 0, vy: -40 - Math.random() * 30,
                    life: 0.9, size: 5 + Math.random() * 4,
                    color: '#88dd44', color2: '#2a6a1a',
                    drag: 0.95
                });
            }
            if (f.tickTimer <= 0) {
                f.tickTimer = f.tickInterval;
                for (let j = 0; j < enemies.length; j++) {
                    const e = enemies[j];
                    if (e.dead) continue;
                    const dx = e.x - f.x, dy = e.y - f.y;
                    if (dx * dx + dy * dy < f.radius * f.radius) {
                        onHit({ kind: 'poison', damage: f.damage, critical: false }, e);
                    }
                }
            }
            if (f.life <= 0) poisonFields.splice(i, 1);
        }
    }

    function renderPoisonFields(ctx) {
        if (poisonFields.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < poisonFields.length; i++) {
            const f = poisonFields[i];
            const alpha = Math.min(1, f.life / 1.5);
            ctx.globalAlpha = alpha * 0.35;
            const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
            grad.addColorStop(0, 'rgba(150, 230, 80, 0.7)');
            grad.addColorStop(0.6, 'rgba(80, 160, 50, 0.4)');
            grad.addColorStop(1, 'rgba(40, 80, 20, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.radius, 0, 6.283185307179586);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    // ==== 衝擊波 (隕石、聖光爆用) ====
    function createShockwave(x, y, maxRadius, color, duration) {
        shockwaves.push({
            x: x, y: y,
            radius: 0,
            maxRadius: maxRadius,
            life: duration || 0.6,
            maxLife: duration || 0.6,
            color: color || '#ffdd88'
        });
    }

    function updateShockwaves(dt) {
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const s = shockwaves[i];
            s.life -= dt;
            s.radius = s.maxRadius * (1 - s.life / s.maxLife);
            if (s.life <= 0) shockwaves.splice(i, 1);
        }
    }

    function renderShockwaves(ctx) {
        if (shockwaves.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < shockwaves.length; i++) {
            const s = shockwaves[i];
            const alpha = s.life / s.maxLife;
            ctx.globalAlpha = alpha * 0.8;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 8 * alpha;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, 6.283185307179586);
            ctx.stroke();
            // 內圈
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * alpha;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius * 0.92, 0, 6.283185307179586);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    /** 繪製所有投射物 — 批次渲染 (狀態切換一次) */
    function renderProjectiles(ctx) {
        if (projectiles.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // 第一趟: 外層光暈 (較大半徑 + 半透明模擬 glow，不用 shadowBlur)
        for (let i = 0; i < projectiles.length; i++) {
            const p = projectiles[i];
            const cfg = SPELL_CONFIG[p.kind];
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = cfg.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * 1.8, 0, 6.283185307179586);
            ctx.fill();
        }
        // 第二趟: 本體
        ctx.globalAlpha = 1;
        for (let i = 0; i < projectiles.length; i++) {
            const p = projectiles[i];
            const cfg = SPELL_CONFIG[p.kind];
            ctx.fillStyle = cfg.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, 6.283185307179586);
            ctx.fill();
        }
        // 第三趟: 白色核心
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < projectiles.length; i++) {
            const p = projectiles[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * 0.4, 0, 6.283185307179586);
            ctx.fill();
        }
        ctx.restore();
    }

    /** 清空所有投射物 */
    function clearProjectiles() {
        projectiles.length = 0;
    }

    // ==== 隕石排程 (castDelay 後落下) ====
    const pendingMeteors = [];

    function scheduleMeteor(x, y, critical) {
        const cfg = SPELL_CONFIG.meteor;
        pendingMeteors.push({
            x: x,
            y: y,
            timer: cfg.castDelay,
            critical: critical
        });
    }

    function updateMeteors(dt, enemies, onHit) {
        for (let i = pendingMeteors.length - 1; i >= 0; i--) {
            const m = pendingMeteors[i];
            m.timer -= dt;
            const progress = 1 - m.timer / SPELL_CONFIG.meteor.castDelay;
            const startY = -300;
            const meteorY = startY + (m.y - startY) * progress;
            global.Particles.emitMeteorTrail(m.x, meteorY);

            if (m.timer <= 0) {
                // 撞擊: AOE 傷害所有範圍內敵人
                const cfg = SPELL_CONFIG.meteor;
                const dmg = cfg.damage * (m.critical ? cfg.critMultiplier : 1);
                for (const e of enemies) {
                    if (e.dead) continue;
                    const dx = e.x - m.x, dy = e.y - m.y;
                    if (dx * dx + dy * dy < cfg.radius * cfg.radius) {
                        onHit({ kind: 'meteor', damage: dmg, critical: m.critical, x: e.x, y: e.y }, e);
                    }
                }
                global.Particles.emitMeteorImpact(m.x, m.y);
                pendingMeteors.splice(i, 1);
            }
        }
    }

    function renderMeteors(ctx) {
        if (pendingMeteors.length === 0) return;
        ctx.save();
        const cfg = SPELL_CONFIG.meteor;
        // 先畫所有目標標記 (source-over)
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255, 100, 50, ' + (0.4 + Math.sin(Date.now() / 80) * 0.3) + ')';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        for (let i = 0; i < pendingMeteors.length; i++) {
            const m = pendingMeteors[i];
            ctx.beginPath();
            ctx.arc(m.x, m.y, cfg.radius, 0, 6.283185307179586);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        // 再畫所有流星本體 (lighter)
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < pendingMeteors.length; i++) {
            const m = pendingMeteors[i];
            const progress = 1 - m.timer / cfg.castDelay;
            const my = -300 + (m.y + 300) * progress;
            // 光暈 (大圓半透明)
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = '#ff6622';
            ctx.beginPath();
            ctx.arc(m.x, my, 40, 0, 6.283185307179586);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#ffcc44';
            ctx.beginPath();
            ctx.arc(m.x, my, 22, 0, 6.283185307179586);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(m.x, my, 10, 0, 6.283185307179586);
            ctx.fill();
        }
        ctx.restore();
    }

    // ==== 閃電 (即時直線攻擊) ====
    const lightningStrikes = []; // {x1,y1,x2,y2,life}

    function createLightning(x1, y1, x2, y2) {
        lightningStrikes.push({ x1, y1, x2, y2, life: 0.25 });
        global.Particles.emitLightningBolt(x1, y1, x2, y2);
    }

    function updateLightning(dt) {
        for (let i = lightningStrikes.length - 1; i >= 0; i--) {
            lightningStrikes[i].life -= dt;
            if (lightningStrikes[i].life <= 0) lightningStrikes.splice(i, 1);
        }
    }

    function renderLightning(ctx) {
        if (lightningStrikes.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // 只有 lightning 保留 shadowBlur (數量少、效果明顯)
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#aaccff';
        ctx.lineWidth = 4;
        for (let i = 0; i < lightningStrikes.length; i++) {
            const L = lightningStrikes[i];
            const alpha = L.life / 0.25;
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + alpha + ')';
            drawJaggedLine(ctx, L.x1, L.y1, L.x2, L.y2, 6);
        }
        ctx.restore();
    }

    function drawJaggedLine(ctx, x1, y1, x2, y2, segments) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const dx = x2 - x1, dy = y2 - y1;
        const nx = -dy, ny = dx;
        const len = Math.sqrt(nx * nx + ny * ny) || 1;
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const off = (Math.random() - 0.5) * 30;
            const px = x1 + dx * t + (nx / len) * off;
            const py = y1 + dy * t + (ny / len) * off;
            ctx.lineTo(px, py);
        }
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // ==== 近戰揮砍特效 ====
    const meleeArcs = [];

    function createMeleeArc(x, y, angle, range, color) {
        meleeArcs.push({
            x: x, y: y, angle: angle,
            range: range, color: color || '#ff99bb',
            life: 0.3, maxLife: 0.3
        });
    }

    function updateMeleeArcs(dt) {
        for (let i = meleeArcs.length - 1; i >= 0; i--) {
            meleeArcs[i].life -= dt;
            if (meleeArcs[i].life <= 0) meleeArcs.splice(i, 1);
        }
    }

    function renderMeleeArcs(ctx) {
        if (meleeArcs.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < meleeArcs.length; i++) {
            const a = meleeArcs[i];
            const t = a.life / a.maxLife;
            // 揮砍弧線 (隨時間旋轉擴展)
            const sweep = Math.PI * 0.9;
            const progress = 1 - t;   // 0 -> 1
            const startA = a.angle - sweep / 2 + progress * sweep * 0.15;
            const endA = a.angle + sweep / 2 - progress * sweep * 0.15;
            // 外層殘影
            ctx.globalAlpha = t * 0.6;
            ctx.strokeStyle = a.color;
            ctx.lineWidth = 18;
            ctx.beginPath();
            ctx.arc(a.x, a.y, a.range * 0.85, startA, endA);
            ctx.stroke();
            // 內層白線
            ctx.globalAlpha = t;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(a.x, a.y, a.range * 0.85, startA, endA);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    /** 檢查投射物與障礙物碰撞 — 撞到不可穿透的就消失 */
    function checkProjectilesVsObstacles(obstacles, pointInObstacle) {
        if (!obstacles || obstacles.length === 0) return;
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            for (let j = 0; j < obstacles.length; j++) {
                if (pointInObstacle(p.x, p.y, obstacles[j])) {
                    global.Particles.burst(p.x, p.y, {
                        count: 12, spread: 150, life: 0.4,
                        color: p.color, color2: '#ffffff', size: 4
                    });
                    projectiles.splice(i, 1);
                    break;
                }
            }
        }
    }

    /** 清空所有魔法效果 (切換場景時呼叫) */
    function clearAll() {
        projectiles.length = 0;
        pendingMeteors.length = 0;
        lightningStrikes.length = 0;
        poisonFields.length = 0;
        shockwaves.length = 0;
        meleeArcs.length = 0;
    }

    global.Spells = {
        CONFIG: SPELL_CONFIG,
        createProjectile,
        updateProjectiles,
        renderProjectiles,
        scheduleMeteor,
        updateMeteors,
        renderMeteors,
        createLightning,
        updateLightning,
        renderLightning,
        createPoisonField,
        updatePoisonFields,
        renderPoisonFields,
        createShockwave,
        updateShockwaves,
        renderShockwaves,
        createMeleeArc,
        updateMeleeArcs,
        renderMeleeArcs,
        checkProjectilesVsObstacles,
        getScaledDamage,
        getScaledCooldown,
        getScaledHeal,
        clearAll,
        clearProjectiles
    };
})(window);
