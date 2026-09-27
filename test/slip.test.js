// ფსონის პანელის ლოგიკა (public/shared/slip.js): სამი ფსონი ერთ რბოლაში — თითო ბოლიდზე.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carAction, mainAction, commandsFor, payoutNow } from '../public/shared/slip.js';

const running = () => [0, 1, 2].map(() => ({ ended: false }));
const view = o => ({
  ready: true, phase: 'bet', bets: [null, null, null], cars: running(), mult: 1,
  stake: { amount: 500, auto: null }, maxWin: 10_000_000, counts: [0, 0, 0], ...o
});
const open = amount => ({ amount, auto: null, state: 'open', m100: 0, win: 0 });

test('კავშირამდე არაფერი არ იგზავნება', () => {
  const v = view({ ready: false });
  assert.deepEqual(carAction(v, 0), { car: 0, st: 'idle' });
  assert.equal(mainAction(v).kind, 'wait');
  assert.deepEqual(commandsFor(mainAction(v), v.stake), []);
});

test('ფსონების ფაზა: ბარათი დებს ფსონს თავის ბოლიდზე, მთავარი ღილაკი — ყველა თავისუფალზე', () => {
  const v = view({ stake: { amount: 500, auto: 200 } });
  assert.deepEqual(commandsFor(carAction(v, 2), v.stake), [{ t: 'bet', car: 2, amount: 500, auto: 200 }]);
  const all = mainAction(v);
  assert.equal(all.kind, 'bet-rest'); assert.deepEqual(all.cars, [0, 1, 2]); assert.equal(all.total, 1500);
  assert.deepEqual(commandsFor(all, v.stake).map(c => c.car), [0, 1, 2]);
});

test('ერთ ბოლიდზე დადებულის შემდეგ: ბარათი აუქმებს, მთავარი ღილაკი დებს დანარჩენ ორზე', () => {
  const v = view({ bets: [null, open(500), null] });
  assert.equal(carAction(v, 1).st, 'placed');
  assert.deepEqual(commandsFor(carAction(v, 1), v.stake), [{ t: 'cancel', car: 1 }]);
  assert.equal(carAction(v, 0).st, 'bet');
  const m = mainAction(v);
  assert.equal(m.kind, 'bet-rest'); assert.deepEqual(m.cars, [0, 2]); assert.equal(m.total, 1000);
});

test('სამივე დადებულია: მთავარი ღილაკი აუქმებს სამივეს', () => {
  const v = view({ bets: [open(100), open(200), open(300)] });
  const m = mainAction(v);
  assert.equal(m.kind, 'cancel-all'); assert.equal(m.total, 600);
  assert.deepEqual(commandsFor(m, v.stake), [0, 1, 2].map(car => ({ t: 'cancel', car })));
});

test('რბოლა: ქეშაუთი თითოეულზე ცალკე; მთავარი ღილაკი — ყველა ღიაზე, გაჩერებულის გარეშე', () => {
  const cars = running(); cars[1] = { ended: true, crash100: 130, type: 'crash' };
  const v = view({ phase: 'race', mult: 2.5, bets: [open(1000), open(500), open(200)], cars });
  const a0 = carAction(v, 0);
  assert.equal(a0.st, 'cash'); assert.equal(a0.payout, 2500);
  assert.deepEqual(commandsFor(a0, v.stake), [{ t: 'cashout', car: 0 }]);
  assert.equal(carAction(v, 1).st, 'lost');
  assert.equal(carAction(v, 1).cmd, undefined);
  const m = mainAction(v);
  assert.equal(m.kind, 'cash-all'); assert.deepEqual(m.cars, [0, 2]); assert.equal(m.total, 2500 + 500);
});

test('რბოლა: მოგებული, წაგებული და ფსონის გარეშე ბოლიდები', () => {
  const cars = running(); cars[2] = { ended: true, crash100: 110, type: 'stall' };
  const v = view({ phase: 'race', mult: 3, bets: [{ amount: 100, auto: 150, state: 'won', m100: 150, win: 150 }, null, { amount: 100, state: 'lost' }], cars, counts: [3, 5, 1] });
  assert.deepEqual(carAction(v, 0), { car: 0, st: 'won', win: 150, m100: 150 });
  assert.deepEqual(carAction(v, 1), { car: 1, st: 'idle', ended: null, racing: true, count: 5 });
  assert.equal(carAction(v, 2).st, 'lost');
  assert.equal(carAction(v, 2).ended.type, 'stall');
  const m = mainAction(v);
  assert.equal(m.kind, 'result'); assert.equal(m.won, 150); assert.equal(m.wins, 1);
  assert.deepEqual(commandsFor(m, v.stake), []);
});

test('რბოლა ფსონის გარეშე და ფინიში', () => {
  assert.equal(mainAction(view({ phase: 'race', mult: 1.5 })).kind, 'wait');
  const end = mainAction(view({ phase: 'end', bets: [{ amount: 100, state: 'won', win: 300 }, { amount: 200, state: 'lost' }, null] }));
  assert.deepEqual(end, { kind: 'next', cars: [0, 1], won: 300, staked: 300 });
});

test('მოგება ახლა მოგების ზღვრით', () => {
  assert.equal(payoutNow({ amount: 1000 }, 2.345), 2340);
  assert.equal(payoutNow({ amount: 100000 }, 150, 10_000_000), 10_000_000);
});
