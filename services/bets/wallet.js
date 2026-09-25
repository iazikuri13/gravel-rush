// ფსონების სერვისის ლოგიკა: მოთამაშეები, ბალანსი, ფსონები, ანგარიშსწორება, ჟურნალი.
// რაუნდის შედეგი წინასწარ არ იცის — იგებს რაუნდის სერვისის მოვლენებიდან (car_ended)
// და ქეშაუთის დროზე ყოფნას ეკითხება რაუნდის სერვისს (check).
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { payout, timeFor } from '../../public/shared/math.js';
import { RULES } from '../lib/rules.js';
import { HttpError } from '../lib/http.js';

const rule = msg => new HttpError(409, msg);

export class Wallet extends EventEmitter {
  /** @param round  { accepting(): Promise<{round, accepting}>, check(round, body): Promise<{ok, m100}> } */
  constructor(store, round) {
    super();
    this.store = store;
    this.round = round;
    this.players = store.read('players.json', {});
    this.bets = new Map();          // token → bet (მიმდინარე რაუნდი)
    this.ended = new Map();         // car → { crash100, type }
    this.timers = [];
    this.state = null;              // რაუნდის საჯარო მდგომარეობა
    this.#refundPending();
  }

  #savePlayers() { this.store.writeSoon('players.json', () => this.players); }
  #ledger(e) { this.store.append('ledger.jsonl', e); }

