// ფსონის პანელების ლოგიკა (ბრაუზერისგან დამოუკიდებელი, ტესტირებადი).
// თითო ბოლიდს საკუთარი ფსონის პანელი აქვს: თავისი თანხა, ავტო-ქეშაუთი და ერთი ღილაკი,
// რომლის აზრი მდგომარეობაზეა დამოკიდებული (ფსონი → გაუქმება → ქეშაუთი → შედეგი).
//
// v — ხედი (view):
//   { ready, phase: 'bet'|'race'|'end', bets: [b|null ×3], cars: [{ended, crash100, type}×3],
//     mult (მიმდინარე კოეფიციენტი), stakes: [{ amount, auto|null } ×3] (ცენტები / ×100),
//     queued: [bool ×3] (ფსონი შემდეგ რბოლაზე), maxWin, counts: [n×3] }
//   b = { amount, auto, state: 'open'|'won'|'lost', m100, win }

export const CAR_IDS = [0, 1, 2];

/** მოგება ახლა: floor(ფსონი × კოეფიციენტი), მოგების ზღვრით */
export const payoutNow = (b, mult, maxWin = Infinity) => Math.min(Math.floor(b.amount * Math.floor(mult * 100) / 100), maxWin);

/**
 * პანელის მდგომარეობა: { car, st, cmd?, editable, ... }
 *   st:  'off'     — კავშირი არ არის
 *        'bet'     — ფსონების მიღება, ფსონი არ გაქვს            → cmd 'bet'
 *        'placed'  — ფსონი დადებულია, სტარტს ელოდება             → cmd 'cancel'
 *        'cash'    — რბოლა, ბოლიდი მიდის                          → cmd 'cashout'
 *        'won' / 'lost' — ამ რბოლის შედეგი
 *        'closed'  — ფსონების მიღება დახურულია                    → cmd 'queue' (შემდეგ რბოლაზე)
 *        'queued'  — ფსონი შემდეგი რბოლისთვისაა მომზადებული       → cmd 'unqueue'
 *   editable — თანხის და ავტოს შეცვლა შეიძლება
 */
export function slipState(v, i) {
  const b = v.bets[i], car = v.cars[i] || {}, stake = v.stakes[i];
  const ended = car.ended ? { type: car.type, crash100: car.crash100 } : null;
  const base = { car: i, count: v.counts?.[i] ?? 0 };
  if (!v.ready) return { ...base, st: 'off', editable: false };
  if (v.phase === 'bet') {
    if (b) return { ...base, st: 'placed', cmd: 'cancel', editable: false, amount: b.amount, auto: b.auto ?? null };
    return { ...base, st: 'bet', cmd: 'bet', editable: true, amount: stake.amount, auto: stake.auto };
  }
  if (b?.state === 'open' && !car.ended && v.phase === 'race') {
    return { ...base, st: 'cash', cmd: 'cashout', editable: false, amount: b.amount, mult: v.mult, payout: payoutNow(b, v.mult, v.maxWin) };
  }
  // რბოლის შედეგი ჩანს, სანამ შემდეგ რბოლაზე ფსონს არ მოამზადებ
  if (b && !v.queued[i]) {
    if (b.state === 'won') return { ...base, st: 'won', cmd: 'queue', editable: true, amount: b.amount, win: b.win, m100: b.m100 };
    return { ...base, st: 'lost', cmd: 'queue', editable: true, amount: b.amount, ended };
  }
  if (v.queued[i]) return { ...base, st: 'queued', cmd: 'unqueue', editable: false, amount: stake.amount, auto: stake.auto };
  return { ...base, st: 'closed', cmd: 'queue', editable: true, amount: stake.amount, auto: stake.auto, ended };
}

/** სერვერის ბრძანება პანელის ღილაკზე; 'queue'/'unqueue' მხოლოდ კლიენტშია (null) */
export function commandFor(s, stake) {
  if (s.cmd === 'bet') return { t: 'bet', car: s.car, amount: stake.amount, auto: stake.auto };
  if (s.cmd === 'cancel') return { t: 'cancel', car: s.car };
  if (s.cmd === 'cashout') return { t: 'cashout', car: s.car };
  return null;
}

/** ახალი რბოლის ფსონების მიღებისას: შემდეგი რბოლისთვის მომზადებული ფსონები */
export function queuedBets(v) {
  if (!v.ready || v.phase !== 'bet') return [];
  return CAR_IDS.filter(i => v.queued[i] && !v.bets[i]).map(i => ({ t: 'bet', car: i, amount: v.stakes[i].amount, auto: v.stakes[i].auto }));
}

// −/+ ღილაკების კიბე (ვალუტის ერთეულებში)
export const LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** თანხის შემდეგი საფეხური (ცენტებში): dir = +1 / −1, ზღვრებით [min, max] */
export function stepAmount(cents, dir, min = 100, max = 100000) {
  const steps = LADDER.map(u => u * 100).filter(c => c >= min && c <= max);
  const next = dir > 0 ? steps.find(c => c > cents) : [...steps].reverse().find(c => c < cents);
  return Math.max(min, Math.min(max, next ?? (dir > 0 ? max : min)));
}

// სწრაფი თანხები (ვალუტის ერთეულებში)
export const CHIPS = [10, 50, 100, 250];

/** სწრაფი თანხის ღილაკი: თანხა ცენტებში, ზღვრებით [min, max] (მაგ. max = ბალანსი) */
export const chipAmount = (units, min = 100, max = 100000) => Math.max(min, Math.min(max, Math.round(units * 100)));
