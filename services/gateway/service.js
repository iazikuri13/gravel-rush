// გეითვეი — ბრაუზერის ერთადერთი შესასვლელი: სტატიკური ფაილები + WebSocket.
// თავად არაფერს წყვეტს: ბრძანებებს ფსონების სერვისს გადასცემს, ორივე სერვისის
// მოვლენებს აერთიანებს და მოთამაშეებს უგზავნის. ბრაუზერის პროტოკოლი უცვლელია.
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import { subscribe, apiClient, HttpError } from '../lib/http.js';
import { RULES } from '../lib/rules.js';
import { createAdmin } from './admin.js';
import { G, MAX_CRASH_100 } from '../../public/shared/math.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export async function startGateway({ port = 3000, host, publicDir, key, roundUrl, betsUrl, allowedOrigins = [], proxies = [], integrationsUrl = null, adminPassword = null }) {
  const round = apiClient(roundUrl, key);
  const bets = apiClient(betsUrl, key);

  // ---------- მდგომარეობის ასლი (მხოლოდ საჩვენებლად) ----------
  let fairness = await round.get('/fairness');
  let roundState = await round.get('/rounds/current');
  let history = await round.get('/rounds/history');
  let betList = (await bets.get('/bets/current')).bets;

  // ---------- HTTP ----------
  // გადამისამართება შიდა სერვისებზე: { prefix: '/p/', target: 'http://127.0.0.1:…', strip: false }
  const proxy = (req, res, p) => {
    const path = p.strip ? req.url.slice(p.prefix.length - 1) || '/' : req.url;
    const t = new URL(p.target);
    const headers = { ...req.headers, host: t.host, 'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ') };
    const up = httpRequest({ hostname: t.hostname, port: t.port, method: req.method, path, headers }, r => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); } res.end('სერვისი მიუწვდომელია'); });
    req.pipe(up);
  };

  const http = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname.startsWith('/admin/api/')) return admin(req, res, url);
    if (url.pathname === '/admin') { res.writeHead(301, { location: '/admin/' }); return res.end(); }
    const px = proxies.find(p => url.pathname.startsWith(p.prefix) || url.pathname + '/' === p.prefix);
    if (px) {
      if (url.pathname + '/' === px.prefix) { res.writeHead(301, { location: px.prefix + url.search }); return res.end(); }
      return proxy(req, res, px);
    }
    if (url.pathname === '/api/fairness') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ...fairness, history }));
    }
    const rel = normalize(decodeURIComponent(url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname)).replace(/^([\\/]\.\.)+/, '');
    const file = join(publicDir, rel);
    if (!file.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(file);
      const extra = rel.startsWith('/admin') || rel.startsWith('\\admin') ? { 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } : {};
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', ...extra });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ვერ მოიძებნა');
    }
  });

  // ---------- WebSocket ----------
  // ALLOWED_ORIGINS — სხვა დომენები, რომლებსაც დაკავშირება შეუძლიათ; ყოველთვის: იგივე ჰოსტი და localhost
  const originOk = ({ origin, req }) => {
    if (!origin) return true;
    try {
      const o = new URL(origin);
      return o.host === req.headers.host || o.hostname === 'localhost' || allowedOrigins.includes(o.origin);
    } catch { return false; }
  };
  const admin = createAdmin({
    password: adminPassword, round, bets,
    integrations: integrationsUrl ? apiClient(integrationsUrl, key) : null,
    online: () => wss.clients.size
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 4096, verifyClient: originOk });
  const socketsByToken = new Map();

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const toToken = (token, msg) => { for (const ws of socketsByToken.get(token) || []) send(ws, msg); };
  const broadcast = msg => { const s = JSON.stringify(msg); for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s); };
  const publicState = () => ({
    phase: roundState.phase, round: roundState.round, roundHash: roundState.roundHash,
    phaseStart: roundState.phaseStart, raceStart: roundState.raceStart, cars: roundState.cars, bets: betList
  });
  const snap = () => broadcast({ t: 'snap', now: Date.now(), online: wss.clients.size, ...publicState() });
  let snapTimer = null;
  const snapSoon = () => { if (!snapTimer) snapTimer = setTimeout(() => { snapTimer = null; snap(); }, 100); };

  // ---------- სერვისების მოვლენები ----------
  const roundSub = subscribe(roundUrl + '/events', key, (type, data) => {
    roundState = data.state;
    if (type === 'bet_open') betList = [];
    if (type === 'round_ended') { history = [data.item, ...history].slice(0, RULES.historySize); broadcast({ t: 'history', items: history }); }
    snap();
  }, { onOpen: async () => { try { roundState = await round.get('/rounds/current'); history = await round.get('/rounds/history'); } catch {} } });

  const betsSub = subscribe(betsUrl + '/events', key, (type, data) => {
    if (type === 'bets_changed') {
      if (data.round === roundState.round) { betList = data.bets; snapSoon(); }
    } else if (type === 'settled') {
      toToken(data.token, { t: 'result', ...data.result });
      toToken(data.token, { t: 'me', now: Date.now(), ...data.me });
    } else if (type === 'me_changed') {
      toToken(data.token, { t: 'me', now: Date.now(), ...data.me });
    }
  });
  await Promise.all([roundSub.opened, betsSub.opened]);

  wss.on('connection', ws => {
    let token = null;
    let budget = 20;                                   // rate limit: 20 შეტყობინება/წმ
    const refillBudget = setInterval(() => { budget = 20; }, 1000);
    ws.on('close', () => {
      clearInterval(refillBudget);
      if (token) socketsByToken.get(token)?.delete(ws);
      snapSoon();
    });

    ws.on('message', async raw => {
      if (--budget < 0) return ws.close(1008, 'rate limit');
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'ping') return send(ws, { t: 'pong', id: msg.id, now: Date.now() });

      if (msg.t === 'hello') {
        if (token) return;
        token = 'pending';
        try {
          const r = await bets.post('/players', typeof msg.session === 'string'
            ? { session: msg.session }
            : { token: typeof msg.token === 'string' ? msg.token : undefined, name: msg.name });
          token = r.token;
          if (!socketsByToken.has(token)) socketsByToken.set(token, new Set());
          socketsByToken.get(token).add(ws);
          send(ws, {
            t: 'welcome', token, ...fairness,
            rules: { betMs: roundState.betMs, endMs: roundState.endMs, speed: roundState.speed, G, minBet: RULES.minBet, maxBet: RULES.maxBet, maxCrash100: MAX_CRASH_100 }
          });
          send(ws, { t: 'history', items: history });
          send(ws, { t: 'me', now: Date.now(), ...r.me });
          send(ws, { t: 'snap', now: Date.now(), online: wss.clients.size, ...publicState() });
          snapSoon();
        } catch (e) { token = null; send(ws, { t: 'err', msg: errMsg(e) }); }
        return;
      }
      if (!token || token === 'pending') return;

      const enc = encodeURIComponent(token);
      const calls = {
        bet: () => bets.post('/bets', { token, car: msg.car, amount: msg.amount, auto: msg.auto ?? null }),
        cancel: () => bets.del(`/bets/${enc}`),
        cashout: () => bets.post(`/bets/${enc}/cashout`),
        refill: () => bets.post(`/players/${enc}/refill`),
        name: () => bets.patch(`/players/${enc}`, { name: msg.name })
      };
      if (!calls[msg.t]) return;
      try {
        const me = await calls[msg.t]();
        toToken(token, { t: 'me', re: msg.id, now: Date.now(), ...me });
        if (msg.t === 'name') snapSoon();
      } catch (e) {
        send(ws, { t: 'err', re: msg.id, msg: errMsg(e) });
      }
    });
  });

  await new Promise(r => http.listen(port, host, r));
  const actualPort = http.address().port;
  return {
    port: actualPort, url: `http://localhost:${actualPort}`,
    async close() {
      roundSub.close(); betsSub.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise(r => http.close(r)); http.closeAllConnections?.();
    }
  };
}

function errMsg(e) {
  if (e instanceof HttpError && e.status < 500) return e.message;
  if (e instanceof HttpError && e.status === 503) return e.message;
  console.error(e);
  return 'სერვერის შეცდომა';
}
