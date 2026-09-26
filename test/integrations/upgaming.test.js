// შუამავალი + Upgaming ადაპტერი სატესტო კაზინოს წინააღმდეგ (თამაშის გარეშე).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startIntegrationsService } from '../../services/integrations/service.js';
import { startDemoOperator } from '../../demo/upgaming-operator/service.js';
import { signature } from '../../services/integrations/adapters/upgaming.js';
import upgaming from '../../services/integrations/adapters/upgaming.js';
import { apiClient } from '../../services/lib/http.js';

const KEY = 'integrations-test-key', HASH = 'hash-key-' + randomUUID();

describe('შუამავალი ⇄ Upgaming (სატესტო კაზინო)', () => {
  let dir, demo, svc, api, P;
  const launch = async (playerId = 'nino-gel') => {
    const r = await fetch(demo.url + '/api/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId }) }).then(r => r.json());
    return r.url.split('session=')[1];
  };
  const err = async p => { try { await p; } catch (e) { return e; } throw new Error('შეცდომა უნდა ყოფილიყო'); };
  const demoState = () => fetch(demo.url + '/api/state').then(r => r.json());

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gr-int-'));
    demo = await startDemoOperator({ hashKey: HASH, operatorId: 'op-1', providerId: 55 });
    svc = await startIntegrationsService({
      dataDir: dir, key: KEY, publicUrl: 'https://game.example',
      platforms: [{ id: 'ug', adapter: 'upgaming', operatorId: 'op-1', providerId: 55, walletUrl: demo.url, hashKey: HASH, currencies: ['GEL', 'USD', 'EUR'] }]
    });
    demo.setProviderUrl(svc.url + '/p/ug');
    api = apiClient(svc.url, KEY);
    P = svc.url + '/p/ug';
  });
  after(async () => { await svc.close(); await demo.close(); rmSync(dir, { recursive: true, force: true }); });

  it('GetGames: სწორი key-ით სია Upgaming-ის ველებით; სხვა key — INVALID_SIGNATURE', async () => {
    const games = await fetch(P + '/GetGames?key=op-1').then(r => r.json());
    assert.deepEqual(Object.keys(games[0]).sort(), ['DemoAvailable', 'FreespinSupport', 'Id', 'ImageLink', 'MobileSupport', 'Name', 'ProviderId', 'Type'].sort());
    assert.equal(games[0].ProviderId, 55);
    assert.match(games[0].ImageLink, /^https:\/\/game\.example\//);
    const bad = await fetch(P + '/GetGames?key=other');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).errorcode, 'INVALID_SIGNATURE');
  });

  it('LaunchGame: ბმული საჯარო მისამართით; შეცდომები Upgaming-ის კოდებით', async () => {
    const q = o => new URLSearchParams({ currency: 'GEL', device: 'MOBILE', locale: 'ka', gameId: '1001', casinoSessionId: randomUUID(), lobbyUrl: 'https://casino/lobby', casinoPlayerId: 'nino-gel', operatorId: 'op-1', ...o });
    const ok = await fetch(`${P}/LaunchGame?${q()}`).then(r => r.json());
    assert.match(ok.url, /^https:\/\/game\.example\/\?session=[0-9a-f]{48}$/);
    for (const [o, code, status] of [[{ gameId: '9' }, 'GAME_NOT_FOUND', 404], [{ currency: 'JPY' }, 'INVALID_CURRENCY', 400], [{ operatorId: 'x' }, 'INVALID_SIGNATURE', 400], [{ device: 'TV' }, 'INTERNAL_ERROR', 500]]) {
      const r = await fetch(`${P}/LaunchGame?${q(o)}`);
      assert.equal(r.status, status, JSON.stringify(o));
      assert.equal((await r.json()).errorcode, code);
    }
  });

  it('ბალანსი ცენტებში; ჰეში ორივე მხარეს ერთნაირად ითვლება', async () => {
    const t = await launch('nino-gel');
    const s = await api.get(`/sessions/${t}`);
    assert.equal(s.currency, 'GEL'); assert.equal(s.playerId, 'nino-gel'); assert.equal(s.closeRoundWithZeroWin, true);
    assert.equal((await api.get(`/sessions/${t}/balance`)).balance, 25000);
    // ცალკე: კაზინო ყალბ ჰეშს უარყოფს
    const bad = await fetch(`${demo.url}/balance?casinoPlayerId=nino-gel&currency=GEL&casinosessionid=${s.platformSessionId}&gameid=1001&providerid=55`, { headers: { SecretKey: 'SHA-512=deadbeef' } });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).errorcode, 'INVALID_SIGNATURE');
    const good = await fetch(`${demo.url}/balance?casinoPlayerId=nino-gel&currency=GEL&casinosessionid=${s.platformSessionId}&gameid=1001&providerid=55`, {
      headers: { SecretKey: signature({ hashKey: HASH }, { casinoSessionId: s.platformSessionId, currency: 'GEL', gameId: '1001', playerId: 'nino-gel' }) }
    }).then(r => r.json());
    assert.deepEqual(good, { Status: 'Success', Currency: 'GEL', Amount: 250 });
  });

  it('BET → ROLLBACK; ერთი და იგივე tx id ორჯერ არ ტარდება', async () => {
    const t = await launch('luka-usd');
    const bet = { id: 'bet-a-' + randomUUID(), kind: 'bet', roundId: '7', amount: 1250 };
    assert.equal((await api.post(`/sessions/${t}/tx`, bet)).balance, 10000 - 1250);
    const again = await api.post(`/sessions/${t}/tx`, bet);
    assert.equal(again.balance, 10000 - 1250);
    assert.equal(again.repeated, true);
    let log = (await demoState()).log.filter(x => x.player === 'luka-usd');
    assert.equal(log.filter(x => x.type === 'BET').length, 1);
    const rb = await api.post(`/sessions/${t}/tx`, { id: 'rb-' + bet.id, kind: 'rollback', ref: bet.id, roundId: '7', amount: 1250 });
    assert.equal(rb.balance, 10000);
    // სხვა id-ით იგივე დაბრუნება: კაზინო ამბობს ALREADY_PROCESSED → ადაპტერისთვის ეს წარმატებაა, ბალანსი არ იცვლება
    assert.equal((await api.post(`/sessions/${t}/tx`, { id: 'rb2-' + bet.id, kind: 'rollback', ref: bet.id, roundId: '7', amount: 1250 })).balance, 10000);
    log = (await demoState()).log.filter(x => x.player === 'luka-usd');
    assert.deepEqual(log.map(x => x.type).reverse(), ['BET', 'ROLLBACK']);
  });

  it('WIN (მათ შორის 0) და INSUFFICIENT_FUNDS', async () => {
    const t = await launch('ana-eur');       // 40.00 EUR
    await api.post(`/sessions/${t}/tx`, { id: 'b1-' + randomUUID(), kind: 'bet', roundId: '8', amount: 1000 });
    assert.equal((await api.post(`/sessions/${t}/tx`, { id: 'w1-' + randomUUID(), kind: 'win', roundId: '8', amount: 2340 })).balance, 4000 - 1000 + 2340);
    assert.equal((await api.post(`/sessions/${t}/tx`, { id: 'w0-' + randomUUID(), kind: 'win', roundId: '9', amount: 0 })).balance, 5340);
    const e = await err(api.post(`/sessions/${t}/tx`, { id: 'b2-' + randomUUID(), kind: 'bet', roundId: '10', amount: 100000 }));
    assert.equal(e.code, 'INSUFFICIENT_FUNDS');
    assert.equal(e.status, 403);
  });

  it('ფრიბეტი: AddFreeBet ინახება, CancelFreeBet აუქმებს', async () => {
    const r = await fetch(demo.url + '/api/freebet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: 'nino-gel', amount: 2 }) }).then(r => r.json());
    assert.match(r.FreeBetGuid, /^[0-9a-f-]{36}$/);
    assert.equal(svc.hub.freebets[r.FreeBetGuid].amount, 200);
    assert.equal(svc.hub.freebets[r.FreeBetGuid].state, 'active');
    const c = await fetch(P + '/CancelFreeBet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.FreeBetGuid, operatorId: 'op-1' }) });
    assert.equal(c.status, 200);
    assert.equal(svc.hub.freebets[r.FreeBetGuid].state, 'cancelled');
    const missing = await fetch(P + '/CancelFreeBet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'nope' }) });
    assert.equal((await missing.json()).errorcode, 'TRANSACTION_NOT_FOUND');
  });

  it('შიდა API გასაღების გარეშე — 401; უცნობი სესია — 404', async () => {
    assert.equal((await fetch(svc.url + '/sessions/abc')).status, 401);
    assert.equal((await err(api.get('/sessions/' + 'a'.repeat(48)))).status, 404);
  });

  it('კაზინო მიუწვდომელია → PLATFORM_UNAVAILABLE (503), რომ თამაშმა ხელახლა სცადოს', async () => {
    const a = upgaming({ id: 'x', operatorId: 'o', providerId: 1, walletUrl: 'http://127.0.0.1:9', hashKey: 'k', timeoutMs: 1000 }, { games: () => [], url: p => p });
    const e = await err(a.transact({ playerId: 'p', currency: 'USD', platformSessionId: 's', gameId: '1001' }, { id: 't', kind: 'bet', roundId: '1', amount: 100 }));
    assert.equal(e.code, 'PLATFORM_UNAVAILABLE');
    assert.equal(e.status, 503);
  });
});
