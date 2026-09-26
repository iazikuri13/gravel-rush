// Riviera Rush — 3D სცენა (three.js). თამაშის მდგომარეობას მხოლოდ კითხულობს და ხატავს;
// შედეგებს, ფსონებს და დროს არაფერს უცვლის. three.js იტვირთება index.html-იდან (window.THREE).
const TAU = Math.PI * 2;
const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
let W = 0, H = 0, Sc = 1, laneGap = 1;

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), rot || 0, 0, TAU); }
function smooth(c, p) {
  const n = p.length, m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  c.beginPath(); const s = m(p[n - 1], p[0]); c.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) { const q = p[i], e = m(q, p[(i + 1) % n]); c.quadraticCurveTo(q[0], q[1], e[0], e[1]); }
  c.closePath();
}
function shade(hex, t) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const T = t < 0 ? 0 : 255, p = Math.abs(t);
  r = Math.round(r + (T - r) * p); g = Math.round(g + (T - g) * p); b = Math.round(b + (T - b) * p);
  return `rgb(${r},${g},${b})`;
}
function wrap(N, px, py, r, f) {
  const xs = [px], ys = [py];
  if (px < r) xs.push(px + N); else if (px > N - r) xs.push(px - N);
  if (py < r) ys.push(py + N); else if (py > N - r) ys.push(py - N);
  for (const a of xs) for (const b of ys) f(a, b);
}
function dots(x, N, n, r0, r1, cols, alpha) {
  const ps = cols.map(() => new Path2D());
  for (let k = 0; k < n; k++) {
    const px = Math.random() * N, py = Math.random() * N, r = r0 + Math.random() * (r1 - r0), p = ps[k % cols.length];
    wrap(N, px, py, r + 1, (a, b) => { p.moveTo(a + r, b); p.arc(a, b, r, 0, TAU); });
  }
  x.globalAlpha = alpha; cols.forEach((c, i) => { x.fillStyle = c; x.fill(ps[i]); }); x.globalAlpha = 1;
}
function blotches(x, N, n, r0, r1, cols, a) {
  for (let k = 0; k < n; k++) {
    const px = Math.random() * N, py = Math.random() * N, r = r0 + Math.random() * (r1 - r0), col = cols[k % cols.length];
    wrap(N, px, py, r, (u, v) => {
      const g = x.createRadialGradient(u, v, 0, u, v, r);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g; x.fillRect(u - r, v - r, r * 2, r * 2);
    });
  }
}

function texC(N, base, paint) { const c = mk(N, N), x = c.getContext('2d'); x.fillStyle = base; x.fillRect(0, 0, N, N); paint(x, N); return c; }
const CAN = {};
function buildCanvases() {
  CAN.asphalt = texC(256, '#3a3c3f', (x, N) => {
    blotches(x, N, 46, 16, 54, ['26,27,29', '80,82,85', '50,48,46'], .32);
    dots(x, N, 9000, .35, .95, ['#505357', '#2c2d2f', '#5e6165', '#44464a'], .45);
    dots(x, N, 260, .4, .8, ['#8a8d91'], .22);
  });
  CAN.paving = texC(128, '#cdc2ad', (x, N) => {
    const q = 16;
    for (let i = 0; i < N / q; i++) for (let j = 0; j < N / q; j++) { x.fillStyle = shade('#cdc2ad', Math.random() * .12 - .06); x.fillRect(i * q + .5, j * q + .5, q - 1, q - 1); }
    x.strokeStyle = 'rgba(120,108,88,.55)'; x.lineWidth = 1;
    for (let k = 0; k <= N; k += q) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, N); x.moveTo(0, k); x.lineTo(N, k); x.stroke(); }
    dots(x, N, 900, .3, .8, ['#a99d86', '#e2d9c7'], .45);
    blotches(x, N, 10, 10, 30, ['90,80,60'], .12);
  });
  CAN.roof = texC(64, '#b5603b', (x, N) => {
    const cols = ['#b35d3a', '#c26f47', '#a4532f', '#c97b52', '#ad5a36'], tw = 8, th = 6;
    for (let r = 0; r < N / th; r++) for (let k = -1; k < N / tw + 1; k++) {
      const px = k * tw + (r % 2 ? tw / 2 : 0), py = r * th;
      x.fillStyle = cols[Math.floor(Math.random() * cols.length)]; x.fillRect(px, py, tw - .6, th);
      x.fillStyle = 'rgba(255,220,180,.18)'; x.fillRect(px, py, tw - .6, 1.2);
      x.fillStyle = 'rgba(60,20,5,.35)'; x.fillRect(px, py + th - 1, tw - .6, 1);
    }
    blotches(x, N, 6, 8, 20, ['60,40,30', '230,210,190'], .16);
  });
}

