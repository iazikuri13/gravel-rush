import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { buildChain, roundResults, sha256 } from '../server/fair.js';
import { crashFromHash, payout, mult100At, endTime, MAX_CRASH_100 } from '../public/shared/math.js';
import { resultsFromSeed, verifyChain } from '../public/shared/verify.js';

test('ჰეშ-ჯაჭვი: ყოველი რგოლი = sha256(შემდეგი)', () => {
  const chain = buildChain('secret-for-test', 50);
  for (let k = 1; k <= 50; k++) assert.equal(sha256(chain[k]), chain[k - 1]);
});

test('შედეგი დეტერმინისტულია და ზღვრებშია', () => {
  const seed = 'a'.repeat(64);
  assert.deepEqual(roundResults(seed, 'cs'), roundResults(seed, 'cs'));
  for (let i = 0; i < 5000; i++) {
    const { crash100, type } = crashFromHash(randomBytes(32).toString('hex'));
    assert.ok(Number.isInteger(crash100) && crash100 >= 100 && crash100 <= MAX_CRASH_100);
    assert.ok(type === 'crash' || type === 'stall');
  }
});

test('კიდურა მნიშვნელობები', () => {
  assert.equal(crashFromHash('0'.repeat(64)).crash100, 100);          // r = 0  → ×0.97 → ×1.00
  assert.equal(crashFromHash('f'.repeat(64)).crash100, MAX_CRASH_100); // r → 1 → ზღვარი
  // r = 0.5 → 97 / 0.5 = 194 → ×1.94
  assert.equal(crashFromHash('8' + '0'.repeat(63)).crash100, 194);
});

test('ბრაუზერის (WebCrypto) და სერვერის შედეგები ემთხვევა', async () => {
  const chain = buildChain(randomBytes(32).toString('hex'), 30);
  for (let n = 1; n <= 30; n += 7) {
    assert.deepEqual(await resultsFromSeed(chain[n], 'client-x'), roundResults(chain[n], 'client-x'));
    assert.equal(await verifyChain(chain[n], n, chain[0]), true);
    assert.equal(await verifyChain(chain[n], n + 1, chain[0]), false);
  }
});

test('RTP ≈ 97% ნებისმიერი ქეშაუთის მიზნისთვის (მონტე-კარლო)', () => {
  const N = 400000;
  const crashes = new Uint32Array(N);
  let instant = 0, stall = 0;
  for (let i = 0; i < N; i++) {
    const h = createHmac('sha256', randomBytes(16)).update('x').digest('hex');
    const r = crashFromHash(h);
    crashes[i] = r.crash100;
    if (r.crash100 === 100) instant++;
    if (r.type === 'stall') stall++;
  }
  for (const target of [110, 150, 200, 300, 500, 1000]) {
    let ret = 0;
    // ავტო-ქეშაუთი target-ზე იგებს, თუ target ≤ crash (როგორც სერვერზე)
    for (let i = 0; i < N; i++) if (target <= crashes[i]) ret += payout(10000, target);
    const rtp = ret / (N * 10000);
    const tol = 0.004 * Math.sqrt(target / 100) + 0.004;
    assert.ok(Math.abs(rtp - 0.97) < tol, `target ×${target / 100}: RTP ${rtp.toFixed(4)}`);
  }
  assert.ok(Math.abs(instant / N - (1 - 97 / 101)) < 0.003, `instant ${(instant / N).toFixed(4)}`);
  assert.ok(Math.abs(stall / N - 115 / 256) < 0.004, `stall ${(stall / N).toFixed(4)}`);
});

test('ქეშაუთი გაჩერებამდე ყოველთვის crash-ზე ნაკლებია', () => {
  for (const crash100 of [101, 150, 237, 1000, MAX_CRASH_100]) {
    const t = endTime(crash100) - 1e-9;
    assert.ok(mult100At(t) < crash100);
  }
});
