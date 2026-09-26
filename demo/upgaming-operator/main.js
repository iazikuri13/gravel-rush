// სატესტო კაზინოს დამოუკიდებლად გაშვება:
//   DEMO_HASH_KEY=… PROVIDER_URL=http://127.0.0.1:4103/p/upgaming-demo DEMO_PORT=4200 node demo/upgaming-operator/main.js
// იგივე DEMO_HASH_KEY და walletUrl=http://127.0.0.1:4200 უნდა ეწეროს შუამავლის კონფიგურაციაში.
import { startDemoOperator } from './service.js';

const env = process.env;
const demo = await startDemoOperator({
  port: env.DEMO_PORT ? Number(env.DEMO_PORT) : 4200,
  host: env.HOST || '127.0.0.1',
  hashKey: env.DEMO_HASH_KEY,
  operatorId: env.DEMO_OPERATOR_ID || 'demo-operator',
  providerId: env.DEMO_PROVIDER_ID ? Number(env.DEMO_PROVIDER_ID) : 777,
  providerUrl: env.PROVIDER_URL || null
});
console.log(`სატესტო კაზინო → ${demo.url}`);
