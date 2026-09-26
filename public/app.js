// Gravel Rush — კლიენტი. შედეგებს არ ითვლის: სერვერისგან იღებს მდგომარეობას და ხატავს.
import { G, CARS as N_CARS } from './shared/math.js';
import { sha256, resultsFromSeed, verifyChain } from './shared/verify.js';
import { createScene3D, paintCar } from './scene3d.js';

const $ = s => document.querySelector(s);
const CARS = [
  { name: 'ფალკონი', num: '07', color: '#e0321f', dark: '#8c1a14', accent: '#ffffff', stripe: '#ffffff', helmet: '#f4f4f4' },
  { name: 'ტალღა',   num: '21', color: '#2f6fe0', dark: '#0d3a91', accent: '#ffd23f', stripe: '#ffd23f', helmet: '#ffd23f' },
  { name: 'კრაზანა', num: '44', color: '#f2c230', dark: '#9c7a05', accent: '#141414', stripe: '#141414', helmet: '#1c1c1c' }
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
let G3 = null;
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
  if (G3) G3.resize(W, H);
}
const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const cx = d => W / 2 + amp * Math.sin(d * .0021) + amp * .6 * Math.sin(d * .0057 + 1.3);
const sy = d => baseY - (d - S.cam) + shakeY;
const laneX = (i, d) => cx(d) + (i - 1) * laneGap;
const slope = d => (cx(d + 2) - cx(d - 2)) / 4;
// ჩემი ფსონი მხოლოდ მაშინ, თუ ეკრანზე მიმდინარე რბოლას ეკუთვნის
const myBet = () => { const b = S.me?.bet; return b && b.round === S.round ? b : null; };
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
    c.rock = { d: rd, x: laneX(c.i, rd), i: c.i, kind: Math.random() < .55 ? 'tires' : 'cones', seed: Math.random() * 100 };
    rocks.push(c.rock);
    burst(c, vd);
    S.shake = Math.max(S.shake, myBet()?.car === c.i ? 12 : 5);
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
      // ასფალტზე — მსუბუქი საბურავის კვამლი/ჰაერის ნაკადი
      c.em += c.v * dt * .05 * (REDUCE ? .35 : 1);
      while (c.em >= 1) { c.em--; P({ x: x + (Math.random() - .5) * CW * .8, d: vd - L / 2, vx: (Math.random() - .5) * 20 * Sc, vd: c.v * .45, dr: 3, r: (2.5 + Math.random() * 3) * Sc, g: 12 * Sc, life: .5 + Math.random() * .4, a: .16 }); }
      // დაჯახებისას ტრიალი — საბურავის შავი კვალი
      if (c.ended && c.type === 'crash') {
        const a = Math.atan(slope(vd)) + c.spin, ca = Math.cos(a), sa = Math.sin(a);
        for (const s of [-1, 1]) {
          const ox = s * CW * .42, oy = L * .3;
          P({ k: 'skid', x: x + ox * ca - oy * sa, d: vd - (ox * sa + oy * ca), r: 2.6 * Sc, life: 5, a: .55, dr: 0 });
        }
      }
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
// თანამედროვე GT / ჰიპერქარი ზემოდან (წინა ნაწილი = −y)
function carPath(l, w) {
  ctx.beginPath();
  ctx.moveTo(-w * .16, -l * .5);
  ctx.quadraticCurveTo(0, -l * .53, w * .16, -l * .5);
  ctx.bezierCurveTo(w * .36, -l * .48, w * .5, -l * .38, w * .5, -l * .22);
  ctx.bezierCurveTo(w * .5, -l * .1, w * .42, -l * .04, w * .42, l * .06);
  ctx.bezierCurveTo(w * .42, l * .14, w * .54, l * .2, w * .54, l * .34);
  ctx.bezierCurveTo(w * .54, l * .44, w * .44, l * .5, w * .3, l * .5);
  ctx.lineTo(-w * .3, l * .5);
  ctx.bezierCurveTo(-w * .44, l * .5, -w * .54, l * .44, -w * .54, l * .34);
  ctx.bezierCurveTo(-w * .54, l * .2, -w * .42, l * .14, -w * .42, l * .06);
  ctx.bezierCurveTo(-w * .42, -l * .04, -w * .5, -l * .1, -w * .5, -l * .22);
  ctx.bezierCurveTo(-w * .5, -l * .38, -w * .36, -l * .48, -w * .16, -l * .5);
  ctx.closePath();
}
function drawCar(x, y, a, c) {
  const l = L * 1.05, w = CW * 1.08;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  // ჩრდილი
  ctx.save(); ctx.translate(3 * Sc, 5 * Sc); carPath(l, w); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill(); ctx.restore();
  // საბურავები (უკანა — უფრო განიერი)
  ctx.fillStyle = '#0b0b0b';
  for (const sx of [-1, 1]) {
    rr(sx * w * .5 - w * .1, -l * .33, w * .2, l * .17, 2 * Sc); ctx.fill();
    rr(sx * w * .54 - w * .11, l * .23, w * .22, l * .18, 2 * Sc); ctx.fill();
  }
  // ძარა + მბზინავი ლაქი
  carPath(l, w); ctx.fillStyle = c.color; ctx.fill();
  const gl = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  gl.addColorStop(0, 'rgba(255,255,255,.3)'); gl.addColorStop(.45, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,.32)');
  ctx.fillStyle = gl; ctx.fill();
  // ლივრეის ორმაგი ზოლი
  ctx.save(); carPath(l, w); ctx.clip();
  ctx.fillStyle = c.accent;
  ctx.fillRect(-w * .13, -l * .52, w * .07, l * 1.04); ctx.fillRect(w * .06, -l * .52, w * .07, l * 1.04);
  ctx.restore();
  // კაპოტის ჰაერის ღიობები
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * w * .29, -l * .31, w * .07, l * .06, sx * .35, 0, 6.2832); ctx.fill(); }
  // მინის კაპსულა
  const gg = ctx.createLinearGradient(0, -l * .2, 0, l * .16);
  gg.addColorStop(0, '#46637f'); gg.addColorStop(.35, '#0f1a25'); gg.addColorStop(1, '#070b10');
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.moveTo(-w * .3, -l * .12);
  ctx.bezierCurveTo(-w * .26, -l * .24, w * .26, -l * .24, w * .3, -l * .12);
  ctx.bezierCurveTo(w * .34, l * .02, w * .28, l * .14, w * .18, l * .17);
  ctx.lineTo(-w * .18, l * .17);
  ctx.bezierCurveTo(-w * .28, l * .14, -w * .34, l * .02, -w * .3, -l * .12);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1 * Sc;
  ctx.beginPath(); ctx.moveTo(-w * .2, -l * .165); ctx.quadraticCurveTo(0, -l * .205, w * .2, -l * .165); ctx.stroke();
  // სარკეები
  ctx.fillStyle = c.dark;
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * w * .47, -l * .1, w * .09, l * .03, 0, 0, 6.2832); ctx.fill(); }
  // ძრავის სახურავი + ნომერი
  ctx.fillStyle = '#fff'; rr(-w * .2, l * .21, w * .4, l * .13, 2 * Sc); ctx.fill();
  ctx.fillStyle = '#111'; ctx.font = `800 ${8.5 * Sc}px "Saira Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(c.num, 0, l * .275 + .5 * Sc);
  // LED ფარები
  ctx.strokeStyle = '#eaf7ff'; ctx.lineWidth = 1.6 * Sc; ctx.lineCap = 'round';
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * w * .2, -l * .478); ctx.lineTo(sx * w * .4, -l * .41); ctx.stroke(); }
  // უკანა ფრთა (კარბონი) + სტოპ-სიგნალის LED ზოლი
  ctx.fillStyle = '#121212'; rr(-w * .62, l * .42, w * 1.24, l * .07, 1.5 * Sc); ctx.fill();
  ctx.fillStyle = c.dark; ctx.fillRect(-w * .62, l * .405, w * .06, l * .1); ctx.fillRect(w * .56, l * .405, w * .06, l * .1);
  ctx.fillStyle = '#ff2b2b'; ctx.fillRect(-w * .34, l * .49, w * .68, 1.4 * Sc);
  ctx.restore();
}
function drawObstacle(r) {
  const y = sy(r.d); if (y < -40 || y > H + 40) return;
  ctx.save(); ctx.translate(r.x, y);
  if (r.kind === 'tires') {
    const pts = [[-9, 3], [0, -4], [9, 3], [0, 9]];
    for (const [px, py] of pts) { ctx.fillStyle = 'rgba(0,0,0,.35)'; circ((px + 2) * Sc, (py + 3) * Sc, 7 * Sc); }
    pts.forEach(([px, py], k) => {
      ctx.fillStyle = '#161616'; circ(px * Sc, py * Sc, 7 * Sc);
      ctx.fillStyle = k % 2 ? '#e0231c' : '#f2f2f2'; circ(px * Sc, py * Sc, 4.2 * Sc);
      ctx.fillStyle = '#161616'; circ(px * Sc, py * Sc, 2.4 * Sc);
    });
  } else {
    for (const [px, py] of [[-11, 1], [1, -6], [11, 4]]) {
      ctx.fillStyle = 'rgba(0,0,0,.3)'; circ((px + 2) * Sc, (py + 3) * Sc, 6 * Sc);
      ctx.fillStyle = '#ff6a00'; rr((px - 6) * Sc, (py - 6) * Sc, 12 * Sc, 12 * Sc, 2 * Sc); ctx.fill();
      ctx.fillStyle = '#ff8a2a'; circ(px * Sc, py * Sc, 4.4 * Sc);
      ctx.fillStyle = '#fff'; circ(px * Sc, py * Sc, 2.6 * Sc);
      ctx.fillStyle = '#ff6a00'; circ(px * Sc, py * Sc, 1.3 * Sc);
    }
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
      ctx.fillStyle = p.k === 'smoke' ? `rgba(120,122,128,${al})` : p.k === 'skid' ? `rgba(12,12,12,${al})` : `rgba(215,218,224,${al})`;
      circ(p.x, y, p.r);
    }
  }
  ctx.globalAlpha = 1;
}
const CROWD = ['#e0231c', '#1f6fff', '#f2f2f2', '#f5c518', '#16a34a', '#151515', '#ff7ab6', '#ff8a2a'];
const ADS = [['#e0231c', '#ffffff'], ['#0b0b0b', '#f5c518'], ['#1f6fff', '#ffffff'], ['#f2f2f2', '#e0231c'], ['#16a34a', '#ffffff']];
// ტრასის პარალელური პოლილინია offset მანძილზე ცენტრიდან
function trackLine(d0, d1, off, step = 10) {
  ctx.beginPath();
  for (let d = d0; d <= d1; d += step) ctx.lineTo(cx(d) + off, sy(d));
}
function band(d0, d1, a, b, side, col) {
  ctx.beginPath();
  for (let d = d0; d <= d1; d += 10) ctx.lineTo(cx(d) + side * a, sy(d));
  for (let d = d1; d >= d0; d -= 10) ctx.lineTo(cx(d) + side * b, sy(d));
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}
function drawSide(d0, d1) {
  const hw = roadW / 2, wall = hw + 48 * Sc;
  // საბურავების კედელი + რეკლამები
  ctx.lineCap = 'butt';
  for (const s of [-1, 1]) {
    ctx.lineWidth = 10 * Sc; ctx.strokeStyle = '#141414'; trackLine(d0, d1, s * wall); ctx.stroke();
    const as = 70;
    for (let k = Math.floor(d0 / as); k <= Math.ceil(d1 / as); k++) {
      const [bg, fg] = ADS[Math.floor(rnd(k * 5.1 + s * 2) * ADS.length)];
      const da = k * as + 8, db = k * as + as - 8;
      ctx.lineWidth = 7 * Sc; ctx.strokeStyle = bg; trackLine(da, db, s * wall, 6); ctx.stroke();
      ctx.lineWidth = 2 * Sc; ctx.strokeStyle = fg; trackLine(da + 10, db - 10, s * wall, 6); ctx.stroke();
    }
    ctx.lineWidth = 1.5 * Sc; ctx.strokeStyle = 'rgba(220,226,232,.55)'; trackLine(d0, d1, s * (wall + 12 * Sc)); ctx.stroke();
  }
  // ტრიბუნები მაყურებლებით
  const gsz = 380, rows = 6, rowGap = 7 * Sc, base = wall + 20 * Sc;
  for (let s = Math.floor(d0 / gsz) - 1; s <= Math.ceil(d1 / gsz); s++) {
    if (rnd(s * 13.7) > .7) continue;
    const side = rnd(s * 3.3) < .5 ? -1 : 1;
    const da = Math.max(d0, s * gsz + 40), db = Math.min(d1, s * gsz + gsz - 40);
    if (da >= db) continue;
    band(da, db, base - 4 * Sc, base + rows * rowGap + 6 * Sc, side, '#8d959c');
    band(da, db, base + rows * rowGap + 6 * Sc, base + rows * rowGap + 12 * Sc, side, '#c9ced3');
    for (let r = 0; r < rows; r++) {
      const off = side * (base + r * rowGap + 2 * Sc);
      for (let d = Math.ceil(da / 6) * 6; d <= db; d += 6) {
        ctx.fillStyle = CROWD[Math.floor(rnd(d * .37 + r * 11.3) * CROWD.length)];
        circ(cx(d) + off, sy(d), 2.5 * Sc);
      }
    }
  }
  // ხეები შორს
  const ts = 64;
  for (let s = Math.floor(d0 / ts) - 1; s <= Math.ceil(d1 / ts) + 1; s++) {
    for (const side of [-1, 1]) {
      if (rnd(s * 31.7 + side * 9.1) < .45) continue;
      const d = s * ts + rnd(s * 7.7 + side * 3) * ts;
      const x = cx(d) + side * (base + rows * rowGap + 40 * Sc + rnd(s * 3.1 + side) * W * .4), rad = (12 + rnd(s * 1.9 + side * 2) * 14) * Sc;
      if (x < -40 || x > W + 40) continue;
      const y = sy(d);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; circ(x + rad * .35, y + rad * .4, rad);
      ctx.fillStyle = '#1d4d24'; circ(x, y, rad);
      ctx.fillStyle = '#28632f'; circ(x - rad * .15, y - rad * .15, rad * .72);
      ctx.fillStyle = '#3c7d3f'; circ(x - rad * .3, y - rad * .3, rad * .36);
    }
  }
}
function draw(now) {
  const sh = REDUCE ? 0 : S.shake;
  shakeY = (Math.random() - .5) * sh;
  ctx.save(); ctx.translate((Math.random() - .5) * sh, 0);
  const d1 = S.cam + baseY + 80, d0 = S.cam - (H - baseY) - 80;
  const hw = roadW / 2, K = 8 * Sc, RO = 34 * Sc;
  // გაკრეჭილი ბალახი
  ctx.fillStyle = '#2f6b35'; ctx.fillRect(-30, -30, W + 60, H + 60);
  const gs = 70; ctx.fillStyle = '#377a3d';
  for (let s = Math.floor(d0 / gs); s <= Math.ceil(d1 / gs); s++) if (s % 2 === 0) { const ya = sy(s * gs + gs), yb = sy(s * gs); ctx.fillRect(-30, ya, W + 60, yb - ya); }
  // run-off ზონა
  roadPoly(d0, d1, hw + K + RO, '#5a646b');
  for (const s of [-1, 1]) band(d0, d1, hw + K + RO - 6 * Sc, hw + K + RO, s, '#1f8a4c');
  // ბორდიურები (წითელი / თეთრი)
  const ks = 18;
  for (let s = Math.floor(d0 / ks); s <= Math.ceil(d1 / ks); s++) {
    const da = s * ks, db = da + ks;
    ctx.fillStyle = s % 2 ? '#f4f4f4' : '#e0231c';
    for (const sd of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx(da) + sd * hw, sy(da)); ctx.lineTo(cx(db) + sd * hw, sy(db));
      ctx.lineTo(cx(db) + sd * (hw + K), sy(db)); ctx.lineTo(cx(da) + sd * (hw + K), sy(da));
      ctx.closePath(); ctx.fill();
    }
  }
  // ასფალტი
  roadPoly(d0, d1, hw, '#2c3035');
  const ss = 14;
  for (let s = Math.floor(d0 / ss); s <= Math.ceil(d1 / ss); s++) for (let k = 0; k < 6; k++) {
    const a = rnd(s * 9.7 + k * 1.3), b = rnd(s * 3.3 + k * 5.1), d = s * ss + b * ss;
    ctx.fillStyle = k % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.2)';
    ctx.fillRect(cx(d) + (a - .5) * roadW * .98, sy(d), 2 * Sc, 2 * Sc);
  }
  // რეზინის კვალი რბოლის ხაზზე
  ctx.lineCap = 'butt'; ctx.lineWidth = 10 * Sc; ctx.strokeStyle = 'rgba(0,0,0,.17)';
  for (let i = 0; i < 3; i++) { ctx.beginPath(); for (let d = d0; d <= d1; d += 12) ctx.lineTo(laneX(i, d), sy(d)); ctx.stroke(); }
  // თეთრი კიდის ხაზები
  ctx.lineWidth = 2.4 * Sc; ctx.strokeStyle = 'rgba(255,255,255,.92)';
  for (const sd of [-1, 1]) { trackLine(d0, d1, sd * (hw - 4 * Sc)); ctx.stroke(); }
  // წყვეტილი ზოლის გამყოფები
  ctx.lineWidth = 2 * Sc; ctx.strokeStyle = 'rgba(255,255,255,.55)';
  const dl = 28;
  for (let s = Math.floor(d0 / dl); s <= Math.ceil(d1 / dl); s++) {
    if (s % 2) continue;
    for (const o of [-.5, .5]) { trackLine(s * dl, s * dl + dl, o * laneGap, 7); ctx.stroke(); }
  }
  // სასტარტო ბადე + ჭადრაკული ხაზი
  for (let i = 0; i < 3; i++) {
    const gd = LEADS[i] * Sc - L * .62, gx = laneX(i, gd), gy = sy(gd), bw = CW * .85;
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2 * Sc;
    ctx.beginPath(); ctx.moveTo(gx - bw, gy - 10 * Sc); ctx.lineTo(gx - bw, gy); ctx.lineTo(gx + bw, gy); ctx.lineTo(gx + bw, gy - 10 * Sc); ctx.stroke();
  }
  const sl = 52 * Sc;
  if (sl > d0 && sl < d1) {
    const y = sy(sl), q = 7 * Sc, x0 = cx(sl) - hw, n = Math.ceil(roadW / q);
    for (let j = 0; j < n; j++) for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (j + r) % 2 ? '#f5f5f5' : '#151515';
      ctx.fillRect(x0 + j * q, y + (r - 1) * q, Math.min(q, roadW - j * q), q);
    }
  }
  for (const r of rocks) drawObstacle(r);
  drawParts(false);
  const myB = myBet();
  const mine = myB ? myB.car : (S.phase === 'bet' ? S.sel : -1);
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
    else if (myB && myB.car === c.i && myB.state === 'won') pill(`+${fmt(myB.win)}`, p.x, ly, '#4fd67a', '#062010');
    else if (c.i === mine) pill(myB ? 'შენ' : 'არჩეული', p.x, ly, 'rgba(12,18,14,.85)', '#fff8ea');
  }
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,.07)'); g.addColorStop(.45, 'rgba(255,255,255,0)');
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
    setT(phaseEl, `რბოლა #${S.round} · ფსონების მიღება · სტარტამდე`);
    barEl.hidden = false; barFill.style.transform = `scaleX(${Math.min(1, rem * 1000 / S.rules.betMs)})`;
  } else if (S.phase === 'race') {
    const m = currentMult();
    setT(multEl, m.toFixed(2) + '×');
    setC(multEl, 'mult' + (m >= 10 ? ' hot3' : m >= 3 ? ' hot2' : m >= 1.5 ? ' hot1' : ''));
    setT(phaseEl, `რბოლა #${S.round} · ტრასაზე ${S.cars.filter(c => !c.ended).length} / 3`);
    barEl.hidden = true;
  } else if (S.phase === 'end') {
    setT(multEl, currentMult().toFixed(2) + '×'); setC(multEl, 'mult ended');
    setT(phaseEl, `რბოლა #${S.round} · ფინიში — შემდეგი რბოლა მალე`);
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
  const b = myBet();
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
    else { cls = 'wait'; dis = true; main = 'რბოლა მიმდინარეობს'; sub = 'ფსონს შემდეგ რბოლაზე დადებ'; }
  } else {
    cls = 'wait'; dis = true; main = 'შემდეგი რბოლა მზადდება…';
    sub = b ? (b.state === 'won' ? `ამ რბოლაზე მოგება +${fmt(b.win)}` : 'ამჯერად არ გაგიმართლა') : 'აირჩიე ბოლიდი ქვემოთ';
  }
  const key = cls + main + sub;
  if (!force && key === actKey) return;
  actKey = key;
  actBtn.className = cls; actBtn.disabled = dis;
  actBtn.firstChild.textContent = main; actBtn.lastChild.textContent = sub;
}
function act() {
  const b = myBet();
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

const mini = i => `<canvas class="mini" id="mini${i}" aria-hidden="true"></canvas>`;
function drawMinis() {
  const d = Math.min(3, (devicePixelRatio || 1) * 1.5);
  CARS.forEach((c, i) => {
    const el = $('#mini' + i); el.width = 24 * d; el.height = 46 * d;
    const x = el.getContext('2d'); x.scale(d, d); x.translate(12, 23); paintCar(x, c, 21, 44);
  });
}
const carsEl = $('#cars');
carsEl.innerHTML = CARS.map((c, i) => `<button class="car-card" type="button" id="car${i}" data-i="${i}" style="--c:${c.color}" aria-pressed="false">${mini(i)}<div class="cc-body"><div class="cc-name">${c.name}<span class="cc-num">#${c.num}</span></div><div class="cc-status" id="st${i}"></div></div><div class="cc-bets"><b id="cb${i}">0</b><small>ფსონი</small></div></button>`).join('');
carsEl.addEventListener('click', e => { const b = e.target.closest('.car-card'); if (b) pick(+b.dataset.i); });
function pick(i) { if (S.phase === 'bet' && !myBet()) { S.sel = i; renderCards(); updateAction(true); } }
// ბოლიდის არჩევა ტრასაზე მასზე დაჭერით
function carAt(x, y) {
  const now = performance.now();
  if (G3) return G3.pick(x, y, now);
  let best = -1, bd = (L * .9) ** 2;
  for (const c of S.cars) {
    const d = visD(c, now), dx = carX(c, d) - x, dy = sy(d) - y, q = dx * dx + dy * dy;
    if (q < bd) { bd = q; best = c.i; }
  }
  return best;
}
const stageEl = $('#stage');
const stagePoint = e => { const r = stageEl.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
stageEl.addEventListener('click', e => {
  if (S.phase !== 'bet' || myBet()) return;
  const i = carAt(...stagePoint(e));
  if (i >= 0) pick(i);
});
stageEl.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const can = S.phase === 'bet' && !myBet() && carAt(...stagePoint(e)) >= 0;
  stageEl.style.cursor = can ? 'pointer' : '';
});
function renderCards() {
  const b = myBet();
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
  $('#menuCount').textContent = String(rows.length);
  const ul = $('#feed');
  if (!rows.length) { ul.innerHTML = '<li class="feed-empty">ამ რბოლაზე ფსონი ჯერ არავის დაუდია.</li>'; return; }
  ul.innerHTML = rows.map(r => {
    let out = S.phase === 'bet' ? '' : '…', oc = '';
    if (r.state === 'won') { out = `×${x100(r.m100)} +${fmt(r.win)}`; oc = 'won'; }
    else if (r.state === 'lost') { out = '−' + fmt(r.amount); oc = 'lost'; }
    return `<li class="${r.pid === myPid ? 'me' : ''}"><span class="p-name"><i style="--c:${CARS[r.car].color}"></i>${esc(r.name)}${r.pid === myPid ? ' (შენ)' : ''}</span><span class="p-amt">${fmt(r.amount)}</span><span class="p-out ${oc}">${out}</span></li>`;
  }).join('');
}
function renderHistory() {
  $('#history').innerHTML = S.history.map(r => `<button type="button" class="h-round" data-round="${r.round}" title="რბოლა #${r.round} — დააჭირე შესამოწმებლად">${r.results.map((x, i) => `<span class="h-chip ${x.crash100 >= 1000 ? 'hi' : x.crash100 < 200 ? 'lo' : ''}" style="--c:${CARS[i].color}"><i></i>${x100(x.crash100)}<em>${x.type === 'crash' ? '✕' : '■'}</em></span>`).join('')}</button>`).join('');
}

