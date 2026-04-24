/* ================================================================
   index.js — Magic Runes Cloudflare Worker (signaling + TURN proxy)

   路由:
     GET  /                → 健康檢查
     GET  /turn            → 回傳 Cloudflare Realtime TURN 短期憑證
     GET  /brawl-match     → 大亂鬥自動分房 (找空房 or 建新房)
     WS   /ws?room=XXX&role=host|guest&name=...&capacity=2|4|0
                           → 升級為 WebSocket, 轉發到對應房間的 Durable Object

   CORS: 預設全開 (Pages 域名與 Worker 域名不同, 必須允許)
   ================================================================ */

import { Room } from './room.js';
export { Room };

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
};

const MAX_BRAWL_ROOMS = 20;    // 最多同時 20 間大亂鬥房
const MAX_PER_BRAWL = 12;      // 每房上限 12 人

function jsonResponse(obj, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
            ...extraHeaders
        }
    });
}

function textResponse(text, status = 200) {
    return new Response(text, {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS }
    });
}

// 房號格式檢查: 2~16 字元, 英數字底線
function isValidRoomCode(code) {
    return typeof code === 'string' && /^[A-Z0-9_]{2,16}$/i.test(code);
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        try {
            if (path === '/' || path === '/health') {
                return textResponse('Magic Runes Signaling Worker OK');
            }

            if (path === '/turn') {
                return await handleTurn(env);
            }

            if (path === '/brawl-match') {
                return await handleBrawlMatch(env);
            }

            if (path === '/ws') {
                return await handleWebSocketUpgrade(request, env, url);
            }

            return textResponse('Not found', 404);
        } catch (err) {
            console.error('Worker error:', err);
            return jsonResponse({ error: 'internal error', message: String(err && err.message) }, 500);
        }
    }
};

// ================================================================
// TURN credential 代理
//
// 三段式 fallback:
//   1. 如果設了 Cloudflare TURN_APP_ID + TURN_APP_TOKEN → 用 CF TURN (最穩定, 要付費)
//   2. 如果設了 METERED_API_KEY (metered.ca 免費帳號) → 用 metered 的個人 credential
//   3. 都沒設 → 用公開免費 TURN (openrelay) + 多組 STUN (免錢但偶爾不穩)
//
// 多數情況下 (3) 就夠用 — 因為大部分連線問題是信令, 不是 TURN
// ================================================================

// 公開免費 TURN + 多組 STUN (fallback 用)
const PUBLIC_ICE_SERVERS = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Open Relay Project — 免費公開 TURN, 無需註冊
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
];

async function handleTurn(env) {
    // 優先使用 Cloudflare Realtime TURN (需要付費計畫)
    if (env.TURN_APP_ID && env.TURN_APP_TOKEN) {
        try {
            const res = await fetch(
                `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_APP_ID}/credentials/generate`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.TURN_APP_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ ttl: 86400 })
                }
            );
            if (res.ok) {
                const data = await res.json();
                let iceServers = data.iceServers;
                if (iceServers && !Array.isArray(iceServers)) iceServers = [iceServers];
                return jsonResponse({
                    iceServers: [
                        { urls: 'stun:stun.cloudflare.com:3478' },
                        ...(iceServers || [])
                    ],
                    source: 'cloudflare'
                });
            }
            console.warn('CF TURN failed', res.status);
        } catch (err) {
            console.error('CF TURN error:', err);
        }
    }

    // 次選: Metered.ca 免費註冊 (每月 50 GB)
    if (env.METERED_API_KEY) {
        try {
            const res = await fetch(
                `https://magicrunes.metered.live/api/v1/turn/credentials?apiKey=${env.METERED_API_KEY}`
            );
            if (res.ok) {
                const iceServers = await res.json();
                return jsonResponse({
                    iceServers: Array.isArray(iceServers) ? iceServers : [iceServers],
                    source: 'metered'
                });
            }
        } catch (err) {
            console.error('Metered TURN error:', err);
        }
    }

    // 最後: 公開免費 (openrelay + STUN)
    return jsonResponse({
        iceServers: PUBLIC_ICE_SERVERS,
        source: 'public-fallback'
    });
}

// ================================================================
// 大亂鬥分房: 依序檢查 BRAWL1..BRAWL20, 找第一個未滿的房 (或空房)
// 每個房是獨立的 Durable Object instance
// ================================================================
async function handleBrawlMatch(env) {
    for (let i = 1; i <= MAX_BRAWL_ROOMS; i++) {
        const code = `BRAWL${i}`;
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        try {
            // DO 的 /status 端點會回傳當前人數
            const res = await stub.fetch('https://do/status');
            if (!res.ok) continue;
            const data = await res.json();
            if ((data.count || 0) < MAX_PER_BRAWL) {
                return jsonResponse({ room: code, count: data.count, capacity: MAX_PER_BRAWL });
            }
        } catch (err) {
            // DO 錯誤視為空房 (新建)
            return jsonResponse({ room: code, count: 0, capacity: MAX_PER_BRAWL, fresh: true });
        }
    }
    // 全滿 — 隨機挑一間 (通常不會發生)
    const idx = Math.floor(Math.random() * MAX_BRAWL_ROOMS) + 1;
    return jsonResponse({ room: `BRAWL${idx}`, overflow: true });
}

// ================================================================
// WebSocket 升級: 驗參數後把 request 直接丟給對應房間的 DO
// ================================================================
async function handleWebSocketUpgrade(request, env, url) {
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return textResponse('Expected WebSocket upgrade', 426);
    }

    const room = url.searchParams.get('room');
    const role = url.searchParams.get('role');
    const capacityStr = url.searchParams.get('capacity');

    if (!isValidRoomCode(room)) {
        return textResponse('invalid room code', 400);
    }
    if (role !== 'host' && role !== 'guest') {
        return textResponse('invalid role', 400);
    }

    const id = env.ROOMS.idFromName(room.toUpperCase());
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
}