function puff(rgb) {
  const c = mk(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(.45, `rgba(${rgb},.55)`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
}

/* F1-style car, nose toward -y */
export function paintCar(x, c, w, l) {
  const s = w / 25, col = c.color, dk = shade(col, -.45);
  const X = v => v * w, Y = v => v * l;
  x.strokeStyle = '#1b1b1b'; x.lineWidth = .9 * s; x.beginPath();
  for (const sx of [-1, 1]) {
    x.moveTo(sx * X(.05), Y(-.34)); x.lineTo(sx * X(.36), Y(-.31));
    x.moveTo(sx * X(.07), Y(-.25)); x.lineTo(sx * X(.36), Y(-.29));
    x.moveTo(sx * X(.1), Y(.34)); x.lineTo(sx * X(.35), Y(.31));
    x.moveTo(sx * X(.12), Y(.25)); x.lineTo(sx * X(.35), Y(.29));
  }
  x.stroke();
  const tyre = (tx, ty, tw, tl) => {
    const g = x.createLinearGradient(tx - tw / 2, 0, tx + tw / 2, 0);
    g.addColorStop(0, '#070707'); g.addColorStop(.35, '#2c2c2c'); g.addColorStop(.6, '#1d1d1d'); g.addColorStop(1, '#060606');
    x.fillStyle = g; rr(x, tx - tw / 2, ty - tl / 2, tw, tl, tw * .3); x.fill();
    x.fillStyle = 'rgba(255,255,255,.07)';
    for (let k = -2; k <= 2; k++) x.fillRect(tx - tw / 2 + 1 * s, ty + k * tl * .17, tw - 2 * s, .5 * s);
    x.fillStyle = '#e8cf3a'; x.fillRect(tx + (tx > 0 ? tw / 2 - 1 * s : -tw / 2), ty - tl * .34, .9 * s, tl * .68);
  };
  for (const sx of [-1, 1]) { tyre(sx * X(.4), Y(-.3), X(.19), Y(.15)); tyre(sx * X(.39), Y(.31), X(.23), Y(.17)); }
  const fl = [[.1, -.22], [.33, -.07], [.35, .2], [.2, .37], [.1, .41]];
  x.fillStyle = '#121212'; smooth(x, [...fl, ...fl.slice().reverse().map(([a, b]) => [-a, b])].map(([a, b]) => [X(a), Y(b)])); x.fill();
  x.fillStyle = '#151515'; rr(x, -X(.47), Y(-.505), X(.94), Y(.055), 1 * s); x.fill();
  x.fillStyle = col; rr(x, -X(.44), Y(-.48), X(.88), Y(.022), .8 * s); x.fill();
  x.fillStyle = c.stripe; rr(x, -X(.42), Y(-.458), X(.84), Y(.012), .5 * s); x.fill();
  x.fillStyle = dk; for (const sx of [-1, 1]) x.fillRect(sx > 0 ? X(.44) : -X(.48), Y(-.515), X(.04), Y(.075));
  const Pp = [[.04, -.47], [.07, -.34], [.1, -.24], [.12, -.15], [.16, -.085], [.3, -.055], [.32, .02], [.31, .14], [.24, .24], [.14, .32], [.1, .42]];
  const pts = [[0, -.5], ...Pp, [0, .44], ...Pp.slice().reverse().map(([a, b]) => [-a, b])].map(([a, b]) => [X(a), Y(b)]);
  const body = () => smooth(x, pts);
  const g = x.createLinearGradient(-X(.33), 0, X(.33), 0);
  g.addColorStop(0, shade(col, -.5)); g.addColorStop(.18, shade(col, -.1)); g.addColorStop(.38, shade(col, .28));
  g.addColorStop(.52, shade(col, .1)); g.addColorStop(.8, col); g.addColorStop(1, shade(col, -.55));
  body(); x.fillStyle = g; x.fill();
  x.save(); body(); x.clip();
  x.fillStyle = c.stripe; x.fillRect(-X(.028), Y(-.5), X(.056), Y(.37));
  for (const sx of [-1, 1]) {
    x.beginPath(); x.moveTo(sx * X(.17), Y(-.04)); x.lineTo(sx * X(.33), Y(-.02)); x.lineTo(sx * X(.32), Y(.06)); x.lineTo(sx * X(.15), Y(.13)); x.closePath(); x.fill();
  }
  x.fillStyle = '#0a0a0a'; for (const sx of [-1, 1]) { rr(x, sx > 0 ? X(.16) : -X(.3), Y(-.075), X(.14), Y(.024), .6 * s); x.fill(); }
  const sp = x.createLinearGradient(-X(.05), 0, X(.05), 0);
  sp.addColorStop(0, 'rgba(0,0,0,.15)'); sp.addColorStop(.4, 'rgba(255,255,255,.22)'); sp.addColorStop(1, 'rgba(0,0,0,.18)');
  x.fillStyle = sp; x.fillRect(-X(.05), Y(-.02), X(.1), Y(.44));
  const gl = x.createRadialGradient(-X(.12), Y(-.02), 0, -X(.12), Y(-.02), X(.35));
  gl.addColorStop(0, 'rgba(255,255,255,.3)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gl; x.fillRect(-X(.5), -Y(.5), X(1), Y(1));
  const rg = x.createLinearGradient(0, Y(.18), 0, Y(.44));
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.35)');
  x.fillStyle = rg; x.fillRect(-X(.5), Y(.18), X(1), Y(.3));
  body(); x.lineWidth = 2 * s; x.strokeStyle = 'rgba(0,0,0,.28)'; x.stroke();
  x.restore();
  body(); x.lineWidth = .6 * s; x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke();
  x.fillStyle = '#0a0a0a'; ell(x, 0, Y(-.1), X(.085), Y(.065)); x.fill();
  const hg = x.createRadialGradient(-X(.025), Y(-.1), 0, 0, Y(-.085), X(.08));
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(.35, c.helmet); hg.addColorStop(1, shade(c.helmet === '#1c1c1c' ? '#3a3a3a' : c.helmet, -.35));
  x.fillStyle = hg; ell(x, 0, Y(-.085), X(.07), X(.07)); x.fill();
  x.fillStyle = '#101418'; ell(x, 0, Y(-.108), X(.055), Y(.016)); x.fill();
  x.strokeStyle = '#2a2a2a'; x.lineWidth = 1.3 * s;
  ell(x, 0, Y(-.088), X(.1), Y(.075)); x.stroke();
  x.beginPath(); x.moveTo(0, Y(-.162)); x.lineTo(0, Y(-.205)); x.stroke();
  x.fillStyle = '#0c0c0c'; ell(x, 0, Y(-.005), X(.045), Y(.022)); x.fill();
  x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = .7 * s; x.beginPath(); x.moveTo(0, Y(.02)); x.lineTo(0, Y(.36)); x.stroke();
  x.font = `800 ${7.5 * s}px "Saira Condensed", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 1.6 * s; x.strokeStyle = 'rgba(0,0,0,.7)'; x.strokeText(c.num, 0, Y(.19)); x.fillStyle = '#fff'; x.fillText(c.num, 0, Y(.19));
  x.fillStyle = dk; for (const sx of [-1, 1]) { ell(x, sx * X(.2), Y(-.135), X(.035), Y(.013)); x.fill(); }
  x.fillStyle = '#141414'; rr(x, -X(.37), Y(.425), X(.74), Y(.055), .8 * s); x.fill();
  x.fillStyle = col; rr(x, -X(.35), Y(.44), X(.7), Y(.022), .6 * s); x.fill();
  x.fillStyle = c.stripe; for (const sx of [-1, 1]) x.fillRect(sx > 0 ? X(.35) : -X(.385), Y(.415), X(.035), Y(.075));
  x.fillStyle = '#ff2b2b'; x.fillRect(-X(.022), Y(.415), X(.044), Y(.013));
}

export function createScene3D(api) {
  if (!CAN.asphalt) buildCanvases();
  const {S, parts, rocks, CARS, visD, cx, REDUCE} = api;
  ({W, H, Sc, laneGap} = api.dims());
  const T = window.THREE; if (!T) return null;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;
  let R;
  try { R = new T.WebGLRenderer({canvas: api.canvas, antialias: true, powerPreference: 'high-performance'}); } catch (e) { return null; }
  if (!R.getContext()) return null;
  R.outputEncoding = T.sRGBEncoding; R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = .95;
  R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap;
  const AN = Math.min(8, R.capabilities.getMaxAnisotropy()), V = T.Vector3, scene = new T.Scene();
  const HZ = new T.Color('#d4e0e7');
  scene.fog = new T.Fog(HZ, 70, 520);
  const cam = new T.PerspectiveCamera(50, 1, .3, 2400);
  const C = 50, HWm = 6, LG = 3.4, SMALL = W < 600;
  const XR = s => 9 * Math.sin(s * .012) + 4 * Math.sin(s * .031 + 1.3);
  const XR1 = s => .108 * Math.cos(s * .012) + .124 * Math.cos(s * .031 + 1.3);
  const XR2 = s => -.001296 * Math.sin(s * .012) - .003844 * Math.sin(s * .031 + 1.3);
  const P3 = (s, l, y = 0, v = new V()) => { const d = XR1(s), n = Math.hypot(1, d); return v.set(XR(s) + l / n, y, -s + l * d / n); };
  const HEAD = s => -Math.atan(XR1(s));
  const place = (o, s, l, y = 0) => { P3(s, l, y, o.position); o.rotation.y = HEAD(s); return o; };
  const U = () => 5 * Sc, kL = () => LG / laneGap;

  /* textures */
  const ctex = (c, srgb = true) => { const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = AN; if (srgb) t.encoding = T.sRGBEncoding; return t; };
  const cnv = (w, h, f) => { const c = mk(w, h), x = c.getContext('2d'); f(x, w, h); return c; };
  const std = o => new T.MeshStandardMaterial(o);
  const kerbT = ctex(cnv(8, 64, x => { x.fillStyle = '#cf2529'; x.fillRect(0, 0, 8, 32); x.fillStyle = '#f1efe8'; x.fillRect(0, 32, 8, 32); }));
  const rubT = ctex(cnv(256, 32, (x, w, h) => {
    for (let i = 0; i < 3; i++) for (const o of [-.82, .82]) {
      const px = ((i - 1) * LG + o + HWm) / (2 * HWm) * w, bw = .6 / 12 * w;
      const g = x.createLinearGradient(px - bw, 0, px + bw, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - bw, 0, bw * 2, h);
    }
    for (let k = 0; k < 300; k++) { x.fillStyle = `rgba(0,0,0,${Math.random() * .18})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 1); }
  }));
  const fenceT = ctex(cnv(64, 64, x => {
    x.strokeStyle = 'rgba(70,76,82,1)'; x.lineWidth = 1.4; x.beginPath();
    for (let k = -64; k <= 64; k += 16) { x.moveTo(k, 0); x.lineTo(k + 64, 64); x.moveTo(k + 64, 0); x.lineTo(k, 64); }
    x.stroke();
  }));
  const checkT = ctex(cnv(160, 20, x => { for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#f4f2ec' : '#161616'; x.fillRect(i * 10, j * 10, 10, 10); } }));
  const blockT = ctex(cnv(128, 32, x => { for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? '#f3f3f3' : '#d3262a'; x.fillRect(k * 16, 0, 16, 32); } }));
  const teakT = ctex(cnv(64, 64, x => {
    x.fillStyle = '#a8743f'; x.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) { x.fillStyle = shade('#a8743f', (Math.random() - .5) * .16); x.fillRect(0, y, 64, 7); x.fillStyle = '#3b2412'; x.fillRect(0, y + 7, 64, 1); }
  }));
  const rimT = ctex(cnv(64, 64, x => {
    x.fillStyle = '#1d1f23'; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = '#8a9099'; x.lineWidth = 5;
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); x.stroke(); }
    x.fillStyle = '#c9ced4'; x.beginPath(); x.arc(32, 32, 7, 0, TAU); x.fill();
  }));
  const frondT = ctex(cnv(256, 64, (x, w, h) => {
    const cy = h / 2;
    for (let i = 6; i < w - 6; i += 3) {
      const t = i / w, len = (cy - 2) * Math.sin(Math.PI * Math.min(1, .08 + t * 1.05));
      x.strokeStyle = `rgb(${38 + t * 40},${86 + t * 58},${28 + t * 18})`; x.lineWidth = 2.4;
      x.beginPath(); x.moveTo(i, cy); x.lineTo(i + 11, cy - len); x.moveTo(i, cy); x.lineTo(i + 11, cy + len); x.stroke();
    }
    x.strokeStyle = '#8d8a48'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, cy); x.lineTo(w, cy); x.stroke();
  }));
  const awnT = ['#c8202a', '#1f6b4f', '#1d3566', '#d98b1c'].map(c => ctex(cnv(64, 8, x => { for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? '#f4f1ea' : c; x.fillRect(k * 8, 0, 8, 8); } })));
  const AWN = awnT.map(t => std({map: t, roughness: .8}));
  const waterN = ctex(cnv(256, 256, (x, w, h) => {
    const hg = new Float32Array(w * h), waves = [];
    for (let k = 0; k < 18; k++) waves.push([1 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 9) - 4, Math.random() * TAU]);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let v = 0; for (const [a, b, ph] of waves) v += Math.sin(TAU * (a * i / w + b * j / h) + ph) / (a + Math.abs(b)); hg[j * w + i] = v; }
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const hx = hg[j * w + (i + 1) % w] - hg[j * w + (i + w - 1) % w], hy = hg[((j + 1) % h) * w + i] - hg[((j + h - 1) % h) * w + i];
      let nx = -hx * 5, ny = -hy * 5, nz = 1; const l = Math.hypot(nx, ny, nz);
      const o = (j * w + i) * 4; img.data[o] = (nx / l * .5 + .5) * 255; img.data[o + 1] = (ny / l * .5 + .5) * 255; img.data[o + 2] = (nz / l * .5 + .5) * 255; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }), false);
  const facade = (wall, shut) => ctex(cnv(256, 256, (x, w, h) => {
    x.fillStyle = wall; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},${Math.random() * .06})`; x.fillRect(Math.random() * w, Math.random() * h, 5, 5); }
    for (let f = 0; f < 2; f++) {
      const fy = f * 128;
      x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(0, fy + 118, w, 5); x.fillStyle = 'rgba(0,0,0,.14)'; x.fillRect(0, fy + 123, w, 4);
      for (let c = 0; c < 2; c++) {
        const wx = c * 128 + 44, wy = fy + 26, ww = 40, wh = 68;
        x.fillStyle = shut; x.fillRect(wx - 17, wy, 15, wh); x.fillRect(wx + ww + 2, wy, 15, wh);
        x.fillStyle = 'rgba(0,0,0,.28)'; for (let k = wy + 3; k < wy + wh; k += 5) { x.fillRect(wx - 17, k, 15, 1.5); x.fillRect(wx + ww + 2, k, 15, 1.5); }
        x.fillStyle = '#f4f0e6'; x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        const g = x.createLinearGradient(wx, wy, wx + ww, wy + wh); g.addColorStop(0, '#6a8499'); g.addColorStop(.5, '#1d2a37'); g.addColorStop(1, '#3d5367');
        x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
        x.fillStyle = '#f4f0e6'; x.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); x.fillRect(wx, wy + wh * .38, ww, 3);
        if (Math.random() < .6) {
          x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(wx - 20, wy + wh + 4, ww + 40, 8);
          x.fillStyle = '#2a2a2a'; x.fillRect(wx - 20, wy + wh - 14, ww + 40, 2.5);
          for (let k = wx - 20; k <= wx + ww + 20; k += 5) x.fillRect(k, wy + wh - 14, 1.5, 17);
        }
      }
    }
  }));
  const walls = ['#efe1c6', '#f2d3bd', '#f5ecd9', '#e8c89a', '#e8d9d2', '#dcdcd4', '#f0c9a8'], shuts = ['#3d6b4f', '#4d7fa0', '#6b8e5a', '#b8a27a', '#3f5d73', '#8a4a3a'];
  const FAC = walls.map((w, i) => std({map: facade(w, shuts[i % shuts.length]), roughness: .88}));
  const ADS = [['RIVIERA RUSH', '#12284f', '#e3bd72'], ['GRAND PRIX', '#b3121d', '#ffffff'], ['HARBOUR · PORT', '#f4f4f4', '#12284f'], ['RIVIERA RUSH', '#0f6b4a', '#f4f4f4'], ['CÔTE D’AZUR', '#1c1c1c', '#f2c230']]
    .map(([t, bg, fg]) => std({roughness: .55, side: T.DoubleSide, map: ctex(cnv(512, 64, (x, w, h) => {
      x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = '800 46px "Saira Condensed", "Arial Narrow", sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, w / 2, h / 2 + 2);
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, h - 4, w, 4);
    }))}));
  const pT = c => { const t = ctex(c); t.repeat.set(1, 1); return t; };
  const M = {
    asphalt: std({map: pT(CAN.asphalt), roughness: .93}),
    rubber: std({map: rubT, transparent: true, depthWrite: false, roughness: .8, polygonOffset: true, polygonOffsetFactor: -2}),
    line: std({color: '#f1f1ec', roughness: .55, polygonOffset: true, polygonOffsetFactor: -3}),
    kerb: std({map: kerbT, roughness: .55, polygonOffset: true, polygonOffsetFactor: -4}),
    check: std({map: checkT, roughness: .6, polygonOffset: true, polygonOffsetFactor: -3}),
    paving: std({map: pT(CAN.paving), roughness: .85}),
    plaza: std({map: pT(CAN.paving), color: '#e2dccf', roughness: .9}),
    curb: std({color: '#c9c3b6', roughness: .8, side: T.DoubleSide}),
    quay: std({map: pT(CAN.paving), color: '#b8ab8e', roughness: .95, side: T.DoubleSide}),
    quayTop: std({color: '#e8dfcb', roughness: .7}),
    armco: std({color: '#c3cad1', metalness: .85, roughness: .32, side: T.DoubleSide}),
    post: std({color: '#4d535a', metalness: .6, roughness: .5}),
    fence: std({map: fenceT, alphaTest: .35, side: T.DoubleSide, metalness: .6, roughness: .45, transparent: false}),
    lamp: std({color: '#1f3029', metalness: .5, roughness: .5}),
    lampHead: std({color: '#f6f1dc', emissive: '#6a5a30', roughness: .4}),
    roofFlat: std({color: '#ddd4c2', roughness: .95}),
    roofTile: std({map: pT(CAN.roof), roughness: .8}),
    parapet: std({color: '#f3eee4', roughness: .8}),
    ac: std({color: '#b8bdc3', metalness: .4, roughness: .5}),
    pool: std({color: '#3fb8d6', roughness: .1, metalness: .1}),
    concrete: std({color: '#9aa0a6', roughness: .95}),
    canopy: std({color: '#f4f5f6', roughness: .5, side: T.DoubleSide}),
    person: std({roughness: .8}),
    skin: std({roughness: .7}),
    hullW: new T.MeshPhysicalMaterial({color: '#f7f8f9', roughness: .22, clearcoat: 1, clearcoatRoughness: .1}),
    hullD: new T.MeshPhysicalMaterial({color: '#18253d', roughness: .25, clearcoat: 1, clearcoatRoughness: .1}),
    white: std({color: '#f4f5f6', roughness: .35}),
    glass: std({color: '#15202b', metalness: .9, roughness: .06}),
    teak: std({map: teakT, roughness: .7}),
    cream: std({color: '#efe5cf', roughness: .8}),
    trunk: std({color: '#7a6048', roughness: .95}),
    frond: std({map: frondT, alphaTest: .45, side: T.DoubleSide, roughness: .7}),
    gantry: std({color: '#23262b', metalness: .5, roughness: .45}),
    pod: std({color: '#0c0d0f', roughness: .5}),
    carbon: std({color: '#16181b', metalness: .35, roughness: .42}),
    cockpit: std({color: '#070707', roughness: .8}),
    visor: std({color: '#0a0f14', metalness: .9, roughness: .1}),
    tyre: std({color: '#141414', roughness: .88}),
    rim: std({map: rimT, metalness: .7, roughness: .35}),
    compound: std({color: '#e8cf3a', roughness: .6}),
    tyreW: std({color: '#e9e9e9', roughness: .8}),
    tyreR: std({color: '#c9262a', roughness: .8}),
    block: std({map: blockT, roughness: .5}),
    tail: std({color: '#300', emissive: '#ff2020', emissiveIntensity: 2})
  };
  const scaleRep = (m, u, v) => { m.map.repeat.set(u, v); };
  const frondDepth = new T.MeshDepthMaterial({depthPacking: T.RGBADepthPacking, map: frondT, alphaTest: .45});
  const fenceDepth = new T.MeshDepthMaterial({depthPacking: T.RGBADepthPacking, map: fenceT, alphaTest: .35});

  /* sky, environment, lights */
  const skyC = cnv(4, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3f78bd'); g.addColorStop(.45, '#8db8de'); g.addColorStop(.62, '#d4e0e7'); g.addColorStop(1, '#d4e0e7'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  const skyT = new T.CanvasTexture(skyC); skyT.encoding = T.sRGBEncoding; scene.background = skyT;
  const SUN = new V(-.5, .66, -.56).normalize();
  {
    const es = new T.Scene(), eg = new T.SphereGeometry(10, 32, 16), cols = [], p = eg.attributes.position, top = new T.Color('#3f78bd'), hor = new T.Color('#dfe8ee'), gnd = new T.Color('#6d6a62'), c = new T.Color();
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 10; if (y > 0) c.copy(hor).lerp(top, Math.pow(y, .6)); else c.copy(hor).lerp(gnd, Math.min(1, -y * 4)); cols.push(c.r, c.g, c.b); }
    eg.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    es.add(new T.Mesh(eg, new T.MeshBasicMaterial({vertexColors: true, side: T.BackSide})));
    const sb = new T.Mesh(new T.SphereGeometry(.9, 12, 8), new T.MeshBasicMaterial({color: new T.Color(12, 11, 9)})); sb.position.copy(SUN).multiplyScalar(8); es.add(sb);
    const pm = new T.PMREMGenerator(R); scene.environment = pm.fromScene(es, .03).texture; pm.dispose();
  }
  scene.add(new T.HemisphereLight('#cfe2ff', '#8c8170', .35));
  const sun = new T.DirectionalLight('#fff0d8', 1.55);
  sun.castShadow = true; sun.shadow.mapSize.set(SMALL ? 1024 : 2048, SMALL ? 1024 : 2048);
  Object.assign(sun.shadow.camera, {left: -42, right: 42, top: 42, bottom: -42, near: 20, far: 320});
  sun.shadow.bias = -.0005; sun.shadow.normalBias = .04;
  scene.add(sun, sun.target);

  /* geometry helpers */
  const mkGeo = (pos, uv, idx) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  function flat(s0, s1, l0, l1, y, uL, vL, norm, st = 2) {
    const pos = [], uv = [], idx = [], v = new V(); let n = 0;
    for (let s = s0; ; s += st) {
      const ss = Math.min(s, s1);
      P3(ss, l0, y, v); pos.push(v.x, v.y, v.z); P3(ss, l1, y, v); pos.push(v.x, v.y, v.z);
      uv.push(norm ? 0 : l0 / uL, ss / vL, norm ? 1 : l1 / uL, ss / vL);
      if (n) { const a = (n - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      n++; if (ss >= s1) break;
    }
    return mkGeo(pos, uv, idx);
  }
  function wall(s0, s1, l, y0, y1, uL, vL, flip, st = 2) {
    const pos = [], uv = [], idx = [], v = new V(); let n = 0;
    for (let s = s0; ; s += st) {
      const ss = Math.min(s, s1), u = (flip ? -ss : ss) / uL;
      P3(ss, l, y0, v); pos.push(v.x, v.y, v.z); P3(ss, l, y1, v); pos.push(v.x, v.y, v.z);
      uv.push(u, y0 / vL, u, y1 / vL);
      if (n) { const a = (n - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      n++; if (ss >= s1) break;
    }
    return mkGeo(pos, uv, idx);
  }
  function merge(list) {
    const arr = list.map(g => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.normal) q.computeVertexNormals(); return q; });
    let n = 0; arr.forEach(g => n += g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
    for (const g of arr) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
    const m = new T.BufferGeometry(); m.setAttribute('position', new T.BufferAttribute(pos, 3)); m.setAttribute('normal', new T.BufferAttribute(nor, 3)); m.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return m;
  }
  const xf = (g, x, y, z, rx = 0, ry = 0, rz = 0) => g.applyMatrix4(new T.Matrix4().compose(new V(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new V(1, 1, 1)));
  function boxUV(w, h, d, uL) {
    const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / uL, uv.getY(i) * dims[f][1] / uL); }
    return g;
  }
  function hipRoof(w, d, h) {
    const g = new T.ConeGeometry(Math.SQRT1_2, 1, 4, 1); g.rotateY(Math.PI / 4); g.scale(w, h, d); g.translate(0, h / 2, 0);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) / 1.2, uv.getY(i) * Math.max(w, d) / 2.4);
    return g;
  }
  const sideEx = (pts, wd) => {
    const sh = new T.Shape(); pts.forEach(([z, y], i) => i ? sh.lineTo(-z, y) : sh.moveTo(-z, y));
    const g = new T.ExtrudeGeometry(sh, {depth: wd, bevelEnabled: true, bevelThickness: .045, bevelSize: .045, bevelSegments: 3, curveSegments: 6});
    g.rotateY(Math.PI / 2); g.translate(-wd / 2, 0, 0); return g;
  };
  const mirror = pts => [...pts, ...pts.slice(1, -1).reverse().map(([a, b]) => [-a, b])];
  const topEx = (pts, y0, h, bev = .05) => {
    const sh = new T.Shape(); pts.forEach(([x, z], i) => i ? sh.lineTo(x, z) : sh.moveTo(x, z));
    const g = new T.ExtrudeGeometry(sh, {depth: h, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 8});
    g.rotateX(Math.PI / 2); g.translate(0, y0 + h, 0); return g;
  };

  /* cars */
  function numTex(c) {
    return ctex(cnv(128, 128, x => { x.font = '800 96px "Saira Condensed", "Arial Narrow", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,.85)'; x.strokeText(c.num, 64, 70); x.fillStyle = '#fff'; x.fillText(c.num, 64, 70); }));
  }
  const tyreGeo = {}, rimGeo = {}, bandGeo = {};
  function makeCar(c) {
    const g = new T.Group();
    const paint = new T.MeshPhysicalMaterial({color: c.color, metalness: .35, roughness: .3, clearcoat: 1, clearcoatRoughness: .07});
    const stripe = new T.MeshPhysicalMaterial({color: c.stripe, metalness: .15, roughness: .35, clearcoat: 1, clearcoatRoughness: .1});
    const helm = new T.MeshPhysicalMaterial({color: c.helmet, roughness: .25, clearcoat: 1});
    const num = new T.MeshStandardMaterial({map: numTex(c), transparent: true, depthWrite: false, roughness: .4, polygonOffset: true, polygonOffsetFactor: -4});
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
    add(topEx(mirror([[0, -1.05], [.55, -.98], [.95, -.5], [.95, 1.4], [.62, 1.95], [0, 2.05]]), .04, .03, .02), M.carbon);
    add(sideEx([[-2.62, .2], [-2.62, .28], [-1.9, .38], [-1.0, .55], [-.85, .56], [-.85, .2]], .26), paint);
    add(sideEx([[-1.0, .17], [-1.0, .53], [-.7, .62], [.1, .62], [.1, .17]], .6), paint);
    add(topEx(mirror([[0, -.52], [.78, -.4], [.84, .1], [.76, .7], [.44, 1.3], [0, 1.5]]), .14, .34, .07), paint);
    add(sideEx([[-.05, .17], [-.05, .92], [.2, 1.0], [.55, .9], [1.4, .6], [2.15, .42], [2.15, .17]], .44), paint);
    add(new T.BoxGeometry(.1, .012, 1.55), stripe, 0, .455, -1.78, -.16);
    add(new T.PlaneGeometry(.36, .36), num, 0, .52, -1.3, -Math.PI / 2 - .16).castShadow = false;
    for (const sd of [-1, 1]) add(new T.PlaneGeometry(.42, .42), num, sd * .275, .66, .95, 0, sd * Math.PI / 2).castShadow = false;
    add(new T.BoxGeometry(.2, .01, .9), stripe, 0, .81, .55, .28);
    add(new T.BoxGeometry(.44, .06, .72), M.cockpit, 0, .64, -.33);
    add(new T.SphereGeometry(.15, 20, 14), helm, 0, .77, -.33);
    add(new T.BoxGeometry(.2, .055, .06), M.visor, 0, .79, -.47);
    const halo = add(new T.TorusGeometry(.33, .032, 8, 28), M.carbon, 0, .86, -.36, Math.PI / 2); halo.scale.set(1, 1.25, 1);
    add(new T.CylinderGeometry(.03, .03, .42, 8), M.carbon, 0, .73, -.9, .82);
    add(new T.BoxGeometry(.18, .14, .04), M.cockpit, 0, .9, -.08);
    add(new T.BoxGeometry(.02, .24, 1.25), paint, 0, .88, 1.05);
    for (const sd of [-1, 1]) {
      add(new T.BoxGeometry(.14, .06, .04), paint, sd * .47, .64, -.72);
      add(new T.BoxGeometry(.3, .2, .03), M.cockpit, sd * .5, .38, -.54);
      add(new T.BoxGeometry(.035, .26, .55), stripe, sd * .95, .17, -2.6);
      add(new T.BoxGeometry(.035, .6, .62), stripe, sd * .51, .8, 2.34);
    }
    add(new T.BoxGeometry(1.9, .035, .42), M.carbon, 0, .1, -2.62);
    add(new T.BoxGeometry(1.84, .03, .17), paint, 0, .18, -2.52, -.25);
    add(new T.BoxGeometry(1.02, .035, .34), M.carbon, 0, .95, 2.33);
    add(new T.BoxGeometry(1.0, .03, .17), paint, 0, 1.05, 2.42, .35);
    add(new T.BoxGeometry(.05, .55, .1), M.carbon, 0, .66, 2.25);
    add(new T.BoxGeometry(.9, .18, .4), M.carbon, 0, .18, 2.12);
    add(new T.BoxGeometry(.1, .05, .02), M.tail, 0, .45, 2.22);
    const wheels = [];
    for (const [z, r, w] of [[-1.6, .35, .36], [1.72, .37, .44]]) for (const sd of [-1, 1]) {
      const k = r + '_' + w;
      tyreGeo[k] = tyreGeo[k] || new T.CylinderGeometry(r, r, w, 32, 1).rotateZ(Math.PI / 2);
      rimGeo[k] = rimGeo[k] || new T.CylinderGeometry(r * .64, r * .64, w + .012, 24).rotateZ(Math.PI / 2);
      bandGeo[k] = bandGeo[k] || new T.TorusGeometry(r * .84, .014, 6, 36).rotateY(Math.PI / 2);
      const wg = new T.Group(); wg.position.set(sd * (.58 + w / 2), r, z);
      const ty = new T.Mesh(tyreGeo[k], M.tyre); ty.castShadow = true; wg.add(ty);
      wg.add(new T.Mesh(rimGeo[k], M.rim));
      const b = new T.Mesh(bandGeo[k], M.compound); b.position.x = sd * (w / 2 + .004); wg.add(b);
      g.add(wg); wheels.push(wg);
      for (const [dy, dz] of [[.3, -.07], [.4, .07]]) add(new T.BoxGeometry(.55, .025, .05), M.carbon, sd * .5, dy, z + dz);
    }
    const ring = new T.Mesh(new T.RingGeometry(1, 1.22, 56).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({color: c.color, transparent: true, opacity: .55, depthWrite: false, toneMapped: false}));
    ring.scale.set(1.35, 1, 2.75); ring.position.y = .03; ring.visible = false; g.add(ring);
    g.userData = {wheels, ring};
    scene.add(g);
    return g;
  }
  const car3 = CARS.map(makeCar);

  /* props */
  function makePalm(h) {
    const g = new T.Group(), lean = (Math.random() - .5) * 1.4;
    const curve = new T.CatmullRomCurve3([new V(0, 0, 0), new V(lean * .3, h * .35, .1), new V(lean * .7, h * .7, .15), new V(lean, h, .1)]);
    const tr = new T.Mesh(new T.TubeGeometry(curve, 14, .19, 7, false), M.trunk); tr.castShadow = true; g.add(tr);
    const top = curve.getPoint(1), n = 11, list = [];
    for (let k = 0; k < n; k++) {
      const p = new T.PlaneGeometry(4.2, 1.1, 10, 1); p.translate(2.1, 0, 0); p.rotateX(-Math.PI / 2);
      const pa = p.attributes.position, droop = .1 + Math.random() * .06;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); pa.setY(i, pa.getY(i) + .35 * x - droop * x * x); }
      xf(p, top.x, top.y, top.z, 0, k / n * TAU + Math.random() * .3, 0);
      list.push(p);
    }
    const fm = new T.Mesh(merge(list), M.frond); fm.castShadow = true; fm.customDepthMaterial = frondDepth; g.add(fm);
    const nut = new T.Mesh(new T.SphereGeometry(.28, 10, 8), M.trunk); nut.position.copy(top).y -= .2; g.add(nut);
    return g;
  }
  const PALMS3 = [9, 10.5, 12, 11].map(makePalm);
  function makeYacht(len, dark) {
    const beam = len * .24, hh = Math.max(1.6, len * .075), g = new T.Group();
    const sh = new T.Shape(), L2 = len / 2, B2 = beam / 2;
    sh.moveTo(L2, -B2 * .86); sh.quadraticCurveTo(L2, -B2, L2 - .5, -B2); sh.lineTo(-len * .12, -B2);
    sh.quadraticCurveTo(-len * .38, -B2 * .94, -L2, 0); sh.quadraticCurveTo(-len * .38, B2 * .94, -len * .12, B2);
    sh.lineTo(L2 - .5, B2); sh.quadraticCurveTo(L2, B2, L2, B2 * .86);
    const hull = new T.ExtrudeGeometry(sh, {depth: hh, bevelEnabled: true, bevelThickness: .12, bevelSize: .12, bevelSegments: 2, curveSegments: 10});
    hull.rotateX(-Math.PI / 2); hull.translate(0, -.8, 0);
    const hm = new T.Mesh(hull, dark ? M.hullD : M.hullW); hm.castShadow = true; hm.receiveShadow = true; g.add(hm);
    const deck = new T.ShapeGeometry(sh, 10); deck.rotateX(-Math.PI / 2);
    const uv = deck.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    const dm = new T.Mesh(deck, M.teak); dm.scale.set(.93, 1, .86); dm.position.y = hh - .8 + .13; dm.receiveShadow = true; g.add(dm);
    const top = hh - .8 + .13, box = (w, h, d, m, x, y, z) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
    box(len * .44, 1.9, beam * .66, M.white, len * .04, top + .95, 0);
    box(len * .45, .8, beam * .7, M.glass, len * .04, top + 1.15, 0);
    box(len * .27, 1.5, beam * .56, M.white, len * .06, top + 1.9 + .75, 0);
    box(len * .28, .55, beam * .6, M.glass, len * .06, top + 1.9 + .8, 0);
    box(len * .3, .08, beam * .62, M.white, len * .06, top + 3.45, 0);
    box(len * .12, .28, beam * .46, M.cream, -len * .28, top + .14, 0);
    box(len * .08, .5, beam * .5, M.cream, len * .38, top + .25, 0);
    if (len > 26) { const r = box(.35, 1.1, beam * .45, M.white, len * .12, top + 4, 0); r.rotation.z = .3; }
    g.userData = {len, beam};
    return g;
  }
  const YP = [[30, 0], [22, 0], [26, 1], [18, 0], [34, 0], [24, 1]].map(([l, d]) => makeYacht(l, d));
  const G = {
    post: new T.BoxGeometry(.12, .6, .12), fpost: new T.CylinderGeometry(.05, .05, 4.4, 6), pole: new T.CylinderGeometry(.07, .1, 7, 8),
    head: new T.BoxGeometry(.9, .2, .35), body: new T.CapsuleGeometry(.21, .85, 3, 8), headS: new T.SphereGeometry(.13, 8, 6),
    ac: new T.BoxGeometry(1.2, .8, 1), col: new T.CylinderGeometry(.15, .15, 1, 8)
  };
  const SHIRTS = ['#d64545', '#3b6fd1', '#f2efe6', '#2e8b57', '#e0a030', '#222222', '#f28cb1', '#7a4fd0', '#f5f5f5', '#c62828'].map(c => new T.Color(c));
  const SKIN = ['#e7c29b', '#c69468', '#8d5a3b', '#f1d2b5', '#3b2a1c'].map(c => new T.Color(c));

  /* static start area */
  const startG = new T.Group(); scene.add(startG);
  const gLights = [];
  {
    const add = (geo, mat) => { const m = new T.Mesh(geo, mat); m.receiveShadow = true; startG.add(m); return m; };
    add(flat(12.6, 13.5, -HWm, HWm, .012, 1, .9, true), M.check);
    [0, 3.2, -2.4].forEach((ld, i) => {
      const s = ld + 3.1, l = (i - 1) * LG;
      add(flat(s, s + .16, l - 1.25, l + 1.25, .012, 1, 1, false, .16), M.line);
      for (const sd of [-1, 1]) add(flat(s - 1.3, s + .16, l + sd * 1.25 - .07, l + sd * 1.25 + .07, .012, 1, 1, false, .3), M.line);
    });
    const gan = new T.Group(), puffT = new T.CanvasTexture(puff('255,255,255'));
    for (const sd of [-1, 1]) { const p = new T.Mesh(new T.BoxGeometry(.5, 5.8, .5), M.gantry); p.position.set(sd * 8.6, 3.05, 0); p.castShadow = true; gan.add(p); }
    const beam = new T.Mesh(new T.BoxGeometry(17.7, .7, .6), M.gantry); beam.position.y = 5.3; beam.castShadow = true; gan.add(beam);
    for (let k = 0; k < 5; k++) {
      const pod = new T.Mesh(new T.BoxGeometry(.64, .74, .3), M.pod); pod.position.set((k - 2) * .9, 5.3, .42); gan.add(pod);
      const lm = new T.MeshStandardMaterial({color: '#2a0b08', emissive: '#ff2a14', emissiveIntensity: 0, roughness: .3});
      for (const dy of [.16, -.16]) { const b = new T.Mesh(new T.SphereGeometry(.12, 12, 8), lm); b.position.set((k - 2) * .9, 5.3 + dy, .58); gan.add(b); }
      const gl = new T.Sprite(new T.SpriteMaterial({map: puffT, color: '#ff3a1c', transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false}));
      gl.position.set((k - 2) * .9, 5.3, .8); gl.scale.set(2, 2, 1); gan.add(gl);
      gLights.push({lm, gl});
    }
    place(gan, 16, 0); startG.add(gan);
  }

  /* far scenery follows the camera */
  const far = new T.Group(); scene.add(far);
  const water = new T.Mesh(new T.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), std({color: '#0d4660', roughness: .07, metalness: .15, normalMap: waterN, normalScale: new T.Vector2(.7, .7)}));
  waterN.repeat.set(400, 400); water.receiveShadow = true; scene.add(water);
  const land = new T.Mesh(new T.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), std({color: '#b4aa96', roughness: 1}));
  scene.add(land);
  {
    const hillMat = new T.MeshStandardMaterial({color: '#7f9290', roughness: 1, flatShading: true, fog: false});
    const HILLS = [[520, -700, 330, 230], [860, -980, 380, 300], [300, -1150, 300, 210], [1150, -620, 380, 220], [-900, -1500, 360, 160], [60, -1500, 320, 200]];
    const hb = new T.BoxGeometry(1, 1, 1), hm = new T.InstancedMesh(hb, new T.MeshStandardMaterial({roughness: .9, fog: false}), 1100), m4 = new T.Matrix4(), q = new T.Quaternion(), cl = new T.Color();
    let n = 0;
    const hues = ['#e4dccb', '#efe6d4', '#dccfb8', '#e8d8c8', '#d2cfc6'];
    for (const [x, z, r, h] of HILLS) {
      const geo = new T.ConeGeometry(r, h, 14, 6), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i), py = p.getY(i), pz = p.getZ(i); if (py > h / 2 - 1) continue;
        const f = .82 + .34 * rnd(Math.round(px * 10) * 31 + Math.round(pz * 10) * 17 + Math.round(py * 10) * 7);
        p.setX(i, px * f); p.setZ(i, pz * f); p.setY(i, py + (f - 1) * h * .15);
      }
      geo.computeVertexNormals();
      const m = new T.Mesh(geo, hillMat); m.position.set(x, h / 2 - 3, z); far.add(m);
      if (x > 0) for (let j = 0; j < 180 && n < 1100; j++, n++) {
        const t = Math.pow(Math.random(), .7) * .7, rr = r * (1 - t) * .96, th = Math.PI * (.45 + Math.random() * .7);
        const w = 7 + Math.random() * 9, hh = 5 + Math.random() * 16;
        m4.compose(new V(x + Math.cos(th) * rr, t * h - 3 + hh / 2, z + Math.sin(th) * rr), q.setFromEuler(new T.Euler(0, Math.random() * 3, 0)), new V(w, hh, w * (.7 + Math.random() * .6)));
        hm.setMatrixAt(n, m4); hm.setColorAt(n, cl.set(hues[j % hues.length]).lerp(new T.Color('#9fb0b8'), .25));
      }
    }
    hm.count = n; far.add(hm);
  }

  /* track chunks */
  const chunks = new Map();
  function buildChunk(k) {
    const g = new T.Group(), s0 = k * C, s1 = s0 + C, disp = [], insts = [], yachts = [];
    const Rn = n => rnd(k * 97.13 + n * 1.371 + 11);
    const add = (geo, mat, cs = false, rs = true) => { const m = new T.Mesh(geo, mat); m.castShadow = cs; m.receiveShadow = rs; disp.push(geo); g.add(m); return m; };
    const inst = (geo, mat, list, cs = true) => {
      if (!list.length) return;
      const im = new T.InstancedMesh(geo, mat, list.length), m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), sc = new V();
      list.forEach((o, i) => { e.set(0, o.ry || 0, 0); sc.set(o.sx || 1, o.sy || 1, o.sz || 1); m4.compose(o.p, q.setFromEuler(e), sc); im.setMatrixAt(i, m4); if (o.c) im.setColorAt(i, o.c); });
      im.castShadow = cs; im.receiveShadow = true; g.add(im); insts.push(im);
    };
    add(flat(s0, s1, -8, 8, 0, 3.5, 3.5), M.asphalt);
    add(flat(s0, s1, -HWm, HWm, .006, 1, 9, true), M.rubber);
    add(flat(s0, s1, -HWm + .18, -HWm + .4, .01, 1, 1), M.line);
    add(flat(s0, s1, HWm - .4, HWm - .18, .01, 1, 1), M.line);
    let ks = null;
    for (let s = s0; s <= s1; s += 1) {
      const b = XR2(s), side = b > .0021 ? 1 : b < -.0021 ? -1 : 0;
      if (ks && (side !== ks.side || s >= s1)) { if (s - ks.a > .6) add(flat(ks.a, s, ks.side > 0 ? HWm : -HWm - .95, ks.side > 0 ? HWm + .95 : -HWm, .02, 1, 2.4, false, 1), M.kerb); ks = null; }
      if (side && !ks && s < s1) ks = {a: s, side};
    }
    add(flat(s0, s1, -12, -8, .15, 3, 3), M.paving);
    add(flat(s0, s1, 8, 12, .15, 3, 3), M.paving);
    add(flat(s0, s1, 12, 96, .15, 5, 5, false, 5), M.plaza);
    add(flat(s0, s1, -12.4, -12, .17, 1, 1), M.quayTop);
    add(wall(s0, s1, -8, 0, .15, 1, 1), M.curb);
    add(wall(s0, s1, 8, 0, .15, 1, 1), M.curb);
    add(wall(s0, s1, -12.4, -1.6, .17, 3, 3), M.quay);
    const posts = [], fposts = [], poles = [], heads = [], bodies = [], hd = [];
    for (const sd of [-1, 1]) {
      add(wall(s0, s1, sd * 7.35, .3, .78, 1, 1), M.armco, true);
      add(wall(s0, s1, sd * 7.85, 1.0, 4.4, .9, .9), M.fence, true, false).customDepthMaterial = fenceDepth;
      add(wall(s0, s1, sd * 7.86, 0, 1.0, 7.6, 1, sd > 0), ADS[Math.floor(Rn(sd + 3) * ADS.length)]);
      for (let s = Math.ceil(s0 / 4) * 4; s < s1; s += 4) posts.push({p: P3(s, sd * 7.42, .3), ry: HEAD(s)});
      for (let s = Math.ceil(s0 / 5) * 5; s < s1; s += 5) fposts.push({p: P3(s, sd * 7.9, 2.2)});
      for (let s = Math.ceil(s0 / 25) * 25; s < s1; s += 25) { poles.push({p: P3(s, sd * 8.5, 3.65)}); heads.push({p: P3(s, sd * 8.1, 7.1), ry: HEAD(s)}); }
      for (let s = s0 + Rn(sd * 7) * 8; s < s1 - 1; s += 11 + Rn(s) * 8) {
        const pl = PALMS3[Math.floor(Rn(s * 3.1 + sd) * PALMS3.length)].clone(); place(pl, s, sd * 10.6, .15); pl.rotation.y += Rn(s * 1.7) * TAU; g.add(pl);
      }
      const np = SMALL ? 10 : 22;
      for (let j = 0; j < np; j++) {
        const s = s0 + Rn(j * 3.3 + sd) * C, l = sd * (8.3 + Rn(j * 5.1 + sd) * 3.4);
        bodies.push({p: P3(s, l, .15 + .21 + .425), c: SHIRTS[Math.floor(Rn(j * 7.7 + sd) * SHIRTS.length)]});
        hd.push({p: P3(s, l, .15 + 1.62), c: SKIN[Math.floor(Rn(j * 2.9 + sd) * SKIN.length)]});
      }
    }
    inst(G.post, M.post, posts); inst(G.fpost, M.post, fposts); inst(G.pole, M.lamp, poles); inst(G.head, M.lampHead, heads, false);
    const acs = [];
    function building(sm, lm, w, d, h, id) {
      const mat = FAC[Math.floor(Rn(80 + id) * FAC.length)], grp = new T.Group();
      const box = new T.Mesh(boxUV(d, h, w, 6), [mat, mat, M.roofFlat, M.roofFlat, mat, mat]); disp.push(box.geometry);
      box.position.y = h / 2 + .15; box.castShadow = box.receiveShadow = true; grp.add(box);
      if (Rn(90 + id) < .45) {
        const rf = new T.Mesh(hipRoof(d + .7, w + .7, 1.4 + Math.min(d, w) * .12), M.roofTile); rf.position.y = h + .15; rf.castShadow = rf.receiveShadow = true; grp.add(rf); disp.push(rf.geometry);
      } else {
        const p = new T.Mesh(new T.BoxGeometry(d + .35, .4, w + .35), M.parapet); p.position.y = h + .15; p.castShadow = true; grp.add(p); disp.push(p.geometry);
        for (let a = 0; a < 2; a++) acs.push({p: P3(sm + (Rn(id + a) - .5) * w * .6, lm + (Rn(id * 2 + a) - .5) * d * .5, h + .15 + .6)});
        if (Rn(95 + id) < .35) { const pool = new T.Mesh(new T.BoxGeometry(d * .4, .2, w * .45), M.pool); pool.position.set(d * .1, h + .3, 0); grp.add(pool); disp.push(pool.geometry); }
      }
      if (id < 100) {
        const aw = new T.Mesh(new T.BoxGeometry(1.3, .08, w * .86), AWN[Math.floor(Rn(99 + id) * AWN.length)]);
        aw.position.set(-d / 2 - .6, 3.4, 0); aw.rotation.z = -.22; aw.castShadow = true; grp.add(aw); disp.push(aw.geometry);
      }
      place(grp, sm, lm); g.add(grp);
    }
    function stand(sa, sb) {
      const len = sb - sa, grp = new T.Group(), rows = 10, crowd = [], heads2 = [];
      for (let r = 0; r < rows; r++) {
        const st = new T.Mesh(new T.BoxGeometry(.9, .45 * (r + 1), len), M.concrete); st.position.set(r * .9 + .45, .45 * (r + 1) / 2 + .15, 0); st.castShadow = st.receiveShadow = true; grp.add(st); disp.push(st.geometry);
        for (let z = -len / 2 + .4; z < len / 2 - .3; z += .55) {
          if (Math.random() < .1) continue;
          crowd.push({p: new V(r * .9 + .45, .45 * (r + 1) + .15 + .5, z + (Math.random() - .5) * .12), c: SHIRTS[Math.floor(Math.random() * SHIRTS.length)], sy: .8});
          heads2.push({p: new V(r * .9 + .45, .45 * (r + 1) + .15 + 1.12, z), c: SKIN[Math.floor(Math.random() * SKIN.length)]});
        }
      }
      const cm = new T.InstancedMesh(G.body, M.person, crowd.length), hm = new T.InstancedMesh(G.headS, M.skin, heads2.length), m4 = new T.Matrix4(), q = new T.Quaternion(), s1v = new V(1, 1, 1), s2v = new V(1, .8, 1);
      crowd.forEach((o, i) => { cm.setMatrixAt(i, m4.compose(o.p, q, s2v)); cm.setColorAt(i, o.c); });
      heads2.forEach((o, i) => { hm.setMatrixAt(i, m4.compose(o.p, q, s1v)); hm.setColorAt(i, o.c); });
      cm.castShadow = true; grp.add(cm, hm); insts.push(cm, hm);
      const roof = new T.Mesh(new T.BoxGeometry(rows * .9 + 1.5, .15, len + 1), M.canopy); roof.position.set(rows * .9 / 2 + .4, .45 * rows + 3.6, 0); roof.castShadow = true; grp.add(roof); disp.push(roof.geometry);
      for (let z = -len / 2; z <= len / 2 + .1; z += len / Math.ceil(len / 9)) { const c = new T.Mesh(G.col, M.post); c.scale.y = .45 * rows + 3.6; c.position.set(rows * .9 + .3, (.45 * rows + 3.6) / 2 + .15, z); grp.add(c); }
      place(grp, (sa + sb) / 2, 12.7); g.add(grp);
    }
    let s = s0 + Rn(1) * 3, bi = 0;
    while (s < s1 - 4) {
      bi++;
      if (Rn(10 + bi) < .17 && s1 - s > 20) { const len = Math.min(34, s1 - s - 1); stand(s, s + len); s += len + 2; continue; }
      const w = Math.min(9 + Rn(20 + bi) * 10, s1 - s - .5); if (w < 5) break;
      const d = 11 + Rn(30 + bi) * 8, h = (3 + Math.floor(Rn(40 + bi) * 7)) * 3 + .6;
      building(s + w / 2, 13 + d / 2, w, d, h, bi);
      const d2 = 14 + Rn(50 + bi) * 10, h2 = (6 + Math.floor(Rn(60 + bi) * 11)) * 3;
      building(s + w / 2, 13 + d + 4 + d2 / 2, w, d2, h2, bi + 100);
      if (!SMALL && Rn(70 + bi) < .5) building(s + w / 2, 13 + d + d2 + 10 + 9, w, 18, (10 + Math.floor(Rn(75 + bi) * 12)) * 3, bi + 200);
      s += w + 1.5 + Rn(78 + bi) * 2.5;
    }
    inst(G.ac, M.ac, acs);
    inst(G.body, M.person, bodies); inst(G.headS, M.skin, hd, false);
    let ys = s0 + Rn(200) * 4, yi = 0;
    while (ys < s1 - 3) {
      yi++;
      const pr = YP[Math.floor(Rn(210 + yi) * YP.length)], y = pr.clone(), {len, beam} = pr.userData;
      place(y, ys + beam / 2, -12.6 - len / 2, -1); y.userData = {ph: Rn(220 + yi) * 6};
      g.add(y); yachts.push(y);
      ys += beam + 1.4 + Rn(230 + yi) * 2;
    }
    scene.add(g);
    return {g, disp, insts, yachts};
  }
  function dropChunk(k) {
    const c = chunks.get(k); scene.remove(c.g);
    c.disp.forEach(x => x.dispose()); c.insts.forEach(i => i.dispose && i.dispose());
    chunks.delete(k);
  }

  /* obstacles and particles */
  const obst = new Map();
  function obstacle(r) {
    const g = new T.Group();
    if (r.kind === 'tyres' || r.kind === 'tires') {
      const tg = new T.TorusGeometry(.3, .13, 8, 18).rotateX(Math.PI / 2);
      for (const [x, z] of [[-.5, 0], [.5, .1], [0, -.75]]) for (let k = 0; k < 3; k++) {
        const m = new T.Mesh(tg, k === 2 ? (x > 0 ? M.tyreR : M.tyreW) : M.tyre); m.position.set(x, .13 + k * .26, z); m.castShadow = true; g.add(m);
      }
    } else {
      const m = new T.Mesh(new T.BoxGeometry(2.3, .8, .6), M.block); m.position.y = .4; m.castShadow = true; g.add(m);
      g.userData.yaw = .2;
    }
    scene.add(g); return g;
  }
  const puffTex = new T.CanvasTexture(puff('255,255,255'));
  const sqTex = new T.CanvasTexture(cnv(8, 8, x => { x.fillStyle = '#fff'; x.fillRect(0, 0, 8, 8); }));
  const pool = [], bits = [];
  for (let k = 0; k < (SMALL ? 90 : 160); k++) { const sp = new T.Sprite(new T.SpriteMaterial({map: puffTex, transparent: true, depthWrite: false})); sp.visible = false; scene.add(sp); pool.push(sp); }
  for (let k = 0; k < 70; k++) { const sp = new T.Sprite(new T.SpriteMaterial({map: sqTex, transparent: true, depthWrite: false, toneMapped: false})); sp.visible = false; scene.add(sp); bits.push(sp); }

  const tmp = new V();
  function render(now, dt) {
    ({W, H, Sc, laneGap} = api.dims());
    const u = U(), k = kL(), camS = S.cam / u, aspect = W / H;
    const kA = Math.floor((camS - 30) / C), kB = Math.floor((camS + (SMALL ? 330 : 480)) / C);
    for (const key of [...chunks.keys()]) if (key < kA || key > kB) dropChunk(key);
    let built = 0;
    for (let key = kA; key <= kB; key++) if (!chunks.has(key) && (built++ < 2 || key < kA + 3)) chunks.set(key, buildChunk(key));
    const mine = api.mine();
    S.cars.forEach(c => {
      const g = car3[c.i], s = visD(c, now) / u, l = (c.i - 1) * LG + c.drift * k;
      place(g, s, l, S.phase === 'bet' ? Math.sin(now / 35 + c.i * 2) * .004 : 0);
      g.rotation.y -= c.spin;
      const w = c.v / u / .36 * dt; g.userData.wheels.forEach(wh => wh.rotation.x -= w);
      const rg = g.userData.ring; rg.visible = c.i === mine && !c.ended;
      if (rg.visible) rg.material.opacity = .35 + .2 * Math.sin(now / 250);
    });
    for (const [r, m] of obst) if (!rocks.includes(r)) { scene.remove(m); obst.delete(r); }
    for (const r of rocks) { if (!obst.has(r)) obst.set(r, obstacle(r)); const m = obst.get(r); place(m, r.d / u, (r.i - 1) * LG); m.rotation.y += m.userData.yaw || 0; }
    let pi = 0, bi = 0;
    for (const p of parts) {
      if (p.k === 'skid') continue;
      const s = p.d / u, l = (p.x - cx(p.d)) * k, a = 1 - p.life / p.max, al = Math.max(0, p.life / p.max) * p.a;
      if (p.k === 'dust' || p.k === 'smoke') {
        if (pi >= pool.length) continue; const sp = pool[pi++]; sp.visible = true;
        P3(s, l, p.k === 'smoke' ? .7 + a * 2.8 : .3 + a * .9, sp.position);
        const sz = p.r / u * (p.k === 'smoke' ? 1.5 : 1.4); sp.scale.set(sz, sz, 1);
        sp.material.opacity = Math.min(1, al * (p.k === 'smoke' ? .9 : 1.2)); sp.material.color.set(p.k === 'smoke' ? (p.a > .5 ? '#8a8a88' : '#4f4f4e') : '#d6d6d2');
      } else {
        if (bi >= bits.length) continue; const sp = bits[bi++]; sp.visible = true;
        P3(s, l, p.k === 'spark' ? .3 + a * .8 : Math.max(.06, .15 + 6 * a * (1 - a)), sp.position);
        const sz = p.k === 'spark' ? .09 : Math.min(.22, p.r / u * .2); sp.scale.set(sz, sz, 1);
        sp.material.color.set(p.k === 'spark' ? '#ffcf70' : p.col); sp.material.opacity = Math.min(1, al * 1.5);
      }
    }
    for (; pi < pool.length; pi++) pool[pi].visible = false;
    for (; bi < bits.length; bi++) bits[bi].visible = false;
    let lit = 0;
    if (S.phase === 'bet') { const rem = api.betRemaining(); lit = rem <= 5000 ? Math.min(5, Math.floor((5000 - rem) / 1000) + 1) : 0; }
    gLights.forEach((o, i) => { o.lm.emissiveIntensity = i < lit ? 4 : 0; o.gl.material.opacity = i < lit ? .9 : 0; });
    const t = now / 1000;
    for (const ch of chunks.values()) for (const y of ch.yachts) { y.position.y = -1 + Math.sin(t * .9 + y.userData.ph) * .06; y.rotation.x = Math.sin(t * .7 + y.userData.ph) * .012; }
    const back = 12.5 * Math.max(1, 1.35 / aspect), hgt = 5.3 * Math.max(1, 1.15 / aspect), sh = REDUCE ? 0 : S.shake * .012;
    const cs = camS - back, la = camS + 22;
    cam.position.set(XR(cs) + (Math.random() - .5) * sh, hgt + (Math.random() - .5) * sh, -cs);
    cam.lookAt(XR(la), .6, -la);
    const fx = XR(camS), fz = -camS;
    far.position.set(fx, 0, fz);
    water.position.set(fx, -1, fz); water.material.normalMap.offset.set(fx / 10 + t * .006, -fz / 10 + t * .004);
    land.position.set(fx + 1590, .09, fz);
    P3(camS + 12, 0, 0, tmp); sun.target.position.copy(tmp); sun.position.copy(tmp).addScaledVector(SUN, 150); sun.target.updateMatrixWorld();
    R.render(scene, cam);
  }
  function resize3(w, h) {
    ({W, H, Sc, laneGap} = api.dims()); R.setPixelRatio(Math.min(1.75, devicePixelRatio || 1)); R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  function project(c, now) {
    const s = visD(c, now) / U(), l = (c.i - 1) * LG + c.drift * kL();
    P3(s, l, 1.7, tmp).project(cam);
    if (tmp.z > 1) return null;
    return {x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H};
  }
  // ეკრანის წერტილში (CSS px) რომელი ბოლიდია: ჯერ სხივით მოდელზე, მერე უახლოეს ცენტრზე
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  function pick(x, y, now) {
    ({W, H, Sc, laneGap} = api.dims());
    ndc.set(x / W * 2 - 1, 1 - y / H * 2);
    ray.setFromCamera(ndc, cam);
    for (const h of ray.intersectObjects(car3, true)) {
      let o = h.object; while (o && !car3.includes(o)) o = o.parent;
      if (o) return car3.indexOf(o);
    }
    let best = -1, bd = Math.max(40, 60 * Sc) ** 2;
    for (const c of S.cars) {
      const s = visD(c, now) / U(), l = (c.i - 1) * LG + c.drift * kL();
      P3(s, l, .6, tmp).project(cam);
      if (tmp.z > 1) continue;
      const dx = (tmp.x + 1) / 2 * W - x, dy = (1 - tmp.y) / 2 * H - y, q = dx * dx + dy * dy;
      if (q < bd) { bd = q; best = c.i; }
    }
    return best;
  }
  return {render, resize: resize3, project, pick};
}
