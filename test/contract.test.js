// კონტრაქტული ტესტები: სისტემის ქცევა გარედან (WebSocket + HTTP).
// ისინი ერთნაირად უნდა გადიოდეს მონოლითზეც და სერვისებად დაშლილ სისტემაზეც.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startSystem, sleep, CLIENT_SEED, CHAIN_LENGTH } from './helpers/system.js';
import { payout, timeFor } from '../public/shared/math.js';

const START_BALANCE = 100000;

describe('კავშირი და ანგარიში', () => {
  let sys;
  before(async () => { sys = await startSystem(); });
  after(() => sys.stop());

  it('welcome აცხადებს commit-ს, client seed-ს და წესებს', async () => {
    const c = await sys.connect();
    assert.equal(c.welcome.commit, sys.chain[0]);
    assert.equal(c.welcome.clientSeed, CLIENT_SEED);
    assert.equal(c.welcome.chainLength, CHAIN_LENGTH);
    assert.match(c.welcome.token, /^[0-9a-f]{32}$/);
    assert.equal(c.welcome.rules.betMs, sys.betMs);
    const me = c.lastMe();
    assert.equal(me.balance, START_BALANCE);
    assert.match(me.name, /^მრბოლელი-/);
    assert.equal(me.bet, null);
  });

  it('snap შეიცავს მიმდინარე რაუნდის ჰეშს ჯაჭვიდან', async () => {
    const c = await sys.connect();
    const s = c.lastSnap();
    assert.ok(s.round >= 1);
    assert.equal(s.roundHash, sys.chain[s.round - 1]);
    assert.equal(s.cars.length, 3);
  });

  it('იგივე token-ით დაბრუნება ინარჩუნებს ანგარიშს და სახელს', async () => {
    const a = await sys.connect({ name: 'ტესტერი' });
    assert.equal(a.lastMe().name, 'ტესტერი');
    const r = await a.request({ t: 'name', name: 'ახალი სახელი' });
    assert.equal(r.t, 'me');
    a.close();
    const b = await sys.connect({ token: a.token });
    assert.equal(b.token, a.token);
    assert.equal(b.lastMe().name, 'ახალი სახელი');
    assert.equal(b.lastMe().pid, a.lastMe().pid);
  });

  it('უცნობი token-ით იქმნება ახალი ანგარიში', async () => {
    const c = await sys.connect({ token: 'f'.repeat(32) });
    assert.notEqual(c.token, 'f'.repeat(32));
    assert.equal(c.lastMe().balance, START_BALANCE);
  });

  it('არასწორი სახელი უარყოფილია', async () => {
    const c = await sys.connect();
    const r = await c.request({ t: 'name', name: 'x' });
    assert.equal(r.t, 'err');
  });

  it('შევსება მხოლოდ მაშინ, როცა ბალანსი 10.00-ზე ნაკლებია', async () => {
    const c = await sys.connect();
    const r = await c.request({ t: 'refill' });
    assert.equal(r.t, 'err');
  });

  it('HTTP: /healthz და /api/fairness', async () => {
    assert.equal(await (await fetch(sys.url + '/healthz')).text(), 'ok');
    const f = await (await fetch(sys.url + '/api/fairness')).json();
    assert.equal(f.commit, sys.chain[0]);
    assert.equal(f.clientSeed, CLIENT_SEED);
  });

  it('სტატიკური ფაილები და path traversal-ის დაცვა', async () => {
    const r = await fetch(sys.url + '/');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<title>Riviera Rush<\/title>/);
    assert.equal((await fetch(sys.url + '/shared/math.js')).status, 200);
    const bad = await fetch(sys.url + '/..%2f..%2fpackage.json');
    assert.notEqual(bad.status, 200);
  });

  it('უცხო origin-იდან WebSocket უარყოფილია', async () => {
    const ws = new WebSocket(sys.wsUrl, { origin: 'https://evil.example.com' });
    const err = await new Promise(r => { ws.on('error', r); ws.on('open', () => r(null)); });
    assert.ok(err, 'კავშირი უნდა ჩაიშალოს');
  });
});

