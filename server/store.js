// მარტივი ფაილური საცავი დემო რეჟიმისთვის (data/).
// პროდაქშენში ეს PostgreSQL-ით და ოპერატორის Wallet API-ით უნდა შეიცვალოს.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.meta = this.#read('meta.json', null);
    this.players = this.#read('players.json', {});
    this.pending = this.#read('pending.json', null);
    this.saveTimer = null;
  }

  #read(name, fallback) {
    const p = join(this.dir, name);
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, 'utf8'));
  }

  #write(name, data) {
    const p = join(this.dir, name);
    writeFileSync(p + '.tmp', JSON.stringify(data, null, 1));
    renameSync(p + '.tmp', p);
  }

  saveMeta() { this.#write('meta.json', this.meta); }
  savePending() { this.#write('pending.json', this.pending); }
  savePlayersNow() { clearTimeout(this.saveTimer); this.saveTimer = null; this.#write('players.json', this.players); }
  savePlayers() { if (!this.saveTimer) this.saveTimer = setTimeout(() => this.savePlayersNow(), 1000); }

  /** აუდიტის ჟურნალი: ყოველი ფულადი მოძრაობა ცალკე ხაზად */
  ledger(entry) {
    appendFileSync(join(this.dir, 'ledger.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }
}
