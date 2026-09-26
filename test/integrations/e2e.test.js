// მთელი სისტემა გარედან: სატესტო კაზინო → LaunchGame → თამაში (WebSocket) → BET / WIN / ROLLBACK კაზინოში.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSystem, MODE } from '../helpers/system.js';
import { payout } from '../../public/shared/math.js';

// სამ ცალკე პროცესად გაშვებისას (GR_MODE=separate) შუამავალი და სატესტო კაზინო არ ეშვება
describe('კაზინოს ინტეგრაცია (Upgaming, სატესტო კაზინო)', { skip: MODE === 'separate' }, () => {
  let sys;
  const demo = (path, body) => fetch(sys.url + '/demo-operator/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(r => r.json());
  const player = async id => (await demo('api/state')).players.find(p => p.id === id);
  const launch = async id => new URL((await demo('api/launch', { playerId: id })).url, sys.url).searchParams.get('session');

  before(async () => { sys = await startSystem({ betMs: 1500 }); });
  after(() => sys.stop());

  it('სატესტო კაზინოს გვერდი და პლატფორმის მარშრუტები gateway-ით ხელმისაწვდომია', async () => {
    const page = await fetch(sys.url + '/demo-operator/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /სატესტო კაზინო/);
    const games = await fetch(sys.url + '/p/upgaming-demo/GetGames?key=demo-operator').then(r => r.json());
    assert.equal(games[0].Id, '1001');
  });

  it('სესიით შესვლა: ბალანსი და ვალუტა კაზინოდან', async () => {
    const c = await sys.connect({ session: await launch('nino-gel') });
    const me = c.lastMe();
    assert.equal(me.balance, 25000);
    assert.equal(me.currency, 'GEL');
    assert.equal((await c.request({ t: 'refill' })).t, 'err');
  });

  it('ყალბი სესია უარყოფილია', async () => {
    const c = await import('ws').then(({ default: WebSocket }) => new WebSocket(sys.wsUrl));
    await new Promise(r => c.on('open', r));
    const got = new Promise(r => c.on('message', m => { const x = JSON.parse(m); if (x.t === 'err') r(x); }));
    c.send(JSON.stringify({ t: 'hello', session: 'f'.repeat(48) }));
    assert.match((await got).msg, /სესია ვერ მოიძებნა/);
    c.close();
  });

  it('ფსონი → BET კაზინოში; გაუქმება → ROLLBACK; შედეგი → WIN (ან WIN 0); ბალანსი ემთხვევა', async () => {
    const c = await sys.connect({ session: await launch('luka-usd') });
    const start = (await player('luka-usd')).balance;              // 100.00 USD

    let s = await c.freshBetPhase();
    const r1 = await c.request({ t: 'bet', car: 0, amount: 1500 });
    assert.equal(r1.t, 'me');
    assert.equal(r1.balance, start * 100 - 1500);
    assert.equal((await player('luka-usd')).balance, start - 15);
    assert.equal((await c.request({ t: 'cancel' })).balance, start * 100);
    assert.equal((await player('luka-usd')).balance, start);

    // ავტო-ქეშაუთით რაუნდი, სადაც შედეგი ცნობილია წინასწარ (ჯაჭვიდან)
    let won = 0, spent = 0;
    for (let k = 0; k < 2; k++) {
      s = await c.freshBetPhase();
      const exp = sys.expected(s.round);
      const car = exp.findIndex(r => r.crash100 >= 120);
      const auto = 110;
      const pickCar = car >= 0 ? car : 0;
      assert.equal((await c.request({ t: 'bet', car: pickCar, amount: 1000, auto })).t, 'me');
      spent += 1000;
      const res = await c.waitFor(m => m.t === 'result', { from: c.mark() });
      if (res.state === 'won') won += payout(1000, auto);
      await c.roundEnd(s.round);
    }
    // მოგებები რიგით მიდის — ველოდებით, სანამ კაზინოს ბალანსი დაემთხვევა
    const want = start * 100 - spent + won;
    for (let k = 0; k < 50 && Math.round((await player('luka-usd')).balance * 100) !== want; k++) await new Promise(r => setTimeout(r, 100));
    assert.equal(Math.round((await player('luka-usd')).balance * 100), want);

    const log = (await demo('api/state')).log.filter(x => x.player === 'luka-usd').reverse().map(x => x.type);
    assert.deepEqual(log.slice(0, 2), ['BET', 'ROLLBACK']);
    assert.equal(log.filter(t => t === 'BET').length, 3);
    assert.equal(log.filter(t => t === 'WIN').length, 2, 'ყოველ რაუნდს ერთი WIN (წაგებისას 0)');
  });

  it('კაზინოში ფული არ არის → ფსონი უარყოფილია და არაფერი იჭრება', async () => {
    const c = await sys.connect({ session: await launch('ana-eur') });   // 40.00 EUR
    await c.freshBetPhase();
    const r = await c.request({ t: 'bet', car: 1, amount: 50000 });
    assert.equal(r.t, 'err');
    assert.match(r.msg, /ბალანსი არ გყოფნის/);
    assert.equal((await player('ana-eur')).balance, 40);
  });
});
