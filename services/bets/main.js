// ფსონების სერვისის დამოუკიდებლად გაშვება:
//   INTERNAL_KEY=… ROUND_URL=http://127.0.0.1:4101 BETS_PORT=4102 DATA_DIR=./data/bets node services/bets/main.js
import { startBetsService } from './service.js';

const env = process.env;
const svc = await startBetsService({
  port: env.BETS_PORT ? Number(env.BETS_PORT) : 4102,
  host: env.HOST || '127.0.0.1',
  dataDir: env.DATA_DIR || './data/bets',
  key: env.INTERNAL_KEY,
  roundUrl: env.ROUND_URL || 'http://127.0.0.1:4101'
});
console.log(`bets-service → ${svc.url}`);
