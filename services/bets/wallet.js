// ფსონების სერვისის ლოგიკა: მოთამაშეები, ბალანსი, ფსონები, ანგარიშსწორება, ჟურნალი.
// რაუნდის შედეგი წინასწარ არ იცის — იგებს რაუნდის სერვისის მოვლენებიდან (car_ended)
// და ქეშაუთის დროზე ყოფნას ეკითხება რაუნდის სერვისს (check).
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { payout, timeFor } from '../../public/shared/math.js';
import { RULES } from '../lib/rules.js';
import { HttpError } from '../lib/http.js';

const rule = msg => new HttpError(409, msg);

// გარე პლატფორმის (კაზინოს) შეცდომა → მოთამაშისთვის გასაგები შეცდომა
function extError(e) {
  if (e.code === 'INSUFFICIENT_FUNDS') return rule('ბალანსი არ გყოფნის — შეამცირე ფსონი');
  if (e.code === 'SESSION_EXPIRED' || e.code === 'SESSION_NOT_FOUND') return new HttpError(409, 'სესია ამოიწურა — გაუშვი თამაში თავიდან კაზინოდან');
  if (!e.status || e.status >= 500 || e.code === 'PLATFORM_UNAVAILABLE') return new HttpError(503, 'კაზინოსთან კავშირი ვერ დამყარდა — სცადე თავიდან');
  return new HttpError(409, e.message || 'კაზინომ ოპერაცია უარყო');
}
const uncertain = e => !e.status || e.status >= 500 || e.code === 'PLATFORM_UNAVAILABLE';

export class Wallet extends EventEmitter {
  /**
   * @param round  { accepting(): Promise<{round, accepting}>, check(round, body): Promise<{ok, m100}> }
   * @param ext    შუამავალი (გარე კაზინოს საფულე) ან null:
   *               { session(s), balance(s) → {balance}, tx(s, {id, kind, roundId, amount, ref?}) → {balance} }
   *               კაზინოდან გაშვებული მოთამაშის ფული კაზინოშია — ყოველი ფსონი/მოგება/დაბრუნება მას ეგზავნება.
   */
  constructor(store, round, ext = null) {
    super();
    this.store = store;
    this.round = round;
    this.ext = ext;
    this.players = store.read('players.json', {});
    this.bets = new Map();          // token → bet (მიმდინარე რაუნდი)
    this.placing = new Set();       // token-ები, რომელთა ფსონი კაზინოსთან მუშავდება
    this.ended = new Map();         // car → { crash100, type }
    this.timers = [];
    this.state = null;              // რაუნდის საჯარო მდგომარეობა
    this.outbox = store.read('outbox.json', []);   // კაზინოსთვის გასაგზავნი მოგებები/დაბრუნებები (რიგი, ხელახალი ცდით)
    this.flushTimer = null; this.flushing = null;
    this.#refundPending();
    this.#flushSoon(0);
  }

  // ---------- გარე კაზინოს რიგი ----------
  // მოგება და დაბრუნება მოთამაშის ქმედებას არ ელოდება — ვაგზავნით რიგით, სანამ კაზინო არ დაადასტურებს.
  // ერთი და იგივე id ხელახლა იგზავნება, ამიტომ შუამავალი და კაზინო მას ორჯერ არ ატარებენ.

