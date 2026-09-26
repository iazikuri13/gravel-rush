// JSONL ჟურნალის ბოლო ჩანაწერები (ადმინისთვის). ფაილი შეიძლება დიდი იყოს — ვკითხულობთ ბოლოდან.
import { openSync, readSync, fstatSync, closeSync, existsSync } from 'node:fs';

export function tailJsonl(path, limit = 100, filter = null) {
  if (!existsSync(path)) return [];
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size, out = [];
    let pos = size, rest = '';
    const chunk = 64 * 1024;
    while (pos > 0 && out.length < limit) {
      const n = Math.min(chunk, pos); pos -= n;
      const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, pos);
      const lines = (buf.toString('utf8') + rest).split('\n');
      rest = lines.shift();
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue;
        try { const o = JSON.parse(lines[i]); if (!filter || filter(o)) out.push(o); } catch {}
      }
    }
    if (pos === 0 && rest && out.length < limit) { try { const o = JSON.parse(rest); if (!filter || filter(o)) out.push(o); } catch {} }
    return out;
  } finally { closeSync(fd); }
}

/** მთელი ჟურნალის წაკითხვა თანმიმდევრობით (სტატისტიკისთვის) */
export function* readJsonl(path) {
  if (!existsSync(path)) return;
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size, chunk = 256 * 1024;
    let pos = 0, rest = '';
    while (pos < size) {
      const n = Math.min(chunk, size - pos);
      const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, pos); pos += n;
      const lines = (rest + buf.toString('utf8')).split('\n');
      rest = lines.pop();
      for (const l of lines) if (l) { try { yield JSON.parse(l); } catch {} }
    }
    if (rest) { try { yield JSON.parse(rest); } catch {} }
  } finally { closeSync(fd); }
}
