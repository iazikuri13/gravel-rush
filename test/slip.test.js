// ფსონის პანელების ლოგიკა (public/shared/slip.js): სამი დამოუკიდებელი პანელი — თითო ბოლიდზე.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slipState, commandFor, queuedBets, stepAmount, payoutNow } from '../public/shared/slip.js';

const running = () => [0, 1, 2].map(() => ({ ended: false }));
const stakes = () => [{ amount: 500, auto: null }, { amount: 1000, auto: 200 }, { amount: 2500, auto: null }];
const view = o => ({
  ready: true, phase: 'bet', bets: [null, null, null], cars: running(), mult: 1,
  stakes: stakes(), queued: [false, false, false], maxWin: 10_000_000, counts: [0, 0, 0], ...o
});
const open = amount => ({ amount, auto: null, state: 'open', m100: 0, win: 0 });

test('კავშირამდე პანელი გამორთულია და არაფერს აგზავნის', () => {
  const s = slipState(view({ ready: false }), 0);
  assert.equal(s.st, 'off'); assert.equal(s.cmd, undefined); assert.equal(s.editable, false);
  assert.equal(commandFor(s, stakes()[0]), null);
});

test('ყოველი პანელი დებს ფსონს საკუთარი თანხით და ავტოთი', () => {
  const v = view();
  const cmds = [0, 1, 2].map(i => commandFor(slipState(v, i), v.stakes[i]));
  assert.deepEqual(cmds, [
    { t: 'bet', car: 0, amount: 500, auto: null },
    { t: 'bet', car: 1, amount: 1000, auto: 200 },
    { t: 'bet', car: 2, amount: 2500, auto: null }
  ]);
  assert.ok([0, 1, 2].every(i => slipState(v, i).editable));
});

test('დადებული ფსონი: ღილაკი აუქმებს მხოლოდ თავის ბოლიდს, თანხა დაბლოკილია', () => {
  const v = view({ bets: [null, { ...open(700), auto: 300 }, null] });
  const s = slipState(v, 1);
  assert.equal(s.st, 'placed'); assert.equal(s.amount, 700); assert.equal(s.auto, 300); assert.equal(s.editable, false);
  assert.deepEqual(commandFor(s, v.stakes[1]), { t: 'cancel', car: 1 });
  assert.equal(slipState(v, 0).st, 'bet');
});

test('რბოლა: ქეშაუთი თითო პანელზე ცალკე, მიმდინარე მოგებით; მოგების ზღვარი', () => {
  const cars = running(); cars[1] = { ended: true, crash100: 130, type: 'crash' };
  const v = view({ phase: 'race', mult: 2.5, bets: [open(1000), open(500), null], cars });
  const s0 = slipState(v, 0);
  assert.equal(s0.st, 'cash'); assert.equal(s0.payout, 2500);
  assert.deepEqual(commandFor(s0, v.stakes[0]), { t: 'cashout', car: 0 });
  const s1 = slipState(v, 1);
  assert.equal(s1.st, 'lost'); assert.deepEqual(s1.ended, { type: 'crash', crash100: 130 });
  assert.equal(slipState({ ...v, maxWin: 2000 }, 0).payout, 2000);
});

test('ფსონის გარეშე რბოლის დროს: ფსონი შემდეგ რბოლაზე მზადდება და უქმდება', () => {
  const v = view({ phase: 'race', mult: 1.4 });
  const s = slipState(v, 2);
  assert.equal(s.st, 'closed'); assert.equal(s.cmd, 'queue'); assert.equal(s.editable, true);
  assert.equal(commandFor(s, v.stakes[2]), null, 'სერვერზე არაფერი მიდის');
  const q = slipState({ ...v, queued: [false, false, true] }, 2);
  assert.equal(q.st, 'queued'); assert.equal(q.cmd, 'unqueue'); assert.equal(q.editable, false); assert.equal(q.amount, 2500);
});

test('შედეგი: მოგებული და წაგებული ჩანს, შემდეგი რბოლისთვის მომზადება შეიძლება', () => {
  const cars = running(); cars[2] = { ended: true, crash100: 110, type: 'stall' };
  const v = view({ phase: 'end', bets: [{ amount: 100, state: 'won', m100: 150, win: 150 }, null, { amount: 100, state: 'lost' }], cars });
  const w = slipState(v, 0);
  assert.equal(w.st, 'won'); assert.equal(w.win, 150); assert.equal(w.m100, 150); assert.equal(w.cmd, 'queue');
  const l = slipState(v, 2);
  assert.equal(l.st, 'lost'); assert.equal(l.ended.type, 'stall');
  assert.equal(slipState(v, 1).st, 'closed');
  assert.equal(slipState({ ...v, queued: [true, false, false] }, 0).st, 'queued', 'მომზადებული ფსონი შედეგს ცვლის');
});

test('ახალ რბოლაზე მომზადებული ფსონები იგზავნება, სხვა დროს — არა', () => {
  const queued = [true, false, true];
  assert.deepEqual(queuedBets(view({ queued })), [
    { t: 'bet', car: 0, amount: 500, auto: null },
    { t: 'bet', car: 2, amount: 2500, auto: null }
  ]);
  assert.deepEqual(queuedBets(view({ queued, phase: 'race' })), []);
  assert.deepEqual(queuedBets(view({ queued, ready: false })), []);
  assert.deepEqual(queuedBets(view({ queued, bets: [open(500), null, null] })).map(c => c.car), [2], 'უკვე დადებულს აღარ იმეორებს');
});

test('−/+ თანხის კიბე: 1 2 5 10 20 50 100 200 500 1000, ზღვრებით', () => {
  assert.equal(stepAmount(5000, +1), 10000);
  assert.equal(stepAmount(5000, -1), 2000);
  assert.equal(stepAmount(3700, +1), 5000, 'შუა მნიშვნელობიდან — შემდეგ საფეხურზე');
  assert.equal(stepAmount(3700, -1), 2000);
  assert.equal(stepAmount(100, -1), 100);
  assert.equal(stepAmount(100000, +1), 100000);
  assert.equal(stepAmount(50000, +1, 100, 60000), 60000, 'ზედა ზღვარი (მაგ. ბალანსი)');
});

test('მოგება ახლა მოგების ზღვრით', () => {
  assert.equal(payoutNow({ amount: 1000 }, 2.345), 2340);
  assert.equal(payoutNow({ amount: 100000 }, 150, 10_000_000), 10_000_000);
});
