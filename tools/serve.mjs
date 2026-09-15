// 本地静态服务（浏览器测试用）：node tools/serve.mjs [port] [root]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const port = Number(process.argv[2] || 8080);
const root = process.argv[3] || process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  try {
    const p = decodeURIComponent((req.url || '/').split('?')[0]);
    let f = normalize(join(root, p));
    if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    const st = await stat(f).catch(() => null);
    if (st && st.isDirectory()) f = join(f, 'index.html');
    const buf = await readFile(f);
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); }
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on http://127.0.0.1:' + port));
