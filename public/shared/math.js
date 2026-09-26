// Gravel Rush — თამაშის მათემატიკა.
// ეს ფაილი ერთნაირად გამოიყენება სერვერზეც (Node) და ბრაუზერშიც (შემოწმების გვერდი),
// ამიტომ შედეგი ორივე მხარეს ბიტ-ბიტ ემთხვევა.

export const HOUSE_NUMERATOR = 97n;   // RTP = 97%  (house edge 3%)
export const STALL_BELOW = 115;       // 0..255 ბაიტი < 115  →  "გაჩერდა" (~45%)
export const G = 0.09;                // m(t) = e^(G·t)
export const CARS = 3;

const TWO_52 = 2n ** 52n;

/**
 * HMAC-SHA256 ჰეშიდან (hex) მანქანის შედეგი.
 *   r       = პირველი 52 ბიტი / 2^52            ∈ [0, 1)
 *   crash   = floor( 97 / (1 − r) ) / 100       — ზუსტი მთელრიცხვა (BigInt) გამოთვლა, ზედა ზღვრის გარეშე
 *             (ზღვარი მოგების თანხაზეა — იხ. maxWinM100)
 *   type    = შემდეგი ბაიტი < 115 ? 'stall' : 'crash'   (მხოლოდ ვიზუალი)
 * P(crash ≥ x) = 0.97 / x  →  ნებისმიერი ქეშაუთის სტრატეგიის EV = 0.97
 */
export function crashFromHash(hex) {
  const n = BigInt('0x' + hex.slice(0, 13));
  let crash100 = Number((HOUSE_NUMERATOR * TWO_52) / (TWO_52 - n));
  if (crash100 < 100) crash100 = 100;
  const type = parseInt(hex.slice(13, 15), 16) < STALL_BELOW ? 'stall' : 'crash';
  return { crash100, type };
}

export const multAt = t => Math.exp(G * t);
export const mult100At = t => Math.floor(Math.exp(G * t) * 100);
export const timeFor = m => Math.log(m) / G;
/** რამდენ წამზე ჩერდება მანქანა */
export const endTime = crash100 => Math.log(crash100 / 100) / G;
/**
 * მოგების ზღვარი → კოეფიციენტი (×100), რომელზეც ფსონი ავტომატურად იღებს მოგებას:
 * floor(maxWin × 100 / ფსონი). ამ კოეფიციენტზე payout ≤ maxWin.
 */
export const maxWinM100 = (amountCents, maxWinCents) => Math.floor((maxWinCents * 100) / amountCents);
/** მოგება ცენტებში: floor(ფსონი × კოეფიციენტი) */
export const payout = (amountCents, m100) => Math.floor((amountCents * m100) / 100);
export const roundMessage = (clientSeed, car) => `${clientSeed}:${car}`;
