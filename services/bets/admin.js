// ფსონების სერვისის ადმინის ფუნქციები: სტატისტიკა ჟურნალიდან, მოთამაშეები, რიგი.
// თანხები ცენტებშია; ვალუტა: დემო ანგარიშები — 'DEMO', კაზინოს მოთამაშეები — კაზინოს ვალუტა.
import { join } from 'node:path';
import { readJsonl, tailJsonl } from '../lib/tail.js';
import { HttpError } from '../lib/http.js';

const TZ_OFFSET_MS = 4 * 3600 * 1000;            // თბილისი (UTC+4) — დღეები ადგილობრივი დროით
export const dayOf = ts => new Date(Date.parse(ts) + TZ_OFFSET_MS).toISOString().slice(0, 10);
const blank = () => ({ bets: 0, turnover: 0, cancelled: 0, refunded: 0, wins: 0, winCount: 0, players: new Set() });
const finish = a => {
  const staked = a.turnover - a.cancelled - a.refunded;
  return {
    bets: a.bets, turnover: a.turnover, cancelled: a.cancelled, refunded: a.refunded, staked,
    wins: a.wins, winCount: a.winCount, ggr: staked - a.wins, rtp: staked > 0 ? a.wins / staked : null, players: a.players.size
  };
};

export function adminApi(wallet, dataDir) {
  const ledgerPath = join(dataDir, 'ledger.jsonl');
  const currencyOf = token => wallet.players[token]?.ext?.currency || 'DEMO';

  /** დღიური და პერიოდის ჯამები ვალუტების მიხედვით */
  function stats(days = 14) {
    const today = dayOf(new Date().toISOString());
    const since = dayOf(new Date(Date.now() - (days - 1) * 86400000).toISOString());
    const byCur = new Map(), perPlayer = new Map();
    const cur = c => { if (!byCur.has(c)) byCur.set(c, { total: blank(), today: blank(), days: new Map() }); return byCur.get(c); };
    for (const e of readJsonl(ledgerPath)) {
      if (!['bet', 'win', 'cancel', 'refund'].includes(e.type)) continue;
      const c = cur(currencyOf(e.token)), d = dayOf(e.ts);
      const targets = [c.total];
      if (d >= since) { if (!c.days.has(d)) c.days.set(d, blank()); targets.push(c.days.get(d)); }
      if (d === today) targets.push(c.today);
      const p = perPlayer.get(e.token) || { bets: 0, turnover: 0, back: 0, wins: 0, lastAt: null };
      for (const t of targets) {
        if (e.type === 'bet') { t.bets++; t.turnover += e.amount; t.players.add(e.token); }
        else if (e.type === 'win') { t.wins += e.win; t.winCount++; }
        else if (e.type === 'cancel') { t.cancelled += e.amount; t.bets--; }
        else if (e.type === 'refund') t.refunded += e.amount;
      }
      if (e.type === 'bet') { p.bets++; p.turnover += e.amount; p.lastAt = e.ts; }
      else if (e.type === 'win') p.wins += e.win;
      else if (e.type === 'cancel') { p.back += e.amount; p.bets--; }
      else if (e.type === 'refund') p.back += e.amount;
      perPlayer.set(e.token, p);
    }
    const out = {};
    for (const [c, v] of byCur) {
      const series = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = dayOf(new Date(Date.now() - i * 86400000).toISOString());
        series.push({ day: d, ...finish(v.days.get(d) || blank()) });
      }
      out[c] = { total: finish(v.total), today: finish(v.today), days: series };
    }
    return { currencies: out, perPlayer: Object.fromEntries(perPlayer), today, since };
  }

  function players() {
    const { perPlayer } = stats(1);
    return Object.entries(wallet.players).map(([token, pl]) => {
      const s = perPlayer[token] || { bets: 0, turnover: 0, back: 0, wins: 0, lastAt: null };
      return {
        token, pid: pl.pid, name: pl.name, balance: pl.balance, createdAt: pl.createdAt || null,
        currency: pl.ext?.currency || 'DEMO', platform: pl.ext?.platform || null, playerId: pl.ext?.key?.split(':')[1] || null,
        bets: s.bets, turnover: s.turnover, wins: s.wins, pnl: s.wins + s.back - s.turnover, lastBetAt: s.lastAt,
        currentBet: wallet.bets.get(token) ? { car: wallet.bets.get(token).car, amount: wallet.bets.get(token).amount, state: wallet.bets.get(token).state } : null
      };
    }).sort((a, b) => (b.lastBetAt || b.createdAt || '').localeCompare(a.lastBetAt || a.createdAt || ''));
  }

  function ledger(limit = 200, type = null) {
    const types = type ? new Set(String(type).split(',')) : null;
    return tailJsonl(ledgerPath, Math.min(2000, limit), types ? e => types.has(e.type) : null).map(e => ({
      ...e, name: wallet.players[e.token]?.name || null, pid: wallet.players[e.token]?.pid || null, currency: currencyOf(e.token)
    }));
  }

  function setBalance(token, balance) {
    const pl = wallet.players[token];
    if (!pl) throw new HttpError(404, 'მოთამაშე ვერ მოიძებნა');
    if (pl.ext) throw new HttpError(409, 'კაზინოს მოთამაშის ბალანსს კაზინო მართავს');
    if (!Number.isInteger(balance) || balance < 0 || balance > 100_000_000) throw new HttpError(400, 'ბალანსი: 0 – 1 000 000.00 (ცენტებში)');
    const before = pl.balance;
    pl.balance = balance;
    wallet.store.append('ledger.jsonl', { type: 'admin_adjust', token, before, balance });
    wallet.store.write('players.json', wallet.players);
    wallet.emit('me_changed', { token, me: wallet.me(token) });
    return { token, balance };
  }

  return {
    routes: [
      ['GET', '/admin/stats', ({ query }) => { const s = stats(Math.max(1, Math.min(90, Number(query.get('days')) || 14))); delete s.perPlayer; return s; }],
      ['GET', '/admin/players', () => players()],
      ['GET', '/admin/ledger', ({ query }) => ledger(Number(query.get('limit')) || 200, query.get('type'))],
      ['GET', '/admin/outbox', () => wallet.outbox.map(o => ({ ...o, name: wallet.players[o.token]?.name || null }))],
      ['POST', '/admin/outbox/flush', async () => { await wallet.drain(); return { left: wallet.outbox.length }; }],
      ['POST', '/admin/players/:token/balance', ({ params, body }) => setBalance(params.token, body.balance)]
    ]
  };
}
