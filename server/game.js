// თამაშის ძრავა — ერთადერთი "ჭეშმარიტების წყარო".
// კლიენტი მხოლოდ ანიმაციას ხატავს; ფსონი, ქეშაუთი და შედეგი მხოლოდ აქ წყდება.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { buildChain, newSecret, roundResults } from './fair.js';
import { endTime, mult100At, timeFor, payout, MAX_CRASH_100 } from '../public/shared/math.js';

export const RULES = {
  betMs: 7000,
  endMs: 4000,
  tickMs: 20,
  minBet: 100,          // ცენტებში: 1.00
  maxBet: 100000,       // 1 000.00
  startBalance: 100000, // დემო: 1 000.00
  refillBelow: 1000,    // შევსება შეიძლება, თუ ბალანსი < 10.00
  minAuto: 101,
  maxAuto: MAX_CRASH_100,
  historySize: 30
};

export class Game extends EventEmitter {
  /**
   * @param opts.secret  ჯაჭვის secret — მხოლოდ ახალი ჯაჭვის შექმნისას (ტესტები / საიდუმლოების მენეჯერი)
   * @param opts.speed   დროის აჩქარება (მხოლოდ ტესტებისთვის; პროდაქშენში 1)
   */
  constructor(store, { chainLength = 100000, clientSeed, secret, betMs = RULES.betMs, endMs = RULES.endMs, speed = 1 } = {}) {
    super();
    this.store = store;
    this.betMs = betMs;
    this.endMs = endMs;
    this.speed = speed;
    if (!store.meta) {
      store.meta = {
        secret: secret || newSecret(),
        chainLength,
        clientSeed: clientSeed || 'gravel-rush-demo-' + randomBytes(4).toString('hex'),
        nextRound: 1,
        createdAt: new Date().toISOString()
      };
      store.saveMeta();
    }
    this.chain = buildChain(store.meta.secret, store.meta.chainLength);
    this.commit = this.chain[0];
    this.history = [];
    this.bets = new Map();      // token → bet
    this.phase = 'idle';
    this.#refundPending();
  }

