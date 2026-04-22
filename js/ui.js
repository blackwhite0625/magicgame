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
                // 火球: whoosh 噴射 + 火焰嗶啵 + 低頻燃燒聲
                tone(ctx, now, 180, 0.3, 'sawtooth', 0.35, 70);   // 低頻噴射
                tone(ctx, now + 0.03, 420, 0.2, 'triangle', 0.22, 140);  // 中頻燃燒
                filteredNoise(ctx, now, 0.25, 0.3, 1200, 'lowpass');    // 悶火焰雜訊
                filteredNoise(ctx, now + 0.1, 0.3, 0.15, 600, 'lowpass'); // 延續
                break;
            }
            case 'lightning': {
                // 閃電: 瞬間高頻 crack + 低頻餘震 + 雷鳴
                noise(ctx, now, 0.06, 0.45);                          // 電光 crack
                tone(ctx, now, 3000, 0.04, 'square', 0.25, 600);     // 尖銳瞬響
                tone(ctx, now + 0.02, 1200, 0.15, 'sawtooth', 0.25, 80); // 電鳴
                tone(ctx, now + 0.05, 70, 0.5, 'sine', 0.3, 30);    // 低頻雷鳴餘震
                filteredNoise(ctx, now + 0.05, 0.4, 0.15, 400, 'lowpass');
                break;
            }
            case 'icespike': {
                // 冰刺: 晶瑩尖刺 + 空氣破開 + 高音顫音
                tone(ctx, now, 900, 0.1, 'triangle', 0.3, 420);     // 穿射
                tone(ctx, now + 0.04, 1800, 0.25, 'sine', 0.22, 1400); // 高頻晶響
                tone(ctx, now + 0.08, 2600, 0.18, 'sine', 0.12, 3400); // 極高頻閃光
                filteredNoise(ctx, now + 0.02, 0.08, 0.12, 3000, 'highpass'); // 破空聲
                break;
            }
            case 'heal': {
                // 治療: 柔和天使合唱 (加八度和聲)
                tone(ctx, now, 523, 0.4, 'sine', 0.3, 523);          // C5
                tone(ctx, now, 1047, 0.4, 'sine', 0.12, 1047);       // C6 泛音
                tone(ctx, now + 0.1, 659, 0.4, 'sine', 0.28, 659);   // E5
                tone(ctx, now + 0.2, 784, 0.5, 'sine', 0.26, 784);   // G5
                tone(ctx, now + 0.35, 1047, 0.6, 'sine', 0.3);       // C6 主題
                tone(ctx, now + 0.5, 1568, 0.8, 'sine', 0.15);       // 高音尾
                break;
            }
            case 'shield': {
                // 護盾: 金屬成形 + 能量共鳴
                tone(ctx, now, 220, 0.15, 'triangle', 0.25, 440);
                tone(ctx, now + 0.05, 660, 0.3, 'triangle', 0.3, 880);
                tone(ctx, now + 0.12, 330, 0.5, 'sine', 0.2, 440);   // 持續共鳴
                tone(ctx, now + 0.12, 660, 0.5, 'sine', 0.12, 880);  // 和音
                break;
            }
            case 'meteor': {
                // 隕石: 劃空巨響 + 撞擊 + 地裂餘震
                tone(ctx, now, 120, 0.6, 'sawtooth', 0.4, 40);       // 來襲呼嘯
                filteredNoise(ctx, now, 0.6, 0.3, 400, 'lowpass');   // 穿空雜訊
                tone(ctx, now + 0.4, 60, 0.8, 'sawtooth', 0.45, 25); // 撞擊低頻
                noise(ctx, now + 0.55, 0.5, 0.45);                   // 爆炸雜訊
                tone(ctx, now + 0.7, 40, 0.5, 'sine', 0.3, 20);      // 餘震
                break;
            }
            case 'wind': {
                // 風刃: 尖銳呼嘯 + 切風
                filteredNoise(ctx, now, 0.4, 0.45, 2800, 'highpass'); // 高頻風聲
                tone(ctx, now, 400, 0.3, 'sine', 0.12, 1800);         // 上掃風嘯
                tone(ctx, now + 0.1, 900, 0.15, 'triangle', 0.08, 1400); // 尾音
                break;
            }
            case 'poison': {
                // 毒霧: 低頻冒泡 + 嘶嘶氣體
                tone(ctx, now, 120, 0.35, 'sine', 0.25, 200);
                tone(ctx, now + 0.1, 180, 0.25, 'triangle', 0.22, 140);
                tone(ctx, now + 0.22, 90, 0.3, 'sine', 0.22, 120);
                tone(ctx, now + 0.35, 150, 0.3, 'sine', 0.18, 200);  // 第二氣泡
                filteredNoise(ctx, now, 0.45, 0.15, 500, 'bandpass'); // 嘶嘶氣
                break;
            }
            case 'teleport': {
                // 閃現: 消失上掃 + 瞬現下掃 + 魔法餘音
                tone(ctx, now, 200, 0.1, 'sine', 0.3, 2500);
                filteredNoise(ctx, now, 0.1, 0.2, 3000, 'highpass');
                tone(ctx, now + 0.1, 2500, 0.15, 'sine', 0.3, 500);
                tone(ctx, now + 0.15, 800, 0.25, 'triangle', 0.18, 1200);
                break;
            }
            case 'holynova': {
                // 聖光爆: 大和聲 + 鐘聲 + 持續光暈
                tone(ctx, now, 523, 0.6, 'sine', 0.3);                // C
                tone(ctx, now, 659, 0.6, 'sine', 0.25);               // E
                tone(ctx, now, 784, 0.6, 'sine', 0.25);               // G
                tone(ctx, now + 0.08, 1047, 0.8, 'sine', 0.3);        // C6
                tone(ctx, now + 0.2, 1568, 0.9, 'sine', 0.22);        // G6
                tone(ctx, now + 0.35, 2093, 1.0, 'sine', 0.16);       // C7 鐘聲尾
                break;
            }
            case 'slash': {
                // 利刃斬: 劃破空氣
                filteredNoise(ctx, now, 0.14, 0.4, 4000, 'highpass');
                tone(ctx, now, 1200, 0.08, 'sawtooth', 0.25, 300);
                tone(ctx, now + 0.02, 600, 0.12, 'triangle', 0.18, 200);
                break;
            }
            case 'groundslam': {
                // 大地轟擊: 超低震 + 碎石 + 餘波
                tone(ctx, now, 55, 0.5, 'sawtooth', 0.5, 22);
                filteredNoise(ctx, now, 0.35, 0.45, 250, 'lowpass');  // 低頻轟隆
                tone(ctx, now + 0.1, 100, 0.3, 'triangle', 0.3, 40);
                tone(ctx, now + 0.25, 40, 0.5, 'sine', 0.28, 18);     // 餘震
                noise(ctx, now + 0.15, 0.2, 0.2);                      // 碎石
                break;
            }
            case 'blooddrain': {
                // 吸血之觸: 陰森抽取 + 壓抑共鳴
                tone(ctx, now, 150, 0.4, 'sawtooth', 0.3, 420);
                tone(ctx, now + 0.1, 380, 0.3, 'sine', 0.25, 180);
                tone(ctx, now + 0.22, 200, 0.35, 'triangle', 0.2, 80);
                filteredNoise(ctx, now + 0.05, 0.3, 0.15, 800, 'bandpass');
                break;
            }
            case 'hit': {
                // 擊中回饋: 柔和低頻 thump
                tone(ctx, now, 180, 0.12, 'sawtooth', 0.3, 60);
                noise(ctx, now, 0.06, 0.18);
                break;
            }
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
            case 'ui': {
                // 溫和的 tap 音: 雙層正弦波, 去掉原本 square 的尖銳感
                tone(ctx, now, 440, 0.08, 'sine', 0.16, 560);
                tone(ctx, now + 0.015, 660, 0.1, 'triangle', 0.09, 780);
                break;
            }
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

    /** 濾波雜訊 (風聲 / 低頻轟鳴等) */
    function filteredNoise(ctx, startTime, duration, vol, filterFreq, filterType) {
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = filterType || 'lowpass';
        filter.frequency.value = filterFreq || 1000;
        filter.Q.value = 1;
        src.buffer = buffer;
        gain.gain.setValueAtTime(vol * sfxVolume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        src.connect(filter).connect(gain).connect(ctx.destination);
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
        { key: 'summon', cost: 450 },
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