/* ---------- სამართლიანობის შემოწმება ---------- */
$('#history').addEventListener('click', e => {
  const b = e.target.closest('.h-round'); if (!b) return;
  const item = S.history.find(h => h.round === +b.dataset.round); if (!item) return;
  $('#vRound').value = item.round; $('#vSeed').value = item.seed;
  openSheet();
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

/* ---------- მობილური ეკრანი: ხილული სიმაღლე და მასშტაბის აღდგენა ---------- */
// Safari-ს ქვედა ზოლი გვერდს ფარავს; აპლიკაციის სიმაღლეს ვზღუდავთ რეალურად ხილული ნაწილით
const vv = window.visualViewport;
function fitHeight() {
  if (!vv || vv.scale > 1.01) return;
  const svh = document.createElement('div');
  svh.style.cssText = 'position:absolute;visibility:hidden;height:100svh;width:0';
  document.body.appendChild(svh);
  const h = Math.min(svh.offsetHeight || innerHeight, Math.round(vv.height));
  svh.remove();
  document.documentElement.style.setProperty('--app-h', h + 'px');
}
// iOS შეიძლება გადიდებული დატოვოს (ძველი ვერსიიდან ან ველზე შეხებისას) — ვაბრუნებთ 1-ზე
const vpMeta = document.querySelector('meta[name=viewport]');
function resetZoom() {
  if (!vpMeta || !vv || vv.scale <= 1.01) return;
  const c = vpMeta.content;
  vpMeta.content = c + ', user-scalable=0';
  requestAnimationFrame(() => { vpMeta.content = c; });
}
fitHeight(); resetZoom();
vv?.addEventListener('resize', fitHeight);
addEventListener('orientationchange', () => setTimeout(fitHeight, 300));
document.addEventListener('focusout', e => { if (e.target.matches('input')) setTimeout(() => { resetZoom(); fitHeight(); }, 50); });

/* ---------- გვერდითი პანელი (მობილურზე — ქვედა ფურცელი) ---------- */
const side = $('#side'), scrim = $('#scrim'), menuBtn = $('#menuBtn');
function openSheet() {
  if (getComputedStyle(menuBtn).display === 'none') return;
  side.classList.add('open'); scrim.hidden = false; menuBtn.setAttribute('aria-expanded', 'true');
}
function closeSheet() {
  side.classList.remove('open'); scrim.hidden = true; menuBtn.setAttribute('aria-expanded', 'false');
  if (side.contains(document.activeElement)) document.activeElement.blur();
}
menuBtn.addEventListener('click', () => (side.classList.contains('open') ? closeSheet() : openSheet()));
scrim.addEventListener('click', closeSheet);
$('#sheetClose').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && side.classList.contains('open')) closeSheet(); });
let sheetY = null;
side.addEventListener('touchstart', e => { sheetY = side.querySelector('.side-body').scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
side.addEventListener('touchmove', e => { if (sheetY !== null && e.touches[0].clientY - sheetY > 70) { sheetY = null; closeSheet(); } }, { passive: true });

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

/* ---------- 3D ---------- */
function labels3(now) {
  ctx.clearRect(0, 0, W, H);
  const myB = myBet(), mine = myB ? myB.car : (S.phase === 'bet' ? S.sel : -1);
  for (const c of S.cars) {
    const p = G3.project(c, now); if (!p || p.y < -20 || p.y > H + 20) continue;
    const ly = p.y - 12 * Sc;
    if (c.ended) pill(`${c.type === 'crash' ? 'დაეჯახა' : 'გაჩერდა'} ×${x100(c.crash100)}`, p.x, ly, c.type === 'crash' ? '#ff5d52' : '#e3bd72', '#1a0f08');
    else if (myB && myB.car === c.i && myB.state === 'won') pill(`+${fmt(myB.win)}`, p.x, ly, '#4fd67a', '#062010');
    else if (c.i === mine) pill(myB ? 'შენ' : 'არჩეული', p.x, ly, 'rgba(10,15,24,.86)', '#fff8ea');
  }
}
function start3D() {
  try {
    G3 = createScene3D({
      canvas: $('#gl'), S, parts, rocks, CARS, visD, cx, REDUCE,
      dims: () => ({ W, H, Sc, laneGap }),
      mine: () => myBet() ? myBet().car : (S.phase === 'bet' ? S.sel : -1),
      betRemaining: () => S.rules.betMs - (serverNow() - S.phaseStart)
    });
  } catch (e) { console.error(e); G3 = null; }
  if (G3) G3.resize(W, H); else $('#gl').hidden = true;
}

/* ---------- ციკლი ---------- */
new ResizeObserver(resize).observe($('#stage'));
resize(); resetRound(0); start3D(); drawMinis(); renderCards(); renderFeed(); connect();
document.fonts?.ready.then(drawMinis);
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
  physics(dt, now);
  if (G3) {
    try { G3.render(now, dt); labels3(now); }
    catch (e) { console.error(e); G3 = null; $('#gl').hidden = true; }
  }
  if (!G3) draw(now);
  hud(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
