// ადმინი გარედან: შესვლა, დაცვა, სტატისტიკა, მოთამაშეები, ბალანსის შეცვლა.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSystem } from './helpers/system.js';

const PASSWORD = 'test-admin-password';

describe('ადმინი', () => {
  let sys, cookie = '';
  const call = async (path, body, withCookie = true) => {
    const r = await fetch(sys.url + '/admin/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(withCookie && cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) };
  };

  before(async () => { sys = await startSystem({ betMs: 1200, env: { ADMIN_PASSWORD: PASSWORD, DEMO_HASH_KEY: 'demo-hash-key-must-stay-secret' } }); });
  after(() => sys.stop());

  it('გვერდი იხსნება, API შესვლის გარეშე დახურულია', async () => {
    const page = await fetch(sys.url + '/admin/');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(await page.text(), /ადმინი/);
    assert.equal((await fetch(sys.url + '/admin', { redirect: 'manual' })).status, 301);
    for (const p of ['/me', '/overview', '/players', '/ledger', '/rounds', '/integrations']) assert.equal((await call(p)).status, 401, p);
    assert.equal((await call('/players/' + 'a'.repeat(32) + '/balance', { balance: 1 })).status, 401);
  });

  it('არასწორი პაროლი — 401; ხშირი ცდა იბლოკება', async () => {
    assert.equal((await call('/login', { password: 'wrong' }, false)).status, 401);
    for (let k = 0; k < 4; k++) await call('/login', { password: 'wrong' + k }, false);
    const r = await call('/login', { password: PASSWORD }, false);
    assert.equal(r.status, 429);
  });

  it('სწორი პაროლით: HttpOnly cookie და მონაცემები', async () => {
    // წინა ტესტმა ეს IP დაბლოკა ერთი წუთით; სხვა კლიენტს ვაჩვენებთ x-forwarded-for-ით (პროქსის მიერ დამატებული)
    const r = await fetch(sys.url + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' }, body: JSON.stringify({ password: PASSWORD }) });
    assert.equal(r.status, 200);
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\/admin/);
    cookie = sc.split(';')[0];
    assert.equal((await call('/me')).status, 200);
    const forged = await fetch(sys.url + '/admin/api/me', { headers: { cookie: 'gr_admin=9999999999999.deadbeef' } });
    assert.equal(forged.status, 401);
  });

  it('ფსონი ჩანს სტატისტიკაში, ჟურნალში და მოთამაშეებში; რბოლები ინახება', async () => {
    const c = await sys.connect({ name: 'ადმინ-ტესტი' });
    const s = await c.freshBetPhase();
    assert.equal((await c.request({ t: 'bet', car: 1, amount: 2000 })).t, 'me');
    await c.roundEnd(s.round);
    await new Promise(r => setTimeout(r, 300));

    const o = (await call('/overview')).data;
    assert.ok(o.round.round >= s.round);
    const demo = o.stats.currencies.DEMO;
    assert.ok(demo.today.staked >= 2000);
    assert.equal(demo.days.length, 14);
    assert.equal(demo.today.ggr, demo.today.staked - demo.today.wins);
    assert.ok(o.rounds.some(r => r.round === s.round && r.results.length === 3 && r.seed));

    const ledger = (await call('/ledger?limit=50&type=bet')).data;
    assert.ok(ledger.some(e => e.type === 'bet' && e.name === 'ადმინ-ტესტი' && e.amount === 2000));
    assert.ok(ledger.every(e => e.type === 'bet'));

    const players = (await call('/players')).data;
    const me = players.find(p => p.name === 'ადმინ-ტესტი');
    assert.equal(me.currency, 'DEMO'); assert.equal(me.bets, 1); assert.equal(me.turnover, 2000);
    assert.equal(me.pnl, me.wins - 2000);

    const rounds = (await call('/rounds?limit=5')).data;
    assert.ok(rounds.length >= 1 && rounds[0].round >= s.round);
  });

  it('დემო ბალანსის შეცვლა: მოთამაშე მაშინვე ხედავს; არასწორი თანხა — შეცდომა', async () => {
    const c = await sys.connect({ name: 'ბალანსი-ტესტი' });
    const p = (await call('/players')).data.find(x => x.name === 'ბალანსი-ტესტი');
    const from = c.mark();
    assert.equal((await call(`/players/${p.token}/balance`, { balance: 12345 })).status, 200);
    const me = await c.waitFor(m => m.t === 'me' && m.balance === 12345, { from });
    assert.equal(me.balance, 12345);
    assert.equal((await call(`/players/${p.token}/balance`, { balance: -5 })).status, 400);
    assert.equal((await call(`/players/${'b'.repeat(32)}/balance`, { balance: 100 })).status, 404);
    const adj = (await call('/ledger?type=admin_adjust')).data;
    assert.ok(adj.some(e => e.balance === 12345 && e.name === 'ბალანსი-ტესტი'));
  });

  it('ინტეგრაციები: საიდუმლო გასაღები არ ჩანს', async () => {
    const d = (await call('/integrations')).data;
    const demo = d.platforms.find(p => p.id === 'upgaming-demo');
    assert.ok(demo);
    assert.equal(demo.hashKey, '••••');
    assert.ok(!JSON.stringify(d).includes('demo-hash-key-must-stay-secret'));
    assert.ok(!JSON.stringify((await call('/overview')).data).includes('demo-hash-key-must-stay-secret'));
  });

  it('გასვლა აუქმებს cookie-ს', async () => {
    const r = await call('/logout', {});
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  });
});