  // სერვისი რაუნდის შუაში თუ გაჩერდა — ღია ფსონები ბრუნდება
  #refundPending() {
    const p = this.store.read('pending.json', null);
    if (!p) return;
    for (const b of p.bets) {
      const pl = this.players[b.token];
      if (!pl) continue;
      pl.balance += b.amount;
      this.#ledger({ type: 'refund', round: p.round, token: b.token, amount: b.amount, balance: pl.balance });
    }
    this.store.write('pending.json', null);
    this.store.write('players.json', this.players);
  }

  // ---------- რაუნდის მოვლენები ----------

  onRoundEvent(type, data) {
    if (data.state) this.state = data.state;
    switch (type) {
      case 'bet_open':
        this.#clearTimers();
        this.bets.clear(); this.ended.clear();
        this.#changed();
        break;
      case 'race_started':
        this.store.write('pending.json', { round: this.state.round, bets: [...this.bets.values()].map(b => ({ token: b.token, amount: b.amount })) });
        this.#scheduleAuto();
        break;
      case 'car_ended':
        this.ended.set(data.car, { crash100: data.crash100, type: data.type });
        for (const b of this.bets.values()) if (b.car === data.car) this.#settleIfEnded(b);
        break;
      case 'round_ended':
        this.#clearTimers();
        this.store.write('pending.json', null);
        this.store.write('players.json', this.players);
        break;
    }
  }

  /** რაუნდის მდგომარეობის სინქრონიზაცია (გაშვებისას / SSE-ის ხელახალი დაკავშირებისას) */
  syncState(state) {
    if (this.state && state.round !== this.state.round) { this.bets.clear(); this.ended.clear(); this.#clearTimers(); }
    this.state = state;
    state.cars.forEach((c, i) => { if (c.ended) this.ended.set(i, { crash100: c.crash100, type: c.type }); });
    for (const b of this.bets.values()) this.#settleIfEnded(b);
  }

  #clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  dispose() { this.#clearTimers(); }

  #scheduleAuto() {
    const { raceStart, speed } = this.state;
    for (const b of this.bets.values()) {
      if (!b.auto) continue;
      const at = raceStart + timeFor(b.auto / 100) / speed * 1000;
      this.timers.push(setTimeout(() => this.#autoCheck(b), Math.max(0, at - Date.now())));
    }
  }

  async #autoCheck(b) {
    if (b.state !== 'open') return;
    b.state = 'cashing';
    let r;
    try { r = await this.round.check(b.round, { car: b.car, m100: b.auto }); }
    catch { r = { ok: false }; }
    if (b.state !== 'cashing') return;
    if (r.ok) this.#win(b, b.auto);
    else { b.state = 'open'; this.#settleIfEnded(b); }
  }

  #settleIfEnded(b) {
    const e = this.ended.get(b.car);
    if (!e || b.state !== 'open') return;
    if (b.auto && b.auto <= e.crash100) this.#win(b, b.auto);
    else this.#lose(b, e);
  }

  #win(b, m100) {
    const pl = this.players[b.token];
    b.state = 'won'; b.m100 = m100; b.win = payout(b.amount, m100);
    pl.balance += b.win;
    this.#ledger({ type: 'win', round: b.round, token: b.token, car: b.car, amount: b.amount, m100, win: b.win, balance: pl.balance });
    this.#savePlayers();
    this.emit('settled', { token: b.token, result: { state: 'won', car: b.car, m100, win: b.win, amount: b.amount }, me: this.me(b.token) });
    this.#changed();
  }

  #lose(b, e) {
    b.state = 'lost';
    this.#ledger({ type: 'lose', round: b.round, token: b.token, car: b.car, amount: b.amount, crash100: e.crash100 });
    this.emit('settled', { token: b.token, result: { state: 'lost', car: b.car, m100: 0, win: 0, amount: b.amount, crash100: e.crash100, type: e.type }, me: this.me(b.token) });
    this.#changed();
  }

  #changed() { this.emit('bets_changed', this.publicBets()); }

  // ---------- მოთამაშეები ----------

  #player(token) {
    const pl = typeof token === 'string' && this.players[token];
    if (!pl) throw new HttpError(404, 'მოთამაშე ვერ მოიძებნა');
    return pl;
  }

  join({ token, name } = {}) {
    let pl = typeof token === 'string' && this.players[token];
    if (!pl) {
      token = randomBytes(16).toString('hex');
      pl = this.players[token] = { name: cleanName(name) || 'მრბოლელი-' + token.slice(0, 4), balance: RULES.startBalance, createdAt: new Date().toISOString() };
      this.#ledger({ type: 'create', token, balance: pl.balance });
    }
    // საჯარო იდენტიფიკატორი (token საიდუმლოა და არასდროს ქვეყნდება)
    if (!pl.pid) pl.pid = randomBytes(4).toString('hex');
    this.#savePlayers();
    return { token, me: this.me(token) };
  }

  rename(token, name) {
    const pl = this.#player(token);
    const n = cleanName(name);
    if (!n) throw new HttpError(400, 'სახელი 2–16 სიმბოლო უნდა იყოს');
    pl.name = n;
    this.#savePlayers();
    return this.me(token);
  }

  refill(token) {
    const pl = this.#player(token);
    if (pl.balance >= RULES.refillBelow) throw rule('შევსება შესაძლებელია, როცა ბალანსი 10.00-ზე ნაკლებია');
    pl.balance = RULES.startBalance;
    this.#ledger({ type: 'refill', token, balance: pl.balance });
    this.#savePlayers();
    return this.me(token);
  }

  // ---------- ფსონები ----------

  async placeBet(token, { car, amount, auto = null } = {}) {
    const pl = this.#player(token);
    if (![0, 1, 2].includes(car)) throw new HttpError(400, 'აირჩიე მანქანა');
    if (!Number.isInteger(amount) || amount < RULES.minBet || amount > RULES.maxBet) throw new HttpError(400, 'ფსონი 1.00-დან 1 000.00-მდე უნდა იყოს');
    if (auto != null && (!Number.isInteger(auto) || auto < RULES.minAuto || auto > RULES.maxAuto)) throw new HttpError(400, 'ავტო-ქეშაუთი ×1.01-დან ×100-მდე უნდა იყოს');
    const acc = await this.round.accepting();
    if (!acc.accepting || !this.state || acc.round !== this.state.round) throw rule('ფსონების მიღება დასრულებულია — დაელოდე შემდეგ ეტაპს');
    // await-ის შემდეგ ხელახლა ვამოწმებთ (პარალელური მოთხოვნები)
    if (this.bets.has(token)) throw rule('ამ ეტაპზე ფსონი უკვე დადებული გაქვს');
    if (pl.balance < amount) throw rule('ბალანსი არ გყოფნის — შეამცირე ფსონი');
    pl.balance -= amount;
    const bet = { token, pid: pl.pid, name: pl.name, round: acc.round, car, amount, auto: auto ?? null, state: 'open', m100: 0, win: 0 };
    this.bets.set(token, bet);
    this.#ledger({ type: 'bet', round: acc.round, token, car, amount, auto: bet.auto, balance: pl.balance });
    this.#savePlayers();
    this.#changed();
    return this.me(token);
  }

  async cancelBet(token) {
    const pl = this.#player(token);
    const acc = await this.round.accepting();
    if (!acc.accepting) throw rule('სტარტის შემდეგ ფსონის გაუქმება შეუძლებელია');
    const bet = this.bets.get(token);
    if (!bet || bet.round !== acc.round) throw rule('გასაუქმებელი ფსონი არ გაქვს');
    pl.balance += bet.amount;
    this.bets.delete(token);
    this.#ledger({ type: 'cancel', round: bet.round, token, amount: bet.amount, balance: pl.balance });
    this.#savePlayers();
    this.#changed();
    return this.me(token);
  }

  async cashOut(token) {
    this.#player(token);
    const bet = this.bets.get(token);
    if (!bet || bet.state !== 'open' || this.state?.phase !== 'race') throw rule('ქეშაუთი ახლა შეუძლებელია');
    bet.state = 'cashing';
    let r;
    try { r = await this.round.check(bet.round, { car: bet.car }); }
    catch (e) { bet.state = 'open'; this.#settleIfEnded(bet); throw new HttpError(503, 'რაუნდის სერვისი მიუწვდომელია'); }
    if (r.ok) { this.#win(bet, r.m100); return this.me(token); }
    bet.state = 'open';
    this.#settleIfEnded(bet);
    throw rule('დააგვიანე — მანქანა უკვე გაჩერდა');
  }

  // ---------- წარმოდგენები ----------

  me(token) {
    const pl = this.#player(token);
    const b = this.bets.get(token);
    return {
      pid: pl.pid, name: pl.name, balance: pl.balance,
      bet: b ? { car: b.car, amount: b.amount, auto: b.auto, state: pubState(b), m100: b.m100, win: b.win } : null
    };
  }

  publicBets() {
    return {
      round: this.state?.round,
      bets: [...this.bets.values()].map(b => ({ pid: b.pid, name: b.name, car: b.car, amount: b.amount, state: pubState(b), m100: b.m100, win: b.win }))
    };
  }
}

const pubState = b => (b.state === 'cashing' ? 'open' : b.state);

function cleanName(s) {
  if (typeof s !== 'string') return '';
  const n = s.replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, 16);
  return n.length >= 2 ? n : '';
}
