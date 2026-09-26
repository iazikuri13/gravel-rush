import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { buildChain, roundResults, sha256 } from '../services/round/fair.js';
import { crashFromHash, payout, mult100At, endTime, maxWinM100 } from '../public/shared/math.js';
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
    assert.ok(Number.isInteger(crash100) && crash100 >= 100);
    assert.ok(type === 'crash' || type === 'stall');
  }
});

test('კიდურა მნიშვნელობები', () => {
  assert.equal(crashFromHash('0'.repeat(64)).crash100, 100);          // r = 0  → ×0.97 → ×1.00
  // r → 1: კოეფიციენტს ზედა ზღვარი არ აქვს (97 · 2^52 ≈ ×4.37·10^15)
  assert.equal(crashFromHash('f'.repeat(64)).crash100, Number(97n * 2n ** 52n));
  // ×100-ზე მეტი აღარ იჭრება: r = 0.999 → 97 / 0.001 = ×970.00 (ადრე ×100.00 იქნებოდა)
  const c970 = crashFromHash(Math.floor(2 ** 52 * 0.999).toString(16).padStart(13, '0') + '0'.repeat(51)).crash100;
  assert.ok(c970 >= 96990 && c970 <= 97000, String(c970));
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
  for (const crash100 of [101, 150, 237, 1000, 10000, 1_000_000]) {
    const t = endTime(crash100) - 1e-9;
    assert.ok(mult100At(t) < crash100);
  }
});

test('×1.00-ის ზღვარი ზუსტია: crash = ×1.00 ⟺ r < 4/101', () => {
  // n = HMAC-ის პირველი 52 ბიტი; ×1.01 იწყება n ≥ ceil(4·2^52 / 101)-დან
  const TWO_52 = 2n ** 52n, first = (4n * TWO_52 + 100n) / 101n;
  const hex = n => n.toString(16).padStart(13, '0') + '0'.repeat(51);
  assert.equal(crashFromHash(hex(first - 1n)).crash100, 100);
  assert.equal(crashFromHash(hex(first)).crash100, 101);
  assert.ok(Math.abs(Number(first) / 2 ** 52 - 4 / 101) < 1e-15);
});

test('ბოლიდები დამოუკიდებელია: ×1.00 ერთად — p², სამივე — p³ (ნამდვილი ჯაჭვი)', () => {
  // ყოველი ბოლიდის შედეგი ცალკე HMAC-ით ითვლება. თუ ოდესმე ერთმანეთზე დამოკიდებული გახდა,
  // „სამივე ×1.00“ 16 000-ში ერთის ნაცვლად გახშირდება — ეს ტესტი ამას დაიჭერს.
  const N = 300000, p = 4 / 101;
  const chain = buildChain(randomBytes(32).toString('hex'), N);
  let one = 0, pairs = 0, all = 0;
  for (let n = 1; n <= N; n++) {
    const f = roundResults(chain[n], 'independence-test').map(r => r.crash100 === 100);
    one += f[0] + f[1] + f[2];
    pairs += (f[0] && f[1]) + (f[0] && f[2]) + (f[1] && f[2]);
    all += f[0] && f[1] && f[2];
  }
  const within = (hits, trials, q, name) => {
    const sd = Math.sqrt(trials * q * (1 - q));
    assert.ok(Math.abs(hits - trials * q) < 4.5 * sd + 1, `${name}: ${hits}, მოსალოდნელი ${(trials * q).toFixed(1)} ± ${sd.toFixed(1)}`);
  };
  within(one, 3 * N, p, 'ერთი ბოლიდი ×1.00');
  within(pairs, 3 * N, p ** 2, 'ორი ერთად ×1.00');
  within(all, N, p ** 3, 'სამივე ×1.00');
});

test('მოგების ზღვარი: ქეშაუთის წერტილი ისეა არჩეული, რომ მოგება ზღვარს არ აჭარბებს', () => {
  const MAX = 10_000_000;                              // 100 000.00
  for (const amount of [100, 777, 5000, 33333, 100000]) {
    const cap = maxWinM100(amount, MAX);
    assert.ok(payout(amount, cap) <= MAX, `ფსონი ${amount}: ${payout(amount, cap)}`);
    assert.ok(payout(amount, cap + 1) > MAX || cap + 1 > MAX * 100 / amount, `ფსონი ${amount}: cap ყველაზე მაღალი დასაშვებია`);
  }
  assert.equal(maxWinM100(100000, MAX), 10000);        // 1 000.00 ფსონი → ×100.00-ზე 100 000.00
});

test('×100-ის ზემოთ განაწილება გრძელდება: P(crash ≥ x) ≈ 0.97 / x  x = 200, 1000-ზეც', () => {
  const N = 600000;
  let ge200 = 0, ge1000 = 0;
  for (let i = 0; i < N; i++) {
    const c = crashFromHash(createHmac('sha256', randomBytes(16)).update('x').digest('hex')).crash100;
    if (c >= 20000) ge200++;
    if (c >= 100000) ge1000++;
  }
  const check = (hits, p, name) => assert.ok(Math.abs(hits - N * p) < 4.5 * Math.sqrt(N * p * (1 - p)), `${name}: ${hits} vs ${(N * p).toFixed(0)}`);
  check(ge200, 0.97 / 200, '≥ ×200');
  check(ge1000, 0.97 / 1000, '≥ ×1000');
});
