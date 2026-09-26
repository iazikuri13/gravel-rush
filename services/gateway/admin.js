// ადმინის API გეითვეიზე: /admin/api/*
// შესვლა პაროლით (ADMIN_PASSWORD) → ხელმოწერილი, HttpOnly cookie 12 საათით.
// მონაცემებს თავად არ ინახავს — კითხულობს round, bets და integrations სერვისების შიდა API-დან.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sendJson, HttpError } from '../lib/http.js';
import { RULES } from '../lib/rules.js';

const COOKIE = 'gr_admin', TTL_MS = 12 * 3600 * 1000;

export function createAdmin({ password, round, bets, integrations, online, startedAt = Date.now() }) {
  const secret = randomBytes(32);
  const sign = exp => createHmac('sha256', secret).update(String(exp)).digest('hex');
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
  const attempts = new Map();   // ip → { n, until }

  const cookieOf = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(p => p.trim().split('=')).filter(p => p.length === 2))[COOKIE];
  const authed = req => {
    const c = cookieOf(req); if (!c) return false;
    const [exp, mac] = c.split('.');
    return Number(exp) > Date.now() && same(mac, sign(exp));
  };
  // ბოლო მნიშვნელობა — რასაც Render-ის პროქსი ამატებს; პირველს კლიენტი შეიძლება თავად წერდეს
  const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
  const secure = req => (req.headers['x-forwarded-proto'] || '').includes('https');
  const setCookie = (req, res, value, maxAge) => res.setHeader('set-cookie',
    `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);

  async function readBody(req) {
    let data = '';
    for await (const c of req) { data += c; if (data.length > 4096) throw new HttpError(413, 'too large'); }
    try { return data ? JSON.parse(data) : {}; } catch { throw new HttpError(400, 'invalid json'); }
  }

  const routes = {
    'GET /overview': async () => {
      const [stats, cur, fairness, pub, rounds, outbox, integ] = await Promise.all([
        bets.get('/admin/stats?days=14'), round.get('/rounds/current'), round.get('/fairness'),
        bets.get('/bets/current'), round.get('/admin/rounds?limit=12'), bets.get('/admin/outbox'),
        integrations ? integrations.get('/admin/overview?limit=1').catch(() => null) : null
      ]);
      return {
        now: Date.now(), uptimeSec: Math.round((Date.now() - startedAt) / 1000), online: online(),
        round: { round: cur.round, phase: cur.phase, cars: cur.cars, betMs: cur.betMs, endMs: cur.endMs },
        fairness, currentBets: pub.bets, rounds, outboxLength: outbox.length, stats,
        platforms: integ ? integ.platforms.length : 0,
        rules: { minBet: RULES.minBet, maxBet: RULES.maxBet, startBalance: RULES.startBalance }
      };
    },
    'GET /stats': ({ q }) => bets.get(`/admin/stats?days=${Number(q.get('days')) || 14}`),
    'GET /rounds': ({ q }) => round.get(`/admin/rounds?limit=${Number(q.get('limit')) || 200}`),
    'GET /players': () => bets.get('/admin/players'),
    'GET /ledger': ({ q }) => bets.get(`/admin/ledger?limit=${Number(q.get('limit')) || 200}${q.get('type') ? '&type=' + encodeURIComponent(q.get('type')) : ''}`),
    'GET /outbox': () => bets.get('/admin/outbox'),
    'POST /outbox/flush': () => bets.post('/admin/outbox/flush'),
    'GET /integrations': () => integrations ? integrations.get('/admin/overview?limit=200') : { platforms: [], freebets: [], journal: [] }
  };

  return async function handle(req, res, url) {
    res.setHeader('cache-control', 'no-store');
    const path = url.pathname.slice('/admin/api'.length) || '/';
    try {
      if (req.method === 'POST' && path === '/login') {
        const ip = ipOf(req), a = attempts.get(ip);
        if (a && a.n >= 5 && a.until > Date.now()) throw new HttpError(429, 'ძალიან ბევრი მცდელობა — სცადე ერთ წუთში');
        const { password: p } = await readBody(req);
        if (!password || !same(p || '', password)) {
          const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 60000 };
          cur.n++; attempts.set(ip, cur);
          throw new HttpError(401, 'პაროლი არასწორია');
        }
        attempts.delete(ip);
        const exp = Date.now() + TTL_MS;
        setCookie(req, res, `${exp}.${sign(exp)}`, TTL_MS / 1000);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/logout') { setCookie(req, res, '', 0); return sendJson(res, 200, { ok: true }); }
      if (!authed(req)) throw new HttpError(401, 'შესვლა საჭიროა');
      if (req.method === 'GET' && path === '/me') return sendJson(res, 200, { ok: true });

      const bal = path.match(/^\/players\/([0-9a-f]{32})\/balance$/);
      if (req.method === 'POST' && bal) {
        const body = await readBody(req);
        return sendJson(res, 200, await bets.post(`/admin/players/${bal[1]}/balance`, { balance: body.balance }));
      }
      const fn = routes[`${req.method} ${path}`];
      if (!fn) throw new HttpError(404, 'not found');
      sendJson(res, 200, await fn({ q: url.searchParams }));
    } catch (e) {
      sendJson(res, e instanceof HttpError ? e.status : 500, { error: e instanceof HttpError ? e.message : 'სერვერის შეცდომა' });
      if (!(e instanceof HttpError)) console.error('admin:', e);
    }
  };
}
