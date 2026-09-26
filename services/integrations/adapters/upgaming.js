// Upgaming Reverse Integration (Integration API specification).
//
// Upgaming → ჩვენ (აქ, routes):   GET  GetGames, GET LaunchGame, POST AddFreeBet, POST CancelFreeBet
// ჩვენ → Upgaming (walletUrl):    GET  /balance, POST /transactions  (BET, WIN, ROLLBACK, FREESPINWIN)
//
// ჰეში: hash("{CasinoSessionId}{Currency}{GameId}{playerid}{HashKey}") სათაურში, მნიშვნელობა "SHA-512=<hash>".
// სპეციფიკაცია ალგორითმზე ერთმანეთს ეწინააღმდეგება (გვ. 3: SHA512, გვ. 8: SHA256), სათაურის სახელი
// და კოდირება კი ცალსახად არ წერია — ამიტომ ყველა კონფიგურირებადია (hashAlgo, hashHeader, hashEncoding).
import { createHash, randomUUID } from 'node:crypto';
import { PlatformError } from '../errors.js';

export const ERROR_STATUS = {
  INVALID_SIGNATURE: 400, PLAYER_NOT_FOUND: 404, GAME_NOT_FOUND: 404, INVALID_CURRENCY: 400,
  INVALID_IP: 400, SESSION_EXPIRED: 403, TRANSACTION_NOT_FOUND: 404, INTERNAL_ERROR: 500,
  TRANSACTION_ALREADY_PROCESSED: 403, BET_DENIED: 403, INSUFFICIENT_FUNDS: 403
};
const perr = (code, msg) => new PlatformError(code, msg || code, ERROR_STATUS[code] || 400);

export const DEFAULTS = {
  hashAlgo: 'sha512',          // sha512 | sha256
  hashEncoding: 'hex',         // hex | base64
  hashHeader: 'SecretKey',
  hashPrefix: 'SHA-512=',
  currencies: ['USD', 'EUR', 'GEL'],
  closeRoundWithZeroWin: true, // წაგებულ რაუნდს WIN 0-ით ვხურავთ
  timeoutMs: 8000
};

/** ჰეშის მნიშვნელობა სათაურისთვის (ორივე მხარე ერთნაირად ითვლის) */
export function signature(cfg, { casinoSessionId, currency, gameId, playerId }) {
  const c = { ...DEFAULTS, ...cfg };
  const h = createHash(c.hashAlgo).update(`${casinoSessionId}${currency}${gameId}${playerId}${c.hashKey}`).digest(c.hashEncoding);
  return c.hashPrefix + h;
}

// სპეციფიკაციაში პარამეტრების რეგისტრი არათანმიმდევრულია (casinoSessionId / casinosessionid) — ვკითხულობთ რეგისტრის გარეშე
const q = (query, name) => { for (const [k, v] of query) if (k.toLowerCase() === name.toLowerCase()) return v; return null; };
const money = cents => Math.round(cents) / 100;
const cents = amount => Math.round(Number(amount) * 100);

