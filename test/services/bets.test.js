// ფსონების სერვისი იზოლირებულად — ნამდვილი რაუნდის სერვისის ნაცვლად ყალბი (stub),
// რომლის მოვლენებსა და პასუხებს ტესტი თავად მართავს.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBetsService } from '../../services/bets/service.js';
import { router, listen, EventHub, subscribe, apiClient, HttpError } from '../../services/lib/http.js';
import { payout } from '../../public/shared/math.js';

const KEY = 'bets-test-key';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** ყალბი რაუნდის სერვისი */
async function startFakeRound() {
  const hub = new EventHub();
  const f = {
    state: { phase: 'bet', round: 1, roundHash: 'h', phaseStart: Date.now(), raceStart: 0, betMs: 5000, endMs: 1000, speed: 1, cars: [0, 1, 2].map(() => ({ ended: false })) },
    accepting: true,
    checkDelay: 0,
    checkFn: () => ({ ok: false }),
    checks: [],
    down: false,
    emit(type, extra = {}) { hub.emit(type, { ...extra, state: structuredClone(f.state) }); }
  };
  const handler = router([
    ['GET', '/rounds/current', () => f.state],
    ['GET', '/rounds/accepting', () => ({ round: f.state.round, accepting: f.accepting })],
    ['POST', '/rounds/:round/check', async ({ params, body }) => {
      if (f.down) throw new HttpError(500, 'down');
      f.checks.push({ round: Number(params.round), ...body });
      await sleep(f.checkDelay);
      return f.checkFn({ round: Number(params.round), ...body });
    }],
    ['GET', '/events', ({ req, res }) => { hub.handle(req, res); }]
  ], { key: KEY });
  const { server, url } = await listen(handler);
  f.url = url;
  f.close = async () => { hub.close(); await new Promise(r => server.close(r)); server.closeAllConnections?.(); };
  f.newRound = round => { f.state = { ...f.state, phase: 'bet', round, phaseStart: Date.now(), raceStart: 0, cars: [0, 1, 2].map(() => ({ ended: false })) }; f.accepting = true; f.emit('bet_open'); };
  f.race = (speed = 1) => { f.state = { ...f.state, phase: 'race', raceStart: Date.now(), speed }; f.accepting = false; f.emit('race_started'); };
  f.carEnded = (car, crash100, type = 'crash') => { f.state.cars[car] = { ended: true, crash100, type }; f.emit('car_ended', { round: f.state.round, car, crash100, type }); };
  f.end = () => { f.state = { ...f.state, phase: 'end' }; f.emit('round_ended', { item: { round: f.state.round } }); };
  return f;
}

