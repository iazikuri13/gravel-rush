// Gravel Rush — კლიენტი. შედეგებს არ ითვლის: სერვერისგან იღებს მდგომარეობას და ხატავს.
import { G, CARS as N_CARS } from './shared/math.js';
import { sha256, resultsFromSeed, verifyChain } from './shared/verify.js';

const $ = s => document.querySelector(s);
const CARS = [
  { name: 'ფალკონი', num: '07', color: '#ef5a3c', dark: '#a3321c' },
  { name: 'ტალღა',   num: '21', color: '#3d8bff', dark: '#1f55b3' },
  { name: 'კრაზანა', num: '44', color: '#f4c430', dark: '#a8820c' }
];
const LEADS = [0, 16, -12];
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = cents => (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const x100 = m100 => (m100 / 100).toFixed(2);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

const S = {
  phase: 'connecting', round: 0, roundHash: '', phaseStart: 0, raceStart: 0,
  cars: [], bets: [], me: null, sel: 0, history: [], online: 0,
  rules: { betMs: 7000, endMs: 4000 }, commit: '', clientSeed: '',
  cam: 0, camV: 0, shake: 0
};
const parts = [], rocks = [];
let feedDirty = true, lastFeed = 0, shakeY = 0;

/* ---------- დროის სინქრონიზაცია ---------- */
let offset = 0, bestRtt = Infinity;
const serverNow = () => Date.now() + offset;
function sampleOffset(serverTs, rtt) {
  if (rtt <= bestRtt * 1.5 || rtt < 40) { bestRtt = Math.min(bestRtt, rtt); offset = serverTs + rtt / 2 - Date.now(); }
}

/* ---------- WebSocket ---------- */
let ws = null, retry = 800, pingTimer = null;
const pings = new Map();
function connect() {
  setConn('connecting', 'კავშირი…');
  // სხვა დომენზე განთავსებული ფრონტენდისთვის (მაგ. Lovable): window.GR_SERVER = 'wss://….onrender.com'
  ws = new WebSocket(window.GR_SERVER || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    retry = 800;
    setConn('open', 'ონლაინ');
    send({ t: 'hello', token: store.get('gr_token'), name: store.get('gr_name') });
    clearInterval(pingTimer);
    const ping = () => { const id = Math.random(); pings.set(id, Date.now()); send({ t: 'ping', id }); };
    ping(); pingTimer = setInterval(ping, 5000);
  };
  ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    clearInterval(pingTimer);
    setConn('closed', 'კავშირი გაწყდა — ხელახლა ვცდილობ…');
    S.phase = 'connecting'; updateAction(true);
    setTimeout(connect, retry); retry = Math.min(retry * 1.7, 6000);
  };
}
const send = msg => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
function setConn(state, text) { $('#conn').dataset.state = state; $('#connText').textContent = text; }

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      store.set('gr_token', m.token);
      S.rules = m.rules; S.commit = m.commit; S.clientSeed = m.clientSeed;
      $('#fCommit').textContent = m.commit; $('#fClient').textContent = m.clientSeed;
      break;
    case 'pong': {
      const sent = pings.get(m.id); pings.delete(m.id);
      if (sent) sampleOffset(m.now, Date.now() - sent);
      break;
    }
    case 'snap': applySnap(m); break;
    case 'me':
      S.me = m;
      if (document.activeElement !== $('#nick')) $('#nick').value = m.name;
      store.set('gr_name', m.name);
      updateBal(); feedDirty = true; renderCards(); updateAction(true);
      break;
    case 'result':
      if (m.state === 'won') toast(`ქეშაუთი ×${x100(m.m100)} · +${fmt(m.win)}`, 'win');
      else toast(`${CARS[m.car].name} ${m.type === 'crash' ? 'დაეჯახა' : 'გაჩერდა'} ×${x100(m.crash100)}-ზე — ფსონი დაიწვა`, 'loss');
      break;
    case 'history': S.history = m.items; renderHistory(); break;
    case 'err': toast(m.msg, 'loss'); break;
  }
}

function applySnap(s) {
  if (bestRtt === Infinity) offset = s.now - Date.now();
  if (s.round !== S.round || !S.cars.length) resetRound(s.round);
  S.phase = s.phase; S.phaseStart = s.phaseStart; S.raceStart = s.raceStart;
  S.roundHash = s.roundHash; S.online = s.online; S.bets = s.bets;
  $('#fRoundHash').textContent = s.roundHash || '—';
  $('#online').textContent = String(s.online);
  s.cars.forEach((sc, i) => { const c = S.cars[i]; if (sc.ended && !c.ended) endCarLocal(c, sc); });
  feedDirty = true; renderCards(); updateAction(true);
}

