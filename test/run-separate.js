// კონტრაქტული ტესტები სამ ცალკე პროცესზე (round / bets / gateway) — ყველა ოპერაციულ სისტემაზე.
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, ['--test', 'test/contract.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, GR_MODE: 'separate' }
});
process.exit(r.status ?? 1);
