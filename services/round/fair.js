// Provably fair: ჰეშ-ჯაჭვი + HMAC.
//
// 1. სერვერი ქმნის საიდუმლო secret-ს:  chain[N] = secret
// 2. chain[k-1] = sha256(chain[k])   …   chain[0] = commit  (ქვეყნდება წინასწარ)
// 3. რაუნდი n იყენებს chain[n]-ს. რაუნდამდე ქვეყნდება მისი ჰეში chain[n-1],
//    რაუნდის შემდეგ — თავად chain[n].
// 4. მანქანა i-ს შედეგი = crashFromHash( HMAC_SHA256(key = chain[n], msg = `${clientSeed}:${i}`) )
//
// სერვერს არ შეუძლია შედეგის შეცვლა: seed-ები ჯაჭვით წინასწარაა დაფიქსირებული,
// clientSeed კი ჯაჭვის გამოქვეყნების შემდეგ ირჩევა (პროდაქშენში — მომავალი ბლოკის ჰეში).
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { crashFromHash, roundMessage, CARS } from '../../public/shared/math.js';

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const newSecret = () => randomBytes(32).toString('hex');

export function buildChain(secret, length) {
  const chain = new Array(length + 1);
  chain[length] = secret;
  for (let k = length; k > 0; k--) chain[k - 1] = sha256(chain[k]);
  return chain;
}

export function roundResults(seed, clientSeed) {
  const out = [];
  for (let i = 0; i < CARS; i++) {
    out.push(crashFromHash(createHmac('sha256', seed).update(roundMessage(clientSeed, i)).digest('hex')));
  }
  return out;
}
