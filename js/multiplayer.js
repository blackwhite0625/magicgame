/* ================================================================
   multiplayer.js — 1v1 連線 (WebRTC via PeerJS)
   - 房主建立房間: 生成 6 碼 room code, 使用自訂 peer ID 註冊
   - 訪客輸入 code 直接連線
   - 建立後透過 DataChannel 雙向傳送訊息
   - 不需要後端, PeerJS 公用信令伺服器處理握手
   ================================================================ */

(function (global) {
    'use strict';

    const ID_PREFIX = 'magicrunes-';
    const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混字元

    function makeCode() {
        let s = '';
        for (let i = 0; i < 6; i++) {
            s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
        return s;
    }

    const state = {
        peer: null,
        conn: null,      // 訪客 → 房主 (或 1v1 房主唯一連線, 相容舊代碼)
        conns: [],       // 房主維護的所有訪客連線 (含 2v2 時最多 3 條)
        capacity: 2,     // 房間容量 (1v1=2, 2v2=4)
        isHost: false,
        code: null,
        connected: false
    };

    const listeners = {};

    function on(evt, fn) {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
    }
    function off(evt, fn) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(h => h !== fn);
    }
    function emit(evt) {
        const args = Array.prototype.slice.call(arguments, 1);
        (listeners[evt] || []).forEach(h => {
            try { h.apply(null, args); } catch (e) { console.error(e); }
        });
    }

    /** 建立房間
     * @param {number} capacity  房間容量 (1v1=2, 2v2=4)
     */
    function host(onCodeReady, onError, capacity) {
        cleanup();
        state.isHost = true;
        state.capacity = capacity || 2;
        state.code = makeCode();
        try {
            state.peer = new Peer(ID_PREFIX + state.code);
        } catch (e) {
            if (onError) onError(e.message || '無法建立 Peer');
            return;
        }
        state.peer.on('open', (id) => {
            if (onCodeReady) onCodeReady(state.code);
            emit('hosting', state.code);
        });
        state.peer.on('connection', (conn) => {
            // 房間已滿: 拒絕
            if (state.conns.length >= state.capacity - 1) {
                try { conn.close(); } catch (e) {}
                return;
            }
            state.conns.push(conn);
            state.conn = conn; // 相容 1v1 舊路徑 (最後一個)
            setupConn(conn, conn);
        });
        state.peer.on('error', (err) => {
            if (err && err.type === 'unavailable-id') {
                host(onCodeReady, onError, state.capacity);
                return;
            }
            emit('error', err.message || err.type || 'PeerJS 錯誤');
            if (onError) onError(err.message || err.type);
        });
    }

    /** 加入房間 */
    function join(code, onError) {
        cleanup();
        state.isHost = false;
        state.code = code.toUpperCase();
        try {
            state.peer = new Peer();
        } catch (e) {
            if (onError) onError(e.message);
            return;
        }
        state.peer.on('open', (id) => {
            const conn = state.peer.connect(ID_PREFIX + state.code, { reliable: true });
            state.conn = conn;
            setupConn(conn);
        });
        state.peer.on('error', (err) => {
            emit('error', err.message || err.type || 'PeerJS 錯誤');
            if (onError) onError(err.type === 'peer-unavailable' ? '房間不存在或已關閉' : (err.message || err.type));
        });
    }

    function setupConn(conn, fromConn) {
        conn.on('open', () => {
            state.connected = true;
            emit('open', conn);
        });
        conn.on('data', (data) => {
            // 房主收到某 guest 訊息, 轉發給其他 guest (2v2 relay)
            if (state.isHost && state.conns.length > 1 && data && !data._relayed) {
                const tagged = Object.assign({ _relayed: true }, data);
                for (let i = 0; i < state.conns.length; i++) {
                    const c = state.conns[i];
                    if (c !== conn && c.open) {
                        try { c.send(tagged); } catch (e) {}
                    }
                }
            }
            emit('data', data, conn);
        });
        conn.on('close', () => {
            // 移除斷開的連線
            if (state.isHost) {
                const idx = state.conns.indexOf(conn);
                if (idx >= 0) state.conns.splice(idx, 1);
                if (state.conns.length === 0) state.connected = false;
            } else {
                state.connected = false;
            }
            emit('close', conn);
        });
        conn.on('error', (err) => {
            emit('error', err.message || err.type || 'Conn error');
        });
    }

    /** 傳訊 (自動 JSON) — 房主會廣播給所有 guest, guest 送給房主 */
    function send(obj) {
        if (state.isHost) {
            for (let i = 0; i < state.conns.length; i++) {
                const c = state.conns[i];
                if (c && c.open) {
                    try { c.send(obj); } catch (e) {}
                }
            }
        } else if (state.conn && state.connected) {
            try { state.conn.send(obj); } catch (e) {}
        }
    }

    function disconnect() {
        cleanup();
        emit('disconnected');
    }

    function cleanup() {
        if (state.conns && state.conns.length) {
            for (let i = 0; i < state.conns.length; i++) {
                try { state.conns[i].close(); } catch (e) {}
            }
            state.conns = [];
        }
        if (state.conn) {
            try { state.conn.close(); } catch (e) {}
            state.conn = null;
        }
        if (state.peer) {
            try { state.peer.destroy(); } catch (e) {}
            state.peer = null;
        }
        state.connected = false;
        state.code = null;
        state.isHost = false;
        state.capacity = 2;
    }

    global.Multiplayer = {
        host: host,
        join: join,
        send: send,
        disconnect: disconnect,
        on: on,
        off: off,
        isHost: () => state.isHost,
        isConnected: () => state.connected,
        getCode: () => state.code,
        getCapacity: () => state.capacity,
        getConnections: () => state.conns,
        connectionCount: () => state.isHost ? state.conns.length : (state.conn ? 1 : 0)
    };
})(window);
