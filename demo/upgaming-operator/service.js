// სატესტო პლატფორმა — Upgaming-ის მხარის იმიტაცია დოკუმენტის („Upgaming Reverse Integration“) მიხედვით.
// რეალური ფული არ არის. საჭიროა შუამავლის (services/integrations) შესამოწმებლად და დემონსტრაციისთვის.
//
// საფულე (ჩვენი შუამავალი იძახებს):
//   GET  /balance        ?casinoPlayerId&currency&casinosessionid&gameid&providerid   + ჰეში სათაურში
//   POST /transactions   { id, type, gameid, casinoPlayerid, currency, casinosessionid, roundid, providerid, amount, rollbackTransactionId?, casinobonusid? }
//
// ლობი (ბრაუზერი):
//   GET  /               გვერდი: მოთამაშე → თამაშის გაშვება, ბალანსი, ტრანზაქციები, ფრიბეტები
//   GET  /api/state · GET /api/games · POST /api/launch · POST /api/deposit · POST /api/freebet · POST /api/freebet/cancel · POST /api/reset
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { router, listen, sendJson, HttpError } from '../../services/lib/http.js';
import { signature, DEFAULTS, ERROR_STATUS } from '../../services/integrations/adapters/upgaming.js';

const PAGE = join(dirname(fileURLToPath(import.meta.url)), 'page.html');
const START_PLAYERS = [
  { id: 'nino-gel', name: 'ნინო', currency: 'GEL', balance: 250 },
  { id: 'luka-usd', name: 'ლუკა', currency: 'USD', balance: 100 },
  { id: 'ana-eur', name: 'ანა', currency: 'EUR', balance: 40 }
];
const r2 = x => Math.round(x * 100) / 100;