function resetRound(round) {
  S.round = round; S.cam = 0; S.camV = 0;
  parts.length = 0; rocks.length = 0;
  S.cars = CARS.map((_, i) => ({ i, ended: false, crash100: 0, type: '', d: 0, v: 0, spin: 0, spinV: 0, drift: 0, driftTo: 0, rock: null, em: 0, sm: 0 }));
}

/* ---------- გეომეტრია ---------- */
const cv = $('#cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, Sc = 1, roadW = 0, laneGap = 0, amp = 0, baseY = 0, L = 0, CW = 0;
function resize() {
  const r = $('#stage').getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Sc = Math.max(.7, Math.min(1.25, W / 620));
  roadW = Math.max(220, Math.min(W * .6, 380));
  laneGap = roadW * .29; amp = Math.min(W * .09, 70);
  baseY = H * .72; L = 46 * Sc; CW = 23 * Sc;
}
const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const cx = d => W / 2 + amp * Math.sin(d * .0021) + amp * .6 * Math.sin(d * .0057 + 1.3);
const sy = d => baseY - (d - S.cam) + shakeY;
const laneX = (i, d) => cx(d) + (i - 1) * laneGap;
const slope = d => (cx(d + 2) - cx(d - 2)) / 4;
const raceT = () => Math.max(0, (serverNow() - S.raceStart) / 1000);
const visD = (c, now) => c.d + LEADS[c.i] * Sc + (!c.ended && S.phase === 'race' ? Math.sin(now / 1000 * 1.7 + c.i * 2.1) * 6 * Sc : 0);
const carX = (c, d) => laneX(c.i, d) + c.drift;

function currentMult() {
  if (S.phase === 'race' && S.cars.some(c => !c.ended)) return Math.exp(G * raceT());
  const ended = S.cars.filter(c => c.ended).map(c => c.crash100);
  return ended.length ? Math.max(...ended) / 100 : 1;
}

/* ---------- ფიზიკა და ნაწილაკები ---------- */
function P(o) { if (parts.length < 520) parts.push(Object.assign({ vx: 0, vd: 0, dr: 2, r: 3, g: 0, a: .5, k: 'dust', rot: 0, vr: 0 }, o, { max: o.life })); }
function endCarLocal(c, sc) {
  c.ended = true; c.crash100 = sc.crash100; c.type = sc.type;
  const now = performance.now(), vd = visD(c, now);
  if (c.type === 'crash') {
    c.spinV = (Math.random() < .5 ? -1 : 1) * (2.5 + Math.random() * 1.5);
    const rd = vd + L * .55 + c.v * .1;
    c.rock = { d: rd, x: laneX(c.i, rd), kind: Math.random() < .55 ? 'rock' : 'log', seed: Math.random() * 100 };
    rocks.push(c.rock);
    burst(c, vd);
    S.shake = Math.max(S.shake, S.me?.bet?.car === c.i ? 12 : 5);
  } else {
    c.driftTo = (c.i === 0 ? -1 : c.i === 2 ? 1 : (Math.random() < .5 ? -1 : 1)) * laneGap * .42;
  }
}
function burst(c, vd) {
  const x = carX(c, vd), fd = vd + L * .45, n = REDUCE ? 8 : 20;
  for (let k = 0; k < n; k++) P({ k: 'debris', x, d: fd, vx: (Math.random() - .5) * 280 * Sc, vd: c.v * .5 + (Math.random() - .2) * 200 * Sc, dr: 3.2, r: (2 + Math.random() * 3) * Sc, life: .7 + Math.random() * .5, a: 1, col: [CARS[c.i].color, '#1c1c1c', '#e8e8e8'][k % 3], vr: (Math.random() - .5) * 18 });
  for (let k = 0; k < n; k++) P({ k: 'dust', x: x + (Math.random() - .5) * CW * 2, d: fd, vx: (Math.random() - .5) * 90 * Sc, vd: (Math.random() - .3) * 90 * Sc, dr: 2, r: (6 + Math.random() * 7) * Sc, g: 30 * Sc, life: 1.2 + Math.random() * .6, a: .6 });
}
function physics(dt, now) {
  const racing = S.phase === 'race' || S.phase === 'end';
  const t = raceT();
  // სიჩქარე ~ 190 + 120·ln(m),  ln(m) = G·t
  const base = S.phase === 'race' ? Sc * (190 + 120 * G * t) * Math.min(1, .2 + t * .9) : 0;
  let anyAlive = false;
  for (const c of S.cars) {
    if (!racing) { c.d = 0; c.v = 0; continue; }
    if (!c.ended) { c.v = base; anyAlive = anyAlive || base > 0; }
    else if (c.type === 'crash') { c.v *= Math.exp(-dt * 7); c.spin += c.spinV * dt; c.spinV *= Math.exp(-dt * 2.5); }
    else { c.v *= Math.exp(-dt * 1.4); c.drift += (c.driftTo - c.drift) * Math.min(1, dt * 1.5); }
    c.d += c.v * dt;
    if (c.rock) c.d = Math.min(c.d, c.rock.d - L * .58 - LEADS[c.i] * Sc);
    const vd = visD(c, now), x = carX(c, vd);
    if (c.v > 15 * Sc) {
      c.em += c.v * dt * .11 * (REDUCE ? .35 : 1);
      while (c.em >= 1) { c.em--; P({ x: x + (Math.random() - .5) * CW * .9, d: vd - L / 2, vx: (Math.random() - .5) * 30 * Sc, vd: c.v * .35, dr: 2.5, r: (3 + Math.random() * 4) * Sc, g: 14 * Sc, life: .9 + Math.random() * .6, a: .42 }); }
    }
    if (c.ended && sy(vd) < H + 60) {
      c.sm += dt * (c.type === 'stall' ? 16 : 7) * (REDUCE ? .4 : 1);
      while (c.sm >= 1) { c.sm--; P({ k: 'smoke', x: x + (Math.random() - .5) * 6 * Sc, d: vd + L * .32, vx: (Math.random() - .5) * 16 * Sc, vd: c.v * .5 + 18 * Sc, dr: 1, r: 4 * Sc, g: 16 * Sc, life: 1.4, a: c.type === 'stall' ? .5 : .35 }); }
    }
  }
  if (anyAlive) S.camV = base; else S.camV *= Math.exp(-dt * 1.3);
  S.cam += S.camV * dt;
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k]; p.life -= dt;
    if (p.life <= 0) { parts.splice(k, 1); continue; }
    const f = Math.exp(-dt * p.dr);
    p.x += p.vx * dt; p.d += p.vd * dt; p.vx *= f; p.vd *= f; p.r += p.g * dt; p.rot += p.vr * dt;
  }
  S.shake *= Math.exp(-dt * 6);
}

