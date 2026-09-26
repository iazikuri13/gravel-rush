// შუამავლის დამოუკიდებლად გაშვება:
//   INTERNAL_KEY=… INTEGRATIONS_PORT=4103 DATA_DIR=./data/integrations PUBLIC_URL=https://… \
//   INTEGRATIONS_FILE=./integrations.json node services/integrations/main.js
import { startIntegrationsService, loadPlatforms } from './service.js';

const env = process.env;
const platforms = await loadPlatforms(env);
const svc = await startIntegrationsService({
  port: env.INTEGRATIONS_PORT ? Number(env.INTEGRATIONS_PORT) : 4103,
  host: env.HOST || '127.0.0.1',
  dataDir: env.DATA_DIR || './data/integrations',
  key: env.INTERNAL_KEY,
  platforms,
  publicUrl: env.PUBLIC_URL || ''
});
console.log(`integrations → ${svc.url}  პლატფორმები: ${platforms.map(p => p.id).join(', ') || '—'}`);
