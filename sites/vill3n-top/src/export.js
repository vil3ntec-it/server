'use strict';
// خروجی ایستا: یک پوشهٔ آماده برای هاست‌هایی که Node ندارند (فقط فایل می‌پذیرند).
// صفحه‌ها، تصویرها و آخرین نسخهٔ هر برنامه در آن هست. سفارش‌ها به واتساپ می‌روند و پنل روی سرور اصلی می‌ماند.
const fs = require('fs');
const path = require('path');
const views = require('./views');
const { latestByPlatform } = require('./core/model');

const HTACCESS = `Options -Indexes
ErrorDocument 404 /404.html
DirectoryIndex index.html
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "DENY"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
  <FilesMatch "\\.(css|js|woff2|ttf|svg|png|jpg|webp|gif)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json image/svg+xml
</IfModule>
AddType application/vnd.android.package-archive .apk
AddType font/woff2 .woff2
AddType application/manifest+json .webmanifest
`;

function copyDir(src, dest, filter) {
  let n = 0;
  if (!fs.existsSync(src)) return n;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const a = path.join(src, f), b = path.join(dest, f);
    const st = fs.statSync(a);
    if (st.isDirectory()) n += copyDir(a, b, filter);
    else if (!filter || filter(f)) { fs.copyFileSync(a, b); n++; }
  }
  return n;
}

async function buildExport({ db, files, assets, env, dataDir }) {
  const root = path.join(dataDir, 'export', 'site');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const e = env({ static: true });
  const s = db.data.settings;
  const write = (rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };

  let pages = 0, bytes = 0, fileCount = 0;
  write('index.html', views.home(e)); pages++;
  write('404.html', views.errorPage(e, 404, '')); pages++;
  const used = new Set();
  // تصویرهای داخل «بخش‌های صفحه» هم باید همراه خروجی بروند
  const blockImages = (blocks) => { for (const b of Array.isArray(blocks) ? blocks : []) for (const m of b ? [b.image, b.video, b.poster] : []) if (m && m.file) used.add(m.file); };
  blockImages(e.home && e.home.blocks);
  for (const pg of e.pages || []) {
    write(`p/${pg.slug}/index.html`, views.customPage(e, pg)); pages++;
    blockImages(pg.blocks);
  }
  for (const app of e.apps) {
    write(`app/${app.slug}/index.html`, views.appPage(e, app)); pages++;
    if (app.icon) used.add(app.icon);
    for (const sh of app.screenshots) used.add(sh.file);
    blockImages(app.blocks);
    if (app.status !== 'published') continue;
    for (const v of Object.values(latestByPlatform(app))) {
      const src = files.filePath(v);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(root, 'files', views.staticFile(app, v));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      bytes += v.size; fileCount++;
    }
  }
  copyDir(assets.dir, path.join(root, 'assets'), (f) => !/^admin\./.test(f));
  for (const name of used) { const src = files.imagePath(name); if (fs.existsSync(src)) { fs.mkdirSync(path.join(root, 'media'), { recursive: true }); fs.copyFileSync(src, path.join(root, 'media', name)); } }
  write('.htaccess', HTACCESS);
  // فایل‌های دانلود: در جست‌وجو نیایند و همیشه دانلود شوند (حتی اگر HTML باشند)
  write('files/.htaccess', '<IfModule mod_headers.c>\n  Header set X-Robots-Tag "noindex"\n  Header set Content-Disposition "attachment"\n</IfModule>\n');
  write('robots.txt', `User-agent: *\nDisallow: /files/\nSitemap: ${s.siteUrl.replace(/\/+$/, '')}/sitemap.xml\n`);
  write('sitemap.xml', views.sitemap(e).replace(/<url><loc>[^<]*\/check<\/loc><\/url>\n?/, ''));
  write('site.webmanifest', JSON.stringify({ name: `${s.brand} — ${s.slogan}`, short_name: s.brand, lang: 'fa', dir: 'rtl', start_url: '/', display: 'browser', background_color: '#000000', theme_color: '#000000' }));
  return { pages, files: fileCount, bytes, dir: root, at: new Date().toISOString() };
}

module.exports = { buildExport };
