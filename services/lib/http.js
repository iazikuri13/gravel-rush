// სერვისებს შორის კომუნიკაცია: HTTP/JSON ბრძანებებისთვის, SSE მოვლენებისთვის.
// გარე დამოკიდებულებების გარეშე — მხოლოდ Node-ის http და fetch.
import { createServer, request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
  /** code — მანქანურად წასაკითხი მიზეზი (მაგ. INSUFFICIENT_FUNDS), სერვისებს შორის გადაეცემა */
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}

/** შიდა API დაცულია საერთო გასაღებით (x-internal-key) */
export function checkKey(req, key) {
  const got = Buffer.from(String(req.headers['x-internal-key'] || ''));
  const want = Buffer.from(key);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, 'unauthorized');
}

/**
 * მარტივი მარშრუტიზატორი.
 * routes: [['GET', '/rounds/:n', async ({ params, body, query, req, res }) => result]]
 * დაბრუნებული ობიექტი JSON-ად იგზავნება; undefined — ნიშნავს, რომ handler-მა პასუხი თავად დაწერა.
 */
export function router(routes, { key } = {}) {
  const compiled = routes.map(([method, path, fn, opts = {}]) => {
    const names = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    return { method, re, names, fn, open: !!opts.open };
  });
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      const route = compiled.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new HttpError(404, 'not found');
      if (key && !route.open) checkKey(req, key);
      const m = url.pathname.match(route.re);
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readJson(req) : undefined;
      const out = await route.fn({ params, body, query: url.searchParams, req, res });
      if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) sendJson(res, e.status, e.code ? { error: e.message, code: e.code } : { error: e.message });
      else { console.error(e); sendJson(res, 500, { error: 'სერვერის შეცდომა' }); }
    }
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 16384) { reject(new HttpError(413, 'too large')); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new HttpError(400, 'invalid json')); }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function listen(handler, { port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({ server, port: p, url: `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${p}` });
    });
  });
}

/** SSE მოვლენების გამომცემი */
export class EventHub {
  constructor() { this.clients = new Set(); this.ping = setInterval(() => this.#write(':ping\n\n'), 15000); this.ping.unref(); }
  handle(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(':ok\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }
  emit(type, data) { this.#write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  #write(s) { for (const r of this.clients) r.write(s); }
  close() { clearInterval(this.ping); for (const r of this.clients) r.end(); this.clients.clear(); }
}

/**
 * SSE გამოწერა ავტომატური ხელახალი დაკავშირებით.
 * onEvent(type, data) — ყოველი მოვლენისთვის; onOpen() — ყოველი (ხელახალი) დაკავშირებისას.
 */
export function subscribe(url, key, onEvent, { onOpen, retryMs = 500 } = {}) {
  let closed = false, req = null, firstOpen;
  const opened = new Promise(r => { firstOpen = r; });
  const connect = () => {
    if (closed) return;
    req = httpRequest(url, { headers: { accept: 'text/event-stream', 'x-internal-key': key } }, res => {
      if (res.statusCode !== 200) { res.resume(); return retry(); }
      onOpen?.(); firstOpen();
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let type = 'message', data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) type = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (data) {
            try { onEvent(type, JSON.parse(data)); } catch (e) { console.error('SSE handler:', e); }
          }
        }
      });
      res.on('end', retry);
      res.on('error', retry);
    });
    req.on('error', retry);
    req.end();
  };
  let retrying = false;
  const retry = () => {
    if (closed || retrying) return;
    retrying = true;
    setTimeout(() => { retrying = false; connect(); }, retryMs);
  };
  connect();
  return { opened, close() { closed = true; req?.destroy(); } };
}

/** შიდა API-ს კლიენტი: შეცდომისას აგდებს HttpError-ს სერვისის შეტყობინებით */
export function apiClient(baseUrl, key) {
  const call = async (method, path, body) => {
    const r = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status, data.error || `HTTP ${r.status}`, data.code);
    return data;
  };
  return {
    get: p => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    patch: (p, b = {}) => call('PATCH', p, b),
    del: p => call('DELETE', p, {})
  };
}
