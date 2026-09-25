// გამშვები: სამ სერვისს ერთ პროცესში უშვებს (Render-ის ერთი უფასო სერვისისთვის).
// სერვისები ერთმანეთს მაინც მხოლოდ HTTP/SSE-ით ესაუბრებიან (127.0.0.1-ზე) —
// ცალ-ცალკე გაშვებისთვის იხ. services/*/main.js.
//
//   ბრაუზერი ⇄ gateway (PORT) ⇄ bets (შიდა) ⇄ round (შიდა)
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRoundService } from '../services/round/service.js';
import { startBetsService } from '../services/bets/service.js';
import { startGateway } from '../services/gateway/service.js';

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
const bets = await startBetsService({ port: num(env.BETS_PORT) ?? 0, dataDir: join(DATA, 'bets'), key, roundUrl: round.url });
const gateway = await startGateway({
  port: num(env.PORT) ?? 3000,
  publicDir: join(ROOT, 'public'),
  key, roundUrl: round.url, betsUrl: bets.url,
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
});

console.log(`round-service → ${round.url}`);
console.log(`bets-service  → ${bets.url}`);
console.log(`commit: ${round.engine.commit}  ·  client seed: ${round.engine.clientSeed}  ·  შემდეგი რაუნდი: #${round.engine.meta.nextRound}`);
console.log(`Gravel Rush → http://localhost:${gateway.port}`);
round.start();   // რაუნდები იწყება მას შემდეგ, რაც ყველა გამომწერი დაკავშირდა

const shutdown = async () => {
  await gateway.close().catch(() => {});
  await bets.close().catch(() => {});
  await round.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
