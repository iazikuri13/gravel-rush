// რაუნდის სერვისის დამოუკიდებლად გაშვება:
//   INTERNAL_KEY=… ROUND_PORT=4101 DATA_DIR=./data/round node services/round/main.js
import { startRoundService } from './service.js';

const env = process.env;
const num = v => (v ? Number(v) : undefined);
const svc = await startRoundService({
  port: num(env.ROUND_PORT) ?? 4101,
  host: env.HOST || '127.0.0.1',
  dataDir: env.DATA_DIR || './data/round',
  key: env.INTERNAL_KEY,
  clientSeed: env.CLIENT_SEED, secret: env.CHAIN_SECRET, chainLength: num(env.CHAIN_LENGTH),
  betMs: num(env.BET_MS), endMs: num(env.END_MS), speed: num(env.SPEED)
});
console.log(`round-service → ${svc.url}  commit ${svc.engine.commit}`);
svc.start();
