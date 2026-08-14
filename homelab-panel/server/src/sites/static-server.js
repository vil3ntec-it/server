// ---------------------------------------------------------------------------
// سرور استاتیکِ سبک برای سایت‌هایی که فقط فایل HTML/CSS/JS دارند.
// به‌صورت یک پروسهٔ جدا برای هر سایت اجرا می‌شود (پوشه و پورت از آرگومان‌ها).
//   node static-server.js <root> <port>
// ---------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  } catch {
    res.writeHead(400);
    return res.end('bad request');
  }

  let file = path.join(root, pathname);
  // جلوگیری از خروج از ریشه
  if (!file.startsWith(root)) {
    res.writeHead(403);
    console.error(`[403] ${req.method} ${pathname}`);
    return res.end('forbidden');
  }

  try {
    let st = await fsp.stat(file).catch(() => null);
    if (st?.isDirectory()) {
      const indexFile = path.join(file, 'index.html');
      if (fs.existsSync(indexFile)) {
        file = indexFile;
        st = await fsp.stat(file);
      }
    }
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      console.error(`[404] ${req.method} ${pathname}`);
      return res.end('404 not found');
    }

    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
    console.log(`[200] ${req.method} ${pathname} (${Date.now() - started}ms)`);
  } catch (e) {
    res.writeHead(500);
    console.error(`[500] ${req.method} ${pathname} — ${e.message}`);
    res.end('server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`static server listening on port ${port} — root: ${root}`);
});

server.on('error', (e) => {
  console.error(`static server error: ${e.message}`);
  process.exit(1);
});
