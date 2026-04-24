/* ================================================================
   room.js — Room Durable Object (每房一個 instance)

   職責:
     - 接受 WebSocket 升級 (hibernation API, 不會因 DO restart 掉線)
     - 管理房內 slot (host=0, guest=1,2,3...)
     - 轉發信令訊息 (hello / signal / leave)
     - 廣播 peer-join / peer-leave
     - 回覆 /status (給大亂鬥分房查人數)

   訊息格式 (JSON):
   Client → Server:
     {type:'hello', role:'host'|'guest', name:string, capacity:number}
     {type:'signal', to:slotNum, data:<SDP/ICE>}
     {type:'ping'}
     {type:'leave'}
   Server → Client:
     {type:'joined', slot, hostSlot, peers:[{slot, name, role}]}
     {type:'peer-join', slot, name, role}
     {type:'peer-leave', slot}
     {type:'signal', from:slot, data}
     {type:'room-full'}
     {type:'error', msg}
     {type:'pong'}
   ================================================================ */

const MAX_MESSAGE_SIZE = 64 * 1024;   // 64 KB per message (SDP 夠用)
const MAX_SLOTS = 16;                  // 單房最多 16 人 (對戰 4, 大亂鬥 12)
const IDLE_TIMEOUT_MS = 60 * 1000;     // 60 秒沒訊息視為 idle

export class Room {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.ctx = state;  // alias (hibernation API 用的是 ctx)
        // 從 storage 救回 slot 配置 (DO 可能被 evict 又回來)
        this._loaded = false;
    }

    async loadState() {
        if (this._loaded) return;
        const data = await this.state.storage.get(['capacity']);
        this.capacity = (data && data.get('capacity')) || 0;  // 0 = 無限
        this._loaded = true;
    }

    async fetch(request) {
        await this.loadState();

        const url = new URL(request.url);
        const path = url.pathname;

        // 內部查詢端點 (給 /brawl-match 用)
        if (path === '/status') {
            const count = this.getActiveCount();
            return new Response(JSON.stringify({
                count,
                capacity: this.capacity
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        // WebSocket 升級
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }

        const role = url.searchParams.get('role');
        const name = (url.searchParams.get('name') || 'Player').slice(0, 16);
        const capacityParam = parseInt(url.searchParams.get('capacity'), 10);

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        // Hibernation API — 即使 DO restart, WS 仍保留
        this.ctx.acceptWebSocket(server);

        // Slot 分配
        const activeWs = this.ctx.getWebSockets();
        const usedSlots = new Set();
        for (const w of activeWs) {
            if (w === server) continue;
            const att = this._readAttachment(w);
            if (att && typeof att.slot === 'number') usedSlots.add(att.slot);
        }

        let slot;
        if (role === 'host') {
            // host 永遠拿 slot 0 — 若已被占 (重連), 踢掉舊的
            for (const w of activeWs) {
                if (w === server) continue;
                const att = this._readAttachment(w);
                if (att && att.slot === 0) {
                    try { w.close(1000, 'host replaced'); } catch (e) {}
                }
            }
            slot = 0;
            // host 設定房間容量
            if (!isNaN(capacityParam) && capacityParam >= 0) {
                this.capacity = capacityParam;
                await this.state.storage.put('capacity', capacityParam);
            }
        } else {
            // guest — 挑最小未用 slot (>= 1)
            // 容量檢查: 0 = 無限, >0 = 上限
            const cap = this.capacity || 0;
            const currentCount = activeWs.length;  // 含 server 本身
            if (cap > 0 && currentCount > cap) {
                server.close(1008, 'room full');
                return new Response(null, { status: 101, webSocket: client });
            }
            slot = -1;
            for (let i = 1; i < MAX_SLOTS; i++) {
                if (!usedSlots.has(i)) { slot = i; break; }
            }
            if (slot < 0) {
                server.close(1008, 'room full');
                return new Response(null, { status: 101, webSocket: client });
            }
        }

        const meta = {
            slot,
            name,
            role,
            joinedAt: Date.now()
        };
        this._writeAttachment(server, meta);

        // 通知新人: joined + peer list
        const peers = [];
        for (const w of this.ctx.getWebSockets()) {
            if (w === server) continue;
            const att = this._readAttachment(w);
            if (att) peers.push({ slot: att.slot, name: att.name, role: att.role });
        }
        this._sendTo(server, {
            type: 'joined',
            slot,
            hostSlot: 0,
            peers,
            capacity: this.capacity
        });

        // 通知其他人: peer-join
        this._broadcastExcept(server, {
            type: 'peer-join',
            slot,
            name,
            role
        });

        return new Response(null, { status: 101, webSocket: client });
    }

    // ==== Hibernation API 事件 ====
    async webSocketMessage(ws, message) {
        await this.loadState();

        if (typeof message !== 'string') {
            // 忽略二進位 (本協定全 JSON)
            return;
        }
        if (message.length > MAX_MESSAGE_SIZE) {
            this._sendTo(ws, { type: 'error', msg: 'message too large' });
            return;
        }

        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            this._sendTo(ws, { type: 'error', msg: 'invalid json' });
            return;
        }

        const myMeta = this._readAttachment(ws);
        if (!myMeta) {
            this._sendTo(ws, { type: 'error', msg: 'not registered' });
            return;
        }

        switch (msg.type) {
            case 'ping':
                this._sendTo(ws, { type: 'pong', t: msg.t });
                return;

            case 'signal': {
                // 轉發給指定 slot
                const to = msg.to;
                if (typeof to !== 'number') {
                    this._sendTo(ws, { type: 'error', msg: 'signal.to must be number' });
                    return;
                }
                const target = this._findBySlot(to);
                if (!target) {
                    // 對方已離線, 忽略
                    return;
                }
                this._sendTo(target, {
                    type: 'signal',
                    from: myMeta.slot,
                    data: msg.data
                });
                return;
            }

            case 'leave':
                try { ws.close(1000, 'client leave'); } catch (e) {}
                return;

            default:
                this._sendTo(ws, { type: 'error', msg: 'unknown type: ' + msg.type });
        }
    }

    async webSocketClose(ws, code, reason, wasClean) {
        const meta = this._readAttachment(ws);
        if (meta) {
            this._broadcastExcept(ws, {
                type: 'peer-leave',
                slot: meta.slot
            });
        }
    }

    async webSocketError(ws, error) {
        const meta = this._readAttachment(ws);
        if (meta) {
            this._broadcastExcept(ws, {
                type: 'peer-leave',
                slot: meta.slot
            });
        }
    }

    // ==== 輔助 ====
    getActiveCount() {
        return this.ctx.getWebSockets().length;
    }

    _findBySlot(slot) {
        for (const w of this.ctx.getWebSockets()) {
            const att = this._readAttachment(w);
            if (att && att.slot === slot) return w;
        }
        return null;
    }

    _sendTo(ws, obj) {
        try {
            ws.send(JSON.stringify(obj));
        } catch (e) {
            // WS 已關 — 忽略
        }
    }

    _broadcastExcept(exceptWs, obj) {
        const payload = JSON.stringify(obj);
        for (const w of this.ctx.getWebSockets()) {
            if (w === exceptWs) continue;
            try { w.send(payload); } catch (e) {}
        }
    }

    _readAttachment(ws) {
        try { return ws.deserializeAttachment(); } catch (e) { return null; }
    }

    _writeAttachment(ws, meta) {
        try { ws.serializeAttachment(meta); } catch (e) {}
    }
}
