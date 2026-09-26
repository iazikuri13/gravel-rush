// Riviera Rush — ადმინი. მონაცემები /admin/api/*-დან; თანხები ცენტებშია.
(() => {
  const $ = s => document.querySelector(s);
  const CARS = [{ name: 'ფალკონი', c: 'var(--car0)' }, { name: 'ტალღა', c: 'var(--car1)' }, { name: 'კრაზანა', c: 'var(--car2)' }];
  const TYPE_LABEL = {
    bet: ['ფსონი', 't-bet'], win: ['მოგება', 't-win'], lose: ['წაგება', 't-lose'], cancel: ['გაუქმება', 't-cancel'], refund: ['დაბრუნება', 't-refund'],
    refill: ['შევსება', 't-acc'], admin_adjust: ['ადმინი: ბალანსი', 't-acc'], create: ['ანგარიში', 't-acc'], create_ext: ['კაზინოს ანგარიში', 't-acc'],
    ext_win: ['კაზინო: WIN', 't-ext'], ext_rollback: ['კაზინო: ROLLBACK', 't-ext'], ext_bet: ['კაზინო: BET', 't-ext'], ext_rejected: ['კაზინომ უარყო', 't-lose']
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = c => (c == null ? '—' : (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
  const signed = c => (c > 0 ? '+' : c < 0 ? '−' : '') + money(Math.abs(c));
  const pct = x => (x == null ? '—' : (x * 100).toFixed(2) + '%');
  const x100 = m => (m / 100).toFixed(2);
  const time = ts => { if (!ts) return '—'; const d = new Date(ts); return d.toLocaleString('en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''); };
  const ago = sec => sec < 60 ? `${sec} წმ` : sec < 3600 ? `${Math.floor(sec / 60)} წთ` : sec < 86400 ? `${Math.floor(sec / 3600)} სთ ${Math.floor(sec % 3600 / 60)} წთ` : `${Math.floor(sec / 86400)} დღე`;
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  async function api(path, body) {
    const r = await fetch('/admin/api' + path, body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') { showLogin(); throw new Error(d.error || 'შესვლა საჭიროა'); }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  // ---------- შესვლა ----------
  function showLogin() { $('#shell').hidden = true; $('#login').hidden = false; $('#pw').focus(); stopAuto(); }
  function showApp() { $('#login').hidden = true; $('#shell').hidden = false; go(store.get('adm_tab') || 'overview'); }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').textContent = '';
    try { await api('/login', { password: $('#pw').value }); $('#pw').value = ''; showApp(); }
    catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', async () => { await api('/logout', {}).catch(() => {}); showLogin(); });

  // ---------- ნავიგაცია ----------
  const TITLES = { overview: 'მიმოხილვა', rounds: 'რბოლები', bets: 'ფსონები', players: 'მოთამაშეები', integrations: 'ინტეგრაციები', system: 'სისტემა' };
  let tab = 'overview', timer = null;
  function go(t) {
    if (!TITLES[t]) t = 'overview';
    tab = t; store.set('adm_tab', t);
    document.querySelectorAll('#tabs button').forEach(b => (b.dataset.tab === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    document.querySelectorAll('.page').forEach(p => { p.hidden = p.dataset.page !== t; });
    $('#title').textContent = TITLES[t];
    $('#curSeg').hidden = t !== 'overview';
    load();
    stopAuto(); timer = setInterval(() => { if (!document.hidden && !$('#balDialog').open) load(true); }, t === 'overview' ? 5000 : 10000);
  }
  const stopAuto = () => { clearInterval(timer); timer = null; };
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
  document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
  $('#refresh').addEventListener('click', () => load());

  let loading = false;
  async function load(quiet) {
    if (loading) return; loading = true;
    try {
      await ({ overview, rounds, bets, players, integrations, system })[tab]();
      $('#live').classList.remove('stale'); $('#live span').textContent = 'განახლდა ' + new Date().toLocaleTimeString('en-GB', { hour12: false });
    } catch (e) {
      $('#live').classList.add('stale'); $('#live span').textContent = e.message;
    } finally { loading = false; }
  }

  // ---------- მიმოხილვა ----------
  let cur = store.get('adm_cur') || 'DEMO', lastOverview = null;
  $('#curSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cur = b.dataset.cur; store.set('adm_cur', cur); if (lastOverview) renderOverview(lastOverview); });
  const phaseLabel = { bet: ['ფსონების მიღება', 'info'], race: ['რბოლა', 'good'], end: ['ფინიში', 'warn'], halted: ['შეჩერებულია', 'bad'] };

  async function overview() { lastOverview = await api('/overview'); renderOverview(lastOverview); }
  function renderOverview(o) {
    const curs = Object.keys(o.stats.currencies);
    if (!curs.length) curs.push('DEMO');
    if (!curs.includes(cur)) cur = curs.includes('DEMO') ? 'DEMO' : curs[0];
    $('#curSeg').innerHTML = curs.map(c => `<button type="button" data-cur="${esc(c)}" aria-pressed="${c === cur}">${esc(c)}</button>`).join('');
    const s = o.stats.currencies[cur] || { today: {}, total: {}, days: [] };
    const t = s.today, w = s.days.slice(-7).reduce((a, d) => ({ ggr: a.ggr + d.ggr, staked: a.staked + d.staked, wins: a.wins + d.wins }), { ggr: 0, staked: 0, wins: 0 });
    const k = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><small>${label}</small><b class="${value.cls || ''}">${value.v}</b><em>${sub}</em></div>`;
    $('#kpis').innerHTML = [
      k(`GGR დღეს · ${esc(cur)}`, { v: signed(t.ggr || 0), cls: (t.ggr || 0) >= 0 ? 'pos' : 'neg' }, `7 დღე: ${signed(w.ggr)} · სულ: ${signed(s.total.ggr || 0)}`, 'hero'),
      k('ბრუნვა დღეს', { v: money(t.staked || 0) }, `${t.bets || 0} ფსონი`),
      k('გაცემული მოგება', { v: money(t.wins || 0) }, `${t.winCount || 0} მოგება`),
      k('RTP დღეს', { v: pct(t.rtp) }, `7 დღე: ${pct(w.staked ? w.wins / w.staked : null)} · თეორია 97%`),
      k('მოთამაშე დღეს', { v: String(t.players || 0) }, `ონლაინ ახლა: ${o.online}`)
    ].join('');
    drawChart(s.days, cur);
    const [pl, pc] = phaseLabel[o.round.phase] || [o.round.phase, 'info'];
    const betsNow = o.currentBets || [];
    $('#now').innerHTML = `
      <dt>რბოლა</dt><dd>#${o.round.round} <span class="pill ${pc}"><i></i>${pl}</span></dd>
      <dt>ფსონები ამ რბოლაზე</dt><dd>${betsNow.length} · ${money(betsNow.reduce((a, b) => a + b.amount, 0))}</dd>
      <dt>ონლაინ</dt><dd>${o.online}</dd>
      <dt>კაზინოს რიგი</dt><dd>${o.outboxLength ? `<span class="pill warn"><i></i>${o.outboxLength} ელოდება</span>` : '<span class="pill good"><i></i>ცარიელი</span>'}</dd>
      <dt>პლატფორმები</dt><dd>${o.platforms}</dd>
      <dt>მუშაობს</dt><dd>${ago(o.uptimeSec)}</dd>`;
    $('#roundStrip').innerHTML = o.rounds.length ? o.rounds.map(r => `<div class="rs"><small>#${r.round} · ${time(r.endedAt || r.ts).split(', ').pop()}</small>${carsCell(r.results)}</div>`).join('') : '<span class="muted">ჯერ არცერთი რბოლა არ დასრულებულა.</span>';
  }
  const carsCell = res => res.map((x, i) => `<span class="car ${x.crash100 >= 1000 ? 'hi' : x.crash100 < 200 ? 'lo' : ''}" style="--c:${CARS[i].c}" title="${CARS[i].name}: ${x.type === 'crash' ? 'დაეჯახა' : 'გაჩერდა'}"><i></i>${x100(x.crash100)}<span class="t">${x.type === 'crash' ? '✕' : '■'}</span></span>`).join('');

  // GGR სვეტები: ერთი სერია, ნულის ხაზიდან; უარყოფითი დღე — წითლად
  function drawChart(days, currency) {
    const el = $('#chart'), W = el.clientWidth || 600, H = el.clientHeight || 220, L = 58, R = 8, T = 10, B = 24;
    const vals = days.map(d => d.ggr), max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    $('#chartSub').textContent = `${days.length} დღე · ${currency}`;
    el.setAttribute('aria-label', `GGR ბოლო ${days.length} დღე, ${currency}`);
    if (!days.some(d => d.bets || d.wins)) {
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">ამ პერიოდში ფსონი არ ყოფილა</text></svg>`;
    } else {
      const span = max - min || 100, step = niceStep(span / 4), top = Math.ceil(max / step) * step, bot = Math.floor(min / step) * step;
      const y = v => T + (top - v) / (top - bot || 1) * (H - T - B), cw = (W - L - R) / days.length, bw = Math.max(4, Math.min(28, cw * .62));
      let g = '<g class="grid axis">';
      for (let v = bot; v <= top + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${money(v).replace(/\.00$/, '')}</text>`;
      g += '</g>';
      let bars = '', labels = '<g class="axis">';
      days.forEach((d, i) => {
        const x = L + i * cw + (cw - bw) / 2, y0 = y(0), y1 = y(d.ggr), h = Math.max(1, Math.abs(y1 - y0));
        bars += `<rect class="hit" data-i="${i}" x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}"/>`;
        if (days.length <= 16 ? i % 2 === (days.length - 1) % 2 : i % 4 === 0) labels += `<text x="${L + i * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${d.day.slice(5).replace('-', '.')}</text>`;
        if (!d.ggr) return;          // ფსონის გარეშე დღე — სვეტი არ იხატება (tooltip მაინც მუშაობს)
        bars += d.ggr > 0
          ? `<path class="bar-pos" d="M${x},${y0} v${-(h - Math.min(4, h))} q0,-${Math.min(4, h)} ${Math.min(4, bw / 2)},-${Math.min(4, h)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z"/>`
          : `<path class="bar-neg" d="M${x},${y0} v${h - Math.min(4, h)} q0,${Math.min(4, h)} ${Math.min(4, bw / 2)},${Math.min(4, h)} h${bw - 2 * Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},-${Math.min(4, h)} v${-(h - Math.min(4, h))} z"/>`;
      });
      labels += '</g>';
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${bars}${labels}</svg>`;
      el.querySelectorAll('.hit').forEach(h => {
        h.addEventListener('pointerenter', e => showTip(e, days[+h.dataset.i], currency));
        h.addEventListener('pointermove', e => moveTip(e));
        h.addEventListener('pointerleave', hideTip);
      });
    }
    $('#daysTable').innerHTML = `<thead><tr><th>დღე</th><th class="r">ფსონი</th><th class="r">ბრუნვა</th><th class="r">მოგება</th><th class="r">GGR</th><th class="r">RTP</th><th class="r">მოთამაშე</th></tr></thead><tbody>${days.slice().reverse().map(d =>
      `<tr><td>${d.day}</td><td class="r n">${d.bets}</td><td class="r n">${money(d.staked)}</td><td class="r n">${money(d.wins)}</td><td class="r n ${d.ggr >= 0 ? 'pos' : 'neg'}">${signed(d.ggr)}</td><td class="r n">${pct(d.rtp)}</td><td class="r n">${d.players}</td></tr>`).join('')}</tbody>`;
  }
  function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw || 1)); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  const tip = $('#tip');
  function showTip(e, d, c) {
    tip.innerHTML = `<div class="muted">${d.day}</div><b class="${d.ggr >= 0 ? 'pos' : 'neg'}">GGR ${signed(d.ggr)} ${esc(c)}</b><div>ბრუნვა ${money(d.staked)} · მოგება ${money(d.wins)}</div><div>RTP ${pct(d.rtp)} · ${d.bets} ფსონი · ${d.players} მოთამაშე</div>`;
    tip.hidden = false; moveTip(e);
  }
  function moveTip(e) { const x = Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 14), y = Math.max(8, e.clientY - tip.offsetHeight - 12); tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  const hideTip = () => { tip.hidden = true; };
  addEventListener('resize', () => { if (tab === 'overview' && lastOverview) renderOverview(lastOverview); });

  // ---------- რბოლები ----------
  async function rounds() {
    const list = await api('/rounds?limit=300');
    $('#roundsTable').innerHTML = `<thead><tr><th>რბოლა</th><th>დასრულდა</th><th>შედეგები</th><th class="r">მაქს.</th><th>seed</th></tr></thead><tbody>${list.length ? list.map(r =>
      `<tr><td class="n">#${r.round}</td><td>${time(r.endedAt || r.ts)}</td><td>${carsCell(r.results)}</td><td class="r n">×${x100(Math.max(...r.results.map(x => x.crash100)))}</td><td><code title="${esc(r.seed)}">${esc(r.seed.slice(0, 16))}…</code></td></tr>`).join('') : '<tr><td class="empty-row" colspan="5">ჯერ არცერთი რბოლა არ დასრულებულა.</td></tr>'}</tbody>`;
  }

  // ---------- ფსონები (ჟურნალი) ----------
  let betType = '';
  $('#betFilters').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; betType = b.dataset.type; document.querySelectorAll('#betFilters button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(); });
  async function bets() {
    const rows = await api('/ledger?limit=300' + (betType ? '&type=' + encodeURIComponent(betType) : ''));
    $('#ledgerTable').innerHTML = `<thead><tr><th>დრო</th><th>ტიპი</th><th>მოთამაშე</th><th>რბოლა</th><th>ბოლიდი</th><th class="r">თანხა</th><th class="r">შედეგი</th><th class="r">ბალანსი</th></tr></thead><tbody>${rows.length ? rows.map(e => {
      const [lbl, cls] = TYPE_LABEL[e.type] || [e.type, 't-acc'];
      const car = e.car != null ? `<span class="car" style="--c:${CARS[e.car].c}"><i></i>${CARS[e.car].name}</span>` : '';
      const res = e.type === 'win' ? `<span class="pos">×${x100(e.m100)} +${money(e.win)}</span>` : e.type === 'lose' ? `<span class="neg">×${x100(e.crash100)}</span>` : e.type === 'ext_rejected' ? esc(e.code || e.error) : e.auto ? `ავტო ×${x100(e.auto)}` : '';
      const amt = e.type === 'admin_adjust' ? `${money(e.before)} → ${money(e.balance)}` : money(e.amount ?? e.tx?.amount);
      return `<tr><td>${time(e.ts)}</td><td class="t ${cls}">${lbl}</td><td>${esc(e.name || '—')} <span class="muted">${esc(e.currency)}</span></td><td class="n">${e.round ? '#' + e.round : ''}</td><td>${car}</td><td class="r n">${amt}</td><td class="r n">${res}</td><td class="r n">${e.balance != null && e.type !== 'admin_adjust' ? money(e.balance) : ''}</td></tr>`;
    }).join('') : '<tr><td class="empty-row" colspan="8">ჩანაწერი არ არის.</td></tr>'}</tbody>`;
  }

  // ---------- მოთამაშეები ----------
  let playersCache = [];
  $('#playerSearch').addEventListener('input', () => renderPlayers());
  async function players() { playersCache = await api('/players'); renderPlayers(); }
  function renderPlayers() {
    const q = $('#playerSearch').value.trim().toLowerCase();
    const list = playersCache.filter(p => !q || [p.name, p.pid, p.platform, p.playerId, p.currency].some(v => String(v || '').toLowerCase().includes(q)));
    $('#playersTable').innerHTML = `<thead><tr><th>მოთამაშე</th><th>ტიპი</th><th class="r">ბალანსი</th><th class="r">ფსონი</th><th class="r">ბრუნვა</th><th class="r">მოთამაშის P/L</th><th>ბოლო ფსონი</th><th></th></tr></thead><tbody>${list.length ? list.map(p =>
      `<tr><td><b>${esc(p.name)}</b> <code>${esc(p.pid)}</code>${p.currentBet ? ' <span class="pill info"><i></i>რბოლაშია</span>' : ''}</td>
       <td>${p.platform ? `<span class="pill warn"><i></i>${esc(p.platform)}</span> <span class="muted">${esc(p.playerId || '')}</span>` : '<span class="pill info"><i></i>დემო</span>'}</td>
       <td class="r n">${money(p.balance)} <span class="muted">${esc(p.currency)}</span></td><td class="r n">${p.bets}</td><td class="r n">${money(p.turnover)}</td>
       <td class="r n ${p.pnl > 0 ? 'pos' : p.pnl < 0 ? 'neg' : ''}">${signed(p.pnl)}</td><td>${time(p.lastBetAt)}</td>
       <td>${p.platform ? '' : `<button type="button" class="act" data-bal="${esc(p.token)}">ბალანსი</button>`}</td></tr>`).join('') : '<tr><td class="empty-row" colspan="8">მოთამაშე ვერ მოიძებნა.</td></tr>'}</tbody>`;
  }
  let balToken = null;
  $('#playersTable').addEventListener('click', e => {
    const b = e.target.closest('[data-bal]'); if (!b) return;
    const p = playersCache.find(x => x.token === b.dataset.bal); if (!p) return;
    balToken = p.token; $('#balWho').textContent = `${p.name} · ახლა ${money(p.balance)}`; $('#balInput').value = (p.balance / 100).toFixed(2); $('#balErr').textContent = '';
    $('#balDialog').showModal(); $('#balInput').select();
  });
  $('#balCancel').addEventListener('click', () => $('#balDialog').close());
  $('#balForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api(`/players/${balToken}/balance`, { balance: Math.round(parseFloat($('#balInput').value) * 100) }); $('#balDialog').close(); players(); }
    catch (err) { $('#balErr').textContent = err.message; }
  });

  // ---------- ინტეგრაციები ----------
  async function integrations() {
    const [d, ob] = await Promise.all([api('/integrations'), api('/outbox')]);
    $('#platforms').innerHTML = d.platforms.length ? d.platforms.map(p => `<div class="card plat"><h4>${esc(p.id)} <span class="pill info"><i></i>${esc(p.adapter)}</span></h4><dl class="kv">
      <dt>operatorId</dt><dd>${esc(p.operatorId ?? '—')}</dd><dt>providerId</dt><dd>${esc(p.providerId ?? '—')}</dd>
      <dt>საფულე</dt><dd><code>${esc(p.walletUrl || '—')}</code></dd><dt>ვალუტები</dt><dd>${esc((p.currencies || []).join(', ') || '—')}</dd>
      <dt>ჩვენი მისამართი</dt><dd><code>${esc(location.origin)}/p/${esc(p.id)}</code></dd>
      <dt>სესიები</dt><dd class="num">${p.sessions} · ${p.players} მოთამაშე</dd><dt>ბოლო გაშვება</dt><dd>${time(p.lastLaunchAt)}</dd></dl></div>`).join('')
      : '<div class="card muted">პლატფორმა არ არის დაკავშირებული. კონფიგურაცია: INTEGRATIONS ან INTEGRATIONS_FILE.</div>';
    $('#outbox').innerHTML = ob.length ? `<div class="tw"><table><thead><tr><th>მოთამაშე</th><th>ოპერაცია</th><th>id</th><th class="r">თანხა</th><th class="r">ცდები</th></tr></thead><tbody>${ob.map(o =>
      `<tr><td>${esc(o.name || '—')}</td><td class="t t-ext">${esc(o.tx.kind.toUpperCase())}</td><td><code>${esc(o.tx.id)}</code></td><td class="r n">${money(o.tx.amount)}</td><td class="r n">${o.tries}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted" style="margin:0">რიგი ცარიელია — ყველა ოპერაცია კაზინომ დაადასტურა.</p>';
    $('#journalTable').innerHTML = `<thead><tr><th>დრო</th><th>პლატფორმა</th><th>მოთამაშე</th><th>ტიპი</th><th>რბოლა</th><th class="r">თანხა</th><th class="r">ბალანსი</th><th>ჩვენი id</th><th>კაზინოს id</th></tr></thead><tbody>${d.journal.length ? d.journal.map(j =>
      `<tr><td>${time(j.ts)}</td><td>${esc(j.platform)}</td><td>${esc(j.player)}</td><td class="t ${j.kind === 'bet' ? 't-bet' : j.kind === 'win' ? 't-win' : 't-cancel'}">${esc(j.kind.toUpperCase())}</td><td class="n">${esc(j.roundId)}</td><td class="r n">${money(j.amount)}</td><td class="r n">${money(j.balance)}</td><td><code>${esc(j.id)}</code></td><td><code>${esc(j.platformTx ?? '—')}</code></td></tr>`).join('') : '<tr><td class="empty-row" colspan="9">ტრანზაქცია ჯერ არ ყოფილა.</td></tr>'}</tbody>`;
    $('#freebetsTable').innerHTML = `<thead><tr><th>შეიქმნა</th><th>პლატფორმა</th><th>მოთამაშე</th><th class="r">თანხა</th><th>თამაშები</th><th>სტატუსი</th><th>id</th></tr></thead><tbody>${d.freebets.length ? d.freebets.map(f =>
      `<tr><td>${time(f.createdAt)}</td><td>${esc(f.platform)}</td><td>${esc(f.playerId)}</td><td class="r n">${money(f.amount)} <span class="muted">${esc(f.currency)}</span></td><td>${esc((f.games || []).join(', '))}</td><td>${f.state === 'active' ? '<span class="pill good"><i></i>აქტიური</span>' : '<span class="pill bad"><i></i>გაუქმებული</span>'}</td><td><code>${esc(f.id)}</code></td></tr>`).join('') : '<tr><td class="empty-row" colspan="7">ფრიბეტი არ არის.</td></tr>'}</tbody>`;
  }
  $('#flush').addEventListener('click', async () => { try { const r = await api('/outbox/flush', {}); $('#live span').textContent = `რიგში დარჩა: ${r.left}`; integrations(); } catch (e) { $('#live span').textContent = e.message; } });

  // ---------- სისტემა ----------
  async function system() {
    const o = await api('/overview');
    $('#sys').innerHTML = `
      <dt>მუშაობს</dt><dd>${ago(o.uptimeSec)}</dd>
      <dt>მიმდინარე რბოლა</dt><dd>#${o.round.round} · ${esc((phaseLabel[o.round.phase] || [o.round.phase])[0])}</dd>
      <dt>ფაზები</dt><dd>ფსონები ${(o.round.betMs / 1000).toFixed(1)} წმ · ფინიში ${(o.round.endMs / 1000).toFixed(1)} წმ</dd>
      <dt>ფსონის ზღვრები</dt><dd>${money(o.rules.minBet)} – ${money(o.rules.maxBet)}</dd>
      <dt>დემო საწყისი ბალანსი</dt><dd>${money(o.rules.startBalance)}</dd>
      <dt>ჯაჭვის commit</dt><dd><code>${esc(o.fairness.commit)}</code></dd>
      <dt>client seed</dt><dd><code>${esc(o.fairness.clientSeed)}</code></dd>
      <dt>ჯაჭვის სიგრძე</dt><dd>${o.fairness.chainLength.toLocaleString('en')} რბოლა (დარჩა ${(o.fairness.chainLength - o.round.round).toLocaleString('en')})</dd>
      <dt>ონლაინ</dt><dd>${o.online}</dd>
      <dt>კაზინოს რიგი</dt><dd>${o.outboxLength}</dd>`;
  }

  // ---------- გაშვება ----------
  api('/me').then(showApp).catch(() => showLogin());
})();