describe('ფსონები', () => {
  let sys, a, b;
  before(async () => {
    sys = await startSystem({ betMs: 1500 });
    a = await sys.connect({ name: 'მოთამაშე-ა' });
    b = await sys.connect({ name: 'მოთამაშე-ბ' });
  });
  after(() => sys.stop());

  it('ვალიდაცია: მანქანა, თანხა, ავტო-ქეშაუთი', async () => {
    await a.freshBetPhase();
    for (const bad of [
      { car: 3, amount: 1000 }, { car: -1, amount: 1000 }, { car: '1', amount: 1000 },
      { car: 0, amount: 99 }, { car: 0, amount: 100001 }, { car: 0, amount: 150.5 },
      { car: 0, amount: 1000, auto: 100 }, { car: 0, amount: 1000, auto: 10001 }, { car: 0, amount: 1000, auto: 1.5 }
    ]) {
      const r = await a.request({ t: 'bet', ...bad });
      assert.equal(r.t, 'err', JSON.stringify(bad));
    }
    assert.equal(a.lastMe().balance, START_BALANCE);
  });

  it('ფსონი აკლდება ბალანსს, ჩანს სხვებთან, გაუქმება აბრუნებს', async () => {
    const s = await a.freshBetPhase();
    const r = await a.request({ t: 'bet', car: 1, amount: 2500, auto: 300 });
    assert.equal(r.t, 'me');
    assert.equal(r.balance, START_BALANCE - 2500);
    assert.deepEqual(r.bet, { car: 1, amount: 2500, auto: 300, state: 'open', m100: 0, win: 0 });

    const seen = await b.waitFor(m => m.t === 'snap' && m.round === s.round && m.bets.some(x => x.name === 'მოთამაშე-ა'));
    const pub = seen.bets.find(x => x.name === 'მოთამაშე-ა');
    assert.equal(pub.car, 1); assert.equal(pub.amount, 2500); assert.equal(pub.pid, a.lastMe().pid);
    assert.ok(!('auto' in pub), 'სხვისი ავტო-ქეშაუთი არ ჩანს');

    const dbl = await a.request({ t: 'bet', car: 0, amount: 100 });
    assert.equal(dbl.t, 'err');
    const early = await a.request({ t: 'cashout' });
    assert.equal(early.t, 'err');

    const bFrom = b.mark();
    const c = await a.request({ t: 'cancel' });
    assert.equal(c.t, 'me');
    assert.equal(c.balance, START_BALANCE);
    assert.equal(c.bet, null);
    await b.waitFor(m => m.t === 'snap' && m.round === s.round && !m.bets.some(x => x.name === 'მოთამაშე-ა'), { from: bFrom });
  });

  it('ბალანსზე მეტი ფსონი უარყოფილია', async () => {
    // ბალანსს ვამცირებთ (ფსონი ავტო ×1.01-ის გარეშე — თითქმის ყოველთვის იწვება), მერე ვცდით ბალანსზე მეტს
    for (let k = 0; k < 5 && a.lastMe().balance >= 100000; k++) {
      const s = await a.freshBetPhase();
      assert.equal((await a.request({ t: 'bet', car: 0, amount: 10000 })).t, 'me');
      await a.roundEnd(s.round);
    }
    const bal = a.lastMe().balance;
    assert.ok(bal < 100000, 'ბალანსი უნდა შემცირებულიყო');
    await a.freshBetPhase();
    const r = await a.request({ t: 'bet', car: 0, amount: bal + 1 });
    assert.equal(r.t, 'err');
    assert.equal(a.lastMe().balance, bal);
  });

  it('რბოლის დროს ფსონი და გაუქმება უარყოფილია', async () => {
    const s = await a.freshBetPhase();
    await a.raceStart(s.round);
    assert.equal((await a.request({ t: 'bet', car: 0, amount: 100 })).t, 'err');
    assert.equal((await a.request({ t: 'cancel' })).t, 'err');
  });

  it('token არასდროს ჩანს საჯარო შეტყობინებებში', async () => {
    const all = JSON.stringify(b.log.filter(m => m.t !== 'welcome' && m.t !== 'me'));
    assert.ok(!all.includes(a.token));
    assert.ok(!all.includes(b.token));
  });
});

