// შუამავალი (integrations) — HTTP API
//
// პლატფორმებისთვის (ღია, თითოეული ადაპტერის ფორმატით და შეცდომებით):
//   *      /p/:platform/…                   მაგ. GET /p/upgaming/LaunchGame
//
// თამაშისთვის (შიდა, x-internal-key):
//   GET    /health                          (ღია)
//   GET    /platforms                       → [{ id, adapter }]
//   GET    /sessions/:token                 → სესია (მოთამაშე, ვალუტა, პლატფორმა…)
//   GET    /sessions/:token/balance         → { balance }            (ცენტები)
//   POST   /sessions/:token/tx              { id, kind, roundId, amount, ref? } → { balance, platformTx }
//   GET    /admin/overview                  პლატფორმები (საიდუმლოების გარეშე), სესიები, ფრიბეტები, ბოლო ტრანზაქციები
import { router, listen, sendJson, HttpError } from '../lib/http.js';
import { JsonStore } from '../lib/store.js';
import { join } from 'node:path';
import { Hub } from './hub.js';
import { tailJsonl } from '../lib/tail.js';

// საიდუმლოები ადმინშიც არ ჩანს
const SECRET_KEYS = /key|secret|password|token/i;
const publicCfg = cfg => Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '••••' : v]));

export async function startIntegrationsService({ port = 0, host = '127.0.0.1', dataDir, key, platforms = [], publicUrl = '' }) {
  if (!key) throw new Error('INTERNAL_KEY აუცილებელია');
  const hub = new Hub(new JsonStore(dataDir), { platforms, publicUrl });

  const internal = router([
    ['GET', '/health', () => ({ ok: true }), { open: true }],
    ['GET', '/platforms', () => [...hub.platforms.values()].map(({ cfg }) => ({ id: cfg.id, adapter: cfg.adapter }))],
    ['GET', '/sessions/:token', ({ params }) => hub.session(params.token)],
    ['GET', '/sessions/:token/balance', ({ params }) => hub.balance(params.token)],
    ['POST', '/sessions/:token/tx', ({ params, body }) => hub.transact(params.token, body)],
    ['GET', '/admin/overview', ({ query }) => {
      const sessions = Object.values(hub.sessions);
      const journal = tailJsonl(join(dataDir, 'journal.jsonl'), Math.min(1000, Number(query.get('limit')) || 150));
      return {
        platforms: [...hub.platforms.values()].map(({ cfg }) => ({
          ...publicCfg(cfg),
          sessions: sessions.filter(s => s.platform === cfg.id).length,
          players: new Set(sessions.filter(s => s.platform === cfg.id).map(s => s.playerId)).size,
          lastLaunchAt: sessions.filter(s => s.platform === cfg.id).map(s => s.createdAt).sort().at(-1) || null
        })),
        freebets: Object.values(hub.freebets).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        journal
      };
    }]
  ], { key });

  // პლატფორმის მარშრუტები: თითოეული ადაპტერის routes, პრეფიქსით /p/:platform
  const platformRouters = new Map();
  const platformHandler = id => {
    if (!platformRouters.has(id)) {
      const { adapter } = hub.platform(id);
      const base = `/p/${id}`;
      const inner = router(adapter.routes.map(([m, p, fn]) => [m, base + p, async ctx => {
        try { return await fn(ctx); }
        catch (e) {
          const { status, body } = adapter.formatError(e);
          if (status >= 500 && !e.code) console.error(`[${id}]`, e);
          sendJson(ctx.res, status, body);
        }
      }]));
      platformRouters.set(id, inner);
    }
    return platformRouters.get(id);
  };

  const handler = (req, res) => {
    const m = req.url.match(/^\/p\/([a-z0-9-]+)(?:\/|\?|$)/);
    if (!m) return internal(req, res);
    let h;
    try { h = platformHandler(m[1]); } catch (e) { return sendJson(res, e instanceof HttpError ? e.status : 500, { error: e.message }); }
    return h(req, res);
  };

  const { server, port: p, url } = await listen(handler, { port, host });
  return {
    url, port: p, hub,
    async close() { hub.store.flush(); await new Promise(r => server.close(r)); server.closeAllConnections?.(); }
  };
}

/** პლატფორმების კონფიგურაცია: INTEGRATIONS (JSON) ან INTEGRATIONS_FILE (გზა JSON ფაილამდე) */
export async function loadPlatforms(env) {
  if (env.INTEGRATIONS) return JSON.parse(env.INTEGRATIONS);
  if (env.INTEGRATIONS_FILE) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(env.INTEGRATIONS_FILE, 'utf8'));
  }
  return [];
}
