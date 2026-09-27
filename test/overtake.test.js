// ვიზუალური გასწრებები (public/shared/overtake.js): ბოლიდები რბოლისას ადგილებს იცვლიან.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { racePlan, leadAt, seedFrom, GRID } from '../public/shared/overtake.js';

const order = (plan, t) => [0, 1, 2].sort((a, b) => leadAt(plan, b, t) - leadAt(plan, a, t)).join('');
const plans = n => Array.from({ length: n }, (_, k) => racePlan(seedFrom('round-hash-' + k)));

test('სტარტზე ბოლიდები ზუსტად სასტარტო ბადეზე დგანან', () => {
  for (const plan of plans(50)) for (const c of [0, 1, 2]) assert.equal(leadAt(plan, c, 0), GRID[c]);
});

test('ერთი რაუნდის ჰეში — ყველასთან ერთნაირი გასწრებები; სხვა რაუნდი — სხვა', () => {
  const a = racePlan(seedFrom('abc123')), b = racePlan(seedFrom('abc123')), c = racePlan(seedFrom('abc124'));
  for (const t of [0.5, 2, 5.5, 13]) for (const car of [0, 1, 2]) assert.equal(leadAt(a, car, t), leadAt(b, car, t));
  assert.notEqual(leadAt(a, 0, 5), leadAt(c, 0, 5));
});

test('გასწრებები ხშირია: 1000 რბოლიდან უმეტესობაში ადგილები პირველ წამებშივე იცვლება', () => {
  let in4 = 0, in8 = 0;
  const all = plans(1000);
  for (const plan of all) {
    const start = order(plan, 0);
    let f4 = false, f8 = false;
    for (let t = 0; t <= 8; t += 0.05) if (order(plan, t) !== start) { f8 = true; if (t <= 4) f4 = true; }
    in4 += f4; in8 += f8;
  }
  assert.ok(in4 / all.length > 0.8, `4 წამში: ${in4 / all.length}`);
  assert.ok(in8 / all.length > 0.95, `8 წამში: ${in8 / all.length}`);
});

test('მოძრაობა გლუვია და ბოლიდები ჯგუფს არ შორდებიან', () => {
  for (const plan of plans(200)) {
    for (let t = 0; t <= 60; t += 0.05) {
      for (const c of [0, 1, 2]) {
        const v = leadAt(plan, c, t);
        assert.ok(Math.abs(v) < 3.2, `|lead| = ${v}`);
        assert.ok(Math.abs(leadAt(plan, c, t + 0.05) - v) < 0.12, 'ნახტომი არ არის');
      }
    }
  }
});