  // სერვერი რაუნდის შუაში თუ გაჩერდა — ღია ფსონები ბრუნდება
  #refundPending() {
    const p = this.store.pending;
    if (!p) return;
    for (const b of p.bets) {
      const pl = this.store.players[b.token];
      if (!pl) continue;
      pl.balance += b.amount;
      this.store.ledger({ type: 'refund', round: p.round, token: b.token, amount: b.amount, balance: pl.balance });
    }
    this.store.pending = null;
    this.store.savePending();
    this.store.savePlayersNow();
  }

  get clientSeed() { return this.store.meta.clientSeed; }

  start() { this.#newRound(); }

  #newRound() {
    const round = this.store.meta.nextRound;
    if (round > this.store.meta.chainLength) {
      this.phase = 'halted';
      this.emit('snap');
      console.error('ჰეშ-ჯაჭვი ამოიწურა — საჭიროა ახალი ჯაჭვი და ახალი commit.');
      return;
    }
    // რაუნდის ნომერი ინახება თამაშამდე — ერთი seed ორჯერ არასდროს გამოიყენება
    this.store.meta.nextRound = round + 1;
    this.store.saveMeta();

    this.round = round;
    this.seed = this.chain[round];
    this.roundHash = this.chain[round - 1];
    this.cars = roundResults(this.seed, this.clientSeed).map(r => ({ ...r, endT: endTime(r.crash100), ended: false }));
    this.bets.clear();
    this.phase = 'bet';
    this.phaseStart = Date.now();
    this.raceStart = 0;
    this.emit('snap');
    this.timer = setTimeout(() => this.#startRace(), this.betMs);
  }

  #startRace() {
    this.phase = 'race';
    this.raceStart = Date.now();
    this.store.pending = { round: this.round, bets: [...this.bets.values()].map(b => ({ token: b.token, amount: b.amount })) };
    this.store.savePending();
    this.emit('snap');
    this.ticker = setInterval(() => this.#tick(), RULES.tickMs);
  }

  #tick() {
    const t = (Date.now() - this.raceStart) / 1000 * this.speed;
    // 1) ავტო-ქეშაუთები, რომლებიც მანქანის გაჩერებამდე ხვდება
    for (const b of this.bets.values()) {
      if (b.state !== 'open' || !b.auto) continue;
      const car = this.cars[b.car];
      // "×1.94-ზე გაჩერდა" = კოეფიციენტმა 1.94-ს მიაღწია → ×1.94-ის მიზანი იგებს.
      // (≤ და არა <, თორემ RTP 97%-ზე დაბალი გამოდის — იხ. test/fair.test.js)
      if (b.auto <= car.crash100 && t >= timeFor(b.auto / 100)) this.#win(b, b.auto);
    }
    // 2) მანქანების გაჩერება
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.ended || t < car.endT) continue;
      car.ended = true;
      for (const b of this.bets.values()) {
        if (b.car !== i || b.state !== 'open') continue;
        b.state = 'lost';
        this.store.ledger({ type: 'lose', round: this.round, token: b.token, car: i, amount: b.amount, crash100: car.crash100 });
        this.emit('result', b);
      }
      this.emit('snap');
    }
    if (this.cars.every(c => c.ended)) this.#endRound();
  }

  #win(b, m100) {
    const pl = this.store.players[b.token];
    b.state = 'won';
    b.m100 = m100;
    b.win = payout(b.amount, m100);
    pl.balance += b.win;
    this.store.ledger({ type: 'win', round: this.round, token: b.token, car: b.car, amount: b.amount, m100, win: b.win, balance: pl.balance });
    this.store.savePlayers();
    this.emit('result', b);
    this.emit('snapSoon');
  }

  #endRound() {
    clearInterval(this.ticker);
    this.phase = 'end';
    this.phaseStart = Date.now();
    this.history.unshift({
      round: this.round,
      hash: this.roundHash,
      seed: this.seed,
      results: this.cars.map(c => ({ crash100: c.crash100, type: c.type }))
    });
    this.history.length = Math.min(this.history.length, RULES.historySize);
    this.store.pending = null;
    this.store.savePending();
    this.store.savePlayersNow();
    this.emit('end');
    this.emit('snap');
    this.timer = setTimeout(() => this.#newRound(), this.endMs);
  }

  // ---------- მოთამაშეები ----------

  join(token, name) {
    let pl = token && this.store.players[token];
    if (!pl) {
      token = randomBytes(16).toString('hex');
      pl = this.store.players[token] = { name: cleanName(name) || 'მრბოლელი-' + token.slice(0, 4), balance: RULES.startBalance, createdAt: new Date().toISOString() };
      this.store.ledger({ type: 'create', token, balance: pl.balance });
    }
    // საჯარო იდენტიფიკატორი ფსონების სიისთვის (token საიდუმლოა და არასდროს ქვეყნდება)
    if (!pl.pid) pl.pid = randomBytes(4).toString('hex');
    this.store.savePlayers();
    return { token, player: pl };
  }

  rename(token, name) {
    const n = cleanName(name);
    if (!n) throw new GameError('სახელი 2–16 სიმბოლო უნდა იყოს');
    this.store.players[token].name = n;
    this.store.savePlayers();
  }

  refill(token) {
    const pl = this.store.players[token];
    if (pl.balance >= RULES.refillBelow) throw new GameError('შევსება შესაძლებელია, როცა ბალანსი 10.00-ზე ნაკლებია');
    pl.balance = RULES.startBalance;
    this.store.ledger({ type: 'refill', token, balance: pl.balance });
    this.store.savePlayers();
  }

  placeBet(token, { car, amount, auto }) {
    if (this.phase !== 'bet') throw new GameError('ფსონების მიღება დასრულებულია — დაელოდე შემდეგ ეტაპს');
    if (this.bets.has(token)) throw new GameError('ამ ეტაპზე ფსონი უკვე დადებული გაქვს');
    if (![0, 1, 2].includes(car)) throw new GameError('აირჩიე მანქანა');
    if (!Number.isInteger(amount) || amount < RULES.minBet || amount > RULES.maxBet) throw new GameError('ფსონი 1.00-დან 1 000.00-მდე უნდა იყოს');
    if (auto != null && (!Number.isInteger(auto) || auto < RULES.minAuto || auto > RULES.maxAuto)) throw new GameError('ავტო-ქეშაუთი ×1.01-დან ×100-მდე უნდა იყოს');
    const pl = this.store.players[token];
    if (pl.balance < amount) throw new GameError('ბალანსი არ გყოფნის — შეამცირე ფსონი');
    pl.balance -= amount;
    const bet = { token, pid: pl.pid, name: pl.name, car, amount, auto: auto ?? null, state: 'open', m100: 0, win: 0 };
    this.bets.set(token, bet);
    this.store.ledger({ type: 'bet', round: this.round, token, car, amount, auto: bet.auto, balance: pl.balance });
    this.store.savePlayers();
    this.emit('snapSoon');
    return bet;
  }

  cancelBet(token) {
    if (this.phase !== 'bet') throw new GameError('სტარტის შემდეგ ფსონის გაუქმება შეუძლებელია');
    const bet = this.bets.get(token);
    if (!bet) throw new GameError('გასაუქმებელი ფსონი არ გაქვს');
    const pl = this.store.players[token];
    pl.balance += bet.amount;
    this.bets.delete(token);
    this.store.ledger({ type: 'cancel', round: this.round, token, amount: bet.amount, balance: pl.balance });
    this.store.savePlayers();
    this.emit('snapSoon');
  }

  cashOut(token) {
    const bet = this.bets.get(token);
    if (this.phase !== 'race' || !bet || bet.state !== 'open') throw new GameError('ქეშაუთი ახლა შეუძლებელია');
    const t = (Date.now() - this.raceStart) / 1000 * this.speed;
    const car = this.cars[bet.car];
    if (car.ended || t >= car.endT) throw new GameError('დააგვიანე — მანქანა უკვე გაჩერდა');
    // t < endT  ⇒  e^(G·t) < crash  ⇒  m100 < crash100
    this.#win(bet, Math.max(100, mult100At(t)));
    return bet;
  }

  // ---------- საჯარო მდგომარეობა (არასდროს შეიცავს გაუჩერებელი მანქანის შედეგს) ----------

  publicState() {
    return {
      phase: this.phase,
      round: this.round,
      roundHash: this.roundHash,
      phaseStart: this.phaseStart,
      raceStart: this.raceStart,
      cars: (this.cars || []).map(c => (c.ended ? { ended: true, crash100: c.crash100, type: c.type } : { ended: false })),
      bets: [...this.bets.values()].map(b => ({ pid: b.pid, name: b.name, car: b.car, amount: b.amount, state: b.state, m100: b.m100, win: b.win }))
    };
  }

  myState(token) {
    const pl = this.store.players[token];
    const b = this.bets.get(token);
    return {
      pid: pl.pid,
      name: pl.name,
      balance: pl.balance,
      bet: b ? { car: b.car, amount: b.amount, auto: b.auto, state: b.state, m100: b.m100, win: b.win } : null
    };
  }
}

export class GameError extends Error {}

function cleanName(s) {
  if (typeof s !== 'string') return '';
  const n = s.replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, 16);
  return n.length >= 2 ? n : '';
}
