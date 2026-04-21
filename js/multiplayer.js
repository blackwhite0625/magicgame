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
        conn: null,
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

    /** 建立房間: 回傳 code (6 碼), 等訪客連入後 emit 'ready' */
    function host(onCodeReady, onError) {
        cleanup();
        state.isHost = true;
        state.code = makeCode();
        // 使用自訂 peer ID, 訪客直接以 code 連入
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
            state.conn = conn;
            setupConn(conn);
        });
        state.peer.on('error', (err) => {
            // ID 撞到別人正好用時會 err, 換一組 code
            if (err && err.type === 'unavailable-id') {
                host(onCodeReady, onError);
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

    function setupConn(conn) {
        conn.on('open', () => {
            state.connected = true;
            emit('open');
        });
        conn.on('data', (data) => {
            emit('data', data);
        });
        conn.on('close', () => {
            state.connected = false;
            emit('close');
        });
        conn.on('error', (err) => {
            emit('error', err.message || err.type || 'Conn error');
        });
    }

    /** 傳訊 (自動 JSON) */
    function send(obj) {
        if (state.conn && state.connected) {
            try { state.conn.send(obj); } catch (e) { /* ignore */ }
        }
    }

    function disconnect() {
        cleanup();
        emit('disconnected');
    }

    function cleanup() {
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
        getCode: () => state.code
    };
})(window);
