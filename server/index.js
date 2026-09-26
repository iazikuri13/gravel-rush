// გამშვები: ყველა სერვისს ერთ პროცესში უშვებს (Render-ის ერთი უფასო სერვისისთვის).
// სერვისები ერთმანეთს მაინც მხოლოდ HTTP/SSE-ით ესაუბრებიან (127.0.0.1-ზე) —
// ცალ-ცალკე გაშვებისთვის იხ. services/*/main.js.
//
//   ბრაუზერი ⇄ gateway (PORT) ⇄ bets (შიდა) ⇄ round (შიდა)
//                  │              └──⇄ integrations (შუამავალი) ⇄ კაზინოს საფულე
//   კაზინო ────────┴── /p/:platform/…  (LaunchGame, GetGames, …)
//
// DEMO_OPERATOR=0 თიშავს სატესტო კაზინოს (/demo-operator/). რეალური პლატფორმები: INTEGRATIONS ან INTEGRATIONS_FILE.
import { randomBytes, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRoundService } from '../services/round/service.js';
import { startBetsService } from '../services/bets/service.js';
import { startGateway } from '../services/gateway/service.js';
import { startIntegrationsService, loadPlatforms } from '../services/integrations/service.js';
import { startDemoOperator } from '../demo/upgaming-operator/service.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const num = v => (v ? Number(v) : undefined);
const DATA = env.DATA_DIR || join(ROOT, 'data');
const key = env.INTERNAL_KEY || randomBytes(24).toString('hex');

const round = await startRoundService({
  port: num(env.ROUND_PORT) ?? 0, dataDir: join(DATA, 'round'), key,
  clientSeed: env.CLIENT_SEED, secret: env.CHAIN_SECRET, chainLength: num(env.CHAIN_LENGTH),
  betMs: num(env.BET_MS), endMs: num(env.END_MS), speed: num(env.SPEED)
});

// სატესტო კაზინო (Upgaming-ის იმიტაცია) + პლატფორმების კონფიგურაცია
const platforms = await loadPlatforms(env);
let demo = null;
if (env.DEMO_OPERATOR !== '0') {
  const hashKey = env.DEMO_HASH_KEY || randomUUID();
  demo = await startDemoOperator({ hashKey, operatorId: 'demo-operator', providerId: 777 });
  platforms.push({ id: 'upgaming-demo', adapter: 'upgaming', operatorId: 'demo-operator', providerId: 777, walletUrl: demo.url, hashKey, currencies: ['GEL', 'USD', 'EUR'] });
}
const integrations = await startIntegrationsService({
  port: num(env.INTEGRATIONS_PORT) ?? 0, dataDir: join(DATA, 'integrations'), key, platforms,
  publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || ''
});
demo?.setProviderUrl(integrations.url + '/p/upgaming-demo');

const bets = await startBetsService({ port: num(env.BETS_PORT) ?? 0, dataDir: join(DATA, 'bets'), key, roundUrl: round.url, integrationsUrl: integrations.url });
const gateway = await startGateway({
  port: num(env.PORT) ?? 3000,
  publicDir: join(ROOT, 'public'),
  key, roundUrl: round.url, betsUrl: bets.url,
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  proxies: [
    { prefix: '/p/', target: integrations.url, strip: false },
    ...(demo ? [{ prefix: '/demo-operator/', target: demo.url, strip: true }] : [])
  ]
});

console.log(`round-service → ${round.url}`);
console.log(`bets-service  → ${bets.url}`);
console.log(`integrations  → ${integrations.url}  პლატფორმები: ${platforms.map(p => p.id).join(', ') || '—'}`);
if (demo) console.log(`სატესტო კაზინო → http://localhost:${gateway.port}/demo-operator/`);
console.log(`commit: ${round.engine.commit}  ·  client seed: ${round.engine.clientSeed}  ·  შემდეგი რაუნდი: #${round.engine.meta.nextRound}`);
console.log(`Gravel Rush → http://localhost:${gateway.port}`);
round.start();   // რაუნდები იწყება მას შემდეგ, რაც ყველა გამომწერი დაკავშირდა

const shutdown = async () => {
  await gateway.close().catch(() => {});
  await bets.close().catch(() => {});
  await integrations.close().catch(() => {});
  await demo?.close().catch(() => {});
  await round.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