export async function startDemoOperator({ port = 0, host = '127.0.0.1', operatorId = 'demo-operator', providerId = 777, hashKey, hash = {}, providerUrl = null }) {
  if (!hashKey) throw new Error('hashKey აუცილებელია');
  const cfg = { ...DEFAULTS, ...hash, hashKey };
  const st = { players: new Map(), sessions: new Map(), txs: new Map(), log: [], freebets: [], seq: 1000 };
  const reset = () => {
    st.players = new Map(START_PLAYERS.map(p => [p.id, { ...p }]));
    st.sessions.clear(); st.txs.clear(); st.log = []; st.freebets = [];
  };
  reset();

  const fail = (code, msg) => { const e = new HttpError(ERROR_STATUS[code] || 400, msg || code); e.code = code; throw e; };
  const verify = (req, f) => {
    const got = String(req.headers[cfg.hashHeader.toLowerCase()] || '');
    if (!got.startsWith(cfg.hashPrefix)) fail('INVALID_SIGNATURE', `სათაური ${cfg.hashHeader} უნდა იწყებოდეს ${cfg.hashPrefix}-ით`);
    if (got !== signature(cfg, f)) fail('INVALID_SIGNATURE', 'ჰეში არ ემთხვევა');
  };
  const sessionFor = (sid, playerId, currency, gameId) => {
    const s = st.sessions.get(String(sid));
    if (!s) fail('SESSION_EXPIRED', 'სესია ვერ მოიძებნა');
    const pl = st.players.get(String(playerId));
    if (!pl || s.playerId !== pl.id) fail('PLAYER_NOT_FOUND');
    if (String(currency) !== pl.currency) fail('INVALID_CURRENCY');
    if (gameId != null && String(gameId) !== s.gameId) fail('GAME_NOT_FOUND');
    return { s, pl };
  };
  const logTx = (t) => { st.log.unshift({ at: new Date().toISOString(), ...t }); st.log.length = Math.min(st.log.length, 200); };

  // ---------- საფულე: Upgaming-ის ფორმატი და შეცდომები ----------
  const walletRoutes = [
    ['GET', '/balance', ({ query, req }) => {
      const f = { casinoSessionId: query.get('casinosessionid'), currency: query.get('currency'), gameId: query.get('gameid'), playerId: query.get('casinoPlayerId') };
      verify(req, f);
      if (Number(query.get('providerid')) !== providerId) fail('INVALID_SIGNATURE', 'უცნობი providerid');
      const { pl } = sessionFor(f.casinoSessionId, f.playerId, f.currency, f.gameId);
      return { Status: 'Success', Currency: pl.currency, Amount: pl.balance };
    }],
    ['POST', '/transactions', ({ body, req }) => {
      const b = body || {};
      verify(req, { casinoSessionId: b.casinosessionid, currency: b.currency, gameId: b.gameid, playerId: b.casinoPlayerid });
      if (Number(b.providerid) !== providerId) fail('INVALID_SIGNATURE', 'უცნობი providerid');
      for (const k of ['id', 'type', 'roundid']) if (b[k] == null || b[k] === '') fail('INTERNAL_ERROR', `აკლია ${k}`);
      const amount = Number(b.amount);
      if (!(amount >= 0)) fail('INTERNAL_ERROR', 'amount არასწორია');
      const { pl } = sessionFor(b.casinosessionid, b.casinoPlayerid, b.currency, b.gameid);
      if (st.txs.has(String(b.id))) fail('TRANSACTION_ALREADY_PROCESSED');
      const type = String(b.type).toUpperCase();
      if (type === 'BET') {
        if (amount > pl.balance + 1e-9) fail('INSUFFICIENT_FUNDS');
        pl.balance = r2(pl.balance - amount);
      } else if (type === 'WIN' || type === 'FREESPINWIN') {
        if (type === 'FREESPINWIN' && !b.casinobonusid) fail('INTERNAL_ERROR', 'FREESPINWIN-ს სჭირდება casinobonusid');
        pl.balance = r2(pl.balance + amount);
      } else if (type === 'ROLLBACK') {
        const orig = st.txs.get(String(b.rollbackTransactionId || ''));
        if (!orig) fail('TRANSACTION_NOT_FOUND');
        if (orig.rolledBack) fail('TRANSACTION_ALREADY_PROCESSED');
        if (orig.type !== 'BET') fail('BET_DENIED', 'დაბრუნება მხოლოდ ფსონზე შეიძლება');
        orig.rolledBack = true;
        pl.balance = r2(pl.balance + orig.amount);
      } else fail('INTERNAL_ERROR', `უცნობი ტიპი ${type}`);
      const id = ++st.seq;
      st.txs.set(String(b.id), { id, type, amount: type === 'ROLLBACK' ? st.txs.get(String(b.rollbackTransactionId)).amount : amount, playerId: pl.id });
      logTx({ id, providerTx: String(b.id), type, amount: type === 'ROLLBACK' ? st.txs.get(String(b.rollbackTransactionId)).amount : amount, player: pl.id, currency: pl.currency, round: b.roundid, balance: pl.balance });
      return { id, balance: pl.balance };
    }]
  ].map(([m, p, fn]) => [m, p, async ctx => {
    try { return await fn(ctx); }
    catch (e) {
      const code = e.code && ERROR_STATUS[e.code] ? e.code : 'INTERNAL_ERROR';
      if (code === 'INTERNAL_ERROR' && !e.code) console.error(e);
      sendJson(ctx.res, ERROR_STATUS[code], { errorcode: code, errormessage: e.message });
    }
  }]);

  // ---------- ლობი: ბრაუზერის API ----------
  const provider = async (method, path, { query, body } = {}) => {
    if (!api.providerUrl) throw new HttpError(503, 'პროვაიდერის მისამართი არ არის მითითებული');
    const url = api.providerUrl.replace(/\/$/, '') + path + (query ? '?' + new URLSearchParams(query) : '');
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status, data.errormessage || data.error || `HTTP ${r.status}`, data.errorcode);
    return data;
  };
  const uiRoutes = [
    ['GET', '/', ({ res }) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(readFileSync(PAGE)); }],
    ['GET', '/api/state', () => ({
      operatorId, providerId, players: [...st.players.values()], log: st.log.slice(0, 60), freebets: st.freebets,
      sessions: [...st.sessions.entries()].map(([id, s]) => ({ id, ...s })).slice(-10)
    })],
    ['GET', '/api/games', () => provider('GET', '/GetGames', { query: { key: operatorId } })],
    ['POST', '/api/launch', async ({ body }) => {
      const pl = st.players.get(String(body.playerId));
      if (!pl) throw new HttpError(404, 'მოთამაშე ვერ მოიძებნა');
      const casinoSessionId = randomUUID(), gameId = String(body.gameId || '1001');
      st.sessions.set(casinoSessionId, { playerId: pl.id, gameId, createdAt: new Date().toISOString() });
      const r = await provider('GET', '/LaunchGame', { query: {
        currency: body.currency || pl.currency, device: body.device === 'DESKTOP' ? 'DESKTOP' : 'MOBILE', locale: 'ka',
        gameId, casinoSessionId, lobbyUrl: body.lobbyUrl || '/demo-operator/', casinoPlayerId: pl.id, operatorId
      } });
      return { url: r.url, casinoSessionId };
    }],
    ['POST', '/api/deposit', ({ body }) => {
      const pl = st.players.get(String(body.playerId));
      if (!pl) throw new HttpError(404, 'მოთამაშე ვერ მოიძებნა');
      const a = Number(body.amount);
      if (!(a > 0 && a <= 10000)) throw new HttpError(400, 'თანხა 0-დან 10 000-მდე');
      pl.balance = r2(pl.balance + a);
      logTx({ id: '—', type: 'DEPOSIT', amount: a, player: pl.id, currency: pl.currency, balance: pl.balance });
      return pl;
    }],
    ['POST', '/api/freebet', async ({ body }) => {
      const pl = st.players.get(String(body.playerId));
      if (!pl) throw new HttpError(404, 'მოთამაშე ვერ მოიძებნა');
      const casinobonusid = randomUUID();
      const r = await provider('POST', '/AddFreeBet', { body: {
        casinoPlayerid: pl.id, currency: pl.currency, casinobonusid, games: [String(body.gameId || '1001')],
        amount: Number(body.amount || 1), level: 'min', operatorId
      } });
      st.freebets.unshift({ id: r.FreeBetGuid, player: pl.id, amount: Number(body.amount || 1), state: 'active' });
      return r;
    }],
    ['POST', '/api/freebet/cancel', async ({ body }) => {
      await provider('POST', '/CancelFreeBet', { body: { id: String(body.id), operatorId } });
      const fb = st.freebets.find(f => f.id === String(body.id)); if (fb) fb.state = 'cancelled';
      return { ok: true };
    }],
    ['POST', '/api/reset', () => { reset(); return { ok: true }; }]
  ];

  const handler = router([...walletRoutes, ...uiRoutes]);
  const { server, port: p, url } = await listen(handler, { port, host });
  const api = {
    url, port: p, providerUrl, state: st,
    setProviderUrl(u) { api.providerUrl = u; },
    async close() { await new Promise(r => server.close(r)); server.closeAllConnections?.(); }
  };
  return api;
}