describe('ანგარიშსწორება', () => {
  let sys, c;
  before(async () => { sys = await startSystem(); c = await sys.connect(); });
  after(() => sys.stop());

  // რაუნდს ველოდებით, სადაც რომელიმე მანქანა პირობას აკმაყოფილებს
  async function roundWhere(pred) {
    for (let k = 0; k < 40; k++) {
      const s = await c.freshBetPhase();
      const exp = sys.expected(s.round);
      const car = exp.findIndex(pred);
      if (car >= 0) return { s, exp, car };
    }
    throw new Error('შესაფერისი რაუნდი ვერ მოიძებნა');
  }

  it('ავტო-ქეშაუთი იგებს, როცა მიზანი == გაჩერების წერტილი (≤ წესი)', async () => {
    const { s, exp, car } = await roundWhere(r => r.crash100 >= 101 && r.crash100 <= 1500);
    const auto = exp[car].crash100;
    const bal = c.lastMe().balance;
    assert.equal((await c.request({ t: 'bet', car, amount: 1000, auto })).t, 'me');
    const res = await c.waitFor(m => m.t === 'result', { from: c.mark() });
    assert.equal(res.state, 'won');
    assert.equal(res.m100, auto);
    assert.equal(res.win, payout(1000, auto));
    const me = await c.waitFor(m => m.t === 'me' && m.bet?.state === 'won');
    assert.equal(me.balance, bal - 1000 + payout(1000, auto));
    await c.roundEnd(s.round);
  });

  it('ავტო-ქეშაუთი წაგებს, როცა მიზანი > გაჩერების წერტილი', async () => {
    const { s, exp, car } = await roundWhere(r => r.crash100 < 5000);
    const bal = c.lastMe().balance;
    assert.equal((await c.request({ t: 'bet', car, amount: 700, auto: exp[car].crash100 + 1 })).t, 'me');
    const res = await c.waitFor(m => m.t === 'result', { from: c.mark() });
    assert.equal(res.state, 'lost');
    assert.equal(res.crash100, exp[car].crash100);
    assert.equal(res.type, exp[car].type);
    const me = await c.waitFor(m => m.t === 'me' && m.bet?.state === 'lost');
    assert.equal(me.balance, bal - 700);
    await c.roundEnd(s.round);
  });

  it('ხელით ქეშაუთი მანქანის გაჩერებამდე', async () => {
    const { s, exp, car } = await roundWhere(r => r.crash100 >= 300);
    const bal = c.lastMe().balance;
    assert.equal((await c.request({ t: 'bet', car, amount: 2000 })).t, 'me');
    const race = await c.raceStart(s.round);
    // ველოდებით, სანამ კოეფიციენტი ≈ ×1.5 იქნება (სერვერის დროით, აჩქარების გათვალისწინებით)
    const wakeAt = race.raceStart + timeFor(1.5) / sys.speed * 1000;
    await sleep(Math.max(0, wakeAt - Date.now()));
    const from = c.mark();
    c.send({ t: 'cashout' });
    const res = await c.waitFor(m => m.t === 'result' || m.t === 'err', { from });
    assert.equal(res.t, 'result', JSON.stringify(res));
    assert.equal(res.state, 'won');
    assert.ok(res.m100 >= 140 && res.m100 < exp[car].crash100, `m100=${res.m100}`);
    assert.equal(res.win, payout(2000, res.m100));
    const me = await c.waitFor(m => m.t === 'me' && m.bet?.state === 'won', { from });
    assert.equal(me.balance, bal - 2000 + res.win);
    // მეორე ქეშაუთი იმავე ფსონზე — შეცდომა
    assert.equal((await c.request({ t: 'cashout' })).t, 'err');
    await c.roundEnd(s.round);
  });

  it('დაგვიანებული ქეშაუთი უარყოფილია და ფსონი იწვება', async () => {
    const { s, car } = await roundWhere(r => r.crash100 <= 250);
    const from = c.mark();
    assert.equal((await c.request({ t: 'bet', car, amount: 300 })).t, 'me');
    await c.waitFor(m => m.t === 'snap' && m.round === s.round && m.cars[car].ended, { from });
    const res = await c.waitFor(m => m.t === 'result', { from });
    assert.equal(res.state, 'lost');
    assert.equal((await c.request({ t: 'cashout' })).t, 'err');
    await c.roundEnd(s.round);
  });

  it('ჟურნალი: ყოველ ფსონს აქვს ზუსტად ერთი ანგარიშსწორება და ბალანსი ემთხვევა', async () => {
    const entries = sys.ledger().filter(e => e.token === c.token);
    const bets = entries.filter(e => e.type === 'bet');
    const settled = entries.filter(e => e.type === 'win' || e.type === 'lose');
    assert.equal(bets.length, 4);
    assert.equal(settled.length, 4);
    for (const b of bets) assert.equal(settled.filter(x => x.round === b.round).length, 1);
    const sum = START_BALANCE - bets.reduce((s, e) => s + e.amount, 0) + settled.filter(e => e.type === 'win').reduce((s, e) => s + e.win, 0);
    assert.equal(c.lastMe().balance, sum);
  });
});

