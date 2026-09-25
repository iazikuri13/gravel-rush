// რაუნდის სერვისი იზოლირებულად — მხოლოდ მისი HTTP/SSE API.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRoundService } from '../../services/round/service.js';
import { subscribe, apiClient } from '../../services/lib/http.js';
import { buildChain, roundResults } from '../../services/round/fair.js';

const KEY = 'round-test-key';
const SECRET = 'round-test-secret';
const CS = 'round-cs';

describe('რაუნდის სერვისი', () => {
  let svc, api, dir, events = [], sub, chain;
  const waitEvent = (pred, timeout = 15000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      const hit = events.find(pred);
      if (hit) { clearInterval(i); res(hit); } else if (Date.now() - t0 > timeout) { clearInterval(i); rej(new Error('event timeout')); }
    }, 10);
  });

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gr-round-'));
    svc = await startRoundService({ dataDir: dir, key: KEY, secret: SECRET, clientSeed: CS, chainLength: 100, betMs: 400, endMs: 150, speed: 20 });
    api = apiClient(svc.url, KEY);
    chain = buildChain(SECRET, 100);
    sub = subscribe(svc.url + '/events', KEY, (type, data) => events.push({ event: type, ...data }));
    await sub.opened;
    svc.start();
  });
  after(async () => { sub.close(); await svc.close(); rmSync(dir, { recursive: true, force: true }); });

  it('/health ღიაა, დანარჩენი გასაღების გარეშე 401', async () => {
    assert.equal((await fetch(svc.url + '/health')).status, 200);
    for (const p of ['/fairness', '/rounds/current', '/rounds/history', '/rounds/accepting', '/events']) {
      assert.equal((await fetch(svc.url + p)).status, 401, p);
    }
    assert.equal((await fetch(svc.url + '/fairness', { headers: { 'x-internal-key': 'wrong-key-000' } })).status, 401);
    assert.equal((await fetch(svc.url + '/rounds/1/check', { method: 'POST', body: '{}' })).status, 401);
  });

  it('/fairness აცხადებს ჯაჭვის commit-ს', async () => {
    assert.deepEqual(await api.get('/fairness'), { commit: chain[0], chainLength: 100, clientSeed: CS });
  });

  it('მოვლენები მიდის სწორი თანმიმდევრობით და შედეგები ემთხვევა ჯაჭვს', async () => {
    const end = await waitEvent(e => e.event === 'round_ended' && e.item.round === 1);
    const seq = events.filter(e => (e.state?.round ?? e.round) === 1 || e.item?.round === 1).map(e => e.event);
    assert.deepEqual(seq, ['bet_open', 'race_started', 'car_ended', 'car_ended', 'car_ended', 'round_ended']);
    const exp = roundResults(chain[1], CS);
    const ends = events.filter(e => e.event === 'car_ended' && e.round === 1);
    for (const e of ends) { assert.equal(e.crash100, exp[e.car].crash100); assert.equal(e.type, exp[e.car].type); }
    for (let k = 1; k < ends.length; k++) assert.ok(exp[ends[k - 1].car].crash100 <= exp[ends[k].car].crash100);
    assert.equal(end.item.seed, chain[1]);
    assert.equal(end.item.hash, chain[0]);
    assert.deepEqual(end.item.results, exp);
  });

  it('გაუჩერებელი მანქანის შედეგი არ ჩანს არც მოვლენებში, არც /rounds/current-ში', async () => {
    for (const e of events) for (const c of e.state?.cars || []) if (!c.ended) assert.deepEqual(c, { ended: false });
    const s = await api.get('/rounds/current');
    for (const c of s.cars) if (!c.ended) assert.deepEqual(c, { ended: false });
  });

  it('accepting: ფსონების ფაზაში true, რბოლაში false', async () => {
    const open = await waitEvent(e => e.event === 'bet_open' && e.state.round >= 2);
    const a = await api.get('/rounds/accepting');
    assert.deepEqual(a, { round: open.state.round, accepting: true });
    await waitEvent(e => e.event === 'race_started' && e.state.round === open.state.round);
    assert.equal((await api.get('/rounds/accepting')).accepting, false);
  });

  it('check: ავტო ≤ crash — ok; > crash — არა; სხვა რაუნდი — არა; ხელით — მიმდინარე კოეფიციენტი', async () => {
    // ვეძებთ რაუნდს, სადაც რომელიმე მანქანა ≥ ×3-ია, რომ რბოლის შუაში მოვასწროთ
    let r, car, exp;
    for (;;) {
      const open = await waitEvent(e => e.event === 'bet_open' && e.state.round > (r ?? 2));
      r = open.state.round; exp = roundResults(chain[r], CS);
      car = exp.findIndex(x => x.crash100 >= 300);
      if (car >= 0) break;
    }
    await waitEvent(e => e.event === 'race_started' && e.state.round === r);
    const c = exp[car].crash100;
    assert.deepEqual(await api.post(`/rounds/${r}/check`, { car, m100: c }), { ok: true, m100: c });
    assert.deepEqual(await api.post(`/rounds/${r}/check`, { car, m100: c + 1 }), { ok: false, m100: c + 1 });
    assert.deepEqual(await api.post(`/rounds/${r - 1}/check`, { car, m100: 101 }), { ok: false });
    const manual = await api.post(`/rounds/${r}/check`, { car });
    assert.equal(manual.ok, true);
    assert.ok(manual.m100 >= 100 && manual.m100 < c);
    await assert.rejects(api.post(`/rounds/${r}/check`, { car: 5 }), /car/);
  });

  it('გადატვირთვისას რაუნდის ნომერი გრძელდება (seed ხელახლა არ გამოიყენება)', async () => {
    const last = (await api.get('/rounds/current')).round;
    await svc.close(); sub.close();
    svc = await startRoundService({ dataDir: dir, key: KEY, betMs: 400, endMs: 150, speed: 20 });
    api = apiClient(svc.url, KEY);
    events = [];
    sub = subscribe(svc.url + '/events', KEY, (type, data) => events.push({ event: type, ...data }));
    await sub.opened;
    svc.start();
    const open = await waitEvent(e => e.event === 'bet_open');
    assert.equal(open.state.round, last + 1);
    assert.equal((await api.get('/fairness')).commit, chain[0]);
  });
});
