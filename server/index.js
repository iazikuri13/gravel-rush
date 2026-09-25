import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { Game, GameError, RULES } from './game.js';
import { G, MAX_CRASH_100 } from '../public/shared/math.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const store = new Store(process.env.DATA_DIR || join(ROOT, 'data'));
const game = new Game(store, { clientSeed: process.env.CLIENT_SEED });

// ---------- სტატიკური ფაილები ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/api/fairness') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ commit: game.commit, chainLength: store.meta.chainLength, clientSeed: game.clientSeed, history: game.history }));
  }
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([\\/]\.\.)+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ვერ მოიძებნა');
  }
});

// ---------- WebSocket ----------
// ALLOWED_ORIGINS="https://my-game.lovable.app,https://example.com" — სხვა საიტები ვერ დაუკავშირდებიან.
// ცარიელი = მხოლოდ იგივე დომენი, რომელიც სერვერს ემსახურება (+ localhost).
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const originOk = ({ origin, req }) => {
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === req.headers.host || o.hostname === 'localhost' || ALLOWED.includes(o.origin);
  } catch { return false; }
};
const wss = new WebSocketServer({ server: http, maxPayload: 4096, verifyClient: originOk });
const socketsByToken = new Map();   // token → Set<ws>

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const toToken = (token, msg) => { for (const ws of socketsByToken.get(token) || []) send(ws, msg); };
const broadcast = msg => { const s = JSON.stringify(msg); for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s); };

const snap = () => broadcast({ t: 'snap', now: Date.now(), online: wss.clients.size, ...game.publicState() });
let snapTimer = null;
const snapSoon = () => { if (!snapTimer) snapTimer = setTimeout(() => { snapTimer = null; snap(); }, 100); };

game.on('snap', snap);
game.on('snapSoon', snapSoon);
game.on('end', () => broadcast({ t: 'history', items: game.history }));
game.on('result', b => {
  const car = game.cars[b.car];
  toToken(b.token, {
    t: 'result', state: b.state, car: b.car, m100: b.m100, win: b.win, amount: b.amount,
    ...(b.state === 'lost' ? { crash100: car.crash100, type: car.type } : {})
  });
  toToken(b.token, { t: 'me', now: Date.now(), ...game.myState(b.token) });
});

wss.on('connection', ws => {
  let token = null;
  let budget = 20;                                   // მარტივი rate limit: 20 შეტყობინება/წმ
  const refillBudget = setInterval(() => { budget = 20; }, 1000);
  ws.on('close', () => {
    clearInterval(refillBudget);
    if (token) socketsByToken.get(token)?.delete(ws);
    snapSoon();
  });

  ws.on('message', raw => {
    if (--budget < 0) return ws.close(1008, 'rate limit');
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      if (token) return;
      const r = game.join(typeof msg.token === 'string' ? msg.token : null, msg.name);
      token = r.token;
      if (!socketsByToken.has(token)) socketsByToken.set(token, new Set());
      socketsByToken.get(token).add(ws);
      send(ws, {
        t: 'welcome', token,
        commit: game.commit, chainLength: store.meta.chainLength, clientSeed: game.clientSeed,
        rules: { betMs: RULES.betMs, endMs: RULES.endMs, G, minBet: RULES.minBet, maxBet: RULES.maxBet, maxCrash100: MAX_CRASH_100 }
      });
      send(ws, { t: 'history', items: game.history });
      send(ws, { t: 'me', now: Date.now(), ...game.myState(token) });
      send(ws, { t: 'snap', now: Date.now(), online: wss.clients.size, ...game.publicState() });
      snapSoon();
      return;
    }
    if (!token) return;

    try {
      switch (msg.t) {
        case 'bet': game.placeBet(token, { car: msg.car, amount: msg.amount, auto: msg.auto ?? null }); break;
        case 'cancel': game.cancelBet(token); break;
        case 'cashout': game.cashOut(token); break;
        case 'refill': game.refill(token); break;
        case 'name': game.rename(token, msg.name); snapSoon(); break;
        case 'ping': return send(ws, { t: 'pong', id: msg.id, now: Date.now() });
        default: return;
      }
      toToken(token, { t: 'me', now: Date.now(), ...game.myState(token) });
    } catch (e) {
      if (e instanceof GameError) send(ws, { t: 'err', msg: e.message });
      else { console.error(e); send(ws, { t: 'err', msg: 'სერვერის შეცდომა' }); }
    }
  });
});

http.listen(PORT, () => {
  console.log(`Gravel Rush → http://localhost:${PORT}`);
  console.log(`commit (ჯაჭვის ბოლო ჰეში): ${game.commit}`);
  console.log(`client seed: ${game.clientSeed}  ·  შემდეგი რაუნდი: #${store.meta.nextRound}`);
  game.start();
});

const shutdown = () => { store.savePlayersNow(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