  #queue(token, tx) {
    const pl = this.players[token];
    this.outbox.push({ token, session: pl?.ext?.session, tx, tries: 0 });
    this.store.write('outbox.json', this.outbox);
    this.#flushSoon(0);
  }

  #flushSoon(ms) {
    if (!this.ext || !this.outbox.length || this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.#flush(); }, ms);
  }

  #flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.outbox.length) {
        const item = this.outbox[0], pl = this.players[item.token];
        if (!pl?.ext) { this.outbox.shift(); continue; }
        try {
          const r = await this.ext.tx(item.session || pl.ext.session, item.tx);
          pl.balance = r.balance;
          this.outbox.shift();
          this.#ledger({ type: 'ext_' + item.tx.kind, token: item.token, id: item.tx.id, amount: item.tx.amount, balance: pl.balance });
          this.emit('me_changed', { token: item.token, me: this.me(item.token) });
        } catch (e) {
          if (!uncertain(e)) {
            // კაზინომ საბოლოოდ უარყო (მაგ. დასაბრუნებელი ფსონი მასთან არ არსებობს) — ვწერთ და ვაგრძელებთ
            this.#ledger({ type: 'ext_rejected', token: item.token, tx: item.tx, code: e.code || null, error: e.message });
            this.outbox.shift();
          } else {
            item.tries++;
            this.store.write('outbox.json', this.outbox);
            this.flushing = null;
            this.#flushSoon(Math.min(30000, 500 * 2 ** Math.min(item.tries, 6)));
            return;
          }
        }
        this.store.write('outbox.json', this.outbox);
      }
      this.flushing = null;
    })();
    return this.flushing;
  }

  /** რიგის დაცლა (ტესტებისთვის და გაჩერებისას) */
  async drain() { clearTimeout(this.flushTimer); this.flushTimer = null; await this.#flush(); }

  #savePlayers() { this.store.writeSoon('players.json', () => this.players); }
  #ledger(e) { this.store.append('ledger.jsonl', e); }

  // სერვისი რაუნდის შუაში თუ გაჩერდა — ღია ფსონები ბრუნდება
  #refundPending() {
    const p = this.store.read('pending.json', null);
    if (!p) return;
    for (const b of p.bets) {
      const pl = this.players[b.token];
      if (!pl) continue;
      if (pl.ext) {
        if (b.txId) this.#queue(b.token, { id: `rb-${b.txId}`, kind: 'rollback', ref: b.txId, roundId: String(p.round), amount: b.amount });
        continue;
      }
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
        this.#newRound();
        this.#changed();
        break;
      case 'race_started':
        this.store.write('pending.json', { round: this.state.round, bets: [...this.bets.values()].map(b => ({ token: b.token, amount: b.amount, txId: b.txId || null })) });
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
    if (this.state && state.round !== this.state.round) { this.#clearTimers(); this.#newRound(); }
    this.state = state;
    state.cars.forEach((c, i) => { if (c.ended) this.ended.set(i, { crash100: c.crash100, type: c.type }); });
    for (const b of this.bets.values()) this.#settleIfEnded(b);
  }

  // წინა რაუნდის ფსონები ქრება; მათ მფლობელებს ვუგზავნით განახლებულ me-ს (bet: null),
  // რომ კლიენტს ძველი ფსონი არ დარჩეს
  #newRound() {
    const had = [...this.bets.keys()];
    this.bets.clear(); this.ended.clear();
    for (const token of had) if (this.players[token]) this.emit('me_changed', { token, me: this.me(token) });
  }

  #clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  dispose() { this.#clearTimers(); clearTimeout(this.flushTimer); this.flushTimer = null; this.store.flush(); }

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
    pl.balance += b.win;          // გარე მოთამაშისთვის — წინასწარი; ზუსტს კაზინოს პასუხი დააყენებს
    if (pl.ext) this.#queue(b.token, { id: `win-${b.txId}`, kind: 'win', roundId: String(b.round), amount: b.win });
    this.#ledger({ type: 'win', round: b.round, token: b.token, car: b.car, amount: b.amount, m100, win: b.win, balance: pl.balance });
    this.#savePlayers();
    this.emit('settled', { token: b.token, result: { state: 'won', car: b.car, m100, win: b.win, amount: b.amount }, me: this.me(b.token) });
    this.#changed();
  }

  #lose(b, e) {
    b.state = 'lost';
    const pl = this.players[b.token];
    if (pl?.ext?.zeroWin) this.#queue(b.token, { id: `win-${b.txId}`, kind: 'win', roundId: String(b.round), amount: 0 });
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

  join({ token, name, session } = {}) {
    if (session != null) return this.#joinExternal(session);
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

  /** კაზინოდან გაშვება: სესია შუამავლიდან, ბალანსი კაზინოდან. ერთი ჩანაწერი თითო (პლატფორმა, მოთამაშე, ვალუტა) */
  async #joinExternal(session) {
    if (!this.ext) throw new HttpError(400, 'კაზინოს ინტეგრაცია გამორთულია');
    if (typeof session !== 'string' || !/^[0-9a-f]{16,64}$/.test(session)) throw new HttpError(400, 'არასწორი სესია');
    let s;
    try { s = await this.ext.session(session); }
    catch (e) { throw e.status === 404 ? new HttpError(404, 'სესია ვერ მოიძებნა — გაუშვი თამაში თავიდან კაზინოდან') : extError(e); }
    const key = `${s.platform}:${s.playerId}:${s.currency}`;
    let token = Object.keys(this.players).find(t => this.players[t].ext?.key === key);
    if (!token) {
      token = randomBytes(16).toString('hex');
      this.players[token] = { name: cleanName(s.name) || cleanName(s.playerId) || 'მოთამაშე', balance: 0, createdAt: new Date().toISOString() };
      this.#ledger({ type: 'create_ext', token, platform: s.platform, player: s.playerId, currency: s.currency });
    }
    const pl = this.players[token];
    pl.ext = { key, session, platform: s.platform, currency: s.currency, lobbyUrl: s.lobbyUrl || null, zeroWin: !!s.closeRoundWithZeroWin };
    if (!pl.pid) pl.pid = randomBytes(4).toString('hex');
    try { pl.balance = (await this.ext.balance(session)).balance; } catch (e) { throw extError(e); }
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
    if (pl.ext) throw rule('ბალანსს კაზინო მართავს — შეავსე კაზინოს მხარეს');
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
    if (this.bets.has(token) || this.placing.has(token)) throw rule('ამ ეტაპზე ფსონი უკვე დადებული გაქვს');
    let txId = null;
    if (pl.ext) {
      // ფული კაზინოშია: ჯერ კაზინო ჩამოჭრის (BET), მერე ვიღებთ ფსონს
      txId = `bet-${acc.round}-${randomBytes(8).toString('hex')}`;
      const tx = { id: txId, kind: 'bet', roundId: String(acc.round), amount };
      this.placing.add(token);
      try { pl.balance = (await this.ext.tx(pl.ext.session, tx)).balance; }
      catch (e) {
        // პასუხი არ მივიღეთ — შეიძლება კაზინომ მაინც ჩამოჭრა; დაბრუნებას რიგში ვაყენებთ (თუ არ ჩამოუჭრია, კაზინო უარყოფს)
        if (uncertain(e)) this.#queue(token, { id: `rb-${txId}`, kind: 'rollback', ref: txId, roundId: String(acc.round), amount });
        throw extError(e);
      } finally { this.placing.delete(token); }
      if (!this.state || this.state.round !== acc.round || this.state.phase !== 'bet') {
        this.#queue(token, { id: `rb-${txId}`, kind: 'rollback', ref: txId, roundId: String(acc.round), amount });
        throw rule('ფსონების მიღება დასრულდა — თანხა დაგიბრუნდება');
      }
    } else {
      if (pl.balance < amount) throw rule('ბალანსი არ გყოფნის — შეამცირე ფსონი');
      pl.balance -= amount;
    }
    const bet = { token, pid: pl.pid, name: pl.name, round: acc.round, car, amount, auto: auto ?? null, state: 'open', m100: 0, win: 0, txId };
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
    if (pl.ext) {
      const tx = { id: `rb-${bet.txId}`, kind: 'rollback', ref: bet.txId, roundId: String(bet.round), amount: bet.amount };
      try { pl.balance = (await this.ext.tx(pl.ext.session, tx)).balance; }
      catch (e) { throw extError(e); }
      if (this.bets.get(token) !== bet) return this.me(token);
    } else pl.balance += bet.amount;
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
      currency: pl.ext ? pl.ext.currency : null, lobbyUrl: pl.ext?.lobbyUrl ?? null,
      bet: b ? { round: b.round, car: b.car, amount: b.amount, auto: b.auto, state: pubState(b), m100: b.m100, win: b.win } : null
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
