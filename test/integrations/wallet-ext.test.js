// ფსონების ლოგიკა გარე კაზინოს მოთამაშისთვის (Wallet + ყალბი შუამავალი, ქსელის გარეშე).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from '../../services/bets/wallet.js';
import { JsonStore } from '../../services/lib/store.js';
import { HttpError } from '../../services/lib/http.js';

const SESSION = 'ab'.repeat(24);
const cars = () => [0, 1, 2].map(() => ({ ended: false }));

function fakeExt() {
  const f = {
    balance: 10000, calls: [], failNext: 0, failWith: null, seen: new Set(),
    session: async () => ({ platform: 'ug', playerId: 'p1', currency: 'USD', closeRoundWithZeroWin: true, lobbyUrl: null }),
    balanceOf: async () => ({ balance: f.balance }),
    tx: async (s, tx) => {
      f.calls.push(tx);
      if (f.failNext > 0) { f.failNext--; throw f.failWith || new HttpError(503, 'down', 'PLATFORM_UNAVAILABLE'); }
      if (tx.kind === 'bet' && tx.amount > f.balance) throw new HttpError(403, 'no money', 'INSUFFICIENT_FUNDS');
      if (!f.seen.has(tx.id)) {   // კაზინოს იდემპოტენტურობა
        f.seen.add(tx.id);
        f.balance += tx.kind === 'bet' ? -tx.amount : tx.amount;
      }
      return { balance: f.balance };
    }
  };
  return f;
}

describe('Wallet: კაზინოს მოთამაშე', () => {
  let dir, w, ext, round;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gr-wext-'));
    ext = fakeExt();
    round = { accepting: async () => ({ round: 1, accepting: true }), check: async () => ({ ok: false }) };
    w = new Wallet(new JsonStore(dir), round, { session: ext.session, balance: ext.balanceOf, tx: ext.tx });
    w.syncState({ phase: 'bet', round: 1, raceStart: 0, speed: 1, cars: cars() });
  });
  afterEach(() => { w.dispose(); rmSync(dir, { recursive: true, force: true }); });

  it('შესვლა სესიით: ბალანსი და ვალუტა კაზინოდან, შევსება აკრძალულია', async () => {
    const { token, me } = await w.join({ session: SESSION });
    assert.equal(me.balance, 10000); assert.equal(me.currency, 'USD');
    assert.throws(() => w.refill(token), /კაზინო მართავს/);
    const again = await w.join({ session: SESSION });
    assert.equal(again.token, token, 'იგივე მოთამაშე — იგივე ჩანაწერი');
  });

  it('ფსონი ჯერ კაზინოში იჭრება; ფულის უკმარისობა — გასაგები შეცდომა', async () => {
    const { token } = await w.join({ session: SESSION });
    const me = await w.placeBet(token, { car: 1, amount: 2500 });
    assert.equal(me.balance, 7500);
    assert.equal(ext.calls[0].kind, 'bet');
    assert.equal(ext.calls[0].roundId, '1');
    await assert.rejects(w.placeBet(token, { car: 0, amount: 100 }), /უკვე დადებული/);
    const { token: t2 } = await w.join({ session: 'cd'.repeat(24) });   // იგივე მოთამაშე (ყალბი session() ერთს აბრუნებს)
    assert.equal(t2, token);
  });

  it('ფსონის გაუქმება → ROLLBACK იმავე ფსონზე', async () => {
    const { token } = await w.join({ session: SESSION });
    await w.placeBet(token, { car: 0, amount: 1000 });
    const me = await w.cancelBet(token);
    assert.equal(me.balance, 10000); assert.equal(me.bet, null);
    const [bet, rb] = ext.calls;
    assert.equal(rb.kind, 'rollback'); assert.equal(rb.ref, bet.id); assert.equal(rb.amount, 1000);
  });

  it('მოგება კაზინოს ერთხელ მიდის, მაშინაც კი, თუ კავშირი რამდენჯერმე გაწყდა', async () => {
    const { token } = await w.join({ session: SESSION });
    await w.placeBet(token, { car: 2, amount: 1000, auto: 150 });
    w.onRoundEvent('race_started', { state: { phase: 'race', round: 1, raceStart: Date.now() + 60000, speed: 1, cars: cars() } });
    ext.failNext = 3;
    w.onRoundEvent('car_ended', { car: 2, crash100: 400, type: 'crash', state: { phase: 'race', round: 1, cars: cars() } });
    for (let k = 0; k < 6 && w.outbox.length; k++) await w.drain();
    assert.equal(w.outbox.length, 0);
    const wins = ext.calls.filter(c => c.kind === 'win');
    assert.equal(wins.length, 4, '3 წარუმატებელი ცდა + 1 წარმატებული');
    assert.ok(wins.every(c => c.id === wins[0].id && c.amount === 1500), 'ყოველთვის იგივე id და თანხა');
    assert.equal(ext.balance, 10000 - 1000 + 1500);
    assert.equal(w.me(token).balance, ext.balance);
  });

  it('წაგება კაზინოში WIN 0-ით იხურება', async () => {
    const { token } = await w.join({ session: SESSION });
    await w.placeBet(token, { car: 0, amount: 700 });
    w.onRoundEvent('race_started', { state: { phase: 'race', round: 1, raceStart: Date.now(), speed: 1, cars: cars() } });
    w.onRoundEvent('car_ended', { car: 0, crash100: 120, type: 'stall', state: { phase: 'race', round: 1, cars: cars() } });
    await w.drain();
    const win = ext.calls.find(c => c.kind === 'win');
    assert.equal(win.amount, 0);
    assert.equal(w.me(token).balance, 10000 - 700);
  });

  it('ფსონზე პასუხი არ მოვიდა → უსაფრთხოებისთვის ROLLBACK რიგში დგება', async () => {
    const { token } = await w.join({ session: SESSION });
    ext.failNext = 1;
    await assert.rejects(w.placeBet(token, { car: 0, amount: 500 }), /კავშირი ვერ დამყარდა/);
    assert.equal(w.outbox.length, 1);
    assert.equal(w.outbox[0].tx.kind, 'rollback');
    assert.equal(w.outbox[0].tx.ref, ext.calls[0].id);
    await w.drain();
    assert.equal(w.outbox.length, 0);
  });

  it('კაზინოს საბოლოო უარი რიგს არ აჩერებს', async () => {
    const { token } = await w.join({ session: SESSION });
    await w.placeBet(token, { car: 0, amount: 500, auto: 110 });
    w.onRoundEvent('race_started', { state: { phase: 'race', round: 1, raceStart: Date.now() + 60000, speed: 1, cars: cars() } });
    ext.failNext = 1; ext.failWith = new HttpError(404, 'nope', 'TRANSACTION_NOT_FOUND');
    w.onRoundEvent('car_ended', { car: 0, crash100: 300, type: 'crash', state: { phase: 'race', round: 1, cars: cars() } });
    await w.drain();
    assert.equal(w.outbox.length, 0);
  });
});
