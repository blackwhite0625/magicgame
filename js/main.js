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
    const MIN_TRAIL_POINTS = 6;     // 最低識別點數 (快速畫的 Z 可能只有 6-7 點)

    // 大亂鬥: 大世界 + 角色固定置中, 畫面跟著玩家移動 (io 風格)
    const BRAWL_WORLD_W = 2400;
    const BRAWL_WORLD_H = 1800;

    function getWorldDims() {
        if (game.mp && game.mp.active && game.mp.teamMode === 'brawl') {
            return { w: BRAWL_WORLD_W, h: BRAWL_WORLD_H };
        }
        return { w: cachedSize.w, h: cachedSize.h };
    }

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
        traps: [],
        pickups: [],
        activeBuffs: {},
        allies: [],            // 召喚的魔靈
        gold: 0,
        shopPurchased: {},          // { slash: true, groundslam: true, ... }
        statUpgrades: { hp: 0, mp: 0, mpRegen: 0 },
        loadout: ['fireball'],
        pvpLoadout: ['fireball'],
        _loadoutContinuation: null,
        _loadoutMpMode: false,
        _loadoutBackScreen: null,
        menuContext: null,
        skillPointsEarned: 0,
        infiniteSavedWave: 0,       // 無限模式上次中途離開的波次
        // ==== 多人對戰 ====
        camera: { x: 0, y: 0 },   // 大亂鬥: 視窗左上角在世界中的座標
        mp: {
            active: false,
            isHost: false,
            teamMode: '1v1',      // '1v1' | '2v2' | 'brawl'
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
            sendTimer: 0,
            // ====== 大亂鬥 (brawl) ======
            brawlKills: {},        // { slot: killCount } — 擊殺計分
            brawlKillLimit: 5,     // 先達到此擊殺數獲勝
            respawnTimer: 0,       // 自己的復活倒數 (秒), 0 = 存活
            respawnMax: 3          // 復活秒數
        }
    };
    const LOADOUT_MAX = 5;
    // 初始只有火球術免費, 其餘全部透過商城解鎖
    const DEFAULT_UNLOCKED = { fireball: true, summon: true };
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
        if (unlocked) {
            // bug fix: 舊版 cap 是 20, 但關卡已擴充到 50。改用 TOTAL_LEVELS 防止進度被截斷
            const maxLv = (window.Enemies && window.Enemies.TOTAL_LEVELS) || 50;
            game.unlockedLevels = Math.max(1, Math.min(maxLv, parseInt(unlocked, 10) || 1));
        }
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
        const infSaved = localStorage.getItem('magicRunes.infiniteSavedWave');
        if (infSaved) game.infiniteSavedWave = Math.max(0, parseInt(infSaved, 10) || 0);
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

    // ==== 安全: HTML 跳脫 (防止 XSS) ====
    // 任何來自網路或使用者輸入的字串, 寫入 innerHTML 前必須透過此函式
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
            localStorage.setItem('magicRunes.infiniteSavedWave', String(game.infiniteSavedWave));
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
            // 小幅 4 方向散射後很快減速停下 — 不受重力影響
            vx: (Math.random() - 0.5) * 120,
            vy: (Math.random() - 0.5) * 120,
            bob: Math.random() * Math.PI * 2,
            life: 25    // 停留時間加長
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
        const size = getCanvasSize();
        const margin = 24;
        // Pickups: 小範圍飄散後靜止 (無重力), 碰玩家吸收
        for (let i = game.pickups.length - 1; i >= 0; i--) {
            const pk = game.pickups[i];
            pk.bob += dt * 3;
            // 散射 + 快速減速 (~0.5s 內停下)
            pk.x += pk.vx * dt;
            pk.y += pk.vy * dt;
            pk.vx *= 0.88;
            pk.vy *= 0.88;
            // 在畫布邊界內彈回 (避免飛出場外)
            if (pk.x < margin)               { pk.x = margin;             pk.vx = Math.abs(pk.vx) * 0.4; }
            if (pk.x > size.w - margin)      { pk.x = size.w - margin;    pk.vx = -Math.abs(pk.vx) * 0.4; }
            if (pk.y < margin)               { pk.y = margin;             pk.vy = Math.abs(pk.vy) * 0.4; }
            if (pk.y > size.h - margin)      { pk.y = size.h - margin;    pk.vy = -Math.abs(pk.vy) * 0.4; }
            pk.life -= dt;
            // 與玩家碰撞
            const dx = pk.x - p.x, dy = pk.y - p.y;
            if (dx * dx + dy * dy < (p.radius + 22) * (p.radius + 22)) {
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

    // ==== 召喚系統 (魔靈盟友) ====
    function spawnAlly(x, y, hp, damage, life) {
        game.allies.push({
            x: x, y: y,
            vx: 0, vy: 0,
            hp: hp, maxHp: hp,
            damage: damage,
            radius: 16,
            life: life,
            maxLife: life,
            attackCd: 0,
            bobPhase: Math.random() * Math.PI * 2,
            wandAngle: Math.random() * Math.PI * 2
        });
    }

    function updateAllies(dt) {
        // 決定目標敵人池 (單人 = game.enemies; PvP = 對手隊伍)
        let targets;
        if (game.state === 'pvp' && game.mp && game.mp.active) {
            targets = getEnemyTargets();
        } else {
            targets = game.enemies;
        }
        for (let i = game.allies.length - 1; i >= 0; i--) {
            const a = game.allies[i];
            a.life -= dt;
            a.bobPhase += dt * 4;
            a.attackCd -= dt;
            if (a.life <= 0 || a.hp <= 0) {
                // 消散特效
                window.Particles.burst(a.x, a.y, {
                    count: 18, spread: 140, life: 0.5,
                    color: '#ccaaff', color2: '#ffffff', size: 4
                });
                game.allies.splice(i, 1);
                continue;
            }
            // 找最近敵人
            let nearest = null, nd = Infinity;
            for (let j = 0; j < targets.length; j++) {
                const e = targets[j];
                if (!e || e.dead) continue;
                const ddx = e.x - a.x, ddy = e.y - a.y;
                const d = ddx * ddx + ddy * ddy;
                if (d < nd) { nd = d; nearest = e; }
            }
            if (nearest) {
                const ddx = nearest.x - a.x, ddy = nearest.y - a.y;
                const dist = Math.sqrt(nd);
                const speed = 140;
                a.x += (ddx / dist) * speed * dt;
                a.y += (ddy / dist) * speed * dt;
                // 接觸攻擊
                if (a.attackCd <= 0 && dist < nearest.radius + a.radius + 4) {
                    a.attackCd = 0.7;
                    if (game.state === 'pvp') {
                        // PvP: 模擬投射物命中傳送給對方
                        if (nearest._slot !== undefined || game.mp.teamMode !== '2v2') {
                            window.Multiplayer.send({
                                type: 'hit',
                                damage: a.damage,
                                spell: 'summon',
                                nx: nearest.x / cachedSize.w,
                                ny: nearest.y / cachedSize.h,
                                target: nearest._slot
                            });
                            applyLocalDamageToTarget(nearest, a.damage);
                        }
                    } else {
                        window.Enemies.damageEnemy(nearest, a.damage);
                        spawnDamageNumber(nearest.x, nearest.y, a.damage, false);
                        if (nearest.dead) onEnemyKilled(nearest);
                    }
                    // 攻擊視覺
                    window.Particles.burst(nearest.x, nearest.y, {
                        count: 10, spread: 100, life: 0.3,
                        color: '#ccaaff', color2: '#ffffff', size: 3
                    });
                }
            } else {
                // 沒有敵人: 繞玩家飄
                a.wandAngle += dt * 1.2;
                const tx = game.player.x + Math.cos(a.wandAngle) * 80;
                const ty = game.player.y + Math.sin(a.wandAngle) * 80;
                const ddx = tx - a.x, ddy = ty - a.y;
                a.x += ddx * dt * 3;
                a.y += ddy * dt * 3;
            }
        }
    }

    function renderAllies(c) {
        if (game.allies.length === 0) return;
        c.save();
        const TWO_PI = 6.283185307179586;
        for (const a of game.allies) {
            const bob = Math.sin(a.bobPhase) * 3;
            const lifePct = a.life / a.maxLife;
            const alpha = lifePct < 0.3 ? (Math.sin(a.bobPhase * 6) * 0.4 + 0.6) : 1;
            c.globalAlpha = alpha;
            // 外層光暈
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = 'rgba(200, 170, 255, 0.45)';
            c.beginPath();
            c.arc(a.x, a.y + bob, a.radius * 1.8, 0, TWO_PI);
            c.fill();
            // 本體
            c.globalCompositeOperation = 'source-over';
            c.fillStyle = '#b599ee';
            c.beginPath();
            c.arc(a.x, a.y + bob, a.radius, 0, TWO_PI);
            c.fill();
            // 眼睛
            c.fillStyle = '#fff8aa';
            c.beginPath();
            c.arc(a.x - 4, a.y + bob - 2, 2.2, 0, TWO_PI);
            c.arc(a.x + 4, a.y + bob - 2, 2.2, 0, TWO_PI);
            c.fill();
            // HP 條 (當有損傷時顯示)
            if (a.hp < a.maxHp) {
                const barW = 28;
                c.fillStyle = 'rgba(0,0,0,0.6)';
                c.fillRect(a.x - barW / 2, a.y - a.radius - 8, barW, 3);
                c.fillStyle = '#66ff88';
                c.fillRect(a.x - barW / 2, a.y - a.radius - 8, barW * (a.hp / a.maxHp), 3);
            }
        }
        c.globalAlpha = 1;
        c.restore();
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
        if (target === 'game' && game.mp && game.mp.active && game.mp.paused) return;
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
            // bug fix: brawl 粒子在 camera 變換內繪製, pointer 是畫布座標
            // → 需轉換成世界座標, 否則粒子會飄到地圖別處
            let px = p.x, py = p.y;
            if (target === 'game' && game.mp && game.mp.active && game.mp.teamMode === 'brawl') {
                px += game.camera.x;
                py += game.camera.y;
            }
            window.Particles.emitTrail(px, py, '#bb88ff');
            window.Particles.emitCore(px, py, '#ffffff');
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
        // 多人暫停中: 不移動
        if (game.mp && game.mp.active && game.mp.paused) return false;
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
        // 邊界限制: brawl 用大世界, 其他用畫布
        const worldDims = getWorldDims();
        const margin = p.radius + 20;
        if (p.x < margin) p.x = margin;
        if (p.x > worldDims.w - margin) p.x = worldDims.w - margin;
        if (p.y < margin) p.y = margin;
        if (p.y > worldDims.h - margin - 10) p.y = worldDims.h - margin - 10;
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

    // PvP 施法流程
    function processGameSpell(trail) {
        const isPvp = game.state === 'pvp' && game.mp.active && game.mp.roundState === 'playing';
        if (isPvp) {
            // 1v1: 單一對手. 2v2: 敵隊 2 人. brawl: 所有其他玩家 (FFA)
            // bug fix: 之前 brawl 用了 mpOpponentAsEnemy() (座標 0,0), 投射物全飛到左上角
            const tm = game.mp.teamMode;
            const enemyList = (tm === '2v2' || tm === 'brawl')
                ? getEnemyTargets()
                : [mpOpponentAsEnemy()];
            // 記錄每個敵人當前 HP, 施法後計算差值送 hit (單體/AOE 皆適用)
            const snapshot = enemyList.map(e => ({
                slot: e._slot,
                hpBefore: e.hp,
                ref: e
            }));
            const orig = game.enemies;
            game.enemies = enemyList;

            _processGameSpellInner(trail, (name, critical) => {
                // 找最近敵人決定施法視覺目標 (ntx/nty)
                let nearest = null, nd = Infinity;
                for (let i = 0; i < enemyList.length; i++) {
                    const e = enemyList[i];
                    const dx = e.x - game.player.x, dy = e.y - game.player.y;
                    const d = dx * dx + dy * dy;
                    if (d < nd) { nd = d; nearest = e; }
                }
                const tx = nearest ? nearest.x : game.player.x + 400;
                const ty = nearest ? nearest.y : game.player.y;
                const wDims = getWorldDims();
                window.Multiplayer.send({
                    type: 'cast',
                    spell: name,
                    slot: game.mp.mySlot,
                    nx: game.player.x / wDims.w,
                    ny: game.player.y / wDims.h,
                    ntx: tx / wDims.w,
                    nty: ty / wDims.h,
                    critical: critical
                });
            });

            game.enemies = orig;

            // 對每個受傷的敵人分別發送 hit (2v2 依 slot, 1v1 不附 slot)
            for (let i = 0; i < enemyList.length; i++) {
                const snap = snapshot[i];
                const dmg = snap.hpBefore - snap.ref.hp;
                if (dmg > 0) {
                    window.Multiplayer.send({
                        type: 'hit',
                        damage: dmg,
                        spell: 'aoe',
                        target: snap.slot,       // 2v2 有 slot, 1v1 為 undefined
                        nx: snap.ref.x / cachedSize.w,
                        ny: snap.ref.y / cachedSize.h
                    });
                    applyLocalDamageToTarget(snap.ref, dmg);
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
        // 歧義檢查: 最佳與次佳分差太小 → 除非準確度夠高否則拒絕
        // 降到 0.72 — 閃電 Z / poison S 在正規化後特別相似, margin 常 <0.05,
        // 但 accuracy 可以有 0.7+, 用戶畫得還算清楚就該接受
        if (result.margin !== undefined && result.margin < window.Recognizer.MIN_MARGIN && result.accuracy < 0.72) {
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
            case 'summon': {
                const isPvP = game.state === 'pvp' && game.mp && game.mp.active;
                // PvP 平衡: 只召喚 1 隻, 傷害 40%, HP 60%, 時限 70%
                const count = isPvP ? 1 : (cfg.summonCount + (hi ? 1 : 0) + (max ? 1 : 0));
                const dmg   = isPvP ? cfg.summonDamage * 0.4 : cfg.summonDamage;
                const hp    = isPvP ? Math.round(cfg.summonHp * 0.6) : cfg.summonHp;
                const life  = isPvP ? cfg.summonLife * 0.7 : cfg.summonLife;
                for (let i = 0; i < count; i++) {
                    const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
                    spawnAlly(
                        p.x + Math.cos(a) * 60,
                        p.y + Math.sin(a) * 60,
                        hp, dmg, life
                    );
                }
                window.Particles.burst(p.x, p.y, {
                    count: 40, spread: 280, life: 0.9,
                    color: '#ccaaff', color2: '#ffffff', size: 5
                });
                window.Spells.createShockwave(p.x, p.y, 120, '#ccaaff', 0.6);
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
            // PvP 模式: 我死了
            if (game.mp && game.mp.active) {
                if (game.mp.teamMode === 'brawl') {
                    // 大亂鬥: 不結束回合, 3 秒後復活
                    startBrawlRespawn();
                } else {
                    localRoundDecided(false);
                }
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

    // ==== 聊天室 ====
    const CHAT_MAX_MESSAGES = 60;     // log 最多保留訊息數 (避免 DOM 膨脹)
    const CHAT_MAX_LEN = 100;          // 單則訊息字數上限

    function initChat() {
        const form = document.getElementById('mp-chat-form');
        const input = document.getElementById('mp-chat-input');
        if (!form || form.dataset.bound) return;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            sendChatMessage();
        });
        form.dataset.bound = '1';
    }

    function sendChatMessage() {
        const input = document.getElementById('mp-chat-input');
        if (!input) return;
        const raw = String(input.value || '').trim();
        if (!raw) return;
        // 過濾控制字元 + 截斷長度
        const text = raw.replace(/[\x00-\x1f\x7f]/g, '').slice(0, CHAT_MAX_LEN);
        if (!text) return;
        if (!window.Multiplayer.isConnected()) {
            appendChatMessage({ system: true, text: '尚未連線, 無法送訊息' });
            return;
        }
        const msg = {
            type: 'chat',
            slot: game.mp.mySlot,
            name: game.mp.myName,
            text: text,
            t: Date.now()
        };
        window.Multiplayer.send(msg);
        // 自己也顯示一次 (網路送出端不會收到自己的訊息)
        appendChatMessage({ name: game.mp.myName, slot: game.mp.mySlot, text: text, self: true });
        input.value = '';
    }

    /** 安全: 用 textContent 組裝 DOM, 完全避開 innerHTML, 徹底防 XSS */
    function appendChatMessage(msg) {
        const log = document.getElementById('mp-chat-log');
        if (!log) return;
        const row = document.createElement('div');
        row.className = 'mp-chat-msg' + (msg.self ? ' self' : '') + (msg.system ? ' system' : '');
        if (msg.system) {
            row.textContent = '— ' + msg.text + ' —';
        } else {
            const nameSpan = document.createElement('span');
            nameSpan.className = 'mp-chat-name';
            nameSpan.textContent = (msg.name || ('P' + (msg.slot != null ? msg.slot : '?'))) + ':';
            const textSpan = document.createElement('span');
            textSpan.className = 'mp-chat-text';
            textSpan.textContent = ' ' + msg.text;
            row.appendChild(nameSpan);
            row.appendChild(textSpan);
        }
        log.appendChild(row);
        while (log.children.length > CHAT_MAX_MESSAGES) log.removeChild(log.firstChild);
        log.scrollTop = log.scrollHeight;
    }

    function clearChat() {
        const log = document.getElementById('mp-chat-log');
        if (log) log.innerHTML = '';
    }

    // ==== 多人對戰 ====
    function openMpLobby() {
        window.UI.showScreen('mp-lobby');
        document.getElementById('mp-status').classList.add('hidden');
        document.getElementById('mp-code-input').value = '';
        initChat();
        clearChat();
        const titleEl = document.getElementById('mp-lobby-title');
        if (titleEl) {
            const tm = game.mp.teamMode;
            let label;
            if (tm === 'brawl') label = '大亂鬥';
            else if (tm === '2v2') label = '2v2';
            else label = '1v1';
            titleEl.textContent = label + ' 連線對戰';
        }
    }

    function showMpStatus(msg, isError) {
        const el = document.getElementById('mp-status');
        el.textContent = msg;
        el.classList.remove('hidden');
        el.classList.toggle('mp-error', !!isError);
    }

    function setupMpHandlers() {
        // 關鍵修正: 重複呼叫 setupMpHandlers 會累加 listeners, 導致每個事件觸發多次
        // (聊天訊息加倍 / 系統訊息重複都是此 bug)
        window.Multiplayer.offAll();
        window.Multiplayer.on('open', (conn) => {
            if (window.Multiplayer.isHost()) {
                // 防重複: 若此 connId (peer id) 已存在於某個 slot, 先移除
                // 避免刷新 / 重連後同一人佔用兩個 slot
                const connId = conn && conn.peer ? conn.peer : null;
                if (connId) {
                    for (const s in game.mp.players) {
                        if (game.mp.players[s].connId === connId) {
                            delete game.mp.players[s];
                        }
                    }
                }
                // 新加入的訪客 — 指派 slot
                // 1v1/2v2: 最多 slot 1-3
                // brawl: 無限, 依序指派 1, 2, 3, 4...
                const isBrawl = game.mp.teamMode === 'brawl';
                const maxSlot = isBrawl ? 63 : 3;
                const usedSlots = new Set([0]);
                for (const slot in game.mp.players) usedSlots.add(parseInt(slot, 10));
                let assignSlot = -1;
                for (let s = 1; s <= maxSlot; s++) {
                    if (!usedSlots.has(s)) { assignSlot = s; break; }
                }
                if (assignSlot === -1) return;
                // 依目前兩隊人數指派到較少的那隊 (保證 2 vs 2; brawl 忽略 team 但仍指派值)
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
                // brawl: 不透過下拉選單讀 map/rounds, 直接用 game.mp 的值
                const mapSel = document.getElementById('mp-map-select');
                const roundSel = document.getElementById('mp-rounds-select');
                const msg = {
                    type: 'assignSlot',
                    slot: assignSlot, team: team,
                    teamMode: game.mp.teamMode,
                    mapId: isBrawl ? 'brawl' : (mapSel ? mapSel.value : game.mp.mapId),
                    rounds: isBrawl ? 1 : (roundSel ? parseInt(roundSel.value, 10) : game.mp.rounds)
                };
                if (connObj) { try { connObj.send(msg); } catch (e) {} }
                else window.Multiplayer.send(msg);
                // brawl: 新人進場時, 單獨把目前擊殺分數同步過去
                if (isBrawl && connObj) {
                    try {
                        connObj.send({ type: 'brawlState', kills: Object.assign({}, game.mp.brawlKills || {}) });
                    } catch (e) {}
                }
                // 廣播 lobby 狀態
                broadcastLobby();
                // brawl: 已經在對戰中 (host 先入場), 不更新 room UI
                if (!isBrawl) updateRoomUI();
            } else {
                // 訪客: 大亂鬥等 assignSlot → 自動入場 (不顯示 room)
                if (game.mp.teamMode === 'brawl') {
                    // 保持當前畫面, 等待 assignSlot 後自動 beginMpMatch
                    return;
                }
                // 1v1 / 2v2: 進入房間畫面, 等主機 'assignSlot'
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
                const peerId = conn && conn.peer;
                let leftName = null;
                for (const s in game.mp.players) {
                    if (game.mp.players[s].connId === peerId) {
                        leftName = game.mp.players[s].name || 'P' + s;
                        delete game.mp.players[s];
                        break;
                    }
                }
                broadcastLobby();
                updateRoomUI();
                if (leftName) {
                    const msg = leftName + ' 離開房間';
                    appendChatMessage({ system: true, text: msg });
                    window.Multiplayer.send({ type: 'chat', system: true, text: msg, t: Date.now() });
                }
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
        const tm = game.mp.teamMode;
        const capacity = (tm === '2v2' || tm === 'brawl') ? 4 : 2;
        game.mp.isHost = true;
        game.mp.mySlot = 0;
        // brawl 沒有隊伍概念, myTeam 用 slot 代替 (避免與別人相等)
        game.mp.myTeam = tm === 'brawl' ? 0 : 0;
        game.mp.players = {};
        window.Multiplayer.host((code) => {
            window.UI.showScreen('mp-room');
            document.getElementById('mp-code-display').textContent = code;
            let title;
            if (tm === 'brawl') title = '大亂鬥: 等待對手 (2-4 人)';
            else if (tm === '2v2') title = '等待 3 位對手 (2v2)';
            else title = '等待對手 (1v1)';
            document.getElementById('mp-room-title').textContent = title;
            document.getElementById('mp-host-config').classList.remove('hidden');
            document.getElementById('mp-start-btn').disabled = true;
            const needed = capacity - 1;
            // brawl 只要 1 位即可開戰 (2 人也可玩)
            if (tm === 'brawl') {
                document.getElementById('mp-start-btn').textContent = '等待至少 1 位對手...';
            } else {
                document.getElementById('mp-start-btn').textContent = `等待 ${needed} 位對手...`;
            }
            renderRoomSlots();
            applyBrawlRoomUI(tm === 'brawl');
        }, (err) => showMpStatus('無法開房: ' + err, true), capacity);
    }

    // 切換房間 UI — brawl 模式隱藏 隊伍分欄 / 回合選擇, 顯示「擊殺數目標: 5」
    function applyBrawlRoomUI(isBrawl) {
        const roundsEl = document.getElementById('mp-rounds-select');
        if (roundsEl && roundsEl.parentElement) {
            roundsEl.parentElement.style.display = isBrawl ? 'none' : '';
        }
        const mapEl = document.getElementById('mp-map-select');
        if (mapEl && mapEl.parentElement) {
            mapEl.parentElement.style.display = isBrawl ? 'none' : '';
        }
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

    // ==== 大亂鬥: 自動加入公開戰場 ====
    // 不需建房 / 不需輸入房號, 選完技能直接入場。
    // 策略: 先 join 固定 ID "BRAWL1", 失敗 (任何錯誤) 則自己當 host。
    function autoJoinBrawl() {
        const BRAWL_CODE = 'BRAWL1';
        // 顯示專屬 loading overlay (不要用 mp-lobby, 以免露出創建/加入房間按鈕)
        const overlay = document.getElementById('brawl-connecting');
        const statusEl = document.getElementById('brawl-connecting-status');
        if (overlay) overlay.classList.remove('hidden');
        if (statusEl) statusEl.textContent = '正在尋找戰場...';

        setupMpHandlers();
        game.mp.players = {};

        let tried = 0;
        const MAX_TRIES = 4;
        let cancelled = false;

        function setStatus(t) { if (statusEl) statusEl.textContent = t; }

        function attemptJoin() {
            if (cancelled) return;
            tried++;
            setStatus('嘗試加入戰場... (第 ' + tried + ' 次)');
            game.mp.isHost = false;
            window.Multiplayer.join(BRAWL_CODE, (err) => {
                if (cancelled) return;
                // 任何 join 錯誤都視為「沒人當 host」, 自己當
                if (tried < MAX_TRIES) {
                    setStatus('沒有戰場, 嘗試當房主...');
                    setTimeout(attemptHost, 400);
                } else {
                    brawlConnectFailed(err);
                }
            });
        }

        function attemptHost() {
            if (cancelled) return;
            tried++;
            setStatus('建立戰場中... (第 ' + tried + ' 次)');
            game.mp.isHost = true;
            window.Multiplayer.host((code) => {
                if (cancelled) return;
                // 成功當房主 → 立刻開戰 + 關閉 loading
                if (overlay) overlay.classList.add('hidden');
                brawlStartMatch(true);
            }, (err) => {
                if (cancelled) return;
                if (tried < MAX_TRIES) {
                    // 可能別人同時搶 host → 再試 join
                    setStatus('戰場被搶, 重試加入...');
                    setTimeout(attemptJoin, 500);
                } else {
                    brawlConnectFailed(err);
                }
            }, 0, BRAWL_CODE);
        }

        function brawlConnectFailed(err) {
            setStatus('連線失敗: ' + (err || '未知錯誤'));
            setTimeout(() => {
                if (overlay) overlay.classList.add('hidden');
                window.UI.showScreen('mp-mode-select');
            }, 2500);
        }

        // 取消按鈕
        const cancelBtn = document.getElementById('brawl-connecting-cancel');
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                cancelled = true;
                if (overlay) overlay.classList.add('hidden');
                try { window.Multiplayer.disconnect(); } catch (e) {}
                window.UI.showScreen('mp-mode-select');
            };
        }

        // 開始
        attemptJoin();
    }

    // 為了讓 guest 入場後關掉 loading overlay, 在 beginMpMatch 呼叫前判斷
    // (這部份在 assignSlot handler 調用 beginMpMatch 後, game-screen 顯示會蓋掉 overlay 但我們還是該手動清除)
    function hideBrawlConnecting() {
        const overlay = document.getElementById('brawl-connecting');
        if (overlay) overlay.classList.add('hidden');
    }

    // 大亂鬥: 當連線成功後立刻開始對戰 (不等 lobby 確認)
    function brawlStartMatch(asHost) {
        // 確保只被呼叫一次
        if (game.mp.active) return;
        beginMpMatch(asHost);
    }

    function leaveMp() {
        window.Multiplayer.send({ type: 'leave' });
        window.Multiplayer.disconnect();
        game.mp.active = false;
        game.mp.paused = false;
        stopPingLoop();
        clearChat();
        document.getElementById('mp-result').classList.add('hidden');
        document.getElementById('mp-pause-menu').classList.add('hidden');
        window.UI.showScreen('mp-mode-select');
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
            const tm = game.mp.teamMode;
            // brawl: 2 人就可開戰; 1v1: 需要 1 對手; 2v2: 需要 3 對手
            let needed;
            if (tm === 'brawl') needed = 1;
            else if (tm === '2v2') needed = 3;
            else needed = 1;
            const have = window.Multiplayer.connectionCount();
            const btn = document.getElementById('mp-start-btn');
            if (btn) {
                if (have >= needed) {
                    btn.disabled = false;
                    btn.textContent = tm === 'brawl' ? `開始大亂鬥 (${have + 1} 人)` : '開始對戰';
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
                <div class="mp-card-name">${escapeHtml(s.name)}</div>
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
                // 安全: 僅接受已知地圖 ID 和合理回合數
                if (data.mapId && window.Maps && window.Maps.MAPS && window.Maps.MAPS[data.mapId]) {
                    mp.mapId = data.mapId;
                }
                {
                    const r = parseInt(data.rounds, 10);
                    if ([1, 3, 5, 7].indexOf(r) >= 0) mp.rounds = r;
                }
                {
                    const el = document.getElementById('mp-opp-slot');
                    if (el) el.querySelector('.mp-slot-status').textContent = '房主已設定';
                }
                break;
            case 'assignSlot': {
                // 安全: assignSlot 只由房主發給訪客, 房主不應處理, 否則會被惡意訊息重新指派
                if (game.mp.isHost) break;
                // 安全: 驗證 slot / team / teamMode / rounds
                const s = parseInt(data.slot, 10);
                const t = parseInt(data.team, 10);
                // brawl 可能有 >3 的 slot (無限人數)
                if (s < 0 || s > 63 || !(t === 0 || t === 1)) break;
                mp.mySlot = s;
                mp.myTeam = t;
                if (data.teamMode === 'brawl' || data.teamMode === '2v2' || data.teamMode === '1v1') {
                    mp.teamMode = data.teamMode;
                }
                if (data.mapId && window.Maps && window.Maps.MAPS && window.Maps.MAPS[data.mapId]) {
                    mp.mapId = data.mapId;
                }
                const r = parseInt(data.rounds, 10);
                if ([1, 3, 5, 7].indexOf(r) >= 0) mp.rounds = r;
                window.Multiplayer.send({ type: 'hello', name: String(game.mp.myName || '').slice(0, 12), slot: mp.mySlot });
                // 大亂鬥: 收到 assignSlot 就直接開戰, 不等 'start'
                if (mp.teamMode === 'brawl' && !mp.active) {
                    hideBrawlConnecting();
                    beginMpMatch(false);
                } else {
                    renderRoomSlots();
                }
                break;
            }
            case 'lobby':
                // 安全: lobby 是房主廣播, 房主不處理以免被訪客覆寫玩家列表
                if (game.mp.isHost) break;
                mp.teamMode = data.teamMode || mp.teamMode;
                mp.players = {};
                for (const s in data.players) {
                    const src = data.players[s];
                    const slotNum = parseInt(s, 10);
                    if (slotNum === mp.mySlot) {
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
                // 1v1: 也同步對手名字到 mp.opponent (遊戲中名牌顯示會用到)
                if (mp.teamMode !== '2v2') {
                    for (const s in data.players) {
                        const slotNum = parseInt(s, 10);
                        if (slotNum !== mp.mySlot) {
                            mp.opponent.name = data.players[s].name || ('P' + slotNum);
                            break;
                        }
                    }
                }
                renderRoomSlots();
                break;
            case 'chat': {
                if (!data.text) break;
                const cleanText = String(data.text).replace(/[\x00-\x1f\x7f]/g, '').slice(0, CHAT_MAX_LEN);
                if (!cleanText) break;
                if (data.system) {
                    appendChatMessage({ system: true, text: cleanText });
                } else {
                    const cleanName = String(data.name || 'P' + (data.slot != null ? data.slot : '?'))
                        .replace(/[\x00-\x1f\x7f]/g, '').slice(0, 12);
                    appendChatMessage({ name: cleanName, slot: data.slot, text: cleanText });
                }
                break;
            }
            case 'ping':
                // 對方 ping 我 → 回傳 pong 帶上原 timestamp
                window.Multiplayer.send({ type: 'pong', t: data.t });
                break;
            case 'pong': {
                const t = Number(data.t);
                if (!isFinite(t)) break;                              // 非數字忽略
                let rtt = Math.round(performance.now() - t);
                if (rtt < 0) rtt = 0;                                 // 避免浮點誤差造成負數
                if (rtt > 9999) break;                                // 異常大值忽略 (可能是舊封包)
                game.mp.pingMs = rtt;
                game.mp.lastPongAt = performance.now();
                const el = document.getElementById('mp-ping-display');
                if (el) {
                    el.textContent = 'Ping: ' + rtt + ' ms';
                    el.classList.remove('ping-good', 'ping-mid', 'ping-bad');
                    if (rtt < 60) el.classList.add('ping-good');
                    else if (rtt < 150) el.classList.add('ping-mid');
                    else el.classList.add('ping-bad');
                }
                break;
            }
            case 'hello': {
                if (!game.mp.isHost) break;
                const slot = parseInt(data.slot, 10);
                // brawl 可支援 >3 的 slot
                const maxSlot = game.mp.teamMode === 'brawl' ? 63 : 3;
                if (slot < 1 || slot > maxSlot) break;
                if (!game.mp.players[slot]) break;
                const finalName = String(data.name || 'P' + slot)
                    .replace(/[\x00-\x1f\x7f]/g, '')
                    .slice(0, 12) || ('P' + slot);
                game.mp.players[slot].name = finalName;
                broadcastLobby();
                renderRoomSlots();
                const joinMsg = finalName + ' 加入房間';
                appendChatMessage({ system: true, text: joinMsg });
                window.Multiplayer.send({ type: 'chat', system: true, text: joinMsg, t: Date.now() });
                break;
            }
            case 'teamSwap':
                // 安全: teamSwap 由房主決定, 房主不處理以免被訪客強制換隊
                if (game.mp.isHost) break;
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
                // 安全: start 由房主發, 房主不處理以免被訪客強制開始
                if (game.mp.isHost) break;
                mp.mapId = data.mapId || mp.mapId;
                mp.rounds = data.rounds || mp.rounds;
                // 房主傳來的 teamMode 覆寫 (大亂鬥用)
                if (data.teamMode === 'brawl' || data.teamMode === '2v2' || data.teamMode === '1v1') {
                    mp.teamMode = data.teamMode;
                }
                beginMpMatch(false);
                break;
            case 'state': {
                // 安全: 限制範圍避免惡意資料導致錯位
                const nx = data.nx !== undefined ? Math.max(-0.1, Math.min(1.1, Number(data.nx))) : null;
                const ny = data.ny !== undefined ? Math.max(-0.1, Math.min(1.1, Number(data.ny))) : null;
                const worldRef = getWorldDims();
                const px = (nx !== null && isFinite(nx)) ? nx * worldRef.w : Number(data.x) || 0;
                const py = (ny !== null && isFinite(ny)) ? ny * worldRef.h : Number(data.y) || 0;
                const hp = Math.max(0, Math.min(500, Number(data.hp) || 0));
                const maxHp = Math.max(1, Math.min(500, Number(data.maxHp) || 100));
                // 注意: 不在這裡更新 name — 防止狀態訊息蓋掉 lobby 去重後的名稱
                if (data.slot !== undefined && (mp.teamMode === '2v2' || mp.teamMode === 'brawl')) {
                    const p = mp.players[data.slot];
                    if (p) {
                        p.x = px; p.y = py;
                        p.hp = hp; p.maxHp = maxHp;
                        p.alive = hp > 0;
                    }
                } else {
                    mp.opponent.x = px;
                    mp.opponent.y = py;
                    mp.opponent.hp = hp;
                    mp.opponent.maxHp = maxHp;
                    mp.opponent.alive = hp > 0;
                    mp.opponent.lastUpdate = performance.now();
                }
                break;
            }
            case 'cast':
                // 對手發射技能 — 本端產生對應視覺 (發射者 = 對手)
                spawnRemoteCast(data);
                break;
            case 'hit': {
                if (!mp.active) break;
                // 2v2 / brawl: 只接受瞄準我 slot 的 hit; 1v1 不帶 target
                if ((mp.teamMode === '2v2' || mp.teamMode === 'brawl') && data.target !== undefined && data.target !== mp.mySlot) break;
                // 大亂鬥: 復活期間不接受傷害
                if (mp.teamMode === 'brawl' && mp.respawnTimer > 0) break;
                // 安全: 限制傷害範圍, 防止被惡意對手傳來 999999 秒殺
                const rawDmg = Number(data.damage);
                if (!isFinite(rawDmg) || rawDmg <= 0) break;
                const dmg = Math.min(100, rawDmg);   // 單擊上限 100
                const hitWD = getWorldDims();
                const hx = data.nx !== undefined ? Math.max(0, Math.min(1, Number(data.nx) || 0)) * hitWD.w : 0;
                const hy = data.ny !== undefined ? Math.max(0, Math.min(1, Number(data.ny) || 0)) * hitWD.h : 0;
                onPlayerHit(dmg, { kind: data.spell, x: hx, y: hy });
                break;
            }
            case 'brawlKill': {
                // 大亂鬥: 同步擊殺計分 (所有人收到同一份更新, 無勝負)
                if (mp.teamMode !== 'brawl') break;
                const killer = parseInt(data.killer, 10);
                if (!(killer >= 0 && killer <= 63)) break;
                mp.brawlKills[killer] = (mp.brawlKills[killer] || 0) + 1;
                updateBrawlHud();
                break;
            }
            case 'brawlState': {
                // 大亂鬥: 新玩家入場時, 房主送目前計分過來
                if (mp.teamMode !== 'brawl') break;
                if (data.kills && typeof data.kills === 'object') {
                    mp.brawlKills = {};
                    for (const k in data.kills) {
                        const slot = parseInt(k, 10);
                        const n = parseInt(data.kills[k], 10);
                        if (slot >= 0 && slot <= 63 && n >= 0 && n <= 9999) {
                            mp.brawlKills[slot] = n;
                        }
                    }
                    updateBrawlHud();
                }
                break;
            }
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
            case 'surrender': {
                if (!game.mp.active) break;
                const need = Math.ceil(mp.rounds / 2);
                // 2v2: 若隊友投降 — 我也輸了; 對手投降 — 我贏
                if (data.team !== undefined && mp.teamMode === '2v2' && data.team === mp.myTeam) {
                    mp.oppWins = Math.max(mp.oppWins, need);
                    endMpMatch('你的隊友投降了...', 'teammate-surrender');
                } else {
                    mp.myWins = Math.max(mp.myWins, need);
                    endMpMatch('對手投降了, 你贏了！', 'opp-surrender');
                }
                break;
            }
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
        // 將對手端的施法還原到本地視覺
        // 2v2: 依 data.slot 找到施法者位置; 1v1: 用 mp.opponent
        const me = game.player;
        let caster;
        if (game.mp.teamMode === '2v2' && data.slot !== undefined && game.mp.players[data.slot]) {
            caster = game.mp.players[data.slot];
        } else {
            caster = game.mp.opponent;
        }
        const opp = caster;
        const castWD = getWorldDims();
        const tx = (data.ntx !== undefined ? data.ntx * castWD.w : me.x) + (Math.random() - 0.5) * 30;
        const ty = (data.nty !== undefined ? data.nty * castWD.h : me.y) + (Math.random() - 0.5) * 30;
        const name = data.spell;
        // 播放遠端施法音效 (即使不是直接對我也聽得到對戰氣氛)
        if (name && window.UI && window.UI.playSfx) {
            try { window.UI.playSfx(name); } catch (e) {}
        }
        switch (name) {
            // ---------- 投射類 ----------
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
                // 閃電從對手頂部射向我, 傷害由 'hit' 訊息處理
                window.Spells.createLightning(opp.x, opp.y - 20, me.x, me.y);
                break;
            case 'meteor': {
                const mx = data.ntx !== undefined ? data.ntx * castWD.w : me.x;
                const my = data.nty !== undefined ? data.nty * castWD.h : me.y;
                window.Spells.scheduleMeteor(mx, my, false);
                break;
            }
            // ---------- AOE / 爆發 ----------
            case 'holynova':
                window.Spells.createShockwave(opp.x, opp.y, 220, '#ffee99', 0.9);
                window.Particles.burst(opp.x, opp.y, { count: 50, spread: 300, life: 0.9, color: '#ffee99', color2: '#ffffff', size: 5 });
                // 光柱
                for (let i = 0; i < 10; i++) {
                    const a = (i / 10) * Math.PI * 2;
                    for (let d = 40; d < 220; d += 30) {
                        window.Particles.spawn({
                            x: opp.x + Math.cos(a) * d,
                            y: opp.y + Math.sin(a) * d,
                            vx: Math.cos(a) * 80, vy: Math.sin(a) * 80,
                            life: 0.5, size: 4,
                            color: '#ffff99', color2: '#ffffff', drag: 0.95
                        });
                    }
                }
                break;
            case 'groundslam': {
                // 棕色擴散衝擊波 + 地裂粒子 (視覺, 不做傷害)
                const r = 200;
                window.Spells.createShockwave(opp.x, opp.y, r, '#cc8844', 0.7);
                window.Spells.createShockwave(opp.x, opp.y, r * 1.2, '#ffdd66', 0.85);
                window.Particles.burst(opp.x, opp.y, {
                    count: 40, spread: r * 1.4, life: 0.8,
                    color: '#cc8844', color2: '#ffdd66', size: 5
                });
                for (let i = 0; i < 16; i++) {
                    const a = (i / 16) * Math.PI * 2;
                    window.Particles.spawn({
                        x: opp.x, y: opp.y,
                        vx: Math.cos(a) * 240, vy: Math.sin(a) * 240,
                        life: 0.6, size: 5,
                        color: '#aa6633', color2: '#442211',
                        drag: 0.9, blend: 'source-over'
                    });
                }
                break;
            }
            case 'poison': {
                // 毒霧: 只是視覺, 不產生 poisonField (避免 double-count 傷害)
                const px = data.ntx !== undefined ? data.ntx * castWD.w : me.x;
                const py = data.nty !== undefined ? data.nty * castWD.h : me.y;
                window.Spells.createShockwave(px, py, 100, '#88dd44', 0.5);
                window.Particles.burst(px, py, {
                    count: 30, spread: 220, life: 0.9,
                    color: '#88dd44', color2: '#2a6a1a', size: 5
                });
                // 持續冒泡 2 秒
                const bubbleTimer = setInterval(() => {
                    if (!game.mp.active) { clearInterval(bubbleTimer); return; }
                    for (let i = 0; i < 4; i++) {
                        const a = Math.random() * Math.PI * 2;
                        const rr = Math.random() * 90;
                        window.Particles.spawn({
                            x: px + Math.cos(a) * rr,
                            y: py + Math.sin(a) * rr,
                            vx: 0, vy: -30 - Math.random() * 30,
                            life: 0.8, size: 4 + Math.random() * 3,
                            color: '#88dd44', color2: '#2a6a1a', drag: 0.95
                        });
                    }
                }, 120);
                setTimeout(() => clearInterval(bubbleTimer), 2400);
                break;
            }
            // ---------- 近戰類 ----------
            case 'slash': {
                // 對手朝我方向的弧線斬擊
                const angle = Math.atan2(ty - opp.y, tx - opp.x);
                const reach = 180;
                window.Spells.createMeleeArc(opp.x, opp.y, angle, reach, '#ff5577');
                window.Particles.burst(
                    opp.x + Math.cos(angle) * reach * 0.7,
                    opp.y + Math.sin(angle) * reach * 0.7,
                    { count: 25, spread: 200, life: 0.4, color: '#ff5577', color2: '#ffffff', size: 5 }
                );
                break;
            }
            case 'blooddrain': {
                // 紅色弧線 + 從我往施法者拉的血液粒子 (吸血視覺)
                const angle = Math.atan2(ty - opp.y, tx - opp.x);
                window.Spells.createMeleeArc(opp.x, opp.y, angle, 150, '#aa1122');
                // 血液從目標 (tx,ty) 流回施法者
                for (let s = 0; s < 12; s++) {
                    const t = s / 12;
                    window.Particles.spawn({
                        x: tx + (opp.x - tx) * t,
                        y: ty + (opp.y - ty) * t,
                        vx: (opp.x - tx) * 0.6,
                        vy: (opp.y - ty) * 0.6,
                        life: 0.5, size: 4,
                        color: '#ff4466', color2: '#aa1122', drag: 0.9
                    });
                }
                window.Particles.emitHealGlow(opp.x, opp.y);
                break;
            }
            // ---------- 輔助 / 增益 ----------
            case 'heal': {
                // 對手治療: 綠光 + 治療粒子
                window.Particles.emitHealGlow(opp.x, opp.y);
                window.Spells.createShockwave(opp.x, opp.y, 100, '#aaffaa', 0.6);
                window.Particles.burst(opp.x, opp.y, {
                    count: 20, spread: 140, life: 0.7,
                    color: '#aaffaa', color2: '#ffffff', size: 4
                });
                break;
            }
            case 'shield': {
                // 對手護盾: 藍色球體形成動畫
                window.Particles.emitShieldForm(opp.x, opp.y, 50);
                window.Spells.createShockwave(opp.x, opp.y, 120, '#88ddff', 0.5);
                break;
            }
            case 'teleport': {
                // 對手閃現: 舊位置消散 + 新位置出現
                window.Particles.burst(opp.x, opp.y, {
                    count: 25, spread: 250, life: 0.5,
                    color: '#ddccff', color2: '#ffffff', size: 4
                });
                // 新位置 = ntx, nty
                const nx2 = data.ntx !== undefined ? data.ntx * castWD.w : opp.x;
                const ny2 = data.nty !== undefined ? data.nty * castWD.h : opp.y;
                window.Particles.burst(nx2, ny2, {
                    count: 30, spread: 180, life: 0.6,
                    color: '#ffffff', color2: '#aa88ff', size: 5
                });
                window.Spells.createShockwave(nx2, ny2, 80, '#ddccff', 0.4);
                break;
            }
            case 'summon': {
                // 魔靈召喚: 紫色爆發 + 衝擊波 + 幽靈符號粒子環
                window.Particles.burst(opp.x, opp.y, {
                    count: 45, spread: 280, life: 0.9,
                    color: '#ccaaff', color2: '#ffffff', size: 5
                });
                window.Spells.createShockwave(opp.x, opp.y, 140, '#ccaaff', 0.7);
                window.Spells.createShockwave(opp.x, opp.y, 80, '#ffffff', 0.5);
                // 召喚圓環粒子 (模擬魔法陣)
                for (let i = 0; i < 20; i++) {
                    const a = (i / 20) * Math.PI * 2;
                    window.Particles.spawn({
                        x: opp.x + Math.cos(a) * 70,
                        y: opp.y + Math.sin(a) * 70,
                        vx: Math.cos(a) * 40,
                        vy: Math.sin(a) * 40,
                        life: 1.0, size: 6,
                        color: '#bb88ff', color2: '#ffffff', drag: 0.93
                    });
                }
                break;
            }
            default:
                // 未知技能: 通用粒子效果
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
        startPingLoop();
        startMpRound();
    }

    // Ping 循環: 每 2 秒送一次 ping
    function startPingLoop() {
        stopPingLoop();
        const el = document.getElementById('mp-ping-display');
        if (el) {
            el.classList.remove('hidden');
            el.textContent = 'Ping: -- ms';
            el.classList.remove('ping-good', 'ping-mid', 'ping-bad');
        }
        game.mp.lastPongAt = performance.now();
        game.mp.pingInterval = setInterval(() => {
            if (!window.Multiplayer || !window.Multiplayer.isConnected()) return;
            window.Multiplayer.send({ type: 'ping', t: performance.now() });
            // 若超過 6 秒沒回應 pong, 顯示 timeout
            if (game.mp.lastPongAt && performance.now() - game.mp.lastPongAt > 6000) {
                const pel = document.getElementById('mp-ping-display');
                if (pel) {
                    pel.textContent = 'Ping: 斷線?';
                    pel.classList.remove('ping-good', 'ping-mid');
                    pel.classList.add('ping-bad');
                }
            }
        }, 2000);
        // 立刻發一次
        if (window.Multiplayer.isConnected()) {
            window.Multiplayer.send({ type: 'ping', t: performance.now() });
        }
    }
    function stopPingLoop() {
        if (game.mp.pingInterval) {
            clearInterval(game.mp.pingInterval);
            game.mp.pingInterval = null;
        }
        const el = document.getElementById('mp-ping-display');
        if (el) el.classList.add('hidden');
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
        // brawl: 地圖 = 大世界 (2400x1800), 攝影機跟隨玩家
        // 其他模式: 地圖 = 畫布
        const isBrawlInit = mp.teamMode === 'brawl';
        const mapW = isBrawlInit ? BRAWL_WORLD_W : size.w;
        const mapH = isBrawlInit ? BRAWL_WORLD_H : size.h;
        const abs = window.Maps.getAbs(mp.mapId, mapW, mapH);
        mp.obstacles = abs ? abs.obstacles : [];
        // 重置攝影機
        game.camera.x = 0;
        game.camera.y = 0;
        game.player.maxHp = 100 + game.statUpgrades.hp * 10;
        game.player.maxMp = 100 + game.statUpgrades.mp * 10;
        game.player.hp = game.player.maxHp;
        game.player.mp = game.player.maxMp;
        game.player.shieldActive = false;
        game.player.shieldBlocks = 0;
        game.player.shieldTimer = 0;
        // 自己 slot / team 決定位置
        const is2v2 = mp.teamMode === '2v2';
        const isBrawl = mp.teamMode === 'brawl';
        const myTeam = mp.myTeam || 0;
        // brawl: 8+ 個散佈的生點, 依 slot % 長度分配
        const brawlSpawns = [
            [0.12, 0.15],  // 左上
            [0.88, 0.15],  // 右上
            [0.12, 0.85],  // 左下
            [0.88, 0.85],  // 右下
            [0.50, 0.10],  // 上中
            [0.50, 0.90],  // 下中
            [0.05, 0.50],  // 左中
            [0.95, 0.50],  // 右中
            [0.30, 0.30],  // 左上偏中
            [0.70, 0.30],  // 右上偏中
            [0.30, 0.70],  // 左下偏中
            [0.70, 0.70]   // 右下偏中
        ];
        const spawnPositionsByTeam = is2v2 ? {
            0: [[0.15, 0.35], [0.15, 0.75]],
            1: [[0.85, 0.35], [0.85, 0.75]]
        } : {
            0: [[0.18, 0.5]],
            1: [[0.82, 0.5]]
        };
        if (isBrawl) {
            // 大世界內的生點比例
            const myPos = brawlSpawns[mp.mySlot % brawlSpawns.length];
            game.player.x = BRAWL_WORLD_W * myPos[0];
            game.player.y = BRAWL_WORLD_H * myPos[1];
            // 攝影機立刻置中對準玩家 (避免從 0,0 滑向玩家造成鏡頭飛)
            game.camera.x = Math.max(0, Math.min(BRAWL_WORLD_W - size.w, game.player.x - size.w / 2));
            game.camera.y = Math.max(0, Math.min(BRAWL_WORLD_H - size.h, game.player.y - size.h / 2));
            // 初始化 brawl 計分 + 復活狀態
            mp.brawlKills = {};
            mp.respawnTimer = 0;
            for (const s in mp.players) {
                const p = mp.players[s];
                p.hp = 100; p.maxHp = 100; p.alive = true; p.hitFlash = 0;
                const pos = brawlSpawns[p.slot % brawlSpawns.length];
                p.x = BRAWL_WORLD_W * pos[0];
                p.y = BRAWL_WORLD_H * pos[1];
            }
        } else {
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
        }
        // 1v1 兼容 opponent
        mp.opponent.x = mp.isHost ? size.w * 0.82 : size.w * 0.18;
        mp.opponent.y = size.h * 0.5;
        mp.opponent.hp = 100;
        mp.opponent.maxHp = 100;
        mp.opponent.alive = true;
        // 若 spawn 點正好與障礙物重疊, 立刻推出
        resolveObstacleCollisions();
        // 重置冷卻/效果
        for (const k in game.cooldowns) game.cooldowns[k] = 0;
        window.Particles.clear();
        window.Spells.clearAll();
        window.Enemies.clearProjectiles();
        game.damageNumbers.length = 0;
        game.traps = [];
        game.pickups = [];
        game.activeBuffs = {};
        game.allies.length = 0;
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
        // 大亂鬥: 顯示擊殺計分 HUD, 隱藏復活倒數
        const brawlScoreEl = document.getElementById('brawl-score');
        const brawlRespawnEl = document.getElementById('brawl-respawn');
        if (isBrawl) {
            if (brawlScoreEl) brawlScoreEl.classList.remove('hidden');
            if (brawlRespawnEl) brawlRespawnEl.classList.add('hidden');
            updateBrawlHud();
            showMpBanner('進入大亂鬥戰場! 自由廝殺, 比擊殺數', 2.5);
        } else {
            if (brawlScoreEl) brawlScoreEl.classList.add('hidden');
            if (brawlRespawnEl) brawlRespawnEl.classList.add('hidden');
            showMpBanner(`第 ${mp.roundNum} 回合  ${mp.myWins}-${mp.oppWins}`, 1.5);
        }
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
        mp.paused = false;
        stopPingLoop();
        document.getElementById('mp-pause-menu').classList.add('hidden');
        // 隱藏大亂鬥 HUD
        const brawlScoreEl = document.getElementById('brawl-score');
        const brawlRespawnEl = document.getElementById('brawl-respawn');
        if (brawlScoreEl) brawlScoreEl.classList.add('hidden');
        if (brawlRespawnEl) brawlRespawnEl.classList.add('hidden');
        game.state = 'menu';
        let stats;
        if (mp.teamMode === 'brawl') {
            const myKills = mp.brawlKills[mp.mySlot] || 0;
            stats = {
                '你的擊殺數': myKills,
                '地圖': window.Maps.get(mp.mapId) ? window.Maps.get(mp.mapId).name : '?'
            };
            // 列出所有玩家擊殺排行
            const ranks = [];
            ranks.push({ name: '你 (' + (game.mp.myName || 'You') + ')', kills: myKills });
            for (const s in mp.players) {
                const p = mp.players[s];
                ranks.push({ name: p.name || 'P' + s, kills: mp.brawlKills[s] || 0 });
            }
            ranks.sort((a, b) => b.kills - a.kills);
            stats['排行榜'] = ranks.map((r, i) => `${i + 1}. ${r.name}: ${r.kills}`).join(' | ');
        } else {
            stats = {
                '最終比數': `${mp.myWins} - ${mp.oppWins}`,
                '地圖': window.Maps.get(mp.mapId) ? window.Maps.get(mp.mapId).name : '?',
                '回合制': 'BO' + mp.rounds
            };
        }
        if (reason === 'forfeit' || reason === 'forfeit-opp-leave') stats['結束'] = '對手離線';
        document.getElementById('mp-result-title').textContent = title;
        let html = '';
        for (const k in stats) {
            // Safe: stats values set locally, not from network (except opponent names which are already escaped upstream)
            const val = String(stats[k]).replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' })[c]);
            html += `<div>${k}: <span class="stat-value">${val}</span></div>`;
        }
        document.getElementById('mp-result-stats').innerHTML = html;
        document.getElementById('mp-result').classList.remove('hidden');
        const won = mp.teamMode === 'brawl' ? (mp.brawlKills[mp.mySlot] || 0) >= mp.brawlKillLimit : mp.myWins > mp.oppWins;
        window.UI.playSfx(won ? 'victory' : 'defeat');
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
        game._loadoutBackScreen = window.UI.getCurrentScreen();
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
        // 若存檔有先前進度, 從保存波次繼續 (wave 會在 updateInfiniteWaves 中 +1)
        game.wave = game.infiniteSavedWave > 0 ? (game.infiniteSavedWave - 1) : 0;
        game.nextWaveDelay = 1.5;
        commonLevelStart();
        game.waves = [];
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
        game.goldAtLevelStart = game.gold; // 用於結算顯示「本場賺取金幣」
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
        game.allies.length = 0;
        // 關卡/無限模式皆放置陷阱: 關卡越後越多, 無限視波次
        const trapCount = game.infinite
            ? Math.min(6, 1 + Math.floor((game.wave || 0) / 3))
            : Math.min(6, Math.floor((game.level || 1) / 2));
        if (trapCount > 0) seedTraps(trapCount);
        window.UI.buildCooldownIcons(window.Spells.CONFIG, game.loadout);
        window.UI.updateHUD(getHudState());
        window.UI.startBgm();
        window.UI.showControlsHint(true);
        // 確保單人模式不顯示 MP / brawl HUD (避免從 brawl 切回 SP 殘留)
        const pingEl = document.getElementById('mp-ping-display');
        const brawlScoreEl = document.getElementById('brawl-score');
        const brawlRespawnEl = document.getElementById('brawl-respawn');
        if (pingEl) pingEl.classList.add('hidden');
        if (brawlScoreEl) brawlScoreEl.classList.add('hidden');
        if (brawlRespawnEl) brawlRespawnEl.classList.add('hidden');
    }

    function endLevel(victory) {
        game.state = victory ? 'victory' : 'defeat';
        window.UI.playSfx(victory ? 'victory' : 'defeat');

        const avgAcc = game.spellsCast ? Math.round(game.totalAccuracy / game.spellsCast * 100) : 0;
        const timeSec = Math.round((performance.now() - game.levelStartTime) / 1000);

        if (game.infinite) {
            // 無限模式只有失敗 — 死亡後清除儲存的進度
            game.infiniteSavedWave = 0;
            saveProgress();
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
        }
        // 本場賺取金幣 = 擊殺金幣 + 關卡獎勵 (失敗時無關卡獎勵, 但擊殺金幣仍算)
        const earnedGold = Math.max(0, game.gold - (game.goldAtLevelStart || 0));
        // 無論勝敗都存檔, 避免失敗時擊殺金幣遺失
        saveProgress();
        let earnedDisplay = earnedGold + ' G';
        if (clearBonus > 0) earnedDisplay += ' (含關卡獎勵 ' + clearBonus + ')';
        const stats = {
            '擊殺數': game.kills,
            '施法次數': game.spellsCast,
            '平均準確度': avgAcc + '%',
            '最終分數': game.score,
            '獲得金幣': earnedDisplay,
            '總金幣': game.gold + ' G',
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
        updateAllies(dt);

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
        renderAllies(ctx);
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
            ctx.strokeText('[你] ' + game.mp.myName, px, py - r * 1.55);
            ctx.fillText('[你] ' + game.mp.myName, px, py - r * 1.55);
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
        // 安全: 對戰未進行時不做任何事 (rematch 後進入 mp-room 時避免殘留邏輯)
        if (!mp.active) return;
        // bug fix: 暫停時必須真正凍結模擬 (之前只停輸入, 敵人/岩漿/狀態封包仍在跑)
        if (mp.paused) return;

        // 大亂鬥: 攝影機 lerp 追隨玩家 (角色固定視角)
        if (mp.teamMode === 'brawl') {
            const sz = cachedSize;
            const targetX = game.player.x - sz.w / 2;
            const targetY = game.player.y - sz.h / 2;
            game.camera.x += (targetX - game.camera.x) * 0.18;
            game.camera.y += (targetY - game.camera.y) * 0.18;
            game.camera.x = Math.max(0, Math.min(BRAWL_WORLD_W - sz.w, game.camera.x));
            game.camera.y = Math.max(0, Math.min(BRAWL_WORLD_H - sz.h, game.camera.y));
        }

        // 大亂鬥: 復活倒數
        if (mp.teamMode === 'brawl' && mp.respawnTimer > 0) {
            mp.respawnTimer -= dt;
            // 更新復活倒數顯示
            const respEl = document.getElementById('brawl-respawn');
            if (respEl) {
                respEl.classList.remove('hidden');
                respEl.textContent = '復活倒數: ' + Math.ceil(mp.respawnTimer) + ' 秒';
            }
            if (mp.respawnTimer <= 0) {
                if (respEl) respEl.classList.add('hidden');
                finishBrawlRespawn();
            }
            // 死亡期間不跑玩家更新邏輯 (但依然接收訊息)
            return;
        }

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
        updatePlayerMovement(dt);
        // 障礙物碰撞: 使用「推出」演算法 (若重疊, 推到最近邊緣)
        // 這樣玩家不會卡在障礙物內, 還能沿著邊緣滑動
        resolveObstacleCollisions();

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
                nx: target.x / cachedSize.w,
                ny: target.y / cachedSize.h,
                target: targetSlot
            });
            spawnDamageNumber(target.x, target.y, damage, proj.critical);
            applyLocalDamageToTarget(target, damage);
            triggerShake(proj.critical ? 5 : 2, 0.1);
            window.UI.playSfx('hit');
        };
        window.Spells.updateProjectiles(dt, enemyTargets, handleHit);
        window.Spells.updateMeteors(dt, enemyTargets, (proj, target) => {
            const damage = proj.damage;
            window.Multiplayer.send({
                type: 'hit', damage: damage, spell: 'meteor',
                nx: target.x / cachedSize.w,
                ny: target.y / cachedSize.h,
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
                nx: target.x / cachedSize.w,
                ny: target.y / cachedSize.h,
                target: target._slot
            });
            spawnDamageNumber(target.x, target.y - 10, damage, false);
            applyLocalDamageToTarget(target, damage);
        });
        window.Spells.updateShockwaves(dt);
        window.Spells.updateMeleeArcs(dt);
        updateDamageNumbers(dt);
        updateAllies(dt);

        // 投射物與障礙物碰撞
        window.Spells.checkProjectilesVsObstacles(mp.obstacles, window.Maps.pointInObstacle);

        window.Particles.update(dt);

        // 送自身狀態 (~20hz) — 名稱不放這裡 (由 lobby 廣播授權, 避免蓋掉去重後的名稱)
        mp.sendTimer += dt;
        if (mp.sendTimer > 0.05) {
            mp.sendTimer = 0;
            const wd = getWorldDims();
            window.Multiplayer.send({
                type: 'state',
                slot: mp.mySlot,
                nx: game.player.x / wd.w,
                ny: game.player.y / wd.h,
                hp: game.player.hp, maxHp: game.player.maxHp
            });
        }

        // 本地死亡 → 輸這回合
        if (game.player.hp <= 0 && mp.roundState === 'playing') {
            localRoundDecided(false);
        }

        window.UI.updateHUD(getHudState());
    }

    // 障礙物碰撞解決: 每幀結束後, 若玩家與任何障礙物重疊, 把他推出到邊緣
    // 相較於「撞到就還原」, 此做法:
    //   1. 不會卡在障礙物內 (任何時刻都會被推出)
    //   2. 能自然滑過障礙物邊緣 (推出方向永遠遠離障礙物中心)
    //   3. 若 spawn 時位置卡住也能自動解開
    function resolveObstacleCollisions() {
        const obs = game.mp.obstacles;
        if (!obs || !obs.length) return;
        const p = game.player;
        // 多次迭代以處理多障礙物堆疊
        for (let iter = 0; iter < 3; iter++) {
            let resolved = true;
            for (let i = 0; i < obs.length; i++) {
                const o = obs[i];
                if (o.passable) continue;
                let nearestX, nearestY, radius2;
                if (o.type === 'circle') {
                    nearestX = o.x;
                    nearestY = o.y;
                    radius2 = o.r;
                } else {
                    // 矩形: 找最近邊緣點
                    nearestX = Math.max(o.x - o.w / 2, Math.min(p.x, o.x + o.w / 2));
                    nearestY = Math.max(o.y - o.h / 2, Math.min(p.y, o.y + o.h / 2));
                    radius2 = 0;
                }
                const dx = p.x - nearestX;
                const dy = p.y - nearestY;
                const distSq = dx * dx + dy * dy;
                const minD = p.radius + radius2;
                if (distSq < minD * minD) {
                    resolved = false;
                    const dist = Math.sqrt(distSq);
                    if (dist < 0.001) {
                        // 完全重疊的退化情況 — 任意方向推出
                        p.x += minD;
                    } else {
                        const push = minD - dist;
                        p.x += (dx / dist) * push;
                        p.y += (dy / dist) * push;
                    }
                }
            }
            if (resolved) break;
        }
        // 確保推出後仍在世界/畫布內 (brawl 用世界尺寸, 其他用畫布)
        const bounds = getWorldDims();
        const margin = p.radius + 10;
        if (p.x < margin) p.x = margin;
        if (p.x > bounds.w - margin) p.x = bounds.w - margin;
        if (p.y < margin) p.y = margin;
        if (p.y > bounds.h - margin) p.y = bounds.h - margin;
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

    // 取得所有敵隊活人 (供投射物碰撞用)
    // 1v1: 單一對手; 2v2: 敵隊 2 人; brawl: 所有其他存活玩家
    function getEnemyTargets() {
        const mp = game.mp;
        if (mp.teamMode === '2v2' || mp.teamMode === 'brawl') {
            const arr = [];
            const isFfa = mp.teamMode === 'brawl';
            for (const s in mp.players) {
                const p = mp.players[s];
                if (!p.alive || p.hp <= 0) continue;
                // brawl: 所有其他玩家都是敵人; 2v2: 只有敵隊
                if (isFfa || p.team !== mp.myTeam) {
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
        if (target._slot !== undefined && (mp.teamMode === '2v2' || mp.teamMode === 'brawl')) {
            const p = mp.players[target._slot];
            if (p) {
                const prevHp = p.hp;
                p.hp = Math.max(0, p.hp - damage);
                p.hitFlash = 1;
                if (p.hp <= 0 && prevHp > 0) {
                    p.alive = false;
                    if (mp.teamMode === 'brawl') {
                        // 大亂鬥: 我擊殺, 記我的計分 + 廣播
                        onBrawlKill(mp.mySlot, p.slot);
                    }
                }
                if (mp.teamMode === '2v2') checkTeamsAndMaybeEndRound();
            }
        } else {
            mp.opponent.hp = Math.max(0, mp.opponent.hp - damage);
            mp.opponent.hitFlash = 1;
            if (mp.opponent.hp <= 0 && mp.roundState === 'playing') localRoundDecided(true);
        }
    }

    // 大亂鬥: 我擊殺一人, 更新計分 + 廣播 (沒有勝負, 無限對戰)
    function onBrawlKill(killerSlot, victimSlot) {
        const mp = game.mp;
        mp.brawlKills[killerSlot] = (mp.brawlKills[killerSlot] || 0) + 1;
        window.Multiplayer.send({ type: 'brawlKill', killer: killerSlot, victim: victimSlot });
        updateBrawlHud();
        const myKills = mp.brawlKills[mp.mySlot] || 0;
        showMpBanner(`擊殺! 當前 ${myKills} 殺`, 1.2);
    }

    // 大亂鬥: 更新 HUD 擊殺計分 — 排行榜式 (依擊殺數排序)
    function updateBrawlHud() {
        const mp = game.mp;
        if (mp.teamMode !== 'brawl') return;
        const el = document.getElementById('brawl-score');
        if (!el) return;
        const myKills = mp.brawlKills[mp.mySlot] || 0;
        const ranks = [{
            name: '你',
            kills: myKills,
            isSelf: true
        }];
        for (const s in mp.players) {
            const p = mp.players[s];
            ranks.push({
                name: String(p.name || ('P' + s)).replace(/[<>&"']/g, ''),
                kills: mp.brawlKills[s] || 0,
                isSelf: false
            });
        }
        ranks.sort((a, b) => b.kills - a.kills);
        const total = ranks.length;
        const lines = ['<div class="brawl-header">排行榜 (' + total + ' 人)</div>'];
        ranks.slice(0, 8).forEach((r, i) => {
            const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : ''));
            lines.push(
                '<div class="brawl-row' + (r.isSelf ? ' self' : '') + '">' +
                (medal || (i + 1)) + ' ' + r.name + ': ' + r.kills +
                '</div>'
            );
        });
        el.innerHTML = lines.join('');
    }

    // 大亂鬥: 我死了 → 啟動 3 秒復活倒數
    function startBrawlRespawn() {
        const mp = game.mp;
        mp.respawnTimer = mp.respawnMax;
        // 傳送我已死訊息讓其他人知道我不在場
        const wd1 = getWorldDims();
        window.Multiplayer.send({ type: 'state', slot: mp.mySlot, hp: 0, maxHp: game.player.maxHp,
            nx: game.player.x / wd1.w, ny: game.player.y / wd1.h });
        showMpBanner(`你死了! 3 秒後復活...`, 2.5);
    }

    function finishBrawlRespawn() {
        const mp = game.mp;
        // 隨機生點 (12 點散佈在大世界)
        const spawns = [
            [0.12, 0.15], [0.88, 0.15], [0.12, 0.85], [0.88, 0.85],
            [0.50, 0.10], [0.50, 0.90], [0.05, 0.50], [0.95, 0.50],
            [0.30, 0.30], [0.70, 0.30], [0.30, 0.70], [0.70, 0.70]
        ];
        const pick = spawns[Math.floor(Math.random() * spawns.length)];
        game.player.x = BRAWL_WORLD_W * pick[0];
        game.player.y = BRAWL_WORLD_H * pick[1];
        game.player.hp = game.player.maxHp;
        game.player.mp = game.player.maxMp;
        game.player.shieldActive = false;
        game.player.shieldBlocks = 0;
        game.invulnerableUntil = performance.now() + 1500; // 1.5 秒復活無敵
        mp.respawnTimer = 0;
        // 立刻廣播新位置
        const wd2 = getWorldDims();
        window.Multiplayer.send({
            type: 'state',
            slot: mp.mySlot,
            nx: game.player.x / wd2.w,
            ny: game.player.y / wd2.h,
            hp: game.player.hp,
            maxHp: game.player.maxHp
        });
        showMpBanner('復活!', 1.0);
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

        const isBrawl = game.mp.teamMode === 'brawl';
        if (isBrawl) {
            // 大亂鬥: 整個世界 (背景 + 實體) 套用攝影機偏移
            ctx.save();
            ctx.translate(-game.camera.x, -game.camera.y);
            window.Maps.drawBackground(game.mp.mapId, ctx, BRAWL_WORLD_W, BRAWL_WORLD_H);
            window.Maps.drawObstacles(game.mp.obstacles, ctx);
            window.Spells.renderPoisonFields(ctx);
            drawPlayer();
            for (const s in game.mp.players) {
                drawOtherPlayer(game.mp.players[s]);
            }
            window.Spells.renderProjectiles(ctx);
            window.Spells.renderMeteors(ctx);
            window.Spells.renderLightning(ctx);
            window.Spells.renderShockwaves(ctx);
            window.Spells.renderMeleeArcs(ctx);
            renderAllies(ctx);
            window.Particles.render(ctx);
            renderDamageNumbers(ctx);
            ctx.restore();
            // trail 用畫布座標 (不隨攝影機)
            renderTrail(ctx);
            // 小地圖
            drawBrawlMinimap(ctx, w, h);
        } else {
            // 1v1 / 2v2: 畫布就是世界
            window.Maps.drawBackground(game.mp.mapId, ctx, w, h);
            window.Maps.drawObstacles(game.mp.obstacles, ctx);
            window.Spells.renderPoisonFields(ctx);
            drawPlayer();
            if (game.mp.teamMode === '2v2') {
                for (const s in game.mp.players) {
                    drawOtherPlayer(game.mp.players[s]);
                }
            } else {
                drawOpponent();
            }
            window.Spells.renderProjectiles(ctx);
            window.Spells.renderMeteors(ctx);
            window.Spells.renderLightning(ctx);
            window.Spells.renderShockwaves(ctx);
            window.Spells.renderMeleeArcs(ctx);
            renderAllies(ctx);
            window.Particles.render(ctx);
            renderDamageNumbers(ctx);
            renderTrail(ctx);
        }

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
            ctx.strokeText('[敵] ' + o.name, px, py - r * 1.55);
            ctx.fillText('[敵] ' + o.name, px, py - r * 1.55);
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
        const label = (isEnemy ? '[敵] ' : '[友] ') + (p.name || ('Slot' + p.slot));
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

    // 大亂鬥小地圖 — 右上角, 顯示世界全貌 + 玩家位置
    function drawBrawlMinimap(ctx, canvasW, canvasH) {
        const mapSize = 150;
        const margin = 12;
        const mapH = mapSize * (BRAWL_WORLD_H / BRAWL_WORLD_W);
        // 放在右上角, 避開頂部 HUD 和排行榜 (排行榜在 top:90px, 右對齊)
        const x = canvasW - mapSize - margin;
        const y = canvasH - mapH - margin - 140; // 避開底部冷卻列
        ctx.save();
        ctx.fillStyle = 'rgba(10, 5, 20, 0.78)';
        ctx.fillRect(x, y, mapSize, mapH);
        ctx.strokeStyle = 'rgba(200, 140, 80, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, mapSize, mapH);
        // 視野方框
        const camW = cachedSize.w / BRAWL_WORLD_W * mapSize;
        const camH = cachedSize.h / BRAWL_WORLD_H * mapH;
        const camX = x + game.camera.x / BRAWL_WORLD_W * mapSize;
        const camY = y + game.camera.y / BRAWL_WORLD_H * mapH;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.strokeRect(camX, camY, camW, camH);
        // 其他玩家 (紅點)
        ctx.fillStyle = '#ff6688';
        for (const s in game.mp.players) {
            const p = game.mp.players[s];
            if (!p.alive || p.hp <= 0) continue;
            const px = x + (p.x / BRAWL_WORLD_W) * mapSize;
            const py = y + (p.y / BRAWL_WORLD_H) * mapH;
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        // 自己 (綠點)
        const meX = x + (game.player.x / BRAWL_WORLD_W) * mapSize;
        const meY = y + (game.player.y / BRAWL_WORLD_H) * mapH;
        ctx.fillStyle = '#66ff88';
        ctx.beginPath();
        ctx.arc(meX, meY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function renderMpHpBars(ctx, w) {
        const mp = game.mp;
        // brawl: 頂部 HUD 已顯示 HP, 不重複畫; 排行榜由 #brawl-score 處理
        if (mp.teamMode === 'brawl') return;
        const barW = 260, barH = 16;
        // 我方 (左上)
        drawMpBar(ctx, 20, 70, barW, barH, game.player.hp / game.player.maxHp, '#66ff88', `你  ${Math.ceil(game.player.hp)}/${game.player.maxHp}`);
        // 1v1 只有一個對手, 畫 HP 條 + 比數
        if (mp.teamMode === '1v1') {
            drawMpBar(ctx, w - barW - 20, 70, barW, barH, mp.opponent.hp / mp.opponent.maxHp, '#ff6688', `對手  ${Math.ceil(mp.opponent.hp)}/${mp.opponent.maxHp}`);
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
        } else if (mp.teamMode === '2v2') {
            // 2v2 只顯示比數 (對手 HP 在 drawOtherPlayer 中畫)
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
        // brawl 不在這裡顯示任何東西, 排行榜由 #brawl-score DOM 處理
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
        game.state = 'practice';
        practice.state = 'ready';
        practice.targetRune = 'fireball';
        practice.lastResult = null;
        practice.lastTrail = null;
        practice.lastMatch = false;
        // 依當前符文清單動態建立練習按鈕 (加入新符文時自動出現)
        buildPracticeButtons();
        window.UI.showScreen('practice-screen');
        resizeCanvas();
        setPracticeTarget('fireball');
        window.Particles.clear();
    }

    function buildPracticeButtons() {
        const container = document.getElementById('practice-controls');
        if (!container) return;
        if (container.children.length > 0 && container.dataset.built) return;
        container.innerHTML = '';
        for (const key in window.Spells.CONFIG) {
            const cfg = window.Spells.CONFIG[key];
            const btn = document.createElement('button');
            btn.className = 'practice-btn';
            btn.dataset.rune = key;
            btn.textContent = cfg.name;
            btn.addEventListener('click', () => {
                setPracticeTarget(key);
                window.UI.playSfx('ui');
            });
            container.appendChild(btn);
        }
        container.dataset.built = '1';
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
            game.menuContext = 'mp';
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
                const isBrawl = game.mp.teamMode === 'brawl';
                // 大亂鬥: 強制用 brawl 地圖 + rounds=1 (無回合制)
                const mapId = isBrawl ? 'brawl' : document.getElementById('mp-map-select').value;
                const rounds = isBrawl ? 1 : parseInt(document.getElementById('mp-rounds-select').value, 10);
                game.mp.mapId = mapId;
                game.mp.rounds = rounds;
                window.Multiplayer.send({ type: 'start', mapId: mapId, rounds: rounds, teamMode: game.mp.teamMode });
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

        // 多人暫停選單
        const mpResume = document.getElementById('mp-resume-btn');
        const mpSurrender = document.getElementById('mp-surrender-btn');
        const mpLeaveMatch = document.getElementById('mp-leave-match-btn');
        if (mpResume) mpResume.addEventListener('click', () => {
            window.UI.playSfx('ui');
            toggleMpPause();
        });
        if (mpSurrender) mpSurrender.addEventListener('click', () => {
            window.UI.playSfx('ui');
            surrenderMp();
        });
        if (mpLeaveMatch) mpLeaveMatch.addEventListener('click', () => {
            window.UI.playSfx('ui');
            document.getElementById('mp-pause-menu').classList.add('hidden');
            const isBrawl = game.mp.teamMode === 'brawl';
            leaveMp();
            // brawl: 離開後直接回主畫面, 不停留在 mp-mode-select
            if (isBrawl) window.UI.showScreen('main-menu');
        });

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

        // 練習按鈕改為動態生成 (buildPracticeButtons) 時掛事件, 這裡不再處理

        document.getElementById('pause-btn').addEventListener('click', () => {
            if (game.state === 'playing') {
                game.state = 'paused';
                document.getElementById('pause-menu').classList.remove('hidden');
            } else if (game.state === 'pvp' && game.mp.active) {
                toggleMpPause();
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
                } else if (game.state === 'pvp' && game.mp.active) {
                    toggleMpPause();
                }
            }
        });
    }

    function toggleMpPause() {
        const modal = document.getElementById('mp-pause-menu');
        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            game.mp.paused = true;
            // 大亂鬥: 隱藏「投降」, 「離開房間」改為「回到主畫面」
            const isBrawl = game.mp.teamMode === 'brawl';
            const surrenderBtn = document.getElementById('mp-surrender-btn');
            const leaveBtn = document.getElementById('mp-leave-match-btn');
            const noteEl = modal.querySelector('.mp-pause-note');
            if (surrenderBtn) surrenderBtn.style.display = isBrawl ? 'none' : '';
            if (leaveBtn) leaveBtn.textContent = isBrawl ? '回到主畫面' : '離開房間';
            if (noteEl) noteEl.textContent = isBrawl ? '大亂鬥: 可隨時離開返回主選單' : '對戰仍會進行, 建議速戰速決';
        } else {
            modal.classList.add('hidden');
            game.mp.paused = false;
        }
    }

    function surrenderMp() {
        if (!game.mp.active) return;
        const mp = game.mp;
        // 含自身 slot/team 以便 2v2 判定是隊友還是對手投降
        window.Multiplayer.send({ type: 'surrender', slot: mp.mySlot, team: mp.myTeam });
        const need = Math.ceil(mp.rounds / 2);
        mp.oppWins = Math.max(mp.oppWins, need);
        mp.paused = false;
        document.getElementById('mp-pause-menu').classList.add('hidden');
        endMpMatch('你投降了...', 'surrender');
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
            case 'sp-menu':
                game.menuContext = 'sp';
                window.UI.showScreen('sp-menu');
                break;
            case 'multiplayer':
                // 先輸入名稱 → 確認後才進入多人子選單
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
            case 'mp-mode-brawl':
                // 大亂鬥: 選完技能 → 直接自動加入公開戰場, 不用建房
                game.mp.teamMode = 'brawl';
                game.mp.mapId = 'brawl';
                game.mp.rounds = 1;
                openLoadout(() => { autoJoinBrawl(); }, true);
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
            case 'back-to-menu': {
                const current = window.UI.getCurrentScreen();
                // 頂層子選單 / 名稱畫面 → 回主選單
                if (current === 'sp-menu' || current === 'mp-mode-select' || current === 'mp-name-screen') {
                    window.UI.showScreen('main-menu');
                    game.state = 'menu';
                    game.menuContext = null;
                    window.UI.stopBgm();
                    window.UI.showControlsHint(false);
                    break;
                }
                // Loadout 畫面 → 取消 continuation + 回上層
                if (current === 'loadout-screen') {
                    game._loadoutContinuation = null;
                    game._loadoutMpMode = false;
                    const back = game._loadoutBackScreen || (game.menuContext === 'mp' ? 'mp-mode-select' : 'sp-menu');
                    window.UI.showScreen(back);
                    break;
                }
                // 多人連線 Lobby → 回多人子選單
                if (current === 'mp-lobby') {
                    if (window.Multiplayer) window.Multiplayer.disconnect();
                    window.UI.showScreen('mp-mode-select');
                    break;
                }
                // 商城 / 技能 / 關卡選擇 → 回單人子選單
                if (current === 'shop-screen' || current === 'skills-screen' || current === 'level-select') {
                    window.UI.showScreen('sp-menu');
                    break;
                }
                // 共用畫面 (符文練習 / 圖鑑 / 設定) → 依 context 回對應子選單
                // 若從主選單直接進 (context = null), 回主選單
                let target;
                if (game.menuContext === 'mp') target = 'mp-mode-select';
                else if (game.menuContext === 'sp') target = 'sp-menu';
                else target = 'main-menu';
                window.UI.showScreen(target);
                game.state = 'menu';
                window.UI.stopBgm();
                window.UI.showControlsHint(false);
                break;
            }
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
            case 'quit': {
                document.getElementById('pause-menu').classList.add('hidden');
                window.UI.hideResult();
                window.UI.hideUpgrade();
                // 無限模式中途退出: 記住當前波次
                if (game.infinite && game.wave > 0 && game.player.hp > 0) {
                    game.infiniteSavedWave = game.wave;
                    saveProgress();
                }
                const target = game.menuContext === 'mp'
                    ? 'mp-mode-select'
                    : (game.menuContext === 'sp' ? 'sp-menu' : 'main-menu');
                window.UI.showScreen(target);
                game.state = 'menu';
                window.UI.stopBgm();
                window.UI.showControlsHint(false);
                break;
            }
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
