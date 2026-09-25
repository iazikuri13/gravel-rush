// რაუნდის ძრავა: ჰეშ-ჯაჭვი, ფაზები, მანქანების გაჩერება.
// ფულზე არაფერი იცის. გაუჩერებელი მანქანის შედეგს არავის უმხელს —
// მხოლოდ პასუხობს კითხვაზე "ეს ქეშაუთი დროზეა?" (check).
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { buildChain, newSecret, roundResults } from './fair.js';
import { endTime, mult100At } from '../../public/shared/math.js';
import { RULES } from '../lib/rules.js';

export class RoundEngine extends EventEmitter {
  constructor(store, { chainLength = 100000, clientSeed, secret, betMs = RULES.betMs, endMs = RULES.endMs, speed = 1, now = Date.now } = {}) {
    super();
    this.store = store;
    this.betMs = betMs; this.endMs = endMs; this.speed = speed; this.now = now;
    this.meta = store.read('meta.json', null);
    if (!this.meta) {
      this.meta = {
        secret: secret || newSecret(),
        chainLength,
        clientSeed: clientSeed || 'gravel-rush-demo-' + randomBytes(4).toString('hex'),
        nextRound: 1,
        createdAt: new Date().toISOString()
      };
      store.write('meta.json', this.meta);
    }
    this.chain = buildChain(this.meta.secret, this.meta.chainLength);
    this.commit = this.chain[0];
    this.history = [];
    this.phase = 'idle';
    this.cars = [];
  }

  get clientSeed() { return this.meta.clientSeed; }
  fairness() { return { commit: this.commit, chainLength: this.meta.chainLength, clientSeed: this.clientSeed }; }

  start() { this.#newRound(); }
  stop() { clearTimeout(this.timer); clearInterval(this.ticker); this.phase = 'stopped'; }

  /** რბოლის დრო წამებში (აჩქარების გათვალისწინებით) */
  raceTime() { return (this.now() - this.raceStart) / 1000 * this.speed; }

  #newRound() {
    const round = this.meta.nextRound;
    if (round > this.meta.chainLength) {
      this.phase = 'halted';
      this.emit('event', 'halted', { state: this.publicState() });
      console.error('ჰეშ-ჯაჭვი ამოიწურა — საჭიროა ახალი ჯაჭვი და ახალი commit.');
      return;
    }
    // ნომერი ინახება თამაშამდე — ერთი seed ორჯერ არასდროს გამოიყენება
    this.meta.nextRound = round + 1;
    this.store.write('meta.json', this.meta);

    this.round = round;
    this.seed = this.chain[round];
    this.roundHash = this.chain[round - 1];
    this.cars = roundResults(this.seed, this.clientSeed).map(r => ({ ...r, endT: endTime(r.crash100), ended: false }));
    this.phase = 'bet';
    this.phaseStart = this.now();
    this.raceStart = 0;
    this.emit('event', 'bet_open', { state: this.publicState() });
    this.timer = setTimeout(() => this.#startRace(), this.betMs);
  }

  #startRace() {
    this.phase = 'race';
    this.raceStart = this.now();
    this.emit('event', 'race_started', { state: this.publicState() });
    this.ticker = setInterval(() => this.#tick(), RULES.tickMs);
  }

  #tick() {
    const t = this.raceTime();
    this.cars.forEach((car, i) => {
      if (car.ended || t < car.endT) return;
      car.ended = true;
      this.emit('event', 'car_ended', { round: this.round, car: i, crash100: car.crash100, type: car.type, state: this.publicState() });
    });
    if (this.cars.every(c => c.ended)) this.#endRound();
  }

  #endRound() {
    clearInterval(this.ticker);
    this.phase = 'end';
    this.phaseStart = this.now();
    const item = { round: this.round, hash: this.roundHash, seed: this.seed, results: this.cars.map(c => ({ crash100: c.crash100, type: c.type })) };
    this.history.unshift(item);
    this.history.length = Math.min(this.history.length, RULES.historySize);
    this.emit('event', 'round_ended', { item, state: this.publicState() });
    this.timer = setTimeout(() => this.#newRound(), this.endMs);
  }

  /** იღებს თუ არა ახლა ფსონს მოცემული რაუნდი */
  accepting() {
    const left = this.betMs - (this.now() - this.phaseStart);
    return { round: this.round, accepting: this.phase === 'bet' && left > RULES.closeMarginMs };
  }

  /**
   * ქეშაუთის შემოწმება (შიდა API):
   *  - auto (m100 მოცემულია): დასაშვებია, თუ m100 ≤ crash100 — "×1.94-ზე გაჩერდა" = 1.94-ს მიაღწია
   *  - ხელით: სერვერის ახლანდელი დროით; დასაშვებია, თუ მანქანა ჯერ არ გაჩერებულა
   * შედეგს (crash100) არ აბრუნებს.
   */
  check({ round, car, m100 }) {
    if (round !== this.round || this.phase !== 'race' || !this.cars[car]) return { ok: false };
    const c = this.cars[car];
    if (m100 != null) return { ok: m100 <= c.crash100, m100 };
    const t = this.raceTime();
    if (c.ended || t >= c.endT) return { ok: false };
    return { ok: true, m100: Math.max(100, mult100At(t)) };
  }

  publicState() {
    return {
      phase: this.phase, round: this.round, roundHash: this.roundHash,
      phaseStart: this.phaseStart, raceStart: this.raceStart,
      betMs: this.betMs, endMs: this.endMs, speed: this.speed,
      cars: this.cars.map(c => (c.ended ? { ended: true, crash100: c.crash100, type: c.type } : { ended: false }))
    };
  }
}
