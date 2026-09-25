// რაუნდის სერვისი — HTTP API + SSE მოვლენები
//
//  GET  /health                         (ღია)
//  GET  /fairness                       commit, chainLength, clientSeed
//  GET  /rounds/current                 საჯარო მდგომარეობა
//  GET  /rounds/history                 დასრულებული რაუნდები seed-ებით
//  GET  /rounds/accepting               იღებს თუ არა ფსონს ახლა
//  POST /rounds/:round/check            {car, m100?} → {ok, m100}
//  GET  /events                         SSE: bet_open, race_started, car_ended, round_ended
//
// ყველა მარშრუტი (გარდა /health) მოითხოვს x-internal-key-ს.
import { RoundEngine } from './engine.js';
import { JsonStore } from '../lib/store.js';
import { router, listen, EventHub, HttpError } from '../lib/http.js';

export async function startRoundService({ port = 0, host = '127.0.0.1', dataDir, key, autostart = true, ...engineOpts }) {
  if (!key) throw new Error('INTERNAL_KEY აუცილებელია');
  const engine = new RoundEngine(new JsonStore(dataDir), engineOpts);
  const hub = new EventHub();
  engine.on('event', (type, data) => hub.emit(type, data));

  const handler = router([
    ['GET', '/health', () => ({ ok: true }), { open: true }],
    ['GET', '/fairness', () => engine.fairness()],
    ['GET', '/rounds/current', () => engine.publicState()],
    ['GET', '/rounds/history', () => engine.history],
    ['GET', '/rounds/accepting', () => engine.accepting()],
    ['POST', '/rounds/:round/check', ({ params, body }) => {
      const car = body.car, m100 = body.m100 ?? null;
      if (![0, 1, 2].includes(car)) throw new HttpError(400, 'car');
      if (m100 !== null && !Number.isInteger(m100)) throw new HttpError(400, 'm100');
      return engine.check({ round: Number(params.round), car, m100 });
    }],
    ['GET', '/events', ({ req, res }) => { hub.handle(req, res); }]
  ], { key });

  const { server, port: p, url } = await listen(handler, { port, host });
  return {
    url, port: p, engine,
    start: () => engine.start(),
    async close() { engine.stop(); hub.close(); await new Promise(r => server.close(r)); server.closeAllConnections?.(); }
  };
}
