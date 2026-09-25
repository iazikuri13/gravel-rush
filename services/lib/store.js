// JSON ფაილების საცავი (დემო). თითოეულ სერვისს საკუთარი საქაღალდე აქვს —
// სერვისები ერთმანეთის მონაცემებს პირდაპირ არასდროს კითხულობენ, მხოლოდ API-ით.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class JsonStore {
  constructor(dir) { this.dir = dir; mkdirSync(dir, { recursive: true }); this.timers = {}; }

  read(name, fallback) {
    const p = join(this.dir, name);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
  }

  write(name, data) {
    clearTimeout(this.timers[name]); delete this.timers[name];
    const p = join(this.dir, name);
    writeFileSync(p + '.tmp', JSON.stringify(data, null, 1));
    renameSync(p + '.tmp', p);
  }

  /** დაგვიანებული ჩაწერა (ხშირი ცვლილებებისთვის) */
  writeSoon(name, getData, ms = 1000) {
    if (!this.timers[name]) this.timers[name] = setTimeout(() => this.write(name, getData()), ms);
  }

  append(name, obj) {
    appendFileSync(join(this.dir, name), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
  }
}
