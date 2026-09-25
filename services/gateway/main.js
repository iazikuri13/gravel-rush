// გეითვეის დამოუკიდებლად გაშვება:
//   INTERNAL_KEY=… ROUND_URL=… BETS_URL=… PORT=3000 node services/gateway/main.js
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from './service.js';

const env = process.env;
const gw = await startGateway({
  port: env.PORT ? Number(env.PORT) : 3000,
  publicDir: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public'),
  key: env.INTERNAL_KEY,
  roundUrl: env.ROUND_URL || 'http://127.0.0.1:4101',
  betsUrl: env.BETS_URL || 'http://127.0.0.1:4102',
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
});
console.log(`Gravel Rush → http://localhost:${gw.port}`);
