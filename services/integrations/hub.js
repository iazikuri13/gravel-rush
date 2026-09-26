// შუამავლის ბირთვი: პლატფორმისგან დამოუკიდებელი ლოგიკა.
//
//  - სესიები: პლატფორმა თამაშს უშვებს → ვქმნით ჩვენს სესიას (token) და ვუბრუნებთ თამაშის ბმულს
//  - ტრანზაქციები: თამაში ითხოვს bet / win / rollback-ს ჩვენს ენაზე (თანხა ცენტებში),
//    ბირთვი ინახავს ჟურნალს (იდემპოტენტურობა) და ადაპტერს გადასცემს პლატფორმის ფორმატში
//  - ფრიბეტები: პლატფორმის მიერ ნაჩუქარი ფრიბეტების შენახვა
//
// ყველაფერი, რაც კონკრეტულ პლატფორმას ეხება (ველების სახელები, ჰეში, შეცდომის კოდები),
// ადაპტერშია — იხ. adapters/README.md
import { randomBytes } from 'node:crypto';
import { HttpError } from '../lib/http.js';
import { GAMES, findGame } from './games.js';
import { ADAPTERS } from './adapters/index.js';
import { PlatformError } from './errors.js';

export { PlatformError };

export class Hub {
  constructor(store, { platforms = [], publicUrl = '' } = {}) {
    this.store = store;
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.sessions = store.read('sessions.json', {});
    this.txs = store.read('txs.json', {});          // ჩვენი tx id → { state, balance, platformTx }
    this.freebets = store.read('freebets.json', {});
    this.platforms = new Map();
    for (const cfg of platforms) this.addPlatform(cfg);
  }

  addPlatform(cfg) {
    const make = ADAPTERS[cfg.adapter];
    if (!make) throw new Error(`უცნობი ადაპტერი: ${cfg.adapter}`);
    if (!/^[a-z0-9-]+$/.test(cfg.id)) throw new Error(`პლატფორმის id მხოლოდ a-z, 0-9 და "-": ${cfg.id}`);
    this.platforms.set(cfg.id, { cfg, adapter: make(cfg, this) });
  }

  platform(id) {
    const p = this.platforms.get(id);
    if (!p) throw new HttpError(404, 'პლატფორმა ვერ მოიძებნა');
    return p;
  }

  // ---------- ადაპტერებისთვის ----------

  games() { return GAMES; }
  findGame(id) { return findGame(id); }
  url(path) { return this.publicUrl + path; }

  /** პლატფორმამ თამაში გაუშვა → ჩვენი სესია და თამაშის ბმული */
  createSession(platformId, s) {
    for (const k of ['playerId', 'currency', 'platformSessionId', 'gameId']) {
      if (!s[k]) throw new PlatformError('INTERNAL_ERROR', `აკლია ${k}`, 400);
    }
    const token = randomBytes(24).toString('hex');
    this.sessions[token] = {
      platform: platformId, playerId: String(s.playerId), currency: String(s.currency).toUpperCase(),
      platformSessionId: String(s.platformSessionId), gameId: String(s.gameId),
      device: s.device || null, locale: s.locale || null, lobbyUrl: s.lobbyUrl || null,
      name: s.name || null, createdAt: new Date().toISOString()
    };
    this.store.writeSoon('sessions.json', () => this.sessions, 200);
    return { token, url: this.url(`/?session=${token}`) };
  }

  addFreebet(platformId, fb) {
    const id = String(fb.id || randomBytes(16).toString('hex'));
    this.freebets[id] = { platform: platformId, ...fb, id, state: 'active', createdAt: new Date().toISOString() };
    this.store.writeSoon('freebets.json', () => this.freebets, 200);
    return this.freebets[id];
  }

  cancelFreebet(platformId, id) {
    const fb = this.freebets[id];
    if (!fb || fb.platform !== platformId) throw new PlatformError('TRANSACTION_NOT_FOUND', 'ფრიბეტი ვერ მოიძებნა', 404);
    fb.state = 'cancelled';
    this.store.writeSoon('freebets.json', () => this.freebets, 200);
    return fb;
  }

  // ---------- თამაშისთვის (შიდა API) ----------

  session(token) {
    const s = typeof token === 'string' && this.sessions[token];
    if (!s) throw new HttpError(404, 'სესია ვერ მოიძებნა', 'SESSION_NOT_FOUND');
    const { adapter } = this.platform(s.platform);
    return { token, ...s, closeRoundWithZeroWin: !!adapter.closeRoundWithZeroWin };
  }

  async balance(token) {
    const s = this.session(token);
    return { balance: await this.platform(s.platform).adapter.balance(s) };
  }

  /**
   * tx: { id, kind: 'bet'|'win'|'rollback', roundId, amount (ცენტები), ref? (rollback-ისთვის — bet-ის id), bonusId? }
   * ერთი და იგივე id მეორედ აღარ იგზავნება — ბრუნდება შენახული შედეგი.
   */
  async transact(token, tx) {
    const s = this.session(token);
    if (!tx || typeof tx.id !== 'string' || !tx.id) throw new HttpError(400, 'tx.id აუცილებელია');
    if (!['bet', 'win', 'rollback'].includes(tx.kind)) throw new HttpError(400, 'tx.kind: bet | win | rollback');
    if (!Number.isInteger(tx.amount) || tx.amount < 0) throw new HttpError(400, 'tx.amount — არაუარყოფითი მთელი (ცენტები)');
    if (tx.kind === 'rollback' && !tx.ref) throw new HttpError(400, 'rollback-ს სჭირდება ref');
    const key = `${s.platform}:${tx.id}`;
    const done = this.txs[key];
    if (done?.state === 'ok') return { balance: done.balance, platformTx: done.platformTx, repeated: true };
    const { adapter } = this.platform(s.platform);
    const r = await adapter.transact(s, { ...tx, roundId: String(tx.roundId ?? '') });
    this.txs[key] = { state: 'ok', kind: tx.kind, amount: tx.amount, balance: r.balance, platformTx: r.platformTx ?? null, at: new Date().toISOString() };
    this.store.append('journal.jsonl', { platform: s.platform, player: s.playerId, ...tx, balance: r.balance, platformTx: r.platformTx ?? null });
    this.store.writeSoon('txs.json', () => this.txs, 200);
    return { balance: r.balance, platformTx: r.platformTx ?? null };
  }
}
