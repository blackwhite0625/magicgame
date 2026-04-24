/* ================================================================
   multiplayer.js — Cloudflare 版多人連線

   架構:
     Browser ─WebSocket─► Cloudflare Worker ─► Durable Object (一房一個)
             ─GET /turn─► Cloudflare Realtime TURN API
             ─WebRTC P2P (DataChannel) ─► 其他 Browser

   取代了舊版的 PeerJS — 對外 API (window.Multiplayer) 完全相同,
   main.js 不需要任何修改.

   事件 (emit):
     hosting(code)         房主已開房, code 準備好分享
     open(conn)            DataChannel 打開 — 對方可接收訊息
     data(obj, conn)       收到對方訊息
     close(conn)           對方離線
     error(msg)            連線錯誤
     disconnected          disconnect() 被呼叫

   conn 物件介面 (main.js 依賴這幾個屬性):
     conn.peer   — 唯一識別字串
     conn.send(obj) — 只發給此對方
     conn.open   — bool
   ================================================================ */

(function (global) {
    'use strict';

    // ==== 設定: Worker 網址 ====
    // 部署 Cloudflare Worker 之後 把這行改成你的 Worker 網址
    // (worker/README.md 有詳細部署步驟)
    const SIGNAL_ORIGIN_PROD = 'https://magicrunes-signal.f0989724842.workers.dev';

    function getSignalOrigin() {
        const h = location.hostname;
        if (h === 'localhost' || h === '127.0.0.1' || h === '') {
            return 'http://localhost:8787';
        }
        return SIGNAL_ORIGIN_PROD;
    }

    function getWsOrigin() {
        return getSignalOrigin().replace(/^http/, 'ws');
    }

    // ==== 房號產生 (1v1/2v2 的隨機 6 碼, 避開易混字) ====
    const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    function makeCode() {
        let s = '';
        for (let i = 0; i < 6; i++) {
            s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
        return s;
    }

    // ==== 狀態 ====
    const state = {
        ws: null,
        wsReady: false,
        iceServers: null,
        isHost: false,
        code: null,
        capacity: 2,        // 1v1=2, 2v2=4, 0/Infinity=大亂鬥
        mySlot: null,
        peers: new Map(),   // slot → PeerHandle
        myName: 'Player',
        _peerNonce: 0,
        _brawlMode: false,
        _pendingOnCodeReady: null,
        _pendingOnError: null
    };

    // ==== 事件系統 ====
    const listeners = {};
    function on(evt, fn) {
        (listeners[evt] = listeners[evt] || []).push(fn);
    }
    function off(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(h => h !== fn);
    }
    function offAll(evt) {
        if (evt) delete listeners[evt];
        else for (const k in listeners) delete listeners[k];
    }
    function emit(evt /*, ...args */) {
        const args = Array.prototype.slice.call(arguments, 1);
        (listeners[evt] || []).forEach(h => {
            try { h.apply(null, args); } catch (e) { console.error('[mp] listener error', evt, e); }
        });
    }

    // ==== TURN credential 取得 ====
    let _iceCache = null;
    let _iceCacheAt = 0;
    async function fetchIceServers() {
        // 快取 20 分鐘 (TURN 憑證 24 小時有效)
        if (_iceCache && Date.now() - _iceCacheAt < 20 * 60 * 1000) {
            return _iceCache;
        }
        const fallback = [
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' }
        ];
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(getSignalOrigin() + '/turn', { signal: ctrl.signal });
            clearTimeout(timer);
            const data = await res.json();
            if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
                _iceCache = data.iceServers;
                _iceCacheAt = Date.now();
                return _iceCache;
            }
        } catch (e) {
            console.warn('[mp] fetchIceServers failed, using fallback STUN', e);
        }
        return fallback;
    }

    // ==== 大亂鬥分房: 問 Worker 哪間有空位 ====
    async function brawlMatch() {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(getSignalOrigin() + '/brawl-match', { signal: ctrl.signal });
            clearTimeout(timer);
            return await res.json();   // { room, count, capacity, fresh? }
        } catch (e) {
            console.warn('[mp] brawlMatch failed', e);
            return null;
        }
    }

    // ==== WebSocket 信令 ====
    function openSignalingWS(code, role, capacity, name) {
        return new Promise((resolve, reject) => {
            const params = new URLSearchParams({
                room: code,
                role,
                capacity: String(capacity || 0),
                name: name || 'Player'
            });
            const url = getWsOrigin() + '/ws?' + params.toString();

            let ws;
            try {
                ws = new WebSocket(url);
            } catch (e) {
                reject(e);
                return;
            }
            state.ws = ws;

            let openedOnce = false;
            let resolvedSignaling = false;

            // 10 秒內要打開否則視為失敗
            const openTimeout = setTimeout(() => {
                if (!openedOnce) {
                    try { ws.close(); } catch (e) {}
                    reject(new Error('signaling ws open timeout'));
                }
            }, 10000);

            ws.onopen = () => {
                openedOnce = true;
                clearTimeout(openTimeout);
                state.wsReady = true;
            };

            ws.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                // 第一次收到 joined 就位 → resolve signaling
                // 若第一個訊息是 error (e.g. "host exists") → 立即 reject
                if (!resolvedSignaling) {
                    if (msg.type === 'joined') {
                        resolvedSignaling = true;
                        resolve(msg);
                    } else if (msg.type === 'error') {
                        resolvedSignaling = true;
                        clearTimeout(openTimeout);
                        try { ws.close(); } catch (e) {}
                        reject(new Error(msg.msg || 'signaling error'));
                        return;
                    }
                }
                handleSignalMessage(msg).catch(err => console.error('[mp] handleSignalMessage', err));
            };

            ws.onerror = (ev) => {
                console.warn('[mp] ws error', ev);
            };

            ws.onclose = (ev) => {
                state.wsReady = false;
                if (!resolvedSignaling) {
                    clearTimeout(openTimeout);
                    reject(new Error('ws closed before joined: ' + (ev.code || '?')));
                }
                // WS 關了之後, 已建立的 P2P DataChannel 仍可使用
                // 但失去信令能力, 新加入者無法連進來
            };
        });
    }

    function wsSend(obj) {
        if (!state.ws || state.ws.readyState !== 1) return;
        try { state.ws.send(JSON.stringify(obj)); } catch (e) {}
    }

    // ==== 核心: 信令訊息處理 ====
    async function handleSignalMessage(msg) {
        switch (msg.type) {
            case 'joined': {
                state.mySlot = msg.slot;
                if (typeof msg.capacity === 'number') state.capacity = msg.capacity;
                // 如果我是訪客, peers 清單告訴我誰已經在房內
                // 主機會主動 createOffer 給我, 我只需等 signal 訊息
                break;
            }
            case 'peer-join': {
                // 只有主機主動發 offer 給新來的訪客
                // (訪客收到 peer-join 代表另一個訪客也加入了, 但訪客之間不直連, 所以忽略)
                if (state.isHost) {
                    await hostInitiatePeerConn(msg.slot, msg.name, msg.role);
                }
                break;
            }
            case 'peer-leave': {
                cleanupPeer(msg.slot);
                break;
            }
            case 'signal': {
                await handleWebRTCSignal(msg.from, msg.data);
                break;
            }
            case 'room-full': {
                emit('error', 'room full');
                break;
            }
            case 'error': {
                emit('error', msg.msg || 'signaling error');
                break;
            }
            case 'pong':
                // 可選 RTT 量測 — 目前不用
                break;
        }
    }

    // ==== PeerHandle — 封裝一條 WebRTC 連線 ====
    function makePeerHandle(slot, iceServers) {
        const pc = new RTCPeerConnection({ iceServers: iceServers });
        const peerId = 'peer-' + slot + '-' + (++state._peerNonce);

        const handle = {
            slot,
            peer: peerId,
            pc,
            dc: null,
            open: false,
            _lastNx: null,
            _lastNy: null,
            send(obj) {
                if (!handle.dc || !handle.open) return;
                const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
                try { handle.dc.send(payload); } catch (e) {}
            },
            close() {
                try { if (handle.dc) handle.dc.close(); } catch (e) {}
                try { pc.close(); } catch (e) {}
            }
        };

        // Trickle ICE: 收集到 candidate 就透過 WS 轉發
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                wsSend({ type: 'signal', to: slot, data: { ice: e.candidate } });
            }
        };

        pc.oniceconnectionstatechange = () => {
            // 連線斷了 → 釋放資源
            const s = pc.iceConnectionState;
            if (s === 'failed' || s === 'closed') {
                if (handle.open) {
                    handle.open = false;
                    emit('close', handle);
                }
                cleanupPeer(slot);
            }
        };

        return handle;
    }

    // 設定 DataChannel 的事件 handler (host/guest 都會用)
    function attachDC(handle, dc) {
        handle.dc = dc;
        dc.binaryType = 'arraybuffer';
        dc.onopen = () => {
            handle.open = true;
            emit('open', handle);
        };
        dc.onmessage = (ev) => {
            let data;
            try {
                data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
            } catch (e) { return; }
            onDCMessage(handle, data);
        };
        dc.onclose = () => {
            if (handle.open) {
                handle.open = false;
                emit('close', handle);
            }
            cleanupPeer(handle.slot);
        };
        dc.onerror = (e) => {
            console.warn('[mp] dc error slot', handle.slot, e);
        };
    }

    // 房主主動向新訪客發 offer
    async function hostInitiatePeerConn(slot, name, role) {
        const handle = makePeerHandle(slot, state.iceServers);
        state.peers.set(slot, handle);

        const dc = handle.pc.createDataChannel('game', { ordered: true });
        attachDC(handle, dc);

        try {
            const offer = await handle.pc.createOffer();
            await handle.pc.setLocalDescription(offer);
            wsSend({ type: 'signal', to: slot, data: { sdp: handle.pc.localDescription } });
        } catch (e) {
            console.error('[mp] createOffer fail', e);
            cleanupPeer(slot);
        }
    }

    // 收到對方的 WebRTC 訊號 (offer / answer / ice)
    async function handleWebRTCSignal(fromSlot, data) {
        if (!data) return;

        if (data.sdp) {
            const sdp = data.sdp;
            if (sdp.type === 'offer') {
                // 訪客收到主機的 offer
                let handle = state.peers.get(fromSlot);
                if (!handle) {
                    handle = makePeerHandle(fromSlot, state.iceServers);
                    state.peers.set(fromSlot, handle);
                    // 訪客: 等 host 建的 DataChannel 過來
                    handle.pc.ondatachannel = (e) => attachDC(handle, e.channel);
                }
                try {
                    await handle.pc.setRemoteDescription(sdp);
                    const answer = await handle.pc.createAnswer();
                    await handle.pc.setLocalDescription(answer);
                    wsSend({ type: 'signal', to: fromSlot, data: { sdp: handle.pc.localDescription } });
                } catch (e) {
                    console.error('[mp] handleOffer fail', e);
                }
            } else if (sdp.type === 'answer') {
                // 主機收到訪客的 answer
                const handle = state.peers.get(fromSlot);
                if (!handle) return;
                try {
                    await handle.pc.setRemoteDescription(sdp);
                } catch (e) {
                    console.error('[mp] setRemoteDescription answer fail', e);
                }
            }
        } else if (data.ice) {
            const handle = state.peers.get(fromSlot);
            if (!handle) return;
            try {
                await handle.pc.addIceCandidate(data.ice);
            } catch (e) {
                // ICE 可能晚到, 忽略
            }
        }
    }

    // ==== 主機轉發: 訪客訊息 → 其他訪客 (同舊版 logic) ====
    function onDCMessage(fromHandle, data) {
        // 只有主機做轉發, 訪客直接 emit data
        if (state.isHost && state.peers.size > 1 && data && !data._relayed) {
            // 位置追蹤 (大亂鬥距離剪枝用)
            if (data.type === 'state' && data.nx != null && data.ny != null) {
                fromHandle._lastNx = data.nx;
                fromHandle._lastNy = data.ny;
            }
            const tagged = Object.assign({ _relayed: true }, data);
            const isBrawl = state._brawlMode;
            const shouldCull = isBrawl &&
                               data.type === 'state' &&
                               data.nx != null && data.ny != null;
            const CULL_DIST = 0.45;
            const CULL_DIST_SQ = CULL_DIST * CULL_DIST;

            for (const ph of state.peers.values()) {
                if (ph === fromHandle || !ph.open) continue;
                if (shouldCull && ph._lastNx != null && ph._lastNy != null) {
                    const ddx = data.nx - ph._lastNx;
                    const ddy = data.ny - ph._lastNy;
                    if (ddx * ddx + ddy * ddy > CULL_DIST_SQ) continue;
                }
                const payload = JSON.stringify(tagged);
                try { ph.dc.send(payload); } catch (e) {}
            }
        }
        emit('data', data, fromHandle);
    }

    // ==== 清理單一 peer ====
    function cleanupPeer(slot) {
        const h = state.peers.get(slot);
        if (!h) return;
        state.peers.delete(slot);
        const wasOpen = h.open;
        try { h.close(); } catch (e) {}
        if (wasOpen) emit('close', h);
    }

    // ================================================================
    // 對外 API
    // ================================================================

    /**
     * 建立房間
     * @param {(code:string)=>void} onCodeReady
     * @param {(err:string)=>void} onError
     * @param {number} capacity  0 = 無限 (brawl), 2 = 1v1, 4 = 2v2
     * @param {string} [fixedCode]  指定房號 (大亂鬥 BRAWL* 會觸發自動分房)
     */
    async function host(onCodeReady, onError, capacity, fixedCode) {
        cleanup();
        state.isHost = true;
        state.capacity = (capacity === 0 || capacity === undefined) ? 0 : capacity;

        try {
            state.iceServers = await fetchIceServers();
        } catch (e) {
            if (onError) onError('TURN 憑證取得失敗');
            return;
        }

        // Brawl 特殊處理: 透過 matchmaker 找空房
        let code;
        if (fixedCode && String(fixedCode).toUpperCase().startsWith('BRAWL')) {
            const m = await brawlMatch();
            if (m && (m.count === 0 || m.fresh)) {
                code = m.room;
            } else if (m && m.room) {
                // 配到一個有人在的房 — 開房者不該搶 host, 回傳錯誤讓 caller 改走 join
                if (onError) onError('room has host');
                return;
            } else {
                code = fixedCode;
            }
        } else {
            code = fixedCode || makeCode();
        }
        state.code = code;

        try {
            await openSignalingWS(code, 'host', state.capacity, state.myName);
            if (onCodeReady) onCodeReady(code);
            emit('hosting', code);
        } catch (err) {
            if (onError) onError(err.message || String(err));
            cleanup();
        }
    }

    /**
     * 加入房間
     * @param {string} code  房號 (BRAWL* 會觸發自動分房)
     * @param {(err:string)=>void} onError
     */
    async function join(code, onError) {
        cleanup();
        state.isHost = false;
        code = String(code || '').toUpperCase();

        try {
            state.iceServers = await fetchIceServers();
        } catch (e) {
            if (onError) onError('TURN 憑證取得失敗');
            return;
        }

        // Brawl 自動分房
        if (code.startsWith('BRAWL')) {
            const m = await brawlMatch();
            if (m && m.room) {
                code = m.room;
                // 空房: join 會卡死 (沒 host 不會送 offer) → 立即回 error
                // 讓 caller (autoJoinBrawl) 快速 fallback 到 attemptHost
                if (m.count === 0 || m.fresh) {
                    if (onError) onError('empty brawl room');
                    return;
                }
            }
        }
        state.code = code;

        try {
            await openSignalingWS(code, 'guest', 0, state.myName);
            // DataChannel 尚未就位 — host 會主動發 offer, open 事件稍後觸發
        } catch (err) {
            if (onError) onError(err.message || String(err));
            cleanup();
        }
    }

    /**
     * 廣播 (主機) / 送給主機 (訪客)
     */
    function send(obj) {
        for (const ph of state.peers.values()) {
            if (ph.open) {
                try { ph.dc.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch (e) {}
            }
        }
    }

    function disconnect() {
        cleanup();
        emit('disconnected');
    }

    function cleanup() {
        for (const ph of state.peers.values()) {
            try { ph.close(); } catch (e) {}
        }
        state.peers.clear();

        if (state.ws) {
            try {
                state.ws.onmessage = null;
                state.ws.onopen = null;
                state.ws.onerror = null;
                state.ws.onclose = null;
                state.ws.close();
            } catch (e) {}
            state.ws = null;
        }
        state.wsReady = false;
        state.code = null;
        state.isHost = false;
        state.mySlot = null;
        state.capacity = 2;
    }

    function isConnected() {
        for (const ph of state.peers.values()) {
            if (ph.open) return true;
        }
        return false;
    }

    // ==== 對外匯出 ====
    global.Multiplayer = {
        host,
        join,
        send,
        disconnect,
        brawlMatch,
        on, off, offAll,
        isHost: () => state.isHost,
        isConnected,
        getCode: () => state.code,
        getCapacity: () => state.capacity,
        getConnections: () => Array.from(state.peers.values()),
        connectionCount: () => {
            let n = 0;
            for (const ph of state.peers.values()) if (ph.open) n++;
            return n;
        },
        // 相容舊 API (PeerJS 版曾暴露此常數, 新版不用, 保留為空字串避免 undefined)
        ID_PREFIX: '',
        _brawlMode: false,
        setBrawlMode(on) {
            state._brawlMode = !!on;
            this._brawlMode = !!on;
        },
        // 選填: 讓 signaling 訊息有玩家名 (純 logging 用; 實際遊戲內名字由 main.js 透過 DC hello 同步)
        setName(n) {
            state.myName = String(n || 'Player').slice(0, 16);
        },
        // Debug
        _state: state
    };
})(window);
