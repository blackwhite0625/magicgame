/* ================================================================
   ui.js — UI 管理
   - 畫面切換 (主選單 / 遊戲 / 練習 / 設定 / 圖鑑)
   - HUD 更新 (HP / MP / 分數 / 冷卻)
   - 符文識別結果彈跳顯示
   - 簡易音效封裝 (使用 WebAudio 合成音, 不依賴外部檔案)
   ================================================================ */

(function (global) {
    'use strict';

    const UI = {};

    // ==== 畫面切換 ====
    const screens = {};
    let currentScreen = null;

    function registerScreens() {
        document.querySelectorAll('.screen').forEach(el => {
            screens[el.id] = el;
        });
    }

    function showScreen(id) {
        for (const k in screens) {
            screens[k].classList.remove('active');
        }
        if (screens[id]) {
            screens[id].classList.add('active');
            currentScreen = id;
        }
    }

    UI.showScreen = showScreen;
    UI.getCurrentScreen = () => currentScreen;

    // ==== 音效 (WebAudio 合成) ====
    // 使用震盪器合成簡易音效，不需載入外部檔案。
    // 若要換成真實音檔，將 playSfx() 換成 Audio 物件播放即可。
    let audioCtx = null;
    let sfxVolume = 0.7;
    let bgmVolume = 0.5;

    function getAudio() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn('WebAudio 不支援', e);
            }
        }
        return audioCtx;
    }

    /**
     * 播放合成音效
     * @param {string} type - 'fireball' | 'lightning' | 'icespike' | 'heal' | 'shield' | 'meteor' | 'hit' | 'recognize' | 'fail'
     */
    function playSfx(type) {
        const ctx = getAudio();
        if (!ctx || sfxVolume <= 0) return;
        const now = ctx.currentTime;

        switch (type) {
            case 'fireball': {
                // 快速膨脹 + 爆聲
                tone(ctx, now, 220, 0.25, 'sawtooth', 0.4, 110);
                tone(ctx, now + 0.05, 440, 0.15, 'sawtooth', 0.2, 180);
                noise(ctx, now, 0.12, 0.25);
                break;
            }
            case 'lightning': {
                tone(ctx, now, 1400, 0.1, 'square', 0.35, 160);
                tone(ctx, now + 0.04, 1800, 0.08, 'sawtooth', 0.25, 300);
                noise(ctx, now, 0.18, 0.3);
                break;
            }
            case 'icespike': {
                tone(ctx, now, 700, 0.22, 'triangle', 0.35, 350);
                tone(ctx, now + 0.04, 1400, 0.15, 'sine', 0.2, 900);  // 晶響
                break;
            }
            case 'heal': {
                tone(ctx, now, 523, 0.3, 'sine', 0.35, 523);
                tone(ctx, now + 0.1, 659, 0.3, 'sine', 0.3, 659);
                tone(ctx, now + 0.2, 784, 0.45, 'sine', 0.25, 784);
                tone(ctx, now + 0.3, 1047, 0.4, 'sine', 0.2, 1047);
                break;
            }
            case 'shield': {
                tone(ctx, now, 440, 0.35, 'triangle', 0.3, 660);
                tone(ctx, now + 0.1, 660, 0.3, 'sine', 0.2, 880);
                break;
            }
            case 'meteor': {
                tone(ctx, now, 120, 0.9, 'sawtooth', 0.5, 40);
                tone(ctx, now + 0.2, 80, 1.1, 'sawtooth', 0.4, 30);
                noise(ctx, now, 0.6, 0.4);
                noise(ctx, now + 0.8, 0.5, 0.35);  // 撞擊音
                break;
            }
            case 'wind': {
                // 持續雜訊高通 + 上掃
                noise(ctx, now, 0.35, 0.4);
                tone(ctx, now, 400, 0.3, 'triangle', 0.2, 1200);
                break;
            }
            case 'poison': {
                // 低頻冒泡
                tone(ctx, now, 160, 0.4, 'sine', 0.35, 220);
                tone(ctx, now + 0.15, 200, 0.3, 'sine', 0.25, 140);
                tone(ctx, now + 0.3, 180, 0.35, 'sine', 0.2, 260);
                break;
            }
            case 'teleport': {
                // 快速上掃 + 短閃
                tone(ctx, now, 300, 0.15, 'sine', 0.35, 1800);
                tone(ctx, now + 0.08, 1800, 0.2, 'sine', 0.3, 400);
                break;
            }
            case 'holynova': {
                // 亮和弦 + 鐘聲
                tone(ctx, now, 523, 0.5, 'sine', 0.35);
                tone(ctx, now, 659, 0.5, 'sine', 0.3);
                tone(ctx, now, 784, 0.5, 'sine', 0.3);
                tone(ctx, now + 0.2, 1047, 0.8, 'sine', 0.35);
                tone(ctx, now + 0.4, 1568, 1.0, 'sine', 0.25);
                break;
            }
            case 'slash': {
                // 快速劃破聲
                tone(ctx, now, 800, 0.1, 'sawtooth', 0.3, 200);
                noise(ctx, now, 0.12, 0.25);
                break;
            }
            case 'groundslam': {
                // 重擊低頻
                tone(ctx, now, 80, 0.5, 'sawtooth', 0.5, 40);
                noise(ctx, now, 0.3, 0.4);
                tone(ctx, now + 0.1, 200, 0.3, 'triangle', 0.3, 50);
                break;
            }
            case 'blooddrain': {
                // 陰森吸取音
                tone(ctx, now, 180, 0.3, 'sawtooth', 0.3, 350);
                tone(ctx, now + 0.1, 350, 0.3, 'sine', 0.25, 180);
                break;
            }
            case 'hit': tone(ctx, now, 150, 0.15, 'square', 0.4, 60); break;
            case 'enemyDie': {
                // 敵人死亡: 下掃短促
                tone(ctx, now, 300, 0.25, 'sawtooth', 0.3, 80);
                noise(ctx, now, 0.1, 0.2);
                break;
            }
            case 'recognize': {
                tone(ctx, now, 660, 0.08, 'sine', 0.3, 880);
                tone(ctx, now + 0.06, 880, 0.12, 'sine', 0.25, 1100);
                break;
            }
            case 'critical': {
                tone(ctx, now, 880, 0.08, 'sine', 0.35, 1100);
                tone(ctx, now + 0.05, 1100, 0.1, 'sine', 0.3, 1320);
                tone(ctx, now + 0.12, 1320, 0.15, 'sine', 0.25, 1760);
                break;
            }
            case 'fail': tone(ctx, now, 180, 0.25, 'sawtooth', 0.25, 80); break;
            case 'playerHurt': {
                tone(ctx, now, 200, 0.2, 'sawtooth', 0.4, 80);
                noise(ctx, now, 0.1, 0.3);
                break;
            }
            case 'victory': {
                tone(ctx, now, 523, 0.2, 'sine', 0.4);
                tone(ctx, now + 0.15, 659, 0.2, 'sine', 0.4);
                tone(ctx, now + 0.3, 784, 0.2, 'sine', 0.4);
                tone(ctx, now + 0.45, 1047, 0.5, 'sine', 0.4);
                break;
            }
            case 'defeat': {
                tone(ctx, now, 330, 0.3, 'sine', 0.4, 220);
                tone(ctx, now + 0.25, 220, 0.3, 'sine', 0.4, 165);
                tone(ctx, now + 0.5, 165, 0.6, 'sine', 0.4, 110);
                break;
            }
            case 'levelUp': {
                // 歡快上升分解和弦
                tone(ctx, now, 523, 0.15, 'sine', 0.35);
                tone(ctx, now + 0.1, 659, 0.15, 'sine', 0.35);
                tone(ctx, now + 0.2, 784, 0.15, 'sine', 0.35);
                tone(ctx, now + 0.3, 1047, 0.4, 'sine', 0.4);
                break;
            }
            case 'coin': {
                // 錢幣: 高頻雙響
                tone(ctx, now, 1400, 0.08, 'square', 0.15, 2200);
                tone(ctx, now + 0.06, 2000, 0.1, 'sine', 0.12, 2600);
                break;
            }
            case 'purchase': {
                // 購買: 硬幣 + 明亮和弦
                tone(ctx, now, 1200, 0.08, 'square', 0.2, 1800);
                tone(ctx, now + 0.1, 784, 0.2, 'sine', 0.3, 784);
                tone(ctx, now + 0.2, 1047, 0.3, 'sine', 0.25, 1047);
                tone(ctx, now + 0.3, 1568, 0.4, 'sine', 0.2);
                break;
            }
            case 'waveComplete': {
                tone(ctx, now, 784, 0.15, 'sine', 0.3);
                tone(ctx, now + 0.08, 1047, 0.25, 'sine', 0.3);
                break;
            }
            case 'ui': tone(ctx, now, 800, 0.06, 'square', 0.15, 1200); break;
        }
    }

    /** 單音震盪器 + 指數衰減 */
    function tone(ctx, startTime, freq, duration, wave, vol, endFreq) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, startTime);
        if (endFreq !== undefined) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), startTime + duration);
        }
        gain.gain.setValueAtTime(vol * sfxVolume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.05);
    }

    /** 白雜訊 (閃電、爆炸用) */
    function noise(ctx, startTime, duration, vol) {
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = buffer;
        gain.gain.setValueAtTime(vol * sfxVolume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        src.connect(gain).connect(ctx.destination);
        src.start(startTime);
    }

    // 簡易背景音樂 (循環合成 pad)
    let bgmNodes = null;

    function startBgm() {
        const ctx = getAudio();
        if (!ctx || bgmNodes || bgmVolume <= 0) return;

        const master = ctx.createGain();
        master.gain.value = bgmVolume * 0.15;
        master.connect(ctx.destination);

        const notes = [130.81, 155.56, 196.00, 233.08]; // C3, Eb3, G3, Bb3
        const oscs = [];
        for (const freq of notes) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            const lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            lfo.frequency.value = 0.2 + Math.random() * 0.3;
            lfoGain.gain.value = 0.15;
            lfo.connect(lfoGain).connect(g.gain);
            g.gain.value = 0.3;
            o.connect(g).connect(master);
            o.start();
            lfo.start();
            oscs.push(o, lfo);
        }
        bgmNodes = { master, oscs };
    }

    function stopBgm() {
        if (!bgmNodes) return;
        bgmNodes.master.gain.value = 0;
        for (const o of bgmNodes.oscs) {
            try { o.stop(); } catch (e) { /* 已停止 */ }
        }
        bgmNodes = null;
    }

    function setSfxVolume(v) { sfxVolume = v; }
    function setBgmVolume(v) {
        bgmVolume = v;
        if (bgmNodes) bgmNodes.master.gain.value = bgmVolume * 0.15;
    }

    UI.playSfx = playSfx;
    UI.startBgm = startBgm;
    UI.stopBgm = stopBgm;
    UI.setSfxVolume = setSfxVolume;
    UI.setBgmVolume = setBgmVolume;
    UI.getAudio = getAudio;

    // ==== HUD 更新 ====
    function updateHUD(state) {
        const hpPct = Math.max(0, state.hp / state.maxHp) * 100;
        const mpPct = Math.max(0, state.mp / state.maxMp) * 100;
        document.getElementById('hp-bar').style.width = hpPct + '%';
        document.getElementById('mp-bar').style.width = mpPct + '%';
        document.getElementById('hp-text').textContent =
            Math.ceil(state.hp) + '/' + state.maxHp;
        document.getElementById('mp-text').textContent =
            Math.ceil(state.mp) + '/' + state.maxMp;
        document.getElementById('score-display').textContent = '分數: ' + state.score;
        document.getElementById('gold-amount').textContent = state.gold || 0;

        if (state.infinite) {
            document.getElementById('wave-display').textContent =
                state.wave > 0 ? '波次: ' + state.wave : '準備...';
            document.getElementById('highscore-display').textContent =
                '最高: ' + state.highScore;
        } else {
            document.getElementById('level-display').textContent = '第 ' + state.level + ' 關';
        }

        const comboEl = document.getElementById('combo-display');
        if (state.combo > 1) {
            comboEl.classList.remove('hidden');
            document.getElementById('combo-count').textContent = state.combo;
        } else {
            comboEl.classList.add('hidden');
        }

        // 顯示現役 buff (剩餘秒數)
        const buffEl = document.getElementById('buffs-display');
        if (buffEl && state.activeBuffs) {
            const map = { damage: '⚔ 傷害+50%', speed: '» 速度+50%' };
            let html = '';
            for (const k in state.activeBuffs) {
                const remain = state.activeBuffs[k];
                if (remain > 0 && map[k]) {
                    html += `<div class="buff-tag">${map[k]} <span class="buff-time">${remain.toFixed(1)}s</span></div>`;
                }
            }
            buffEl.innerHTML = html;
        }
    }

    // ==== 冷卻圖示建立 — 只顯示 loadout 清單中的符文 ====
    function buildCooldownIcons(spells, loadout) {
        const container = document.getElementById('cooldowns');
        container.innerHTML = '';
        // 若提供 loadout 則以其順序建立; 否則所有符文
        const keys = (loadout && loadout.length) ? loadout : Object.keys(spells);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!spells[key]) continue;
            const cfg = spells[key];
            const icon = document.createElement('div');
            icon.className = 'cooldown-icon ready';
            icon.dataset.rune = key;
            const overlay = document.createElement('div');
            overlay.className = 'cd-overlay';
            overlay.style.height = '0%';
            const cv = document.createElement('canvas');
            cv.className = 'rune-canvas';
            cv.width = 44; cv.height = 44;
            drawTemplate(cv, global.Recognizer.getTemplate(key), cfg.color);
            const label = document.createElement('div');
            label.className = 'rune-name';
            label.textContent = cfg.name;
            icon.appendChild(overlay);
            icon.appendChild(cv);
            icon.appendChild(label);
            container.appendChild(icon);
        }
    }

    function updateCooldowns(cooldowns, spells) {
        const icons = document.querySelectorAll('.cooldown-icon');
        icons.forEach(icon => {
            const key = icon.dataset.rune;
            const cd = cooldowns[key] || 0;
            const max = spells[key].cooldown;
            const overlay = icon.querySelector('.cd-overlay');
            const pct = max ? Math.max(0, cd / max) * 100 : 0;
            overlay.style.height = pct + '%';
            if (cd <= 0) {
                icon.classList.add('ready');
            } else {
                icon.classList.remove('ready');
            }
        });
    }

    UI.updateHUD = updateHUD;
    UI.buildCooldownIcons = buildCooldownIcons;
    UI.updateCooldowns = updateCooldowns;

    // ==== 符文識別結果顯示 ====
    let recognizeTimeout = null;

    function showRecognition(name, accuracy, critical) {
        const el = document.getElementById('recognition-display');
        el.classList.remove('hidden', 'critical', 'fail');
        if (!name) {
            el.textContent = '識別失敗';
            el.classList.add('fail');
        } else {
            const cfg = global.Spells.CONFIG[name];
            const pctText = Math.round(accuracy * 100) + '%';
            el.textContent = `${cfg.name} ${pctText}`;
            if (critical) {
                el.textContent += ' ✦ 暴擊！';
                el.classList.add('critical');
            }
        }
        // 重新觸發動畫
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = '';
        clearTimeout(recognizeTimeout);
        recognizeTimeout = setTimeout(() => el.classList.add('hidden'), 800);
    }

    UI.showRecognition = showRecognition;

    // 帶狀態標籤的識別結果 (例如 [未解鎖] / [未裝備])
    function showRecognitionStatus(name, accuracy, status) {
        const el = document.getElementById('recognition-display');
        el.classList.remove('hidden', 'critical');
        el.classList.add('fail');
        const cfg = global.Spells.CONFIG[name];
        el.textContent = `${cfg ? cfg.name : '未知'} ${Math.round(accuracy * 100)}% ${status || ''}`;
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = '';
        clearTimeout(recognizeTimeout);
        recognizeTimeout = setTimeout(() => el.classList.add('hidden'), 1200);
    }
    UI.showRecognitionStatus = showRecognitionStatus;

    // ==== 關卡選擇畫面建立 ====
    function buildLevelSelect(unlockedUpTo, onPick) {
        const grid = document.getElementById('level-grid');
        grid.innerHTML = '';
        for (let i = 1; i <= global.Enemies.TOTAL_LEVELS; i++) {
            const info = global.Enemies.LEVEL_INFO[i];
            const card = document.createElement('div');
            card.className = 'level-card';
            if (info.boss) card.classList.add('boss');
            if (i > unlockedUpTo) card.classList.add('locked');
            card.innerHTML = `
                <div class="level-num">${i}</div>
                <div class="level-name">${info.name}</div>
            `;
            card.title = info.desc;
            card.addEventListener('click', () => {
                if (i <= unlockedUpTo) {
                    playSfx('ui');
                    onPick(i);
                }
            });
            grid.appendChild(card);
        }
    }

    UI.buildLevelSelect = buildLevelSelect;

    // ==== 符文圖鑑 ====
    function buildCodex(state) {
        const grid = document.getElementById('codex-grid');
        grid.innerHTML = '';
        for (const key of global.Recognizer.listRunes()) {
            const cfg = global.Spells.CONFIG[key];
            const card = document.createElement('div');
            card.className = 'codex-card';
            const unlocked = state ? state.isUnlocked(key) : true;
            const lv = state ? (state.runeLevels[key] || 1) : 1;
            if (!unlocked) card.classList.add('codex-locked');
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 100;
            drawTemplate(canvas, global.Recognizer.getTemplate(key), cfg.color);
            const info = document.createElement('div');
            info.className = 'codex-info';
            const stars = '★'.repeat(lv) + '☆'.repeat(5 - lv);
            const cdShown = cfg.cooldown ? cfg.cooldown.toFixed(1) + 's' : '-';
            info.innerHTML = `
                <h3>${cfg.name} ${unlocked ? '' : '<span class="codex-lock-tag">(未解鎖)</span>'}</h3>
                <div class="codex-stars">${stars}</div>
                <p>${cfg.description}</p>
                <p style="color:#ccaaff;margin-top:6px">冷卻: ${cdShown} &nbsp;|&nbsp; MP: ${cfg.mpCost || '-'}</p>
            `;
            card.appendChild(canvas);
            card.appendChild(info);
            grid.appendChild(card);
        }
    }

    function drawTemplate(canvas, pts, color) {
        if (!pts || pts.length < 2) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        // 找 bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        }
        const bw = maxX - minX, bh = maxY - minY;
        const pad = 15;
        const scale = Math.min((w - pad * 2) / (bw || 1), (h - pad * 2) / (bh || 1));
        const ox = (w - bw * scale) / 2 - minX * scale;
        const oy = (h - bh * scale) / 2 - minY * scale;

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x * scale + ox, pts[0].y * scale + oy);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x * scale + ox, pts[i].y * scale + oy);
        }
        ctx.stroke();
        // 起點標記
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(pts[0].x * scale + ox, pts[0].y * scale + oy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    UI.buildCodex = buildCodex;
    UI.drawTemplate = drawTemplate;

    // ==== 結果畫面 ====
    function showResult(title, stats, hasNext) {
        const modal = document.getElementById('result-screen');
        document.getElementById('result-title').textContent = title;
        let html = '';
        for (const k of Object.keys(stats)) {
            html += `<div>${k}: <span class="stat-value">${stats[k]}</span></div>`;
        }
        document.getElementById('result-stats').innerHTML = html;
        const nextBtn = modal.querySelector('[data-action="next-level"]');
        nextBtn.style.display = hasNext ? '' : 'none';
        modal.classList.remove('hidden');
    }

    function hideResult() {
        document.getElementById('result-screen').classList.add('hidden');
    }

    UI.showResult = showResult;
    UI.hideResult = hideResult;

    // ==== 升級 modal ====
    function showUpgrade(runeLevels, onPick) {
        const modal = document.getElementById('upgrade-screen');
        const grid = document.getElementById('upgrade-grid');
        grid.innerHTML = '';
        for (const key in global.Spells.CONFIG) {
            const cfg = global.Spells.CONFIG[key];
            const lv = runeLevels[key] || 1;
            const maxed = lv >= 5;
            const card = document.createElement('div');
            card.className = 'upgrade-card' + (maxed ? ' maxed' : '');
            // 符文 canvas
            const cv = document.createElement('canvas');
            cv.width = 70; cv.height = 70;
            drawTemplate(cv, global.Recognizer.getTemplate(key), cfg.color);
            // 資訊
            const info = document.createElement('div');
            info.className = 'upgrade-info';
            const stars = '★'.repeat(lv) + '☆'.repeat(5 - lv);
            info.innerHTML = `
                <div class="upgrade-name">${cfg.name}</div>
                <div class="upgrade-stars">${stars}</div>
                <div class="upgrade-next">${maxed ? '已滿級' : 'Lv.' + lv + ' → Lv.' + (lv + 1)}</div>
            `;
            card.appendChild(cv);
            card.appendChild(info);
            if (!maxed) {
                card.addEventListener('click', () => {
                    playSfx('recognize');
                    onPick(key);
                });
            }
            grid.appendChild(card);
        }
        modal.classList.remove('hidden');
    }

    function hideUpgrade() {
        document.getElementById('upgrade-screen').classList.add('hidden');
    }

    UI.showUpgrade = showUpgrade;
    UI.hideUpgrade = hideUpgrade;

    // ==== 商城 ====
    // 商品清單 — 初始只有火球, 其餘全部透過此處解鎖
    const SHOP_SPELLS = [
        // 平價基礎符文
        { key: 'icespike', cost: 80 },
        { key: 'lightning', cost: 120 },
        { key: 'shield', cost: 140 },
        { key: 'heal', cost: 150 },
        // 近戰系列
        { key: 'slash', cost: 180 },
        { key: 'blooddrain', cost: 220 },
        { key: 'wind', cost: 250 },
        { key: 'groundslam', cost: 280 },
        // 進階
        { key: 'poison', cost: 300 },
        { key: 'teleport', cost: 380 },
        // 終極
        { key: 'meteor', cost: 500 },
        { key: 'holynova', cost: 600 }
    ];
    const SHOP_UPGRADES = [
        { key: 'hp', name: '最大 HP +10', desc: '永久增加生命上限', cost: 80, max: 5, icon: 'HP' },
        { key: 'mp', name: '最大 MP +10', desc: '永久增加魔力上限', cost: 80, max: 5, icon: 'MP' },
        { key: 'mpRegen', name: 'MP 再生 +2/秒', desc: '加快魔力回復速度', cost: 120, max: 4, icon: 'RE' }
    ];

    function buildShop(state, onBuySpell, onBuyUpgrade) {
        document.getElementById('shop-gold-amount').textContent = state.gold;

        const spellGrid = document.getElementById('shop-spells');
        const upGrid = document.getElementById('shop-upgrades');

        // 已建立 → 原地更新, 不重建
        if (spellGrid.children.length > 0) {
            spellGrid.querySelectorAll('.shop-card').forEach(card => {
                const key = card.dataset.spellKey;
                if (!key) return;
                const item = SHOP_SPELLS.find(i => i.key === key);
                if (!item) return;
                const owned = !!(state.shopPurchased && state.shopPurchased[key]);
                const canAfford = state.gold >= item.cost;
                card.classList.toggle('owned', owned);
                card.classList.toggle('locked', !owned && !canAfford);
                const priceEl = card.querySelector('.shop-price');
                if (priceEl) priceEl.textContent = owned ? '✓ 已擁有' : item.cost + ' G';
            });
            upGrid.querySelectorAll('.shop-card').forEach(card => {
                const key = card.dataset.upgradeKey;
                if (!key) return;
                const item = SHOP_UPGRADES.find(i => i.key === key);
                if (!item) return;
                const lvl = (state.statUpgrades && state.statUpgrades[key]) || 0;
                const maxed = lvl >= item.max;
                const canAfford = state.gold >= item.cost;
                card.classList.toggle('owned', maxed);
                card.classList.toggle('locked', !maxed && !canAfford);
                const lvlEl = card.querySelector('.shop-level');
                if (lvlEl) lvlEl.textContent = '等級 ' + lvl + '/' + item.max;
                const priceEl = card.querySelector('.shop-price');
                if (priceEl) priceEl.textContent = maxed ? '✓ 已滿級' : item.cost + ' G';
            });
            return;
        }

        // 首次建立
        for (const item of SHOP_SPELLS) {
            const cfg = global.Spells.CONFIG[item.key];
            const owned = !!(state.shopPurchased && state.shopPurchased[item.key]);
            const canAfford = state.gold >= item.cost;
            const card = document.createElement('div');
            card.className = 'shop-card' + (owned ? ' owned' : (canAfford ? '' : ' locked'));
            card.dataset.spellKey = item.key;
            const cv = document.createElement('canvas');
            cv.width = 70; cv.height = 70;
            drawTemplate(cv, global.Recognizer.getTemplate(item.key), cfg.color);
            const info = document.createElement('div');
            info.className = 'shop-info';
            info.innerHTML = `
                <div class="shop-name">${cfg.name}</div>
                <div class="shop-desc">${cfg.description}</div>
                <div class="shop-price">${owned ? '✓ 已擁有' : item.cost + ' G'}</div>
            `;
            card.appendChild(cv);
            card.appendChild(info);
            // 事件掛在 card, handler 以當前狀態判斷
            card.addEventListener('click', () => {
                if (card.classList.contains('owned') || card.classList.contains('locked')) return;
                onBuySpell(item.key, item.cost);
            });
            spellGrid.appendChild(card);
        }

        for (const item of SHOP_UPGRADES) {
            const lvl = (state.statUpgrades && state.statUpgrades[item.key]) || 0;
            const maxed = lvl >= item.max;
            const canAfford = state.gold >= item.cost;
            const card = document.createElement('div');
            card.className = 'shop-card' + (maxed ? ' owned' : (canAfford ? '' : ' locked'));
            card.dataset.upgradeKey = item.key;
            card.innerHTML = `
                <div class="shop-icon">${item.icon}</div>
                <div class="shop-info">
                    <div class="shop-name">${item.name}</div>
                    <div class="shop-desc">${item.desc}</div>
                    <div class="shop-level">等級 ${lvl}/${item.max}</div>
                    <div class="shop-price">${maxed ? '✓ 已滿級' : item.cost + ' G'}</div>
                </div>
            `;
            card.addEventListener('click', () => {
                if (card.classList.contains('owned') || card.classList.contains('locked')) return;
                onBuyUpgrade(item.key, item.cost);
            });
            upGrid.appendChild(card);
        }
    }

    function clearShopGrid() {
        const g1 = document.getElementById('shop-spells');
        const g2 = document.getElementById('shop-upgrades');
        if (g1) g1.innerHTML = '';
        if (g2) g2.innerHTML = '';
    }

    UI.buildShop = buildShop;
    UI.clearShopGrid = clearShopGrid;
    UI.SHOP_SPELLS = SHOP_SPELLS;
    UI.SHOP_UPGRADES = SHOP_UPGRADES;

    // ==== 出戰選擇 ====
    // 動態繪製插槽 + 可選符文池
    function buildLoadout(state, onToggle) {
        const slotsEl = document.getElementById('loadout-slots');
        const poolEl = document.getElementById('loadout-pool');
        slotsEl.innerHTML = '';
        poolEl.innerHTML = '';

        // 插槽 (5 格)
        for (let i = 0; i < 5; i++) {
            const slot = document.createElement('div');
            slot.className = 'loadout-slot';
            const spellKey = state.loadout[i];
            if (spellKey) {
                const cfg = global.Spells.CONFIG[spellKey];
                const cv = document.createElement('canvas');
                cv.width = 60; cv.height = 60;
                drawTemplate(cv, global.Recognizer.getTemplate(spellKey), cfg.color);
                const lbl = document.createElement('div');
                lbl.className = 'loadout-slot-name';
                lbl.textContent = cfg.name;
                slot.appendChild(cv);
                slot.appendChild(lbl);
                slot.classList.add('filled');
            } else {
                slot.classList.add('empty');
                const hint = document.createElement('div');
                hint.className = 'loadout-slot-empty';
                hint.textContent = '空';
                slot.appendChild(hint);
            }
            const idx = document.createElement('div');
            idx.className = 'loadout-slot-idx';
            idx.textContent = (i + 1);
            slot.appendChild(idx);
            slotsEl.appendChild(slot);
        }

        // 符文池 (所有已解鎖的)
        for (const key in global.Spells.CONFIG) {
            if (!state.isUnlocked(key)) continue;
            const cfg = global.Spells.CONFIG[key];
            const card = document.createElement('div');
            card.className = 'loadout-card';
            const isEquipped = state.loadout.indexOf(key) >= 0;
            if (isEquipped) card.classList.add('equipped');
            const cv = document.createElement('canvas');
            cv.width = 70; cv.height = 70;
            drawTemplate(cv, global.Recognizer.getTemplate(key), cfg.color);
            const info = document.createElement('div');
            info.className = 'loadout-card-info';
            const lv = (state.runeLevels && state.runeLevels[key]) || 1;
            const starsHtml = state.mpMode
                ? '<div class="loadout-card-stars pvp-lvl">Lv.1 · 公平對戰</div>'
                : `<div class="loadout-card-stars">${'★'.repeat(lv)}${'☆'.repeat(5 - lv)}</div>`;
            info.innerHTML = `
                <div class="loadout-card-name">${cfg.name}</div>
                ${starsHtml}
                <div class="loadout-card-desc">${cfg.description}</div>
            `;
            card.appendChild(cv);
            card.appendChild(info);
            card.addEventListener('click', () => onToggle(key));
            poolEl.appendChild(card);
        }
    }

    UI.buildLoadout = buildLoadout;

    // ==== 技能管理螢幕 ====
    function buildSkills(state, onChange) {
        document.getElementById('skills-available').textContent = state.available;
        document.getElementById('skills-earned').textContent = state.earned;

        const grid = document.getElementById('skills-grid');

        // 已存在卡片 → 原地更新 (不重建 DOM, 不閃爍)
        if (grid.children.length > 0) {
            const cards = grid.querySelectorAll('.skill-card');
            cards.forEach(card => {
                const key = card.dataset.rune;
                if (!key) return;
                const cfg = global.Spells.CONFIG[key];
                const lv = state.runeLevels[key] || 1;
                const unlocked = state.isUnlocked(key);
                card.classList.toggle('locked', !unlocked);
                const nameEl = card.querySelector('.skill-name');
                if (nameEl) {
                    nameEl.innerHTML = cfg.name + (unlocked ? '' : ' <span class="skill-locked">(未解鎖)</span>');
                }
                const starsEl = card.querySelector('.skill-stars');
                if (starsEl) starsEl.textContent = '★'.repeat(lv) + '☆'.repeat(5 - lv);
                const lvLblEl = card.querySelector('.skill-lvl');
                if (lvLblEl) lvLblEl.textContent = 'Lv.' + lv;
                const minusBtn = card.querySelector('.skill-btn.minus');
                if (minusBtn) minusBtn.disabled = lv <= 1 || !unlocked;
                const plusBtn = card.querySelector('.skill-btn.plus');
                if (plusBtn) plusBtn.disabled = lv >= 5 || state.available <= 0 || !unlocked;
            });
            return;
        }

        // 首次建立
        for (const key in global.Spells.CONFIG) {
            const cfg = global.Spells.CONFIG[key];
            const lv = state.runeLevels[key] || 1;
            const unlocked = state.isUnlocked(key);
            const card = document.createElement('div');
            card.className = 'skill-card' + (unlocked ? '' : ' locked');
            card.dataset.rune = key;
            const cv = document.createElement('canvas');
            cv.width = 64; cv.height = 64;
            drawTemplate(cv, global.Recognizer.getTemplate(key), cfg.color);
            const info = document.createElement('div');
            info.className = 'skill-info';
            const stars = '★'.repeat(lv) + '☆'.repeat(5 - lv);
            info.innerHTML = `
                <div class="skill-name">${cfg.name} ${unlocked ? '' : '<span class="skill-locked">(未解鎖)</span>'}</div>
                <div class="skill-stars">${stars}</div>
                <div class="skill-desc">${cfg.description}</div>
            `;
            const ctrl = document.createElement('div');
            ctrl.className = 'skill-ctrl';
            const minusBtn = document.createElement('button');
            minusBtn.className = 'skill-btn minus';
            minusBtn.textContent = '−';
            minusBtn.disabled = lv <= 1 || !unlocked;
            minusBtn.addEventListener('click', (ev) => { ev.stopPropagation(); onChange(key, -1); });
            const lvLbl = document.createElement('div');
            lvLbl.className = 'skill-lvl';
            lvLbl.textContent = 'Lv.' + lv;
            const plusBtn = document.createElement('button');
            plusBtn.className = 'skill-btn plus';
            plusBtn.textContent = '+';
            plusBtn.disabled = lv >= 5 || state.available <= 0 || !unlocked;
            plusBtn.addEventListener('click', (ev) => { ev.stopPropagation(); onChange(key, +1); });
            ctrl.appendChild(minusBtn);
            ctrl.appendChild(lvLbl);
            ctrl.appendChild(plusBtn);
            card.appendChild(cv);
            card.appendChild(info);
            card.appendChild(ctrl);
            grid.appendChild(card);
        }
    }

    // 離開技能頁面時呼叫, 清空讓下次進入重新建立
    function clearSkillsGrid() {
        const grid = document.getElementById('skills-grid');
        if (grid) grid.innerHTML = '';
    }

    UI.buildSkills = buildSkills;
    UI.clearSkillsGrid = clearSkillsGrid;

    // ==== 操作提示 ====
    function showControlsHint(show) {
        const el = document.getElementById('controls-hint');
        if (!el) return;
        if (show) el.classList.remove('hidden');
        else el.classList.add('hidden');
    }
    UI.showControlsHint = showControlsHint;

    // ==== 初始化 ====
    function init() {
        registerScreens();
        showScreen('main-menu');
        // 初始化音量 Slider
        const sfxSlider = document.getElementById('sfx-volume');
        const bgmSlider = document.getElementById('bgm-volume');
        if (sfxSlider) {
            sfxSlider.addEventListener('input', (e) => {
                setSfxVolume(parseInt(e.target.value) / 100);
            });
        }
        if (bgmSlider) {
            bgmSlider.addEventListener('input', (e) => {
                setBgmVolume(parseInt(e.target.value) / 100);
            });
        }
    }

    UI.init = init;

    global.UI = UI;
})(window);
