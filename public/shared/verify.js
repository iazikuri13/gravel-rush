// ბრაუზერის (და Node 18+-ის) WebCrypto-ზე დაფუძნებული შემოწმება.
// ნებისმიერ მოთამაშეს შეუძლია დამოუკიდებლად გადაამოწმოს რაუნდის შედეგი.
import { crashFromHash, roundMessage, CARS } from './math.js';

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function sha256(str) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}

export async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/** სამივე მანქანის შედეგი seed-იდან */
export async function resultsFromSeed(seed, clientSeed) {
  const out = [];
  for (let i = 0; i < CARS; i++) out.push(crashFromHash(await hmac(seed, roundMessage(clientSeed, i))));
  return out;
}

/**
 * ამოწმებს, რომ seed ეკუთვნის წინასწარ გამოქვეყნებულ ჯაჭვს:
 * sha256 გამოყენებული `round`-ჯერ უნდა დაემთხვეს commit-ს.
 */
export async function verifyChain(seed, round, commit, onProgress) {
  let h = seed;
  for (let k = 0; k < round; k++) {
    h = await sha256(h);
    if (onProgress && k % 2000 === 0) onProgress(k / round);
  }
  return h === commit;
}