/* ---------- ხატვა ---------- */
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
function roadPoly(d0, d1, hw, col) {
  ctx.beginPath();
  for (let d = d0; d <= d1; d += 10) ctx.lineTo(cx(d) - hw, sy(d));
  for (let d = d1; d >= d0; d -= 10) ctx.lineTo(cx(d) + hw, sy(d));
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}
function pill(text, x, y, bg, fg) {
  ctx.font = `800 ${11 * Sc}px "Noto Sans Georgian", sans-serif`;
  const tw = ctx.measureText(text).width, pw = tw + 14 * Sc, ph = 19 * Sc;
  ctx.fillStyle = bg; rr(x - pw / 2, y - ph / 2, pw, ph, ph / 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 4 * Sc, y + ph / 2 - .5); ctx.lineTo(x + 4 * Sc, y + ph / 2 - .5); ctx.lineTo(x, y + ph / 2 + 5 * Sc); ctx.closePath(); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + .5);
}
function drawCar(x, y, a, c) {
  const l = L, w = CW;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; rr(-w / 2 + 3 * Sc, -l / 2 + 4 * Sc, w, l, 6 * Sc); ctx.fill();
  ctx.fillStyle = '#0d0d0d';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctx.fillRect(sx * w / 2 - 2.5 * Sc, sz * l * .3 - 5 * Sc, 5 * Sc, 10 * Sc);
  ctx.fillStyle = c.color; rr(-w / 2, -l / 2, w, l, 6 * Sc); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-w * .09, -l / 2 + 2 * Sc, w * .18, l - 4 * Sc);
  ctx.fillStyle = '#1a2330';
  ctx.beginPath(); ctx.moveTo(-w * .38, -l * .18); ctx.lineTo(w * .38, -l * .18); ctx.lineTo(w * .3, -l * .3); ctx.lineTo(-w * .3, -l * .3); ctx.closePath(); ctx.fill();
  ctx.fillRect(-w * .3, l * .18, w * .6, l * .09);
  ctx.fillStyle = c.dark; rr(-w * .38, -l * .18, w * .76, l * .36, 3 * Sc); ctx.fill();
  ctx.fillStyle = '#fff'; circ(0, 0, w * .27);
  ctx.fillStyle = '#111'; ctx.font = `800 ${9 * Sc}px "Saira Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.num, 0, .6 * Sc);
  ctx.fillStyle = '#fffbe0'; for (let k = -1.5; k <= 1.5; k++) circ(k * w * .19, -l * .43, 1.7 * Sc);
  ctx.fillStyle = '#161616'; ctx.fillRect(-w * .55, l / 2 - 4 * Sc, w * 1.1, 3.5 * Sc);
  ctx.restore();
}
function drawRock(r) {
  const y = sy(r.d); if (y < -40 || y > H + 40) return;
  ctx.save(); ctx.translate(r.x, y);
  if (r.kind === 'rock') {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(3 * Sc, 4 * Sc, 15 * Sc, 11 * Sc, 0, 0, 6.2832); ctx.fill();
    for (const [s, col, o] of [[1, '#817b6b', 0], [.6, '#a59f8d', -3]]) {
      ctx.beginPath();
      for (let k = 0; k < 8; k++) { const an = k / 8 * 6.2832, rad = 14 * Sc * s * (.8 + rnd(r.seed + k) * .35); ctx.lineTo(Math.cos(an) * rad + o * Sc, Math.sin(an) * rad * .8 + o * Sc); }
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    }
  } else {
    ctx.rotate(.22);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(-19 * Sc, -2 * Sc, 42 * Sc, 11 * Sc, 5 * Sc); ctx.fill();
    ctx.fillStyle = '#5a3a20'; rr(-21 * Sc, -5.5 * Sc, 42 * Sc, 11 * Sc, 5 * Sc); ctx.fill();
    ctx.fillStyle = '#c89a62'; circ(-19 * Sc, 0, 5 * Sc); circ(19 * Sc, 0, 5 * Sc);
    ctx.fillStyle = '#8d6238'; circ(-19 * Sc, 0, 2 * Sc); circ(19 * Sc, 0, 2 * Sc);
  }
  ctx.restore();
}
function drawParts(top) {
  for (const p of parts) {
    if ((p.k === 'smoke') !== top) continue;
    const y = sy(p.d); if (y < -30 || y > H + 30) continue;
    const al = Math.max(0, p.life / p.max) * p.a;
    if (p.k === 'debris') {
      ctx.save(); ctx.translate(p.x, y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, al * 1.5);
      ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
    } else {
      ctx.fillStyle = p.k === 'smoke' ? `rgba(128,126,120,${al})` : `rgba(214,188,140,${al})`;
      circ(p.x, y, p.r);
    }
  }
  ctx.globalAlpha = 1;
}
const CROWD = ['#d64545', '#3b6fd1', '#ece6d4', '#2e8b57', '#e0a030', '#222'];
function drawSide(d0, d1) {
  const cs = 90;
  for (let s = Math.floor(d0 / cs); s <= Math.ceil(d1 / cs); s++) {
    const r = rnd(s * 41.3);
    if (r > .32) continue;
    const side = r < .16 ? -1 : 1, d = s * cs, n = 3 + Math.floor(rnd(s * 2.2) * 5);
    const bx = cx(d) + side * (roadW / 2 + 24 * Sc);
    for (let j = 0; j < n; j++) {
      const px = bx + side * rnd(s + j * 1.7) * 16 * Sc, py = sy(d) + (j - n / 2) * 9 * Sc;
      ctx.fillStyle = CROWD[Math.floor(rnd(s * 3 + j) * CROWD.length)];
      ctx.beginPath(); ctx.ellipse(px, py, 4.5 * Sc, 3 * Sc, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = rnd(s + j * 9) < .5 ? '#3a2a1c' : '#e3c29a'; circ(px, py, 2.2 * Sc);
    }
  }
  const ts = 64;
  for (let s = Math.floor(d0 / ts) - 1; s <= Math.ceil(d1 / ts) + 1; s++) {
    for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
      if (k === 1 && rnd(s * 31.7 + side * 9.1) < .4) continue;
      const d = s * ts + rnd(s * 7.7 + side * 3 + k * 5.5) * ts;
      const dist = 30 * Sc + rnd(s * 3.1 + side + k * 8.8) * W * .5;
      const x = cx(d) + side * (roadW / 2 + dist), rad = (12 + rnd(s * 1.9 + k + side * 2) * 16) * Sc;
      if (x < -40 || x > W + 40) continue;
      const y = sy(d);
      ctx.fillStyle = 'rgba(0,0,0,.28)'; circ(x + rad * .35, y + rad * .4, rad);
      ctx.fillStyle = '#18261a'; circ(x, y, rad);
      ctx.fillStyle = '#24391f'; circ(x - rad * .15, y - rad * .15, rad * .72);
      ctx.fillStyle = '#35512a'; circ(x - rad * .3, y - rad * .3, rad * .36);
    }
  }
}
function draw(now) {
  const sh = REDUCE ? 0 : S.shake;
  shakeY = (Math.random() - .5) * sh;
  ctx.save(); ctx.translate((Math.random() - .5) * sh, 0);
  const d1 = S.cam + baseY + 80, d0 = S.cam - (H - baseY) - 80;
  ctx.fillStyle = '#27351f'; ctx.fillRect(-30, -30, W + 60, H + 60);
  const gs = 34;
  for (let s = Math.floor(d0 / gs); s <= Math.ceil(d1 / gs); s++) for (let k = 0; k < 5; k++) {
    const a = rnd(s * 17.1 + k * 3.7), b = rnd(s * 5.3 + k * 11.9), c = rnd(s * 2.9 + k * 7.7);
    ctx.fillStyle = c < .5 ? 'rgba(66,88,46,.5)' : 'rgba(16,26,13,.38)';
    ctx.beginPath(); ctx.ellipse(a * W, sy(s * gs + b * gs), (6 + c * 16) * Sc, (3 + c * 6) * Sc, 0, 0, 6.2832); ctx.fill();
  }
  roadPoly(d0, d1, roadW / 2 + 10 * Sc, '#6b5233');
  roadPoly(d0, d1, roadW / 2, '#b08a59');
  roadPoly(d0, d1, roadW * .1, 'rgba(214,183,134,.16)');
  ctx.lineWidth = 5 * Sc; ctx.strokeStyle = 'rgba(92,64,34,.28)'; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) for (const o of [-.32, .32]) {
    ctx.beginPath(); for (let d = d0; d <= d1; d += 14) ctx.lineTo(laneX(i, d) + o * CW * 1.4, sy(d)); ctx.stroke();
  }
  const ss = 16;
  for (let s = Math.floor(d0 / ss); s <= Math.ceil(d1 / ss); s++) for (let k = 0; k < 7; k++) {
    const a = rnd(s * 9.7 + k * 1.3), b = rnd(s * 3.3 + k * 5.1), d = s * ss + b * ss;
    ctx.fillStyle = k % 2 ? 'rgba(232,208,164,.55)' : 'rgba(96,70,40,.45)';
    ctx.fillRect(cx(d) + (a - .5) * roadW * .96, sy(d), 2.2 * Sc, 2.2 * Sc);
  }
  const ps = 150;
  for (let s = Math.floor(d0 / ps); s <= Math.ceil(d1 / ps); s++) {
    const d = s * ps, y = sy(d);
    for (const side of [-1, 1]) { const x = cx(d) + side * (roadW / 2 + 5 * Sc); ctx.fillStyle = '#f3efe6'; circ(x, y, 3 * Sc); ctx.fillStyle = '#d8422e'; circ(x, y, 1.6 * Sc); }
  }
  const sl = 52 * Sc;
  if (sl > d0 && sl < d1) {
    const y = sy(sl), q = 7 * Sc, x0 = cx(sl) - roadW / 2, n = Math.ceil(roadW / q);
    for (let j = 0; j < n; j++) for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (j + r) % 2 ? '#f5f1e6' : '#1b1b1b';
      ctx.fillRect(x0 + j * q, y + (r - 1) * q, Math.min(q, roadW - j * q), q);
    }
  }
  for (const r of rocks) drawRock(r);
  drawParts(false);
  const myBet = S.me?.bet;
  const mine = myBet ? myBet.car : (S.phase === 'bet' ? S.sel : -1);
  const pos = S.cars.map(c => {
    const d = visD(c, now);
    return { c, d, x: carX(c, d), y: sy(d) + (S.phase === 'bet' ? Math.sin(now / 25 + c.i) * .5 : 0) };
  });
  for (const p of pos) {
    if (p.y < -80 || p.y > H + 80) continue;
    if (p.c.i === mine && !p.c.ended) { ctx.fillStyle = CARS[p.c.i].color + '40'; ctx.beginPath(); ctx.ellipse(p.x, p.y, CW * 1.1, L * .75, Math.atan(slope(p.d)), 0, 6.2832); ctx.fill(); }
    drawCar(p.x, p.y, Math.atan(slope(p.d)) + p.c.spin, CARS[p.c.i]);
  }
  drawParts(true);
  drawSide(d0, d1);
  for (const p of pos) {
    if (p.y < -40 || p.y > H + 40) continue;
    const ly = p.y - L * .5 - 16 * Sc, c = p.c;
    if (c.ended) pill(`${c.type === 'crash' ? 'დაეჯახა' : 'გაჩერდა'} ×${x100(c.crash100)}`, p.x, ly, c.type === 'crash' ? '#ff6a55' : '#d2ad73', '#1a0f08');
    else if (myBet && myBet.car === c.i && myBet.state === 'won') pill(`+${fmt(myBet.win)}`, p.x, ly, '#4fd67a', '#062010');
    else if (c.i === mine) pill(myBet ? 'შენ' : 'არჩეული', p.x, ly, 'rgba(12,18,14,.85)', '#fff8ea');
  }
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,176,96,.12)'); g.addColorStop(.45, 'rgba(255,176,96,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H * .55, Math.min(W, H) * .35, W / 2, H * .55, Math.max(W, H) * .8);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

/* ---------- UI ---------- */
const multEl = $('#mult'), phaseEl = $('#phase'), barEl = $('#bar'), barFill = $('#barFill'), actBtn = $('#action');
const setT = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const setC = (el, c) => { if (el.className !== c) el.className = c; };
function hud(now) {
  if (S.phase === 'bet') {
    const rem = Math.max(0, (S.rules.betMs - (serverNow() - S.phaseStart)) / 1000);
    setT(multEl, rem.toFixed(1)); setC(multEl, 'mult count');
    setT(phaseEl, `SS ${S.round} · ფსონების მიღება · სტარტამდე`);
    barEl.hidden = false; barFill.style.transform = `scaleX(${Math.min(1, rem * 1000 / S.rules.betMs)})`;
  } else if (S.phase === 'race') {
    const m = currentMult();
    setT(multEl, m.toFixed(2) + '×');
    setC(multEl, 'mult' + (m >= 10 ? ' hot3' : m >= 3 ? ' hot2' : m >= 1.5 ? ' hot1' : ''));
    setT(phaseEl, `SS ${S.round} · გზაზე ${S.cars.filter(c => !c.ended).length} / 3`);
    barEl.hidden = true;
  } else if (S.phase === 'end') {
    setT(multEl, currentMult().toFixed(2) + '×'); setC(multEl, 'mult ended');
    setT(phaseEl, `SS ${S.round} · ფინიში — შემდეგი ეტაპი მალე`);
    barEl.hidden = true;
  } else {
    setT(multEl, '—'); setC(multEl, 'mult count');
    setT(phaseEl, S.phase === 'halted' ? 'თამაში შეჩერებულია' : 'სერვერთან დაკავშირება…');
    barEl.hidden = true;
  }
  updateAction(false);
  if (feedDirty && now - lastFeed > 150) { lastFeed = now; feedDirty = false; renderFeed(); renderCards(); }
}
let actKey = '';
const readAmt = () => { const v = parseFloat($('#amt').value); return isFinite(v) ? Math.max(0, v) : 0; };
function updateAction(force) {
  let cls, main, sub, dis = false;
  const b = S.me?.bet;
  if (!S.me || S.phase === 'connecting' || S.phase === 'halted') {
    cls = 'wait'; dis = true; main = S.phase === 'halted' ? 'თამაში შეჩერებულია' : 'კავშირი…'; sub = '';
  } else if (S.phase === 'bet') {
    const rem = Math.ceil(Math.max(0, S.rules.betMs - (serverNow() - S.phaseStart)) / 1000);
    if (!b) { cls = 'bet'; main = `ფსონი ${fmt(Math.round(readAmt() * 100))}`; sub = `${CARS[S.sel].name} #${CARS[S.sel].num} · სტარტამდე ${rem} წმ`; }
    else { cls = 'cancel'; main = 'ფსონის გაუქმება'; sub = `${fmt(b.amount)} → ${CARS[b.car].name}${b.auto ? ` · ავტო ×${x100(b.auto)}` : ''}`; }
  } else if (S.phase === 'race') {
    if (b && b.state === 'open') { const m = currentMult(); cls = 'cash'; main = `ქეშაუთი ${fmt(Math.floor(b.amount * Math.floor(m * 100) / 100))}`; sub = `×${m.toFixed(2)} · ${CARS[b.car].name}`; }
    else if (b && b.state === 'won') { cls = 'won'; dis = true; main = `+${fmt(b.win)}`; sub = `აიღე ×${x100(b.m100)}-ზე`; }
    else if (b) { cls = 'lost'; dis = true; main = 'ფსონი დაიწვა'; sub = `${CARS[b.car].name} ${S.cars[b.car].type === 'crash' ? 'დაეჯახა' : 'გაჩერდა'}`; }
    else { cls = 'wait'; dis = true; main = 'ეტაპი მიმდინარეობს'; sub = 'ფსონს შემდეგ ეტაპზე დადებ'; }
  } else {
    cls = 'wait'; dis = true; main = 'შემდეგი ეტაპი მზადდება…';
    sub = b ? (b.state === 'won' ? `ამ ეტაპზე მოგება +${fmt(b.win)}` : 'ამჯერად არ გაგიმართლა') : 'აირჩიე მანქანა ქვემოთ';
  }
  const key = cls + main + sub;
  if (!force && key === actKey) return;
  actKey = key;
  actBtn.className = cls; actBtn.disabled = dis;
  actBtn.firstChild.textContent = main; actBtn.lastChild.textContent = sub;
}
function act() {
  const b = S.me?.bet;
  if (S.phase === 'bet') {
    if (b) return send({ t: 'cancel' });
    const amount = Math.round(readAmt() * 100);
    let auto = null;
    if ($('#autoOn').checked) {
      auto = Math.round(parseFloat($('#autoVal').value) * 100);
      if (!(auto >= 101)) return toast('ავტო-ქეშაუთი მინიმუმ ×1.01 უნდა იყოს', 'loss');
    }
    send({ t: 'bet', car: S.sel, amount, auto });
  } else if (S.phase === 'race' && b && b.state === 'open') {
    send({ t: 'cashout' });
  }
}
let toastTimer;
function toast(msg, kind) {
  const el = $('#toast'); el.textContent = msg; el.className = 'toast ' + kind; el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
function updateBal() {
  $('#balance').textContent = S.me ? fmt(S.me.balance) : '—';
  $('#refill').hidden = !S.me || S.me.balance >= 1000;
}

function mini(c) {
  return `<svg class="mini" viewBox="0 0 26 44" aria-hidden="true"><g fill="#0d0d0d"><rect x="0" y="8" width="4" height="9" rx="1"/><rect x="22" y="8" width="4" height="9" rx="1"/><rect x="0" y="28" width="4" height="9" rx="1"/><rect x="22" y="28" width="4" height="9" rx="1"/></g><rect x="2" y="1" width="22" height="42" rx="6" fill="${c.color}"/><rect x="11" y="2" width="4" height="40" fill="#fff" opacity=".85"/><path d="M5 14h16l-2-5H7z" fill="#1a2330"/><rect x="5" y="14" width="16" height="15" rx="2" fill="${c.dark}"/><circle cx="13" cy="21.5" r="5" fill="#fff"/><text x="13" y="24" text-anchor="middle" font-size="7" font-weight="800" font-family="Saira Condensed, sans-serif" fill="#111">${c.num}</text><rect x="6" y="29" width="14" height="4" fill="#1a2330"/><rect x="1" y="40" width="24" height="3" fill="#161616"/></svg>`;
}
const carsEl = $('#cars');
carsEl.innerHTML = CARS.map((c, i) => `<button class="car-card" type="button" id="car${i}" data-i="${i}" style="--c:${c.color}" aria-pressed="false">${mini(c)}<div class="cc-body"><div class="cc-name">${c.name}<span class="cc-num">#${c.num}</span></div><div class="cc-status" id="st${i}"></div></div><div class="cc-bets"><b id="cb${i}">0</b><small>ფსონი</small></div></button>`).join('');
carsEl.addEventListener('click', e => { const b = e.target.closest('.car-card'); if (b) pick(+b.dataset.i); });
function pick(i) { if (S.phase === 'bet' && !S.me?.bet) { S.sel = i; renderCards(); updateAction(true); } }
function renderCards() {
  const b = S.me?.bet;
  CARS.forEach((c, i) => {
    const car = S.cars[i], btn = $('#car' + i), st = $('#st' + i);
    btn.setAttribute('aria-pressed', String(b ? b.car === i : S.sel === i));
    btn.disabled = S.phase !== 'bet' || !!b;
    btn.classList.toggle('dead', !!car?.ended);
    let txt = 'მზადაა სტარტზე', cls = 'cc-status';
    if (car?.ended) { txt = `${car.type === 'crash' ? 'დაეჯახა' : 'გაჩერდა'} · ×${x100(car.crash100)}`; cls += ' ' + car.type; }
    else if (S.phase === 'race') { txt = 'მიქრის'; cls += ' go'; }
    setT(st, txt); setC(st, cls);
    setT($('#cb' + i), String(S.bets.filter(x => x.car === i).length));
  });
}
function renderFeed() {
  const myPid = S.me?.pid;
  const rows = S.bets.slice().sort((a, b) => (b.pid === myPid) - (a.pid === myPid) || b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  $('#feedSum').innerHTML = `${fmt(total)} <small>· ${rows.length} მოთამაშე</small>`;
  const ul = $('#feed');
  if (!rows.length) { ul.innerHTML = '<li class="feed-empty">ამ ეტაპზე ფსონი ჯერ არავის დაუდია.</li>'; return; }
  ul.innerHTML = rows.map(r => {
    let out = S.phase === 'bet' ? '' : '…', oc = '';
    if (r.state === 'won') { out = `×${x100(r.m100)} +${fmt(r.win)}`; oc = 'won'; }
    else if (r.state === 'lost') { out = '−' + fmt(r.amount); oc = 'lost'; }
    return `<li class="${r.pid === myPid ? 'me' : ''}"><span class="p-name"><i style="--c:${CARS[r.car].color}"></i>${esc(r.name)}${r.pid === myPid ? ' (შენ)' : ''}</span><span class="p-amt">${fmt(r.amount)}</span><span class="p-out ${oc}">${out}</span></li>`;
  }).join('');
}
function renderHistory() {
  $('#history').innerHTML = S.history.map(r => `<button type="button" class="h-round" data-round="${r.round}" title="SS ${r.round} — დააჭირე შესამოწმებლად">${r.results.map((x, i) => `<span class="h-chip ${x.crash100 >= 1000 ? 'hi' : x.crash100 < 200 ? 'lo' : ''}" style="--c:${CARS[i].color}"><i></i>${x100(x.crash100)}<em>${x.type === 'crash' ? '✕' : '■'}</em></span>`).join('')}</button>`).join('');
}

/* ---------- სამართლიანობის შემოწმება ---------- */
$('#history').addEventListener('click', e => {
  const b = e.target.closest('.h-round'); if (!b) return;
  const item = S.history.find(h => h.round === +b.dataset.round); if (!item) return;
  $('#vRound').value = item.round; $('#vSeed').value = item.seed;
  $('#fair').open = true;
  $('#fair').scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'nearest' });
  runVerify();
});
$('#vRun').addEventListener('click', runVerify);
let verifying = false;
async function runVerify() {
  if (verifying) return;
  const out = $('#vOut'), round = parseInt($('#vRound').value, 10), seed = $('#vSeed').value.trim().toLowerCase();
  if (!(round >= 1) || !/^[0-9a-f]{64}$/.test(seed)) { out.innerHTML = '<span class="bad">შეიყვანე რაუნდის ნომერი და 64-სიმბოლოიანი seed.</span>'; return; }
  if (!crypto?.subtle) { out.innerHTML = '<span class="bad">ბრაუზერი WebCrypto-ს არ უშვებს — გახსენი https:// ან localhost მისამართით.</span>'; return; }
  verifying = true;
  try {
    const lines = [];
    const item = S.history.find(h => h.round === round);
    const h = await sha256(seed);
    if (item) lines.push(item.hash === h ? '<span class="ok">✔ sha256(seed) ემთხვევა რაუნდამდე გამოქვეყნებულ ჰეშს</span>' : '<span class="bad">✘ ჰეში არ ემთხვევა</span>');
    out.innerHTML = lines.join('<br>') + '<br><span>ჯაჭვის შემოწმება… 0%</span>';
    const inChain = await verifyChain(seed, round, S.commit, p => { out.lastElementChild.textContent = `ჯაჭვის შემოწმება… ${Math.round(p * 100)}%`; });
    lines.push(inChain ? `<span class="ok">✔ seed ეკუთვნის ჯაჭვს (sha256 × ${round} = commit)</span>` : '<span class="bad">✘ seed ამ ჯაჭვს არ ეკუთვნის</span>');
    const res = await resultsFromSeed(seed, S.clientSeed);
    const same = item && res.every((r, i) => r.crash100 === item.results[i].crash100 && r.type === item.results[i].type);
    if (item) lines.push(same ? '<span class="ok">✔ შედეგები ემთხვევა თამაშში ნაჩვენებს</span>' : '<span class="bad">✘ შედეგები არ ემთხვევა</span>');
    lines.push(`<table>${res.map((r, i) => `<tr><td style="color:${CARS[i].color}">${CARS[i].name}</td><td>×${x100(r.crash100)}</td><td>${r.type === 'crash' ? 'დაეჯახა' : 'გაჩერდა'}</td></tr>`).join('')}</table>`);
    out.innerHTML = lines.join('<br>');
  } finally { verifying = false; }
}