export default function upgaming(cfgIn, hub) {
  const cfg = { ...DEFAULTS, ...cfgIn };
  if (!cfg.walletUrl || !cfg.hashKey || !cfg.operatorId || cfg.providerId == null) {
    throw new Error(`upgaming (${cfg.id}): აუცილებელია walletUrl, hashKey, operatorId, providerId`);
  }
  const wallet = cfg.walletUrl.replace(/\/$/, '');
  const checkIp = req => {
    if (!cfg.allowedIps?.length) return;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, '');
    if (!cfg.allowedIps.includes(ip)) throw perr('INVALID_IP', `IP ${ip} არ არის სიაში`);
  };
  const checkOperator = id => { if (String(id ?? '') !== String(cfg.operatorId)) throw perr('INVALID_SIGNATURE', 'უცნობი operatorId'); };

  async function call(method, path, { query, body, sig }) {
    const url = wallet + path + (query ? '?' + new URLSearchParams(query) : '');
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', [cfg.hashHeader]: sig },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
    } catch (e) {
      throw new PlatformError('PLATFORM_UNAVAILABLE', `Upgaming მიუწვდომელია: ${e.message}`, 503);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.errorcode) {
      const code = data.errorcode || 'INTERNAL_ERROR';
      throw new PlatformError(code, data.errormessage || code, r.ok ? 400 : r.status);
    }
    return data;
  }

  const sigFor = s => signature(cfg, { casinoSessionId: s.platformSessionId, currency: s.currency, gameId: s.gameId, playerId: s.playerId });
  const TYPE = { bet: 'BET', win: 'WIN', rollback: 'ROLLBACK' };

  return {
    closeRoundWithZeroWin: cfg.closeRoundWithZeroWin,

    /** Upgaming-ის შეცდომის ფორმატი: { errorcode, errormessage } */
    formatError(e) {
      const code = e.code && ERROR_STATUS[e.code] ? e.code : 'INTERNAL_ERROR';
      return { status: ERROR_STATUS[code], body: { errorcode: code, errormessage: e.message || code } };
    },

    routes: [
      ['GET', '/GetGames', ({ query, req }) => {
        checkIp(req);
        checkOperator(q(query, 'key') ?? q(query, 'operatorId'));
        return hub.games().map(g => ({
          Id: g.id, Name: g.name, DemoAvailable: g.demo, MobileSupport: g.mobile, FreespinSupport: g.freespins,
          ProviderId: cfg.providerId, Type: g.type, ImageLink: hub.url(g.image)
        }));
      }],

      ['GET', '/LaunchGame', ({ query, req }) => {
        checkIp(req);
        checkOperator(q(query, 'operatorId'));
        const gameId = q(query, 'gameId'), currency = (q(query, 'currency') || '').toUpperCase();
        const playerId = q(query, 'casinoPlayerId'), sessionId = q(query, 'casinoSessionId');
        const device = (q(query, 'device') || '').toUpperCase();
        if (!hub.findGame(gameId)) throw perr('GAME_NOT_FOUND', 'თამაში ვერ მოიძებნა');
        if (!cfg.currencies.includes(currency)) throw perr('INVALID_CURRENCY', `ვალუტა ${currency || '—'} არ არის მხარდაჭერილი`);
        if (!playerId) throw perr('PLAYER_NOT_FOUND', 'casinoPlayerId აკლია');
        if (!sessionId) throw perr('SESSION_EXPIRED', 'casinoSessionId აკლია');
        if (device && !['MOBILE', 'DESKTOP'].includes(device)) throw perr('INTERNAL_ERROR', 'device: MOBILE | DESKTOP');
        const { url } = hub.createSession(cfg.id, {
          playerId, currency, platformSessionId: sessionId, gameId,
          device, locale: (q(query, 'locale') || 'en').toLowerCase(), lobbyUrl: q(query, 'lobbyUrl')
        });
        return { url };
      }],

      ['POST', '/AddFreeBet', ({ body, req }) => {
        checkIp(req);
        checkOperator(body.operatorId);
        const games = Array.isArray(body.games) ? body.games.map(String) : [];
        if (!games.length || games.some(g => !hub.findGame(g))) throw perr('GAME_NOT_FOUND', 'games სიაში უცნობი თამაშია');
        const currency = String(body.currency || '').toUpperCase();
        if (!cfg.currencies.includes(currency)) throw perr('INVALID_CURRENCY');
        if (!body.casinoPlayerid && !body.casinoPlayerId) throw perr('PLAYER_NOT_FOUND');
        const fb = hub.addFreebet(cfg.id, {
          id: body.casinobonusid || randomUUID(),
          playerId: String(body.casinoPlayerid ?? body.casinoPlayerId), currency, games,
          amount: cents(body.amount), level: body.level || null
        });
        return { FreeBetGuid: fb.id };
      }],

      ['POST', '/CancelFreeBet', ({ body, req }) => {
        checkIp(req);
        if (body.operatorId != null) checkOperator(body.operatorId);
        hub.cancelFreebet(cfg.id, String(body.id || ''));
        return {};
      }]
    ],

    /** ბალანსი ცენტებში */
    async balance(s) {
      const d = await call('GET', '/balance', {
        sig: sigFor(s),
        query: { casinoPlayerId: s.playerId, currency: s.currency, casinosessionid: s.platformSessionId, gameid: s.gameId, providerid: cfg.providerId }
      });
      return cents(d.Amount ?? d.amount);
    },

    /** tx: { id, kind, roundId, amount (ცენტები), ref?, bonusId? } → { balance (ცენტები), platformTx } */
    async transact(s, tx) {
      const body = {
        id: tx.id, type: tx.bonusId && tx.kind === 'win' ? 'FREESPINWIN' : TYPE[tx.kind],
        gameid: s.gameId, casinoPlayerid: s.playerId, currency: s.currency,
        casinosessionid: s.platformSessionId, roundid: tx.roundId, providerid: cfg.providerId,
        amount: money(tx.amount)
      };
      if (tx.kind === 'rollback') body.rollbackTransactionId = tx.ref;
      if (tx.bonusId) body.casinobonusid = tx.bonusId;
      try {
        const d = await call('POST', '/transactions', { body, sig: sigFor(s) });
        return { balance: cents(d.balance ?? d.Balance), platformTx: d.id ?? null };
      } catch (e) {
        // გამეორებული მოთხოვნა (მაგ. პასუხი გზაში დაიკარგა) — ტრანზაქცია უკვე გატარებულია, ესე იგი წარმატებაა
        if (e.code === 'TRANSACTION_ALREADY_PROCESSED') return { balance: await this.balance(s), platformTx: null, repeated: true };
        throw e;
      }
    }
  };
}