describe('რაუნდი და სამართლიანობა', () => {
  let sys, c;
  before(async () => { sys = await startSystem(); c = await sys.connect(); });
  after(() => sys.stop());

  it('გაუჩერებელი მანქანის შედეგი არასდროს იგზავნება; გაჩერებულისა ემთხვევა ჯაჭვს', async () => {
    const s = await c.freshBetPhase();
    const from = c.mark();
    await c.roundEnd(s.round);
    const exp = sys.expected(s.round);
    for (const snap of c.snaps(from).filter(x => x.round === s.round)) {
      snap.cars.forEach((car, i) => {
        if (!car.ended) assert.deepEqual(car, { ended: false });
        else { assert.equal(car.crash100, exp[i].crash100); assert.equal(car.type, exp[i].type); }
      });
    }
  });

  it('მანქანები ჩერდებიან გაჩერების წერტილის მიხედვით, ზრდადი თანმიმდევრობით', async () => {
    const s = await c.freshBetPhase();
    const from = c.mark();
    await c.roundEnd(s.round);
    const order = [];
    for (const snap of c.snaps(from).filter(x => x.round === s.round)) {
      snap.cars.forEach((car, i) => { if (car.ended && !order.includes(i)) order.push(i); });
    }
    const exp = sys.expected(s.round);
    for (let k = 1; k < order.length; k++) assert.ok(exp[order[k - 1]].crash100 <= exp[order[k]].crash100);
    assert.equal(order.length, 3);
  });

  it('ფინიშზე ქვეყნდება seed; ის ჯაჭვს ეკუთვნის და შედეგებს იძლევა', async () => {
    const s = await c.freshBetPhase();
    const h = await c.waitFor(m => m.t === 'history' && m.items[0]?.round === s.round, { from: c.mark() });
    const item = h.items[0];
    assert.equal(item.seed, sys.chain[s.round]);
    assert.equal(item.hash, sys.chain[s.round - 1]);
    assert.deepEqual(item.results, sys.expected(s.round));
  });

  it('რაუნდები მიმდევრობით მიდის და ყოველი seed ერთხელ გამოიყენება', async () => {
    const r1 = (await c.freshBetPhase()).round;
    const r2 = (await c.freshBetPhase()).round;
    assert.equal(r2, r1 + 1);
  });

  it('ორი მოთამაშე ერთსა და იმავე რაუნდს ხედავს', async () => {
    const d = await sys.connect();
    const s = await c.freshBetPhase();
    const other = await d.waitFor(m => m.t === 'snap' && m.round === s.round);
    assert.equal(other.roundHash, s.roundHash);
    assert.ok(other.online >= 2);
  });
});

describe('მდგრადობა', () => {
  it('სერვერის ავარია რბოლის დროს: ღია ფსონი ბრუნდება, seed ხელახლა არ გამოიყენება', async () => {
    let sys = await startSystem({ betMs: 2500, speed: 0.05 });   // ნელი რბოლა, რომ შუაში "ავარიას" მოვასწროთ
    const dataDir = sys.dataDir;
    let token, s;
    try {
      const c = await sys.connect();
      token = c.token;
      s = await c.betPhase();
      assert.equal((await c.request({ t: 'bet', car: 0, amount: 5000 })).t, 'me');
      await c.raceStart(s.round);
      await sleep(100);
    } finally { await sys.stop({ keepData: true }); }

    sys = await startSystem({ dataDir, betMs: 2500 });
    try {
      const c2 = await sys.connect({ token });
      assert.equal(c2.token, token);
      assert.equal(c2.lastMe().balance, START_BALANCE);
      assert.ok(c2.lastSnap().round > s.round);
      assert.ok(sys.ledger().some(e => e.type === 'refund' && e.token === token && e.amount === 5000));
    } finally { await sys.stop(); }
  });
});
