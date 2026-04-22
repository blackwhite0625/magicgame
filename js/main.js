/* ================================================================
   main.js — 遊戲主控
   - Canvas 設定與 resize 處理
   - Pointer 輸入 (繪製軌跡)
   - 遊戲狀態管理 (主選單 / 關卡 / 練習)
   - 主迴圈 (update + render)
   ================================================================ */

(function () {
    'use strict';

    // ==== 全域可調整常數 ====
    const PLAYER_MAX_HP = 100;
    const PLAYER_MAX_MP = 100;
    const MP_REGEN = 8;             // 每秒回復
    const COMBO_TIMEOUT = 3;        // 連擊重置秒數
    const COMBO_DAMAGE_BONUS = 0.1; // 每層 +10% 傷害
    const MIN_TRAIL_POINTS = 4;     // 最低識別點數 (較寬鬆)

    // ==== 遊戲狀態 ====
    const game = {
        state: 'menu',              // menu / playing / paused / practice / victory / defeat
        level: 1,
        unlockedLevels: 1,
        score: 0,
        combo: 0,
        comboTimer: 0,
        kills: 0,
        totalAccuracy: 0,           // 用於計算平均準確度
        spellsCast: 0,
        player: {
            x: 160,
            y: 360,
            radius: 40,
            hp: PLAYER_MAX_HP,
            maxHp: PLAYER_MAX_HP,
            mp: PLAYER_MAX_MP,
            maxMp: PLAYER_MAX_MP,
            shieldActive: false,
            shieldBlocks: 0,
            shieldTimer: 0,
            bobPhase: 0,
            hitFlash: 0
        },
        enemies: [],
        cooldowns: {},              // key -> 剩餘秒數
        waves: [],                  // 剩餘波次
        waveTimer: 0,
        levelStartTime: 0,
        recognitionThreshold: 0.55,
        infinite: false,
        wave: 0,
        nextWaveDelay: 0,
        infiniteHighScore: 0,
        runeLevels: {},
        upgradePoints: 0,
        invulnerableUntil: 0,
        shake: { x: 0, y: 0, life: 0, mag: 0 },
        hitstopTimer: 0,
        damageNumbers: [],
        flashFrame: 0,
        traps: [],             // 地圖陷阱
        pickups: [],           // 可撿拾道具
        activeBuffs: {},       // { damage: {sec}, speed: {sec} ... }
        gold: 0,
        shopPurchased: {},          // { slash: true, groundslam: true, ... }
        statUpgrades: { hp: 0, mp: 0, mpRegen: 0 },
        loadout: ['fireball'],
        pvpLoadout: ['fireball'],   // 多人專用; 可自由挑選任何 5 個 (一律 Lv1)
        _loadoutContinuation: null,
        _loadoutMpMode: false,
        skillPointsEarned: 0,
        // ==== 多人對戰 ====
        mp: {
            active: false,
            isHost: false,
            teamMode: '1v1',      // '1v1' | '2v2'
            myName: 'Player',      // 玩家名稱 (可在進入多人前自訂)
            myTeam: 0,             // 我方隊伍 (0 or 1)
            mySlot: 0,             // 在房間內的 slot (0~3)
            mapId: 'grassland',
            obstacles: [],
            rounds: 3,
            myWins: 0,
            oppWins: 0,
            roundNum: 0,
            roundState: 'idle',
            countdown: 0,
            // 1v1 單一對手 (teamMode='1v1' 時使用)
            opponent: {
                x: 0, y: 0, hp: 100, maxHp: 100,
                facing: 1, alive: true,
                lastUpdate: 0,
                bobPhase: 0, hitFlash: 0
            },
            // 2v2 多人: 其他 3 個玩家 (key = slot)
            players: {},           // { 1: {x,y,hp,team,alive,...}, 2: {...}, 3: {...} }
            sendTimer: 0
        }
    };
    const LOADOUT_MAX = 5;
    // 初始只有火球術免費, 其餘全部透過商城解鎖
    const DEFAULT_UNLOCKED = { fireball: true };
    for (const k in window.Spells.CONFIG) game.runeLevels[k] = 1;
    try {
        const saved = localStorage.getItem('magicRunes.infiniteHigh');
        if (saved) game.infiniteHighScore = parseInt(saved, 10) || 0;
        const levels = localStorage.getItem('magicRunes.runeLevels');
        if (levels) {
            const parsed = JSON.parse(levels);
            for (const k in parsed) {
                if (game.runeLevels[k] !== undefined) {
                    game.runeLevels[k] = Math.max(1, Math.min(5, parsed[k] | 0));
                }
            }
        }
        const unlocked = localStorage.getItem('magicRunes.unlockedLevels');
        if (unlocked) game.unlockedLevels = Math.max(1, Math.min(20, parseInt(unlocked, 10) || 1));
        const goldStr = localStorage.getItem('magicRunes.gold');
        if (goldStr) game.gold = Math.max(0, parseInt(goldStr, 10) || 0);
        const shopStr = localStorage.getItem('magicRunes.shopPurchased');
        if (shopStr) game.shopPurchased = JSON.parse(shopStr) || {};
        const upg = localStorage.getItem('magicRunes.statUpgrades');
        if (upg) {
            const parsed = JSON.parse(upg);
            game.statUpgrades.hp = parsed.hp | 0;
            game.statUpgrades.mp = parsed.mp | 0;
            game.statUpgrades.mpRegen = parsed.mpRegen | 0;
        }
        const sp = localStorage.getItem('magicRunes.skillPointsEarned');
        if (sp) game.skillPointsEarned = Math.max(0, parseInt(sp, 10) || 0);
        const lo = localStorage.getItem('magicRunes.loadout');
        if (lo) {
            const parsed = JSON.parse(lo);
            if (Array.isArray(parsed)) {
                game.loadout = parsed.filter(k =>
                    k && window.Spells.CONFIG[k] &&
                    (DEFAULT_UNLOCKED[k] || (game.shopPurchased && game.shopPurchased[k]))
                ).slice(0, LOADOUT_MAX);
            }
        }
        const pvpLo = localStorage.getItem('magicRunes.pvpLoadout');
        if (pvpLo) {
            const parsed = JSON.parse(pvpLo);
            if (Array.isArray(parsed)) {
                game.pvpLoadout = parsed.filter(k => k && window.Spells.CONFIG[k]).slice(0, LOADOUT_MAX);
            }
        }
    } catch (e) {}
    if (!game.pvpLoadout.length) game.pvpLoadout = ['fireball'];
    try {
        const nm = localStorage.getItem('magicRunes.mpName');
        if (nm) game.mp.myName = nm.slice(0, 12);
    } catch (e) {}
    // 確保 loadout 至少有火球
    if (!game.loadout.length) game.loadout = ['fireball'];

    // 舊存檔相容: 如果 runeLevels 有超過 1 的值但 skillPointsEarned 沒算到,
    // 補上 earned, 避免重置時退還 0 點
    {
        let legacySpent = 0;
        for (const k in game.runeLevels) {
            legacySpent += Math.max(0, (game.runeLevels[k] || 1) - 1);
        }
        if (legacySpent > game.skillPointsEarned) {
            game.skillPointsEarned = legacySpent;
        }
    }

    function saveProgress() {
        try {
            localStorage.setItem('magicRunes.runeLevels', JSON.stringify(game.runeLevels));
            localStorage.setItem('magicRunes.unlockedLevels', String(game.unlockedLevels));
            localStorage.setItem('magicRunes.gold', String(game.gold));
            localStorage.setItem('magicRunes.shopPurchased', JSON.stringify(game.shopPurchased));
            localStorage.setItem('magicRunes.statUpgrades', JSON.stringify(game.statUpgrades));
            localStorage.setItem('magicRunes.loadout', JSON.stringify(game.loadout));
            localStorage.setItem('magicRunes.pvpLoadout', JSON.stringify(game.pvpLoadout));
            localStorage.setItem('magicRunes.skillPointsEarned', String(game.skillPointsEarned));
        } catch (e) {}
    }

    // 計算已花費與可用技能點
    function countSpentSkillPoints() {
        let spent = 0;
        for (const k in game.runeLevels) {
            spent += Math.max(0, (game.runeLevels[k] || 1) - 1);
        }
        return spent;
    }
    function availableSkillPoints() {
        return Math.max(0, game.skillPointsEarned - countSpentSkillPoints());
    }

    function isSpellUnlocked(name) {
        if (DEFAULT_UNLOCKED[name]) return true;
        return !!(game.shopPurchased && game.shopPurchased[name]);
    }

    function isSpellInLoadout(name) {
        // PvP 使用專用 loadout
        if (game.state === 'pvp' && game.mp && game.mp.active) {
            return game.pvpLoadout && game.pvpLoadout.indexOf(name) >= 0;
        }
        return game.loadout && game.loadout.indexOf(name) >= 0;
    }

    function triggerShake(mag, duration) {
        if (game.shake.life < duration) {
            game.shake.life = duration;
            game.shake.mag = Math.max(game.shake.mag, mag);
        }
    }

    // 打擊停頓 (短暫慢動作, 加強打擊感)
    function triggerHitstop(duration) {
        if (game.hitstopTimer < duration) game.hitstopTimer = duration;
    }

    // 全螢幕白閃 (暴擊或強招用)
    function triggerFlash(strength) {
        game.flashFrame = Math.max(game.flashFrame, strength || 0.3);
    }

    // 漂浮傷害數字
    function spawnDamageNumber(x, y, amount, critical) {
        const text = Math.round(amount) + (critical ? '!' : '');
        game.damageNumbers.push({
            x: x + (Math.random() - 0.5) * 30,
            y: y - 30,
            vx: (Math.random() - 0.5) * 40,
            vy: -120 - Math.random() * 40,
            text: text,
            critical: !!critical,
            color: critical ? '#ffcc44' : '#ff6680',
            life: 0.9, maxLife: 0.9,
            scale: critical ? 1.5 : 1
        });
    }

    function updateDamageNumbers(dt) {
        for (let i = game.damageNumbers.length - 1; i >= 0; i--) {
            const d = game.damageNumbers[i];
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            d.vy += 150 * dt;   // 減速上升
            d.vx *= 0.92;
            d.life -= dt;
            if (d.life <= 0) game.damageNumbers.splice(i, 1);
        }
    }

    // ==== 陷阱與道具系統 ====

    const PICKUP_TYPES = {
        hp:        { color: '#ff88aa', glow: '#ff4466', icon: '♥', label: '+25 HP' },
        mp:        { color: '#88aaff', glow: '#4466ff', icon: '✦', label: '+35 MP' },
        gold:      { color: '#ffdd66', glow: '#cc8844', icon: '$', label: '+15 金' },
        dmgBuff:   { color: '#ff9944', glow: '#ff4422', icon: '⚔', label: '傷害+50%' },
        speedBuff: { color: '#88ffdd', glow: '#22aa99', icon: '»', label: '速度+50%' },
        shield:    { color: '#88ddff', glow: '#4488cc', icon: '◈', label: '護盾 1 擊' }
    };
    const PICKUP_KEYS = Object.keys(PICKUP_TYPES);
    // 加權機率: 常見的 HP/MP/gold 機率高, buff 較稀有
    const PICKUP_WEIGHTS = { hp: 30, mp: 25, gold: 20, dmgBuff: 10, speedBuff: 10, shield: 5 };

    function pickRandomPickupType() {
        let total = 0;
        for (const k of PICKUP_KEYS) total += PICKUP_WEIGHTS[k];
        let r = Math.random() * total;
        for (const k of PICKUP_KEYS) {
            r -= PICKUP_WEIGHTS[k];
            if (r <= 0) return k;
        }
        return 'hp';
    }

    function trySpawnPickup(x, y) {
        game.pickups.push({
            x: x, y: y,
            type: pickRandomPickupType(),
            vx: (Math.random() - 0.5) * 60,
            vy: -80,
            onGround: false,
            bob: Math.random() * Math.PI * 2,
            life: 20    // 20 秒後消失
        });
    }

    function spawnTrap(x, y) {
        game.traps.push({
            x: x, y: y,
            radius: 36,
            triggered: false,
            triggerTimer: 0,   // 觸發後的動畫
            cooldown: 0,       // 重新啟動倒數
            life: Infinity
        });
    }

    function updatePickupsAndTraps(dt) {
        const p = game.player;
        // Pickups: 小跳 + 飄移 + 重力, 碰玩家吸收
        for (let i = game.pickups.length - 1; i >= 0; i--) {
            const pk = game.pickups[i];
            pk.bob += dt * 4;
            if (!pk.onGround) {
                pk.vy += 300 * dt;  // 重力
                pk.x += pk.vx * dt;
                pk.y += pk.vy * dt;
                pk.vx *= 0.95;
                const size = getCanvasSize();
                if (pk.y > size.h - 30) {
                    pk.y = size.h - 30;
                    pk.vy = 0; pk.vx = 0;
                    pk.onGround = true;
                }
            }
            pk.life -= dt;
            // 快消失時閃爍效果 (靠渲染判斷)
            // 與玩家碰撞
            const dx = pk.x - p.x, dy = pk.y - p.y;
            if (dx * dx + dy * dy < (p.radius + 20) * (p.radius + 20)) {
                applyPickup(pk.type);
                window.Particles.burst(pk.x, pk.y, {
                    count: 20, spread: 180, life: 0.6,
                    color: PICKUP_TYPES[pk.type].color,
                    color2: '#ffffff', size: 4
                });
                game.pickups.splice(i, 1);
                continue;
            }
            if (pk.life <= 0) game.pickups.splice(i, 1);
        }

        // Traps: 觸發玩家或敵人
        for (let i = game.traps.length - 1; i >= 0; i--) {
            const t = game.traps[i];
            if (t.triggerTimer > 0) {
                t.triggerTimer -= dt;
            }
            if (t.cooldown > 0) {
                t.cooldown -= dt;
                continue;
            }
            // 檢查玩家
            const dpx = p.x - t.x, dpy = p.y - t.y;
            if (dpx * dpx + dpy * dpy < (t.radius + p.radius * 0.5) * (t.radius + p.radius * 0.5)) {
                onTrapTriggered(t, 'player');
            }
            // 檢查敵人
            for (let j = 0; j < game.enemies.length; j++) {
                const e = game.enemies[j];
                if (e.dead) continue;
                const dex = e.x - t.x, dey = e.y - t.y;
                if (dex * dex + dey * dey < (t.radius + e.radius * 0.5) * (t.radius + e.radius * 0.5)) {
                    onTrapTriggered(t, e);
                    break;
                }
            }
        }

        // 時間型 buff 倒數
        for (const k in game.activeBuffs) {
            if (game.activeBuffs[k] > 0) {
                game.activeBuffs[k] -= dt;
                if (game.activeBuffs[k] <= 0) delete game.activeBuffs[k];
            }
        }
    }

    function onTrapTriggered(trap, victim) {
        trap.cooldown = 3.5;      // 可重複觸發但有冷卻
        trap.triggerTimer = 0.5;
        const dmg = 18;
        if (victim === 'player') {
            onPlayerHit(dmg, { kind: 'trap', x: trap.x, y: trap.y });
        } else {
            window.Enemies.damageEnemy(victim, dmg);
            spawnDamageNumber(victim.x, victim.y, dmg, false);
            if (victim.dead) onEnemyKilled(victim);
        }
        // 視覺: 尖刺爆發
        window.Particles.burst(trap.x, trap.y, {
            count: 16, spread: 200, life: 0.5,
            color: '#ff4466', color2: '#880000', size: 5
        });
        window.UI.playSfx('hit');
        triggerShake(5, 0.15);
    }

    function applyPickup(type) {
        const p = game.player;
        switch (type) {
            case 'hp': p.hp = Math.min(p.maxHp, p.hp + 25); break;
            case 'mp': p.mp = Math.min(p.maxMp, p.mp + 35); break;
            case 'gold': game.gold += 15; break;
            case 'dmgBuff': game.activeBuffs.damage = 12; break;
            case 'speedBuff': game.activeBuffs.speed = 12; break;
            case 'shield':
                p.shieldActive = true;
                p.shieldBlocks = Math.max(p.shieldBlocks, 1);
                p.shieldTimer = Math.max(p.shieldTimer, 6);
                break;
        }
        window.UI.playSfx('coin');
    }

    // 依關卡 / 波次安置陷阱
    function seedTraps(count) {
        const size = getCanvasSize();
        for (let i = 0; i < count; i++) {
            // 避開玩家起始位置
            const x = size.w * (0.35 + Math.random() * 0.55);
            const y = size.h * (0.2 + Math.random() * 0.6);
            spawnTrap(x, y);
        }
    }

    // 渲染道具 + 陷阱
    function renderPickupsAndTraps(c) {
        // 陷阱 (畫地面, 在敵人/玩家之下)
        for (let i = 0; i < game.traps.length; i++) {
            const t = game.traps[i];
            const trig = t.triggerTimer > 0 ? (t.triggerTimer / 0.5) : 0;
            // 基座暗圈
            c.fillStyle = 'rgba(30, 10, 15, 0.7)';
            c.beginPath();
            c.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
            c.fill();
            // 尖刺 (放射狀)
            const spikes = 8;
            c.strokeStyle = trig > 0 ? `rgba(255, 80, 100, ${0.6 + trig * 0.4})` : '#886677';
            c.lineWidth = trig > 0 ? 3 : 2;
            for (let s = 0; s < spikes; s++) {
                const a = (s / spikes) * Math.PI * 2;
                const r1 = t.radius * 0.3;
                const r2 = t.radius * (0.85 + trig * 0.2);
                c.beginPath();
                c.moveTo(t.x + Math.cos(a) * r1, t.y + Math.sin(a) * r1);
                c.lineTo(t.x + Math.cos(a) * r2, t.y + Math.sin(a) * r2);
                c.stroke();
            }
            // 警示紅圈 (冷卻中時變暗)
            if (t.cooldown <= 0) {
                c.strokeStyle = 'rgba(255, 80, 80, 0.5)';
                c.lineWidth = 2;
                c.beginPath();
                c.arc(t.x, t.y, t.radius + 3, 0, Math.PI * 2);
                c.stroke();
            } else {
                c.strokeStyle = 'rgba(100, 100, 110, 0.4)';
                c.lineWidth = 1;
                c.beginPath();
                c.arc(t.x, t.y, t.radius + 3, 0, Math.PI * 2);
                c.stroke();
            }
        }

        // Pickups (漂浮小球)
        for (let i = 0; i < game.pickups.length; i++) {
            const pk = game.pickups[i];
            const def = PICKUP_TYPES[pk.type];
            const bob = Math.sin(pk.bob) * 4;
            const y = pk.y + bob;
            const blink = pk.life < 3 && Math.floor(pk.life * 6) % 2 === 0;
            if (blink) continue;
            // 光暈 (lighter)
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.globalAlpha = 0.5;
            c.fillStyle = def.glow;
            c.beginPath();
            c.arc(pk.x, y, 26, 0, Math.PI * 2);
            c.fill();
            c.globalAlpha = 1;
            c.restore();
            // 本體
            c.fillStyle = def.color;
            c.beginPath();
            c.arc(pk.x, y, 14, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = '#ffffff';
            c.lineWidth = 2;
            c.stroke();
            // 圖示
            c.fillStyle = '#ffffff';
            c.font = 'bold 18px Georgia';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(def.icon, pk.x, y + 1);
        }
    }

    function renderDamageNumbers(c) {
        if (game.damageNumbers.length === 0) return;
        c.save();
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (const d of game.damageNumbers) {
            const alpha = Math.min(1, d.life / d.maxLife * 1.5);
            c.globalAlpha = alpha;
            const size = 22 * d.scale;
            c.font = `bold ${size}px Georgia`;
            c.lineWidth = 4;
            c.strokeStyle = '#000';
            c.strokeText(d.text, d.x, d.y);
            c.fillStyle = d.color;
            c.fillText(d.text, d.x, d.y);
        }
        c.restore();
    }

    // 初始化冷卻表
    for (const key in window.Spells.CONFIG) {
        game.cooldowns[key] = 0;
    }

    // ==== Canvas 設定 ====
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const practiceCanvas = document.getElementById('practice-canvas');
    const practiceCtx = practiceCanvas.getContext('2d');

    // 效能: 在 Retina 螢幕把 DPR 上限設為 1 可大幅減少像素運算 (約 4x 提速)
    // 若螢幕畫質需求較高可提高到 1.5; 實測 1.0 已足夠清晰
    const MAX_DPR = 1;

    // 快取的畫布邏輯尺寸，避免每幀 getBoundingClientRect
    const cachedSize = { w: 1280, h: 720 };

    let bgGradient = null;       // 快取的背景漸層
    let playerAuraGrad = null;   // 快取的玩家光環漸層

    function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const container = document.getElementById('game-container');
        const rect = container.getBoundingClientRect();
        cachedSize.w = rect.width;
        cachedSize.h = rect.height;
        [canvas, practiceCanvas].forEach(cv => {
            cv.width = rect.width * dpr;
            cv.height = rect.height * dpr;
            cv.style.width = rect.width + 'px';
            cv.style.height = rect.height + 'px';
            cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
        });
        // 通知粒子系統剔除範圍
        if (window.Particles && window.Particles.setViewport) {
            window.Particles.setViewport(rect.width, rect.height);
        }
        // 清除快取漸層 (下次渲染時重建)
        bgGradient = null;
        playerAuraGrad = null;
    }

    window.addEventListener('resize', resizeCanvas);

    // ==== 輸入 (軌跡繪製) ====
    // 共用於遊戲與練習模式
    let currentTrail = [];          // 當前繪製點集 (邏輯座標)
    let drawing = false;
    let activeInputTarget = null;   // 'game' | 'practice'
    let lastTrailEmit = 0;

    function getCanvasFor(target) {
        return target === 'practice' ? practiceCanvas : canvas;
    }

    function getCtxFor(target) {
        return target === 'practice' ? practiceCtx : ctx;
    }

    function attachPointerEvents(target) {
        const cv = getCanvasFor(target);
        cv.addEventListener('pointerdown', (e) => handlePointerDown(e, target));
        cv.addEventListener('pointermove', (e) => handlePointerMove(e, target));
        cv.addEventListener('pointerup', (e) => handlePointerUp(e, target));
        cv.addEventListener('pointercancel', (e) => handlePointerUp(e, target));
        // 防止觸控板手勢引起瀏覽器導航
        cv.addEventListener('gesturestart', e => e.preventDefault());
        cv.addEventListener('wheel', e => {
            if (e.ctrlKey) e.preventDefault(); // 防止縮放
        }, { passive: false });
    }

    function pointerToLogical(e, cv) {
        const rect = cv.getBoundingClientRect();
        // 若 style 尺寸與 bounding rect 一致，不需特殊縮放
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            t: performance.now()
        };
    }

    function getCanvasSize() {
        return cachedSize;
    }

    function handlePointerDown(e, target) {
        if (target === 'game' && game.state !== 'playing' && game.state !== 'pvp') return;
        if (target === 'practice' && practice.state !== 'ready') return;
        e.preventDefault();
        drawing = true;
        activeInputTarget = target;
        currentTrail = [];
        const p = pointerToLogical(e, getCanvasFor(target));
        currentTrail.push(p);
        getCanvasFor(target).setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e, target) {
        if (!drawing || activeInputTarget !== target) return;
        const p = pointerToLogical(e, getCanvasFor(target));
        currentTrail.push(p);
        // 粒子拖尾 — 節流至 22ms (~45Hz) 確保連續感
        const now = performance.now();
        if (now - lastTrailEmit > 22) {
            lastTrailEmit = now;
            window.Particles.emitTrail(p.x, p.y, '#bb88ff');
            window.Particles.emitCore(p.x, p.y, '#ffffff');
        }
    }

    function handlePointerUp(e, target) {
        if (!drawing || activeInputTarget !== target) return;
        drawing = false;
        try { getCanvasFor(target).releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const trail = currentTrail;
        currentTrail = [];

        if (target === 'practice') {
            // 練習模式: 即使點數不足也保留軌跡讓玩家看到問題
            if (trail.length >= 2) {
                practice.lastTrail = trail.map(p => ({ x: p.x, y: p.y }));
                practice.lastTrailTime = performance.now();
                if (trail.length < MIN_TRAIL_POINTS) {
                    practice.lastResult = null;
                    practice.lastMatch = false;
                    document.getElementById('practice-accuracy').textContent = '太短 (需更多點)';
                    window.UI.playSfx('fail');
                    return;
                }
                processPracticeAttempt(trail);
            }
            return;
        }

        if (trail.length < MIN_TRAIL_POINTS) return;
        if (target === 'game') processGameSpell(trail);
    }

    attachPointerEvents('game');
    attachPointerEvents('practice');

    // ==== WASD 鍵盤移動 ====
    const keyState = {};
    const PLAYER_SPEED = 280;  // px/s

    window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'w' || k === 'a' || k === 's' || k === 'd' ||
            k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
            keyState[k] = true;
            if (game.state === 'playing' || game.state === 'pvp') e.preventDefault();
        }
    });
    window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        keyState[k] = false;
    });

    function updatePlayerMovement(dt) {
        let dx = 0, dy = 0;
        if (keyState['w'] || keyState['arrowup']) dy -= 1;
        if (keyState['s'] || keyState['arrowdown']) dy += 1;
        if (keyState['a'] || keyState['arrowleft']) dx -= 1;
        if (keyState['d'] || keyState['arrowright']) dx += 1;
        if (dx === 0 && dy === 0) return false;
        if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
        const p = game.player;
        const speedMul = game.activeBuffs.speed > 0 ? 1.5 : 1;
        p.x += dx * PLAYER_SPEED * speedMul * dt;
        p.y += dy * PLAYER_SPEED * speedMul * dt;
        // 邊界限制 (僅限畫布範圍, 不再有中間屏障)
        const size = getCanvasSize();
        const margin = p.radius + 20;
        if (p.x < margin) p.x = margin;
        if (p.x > size.w - margin) p.x = size.w - margin;
        if (p.y < margin) p.y = margin;
        if (p.y > size.h - margin - 10) p.y = size.h - margin - 10;
        // 玩家移動會使背景漸層不同步 — 失效快取
        bgGradient = null;
        return true;
    }

    // ==== 軌跡繪製 (即時顯示玩家正在畫的線) ====
    // 效能: 不用 shadowBlur, 改用多層描邊堆疊模擬光暈
    function renderTrail(targetCtx) {
        if (currentTrail.length < 2) return;
        targetCtx.save();
        targetCtx.globalCompositeOperation = 'lighter';
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        // 建立路徑一次 (後續 stroke 複用)
        const n = currentTrail.length;
        targetCtx.beginPath();
        targetCtx.moveTo(currentTrail[0].x, currentTrail[0].y);
        for (let i = 1; i < n; i++) {
            targetCtx.lineTo(currentTrail[i].x, currentTrail[i].y);
        }
        // 最外暗光
        targetCtx.strokeStyle = 'rgba(120, 60, 180, 0.35)';
        targetCtx.lineWidth = 18;
        targetCtx.stroke();
        // 中層
        targetCtx.strokeStyle = 'rgba(200, 150, 255, 0.6)';
        targetCtx.lineWidth = 10;
        targetCtx.stroke();
        // 內核
        targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        targetCtx.lineWidth = 3;
        targetCtx.stroke();
        targetCtx.restore();
    }

    // 在 pvp 模式中, 也可以施法 (處理同 game state)
    function processGameSpell(trail) {
        const isPvp = game.state === 'pvp' && game.mp.active && game.mp.roundState === 'playing';
        if (isPvp) {
            // 把對手當作單一敵人, 並記錄初始 HP 以計算瞬發傷害 (閃電/聖光爆/大地等)
            const tempOpp = mpOpponentAsEnemy();
            const beforeHp = tempOpp.hp;
            const orig = game.enemies;
            game.enemies = [tempOpp];
            _processGameSpellInner(trail, (name, critical) => {
                window.Multiplayer.send({
                    type: 'cast',
                    spell: name,
                    x: game.player.x, y: game.player.y,
                    tx: game.mp.opponent.x, ty: game.mp.opponent.y,
                    critical: critical
                });
            });
            game.enemies = orig;
            // 若 castSpell 對 tempOpp 造成瞬發傷害, 同步給對方 + 更新本端對手 HP
            const dmgDone = beforeHp - tempOpp.hp;
            if (dmgDone > 0) {
                window.Multiplayer.send({
                    type: 'hit',
                    damage: dmgDone,
                    spell: 'aoe'
                });
                game.mp.opponent.hp = Math.max(0, game.mp.opponent.hp - dmgDone);
                game.mp.opponent.hitFlash = 1;
                if (game.mp.opponent.hp <= 0 && game.mp.roundState === 'playing') {
                    localRoundDecided(true);
                }
            }
            return;
        }
        _processGameSpellInner(trail, null);
    }

    function _processGameSpellInner(trail, onCast) {
        const result = window.Recognizer.recognize(trail);
        const cfg = result ? window.Spells.CONFIG[result.name] : null;
        const threshold = game.recognitionThreshold;

        if (!result || result.accuracy < threshold) {
            window.UI.showRecognition(null, 0, false);
            window.UI.playSfx('fail');
            game.combo = 0;
            game.comboTimer = 0;
            return;
        }
        // 歧義檢查: 若最佳與次佳分差太小且整體分數不夠高, 視為失敗
        if (result.margin !== undefined && result.margin < window.Recognizer.MIN_MARGIN && result.accuracy < 0.78) {
            window.UI.showRecognition(null, 0, false);
            window.UI.playSfx('fail');
            game.combo = 0;
            game.comboTimer = 0;
            return;
        }
        // 檢查是否為已解鎖技能 (PvP 忽略此檢查 — 對戰自由選擇 5 個)
        const isPvpCheck = game.state === 'pvp' && game.mp && game.mp.active;
        if (!isPvpCheck && !isSpellUnlocked(result.name)) {
            window.UI.showRecognitionStatus(result.name, result.accuracy, '[未解鎖]');
            window.UI.playSfx('fail');
            return;
        }
        if (!isSpellInLoadout(result.name)) {
            window.UI.showRecognitionStatus(result.name, result.accuracy, '[未裝備]');
            window.UI.playSfx('fail');
            return;
        }

        // 冷卻檢查 (依符文等級縮放) — PvP 公平戰: 一律等級 1
        const isPvpCtx = game.state === 'pvp' && game.mp && game.mp.active;
        const level = isPvpCtx ? 1 : (game.runeLevels[result.name] || 1);
        if (game.cooldowns[result.name] > 0) {
            window.UI.showRecognition(result.name, result.accuracy, false);
            return;
        }
        if (game.player.mp < cfg.mpCost) {
            window.UI.showRecognition(result.name, result.accuracy, false);
            return;
        }

        game.player.mp -= cfg.mpCost;
        game.cooldowns[result.name] = window.Spells.getScaledCooldown(result.name, cfg.cooldown, level);

        const critical = result.accuracy >= window.Recognizer.CRITICAL_THRESHOLD;
        window.UI.showRecognition(result.name, result.accuracy, critical);
        window.UI.playSfx(critical ? 'critical' : result.name);

        game.combo++;
        game.comboTimer = COMBO_TIMEOUT;
        game.spellsCast++;
        game.totalAccuracy += result.accuracy;

        let comboBonus = 1 + (game.combo - 1) * COMBO_DAMAGE_BONUS;
        if (game.activeBuffs.damage > 0) comboBonus *= 1.5;
        // PvP 平衡: 全域傷害倍率
        if (game.state === 'pvp' && game.mp && game.mp.active) {
            comboBonus *= window.Spells.pvpMul(result.name);
        }
        castSpell(result.name, critical, comboBonus, trail, level);
        if (onCast) onCast(result.name, critical);
    }

    /** 釋放魔法 — 支援等級縮放與華麗特效 */
    function castSpell(name, critical, comboBonus, trail, level) {
        const p = game.player;
        const cfg = window.Spells.CONFIG[name];
        const target = findNearestEnemy();
        const hi = level >= 3;      // 等級 3+ 更華麗特效
        const max = level >= 5;     // 滿級最華麗

        switch (name) {
            case 'fireball': {
                const tx = target ? target.x : p.x + 1200;
                const ty = target ? target.y : p.y;
                const proj = window.Spells.createProjectile(name, p.x, p.y, tx, ty, critical, level);
                if (proj) proj.damage *= comboBonus;
                // 多重火球 (滿級發射 3 顆扇形)
                if (max) {
                    const a = Math.atan2(ty - p.y, tx - p.x);
                    for (const off of [-0.25, 0.25]) {
                        const a2 = a + off;
                        const pj = window.Spells.createProjectile(name, p.x, p.y,
                            p.x + Math.cos(a2) * 1200, p.y + Math.sin(a2) * 1200, critical, level);
                        if (pj) pj.damage *= comboBonus * 0.7;
                    }
                }
                window.Particles.burst(p.x, p.y, {
                    count: hi ? 32 : 20, spread: hi ? 220 : 150,
                    life: 0.55, color: '#ff6622', color2: '#ffcc44', size: 5
                });
                break;
            }
            case 'lightning': {
                if (target) {
                    window.Spells.createLightning(p.x, p.y - 20, target.x, target.y);
                    const dmg = window.Spells.getScaledDamage(name, cfg.damage, level) *
                                (critical ? cfg.critMultiplier : 1) * comboBonus;
                    window.Enemies.damageEnemy(target, dmg);
                    spawnDamageNumber(target.x, target.y, dmg, critical);
                    if (target.dead) onEnemyKilled(target);
                    // 等級 3+ 連鎖到附近 1 個敵人
                    if (hi) {
                        const second = findNearestEnemyExcept(target, 300);
                        if (second) {
                            window.Spells.createLightning(target.x, target.y, second.x, second.y);
                            window.Enemies.damageEnemy(second, dmg * 0.6);
                            if (second.dead) onEnemyKilled(second);
                        }
                    }
                    // 滿級再連鎖一次
                    if (max) {
                        const third = findNearestEnemyExcept(target, 450);
                        if (third && third !== target) {
                            window.Spells.createLightning(target.x, target.y - 20, third.x, third.y);
                            window.Enemies.damageEnemy(third, dmg * 0.4);
                            if (third.dead) onEnemyKilled(third);
                        }
                    }
                    triggerShake(4, 0.15);
                }
                break;
            }
            case 'icespike': {
                if (target) {
                    const proj = window.Spells.createProjectile(name, p.x, p.y, target.x, target.y, critical, level);
                    if (proj) proj.damage *= comboBonus;
                }
                // 等級 3+ 額外左右兩發
                if (hi && target) {
                    for (const dy of [-60, 60]) {
                        const pj = window.Spells.createProjectile(name, p.x, p.y,
                            target.x, target.y + dy, critical, level);
                        if (pj) pj.damage *= comboBonus * 0.6;
                    }
                }
                window.Particles.emitIceShatter(p.x, p.y);
                break;
            }
            case 'heal': {
                const amount = window.Spells.getScaledHeal(cfg.healAmount, level) * (critical ? cfg.critMultiplier : 1);
                p.hp = Math.min(p.maxHp, p.hp + amount);
                window.Particles.emitHealGlow(p.x, p.y);
                if (hi) {
                    window.Spells.createShockwave(p.x, p.y, 180, '#aaffaa', 0.7);
                }
                // 滿級: 同時給予短暫護盾 (1 擋)
                if (max && !p.shieldActive) {
                    p.shieldActive = true;
                    p.shieldBlocks = 1;
                    p.shieldTimer = 3;
                }
                break;
            }
            case 'shield': {
                p.shieldActive = true;
                // 等級 3+ 可擋 2 次；滿級 3 次
                p.shieldBlocks = max ? 3 : (hi ? 2 : cfg.blocks);
                p.shieldTimer = cfg.duration + (level - 1) * 0.8;
                window.Particles.emitShieldForm(p.x, p.y, p.radius + 30);
                window.Spells.createShockwave(p.x, p.y, 120, '#88ddff', 0.5);
                break;
            }
            case 'meteor': {
                let tx = p.x + 700, ty = p.y;
                const alive = game.enemies.filter(e => !e.dead);
                if (alive.length) {
                    let sx = 0, sy = 0;
                    for (const e of alive) { sx += e.x; sy += e.y; }
                    tx = sx / alive.length;
                    ty = sy / alive.length;
                }
                window.Spells.scheduleMeteor(tx, ty, critical);
                // 等級 3+ 雙顆；滿級三連隕
                if (hi) {
                    setTimeout(() => {
                        if (game.state === 'playing') {
                            window.Spells.scheduleMeteor(tx + 120, ty + 40, critical);
                        }
                    }, 400);
                }
                if (max) {
                    setTimeout(() => {
                        if (game.state === 'playing') {
                            window.Spells.scheduleMeteor(tx - 120, ty - 40, critical);
                        }
                    }, 800);
                }
                break;
            }
            case 'wind': {
                // 水平向右高速穿透風刃
                const tx = target ? target.x : p.x + 1400;
                const ty = target ? target.y : p.y;
                const proj = window.Spells.createProjectile(name, p.x + p.radius, p.y, tx, ty, critical, level);
                if (proj) {
                    proj.damage *= comboBonus;
                    // 等級提升穿透數
                    proj.pierce = cfg.pierce + (level - 1);
                }
                // 等級 3+ 上下各發一道 (三連風刃)
                if (hi) {
                    for (const dy of [-80, 80]) {
                        const pj = window.Spells.createProjectile(name, p.x + p.radius, p.y + dy,
                            tx, ty + dy, critical, level);
                        if (pj) { pj.damage *= comboBonus * 0.7; pj.pierce = cfg.pierce; }
                    }
                }
                window.Particles.burst(p.x + p.radius, p.y, {
                    count: 18, spread: 200, life: 0.4,
                    color: '#aaffcc', color2: '#ffffff', size: 4
                });
                break;
            }
            case 'poison': {
                let tx = p.x + 500, ty = p.y;
                if (target) { tx = target.x; ty = target.y; }
                window.Spells.createPoisonField(tx, ty, critical, level);
                // 等級 3+ 兩塊毒場
                if (hi) {
                    window.Spells.createPoisonField(tx + 140, ty, critical, level);
                }
                window.Particles.burst(tx, ty, {
                    count: 22, spread: 180, life: 0.6,
                    color: '#88dd44', color2: '#2a6a1a', size: 5
                });
                break;
            }
            case 'teleport': {
                // 閃現到最後軌跡點 (玩家意圖的目標位置)，或目標敵人前方
                const last = trail[trail.length - 1];
                let tx, ty;
                if (target) {
                    // 往目標前方一段距離
                    const dx = target.x - p.x, dy = target.y - p.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    tx = target.x - (dx / len) * 120;
                    ty = target.y - (dy / len) * 120;
                } else {
                    tx = last ? last.x : p.x + 200;
                    ty = last ? last.y : p.y;
                }
                // 限制在邊界內
                const size = getCanvasSize();
                tx = Math.max(p.radius + 20, Math.min(size.w * 0.85, tx));
                ty = Math.max(p.radius + 20, Math.min(size.h - p.radius - 20, ty));
                // 舊位置消散特效
                window.Particles.burst(p.x, p.y, {
                    count: 25, spread: 250, life: 0.5,
                    color: '#ddccff', color2: '#ffffff', size: 4
                });
                p.x = tx; p.y = ty;
                bgGradient = null;
                // 新位置出現特效
                window.Particles.burst(tx, ty, {
                    count: 30, spread: 180, life: 0.6,
                    color: '#ffffff', color2: '#aa88ff', size: 5
                });
                window.Spells.createShockwave(tx, ty, 80, '#ddccff', 0.4);
                // 無敵窗口 (+ 等級加成)
                const invSec = cfg.invulnerability + (level - 1) * 0.1;
                game.invulnerableUntil = performance.now() + invSec * 1000;
                break;
            }
            case 'holynova': {
                // 環繞玩家的 AOE 爆發 + 自癒
                const dmg = window.Spells.getScaledDamage(name, cfg.damage, level) *
                            (critical ? cfg.critMultiplier : 1) * comboBonus;
                const heal = window.Spells.getScaledHeal(cfg.healAmount, level);
                p.hp = Math.min(p.maxHp, p.hp + heal * (critical ? cfg.critMultiplier : 1));
                for (let i = 0; i < game.enemies.length; i++) {
                    const ee = game.enemies[i];
                    if (ee.dead) continue;
                    const dx = ee.x - p.x, dy = ee.y - p.y;
                    if (dx * dx + dy * dy < cfg.radius * cfg.radius) {
                        window.Enemies.damageEnemy(ee, dmg);
                        spawnDamageNumber(ee.x, ee.y, dmg, critical);
                        if (ee.dead) onEnemyKilled(ee);
                    }
                }
                triggerHitstop(0.1);
                triggerFlash(0.35);
                // 多層衝擊波與光柱
                window.Spells.createShockwave(p.x, p.y, cfg.radius, '#ffee99', 0.9);
                if (hi) window.Spells.createShockwave(p.x, p.y, cfg.radius * 1.2, '#ffffff', 1.1);
                window.Particles.burst(p.x, p.y, {
                    count: max ? 80 : 55, spread: 380, life: 1.0,
                    color: '#ffee99', color2: '#ffffff', size: 5
                });
                // 光柱 (放射光斑)
                for (let i = 0; i < (max ? 16 : 10); i++) {
                    const a = (i / (max ? 16 : 10)) * Math.PI * 2;
                    for (let d = 40; d < cfg.radius; d += 22) {
                        window.Particles.spawn({
                            x: p.x + Math.cos(a) * d,
                            y: p.y + Math.sin(a) * d,
                            vx: Math.cos(a) * 80,
                            vy: Math.sin(a) * 80,
                            life: 0.6, size: 5,
                            color: '#ffff99', color2: '#ffffff',
                            drag: 0.95
                        });
                    }
                }
                triggerShake(5, 0.2);
                break;
            }
            case 'slash': {
                // 找前方扇形內敵人, 造成傷害
                const size = getCanvasSize();
                const dmg = window.Spells.getScaledDamage(name, cfg.damage, level) *
                            (critical ? cfg.critMultiplier : 1) * comboBonus;
                const reach = cfg.range + (level - 1) * 20;
                const arc = cfg.arcAngle + (level - 1) * 0.08;
                // 若有敵人, 朝最近敵人揮; 否則朝右
                let angle = 0;
                if (target) angle = Math.atan2(target.y - p.y, target.x - p.x);
                let hitCount = 0;
                for (let i = 0; i < game.enemies.length; i++) {
                    const ee = game.enemies[i];
                    if (ee.dead) continue;
                    const dx = ee.x - p.x, dy = ee.y - p.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 > reach * reach) continue;
                    const a2 = Math.atan2(dy, dx);
                    let diff = Math.abs(a2 - angle);
                    if (diff > Math.PI) diff = 2 * Math.PI - diff;
                    if (diff <= arc / 2) {
                        window.Enemies.damageEnemy(ee, dmg);
                        spawnDamageNumber(ee.x, ee.y, dmg, critical);
                        if (ee.dead) onEnemyKilled(ee);
                        hitCount++;
                    }
                }
                if (hitCount > 0) {
                    triggerHitstop(0.06);
                    if (critical) triggerFlash(0.2);
                }
                window.Spells.createMeleeArc(p.x, p.y, angle, reach, cfg.color);
                window.Particles.burst(p.x + Math.cos(angle) * reach * 0.7, p.y + Math.sin(angle) * reach * 0.7, {
                    count: 20 + hitCount * 5, spread: 220, life: 0.4,
                    color: cfg.color, color2: '#ffffff', size: 5
                });
                triggerShake(4, 0.15);
                // 滿級再補一刀 (雙重斬)
                if (max && hitCount > 0) {
                    setTimeout(() => {
                        if (game.state !== 'playing') return;
                        for (let i = 0; i < game.enemies.length; i++) {
                            const ee = game.enemies[i];
                            if (ee.dead) continue;
                            const dx = ee.x - p.x, dy = ee.y - p.y;
                            if (dx * dx + dy * dy > reach * reach) continue;
                            const a2 = Math.atan2(dy, dx);
                            let diff = Math.abs(a2 - angle);
                            if (diff > Math.PI) diff = 2 * Math.PI - diff;
                            if (diff <= arc / 2) {
                                window.Enemies.damageEnemy(ee, dmg * 0.6);
                                if (ee.dead) onEnemyKilled(ee);
                            }
                        }
                        window.Spells.createMeleeArc(p.x, p.y, angle + 0.15, reach, '#ffffff');
                    }, 180);
                }
                break;
            }
            case 'groundslam': {
                // 玩家四周 AOE
                const dmg = window.Spells.getScaledDamage(name, cfg.damage, level) *
                            (critical ? cfg.critMultiplier : 1) * comboBonus;
                const r = cfg.radius + (level - 1) * 20;
                for (let i = 0; i < game.enemies.length; i++) {
                    const ee = game.enemies[i];
                    if (ee.dead) continue;
                    const dx = ee.x - p.x, dy = ee.y - p.y;
                    if (dx * dx + dy * dy < r * r) {
                        window.Enemies.damageEnemy(ee, dmg);
                        spawnDamageNumber(ee.x, ee.y, dmg, critical);
                        if (ee.dead) onEnemyKilled(ee);
                        ee.slowedUntil = performance.now() + cfg.stunDuration * 1000;
                        ee.slowFactor = 0.1;
                    }
                }
                triggerHitstop(0.12);
                triggerFlash(0.2);
                window.Spells.createShockwave(p.x, p.y, r, '#cc8844', 0.7);
                if (hi) window.Spells.createShockwave(p.x, p.y, r * 1.25, '#ffdd66', 0.9);
                window.Particles.burst(p.x, p.y, {
                    count: 50, spread: r * 1.6, life: 0.9,
                    color: '#cc8844', color2: '#ffdd66', size: 6
                });
                // 地面裂紋粒子
                for (let i = 0; i < 20; i++) {
                    const a = (i / 20) * Math.PI * 2;
                    window.Particles.spawn({
                        x: p.x, y: p.y,
                        vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
                        life: 0.7, size: 6,
                        color: '#aa6633', color2: '#442211',
                        drag: 0.9, blend: 'source-over'
                    });
                }
                triggerShake(10, 0.35);
                break;
            }
            case 'blooddrain': {
                // 近戰吸血: 擊中敵人並回復生命
                const reach = cfg.range + (level - 1) * 15;
                const dmg = window.Spells.getScaledDamage(name, cfg.damage, level) *
                            (critical ? cfg.critMultiplier : 1) * comboBonus;
                let totalDealt = 0;
                let angle = 0;
                if (target) angle = Math.atan2(target.y - p.y, target.x - p.x);
                for (let i = 0; i < game.enemies.length; i++) {
                    const ee = game.enemies[i];
                    if (ee.dead) continue;
                    const dx = ee.x - p.x, dy = ee.y - p.y;
                    if (dx * dx + dy * dy > reach * reach) continue;
                    const a2 = Math.atan2(dy, dx);
                    let diff = Math.abs(a2 - angle);
                    if (diff > Math.PI) diff = 2 * Math.PI - diff;
                    if (diff <= Math.PI * 0.6) {
                        const dmgActual = Math.min(ee.hp, dmg);
                        window.Enemies.damageEnemy(ee, dmg);
                        spawnDamageNumber(ee.x, ee.y, dmg, critical);
                        totalDealt += dmgActual;
                        if (ee.dead) onEnemyKilled(ee);
                        // 吸血連線粒子
                        for (let s = 0; s < 12; s++) {
                            const t = s / 12;
                            window.Particles.spawn({
                                x: ee.x + (p.x - ee.x) * t,
                                y: ee.y + (p.y - ee.y) * t,
                                vx: (p.x - ee.x) * 0.8,
                                vy: (p.y - ee.y) * 0.8,
                                life: 0.4, size: 4,
                                color: '#ff4466', color2: '#aa1122',
                                drag: 0.9
                            });
                        }
                    }
                }
                const heal = totalDealt * cfg.lifesteal * (hi ? 1.2 : 1);
                if (heal > 0) {
                    p.hp = Math.min(p.maxHp, p.hp + heal);
                    window.Particles.emitHealGlow(p.x, p.y);
                }
                window.Spells.createMeleeArc(p.x, p.y, angle, reach, '#aa1122');
                break;
            }
        }

        // 暴擊統一視覺: 螢幕輕震 + 閃光
        if (critical) {
            triggerShake(3, 0.1);
            window.Particles.spawn({
                x: p.x, y: p.y, vx: 0, vy: 0,
                life: 0.25, size: 40, sizeDecay: 0.9,
                color: '#ffff99', color2: '#ffffff',
                drag: 1, fade: true
            });
        }
    }

    function findNearestEnemyExcept(exclude, maxDist) {
        let best = null, bestD = maxDist ? maxDist * maxDist : Infinity;
        for (const e of game.enemies) {
            if (e.dead || e === exclude) continue;
            const dx = e.x - exclude.x, dy = e.y - exclude.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    function findNearestEnemy() {
        let best = null, bestD = Infinity;
        for (const e of game.enemies) {
            if (e.dead) continue;
            const d = (e.x - game.player.x) * (e.x - game.player.x)
                    + (e.y - game.player.y) * (e.y - game.player.y);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    function onEnemyKilled(enemy) {
        game.kills++;
        const base = enemy.def.reward;
        const comboBonus = 1 + (game.combo - 1) * COMBO_DAMAGE_BONUS;
        game.score += Math.floor(base * comboBonus);
        // 金幣減少: 原本 /5, 改為 /10; 另外有機率掉落 pickup
        const gold = Math.max(1, Math.floor(base / 10));
        game.gold += gold;
        window.UI.playSfx('enemyDie');
        // 敵人死亡機率掉落 pickup (25% 普通, 50% Boss)
        const dropChance = enemy.def.boss ? 0.5 : 0.25;
        if (Math.random() < dropChance) {
            trySpawnPickup(enemy.x, enemy.y);
        }
    }

    function onPlayerHit(damage, source) {
        const p = game.player;
        // 閃現無敵窗口
        if (performance.now() < game.invulnerableUntil) return;
        // 護盾擋下
        if (p.shieldActive && p.shieldBlocks > 0) {
            p.shieldBlocks--;
            if (p.shieldBlocks <= 0) {
                p.shieldActive = false;
                p.shieldTimer = 0;
            }
            window.Particles.burst(p.x, p.y, {
                count: 40, spread: 250, life: 0.5,
                color: '#88ddff', color2: '#ffffff', size: 4
            });
            window.Spells.createShockwave(p.x, p.y, 100, '#88ddff', 0.4);
            window.UI.playSfx('shield');
            return;
        }
        p.hp -= damage;
        p.hitFlash = 1;
        window.UI.playSfx('playerHurt');
        window.Particles.emitHitSplash(p.x, p.y, '#ff4466');
        triggerShake(damage > 15 ? 8 : 4, 0.2);
        game.combo = 0;
        game.comboTimer = 0;
        if (p.hp <= 0) {
            p.hp = 0;
            // PvP 模式: 我死了 → 輸這回合, 不要跑單人結算
            if (game.mp && game.mp.active) {
                localRoundDecided(false);
            } else {
                endLevel(false);
            }
        }
    }

    function onEnemyCastStart(enemy) {
        // 目前只用視覺提示，不做額外處理 (渲染在 enemies.js)
    }

    // ==== 關卡控制 ====
    function startLevel(levelNum) {
        game.state = 'playing';
        game.infinite = false;
        game.level = levelNum;
        game.wave = 0;
        game.nextWaveDelay = 0;
        commonLevelStart();
        const size = getCanvasSize();
        game.waves = window.Enemies.buildLevel(levelNum, size).slice();
        game.currentLevelScale = window.Enemies.getLevelScale
            ? window.Enemies.getLevelScale(levelNum)
            : { hpMul: 1, speedMul: 1, damageMul: 1 };
        // 顯示關卡/分數，隱藏波次
        document.getElementById('level-display').classList.remove('hidden');
        document.getElementById('wave-display').classList.add('hidden');
        document.getElementById('highscore-display').classList.add('hidden');
    }

    function openShop() {
        window.UI.showScreen('shop-screen');
        refreshShop();
    }

    // ==== 多人對戰 ====
    function openMpLobby() {
        window.UI.showScreen('mp-lobby');
        document.getElementById('mp-status').classList.add('hidden');
        document.getElementById('mp-code-input').value = '';
    }

    function showMpStatus(msg, isError) {
        const el = document.getElementById('mp-status');
        el.textContent = msg;
        el.classList.remove('hidden');
        el.classList.toggle('mp-error', !!isError);
    }

    function setupMpHandlers() {
        window.Multiplayer.on('open', (conn) => {
            if (window.Multiplayer.isHost()) {
                // 新加入的訪客 — 指派 slot (1, 2, 3 順序)
                const usedSlots = new Set([0]);
                for (const slot in game.mp.players) usedSlots.add(parseInt(slot, 10));
                let assignSlot = -1;
                for (let s = 1; s <= 3; s++) {
                    if (!usedSlots.has(s)) { assignSlot = s; break; }
                }
                if (assignSlot === -1) return;
                // 依目前兩隊人數 (包含自己 + 已連線玩家) 指派到較少的那隊, 保證 2 vs 2
                let t0 = (game.mp.myTeam === 0) ? 1 : 0;
                let t1 = (game.mp.myTeam === 1) ? 1 : 0;
                for (const sKey in game.mp.players) {
                    if (game.mp.players[sKey].team === 0) t0++; else t1++;
                }
                const team = t0 <= t1 ? 0 : 1;
                game.mp.players[assignSlot] = {
                    slot: assignSlot, team: team, name: 'P' + assignSlot,
                    x: 0, y: 0, hp: 100, maxHp: 100,
                    alive: true, hitFlash: 0, bobPhase: Math.random() * Math.PI * 2,
                    connId: conn && conn.peer ? conn.peer : null
                };
                // 送 slot 指派 + 當前 config
                const connObj = (conn && conn.send) ? conn : null;
                const msg = {
                    type: 'assignSlot',
                    slot: assignSlot, team: team,
                    teamMode: game.mp.teamMode,
                    mapId: document.getElementById('mp-map-select').value,
                    rounds: parseInt(document.getElementById('mp-rounds-select').value, 10)
                };
                if (connObj) { try { connObj.send(msg); } catch (e) {} }
                else window.Multiplayer.send(msg);
                // 廣播 lobby 狀態
                broadcastLobby();
                updateRoomUI();
            } else {
                // 訪客: 進入房間畫面, 等主機 'assignSlot'
                window.UI.showScreen('mp-room');
                document.getElementById('mp-code-display').textContent = window.Multiplayer.getCode();
                document.getElementById('mp-host-config').classList.add('hidden');
                document.getElementById('mp-me-slot').querySelector('.mp-slot-label').textContent = '你 (訪客)';
                document.getElementById('mp-me-slot').querySelector('.mp-slot-status').textContent = '✓ 就緒';
                document.getElementById('mp-opp-slot').querySelector('.mp-slot-label').textContent = '房主';
                document.getElementById('mp-opp-slot').querySelector('.mp-slot-status').textContent = '等待設定...';
            }
        });
        window.Multiplayer.on('data', handleMpData);
        window.Multiplayer.on('close', (conn) => {
            // 2v2: 單一訪客離線時, 若房主在等待大廳, 只更新 UI 不結束
            if (window.Multiplayer.isHost() && !game.mp.active) {
                // 從 players 移除對應的 slot
                const peerId = conn && conn.peer;
                for (const s in game.mp.players) {
                    if (game.mp.players[s].connId === peerId) {
                        delete game.mp.players[s];
                        break;
                    }
                }
                broadcastLobby();
                updateRoomUI();
                return;
            }
            if (game.mp.active) {
                endMpMatch('對手已離線', 'forfeit-opp-leave');
            } else {
                showMpStatus('對手已斷線', true);
            }
        });
        window.Multiplayer.on('error', (msg) => {
            showMpStatus('連線失敗: ' + msg, true);
        });
    }

    function hostRoom() {
        setupMpHandlers();
        const capacity = game.mp.teamMode === '2v2' ? 4 : 2;
        game.mp.isHost = true;
        game.mp.mySlot = 0;
        game.mp.myTeam = 0;
        game.mp.players = {};
        window.Multiplayer.host((code) => {
            window.UI.showScreen('mp-room');
            document.getElementById('mp-code-display').textContent = code;
            document.getElementById('mp-room-title').textContent = game.mp.teamMode === '2v2' ? '等待 3 位對手 (2v2)' : '等待對手 (1v1)';
            document.getElementById('mp-host-config').classList.remove('hidden');
            document.getElementById('mp-start-btn').disabled = true;
            const needed = capacity - 1;
            document.getElementById('mp-start-btn').textContent = `等待 ${needed} 位對手...`;
            renderRoomSlots();
        }, (err) => showMpStatus('無法開房: ' + err, true), capacity);
    }

    function joinRoom(code) {
        if (!code || code.length !== 6) {
            showMpStatus('代碼必須為 6 碼', true);
            return;
        }
        setupMpHandlers();
        game.mp.isHost = false;
        game.mp.players = {};
        showMpStatus('連線中...', false);
        window.Multiplayer.join(code, (err) => showMpStatus('加入失敗: ' + err, true));
    }

    function leaveMp() {
        window.Multiplayer.send({ type: 'leave' });
        window.Multiplayer.disconnect();
        game.mp.active = false;
        document.getElementById('mp-result').classList.add('hidden');
        window.UI.showScreen('main-menu');
        window.UI.showControlsHint(false);
    }

    // 返回房間等下一場對戰 (不斷線, 重置比數)
    function rematchMp() {
        const mp = game.mp;
        mp.active = false;
        mp.myWins = 0;
        mp.oppWins = 0;
        mp.roundNum = 0;
        mp.roundState = 'idle';
        document.getElementById('mp-result').classList.add('hidden');
        window.UI.showControlsHint(false);
        // 告知對方返回房間
        window.Multiplayer.send({ type: 'rematch' });
        window.UI.showScreen('mp-room');
        // 房主重置按鈕
        if (window.Multiplayer.isHost()) {
            const btn = document.getElementById('mp-start-btn');
            btn.disabled = !window.Multiplayer.isConnected();
            btn.textContent = window.Multiplayer.isConnected() ? '開始對戰' : '等待對手...';
        }
    }

    function broadcastLobby() {
        // 包含房主 (slot 0) + 所有訪客, 帶上名稱與隊伍
        const players = {};
        players[0] = {
            slot: 0,
            team: game.mp.myTeam,
            name: game.mp.myName,
            isHost: true
        };
        for (const s in game.mp.players) {
            const p = game.mp.players[s];
            players[s] = {
                slot: p.slot,
                team: p.team,
                name: p.name || ('P' + s),
                isHost: false
            };
        }
        window.Multiplayer.send({
            type: 'lobby',
            players: players,
            teamMode: game.mp.teamMode,
            capacity: game.mp.teamMode === '2v2' ? 4 : 2
        });
    }

    function updateRoomUI() {
        if (window.Multiplayer.isHost()) {
            const needed = (game.mp.teamMode === '2v2' ? 4 : 2) - 1;
            const have = window.Multiplayer.connectionCount();
            const btn = document.getElementById('mp-start-btn');
            if (btn) {
                if (have >= needed) {
                    btn.disabled = false;
                    btn.textContent = '開始對戰';
                } else {
                    btn.disabled = true;
                    btn.textContent = `等待 ${needed - have} 位對手...`;
                }
            }
        }
        renderRoomSlots();
    }

    // 渲染房間內所有 slot (藍/紅 兩隊分欄)
    function renderRoomSlots() {
        const mp = game.mp;
        const is2v2 = mp.teamMode === '2v2';
        const blueDiv = document.getElementById('mp-team-0-slots');
        const redDiv = document.getElementById('mp-team-1-slots');
        if (!blueDiv || !redDiv) return;
        blueDiv.innerHTML = '';
        redDiv.innerHTML = '';

        // 組合全部 slot (含自己)
        const allSlots = {};
        allSlots[mp.mySlot] = {
            slot: mp.mySlot,
            team: mp.myTeam,
            name: mp.myName + ' (你)',
            isHost: mp.isHost || window.Multiplayer.isHost(),
            connected: true,
            isSelf: true
        };
        for (const s in mp.players) {
            const p = mp.players[s];
            allSlots[s] = {
                slot: p.slot,
                team: p.team,
                name: p.name || ('訪客 ' + s),
                isHost: !!p.isHost,
                connected: true,
                isSelf: false
            };
        }

        // 空 slot (尚未加入)
        const capacity = is2v2 ? 4 : 2;
        // 2v2 以目前兩隊填入情況做預測, 讓空位補到較少的隊
        let t0Filled = 0, t1Filled = 0;
        for (const k in allSlots) {
            if (allSlots[k].team === 0) t0Filled++; else t1Filled++;
        }
        for (let s = 0; s < capacity; s++) {
            if (!allSlots[s]) {
                let predictedTeam;
                if (is2v2) {
                    if (t0Filled < 2) { predictedTeam = 0; t0Filled++; }
                    else              { predictedTeam = 1; t1Filled++; }
                } else {
                    predictedTeam = s % 2;
                }
                allSlots[s] = {
                    slot: s, team: predictedTeam,
                    name: '(空位)', isHost: false,
                    connected: false, isSelf: false
                };
            }
        }

        // 分類繪製
        for (const sKey in allSlots) {
            const s = allSlots[sKey];
            const card = document.createElement('div');
            card.className = 'mp-player-card' +
                (s.connected ? '' : ' empty') +
                (s.isSelf ? ' self' : '');
            card.innerHTML = `
                <div class="mp-card-slot">Slot ${s.slot}${s.isHost ? ' · 房主' : ''}</div>
                <div class="mp-card-name">${s.name}</div>
                <div class="mp-card-status">${s.connected ? '✓ 就緒' : '等待中'}</div>
            `;
            // 房主可按 slot 來交換隊伍 (只對已連線的, 不是空位)
            if (is2v2 && window.Multiplayer.isHost() && s.connected) {
                const btn = document.createElement('button');
                btn.className = 'mp-team-swap-btn';
                btn.textContent = '切換隊伍';
                btn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    hostSwapTeam(s.slot);
                });
                card.appendChild(btn);
            }
            (s.team === 0 ? blueDiv : redDiv).appendChild(card);
        }
    }

    // 取得指定 slot 當前隊伍 (self / player)
    function getSlotTeam(slot) {
        if (slot === game.mp.mySlot) return game.mp.myTeam;
        if (game.mp.players[slot]) return game.mp.players[slot].team;
        return null;
    }
    function setSlotTeam(slot, team) {
        if (slot === game.mp.mySlot) game.mp.myTeam = team;
        else if (game.mp.players[slot]) game.mp.players[slot].team = team;
    }

    // 房主: 把某 slot 換隊; 2v2 會自動與對面一位互換, 保持 2 vs 2
    function hostSwapTeam(slot) {
        const mp = game.mp;
        if (!window.Multiplayer.isHost()) return;
        const currentTeam = getSlotTeam(slot);
        if (currentTeam === null) return;
        const newTeam = 1 - currentTeam;

        if (mp.teamMode === '2v2') {
            // 統計目標隊伍目前人數 (排除正在被換的 slot)
            let targetCount = 0;
            const newTeamMembers = [];
            if (mp.mySlot !== slot && mp.myTeam === newTeam) {
                targetCount++;
                newTeamMembers.push(mp.mySlot);
            }
            for (const s in mp.players) {
                const sNum = parseInt(s, 10);
                if (sNum !== slot && mp.players[s].team === newTeam) {
                    targetCount++;
                    newTeamMembers.push(sNum);
                }
            }
            // 已滿 → 找搭檔反向換
            if (targetCount >= 2) {
                const partner = newTeamMembers[0];
                if (partner === undefined) return;
                setSlotTeam(partner, currentTeam);
            }
        }

        setSlotTeam(slot, newTeam);
        broadcastLobby();
        renderRoomSlots();
        window.UI.playSfx('ui');
    }

    function handleMpData(data) {
        if (!data || typeof data !== 'object') return;
        const mp = game.mp;
        switch (data.type) {
            case 'config':
                mp.mapId = data.mapId;
                mp.rounds = data.rounds;
                document.getElementById('mp-opp-slot').querySelector('.mp-slot-status').textContent = '房主已設定';
                break;
            case 'assignSlot':
                // 訪客收到自己的 slot 與隊伍
                mp.mySlot = data.slot;
                mp.myTeam = data.team;
                mp.teamMode = data.teamMode || '1v1';
                mp.mapId = data.mapId || mp.mapId;
                mp.rounds = data.rounds || mp.rounds;
                // 回覆房主自己的名稱 (附上 slot 以便比對)
                window.Multiplayer.send({ type: 'hello', name: game.mp.myName, slot: mp.mySlot });
                renderRoomSlots();
                break;
            case 'lobby':
                // 訪客收到完整 lobby 組成 (包含房主 slot 0)
                mp.teamMode = data.teamMode || mp.teamMode;
                mp.players = {};
                for (const s in data.players) {
                    const src = data.players[s];
                    const slotNum = parseInt(s, 10);
                    if (slotNum === mp.mySlot) {
                        // 自己的隊伍可能被房主改過
                        mp.myTeam = src.team;
                        continue;
                    }
                    mp.players[slotNum] = {
                        slot: src.slot,
                        team: src.team,
                        name: src.name || ('P' + slotNum),
                        isHost: !!src.isHost,
                        x: 0, y: 0, hp: 100, maxHp: 100,
                        alive: true, hitFlash: 0, bobPhase: 0
                    };
                }
                renderRoomSlots();
                break;
            case 'hello':
                // 訪客連線後送上名稱與自己的 slot; 房主更新並廣播
                if (game.mp.isHost && data.name && data.slot !== undefined) {
                    if (game.mp.players[data.slot]) {
                        game.mp.players[data.slot].name = String(data.name).slice(0, 12);
                        broadcastLobby();
                        renderRoomSlots();
                    }
                }
                break;
            case 'teamSwap':
                // 房主改變某 slot 的隊伍
                if (data.slot === mp.mySlot) {
                    mp.myTeam = data.team;
                }
                if (mp.players[data.slot]) {
                    mp.players[data.slot].team = data.team;
                }
                renderRoomSlots();
                break;
            case 'start':
                mp.mapId = data.mapId || mp.mapId;
                mp.rounds = data.rounds || mp.rounds;
                beginMpMatch(false);
                break;
            case 'state':
                if (data.slot !== undefined && mp.teamMode === '2v2') {
                    const p = mp.players[data.slot];
                    if (p) {
                        p.x = data.x; p.y = data.y;
                        p.hp = data.hp; p.maxHp = data.maxHp;
                        p.alive = data.hp > 0;
                        if (data.name) p.name = data.name;
                    }
                } else {
                    mp.opponent.x = data.x;
                    mp.opponent.y = data.y;
                    mp.opponent.hp = data.hp;
                    mp.opponent.maxHp = data.maxHp;
                    mp.opponent.alive = data.hp > 0;
                    if (data.name) mp.opponent.name = data.name;
                    mp.opponent.lastUpdate = performance.now();
                }
                break;
            case 'cast':
                // 對手發射技能 — 本端產生對應視覺 (發射者 = 對手)
                spawnRemoteCast(data);
                break;
            case 'hit':
                if (mp.roundState !== 'playing') break;
                // 2v2: 只有 data.target 是自己 slot 才吃傷害
                if (data.target !== undefined && data.target !== mp.mySlot) break;
                onPlayerHit(data.damage, { kind: data.spell, x: data.x, y: data.y });
                break;
            case 'roundOver':
                // 重複訊息防止 (本端可能已自行判定)
                if (mp.roundState !== 'playing') break;
                // 送方的 loser='self' 代表「送方死了」→ 我贏
                //       loser='opponent' 代表「送方打死了對手(我)」→ 我輸
                if (data.loser === 'self') mp.myWins++;
                else mp.oppWins++;
                mp.roundState = 'over';
                showMpBanner(`${data.loser === 'self' ? '這回合勝利' : '這回合失敗'}\n比分  ${mp.myWins} - ${mp.oppWins}`, 2.8);
                {
                    const needed = Math.ceil(mp.rounds / 2);
                    if (mp.myWins >= needed || mp.oppWins >= needed) {
                        setTimeout(() => endMpMatch(mp.myWins > mp.oppWins ? '你贏了！' : '你輸了...'), 3000);
                    } else {
                        setTimeout(() => { if (game.mp.active) startMpRound(); }, 3000);
                    }
                }
                break;
            case 'leave':
                endMpMatch('對手離開了', 'forfeit');
                break;
            case 'rematch':
                // 對方點了返回房間
                if (game.mp.active) {
                    // 若我方還在對戰中, 視為對方投降
                    endMpMatch('對手結束對戰', 'forfeit');
                } else {
                    // 我也回到房間
                    game.mp.myWins = 0;
                    game.mp.oppWins = 0;
                    game.mp.roundNum = 0;
                    game.mp.roundState = 'idle';
                    document.getElementById('mp-result').classList.add('hidden');
                    window.UI.showScreen('mp-room');
                    window.UI.showControlsHint(false);
                }
                break;
        }
    }

    function spawnRemoteCast(data) {
        // 將對手端的施法還原到本地視覺 — 起點是對手位置, 目標朝我方向
        const opp = game.mp.opponent;
        const me = game.player;
        const tx = me.x + (Math.random() - 0.5) * 30;
        const ty = me.y + (Math.random() - 0.5) * 30;
        const name = data.spell;
        switch (name) {
            case 'fireball':
            case 'icespike':
            case 'wind': {
                const proj = window.Spells.createProjectile(name, opp.x, opp.y, tx, ty, false, 1);
                if (proj) {
                    proj._remote = true;
                    proj.damage = data.damage || proj.damage;
                }
                break;
            }
            case 'lightning':
                window.Spells.createLightning(opp.x, opp.y - 20, me.x, me.y);
                // 直接收到 hit 訊息時扣血, 這裡僅視覺
                break;
            case 'meteor':
                window.Spells.scheduleMeteor(data.tx || me.x, data.ty || me.y, false);
                break;
            case 'holynova':
                window.Spells.createShockwave(opp.x, opp.y, 220, '#ffee99', 0.9);
                window.Particles.burst(opp.x, opp.y, { count: 50, spread: 300, life: 0.9, color: '#ffee99', color2: '#ffffff', size: 5 });
                break;
            default:
                // 近戰不發投射物, 只看到對手位置的效果
                window.Particles.burst(opp.x, opp.y, { count: 20, spread: 150, life: 0.5, color: '#ff99bb', color2: '#ffffff', size: 4 });
        }
    }

    /** 開始對戰 (房主 / 訪客皆呼叫) */
    function beginMpMatch(asHost) {
        const mp = game.mp;
        mp.active = true;
        mp.isHost = asHost;
        mp.myWins = 0;
        mp.oppWins = 0;
        mp.roundNum = 0;
        mp.roundState = 'idle';
        startMpRound();
    }

    function startMpRound() {
        const mp = game.mp;
        mp.roundNum++;
        mp.roundState = 'countdown';
        mp.countdown = 3.0;
        game.state = 'pvp';
        game.enemies = [];
        game.waves = [];
        game.infinite = false;
        game.level = 0;
        window.UI.hideResult();
        document.getElementById('mp-result').classList.add('hidden');
        window.UI.showScreen('game-screen');
        resizeCanvas();
        const size = getCanvasSize();
        const abs = window.Maps.getAbs(mp.mapId, size.w, size.h);
        mp.obstacles = abs ? abs.obstacles : [];
        game.player.maxHp = 100 + game.statUpgrades.hp * 10;
        game.player.maxMp = 100 + game.statUpgrades.mp * 10;
        game.player.hp = game.player.maxHp;
        game.player.mp = game.player.maxMp;
        game.player.shieldActive = false;
        game.player.shieldBlocks = 0;
        game.player.shieldTimer = 0;
        // 自己 slot / team 決定位置
        const is2v2 = mp.teamMode === '2v2';
        const myTeam = mp.myTeam || 0;
        const spawnPositionsByTeam = is2v2 ? {
            0: [[0.15, 0.35], [0.15, 0.75]],
            1: [[0.85, 0.35], [0.85, 0.75]]
        } : {
            0: [[0.18, 0.5]],
            1: [[0.82, 0.5]]
        };
        // 自己位置 — 看 slot 在隊伍內的順序
        const myPosIdx = Math.floor(mp.mySlot / 2);
        const myPos = spawnPositionsByTeam[myTeam][myPosIdx] || spawnPositionsByTeam[myTeam][0];
        game.player.x = size.w * myPos[0];
        game.player.y = size.h * myPos[1];
        // 其他玩家位置
        if (is2v2) {
            for (const s in mp.players) {
                const p = mp.players[s];
                p.hp = 100; p.maxHp = 100; p.alive = true; p.hitFlash = 0;
                const team = p.team;
                const posIdx = Math.floor(p.slot / 2);
                const pos = spawnPositionsByTeam[team][posIdx] || spawnPositionsByTeam[team][0];
                p.x = size.w * pos[0];
                p.y = size.h * pos[1];
            }
        }
        // 1v1 兼容 opponent
        mp.opponent.x = mp.isHost ? size.w * 0.82 : size.w * 0.18;
        mp.opponent.y = size.h * 0.5;
        mp.opponent.hp = 100;
        mp.opponent.maxHp = 100;
        mp.opponent.alive = true;
        // 重置冷卻/效果
        for (const k in game.cooldowns) game.cooldowns[k] = 0;
        window.Particles.clear();
        window.Spells.clearAll();
        window.Enemies.clearProjectiles();
        game.damageNumbers.length = 0;
        game.traps = [];
        game.pickups = [];
        game.activeBuffs = {};
        game.hitstopTimer = 0;
        game.flashFrame = 0;
        window.UI.buildCooldownIcons(window.Spells.CONFIG, game.pvpLoadout);
        window.UI.updateHUD(getHudState());
        window.UI.startBgm();
        window.UI.showControlsHint(true);
        // 隱藏非必要 HUD
        document.getElementById('wave-display').classList.add('hidden');
        document.getElementById('highscore-display').classList.add('hidden');
        document.getElementById('level-display').classList.add('hidden');
        document.getElementById('gold-display').classList.add('hidden');
        // 回合顯示
        showMpBanner(`第 ${mp.roundNum} 回合  ${mp.myWins}-${mp.oppWins}`, 1.5);
    }

    function endMpRound() {
        const mp = game.mp;
        mp.roundState = 'over';
        const needed = Math.ceil(mp.rounds / 2);
        if (mp.myWins >= needed || mp.oppWins >= needed) {
            // 整場結束
            setTimeout(() => endMpMatch(mp.myWins > mp.oppWins ? '你贏了！' : '你輸了...'), 1500);
        } else {
            // 下一回合
            setTimeout(() => { if (game.mp.active) startMpRound(); }, 1800);
        }
    }

    function endMpMatch(title, reason) {
        const mp = game.mp;
        mp.active = false;
        game.state = 'menu';
        const stats = {
            '最終比數': `${mp.myWins} - ${mp.oppWins}`,
            '地圖': window.Maps.get(mp.mapId) ? window.Maps.get(mp.mapId).name : '?',
            '回合制': 'BO' + mp.rounds
        };
        if (reason === 'forfeit' || reason === 'forfeit-opp-leave') stats['結束'] = '對手離線';
        document.getElementById('mp-result-title').textContent = title;
        let html = '';
        for (const k in stats) {
            html += `<div>${k}: <span class="stat-value">${stats[k]}</span></div>`;
        }
        document.getElementById('mp-result-stats').innerHTML = html;
        document.getElementById('mp-result').classList.remove('hidden');
        window.UI.playSfx(mp.myWins > mp.oppWins ? 'victory' : 'defeat');
    }

    let mpBannerEl = null;
    let mpBannerTimer = null;
    function showMpBanner(text, seconds) {
        if (!mpBannerEl) {
            mpBannerEl = document.createElement('div');
            mpBannerEl.id = 'mp-banner';
            mpBannerEl.className = 'mp-banner';
            document.getElementById('game-container').appendChild(mpBannerEl);
        }
        mpBannerEl.textContent = text;
        mpBannerEl.classList.remove('hidden');
        clearTimeout(mpBannerTimer);
        mpBannerTimer = setTimeout(() => mpBannerEl.classList.add('hidden'), seconds * 1000);
    }

    // ==== 技能管理 ====
    function openSkills() {
        window.UI.showScreen('skills-screen');
        refreshSkills();
    }

    function refreshSkills() {
        window.UI.buildSkills({
            runeLevels: game.runeLevels,
            available: availableSkillPoints(),
            earned: game.skillPointsEarned,
            isUnlocked: isSpellUnlocked
        }, (key, delta) => {
            const current = game.runeLevels[key] || 1;
            if (delta > 0) {
                if (current >= 5 || availableSkillPoints() <= 0) return;
                game.runeLevels[key] = current + 1;
                window.UI.playSfx('levelUp');
            } else if (delta < 0) {
                if (current <= 1) return;
                game.runeLevels[key] = current - 1;
                window.UI.playSfx('ui');
            }
            saveProgress();
            refreshSkills();
        });
    }

    // ==== 出戰選擇流程 ====
    function openLoadout(continuation, mpMode) {
        game._loadoutContinuation = continuation;
        game._loadoutMpMode = !!mpMode;
        refreshLoadout();
        window.UI.showScreen('loadout-screen');
    }

    function refreshLoadout() {
        const mpMode = !!game._loadoutMpMode;
        const listRef = mpMode ? game.pvpLoadout : game.loadout;
        window.UI.buildLoadout({
            loadout: listRef,
            runeLevels: game.runeLevels,
            isUnlocked: mpMode ? (() => true) : isSpellUnlocked,
            mpMode: mpMode
        }, (spellKey) => {
            const target = mpMode ? game.pvpLoadout : game.loadout;
            const idx = target.indexOf(spellKey);
            if (idx >= 0) {
                target.splice(idx, 1);
            } else if (target.length < LOADOUT_MAX) {
                target.push(spellKey);
            }
            saveProgress();
            refreshLoadout();
        });
    }

    function refreshShop() {
        window.UI.buildShop(
            { gold: game.gold, shopPurchased: game.shopPurchased, statUpgrades: game.statUpgrades },
            (spellKey, cost) => {
                if (game.gold < cost || game.shopPurchased[spellKey]) return;
                game.gold -= cost;
                game.shopPurchased[spellKey] = true;
                saveProgress();
                window.UI.playSfx('purchase');
                refreshShop();
            },
            (upKey, cost) => {
                const lvl = game.statUpgrades[upKey] || 0;
                const item = window.UI.SHOP_UPGRADES.find(i => i.key === upKey);
                if (!item || lvl >= item.max || game.gold < cost) return;
                game.gold -= cost;
                game.statUpgrades[upKey] = lvl + 1;
                saveProgress();
                window.UI.playSfx('purchase');
                refreshShop();
            }
        );
    }

    function startInfinite() {
        game.state = 'playing';
        game.infinite = true;
        game.level = 0;
        game.wave = 0;
        game.nextWaveDelay = 1.5;  // 1.5 秒後第 1 波
        commonLevelStart();
        game.waves = [];  // 無限模式用 nextWaveDelay 驅動
        // 顯示波次/高分，隱藏關卡
        document.getElementById('level-display').classList.add('hidden');
        document.getElementById('wave-display').classList.remove('hidden');
        document.getElementById('highscore-display').classList.remove('hidden');
        updateWaveDisplay();
    }

    function updateWaveDisplay() {
        document.getElementById('wave-display').textContent =
            game.wave > 0 ? '波次: ' + game.wave : '準備...';
        document.getElementById('highscore-display').textContent =
            '最高: ' + game.infiniteHighScore;
    }

    function commonLevelStart() {
        game.score = 0;
        game.combo = 0;
        game.comboTimer = 0;
        game.kills = 0;
        game.totalAccuracy = 0;
        game.spellsCast = 0;
        game.enemies = [];
        game.waveTimer = 0;
        game.levelStartTime = performance.now();
        for (const key in game.cooldowns) game.cooldowns[key] = 0;
        window.UI.hideResult();
        window.UI.showScreen('game-screen');
        resizeCanvas();
        const size = getCanvasSize();
        // 套用商城購買的屬性升級
        game.player.maxHp = PLAYER_MAX_HP + game.statUpgrades.hp * 10;
        game.player.maxMp = PLAYER_MAX_MP + game.statUpgrades.mp * 10;
        game.player.hp = game.player.maxHp;
        game.player.mp = game.player.maxMp;
        game.player.shieldActive = false;
        game.player.shieldBlocks = 0;
        game.player.shieldTimer = 0;
        game.player.x = Math.max(140, size.w * 0.12);
        game.player.y = size.h / 2;
        window.Particles.clear();
        window.Spells.clearAll();
        window.Enemies.clearProjectiles();
        game.damageNumbers.length = 0;
        game.hitstopTimer = 0;
        game.flashFrame = 0;
        game.traps.length = 0;
        game.pickups.length = 0;
        game.activeBuffs = {};
        // 關卡/無限模式皆放置陷阱: 關卡越後越多, 無限視波次
        const trapCount = game.infinite
            ? Math.min(6, 1 + Math.floor((game.wave || 0) / 3))
            : Math.min(6, Math.floor((game.level || 1) / 2));
        if (trapCount > 0) seedTraps(trapCount);
        window.UI.buildCooldownIcons(window.Spells.CONFIG, game.loadout);
        window.UI.updateHUD(getHudState());
        window.UI.startBgm();
        window.UI.showControlsHint(true);
    }

    function endLevel(victory) {
        game.state = victory ? 'victory' : 'defeat';
        window.UI.playSfx(victory ? 'victory' : 'defeat');

        const avgAcc = game.spellsCast ? Math.round(game.totalAccuracy / game.spellsCast * 100) : 0;
        const timeSec = Math.round((performance.now() - game.levelStartTime) / 1000);

        if (game.infinite) {
            // 無限模式只有失敗
            const newHigh = game.score > game.infiniteHighScore;
            if (newHigh) {
                game.infiniteHighScore = game.score;
                try { localStorage.setItem('magicRunes.infiniteHigh', String(game.score)); } catch (e) {}
            }
            const stats = {
                '抵達波次': game.wave,
                '擊殺數': game.kills,
                '施法次數': game.spellsCast,
                '平均準確度': avgAcc + '%',
                '本場分數': game.score,
                '歷史最高': game.infiniteHighScore + (newHigh ? ' ★新紀錄' : ''),
                '存活時間': timeSec + ' 秒'
            };
            window.UI.showResult('無限模式結束', stats, false);
            return;
        }

        if (victory && game.level >= game.unlockedLevels) {
            game.unlockedLevels = Math.min(window.Enemies.TOTAL_LEVELS, game.level + 1);
        }
        // 勝利金幣獎勵 (縮減為原本一半)
        let clearBonus = 0;
        if (victory) {
            clearBonus = 25 + game.level * 8;
            game.gold += clearBonus;
            saveProgress();
        }
        const stats = {
            '擊殺數': game.kills,
            '施法次數': game.spellsCast,
            '平均準確度': avgAcc + '%',
            '最終分數': game.score,
            '獲得金幣': clearBonus ? (clearBonus + ' 🪙 (+關卡獎勵)') : '0 🪙',
            '總金幣': game.gold + ' 🪙',
            '用時': timeSec + ' 秒'
        };
        const hasNext = victory && game.level < window.Enemies.TOTAL_LEVELS;

        if (victory) {
            // 過關獎勵 1 技能點
            game.skillPointsEarned++;
            stats['獲得技能點'] = '+1 (總共 ' + game.skillPointsEarned + ', 可用 ' + availableSkillPoints() + ')';
            saveProgress();
            window.UI.playSfx('levelUp');
        }
        window.UI.showResult(victory ? '勝利！' : '失敗...', stats, hasNext);
    }

    function getHudState() {
        return {
            hp: game.player.hp,
            maxHp: game.player.maxHp,
            mp: game.player.mp,
            maxMp: game.player.maxMp,
            level: game.level,
            score: game.score,
            combo: game.combo,
            infinite: game.infinite,
            wave: game.wave,
            highScore: game.infiniteHighScore,
            gold: game.gold,
            activeBuffs: game.activeBuffs
        };
    }

    // ==== 更新邏輯 ====
    let lastTime = performance.now();

    function mainLoop() {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        if (game.state === 'playing') {
            updateGame(dt);
            renderGame();
        } else if (game.state === 'paused') {
            renderGame();
        } else if (game.state === 'practice') {
            updatePractice(dt);
            renderPractice();
        } else if (game.state === 'pvp') {
            updatePvp(dt);
            renderPvp();
        } else {
            window.Particles.update(dt);
        }

        requestAnimationFrame(mainLoop);
    }

    function updateGame(dt) {
        // 打擊停頓: 期間 dt 大幅縮短 (0.12 倍慢動作)
        if (game.hitstopTimer > 0) {
            game.hitstopTimer -= dt;
            dt = dt * 0.12;
        }
        // 玩家移動 (WASD / 方向鍵)
        updatePlayerMovement(dt);

        // 螢幕震動衰減
        if (game.shake.life > 0) {
            game.shake.life -= dt;
            const m = game.shake.mag * (game.shake.life / 0.3);
            game.shake.x = (Math.random() - 0.5) * m * 2;
            game.shake.y = (Math.random() - 0.5) * m * 2;
            if (game.shake.life <= 0) {
                game.shake.x = 0; game.shake.y = 0; game.shake.mag = 0;
            }
        }

        // MP 回復 (套用升級)
        const mpRegen = MP_REGEN + game.statUpgrades.mpRegen * 2;
        game.player.mp = Math.min(game.player.maxMp, game.player.mp + mpRegen * dt);

        // 冷卻倒數
        for (const key in game.cooldowns) {
            if (game.cooldowns[key] > 0) {
                game.cooldowns[key] = Math.max(0, game.cooldowns[key] - dt);
            }
        }
        window.UI.updateCooldowns(game.cooldowns, window.Spells.CONFIG);

        // 連擊倒數
        if (game.comboTimer > 0) {
            game.comboTimer -= dt;
            if (game.comboTimer <= 0) game.combo = 0;
        }

        // 護盾計時
        if (game.player.shieldActive) {
            game.player.shieldTimer -= dt;
            if (game.player.shieldTimer <= 0) {
                game.player.shieldActive = false;
                game.player.shieldBlocks = 0;
            }
        }

        game.player.bobPhase += dt * 2;
        game.player.hitFlash = Math.max(0, game.player.hitFlash - dt * 2);

        // 波次
        if (game.infinite) {
            updateInfiniteWaves(dt);
        } else {
            game.waveTimer += dt;
            while (game.waves.length && game.waveTimer >= game.waves[0].delay) {
                const w = game.waves.shift();
                for (const s of w.spawns) {
                    game.enemies.push(window.Enemies.createEnemy(s.type, s.x, s.y, game.currentLevelScale));
                }
            }
        }

        // 敵人 AI
        window.Enemies.updateEnemies(dt, game.enemies, game.player, onPlayerHit, onEnemyCastStart);

        // 移除死亡敵人並計分
        for (let i = game.enemies.length - 1; i >= 0; i--) {
            if (game.enemies[i].dead) {
                onEnemyKilled(game.enemies[i]);
                game.enemies.splice(i, 1);
            }
        }

        // 魔法投射物
        window.Spells.updateProjectiles(dt, game.enemies, (proj, target) => {
            const dmgBefore = proj.damage;
            window.Enemies.damageEnemy(target, proj.damage, {
                kind: proj.kind,
                slowDuration: proj.slowDuration,
                slowFactor: proj.slowFactor
            });
            spawnDamageNumber(target.x, target.y, dmgBefore, proj.critical);
            // 擊中回饋
            triggerShake(proj.critical ? 5 : 2, 0.1);
            if (proj.critical) { triggerHitstop(0.08); triggerFlash(0.18); }
            window.UI.playSfx('hit');
            if (target.dead) onEnemyKilled(target);
        });
        window.Spells.updateMeteors(dt, game.enemies, (proj, target) => {
            window.Enemies.damageEnemy(target, proj.damage, { kind: 'meteor' });
            spawnDamageNumber(target.x, target.y, proj.damage, proj.critical);
            if (target.dead) onEnemyKilled(target);
            if (!proj._shocked) {
                proj._shocked = true;
                window.Spells.createShockwave(proj.x || target.x, proj.y || target.y, 180, '#ffaa33', 0.8);
                triggerShake(10, 0.35);
                triggerHitstop(0.1);
                triggerFlash(0.25);
            }
        });
        window.Spells.updateLightning(dt);
        window.Spells.updatePoisonFields(dt, game.enemies, (proj, target) => {
            window.Enemies.damageEnemy(target, proj.damage, { kind: 'poison' });
            spawnDamageNumber(target.x, target.y - 10, proj.damage, false);
            if (target.dead) onEnemyKilled(target);
        });
        window.Spells.updateShockwaves(dt);
        window.Spells.updateMeleeArcs(dt);
        updateDamageNumbers(dt);
        updatePickupsAndTraps(dt);

        window.Particles.update(dt);

        // 勝利檢查 (一般關卡: 所有波次清空且場上無敵人)
        if (!game.infinite && game.waves.length === 0 && game.enemies.length === 0) {
            endLevel(true);
        }

        window.UI.updateHUD(getHudState());
    }

    // 無限模式波次控制 — 清場後倒數下一波
    function updateInfiniteWaves(dt) {
        if (game.enemies.length > 0) return;
        game.nextWaveDelay -= dt;
        if (game.nextWaveDelay <= 0) {
            game.wave++;
            const size = getCanvasSize();
            const data = window.Enemies.buildInfiniteWave(game.wave, size);
            for (const s of data.spawns) {
                game.enemies.push(window.Enemies.createEnemy(s.type, s.x, s.y, {
                    hpMul: data.hpMul,
                    speedMul: data.speedMul,
                    damageMul: data.damageMul
                }));
            }
            game.nextWaveDelay = 2.5;
            updateWaveDisplay();
            // 每 2 波新增陷阱 (上限 8)
            if (game.wave % 2 === 0 && game.traps.length < 8) {
                seedTraps(1 + Math.floor(game.wave / 5));
            }
            if (game.wave % 3 === 0 && game.wave > 0) {
                game.player.hp = Math.min(game.player.maxHp, game.player.hp + 20);
                window.Particles.emitHealGlow(game.player.x, game.player.y);
                window.UI.playSfx('waveComplete');
            }
        }
    }

    // ==== 渲染 ====
    function renderGame() {
        const w = cachedSize.w;
        const h = cachedSize.h;

        ctx.clearRect(0, 0, w, h);
        // 套用螢幕震動平移
        const sx = game.shake.x, sy = game.shake.y;
        if (sx || sy) {
            ctx.save();
            ctx.translate(sx, sy);
        }
        drawGameBackground(w, h);
        window.Spells.renderPoisonFields(ctx);
        renderPickupsAndTraps(ctx);
        drawPlayer();
        window.Enemies.renderEnemies(ctx, game.enemies);
        window.Enemies.renderEnemyProjectiles(ctx);
        window.Spells.renderProjectiles(ctx);
        window.Spells.renderMeteors(ctx);
        window.Spells.renderLightning(ctx);
        window.Spells.renderShockwaves(ctx);
        window.Spells.renderMeleeArcs(ctx);
        window.Particles.render(ctx);
        renderDamageNumbers(ctx);
        renderTrail(ctx);
        if (sx || sy) ctx.restore();
        // 全螢幕白閃 (壓在平移之外)
        if (game.flashFrame > 0) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, ' + game.flashFrame + ')';
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
            game.flashFrame = Math.max(0, game.flashFrame - 0.08);
        }
    }

    // 快取背景漸層 — 玩家幾乎不移動，不需每幀重建
    let bgGradientX = -1, bgGradientY = -1;

    function drawGameBackground(w, h) {
        const px = game.player.x | 0;
        const py = (game.player.y + 40) | 0;
        if (!bgGradient || bgGradientX !== px || bgGradientY !== py) {
            bgGradient = ctx.createRadialGradient(px, py, 20, px, py, 400);
            bgGradient.addColorStop(0, 'rgba(100, 60, 180, 0.15)');
            bgGradient.addColorStop(1, 'rgba(40, 20, 80, 0)');
            bgGradientX = px;
            bgGradientY = py;
        }
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, w, h);
    }

    // 玩家光環漸層 — 固定在原點，繪製時 translate，真正快取
    function getPlayerAuraGrad(radius) {
        if (!playerAuraGrad) {
            playerAuraGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, radius + 20);
            playerAuraGrad.addColorStop(0, 'rgba(180, 130, 255, 0.6)');
            playerAuraGrad.addColorStop(1, 'rgba(80, 40, 140, 0)');
        }
        return playerAuraGrad;
    }

    function drawPlayer() {
        const p = game.player;
        const bob = Math.sin(p.bobPhase) * 4;
        const py = (p.y + bob) | 0;
        const px = p.x | 0;
        const r = p.radius;
        const TWO_PI = 6.283185307179586;
        ctx.save();

        // 陰影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py + r + 18, r * 0.85, 8, 0, 0, TWO_PI);
        ctx.fill();

        // 魔法光環 (translate + 快取漸層)
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(px, py);
        ctx.fillStyle = getPlayerAuraGrad(r);
        ctx.beginPath();
        ctx.arc(0, 0, r + 20, 0, TWO_PI);
        ctx.fill();
        ctx.translate(-px, -py);
        ctx.globalCompositeOperation = 'source-over';

        // === 法師長袍 (下半身錐形) ===
        const robeGrad = ctx.createLinearGradient(px, py - r * 0.3, px, py + r * 1.4);
        robeGrad.addColorStop(0, '#5a2e90');
        robeGrad.addColorStop(0.55, '#331960');
        robeGrad.addColorStop(1, '#180828');
        ctx.fillStyle = robeGrad;
        ctx.beginPath();
        ctx.moveTo(px - r * 0.45, py - r * 0.3);
        ctx.lineTo(px + r * 0.45, py - r * 0.3);
        ctx.quadraticCurveTo(px + r * 0.95, py + r * 0.6, px + r * 1.15, py + r * 1.4);
        ctx.lineTo(px - r * 1.15, py + r * 1.4);
        ctx.quadraticCurveTo(px - r * 0.95, py + r * 0.6, px - r * 0.45, py - r * 0.3);
        ctx.closePath();
        ctx.fill();

        // 長袍金色綁帶
        ctx.strokeStyle = '#d9a845';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px - r * 0.12, py - r * 0.25);
        ctx.lineTo(px - r * 0.35, py + r * 1.35);
        ctx.moveTo(px + r * 0.12, py - r * 0.25);
        ctx.lineTo(px + r * 0.35, py + r * 1.35);
        ctx.stroke();

        // 腰帶
        ctx.fillStyle = '#b8882e';
        ctx.beginPath();
        ctx.ellipse(px, py + r * 0.35, r * 0.6, r * 0.12, 0, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = '#ffdd77';
        ctx.beginPath();
        ctx.arc(px, py + r * 0.35, r * 0.13, 0, TWO_PI);
        ctx.fill();

        // === 兜帽 (錐形帶卷邊) ===
        ctx.fillStyle = '#2e1250';
        ctx.beginPath();
        ctx.moveTo(px - r * 0.05, py - r * 1.4);
        ctx.quadraticCurveTo(px + r * 0.3, py - r * 1.3, px + r * 0.75, py - r * 0.3);
        ctx.quadraticCurveTo(px + r * 0.3, py - r * 0.05, px, py - r * 0.02);
        ctx.quadraticCurveTo(px - r * 0.3, py - r * 0.05, px - r * 0.75, py - r * 0.3);
        ctx.quadraticCurveTo(px - r * 0.3, py - r * 1.3, px - r * 0.05, py - r * 1.4);
        ctx.closePath();
        ctx.fill();

        // 兜帽尖端小球
        ctx.fillStyle = '#d9a845';
        ctx.beginPath();
        ctx.arc(px - r * 0.02, py - r * 1.45, r * 0.1, 0, TWO_PI);
        ctx.fill();

        // 兜帽內部陰影
        ctx.fillStyle = '#06020c';
        ctx.beginPath();
        ctx.ellipse(px, py - r * 0.55, r * 0.42, r * 0.48, 0, 0, TWO_PI);
        ctx.fill();

        // === 發光雙眼 ===
        ctx.globalCompositeOperation = 'lighter';
        const eyeY = py - r * 0.6;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        ctx.arc(px - r * 0.2, eyeY, r * 0.16, 0, TWO_PI);
        ctx.arc(px + r * 0.2, eyeY, r * 0.16, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffee88';
        ctx.beginPath();
        ctx.arc(px - r * 0.2, eyeY, r * 0.07, 0, TWO_PI);
        ctx.arc(px + r * 0.2, eyeY, r * 0.07, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // === 法杖 ===
        const staffX = px + r * 0.95;
        const staffBot = py + r * 1.3;
        const staffTop = py - r * 1.2;
        // 木柄
        ctx.strokeStyle = '#6b4a22';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(staffX, staffBot);
        ctx.lineTo(staffX - r * 0.05, staffTop);
        ctx.stroke();
        // 木柄紋理 (3 道漆環)
        ctx.strokeStyle = '#a8782e';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            const ty = staffBot - (i + 1) * (staffBot - staffTop) / 4;
            ctx.beginPath();
            ctx.moveTo(staffX - 4, ty);
            ctx.lineTo(staffX + 4, ty);
            ctx.stroke();
        }
        // 水晶光暈
        ctx.globalCompositeOperation = 'lighter';
        const cx = staffX - r * 0.05, cy = staffTop;
        const crysGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.5);
        crysGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        crysGrad.addColorStop(0.35, 'rgba(180, 120, 255, 0.7)');
        crysGrad.addColorStop(1, 'rgba(100, 50, 160, 0)');
        ctx.fillStyle = crysGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.5, 0, TWO_PI);
        ctx.fill();
        // 水晶本體
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#aa66ff';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.22);
        ctx.lineTo(cx + r * 0.12, cy - r * 0.05);
        ctx.lineTo(cx + r * 0.09, cy + r * 0.15);
        ctx.lineTo(cx - r * 0.09, cy + r * 0.15);
        ctx.lineTo(cx - r * 0.12, cy - r * 0.05);
        ctx.closePath();
        ctx.fill();
        // 水晶高光
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.04, cy - r * 0.12);
        ctx.lineTo(cx + r * 0.02, cy - r * 0.14);
        ctx.lineTo(cx, cy + r * 0.05);
        ctx.lineTo(cx - r * 0.05, cy + r * 0.02);
        ctx.closePath();
        ctx.fill();

        // PvP 模式下顯示自己名稱
        if (game.state === 'pvp' && game.mp.myName) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#aaffdd';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.font = 'bold 14px Georgia';
            ctx.textAlign = 'center';
            ctx.strokeText('♦ ' + game.mp.myName, px, py - r * 1.55);
            ctx.fillText('♦ ' + game.mp.myName, px, py - r * 1.55);
        }

        // 受傷閃白
        if (p.hitFlash > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(255, 100, 100, ' + (p.hitFlash * 0.75) + ')';
            ctx.beginPath();
            ctx.arc(px, py, r * 1.2, 0, TWO_PI);
            ctx.fill();
        }

        // 護盾
        if (p.shieldActive) {
            ctx.globalCompositeOperation = 'lighter';
            const pulse = 0.55 + Math.sin(Date.now() / 125) * 0.3;
            ctx.strokeStyle = 'rgba(100, 180, 255, ' + (pulse * 0.4) + ')';
            ctx.lineWidth = 12;
            ctx.beginPath();
            ctx.arc(px, py, r + 24, 0, TWO_PI);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(150, 220, 255, ' + pulse + ')';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(px, py, r + 24, 0, TWO_PI);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(220, 240, 255, ' + (pulse * 0.7) + ')';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, r + 18, 0, TWO_PI);
            ctx.stroke();
        }

        ctx.restore();
    }

    // ==== PvP 更新 & 渲染 ====
    function updatePvp(dt) {
        const mp = game.mp;

        // Hitstop
        if (game.hitstopTimer > 0) {
            game.hitstopTimer -= dt;
            dt = dt * 0.15;
        }

        // Countdown 階段: 凍結玩家動作
        if (mp.roundState === 'countdown') {
            mp.countdown -= dt;
            if (mp.countdown <= 0) {
                mp.roundState = 'playing';
                showMpBanner('戰鬥！', 0.8);
            }
            window.Particles.update(dt);
            // 仍然更新 bob
            game.player.bobPhase += dt * 2;
            mp.opponent.bobPhase += dt * 2;
            return;
        }
        if (mp.roundState === 'over') {
            window.Particles.update(dt);
            return;
        }

        // 震動
        if (game.shake.life > 0) {
            game.shake.life -= dt;
            const m = game.shake.mag * (game.shake.life / 0.3);
            game.shake.x = (Math.random() - 0.5) * m * 2;
            game.shake.y = (Math.random() - 0.5) * m * 2;
            if (game.shake.life <= 0) { game.shake.x = 0; game.shake.y = 0; game.shake.mag = 0; }
        }

        // MP 回復
        const mpRegen = MP_REGEN + game.statUpgrades.mpRegen * 2;
        game.player.mp = Math.min(game.player.maxMp, game.player.mp + mpRegen * dt);

        // 冷卻
        for (const key in game.cooldowns) {
            if (game.cooldowns[key] > 0) game.cooldowns[key] = Math.max(0, game.cooldowns[key] - dt);
        }
        window.UI.updateCooldowns(game.cooldowns, window.Spells.CONFIG);

        // 連擊倒數
        if (game.comboTimer > 0) {
            game.comboTimer -= dt;
            if (game.comboTimer <= 0) game.combo = 0;
        }

        // 玩家移動 (含障礙物碰撞)
        const before = { x: game.player.x, y: game.player.y };
        updatePlayerMovement(dt);
        // 障礙物碰撞: 撞到就退回原位
        for (let i = 0; i < mp.obstacles.length; i++) {
            if (window.Maps.circleHitObstacle(game.player.x, game.player.y, game.player.radius, mp.obstacles[i])) {
                game.player.x = before.x;
                game.player.y = before.y;
                break;
            }
        }

        // 岩漿踩踏傷害 (每秒觸發一次)
        const groundDmg = window.Maps.getGroundDamage(mp.obstacles, game.player.x, game.player.y);
        if (groundDmg > 0) {
            mp.lavaTimer = (mp.lavaTimer || 0) + dt;
            if (mp.lavaTimer >= 0.5) {
                mp.lavaTimer = 0;
                onPlayerHit(groundDmg * 0.5, { kind: 'lava' });
            }
        } else {
            mp.lavaTimer = 0;
        }

        // 護盾計時
        if (game.player.shieldActive) {
            game.player.shieldTimer -= dt;
            if (game.player.shieldTimer <= 0) {
                game.player.shieldActive = false;
                game.player.shieldBlocks = 0;
            }
        }
        game.player.bobPhase += dt * 2;
        game.player.hitFlash = Math.max(0, game.player.hitFlash - dt * 2);
        mp.opponent.bobPhase = (mp.opponent.bobPhase || 0) + dt * 2;
        mp.opponent.hitFlash = Math.max(0, (mp.opponent.hitFlash || 0) - dt * 2);
        updatePlayersAnim(dt);

        // 投射物目標: 2v2 列出所有敵隊活人, 1v1 仍用單一對手
        const enemyTargets = getEnemyTargets();
        const handleHit = (proj, target) => {
            const damage = proj.damage;
            const spell = proj.kind || 'aoe';
            const targetSlot = target._slot !== undefined ? target._slot : undefined;
            window.Multiplayer.send({
                type: 'hit', damage: damage, spell: spell,
                x: target.x, y: target.y,
                target: targetSlot
            });
            spawnDamageNumber(target.x, target.y, damage, proj.critical);
            // 預估: 本端先扣對應 target
            applyLocalDamageToTarget(target, damage);
            triggerShake(proj.critical ? 5 : 2, 0.1);
            window.UI.playSfx('hit');
        };
        window.Spells.updateProjectiles(dt, enemyTargets, handleHit);
        window.Spells.updateMeteors(dt, enemyTargets, (proj, target) => {
            const damage = proj.damage;
            window.Multiplayer.send({
                type: 'hit', damage: damage, spell: 'meteor',
                x: target.x, y: target.y,
                target: target._slot
            });
            spawnDamageNumber(target.x, target.y, damage, proj.critical);
            applyLocalDamageToTarget(target, damage);
            if (!proj._shocked) {
                proj._shocked = true;
                window.Spells.createShockwave(proj.x || target.x, proj.y || target.y, 180, '#ffaa33', 0.8);
                triggerShake(10, 0.35);
            }
        });
        window.Spells.updateLightning(dt);
        window.Spells.updatePoisonFields(dt, enemyTargets, (proj, target) => {
            const damage = proj.damage;
            window.Multiplayer.send({
                type: 'hit', damage: damage, spell: 'poison',
                x: target.x, y: target.y,
                target: target._slot
            });
            spawnDamageNumber(target.x, target.y - 10, damage, false);
            applyLocalDamageToTarget(target, damage);
        });
        window.Spells.updateShockwaves(dt);
        window.Spells.updateMeleeArcs(dt);
        updateDamageNumbers(dt);

        // 投射物與障礙物碰撞
        window.Spells.checkProjectilesVsObstacles(mp.obstacles, window.Maps.pointInObstacle);

        window.Particles.update(dt);

        // 送自身狀態 (~20hz) — 2v2 需附 slot 和 name
        mp.sendTimer += dt;
        if (mp.sendTimer > 0.05) {
            mp.sendTimer = 0;
            window.Multiplayer.send({
                type: 'state',
                slot: mp.mySlot,
                name: mp.myName,
                x: game.player.x, y: game.player.y,
                hp: game.player.hp, maxHp: game.player.maxHp
            });
        }

        // 本地死亡 → 輸這回合
        if (game.player.hp <= 0 && mp.roundState === 'playing') {
            localRoundDecided(false);
        }

        window.UI.updateHUD(getHudState());
    }

    function mpOpponentAsEnemy() {
        // 1v1: 把單一對手包成 enemy-like 物件
        const opp = game.mp.opponent;
        return {
            x: opp.x, y: opp.y,
            radius: 40,
            hp: opp.hp, maxHp: opp.maxHp,
            dead: !opp.alive || opp.hp <= 0,
            def: { reward: 0 },
            hitFlash: 0, slowedUntil: 0, slowFactor: 1,
            _isOpp: true
        };
    }

    // 取得所有敵隊活人 (供投射物碰撞用, 2v2 多個, 1v1 單一)
    function getEnemyTargets() {
        const mp = game.mp;
        if (mp.teamMode === '2v2') {
            const arr = [];
            for (const s in mp.players) {
                const p = mp.players[s];
                if (p.team !== mp.myTeam && p.alive && p.hp > 0) {
                    arr.push({
                        x: p.x, y: p.y,
                        radius: 40,
                        hp: p.hp, maxHp: p.maxHp,
                        dead: false,
                        def: { reward: 0 },
                        hitFlash: 0, slowedUntil: 0, slowFactor: 1,
                        _slot: p.slot
                    });
                }
            }
            return arr;
        }
        return [mpOpponentAsEnemy()];
    }

    function applyLocalDamageToTarget(target, damage) {
        const mp = game.mp;
        if (target._slot !== undefined && mp.teamMode === '2v2') {
            const p = mp.players[target._slot];
            if (p) {
                p.hp = Math.max(0, p.hp - damage);
                p.hitFlash = 1;
                if (p.hp <= 0) p.alive = false;
                checkTeamsAndMaybeEndRound();
            }
        } else {
            mp.opponent.hp = Math.max(0, mp.opponent.hp - damage);
            mp.opponent.hitFlash = 1;
            if (mp.opponent.hp <= 0 && mp.roundState === 'playing') localRoundDecided(true);
        }
    }

    // 2v2 檢查隊伍全滅
    function checkTeamsAndMaybeEndRound() {
        const mp = game.mp;
        if (mp.teamMode !== '2v2' || mp.roundState !== 'playing') return;
        // 我方是否已全滅?
        let myTeamAlive = game.player.hp > 0 ? 1 : 0;
        let enemyTeamAlive = 0;
        for (const s in mp.players) {
            const p = mp.players[s];
            if (!p.alive || p.hp <= 0) continue;
            if (p.team === mp.myTeam) myTeamAlive++;
            else enemyTeamAlive++;
        }
        if (enemyTeamAlive === 0) localRoundDecided(true);
        else if (myTeamAlive === 0) localRoundDecided(false);
    }

    /** 判斷本回合結束: win=true 代表我贏 */
    function localRoundDecided(iWon) {
        const mp = game.mp;
        if (mp.roundState !== 'playing') return;
        if (iWon) mp.myWins++;
        else mp.oppWins++;
        mp.roundState = 'over';
        window.Multiplayer.send({ type: 'roundOver', loser: iWon ? 'opponent' : 'self' });
        // 比分 banner (大字, 3 秒)
        const scoreText = `${mp.myWins} - ${mp.oppWins}`;
        const msg = `${iWon ? '這回合勝利' : '這回合失敗'}\n比分  ${scoreText}`;
        showMpBanner(msg, 2.8);
        const needed = Math.ceil(mp.rounds / 2);
        if (mp.myWins >= needed || mp.oppWins >= needed) {
            // 對戰結束
            setTimeout(() => endMpMatch(mp.myWins > mp.oppWins ? '你贏了！' : '你輸了...'), 3000);
        } else {
            // 3 秒後自動下一回合
            setTimeout(() => { if (game.mp.active) startMpRound(); }, 3000);
        }
    }

    /** 將投射物與障礙物檢測 — 擊中不可穿透障礙時銷毀 */
    function cullProjectilesOnObstacles(obstacles) {
        // 透過修改 Spells 投射物模組的私有陣列難以做到, 改採事後檢查:
        // 在投射物更新後 (Spells.updateProjectiles 內部才知道), 此處利用障礙物碰撞補強視覺: 粒子爆
        // 簡化處理: 每 frame 檢查即將存在的投射物 (如果未來需要精確可開 API)
    }

    function renderPvp() {
        const w = cachedSize.w;
        const h = cachedSize.h;
        ctx.clearRect(0, 0, w, h);
        const sx = game.shake.x, sy = game.shake.y;
        if (sx || sy) { ctx.save(); ctx.translate(sx, sy); }

        // 地圖背景 + 障礙物 (障礙物繪在玩家下)
        window.Maps.drawBackground(game.mp.mapId, ctx, w, h);
        window.Maps.drawObstacles(game.mp.obstacles, ctx);

        // 毒霧 + 粒子底層
        window.Spells.renderPoisonFields(ctx);

        // 玩家
        drawPlayer();
        // 對手: 2v2 畫所有其他玩家, 1v1 畫單一 opponent
        if (game.mp.teamMode === '2v2') {
            for (const s in game.mp.players) {
                drawOtherPlayer(game.mp.players[s]);
            }
        } else {
            drawOpponent();
        }

        // 投射物 / 閃電 / 流星 / 衝擊 / 近戰
        window.Spells.renderProjectiles(ctx);
        window.Spells.renderMeteors(ctx);
        window.Spells.renderLightning(ctx);
        window.Spells.renderShockwaves(ctx);
        window.Spells.renderMeleeArcs(ctx);
        window.Particles.render(ctx);
        renderDamageNumbers(ctx);
        renderTrail(ctx);

        // 對手 HP 條 (頂部)
        renderMpHpBars(ctx, w);

        // Countdown 大字
        if (game.mp.roundState === 'countdown') {
            const n = Math.ceil(game.mp.countdown);
            ctx.save();
            ctx.globalAlpha = Math.min(1, game.mp.countdown - (n - 1));
            ctx.font = 'bold 120px Georgia';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 6;
            ctx.strokeText(n > 0 ? String(n) : '開打!', w / 2, h / 2);
            ctx.fillText(n > 0 ? String(n) : '開打!', w / 2, h / 2);
            ctx.restore();
        }

        if (sx || sy) ctx.restore();
        if (game.flashFrame > 0) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, ' + game.flashFrame + ')';
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
            game.flashFrame = Math.max(0, game.flashFrame - 0.08);
        }
    }

    function drawOpponent() {
        const o = game.mp.opponent;
        const bob = Math.sin(o.bobPhase || 0) * 4;
        const px = o.x | 0;
        const py = (o.y + bob) | 0;
        const r = 40;
        const TWO_PI = 6.283185307179586;
        ctx.save();
        // 陰影
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py + r + 18, r * 0.85, 8, 0, 0, TWO_PI);
        ctx.fill();
        // 紅色光環 (區分敵對)
        ctx.globalCompositeOperation = 'lighter';
        const aura = ctx.createRadialGradient(px, py, 10, px, py, r + 20);
        aura.addColorStop(0, 'rgba(255, 120, 130, 0.6)');
        aura.addColorStop(1, 'rgba(140, 40, 60, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(px, py, r + 20, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // 長袍 (紅調)
        const robe = ctx.createLinearGradient(px, py - r * 0.3, px, py + r * 1.4);
        robe.addColorStop(0, '#a02838');
        robe.addColorStop(1, '#2a0812');
        ctx.fillStyle = robe;
        ctx.beginPath();
        ctx.moveTo(px - r * 0.45, py - r * 0.3);
        ctx.lineTo(px + r * 0.45, py - r * 0.3);
        ctx.quadraticCurveTo(px + r * 0.95, py + r * 0.6, px + r * 1.15, py + r * 1.4);
        ctx.lineTo(px - r * 1.15, py + r * 1.4);
        ctx.quadraticCurveTo(px - r * 0.95, py + r * 0.6, px - r * 0.45, py - r * 0.3);
        ctx.closePath();
        ctx.fill();
        // 腰帶
        ctx.fillStyle = '#4a1a22';
        ctx.beginPath();
        ctx.ellipse(px, py + r * 0.35, r * 0.6, r * 0.12, 0, 0, TWO_PI);
        ctx.fill();
        // 兜帽
        ctx.fillStyle = '#3a0a14';
        ctx.beginPath();
        ctx.moveTo(px - r * 0.05, py - r * 1.4);
        ctx.quadraticCurveTo(px + r * 0.3, py - r * 1.3, px + r * 0.75, py - r * 0.3);
        ctx.quadraticCurveTo(px + r * 0.3, py - r * 0.05, px, py - r * 0.02);
        ctx.quadraticCurveTo(px - r * 0.3, py - r * 0.05, px - r * 0.75, py - r * 0.3);
        ctx.quadraticCurveTo(px - r * 0.3, py - r * 1.3, px - r * 0.05, py - r * 1.4);
        ctx.closePath();
        ctx.fill();
        // 兜帽內暗
        ctx.fillStyle = '#08020a';
        ctx.beginPath();
        ctx.ellipse(px, py - r * 0.55, r * 0.42, r * 0.48, 0, 0, TWO_PI);
        ctx.fill();
        // 紅眼
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ff3344';
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(px - r * 0.2, py - r * 0.6, r * 0.16, 0, TWO_PI);
        ctx.arc(px + r * 0.2, py - r * 0.6, r * 0.16, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffaa88';
        ctx.beginPath();
        ctx.arc(px - r * 0.2, py - r * 0.6, r * 0.07, 0, TWO_PI);
        ctx.arc(px + r * 0.2, py - r * 0.6, r * 0.07, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 閃白受傷
        if (o.hitFlash > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(255, 150, 150, ' + (o.hitFlash * 0.7) + ')';
            ctx.beginPath();
            ctx.arc(px, py, r * 1.1, 0, TWO_PI);
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        // 名稱
        if (o.name) {
            ctx.fillStyle = '#ffbbbb';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.font = 'bold 14px Georgia';
            ctx.textAlign = 'center';
            ctx.strokeText('⚔ ' + o.name, px, py - r * 1.55);
            ctx.fillText('⚔ ' + o.name, px, py - r * 1.55);
        }
        ctx.restore();
    }

    // 2v2: 繪製其他玩家 (隊友綠色 / 敵人紅色)
    function drawOtherPlayer(p) {
        if (!p || !p.alive) return;
        const isEnemy = p.team !== game.mp.myTeam;
        const tint = isEnemy
            ? { aura: 'rgba(255, 120, 130, 0.6)', robe1: '#a02838', robe2: '#2a0812', hood: '#3a0a14', eye: '#ffaa88', eyeGlow: '#ff3344' }
            : { aura: 'rgba(120, 255, 140, 0.5)', robe1: '#2a8838', robe2: '#0a2814', hood: '#0a2a14', eye: '#aaffaa', eyeGlow: '#44ff66' };
        const bob = Math.sin(p.bobPhase || 0) * 4;
        const px = p.x | 0;
        const py = (p.y + bob) | 0;
        const r = 40;
        const TWO_PI = 6.283185307179586;
        ctx.save();
        // 陰影
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py + r + 18, r * 0.85, 8, 0, 0, TWO_PI);
        ctx.fill();
        // 光環
        ctx.globalCompositeOperation = 'lighter';
        const aura = ctx.createRadialGradient(px, py, 10, px, py, r + 20);
        aura.addColorStop(0, tint.aura);
        aura.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(px, py, r + 20, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 長袍
        const robe = ctx.createLinearGradient(px, py - r * 0.3, px, py + r * 1.4);
        robe.addColorStop(0, tint.robe1);
        robe.addColorStop(1, tint.robe2);
        ctx.fillStyle = robe;
        ctx.beginPath();
        ctx.moveTo(px - r * 0.45, py - r * 0.3);
        ctx.lineTo(px + r * 0.45, py - r * 0.3);
        ctx.quadraticCurveTo(px + r * 0.95, py + r * 0.6, px + r * 1.15, py + r * 1.4);
        ctx.lineTo(px - r * 1.15, py + r * 1.4);
        ctx.quadraticCurveTo(px - r * 0.95, py + r * 0.6, px - r * 0.45, py - r * 0.3);
        ctx.closePath();
        ctx.fill();
        // 兜帽
        ctx.fillStyle = tint.hood;
        ctx.beginPath();
        ctx.moveTo(px, py - r * 1.4);
        ctx.quadraticCurveTo(px + r * 0.55, py - r * 0.9, px + r * 0.75, py - r * 0.3);
        ctx.quadraticCurveTo(px + r * 0.3, py - r * 0.05, px, py);
        ctx.quadraticCurveTo(px - r * 0.3, py - r * 0.05, px - r * 0.75, py - r * 0.3);
        ctx.quadraticCurveTo(px - r * 0.55, py - r * 0.9, px, py - r * 1.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#08020a';
        ctx.beginPath();
        ctx.ellipse(px, py - r * 0.55, r * 0.42, r * 0.48, 0, 0, TWO_PI);
        ctx.fill();
        // 眼睛
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = tint.eyeGlow;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(px - r * 0.2, py - r * 0.6, r * 0.16, 0, TWO_PI);
        ctx.arc(px + r * 0.2, py - r * 0.6, r * 0.16, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = tint.eye;
        ctx.beginPath();
        ctx.arc(px - r * 0.2, py - r * 0.6, r * 0.07, 0, TWO_PI);
        ctx.arc(px + r * 0.2, py - r * 0.6, r * 0.07, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 受傷閃白
        if (p.hitFlash > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(255, 150, 150, ' + (p.hitFlash * 0.7) + ')';
            ctx.beginPath();
            ctx.arc(px, py, r * 1.1, 0, TWO_PI);
            ctx.fill();
        }
        // HP 條 (頭頂)
        ctx.globalCompositeOperation = 'source-over';
        const barW = 70, barH = 6;
        const barX = px - barW / 2;
        const barY = py - r * 1.55;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(barX, barY, barW, barH);
        const pct = Math.max(0, p.hp / p.maxHp);
        ctx.fillStyle = isEnemy ? '#ff6688' : '#66ff88';
        ctx.fillRect(barX, barY, barW * pct, barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);
        // 名稱 + 敵友標記
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.font = 'bold 13px Georgia';
        ctx.textAlign = 'center';
        const label = (isEnemy ? '⚔ ' : '♦ ') + (p.name || ('Slot' + p.slot));
        ctx.strokeText(label, px, barY - 4);
        ctx.fillText(label, px, barY - 4);
        ctx.restore();
    }

    // 對手被擊中動畫推進 (供 updatePvp 用)
    function updatePlayersAnim(dt) {
        for (const s in game.mp.players) {
            const p = game.mp.players[s];
            p.bobPhase = (p.bobPhase || 0) + dt * 2;
            p.hitFlash = Math.max(0, (p.hitFlash || 0) - dt * 2);
        }
    }

    function renderMpHpBars(ctx, w) {
        const mp = game.mp;
        const barW = 260, barH = 16;
        // 我方 (左上)
        drawMpBar(ctx, 20, 70, barW, barH, game.player.hp / game.player.maxHp, '#66ff88', `你  ${Math.ceil(game.player.hp)}/${game.player.maxHp}`);
        // 對手 (右上)
        drawMpBar(ctx, w - barW - 20, 70, barW, barH, mp.opponent.hp / mp.opponent.maxHp, '#ff6688', `對手  ${Math.ceil(mp.opponent.hp)}/${mp.opponent.maxHp}`);
        // 中央比數
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 22px Georgia';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 4;
        const txt = `${mp.myWins} : ${mp.oppWins}  (BO${mp.rounds}, 第 ${mp.roundNum} 回合)`;
        ctx.strokeText(txt, w / 2, 30);
        ctx.fillText(txt, w / 2, 30);
        ctx.restore();
    }

    function drawMpBar(ctx, x, y, w, h, pct, color, label) {
        pct = Math.max(0, Math.min(1, pct));
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w * pct, h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.font = 'bold 13px Georgia';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.strokeText(label, x + 6, y + h / 2);
        ctx.fillText(label, x + 6, y + h / 2);
        ctx.restore();
    }

    // ==== 練習模式 ====
    const practice = {
        state: 'ready',
        targetRune: 'fireball',
        lastResult: null,
        lastTrail: null,
        lastTrailTime: 0,
        lastMatch: false,
        showTemplateAlpha: 1
    };

    function startPractice() {
        game.state = 'practice';     // 關鍵: 讓 mainLoop 跑 renderPractice
        practice.state = 'ready';
        practice.targetRune = 'fireball';
        practice.lastResult = null;
        practice.lastTrail = null;
        practice.lastMatch = false;
        window.UI.showScreen('practice-screen');
        resizeCanvas();
        setPracticeTarget('fireball');
        window.Particles.clear();
    }

    function setPracticeTarget(name) {
        practice.targetRune = name;
        practice.lastResult = null;
        practice.lastTrail = null;
        practice.lastMatch = false;
        practice.showTemplateAlpha = 1;
        document.querySelectorAll('.practice-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.rune === name);
        });
        const cfg = window.Spells.CONFIG[name];
        document.getElementById('target-rune').textContent = cfg.name;
        document.getElementById('practice-accuracy').textContent = '--';
    }

    function processPracticeAttempt(trail) {
        const result = window.Recognizer.recognize(trail);
        // 保留使用者最後軌跡 (用於視覺回饋)
        practice.lastTrail = trail.map(p => ({ x: p.x, y: p.y }));
        practice.lastResult = result;
        practice.lastTrailTime = performance.now();

        if (!result) {
            document.getElementById('practice-accuracy').textContent = '失敗';
            practice.lastMatch = false;
            window.UI.playSfx('fail');
            return;
        }
        const isTarget = result.name === practice.targetRune;
        const pct = Math.round(result.accuracy * 100);
        practice.lastMatch = isTarget && result.accuracy >= game.recognitionThreshold;
        document.getElementById('practice-accuracy').textContent =
            `${pct}% (${isTarget ? '✓ 正確' : '✗ 識別為 ' + window.Spells.CONFIG[result.name].name})`;
        if (practice.lastMatch) {
            window.UI.playSfx(result.accuracy >= window.Recognizer.CRITICAL_THRESHOLD ? 'critical' : result.name);
            const cfg = window.Spells.CONFIG[result.name];
            const last = trail[trail.length - 1];
            window.Particles.burst(last.x, last.y, {
                count: 30, spread: 200, life: 0.8,
                color: cfg.color, color2: '#ffffff', size: 5
            });
        } else {
            window.UI.playSfx('fail');
        }
    }

    function updatePractice(dt) {
        window.Particles.update(dt);
        practice.showTemplateAlpha = Math.max(0.3, practice.showTemplateAlpha - dt * 0.15);
    }

    function renderPractice() {
        const w = cachedSize.w;
        const h = cachedSize.h;
        practiceCtx.clearRect(0, 0, w, h);

        // 背景網格
        practiceCtx.strokeStyle = 'rgba(100, 60, 180, 0.08)';
        practiceCtx.lineWidth = 1;
        practiceCtx.beginPath();
        for (let x = 0; x < w; x += 60) {
            practiceCtx.moveTo(x, 0);
            practiceCtx.lineTo(x, h);
        }
        for (let y = 0; y < h; y += 60) {
            practiceCtx.moveTo(0, y);
            practiceCtx.lineTo(w, y);
        }
        practiceCtx.stroke();

        // 符文範例 (大型顯示)
        const showGuide = document.getElementById('show-guide').checked;
        if (showGuide) {
            drawTemplateOnCanvas(practiceCtx, practice.targetRune, w / 2, h / 2, Math.min(w, h) * 0.5);
        }

        // 顯示上次玩家繪製軌跡 (依準確度上色, 持續顯示直到換符文或重畫)
        if (practice.lastTrail && practice.lastTrail.length > 1) {
            let color, label;
            if (practice.lastResult) {
                const acc = practice.lastResult.accuracy;
                if (practice.lastMatch && acc >= 0.82) { color = '#66ff88'; label = '優秀 ' + Math.round(acc * 100) + '%'; }
                else if (practice.lastMatch) { color = '#aaff66'; label = '通過 ' + Math.round(acc * 100) + '%'; }
                else if (acc >= 0.4) {
                    color = '#ffcc44';
                    const runnerName = practice.lastResult.runner ? window.Spells.CONFIG[practice.lastResult.runner] : null;
                    label = '偏差 (像 ' + (runnerName ? runnerName.name : '?') + ')';
                }
                else { color = '#ff5566'; label = '失敗'; }
            } else {
                color = '#888'; label = '點數不足';
            }
            drawPracticeTrail(practiceCtx, practice.lastTrail, color, 1);
            practiceCtx.save();
            practiceCtx.fillStyle = '#ffffff';
            practiceCtx.beginPath();
            practiceCtx.arc(practice.lastTrail[0].x, practice.lastTrail[0].y, 9, 0, Math.PI * 2);
            practiceCtx.fill();
            practiceCtx.fillStyle = color;
            practiceCtx.font = 'bold 18px Georgia';
            practiceCtx.textAlign = 'center';
            practiceCtx.fillText('起', practice.lastTrail[0].x, practice.lastTrail[0].y - 16);
            const last = practice.lastTrail[practice.lastTrail.length - 1];
            practiceCtx.fillStyle = color;
            practiceCtx.beginPath();
            practiceCtx.arc(last.x, last.y, 11, 0, Math.PI * 2);
            practiceCtx.fill();
            practiceCtx.fillStyle = '#ffffff';
            practiceCtx.fillText(label, last.x, last.y - 20);
            practiceCtx.restore();
        }

        // 粒子
        window.Particles.render(practiceCtx);

        // 繪製中的軌跡 (正在畫)
        if (activeInputTarget === 'practice') renderTrail(practiceCtx);
    }

    // 繪製已完成的軌跡 — 以 source-over 確保對比清晰可見
    function drawPracticeTrail(c, pts, color, alpha) {
        if (!pts || pts.length < 2) return;
        c.save();
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.globalCompositeOperation = 'source-over';
        // 建立路徑 (後續 stroke 複用)
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        // 外層黑色邊 (保證在任何背景都能看見)
        c.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        c.lineWidth = 22;
        c.stroke();
        // 彩色主體
        c.strokeStyle = color;
        c.lineWidth = 14;
        c.stroke();
        // 白色中線 (高光)
        c.strokeStyle = '#ffffff';
        c.lineWidth = 3;
        c.stroke();
        c.restore();
    }

    function drawTemplateOnCanvas(c, runeName, cx, cy, size) {
        const pts = window.Recognizer.getTemplate(runeName);
        if (!pts) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        }
        const bw = maxX - minX, bh = maxY - minY;
        const scale = size / Math.max(bw, bh);
        const ox = cx - bw * scale / 2 - minX * scale;
        const oy = cy - bh * scale / 2 - minY * scale;

        const cfg = window.Spells.CONFIG[runeName];
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.35;
        c.shadowBlur = 30;
        c.shadowColor = cfg.color;
        c.strokeStyle = cfg.color;
        c.lineWidth = 8;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(pts[0].x * scale + ox, pts[0].y * scale + oy);
        for (let i = 1; i < pts.length; i++) {
            c.lineTo(pts[i].x * scale + ox, pts[i].y * scale + oy);
        }
        c.stroke();
        // 起點
        c.globalAlpha = 0.7;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(pts[0].x * scale + ox, pts[0].y * scale + oy, 10, 0, Math.PI * 2);
        c.fill();
        c.restore();
    }

    // ==== 按鈕綁定 ====
    function bindButtons() {
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                handleAction(btn.dataset.action);
            });
        });

        // 名稱確認 (Enter 或點按鈕)
        const nameInput = document.getElementById('mp-name-input');
        const nameConfirm = document.getElementById('mp-name-confirm');
        const confirmName = () => {
            const v = (nameInput.value || '').trim().slice(0, 12);
            if (!v) {
                window.UI.playSfx('fail');
                nameInput.focus();
                return;
            }
            game.mp.myName = v;
            try { localStorage.setItem('magicRunes.mpName', v); } catch (e) {}
            window.UI.playSfx('ui');
            window.UI.showScreen('mp-mode-select');
        };
        if (nameConfirm) nameConfirm.addEventListener('click', confirmName);
        if (nameInput) {
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') confirmName();
            });
        }

        // 多人連線按鈕
        const hostBtn = document.getElementById('mp-host-btn');
        if (hostBtn) {
            hostBtn.addEventListener('click', () => {
                window.UI.playSfx('ui');
                hostRoom();
            });
        }
        const joinBtn = document.getElementById('mp-join-btn');
        if (joinBtn) {
            joinBtn.addEventListener('click', () => {
                window.UI.playSfx('ui');
                const code = document.getElementById('mp-code-input').value.trim().toUpperCase();
                joinRoom(code);
            });
        }
        const startMpBtn = document.getElementById('mp-start-btn');
        if (startMpBtn) {
            startMpBtn.addEventListener('click', () => {
                if (!window.Multiplayer.isConnected()) return;
                const mapId = document.getElementById('mp-map-select').value;
                const rounds = parseInt(document.getElementById('mp-rounds-select').value, 10);
                game.mp.mapId = mapId;
                game.mp.rounds = rounds;
                window.Multiplayer.send({ type: 'start', mapId: mapId, rounds: rounds });
                window.UI.playSfx('ui');
                beginMpMatch(true);
            });
        }
        // 房主地圖/回合同步 (變更時推播)
        const mapSel = document.getElementById('mp-map-select');
        const roundSel = document.getElementById('mp-rounds-select');
        const pushConfig = () => {
            if (window.Multiplayer.isConnected() && window.Multiplayer.isHost()) {
                window.Multiplayer.send({
                    type: 'config',
                    mapId: mapSel.value,
                    rounds: parseInt(roundSel.value, 10)
                });
            }
        };
        if (mapSel) mapSel.addEventListener('change', pushConfig);
        if (roundSel) roundSel.addEventListener('change', pushConfig);

        // PvP 編輯出戰符文
        const mpEditLoadout = document.getElementById('mp-edit-loadout');
        if (mpEditLoadout) {
            mpEditLoadout.addEventListener('click', () => {
                window.UI.playSfx('ui');
                openLoadout(() => {
                    // 編輯完回到房間
                    window.UI.showScreen('mp-room');
                }, true);
            });
        }

        // 技能重置
        const resetBtn = document.getElementById('skills-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                for (const k in game.runeLevels) game.runeLevels[k] = 1;
                window.UI.playSfx('purchase');
                saveProgress();
                refreshSkills();
            });
        }

        // 出戰確認
        const loadoutBtn = document.getElementById('loadout-confirm');
        if (loadoutBtn) {
            loadoutBtn.addEventListener('click', () => {
                const mpMode = !!game._loadoutMpMode;
                const list = mpMode ? game.pvpLoadout : game.loadout;
                if (!list.length) {
                    window.UI.playSfx('fail');
                    return;
                }
                window.UI.playSfx('ui');
                const cont = game._loadoutContinuation;
                game._loadoutContinuation = null;
                game._loadoutMpMode = false;
                if (cont) cont();
            });
        }

        // 升級略過
        const skipBtn = document.getElementById('upgrade-skip');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                window.UI.playSfx('ui');
                window.UI.hideUpgrade();
                // 升級 modal 關閉後，結算畫面會於 endLevel 接手顯示 (若尚未顯示)
                if (document.getElementById('result-screen').classList.contains('hidden')) {
                    // 重新觸發 endLevel 以顯示 stats (我們已經在 showUpgrade 的 callback 中 showResult)
                    // 這裡略過代表不升級，直接顯示結算
                    const stats = game._pendingStats || {};
                    const hasNext = game._pendingHasNext || false;
                    window.UI.showResult('勝利！', stats, hasNext);
                }
            });
        }

        document.querySelectorAll('.practice-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setPracticeTarget(btn.dataset.rune);
                window.UI.playSfx('ui');
            });
        });

        document.getElementById('pause-btn').addEventListener('click', () => {
            if (game.state === 'playing') {
                game.state = 'paused';
                document.getElementById('pause-menu').classList.remove('hidden');
            }
        });

        document.getElementById('recognition-threshold').addEventListener('change', (e) => {
            game.recognitionThreshold = parseFloat(e.target.value);
        });

        // ESC 暫停
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (game.state === 'playing') {
                    game.state = 'paused';
                    document.getElementById('pause-menu').classList.remove('hidden');
                } else if (game.state === 'paused') {
                    game.state = 'playing';
                    document.getElementById('pause-menu').classList.add('hidden');
                }
            }
        });
    }

    function handleAction(action) {
        window.UI.playSfx('ui');
        switch (action) {
            case 'start':
                window.UI.buildLevelSelect(game.unlockedLevels, (lv) => {
                    openLoadout(() => startLevel(lv));
                });
                window.UI.showScreen('level-select');
                break;
            case 'infinite':
                openLoadout(() => startInfinite());
                break;
            case 'multiplayer':
                // 先輸入名稱再選模式
                document.getElementById('mp-name-input').value = game.mp.myName === 'Player' ? '' : game.mp.myName;
                window.UI.showScreen('mp-name-screen');
                setTimeout(() => document.getElementById('mp-name-input').focus(), 50);
                break;
            case 'mp-mode-1v1':
                game.mp.teamMode = '1v1';
                openMpLobby();
                break;
            case 'mp-mode-2v2':
                game.mp.teamMode = '2v2';
                openMpLobby();
                break;
            case 'mp-leave':
                leaveMp();
                break;
            case 'mp-rematch':
                rematchMp();
                break;
            case 'skills':
                openSkills();
                break;
            case 'shop':
                openShop();
                break;
            case 'practice':
                startPractice();
                break;
            case 'codex':
                window.UI.buildCodex({
                    runeLevels: game.runeLevels,
                    isUnlocked: isSpellUnlocked
                });
                window.UI.showScreen('codex-screen');
                break;
            case 'settings':
                window.UI.showScreen('settings-screen');
                break;
            case 'back-to-menu':
                window.UI.showScreen('main-menu');
                game.state = 'menu';
                window.UI.stopBgm();
                window.UI.showControlsHint(false);
                break;
            case 'resume':
                game.state = 'playing';
                document.getElementById('pause-menu').classList.add('hidden');
                lastTime = performance.now();
                break;
            case 'restart':
                document.getElementById('pause-menu').classList.add('hidden');
                window.UI.hideResult();
                if (game.infinite) startInfinite();
                else startLevel(game.level);
                break;
            case 'quit':
                document.getElementById('pause-menu').classList.add('hidden');
                window.UI.hideResult();
                window.UI.hideUpgrade();
                window.UI.showScreen('main-menu');
                game.state = 'menu';
                window.UI.stopBgm();
                window.UI.showControlsHint(false);
                break;
            case 'next-level':
                if (game.level < window.Enemies.TOTAL_LEVELS) {
                    window.UI.hideResult();
                    startLevel(game.level + 1);
                }
                break;
        }
    }

    // ==== 啟動 ====
    function init() {
        window.UI.init();
        resizeCanvas();
        bindButtons();
        lastTime = performance.now();
        requestAnimationFrame(mainLoop);
    }

    // 首次點擊後啟用 AudioContext (瀏覽器限制)
    document.addEventListener('click', function unlockAudio() {
        const ctx = window.UI.getAudio();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        document.removeEventListener('click', unlockAudio);
    }, { once: true });

    init();
})();