describe('ფსონების სერვისი (ყალბი რაუნდის სერვისით)', () => {
  let round, svc, api, dir, events, sub;

  const start = async () => {
    svc = await startBetsService({ dataDir: dir, key: KEY, roundUrl: round.url });
    api = apiClient(svc.url, KEY);
    events = [];
    sub = subscribe(svc.url + '/events', KEY, (type, data) => events.push({ event: type, ...data }));
    await sub.opened;
  };
  const until = async (pred, ms = 3000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(5); } };
  const ledger = () => existsSync(join(dir, 'ledger.jsonl')) ? readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  const settled = token => events.filter(e => e.event === 'settled' && e.token === token);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gr-bets-'));
    round = await startFakeRound();
    await start();
  });
  afterEach(async () => {
    sub.close(); await svc.close(); await round.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('API გასაღების გარეშე — 401; /health ღიაა', async () => {
    assert.equal((await fetch(svc.url + '/health')).status, 200);
    assert.equal((await fetch(svc.url + '/players', { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(svc.url + '/bets/current')).status, 401);
  });

  it('მოთამაშე: შექმნა, უცნობი token — 404', async () => {
    const { token, me } = await api.post('/players', { name: 'ანა' });
    assert.equal(me.balance, 100000); assert.equal(me.name, 'ანა');
    assert.deepEqual(await api.get(`/players/${token}`), me);
    await assert.rejects(api.get('/players/unknown'), e => e.status === 404);
  });

  it('ფსონი უარყოფილია, როცა რაუნდის სერვისი ფსონს არ იღებს', async () => {
    const { token } = await api.post('/players', {});
    round.accepting = false;
    await assert.rejects(api.post('/bets', { token, car: 0, amount: 1000 }), e => e.status === 409);
    assert.equal((await api.get(`/players/${token}`)).balance, 100000);
  });

  it('car_ended: ავტო ≤ crash იგებს ავტოზე, დანარჩენი იწვება — თითო ერთხელ', async () => {
    const a = (await api.post('/players', {})).token, b = (await api.post('/players', {})).token;
    await api.post('/bets', { token: a, car: 1, amount: 1000, auto: 250 });
    await api.post('/bets', { token: b, car: 1, amount: 500 });
    round.race();
    round.carEnded(1, 250);
    await until(() => settled(a).length && settled(b).length);
    assert.deepEqual(settled(a)[0].result, { state: 'won', car: 1, m100: 250, win: payout(1000, 250), amount: 1000 });
    assert.equal(settled(a)[0].me.balance, 100000 - 1000 + payout(1000, 250));
    assert.equal(settled(b)[0].result.state, 'lost');
    assert.equal(settled(b)[0].result.crash100, 250);
    round.carEnded(1, 250);      // განმეორებითი მოვლენა არაფერს ცვლის
    await sleep(50);
    assert.equal(settled(a).length, 1); assert.equal(settled(b).length, 1);
  });

  it('მოგების ზღვარი: კოეფიციენტი შეუზღუდავია, მოგება — არა (100 000.00)', async () => {
    const big = (await api.post('/players', {})).token, autoHi = (await api.post('/players', {})).token, small = (await api.post('/players', {})).token;
    // ბალანსი 1 000.00 — ფსონი 1 000.00 (მაქსიმუმი)
    await api.post('/bets', { token: big, car: 0, amount: 100000 });                 // ავტოს გარეშე
    await api.post('/bets', { token: autoHi, car: 0, amount: 50000, auto: 50000 });  // ავტო ×500 > ზღვრის ×200
    await api.post('/bets', { token: small, car: 0, amount: 100, auto: 50000 });     // 1.00 × 500 = 500.00 — ზღვარს ქვემოთ
    round.race();
    round.carEnded(0, 80000);                                                        // ×800 — ადრე ×100-ზე მოიჭრებოდა
    await until(() => settled(big).length && settled(autoHi).length && settled(small).length);
    assert.deepEqual(settled(big)[0].result, { state: 'won', car: 0, m100: 10000, win: 10_000_000, amount: 100000, maxWin: true });
    assert.deepEqual(settled(autoHi)[0].result, { state: 'won', car: 0, m100: 20000, win: 10_000_000, amount: 50000, maxWin: true });
    assert.deepEqual(settled(small)[0].result, { state: 'won', car: 0, m100: 50000, win: 50000, amount: 100 });
  });

  it('ხელით ქეშაუთი: რაუნდის სერვისი ადასტურებს და ადგენს კოეფიციენტს', async () => {
    const { token } = await api.post('/players', {});
    await api.post('/bets', { token, car: 0, amount: 2000 });
    round.race();
    await until(() => svc.wallet.state?.phase === 'race');
    round.checkFn = () => ({ ok: true, m100: 173 });
    const me = await api.post(`/bets/${token}/cashout`);
    assert.equal(me.bet.state, 'won'); assert.equal(me.bet.m100, 173);
    assert.equal(me.balance, 100000 - 2000 + payout(2000, 173));
    assert.deepEqual(round.checks.at(-1), { round: 1, car: 0 });
    await assert.rejects(api.post(`/bets/${token}/cashout`), e => e.status === 409);
  });

  it('რბოლა: ქეშაუთი და მანქანის გაჩერება ერთდროულად — ერთი ანგარიშსწორება, რაუნდის სერვისის სიტყვით', async () => {
    const { token } = await api.post('/players', {});
    await api.post('/bets', { token, car: 2, amount: 1000 });
    round.race();
    await until(() => svc.wallet.state?.phase === 'race');
    round.checkDelay = 150;
    round.checkFn = () => ({ ok: true, m100: 199 });
    const pending = api.post(`/bets/${token}/cashout`);
    await sleep(40);
    round.carEnded(2, 200);            // გაჩერება მოდის, სანამ check-ის პასუხი გზაშია
    const me = await pending;
    assert.equal(me.bet.state, 'won'); assert.equal(me.bet.m100, 199);
    await sleep(50);
    assert.equal(settled(token).length, 1);
    assert.equal(ledger().filter(e => e.token === token && (e.type === 'win' || e.type === 'lose')).length, 1);
  });

  it('დაგვიანებული ქეშაუთი (ok:false) — 409, ფსონი იწვება გაჩერებისას ერთხელ', async () => {
    const { token } = await api.post('/players', {});
    await api.post('/bets', { token, car: 0, amount: 1000 });
    round.race();
    await until(() => svc.wallet.state?.phase === 'race');
    round.checkDelay = 100;
    round.checkFn = () => ({ ok: false });
    const pending = api.post(`/bets/${token}/cashout`);
    await sleep(30);
    round.carEnded(0, 140);
    await assert.rejects(pending, e => e.status === 409);
    await until(() => settled(token).length === 1);
    assert.equal(settled(token)[0].result.state, 'lost');
  });

  it('რაუნდის სერვისი მიუწვდომელია — 503, ფსონი ღია რჩება და გაჩერებისას სწორდება', async () => {
    const { token } = await api.post('/players', {});
    await api.post('/bets', { token, car: 0, amount: 1000, auto: 300 });
    round.race();
    await until(() => svc.wallet.state?.phase === 'race');
    round.down = true;
    await assert.rejects(api.post(`/bets/${token}/cashout`), e => e.status === 503);
    assert.equal((await api.get(`/players/${token}`)).bet.state, 'open');
    round.carEnded(0, 500);
    await until(() => settled(token).length === 1);
    assert.equal(settled(token)[0].result.state, 'won');
    assert.equal(settled(token)[0].result.m100, 300);
  });

  it('ავტო-ქეშაუთი დროზე ითხოვს დადასტურებას და იგებს გაჩერებამდე', async () => {
    const { token } = await api.post('/players', {});
    await api.post('/bets', { token, car: 1, amount: 1000, auto: 120 });
    round.checkFn = ({ m100 }) => ({ ok: m100 <= 400, m100 });
    round.race(20);                     // ×1.20 ≈ 2.0 წმ / 20 = ~100 მწმ
    await until(() => settled(token).length === 1, 2000);
    assert.equal(settled(token)[0].result.m100, 120);
    assert.deepEqual(round.checks.at(-1), { round: 1, car: 1, m100: 120 });
  });

  it('გაუქმება: ბრუნდება თანხა; რბოლის დროს — 409', async () => {
    const { token } = await api.post('/players', {});
    await api.post('/bets', { token, car: 0, amount: 700 });
    const me = await api.del(`/bets/${token}`);
    assert.equal(me.balance, 100000); assert.equal(me.bet, null);
    await api.post('/bets', { token, car: 0, amount: 700 });
    round.race();
    await assert.rejects(api.del(`/bets/${token}`), e => e.status === 409);
  });

  it('ახალი რაუნდი ასუფთავებს ფსონებს; საჯარო სია token-ს არ შეიცავს', async () => {
    const { token } = await api.post('/players', { name: 'ლუკა' });
    await api.post('/bets', { token, car: 0, amount: 700 });
    const pub = await api.get('/bets/current');
    assert.equal(pub.bets.length, 1);
    assert.ok(!JSON.stringify(pub).includes(token));
    round.race(); round.carEnded(0, 100); round.carEnded(1, 100); round.carEnded(2, 100); round.end();
    round.newRound(2);
    await until(() => svc.wallet.state?.round === 2);
    assert.deepEqual(await api.get('/bets/current'), { round: 2, bets: [] });
    assert.equal((await api.get(`/players/${token}`)).bet, null);
  });

  it('ახალი რაუნდი ფსონის მქონე მოთამაშეს უგზავნის განახლებულ me-ს (bet: null)', async () => {
    const { token } = await api.post('/players', { name: 'ნინო' });
    const me = await api.post('/bets', { token, car: 1, amount: 500 });
    assert.equal(me.bet.round, 1);
    round.race(); round.carEnded(1, 100); round.end();
    await until(() => settled(token).length === 1);
    round.newRound(2);
    await until(() => events.some(e => e.event === 'me_changed' && e.token === token));
    const ev = events.find(e => e.event === 'me_changed' && e.token === token);
    assert.equal(ev.me.bet, null);
    assert.equal(ev.me.balance, 100000 - 500);
  });

  it('ავარია რბოლის შუაში: გადატვირთვისას ღია ფსონი ბრუნდება', async () => {
    const { token } = await api.post('/players', {});
    await api.post('/bets', { token, car: 0, amount: 4000 });
    round.race();
    await until(() => existsSync(join(dir, 'pending.json')) && readFileSync(join(dir, 'pending.json'), 'utf8') !== 'null');
    sub.close(); await svc.close();
    await start();
    assert.equal((await api.get(`/players/${token}`)).balance, 100000);
    assert.ok(ledger().some(e => e.type === 'refund' && e.token === token && e.amount === 4000));
  });
});
