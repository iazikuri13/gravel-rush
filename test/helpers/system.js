// კონტრაქტული ტესტების ინფრასტრუქტურა.
// სისტემა ეშვება ცალკე პროცესად და მოწმდება მხოლოდ გარედან — ისე, როგორც ბრაუზერი ხედავს
// (WebSocket + HTTP). ამიტომ ეს ტესტები არ იცვლება, როცა სისტემას შიგნით სერვისებად ვშლით.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { buildChain, roundResults } from '../../services/round/fair.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENTRY = process.env.GR_ENTRY || join(ROOT, 'server', 'index.js');
export const TEST_SECRET = 'contract-test-secret-0001';
export const CLIENT_SEED = 'contract-client-seed';
export const CHAIN_LENGTH = 500;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// GR_MODE=separate — სამი სერვისი სამ ცალკე პროცესად (services/*/main.js);
// ნაგულისხმევად — გამშვები server/index.js (სამი სერვისი ერთ პროცესში).
export const MODE = process.env.GR_MODE || 'launcher';

function spawnProc(entry, env, pattern) {
  const child = spawn(process.execPath, [entry], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const match = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(entry + ' ვერ გაეშვა:\n' + out)), 20000);
    child.stdout.on('data', d => { out += d; const m = out.match(pattern); if (m) { clearTimeout(to); resolve(m); } });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => { clearTimeout(to); reject(new Error(`${entry} დასრულდა (${code}):\n${out}`)); });
  });
  return { child, match, output: () => out };
}

export async function startSystem({ betMs = 700, endMs = 250, speed = 20, dataDir } = {}) {
  dataDir ||= mkdtempSync(join(tmpdir(), 'gr-test-'));
  const game = { CHAIN_SECRET: TEST_SECRET, CLIENT_SEED, CHAIN_LENGTH: String(CHAIN_LENGTH), BET_MS: String(betMs), END_MS: String(endMs), SPEED: String(speed) };
  const procs = [];
  let port;
  if (MODE === 'separate') {
    const INTERNAL_KEY = 'separate-mode-key-' + Math.random().toString(36).slice(2);
    const svc = n => join(ROOT, 'services', n, 'main.js');
    const r = spawnProc(svc('round'), { ...game, INTERNAL_KEY, ROUND_PORT: '0', DATA_DIR: join(dataDir, 'round') }, /round-service → (\S+)/);
    procs.push(r);
    const roundUrl = (await r.match)[1];
    const b = spawnProc(svc('bets'), { INTERNAL_KEY, ROUND_URL: roundUrl, BETS_PORT: '0', DATA_DIR: join(dataDir, 'bets') }, /bets-service → (\S+)/);
    procs.push(b);
    const betsUrl = (await b.match)[1];
    const g = spawnProc(svc('gateway'), { INTERNAL_KEY, ROUND_URL: roundUrl, BETS_URL: betsUrl, PORT: '0' }, /Gravel Rush → http:\/\/localhost:(\d+)/);
    procs.push(g);
    port = Number((await g.match)[1]);
  } else {
    const p = spawnProc(ENTRY, { ...game, PORT: '0', DATA_DIR: dataDir }, /Gravel Rush → http:\/\/localhost:(\d+)/);
    procs.push(p);
    port = Number((await p.match)[1]);
  }
  const chain = buildChain(TEST_SECRET, CHAIN_LENGTH);
  const clients = new Set();
  return {
    port, dataDir, chain, betMs, endMs, speed,
    url: `http://localhost:${port}`,
    wsUrl: `ws://localhost:${port}`,
    expected: round => roundResults(chain[round], CLIENT_SEED),
    ledger() {
      const p = [join(dataDir, 'bets', 'ledger.jsonl'), join(dataDir, 'ledger.jsonl')].find(existsSync) || '';
      return p ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    },
    async connect(opts) { const c = await Client.connect(this, opts); clients.add(c); return c; },
    output: () => procs.map(p => p.output()).join('\n'),
    /** მყისიერი გათიშვა (ავარიის იმიტაცია) */
    async stop({ keepData = false } = {}) {
      for (const c of clients) c.close();
      for (const { child } of procs.reverse()) if (child.exitCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
      if (!keepData) rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

export class Client {
  static seq = 0;
  static async connect(sys, { token, name, origin } = {}) {
    const ws = new WebSocket(sys.wsUrl, origin ? { origin } : {});
    const c = new Client(ws, sys);
    await once(ws, 'open');
    c.send({ t: 'hello', token, name });
    c.welcome = await c.waitFor(m => m.t === 'welcome');
    await c.waitFor(m => m.t === 'snap');
    await c.waitFor(m => m.t === 'me');
    return c;
  }

  constructor(ws, sys) {
    this.ws = ws; this.sys = sys; this.log = []; this.waiters = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      this.log.push(m);
      for (const w of [...this.waiters]) if (w.from <= this.log.length - 1 && w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
    });
  }

  send(m) { this.ws.send(JSON.stringify(m)); }
  close() { try { this.ws.close(); } catch {} }
  mark() { return this.log.length; }
  get token() { return this.welcome.token; }
  snaps(from = 0) { return this.log.slice(from).filter(m => m.t === 'snap'); }
  lastSnap() { return this.snaps().at(-1); }
  lastMe() { return this.log.filter(m => m.t === 'me').at(-1); }

  /** პირველი შეტყობინება from-იდან, რომელიც pred-ს აკმაყოფილებს */
  waitFor(pred, { from = 0, timeout = 15000 } = {}) {
    const hit = this.log.slice(from).find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, from, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) { this.waiters.splice(i, 1); reject(new Error('შეტყობინებას ვერ დაველოდე: ' + pred.toString())); }
      }, timeout);
    });
  }

  /** ბრძანება → პასუხი ('me' წარმატებისას, 'err' შეცდომისას) */
  async request(msg) {
    const id = 'r' + (++Client.seq);
    const from = this.mark();
    this.send({ ...msg, id });
    return this.waitFor(m => (m.t === 'me' || m.t === 'err') && m.re === id, { from });
  }

  /** მიმდინარე ფსონების ფაზა, თუ დრო საკმარისია; თორემ შემდეგი */
  async betPhase(minLeftMs = 500) {
    const s = this.lastSnap();
    if (s.phase === 'bet' && this.sys.betMs - (Date.now() - s.phaseStart) > minLeftMs) return s;
    return this.freshBetPhase();
  }

  /** ახალი რაუნდის ფსონების ფაზის დასაწყისი (დრო საკმარისია ფსონისთვის) */
  async freshBetPhase() {
    const cur = this.lastSnap();
    const from = this.mark();
    const snap = await this.waitFor(m => m.t === 'snap' && m.phase === 'bet' && m.round !== cur.round, { from });
    return snap;
  }

  async raceStart(round) {
    return this.waitFor(m => m.t === 'snap' && m.round === round && m.phase === 'race');
  }

  async roundEnd(round) {
    return this.waitFor(m => m.t === 'snap' && m.round === round && m.phase === 'end');
  }
}
