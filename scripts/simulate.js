// მონტე-კარლოს სიმულაცია ნამდვილ ჰეშ-ჯაჭვზე — ზუსტად ისე, როგორც რაუნდის სერვისი ითვლის.
//
//   node scripts/simulate.js [რბოლები=1000000] [client-seed]
//
// ამოწმებს: ×1.00-ის სიხშირეს (ერთი / ერთი მაინც / სამივე), P(crash ≥ x) = 0.97 / x,
// RTP-ს ავტო-ქეშაუთის სხვადასხვა მიზანზე და ბოლიდების დამოუკიდებლობას.
// თითოეული გადახრა ნაჩვენებია სტანდარტულ გადახრებში (z); |z| > 4 ნიშნავს პრობლემას.
import { randomBytes } from 'node:crypto';
import { buildChain, roundResults } from '../services/round/fair.js';
import { payout } from '../public/shared/math.js';

const N = Number(process.argv[2] || 1_000_000);
const CLIENT_SEED = process.argv[3] || 'simulation-client-seed';
const t0 = Date.now();

const chain = buildChain(randomBytes(32).toString('hex'), N);
const crashes = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
let stalls = 0;
for (let n = 1; n <= N; n++) {
  const res = roundResults(chain[n], CLIENT_SEED);
  for (let i = 0; i < 3; i++) { crashes[i][n - 1] = res[i].crash100; if (res[i].type === 'stall') stalls++; }
}

const p1 = 4 / 101;                                   // P(crash = ×1.00) = 1 − 97/101
const z = (hits, trials, p) => (hits - trials * p) / Math.sqrt(trials * p * (1 - p));
const pct = x => (x * 100).toFixed(4) + '%';
const rows = [];
const row = (name, hits, trials, p) => rows.push({ name, hits, trials, p, z: z(hits, trials, p) });

// ×1.00
let any = 0, all = 0, pair01 = 0, pair02 = 0, pair12 = 0;
const inst = [0, 0, 0];
for (let k = 0; k < N; k++) {
  const a = crashes[0][k] === 100, b = crashes[1][k] === 100, c = crashes[2][k] === 100;
  inst[0] += a; inst[1] += b; inst[2] += c;
  if (a || b || c) any++;
  if (a && b && c) all++;
  if (a && b) pair01++; if (a && c) pair02++; if (b && c) pair12++;
}
for (let i = 0; i < 3; i++) row(`ბოლიდი ${i}: ×1.00`, inst[i], N, p1);
row('ერთი მაინც ×1.00', any, N, 1 - (1 - p1) ** 3);
row('ორი ერთად ×1.00 (0+1, 0+2, 1+2)', pair01 + pair02 + pair12, 3 * N, p1 ** 2);
row('სამივე ×1.00', all, N, p1 ** 3);

// P(crash ≥ x) = 0.97 / x  (სამივე ბოლიდი ერთად)
for (const x of [101, 150, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 100000]) {
  let hits = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < N; k++) if (crashes[i][k] >= x) hits++;
  row(`P(crash ≥ ×${(x / 100).toFixed(2)})`, hits, 3 * N, 97 / x);
}
row('„გაჩერდა“ (ვიზუალი)', stalls, 3 * N, 115 / 256);

console.log(`\n${N.toLocaleString('en')} რბოლა × 3 ბოლიდი = ${(3 * N).toLocaleString('en')} შედეგი · client seed: ${CLIENT_SEED}\n`);
console.log('მოვლენა'.padEnd(36), 'ნანახი'.padStart(10), 'მოსალოდნელი'.padStart(12), 'სიხშირე'.padStart(11), 'თეორია'.padStart(11), 'z'.padStart(7));
for (const r of rows) {
  console.log(r.name.padEnd(36), String(r.hits).padStart(10), (r.trials * r.p).toFixed(1).padStart(12), pct(r.hits / r.trials).padStart(11), pct(r.p).padStart(11), r.z.toFixed(2).padStart(7));
}

// RTP: ფსონი 100.00 ავტო-ქეშაუთით target-ზე, ყველა ბოლიდზე
console.log('\nRTP ავტო-ქეშაუთით (ფსონი ყოველ ბოლიდზე, ყოველ რბოლაში):');
const rtps = [];
for (const target of [101, 110, 150, 200, 300, 500, 1000, 2000, 5000, 10000, 20000]) {
  let staked = 0, ret = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < N; k++) { staked += 10000; if (target <= crashes[i][k]) ret += payout(10000, target); }
  const rtp = ret / staked, p = 97 / target, se = (target / 100) * Math.sqrt(p * (1 - p) / (3 * N));
  rtps.push({ target, rtp, z: (rtp - 0.97) / se });
  console.log(`  ×${(target / 100).toFixed(2).padEnd(6)} RTP ${(rtp * 100).toFixed(3)}%  (±${(se * 100).toFixed(3)}%, z ${((rtp - 0.97) / se).toFixed(2)})`);
}

const worst = Math.max(...rows.map(r => Math.abs(r.z)), ...rtps.map(r => Math.abs(r.z)));
console.log(`\nუდიდესი გადახრა: |z| = ${worst.toFixed(2)} ${worst < 4 ? '— ნორმის ფარგლებშია' : '— ყურადღება! გადახრა ძალიან დიდია'}`);
console.log(`დრო: ${((Date.now() - t0) / 1000).toFixed(1)} წმ`);
process.exitCode = worst < 4 ? 0 : 1;