/* ---------- შეყვანა ---------- */
actBtn.addEventListener('click', act);
$('#amt').addEventListener('input', () => updateAction(true));
document.querySelectorAll('.step').forEach(b => b.addEventListener('click', () => {
  $('#amt').value = String(Math.max(1, Math.min(1000, readAmt() + +b.dataset.step))); updateAction(true);
}));
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const cur = readAmt(), v = b.dataset.v, bal = S.me ? S.me.balance / 100 : 1000;
  let n = v === 'half' ? cur / 2 : v === 'dbl' ? cur * 2 : +v;
  n = Math.max(1, Math.min(n, 1000, Math.max(1, Math.floor(bal))));
  $('#amt').value = String(Math.round(n * 100) / 100); updateAction(true);
});
$('#refill').addEventListener('click', () => send({ t: 'refill' }));
$('#nick').addEventListener('change', e => send({ t: 'name', name: e.target.value }));
$('#nick').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
// Space ყველგან ფსონს/ქეშაუთს აკეთებს (ფოკუსირებულ ღილაკზეც), გარდა ტექსტური ველებისა
const spaceHijack = e => e.code === 'Space' && !e.target.matches('input, summary') && e.target !== actBtn;
document.addEventListener('keyup', e => { if (spaceHijack(e)) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (e.target.matches('input, summary') || e.repeat) return;
  if (e.code === 'Space') { if (e.target === actBtn) return; e.preventDefault(); act(); }
  const k = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code); if (k >= 0) pick(k);
});

/* ---------- ციკლი ---------- */
new ResizeObserver(resize).observe($('#stage'));
resize(); resetRound(0); renderCards(); renderFeed(); connect();
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
  physics(dt, now); draw(now); hud(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
