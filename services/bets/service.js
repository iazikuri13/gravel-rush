// ფსონების სერვისი — HTTP API + SSE მოვლენები
//
//  GET    /health                        (ღია)
//  POST   /players                       {token?, name?} → {token, me}   ან {session} — კაზინოდან გაშვებისას
//  GET    /players/:token                → me
//  PATCH  /players/:token                {name} → me
//  POST   /players/:token/refill         → me
//  GET    /bets/current                  → {round, bets}   (საჯარო სია)
//  POST   /bets                          {token, car, amount, auto?} → me
//  DELETE /bets/:token                   → me
//  POST   /bets/:token/cashout           → me
//  GET    /events                        SSE: bets_changed, settled, me_changed
//
// დამოკიდებულია რაუნდის სერვისზე: GET /rounds/current, /rounds/accepting, POST /rounds/:n/check, SSE /events
import { Wallet } from './wallet.js';
import { adminApi } from './admin.js';
import { JsonStore } from '../lib/store.js';
import { router, listen, EventHub, subscribe, apiClient } from '../lib/http.js';

export async function startBetsService({ port = 0, host = '127.0.0.1', dataDir, key, roundUrl, integrationsUrl = null }) {
  if (!key) throw new Error('INTERNAL_KEY აუცილებელია');
  if (!roundUrl) throw new Error('ROUND_URL აუცილებელია');
  const roundApi = apiClient(roundUrl, key);
  // შუამავალი (გარე კაზინოები) — არასავალდებულო; მის გარეშე მხოლოდ დემო ანგარიშები მუშაობს
  const ext = integrationsUrl ? (() => {
    const api = apiClient(integrationsUrl, key), enc = encodeURIComponent;
    return {
      session: t => api.get(`/sessions/${enc(t)}`),
      balance: t => api.get(`/sessions/${enc(t)}/balance`),
      tx: (t, tx) => api.post(`/sessions/${enc(t)}/tx`, tx)
    };
  })() : null;
  const wallet = new Wallet(new JsonStore(dataDir), {
    accepting: () => roundApi.get('/rounds/accepting'),
    check: (round, body) => roundApi.post(`/rounds/${round}/check`, body)
  }, ext);

  const hub = new EventHub();
  wallet.on('bets_changed', d => hub.emit('bets_changed', d));
  wallet.on('settled', d => hub.emit('settled', d));
  wallet.on('me_changed', d => hub.emit('me_changed', d));

  const sub = subscribe(roundUrl + '/events', key, (type, data) => wallet.onRoundEvent(type, data), {
    onOpen: () => roundApi.get('/rounds/current').then(s => wallet.syncState(s)).catch(() => {})
  });
  await sub.opened;
  wallet.syncState(await roundApi.get('/rounds/current'));

  const handler = router([
    ['GET', '/health', () => ({ ok: true }), { open: true }],
    ['POST', '/players', ({ body }) => wallet.join(body)],
    ['GET', '/players/:token', ({ params }) => wallet.me(params.token)],
    ['PATCH', '/players/:token', ({ params, body }) => wallet.rename(params.token, body.name)],
    ['POST', '/players/:token/refill', ({ params }) => wallet.refill(params.token)],
    ['GET', '/bets/current', () => wallet.publicBets()],
    ['POST', '/bets', ({ body }) => wallet.placeBet(body.token, { car: body.car, amount: body.amount, auto: body.auto ?? null })],
    ['DELETE', '/bets/:token', ({ params }) => wallet.cancelBet(params.token)],
    ['POST', '/bets/:token/cashout', ({ params }) => wallet.cashOut(params.token)],
    ['GET', '/events', ({ req, res }) => { hub.handle(req, res); }],
    ...adminApi(wallet, dataDir).routes
  ], { key });

  const { server, port: p, url } = await listen(handler, { port, host });
  return {
    url, port: p, wallet,
    async close() { sub.close(); hub.close(); wallet.dispose(); await wallet.drain().catch(() => {}); wallet.store.write('players.json', wallet.players); await new Promise(r => server.close(r)); server.closeAllConnections?.(); }
  };
}
