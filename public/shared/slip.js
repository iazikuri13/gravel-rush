// ფსონის პანელის ლოგიკა (ბრაუზერისგან დამოუკიდებელი, ტესტირებადი).
// მოთამაშეს ერთ რბოლაში სამამდე ფსონი აქვს — თითო ბოლიდზე. აქ წყდება:
//  - რას აჩვენებს თითოეული ბოლიდის ბარათი და რა ბრძანებას აგზავნის დაჭერისას
//  - რას აკეთებს მთავარი ღილაკი (ფსონი დარჩენილებზე / ყველას გაუქმება / ყველას ქეშაუთი)
//
// v — ხედი (view):
//   { ready, phase: 'bet'|'race'|'end', bets: [b|null ×3], cars: [{ended, crash100, type}×3],
//     mult (მიმდინარე კოეფიციენტი), stake: { amount, auto|null } (ცენტები / ×100), maxWin, counts: [n×3] }
//   b = { amount, auto, state: 'open'|'won'|'lost', m100, win }

export const CAR_IDS = [0, 1, 2];

/** მოგება ახლა: floor(ფსონი × კოეფიციენტი), მოგების ზღვრით */
export const payoutNow = (b, mult, maxWin = Infinity) => Math.min(Math.floor(b.amount * Math.floor(mult * 100) / 100), maxWin);

const isOpen = (v, i) => v.bets[i]?.state === 'open' && !v.cars[i]?.ended;

/**
 * ბოლიდის ბარათი: { st, cmd?, amount?, mult?, payout?, win?, m100?, ended? }
 *   st: 'idle' | 'bet' | 'placed' | 'cash' | 'won' | 'lost'
 *   cmd: 'bet' | 'cancel' | 'cashout' — დაჭერის ქმედება (არ არის — ბარათი არააქტიურია)
 */
export function carAction(v, i) { return { car: i, ...cardState(v, i) }; }

function cardState(v, i) {
  const b = v.bets[i], car = v.cars[i] || {};
  if (!v.ready) return { st: 'idle' };
  if (v.phase === 'bet') return b ? { st: 'placed', cmd: 'cancel', amount: b.amount, auto: b.auto } : { st: 'bet', cmd: 'bet', amount: v.stake.amount, auto: v.stake.auto };
  if (b) {
    if (isOpen(v, i) && v.phase === 'race') return { st: 'cash', cmd: 'cashout', amount: b.amount, mult: v.mult, payout: payoutNow(b, v.mult, v.maxWin) };
    if (b.state === 'won') return { st: 'won', win: b.win, m100: b.m100 };
    return { st: 'lost', amount: b.amount, ended: car.ended ? car : null };
  }
  return { st: 'idle', ended: car.ended ? car : null, racing: v.phase === 'race', count: v.counts?.[i] ?? 0 };
}

/**
 * მთავარი ღილაკი: { kind, cars, total, ... }
 *   kind: 'wait' | 'bet-rest' | 'cancel-all' | 'cash-all' | 'result' | 'next'
 *   cars — რომელ ბოლიდებზე მოქმედებს
 */
export function mainAction(v) {
  if (!v.ready) return { kind: 'wait', cars: [] };
  const mine = CAR_IDS.filter(i => v.bets[i]);
  if (v.phase === 'bet') {
    const free = CAR_IDS.filter(i => !v.bets[i]);
    if (free.length) return { kind: 'bet-rest', cars: free, total: free.length * v.stake.amount };
    return { kind: 'cancel-all', cars: mine, total: mine.reduce((a, i) => a + v.bets[i].amount, 0) };
  }
  const won = mine.reduce((a, i) => a + (v.bets[i].state === 'won' ? v.bets[i].win : 0), 0);
  const staked = mine.reduce((a, i) => a + v.bets[i].amount, 0);
  if (v.phase === 'race') {
    const open = CAR_IDS.filter(i => isOpen(v, i));
    if (open.length) return { kind: 'cash-all', cars: open, total: open.reduce((a, i) => a + payoutNow(v.bets[i], v.mult, v.maxWin), 0) };
    if (mine.length) return { kind: 'result', cars: mine, won, staked, wins: mine.filter(i => v.bets[i].state === 'won').length };
    return { kind: 'wait', cars: [] };
  }
  return { kind: 'next', cars: mine, won, staked };
}

/** ბრძანებები სერვერისთვის: ბარათის ან მთავარი ღილაკის დაჭერისას */
export function commandsFor(action, stake) {
  if (action.cmd === 'bet' || action.kind === 'bet-rest') {
    const cars = action.kind ? action.cars : [action.car];
    return cars.map(car => ({ t: 'bet', car, amount: stake.amount, auto: stake.auto }));
  }
  if (action.cmd === 'cancel') return [{ t: 'cancel', car: action.car }];
  if (action.cmd === 'cashout') return [{ t: 'cashout', car: action.car }];
  if (action.kind === 'cancel-all') return action.cars.map(car => ({ t: 'cancel', car }));
  if (action.kind === 'cash-all') return action.cars.map(car => ({ t: 'cashout', car }));
  return [];
}
