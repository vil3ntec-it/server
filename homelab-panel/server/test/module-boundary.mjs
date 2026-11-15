// ---------------------------------------------------------------------------
//  🏪 مرزِ ماژولِ جداشدنیِ «فروشگاه» — روی خودِ کد (وب و سرور)، در ‎npm test‎      node test/module-boundary.mjs
//
//  قاعده (‎docs/SHOP-MODULE-fa.md‎، بخشِ «بخشِ فروشگاه جداشدنی است» ِ ‎docs/RULES-fa.md‎):
//    ⛔ هیچ فایلی بیرون از ‎modules/shop/‎ از درونش وارد نمی‌کند — جز فهرستِ ماژول‌ها (‎modules/registry.*‎).
//    ⛔ هیچ فایلی درونِ ‎modules/shop/‎ از پنل وارد نمی‌کند — فقط ‎./‎ ِ خودش، میزبان (‎host.ts‎ / ‎host.js‎) و بسته‌های npm.
//       خودِ میزبان درِ پنل است؛ ‎standalone/‎ (میزبانِ ساختِ جدا) فقط تکه‌های ‎shared-pieces.json‎ را می‌گیرد.
//    ⛔ دو تابعِ کپی‌شدهٔ ‎reasonOk‎/‎newIdemKey‎ (ماژول ⇄ ‎parts.tsx‎ ِ مشترک) یکی می‌مانند.
//  و جهش‌ها: همان سنجه روی چند فایلِ ساختگی که عمداً مرز را می‌شکنند باید سرخ شود (سنجهٔ پوچ نیست).
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const here = import.meta.dirname;
const SERVER = path.resolve(here, '..');
const WEB = path.resolve(here, '..', '..', 'web');
const WEB_SRC = path.join(WEB, 'src');
const SERVER_SRC = path.join(SERVER, 'src');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 1200)}`);
};

/* ─────────────── خواندنِ وارد کردن‌ها (ایستا، پویا، ‎export … from‎، ‎import.meta.glob‎) ─────────────── */
const SPEC_RE = [
  /(?:^|[\s;])import\s+(type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|[\s;])export\s+(type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*()['"]([^'"]+)['"]\s*\)/g,
  /\bimport\.meta\.glob(?:<[^>]*>)?\(\s*()['"]([^'"]+)['"]/g,
];
/** توضیح‌ها بیرون (نشانیِ پرونده در توضیح وارد کردن نیست) */
//  اول توضیحِ تک‌خطی، بعد بلوکی: «`/shop/*`» درونِ یک توضیحِ ‎//‎ (app.js ِ سرورِ حساب، شعبه‌ها) آغازِ بلوک خوانده می‌شد و تا ‎*/‎ ِ
//  بعدی همه‌چیز — از جمله ‎api.use('/admin/trust', …)‎ — از جدولِ نقش می‌افتاد
const bare = (src) => src.replace(/(^|[^:'"`\\/*])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
function importsOf(src) {
  const out = [];
  const s = bare(src);
  for (const re of SPEC_RE) for (const m of s.matchAll(re)) out.push({ spec: m[2], typeOnly: Boolean(m[1]) });
  return out;
}

const TS_EXT = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const JS_EXT = ['', '.js', '/index.js'];
/** نشانیِ نسبی ⇒ پروندهٔ واقعی (نسبت به ریشه)، با فهرستِ پرونده‌ها (واقعی یا ساختگیِ جهش) */
function resolveRel(files, fromRel, spec, exts) {
  if (spec.includes('*')) return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));   //  glob ⇒ همان الگو
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  for (const e of exts) if (files.has(base + e)) return base + e;
  return base;
}

function walk(root, exts) {
  const map = new Map();
  const go = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') go(f); }
      else if (exts.some((x) => e.name.endsWith(x))) map.set(path.relative(root, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8'));
    }
  };
  go(root);
  return map;
}

/**
 *  سنجهٔ مرز روی یک فهرستِ پرونده: ‎{ rel → متن }‎. ‎side‎: ‎web‎ | ‎server‎.
 *  برمی‌گرداند: ‎{ inward: […], outward: […], standalone: […], npm: […] }‎ (هر کدام «پرونده ⇒ نشانی»).
 */
function boundary(files, side, { packages, shared = new Set() }) {
  const MOD = 'modules/shop/';
  const REGISTRY = side === 'web' ? 'modules/registry.ts' : 'modules/registry.js';
  const HOST = side === 'web' ? 'modules/shop/host.ts' : 'modules/shop/host.js';
  const exts = side === 'web' ? TS_EXT : JS_EXT;
  const keys = new Set(files.keys());
  const bad = { inward: [], outward: [], standalone: [], npm: [] };
  for (const [rel, src] of files) {
    const inside = rel.startsWith(MOD);
    const isStandalone = rel.startsWith(MOD + 'standalone/');
    for (const { spec, typeOnly } of importsOf(src)) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const to = spec.startsWith('/') ? spec.replace(/^\/+/, '') : resolveRel(keys, rel, spec, exts);
        const toInside = to.startsWith(MOD);
        if (!inside && toInside && rel !== REGISTRY) bad.inward.push(`${rel} ⇒ ${spec}`);
        if (inside && !toInside && rel !== HOST && !isStandalone) bad.outward.push(`${rel} ⇒ ${spec}`);
        if (isStandalone && !toInside && !shared.has(to)) bad.standalone.push(`${rel} ⇒ ${spec}`);
        //  میزبانِ ساختِ جدا جای میزبانِ پنل است؛ فقط نوع از آن (برای سنجهٔ ‎host.check.ts‎)
        if (isStandalone && to === HOST && !typeOnly) bad.standalone.push(`${rel} ⇒ ${spec} (میزبانِ پنل، نه فقط نوع)`);
      } else if (inside) {
        const name = spec.startsWith('node:') ? 'node:' : spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const ok = name === 'node:' ? side === 'server' : builtinModules.includes(name) ? side === 'server' : packages.has(name);
        if (!ok) bad.npm.push(`${rel} ⇒ ${spec}`);
      }
    }
  }
  return bad;
}

const pkgs = (dir) => {
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return new Set([...Object.keys(p.dependencies || {}), ...Object.keys(p.devDependencies || {})]);
};
const WEB_PKGS = pkgs(WEB);
const SERVER_PKGS = pkgs(SERVER);
const SHARED = new Set(JSON.parse(fs.readFileSync(path.join(WEB_SRC, 'modules', 'shop', 'standalone', 'shared-pieces.json'), 'utf8')).files);

/* ═════════════════════════════ وب ═════════════════════════════ */
console.log('\n══ مرزِ ماژولِ «فروشگاه» — وب (web/src/modules/shop) ══\n');
const web = walk(WEB_SRC, ['.ts', '.tsx']);
const webMod = [...web.keys()].filter((f) => f.startsWith('modules/shop/'));
check('ماژول پیدا شد (پوسته، زیرماژول‌ها، میزبان، شناسنامه)', webMod.length > 50 && web.has('modules/shop/host.ts') && web.has('modules/shop/index.ts')
  && web.has('modules/shop/console/Shell.tsx'), String(webMod.length));
const wb = boundary(web, 'web', { packages: WEB_PKGS, shared: SHARED });
check('⛔ بیرون از ماژول هیچ فایلی از درونش وارد نمی‌کند (جز modules/registry.ts)', wb.inward.length === 0, wb.inward.join(' · '));
check('⛔ درونِ ماژول فقط ./ ِ خودش و host.ts — نه App/Layout/pages/components/control/…', wb.outward.length === 0, wb.outward.join(' · '));
check('⛔ درونِ ماژول فقط بسته‌های npm ِ web/package.json', wb.npm.length === 0, wb.npm.join(' · '));
check('⛔ ساختِ جدا (standalone/) از پنل فقط تکه‌های shared-pieces.json', wb.standalone.length === 0, wb.standalone.join(' · '));
const registry = web.get('modules/registry.ts') || '';
check('ثبت در پنل یک ورود است: modules/registry.ts ⇐ ./shop', /import shop from '\.\/shop';/.test(registry) && /PANEL_MODULES: readonly PanelModule\[\] = \[shop\]/.test(registry));
const appSrc = web.get('App.tsx') || '';
const layoutSrc = web.get('components/Layout.tsx') || '';
check('App.tsx مسیرها و Layout.tsx منو را فقط از فهرستِ ماژول‌ها می‌گیرند (نه نامِ ماژول)',
  /from '\.\/modules\/registry'/.test(appSrc) && /from '\.\.\/modules\/registry'/.test(layoutSrc)
  && !/modules\/shop/.test(bare(appSrc)) && !/modules\/shop/.test(bare(layoutSrc)));
const shared = [...SHARED].filter((f) => !web.has(f) && !fs.existsSync(path.join(WEB_SRC, f)));
check('هر تکهٔ shared-pieces.json واقعاً هست (فهرستِ «کپی شوند» کهنه نیست)', shared.length === 0, shared.join(' '));
check('⛔ هیچ صفحهٔ فقط‌پنل در shared-pieces.json نیست (ترمینال، فایل‌ها، پمپ‌ها، کنترل…)',
  ![...SHARED].some((f) => /^pages\/(?!account\/)/.test(f) || f === 'App.tsx' || f === 'main.tsx' || f === 'components/Layout.tsx'));

//  دو کپیِ ‎reasonOk‎ و ‎newIdemKey‎ یکی‌اند (بدنهٔ تابع، بی توضیح و فاصله)
const fnBody = (src, name) => {
  const s = bare(src);
  const i = s.search(new RegExp(`function ${name}\\(`));
  if (i < 0) return null;
  let depth = 0, j = s.indexOf('{', i);
  for (let k = j; k < s.length; k++) { if (s[k] === '{') depth++; else if (s[k] === '}' && --depth === 0) return s.slice(i, k + 1).replace(/^export\s+/, '').replace(/\s+/g, ' '); }
  return null;
};
const modData = web.get('modules/shop/consoleData.ts') || '';
const partsSrc = web.get('pages/account/console/parts.tsx') || '';
check('⛔ reasonOk و newIdemKey ِ ماژول و parts.tsx ِ مشترک یکی‌اند',
  ['reasonOk', 'newIdemKey'].every((n) => fnBody(modData, n) && fnBody(modData, n) === fnBody(partsSrc, n).replace(/^export\s+/, '')),
  ['reasonOk', 'newIdemKey'].map((n) => `${fnBody(modData, n)} ≠ ${fnBody(partsSrc, n)}`).join(' | '));
const nodeRead = ['modules/shop/consoleData.ts', 'modules/shop/market/marketData.ts', 'modules/shop/consoleOpsI18n.ts'];
check('⛔ consoleData.ts، marketData.ts و consoleOpsI18n.ts بی وارد کردن می‌مانند (آزمون‌ها با خودِ Node می‌خوانندشان)',
  nodeRead.every((f) => web.has(f) && importsOf(web.get(f)).length === 0), nodeRead.filter((f) => !web.has(f) || importsOf(web.get(f)).length).join(' '));

/* ═════════════════════════════ سرور ═════════════════════════════ */
console.log('\n══ مرزِ ماژولِ «فروشگاه» — سرور (server/src/modules/shop) ══\n');
const srv = walk(SERVER_SRC, ['.js', '.mjs']);
const srvMod = [...srv.keys()].filter((f) => f.startsWith('modules/shop/'));
check('ماژولِ سرور پیدا شد (درهای کنسول، فهرستِ زیرماژول‌ها، میزبان، شناسنامه)', srvMod.length >= 15 && srv.has('modules/shop/host.js')
  && srv.has('modules/shop/index.js') && srv.has('modules/shop/console/modules.js'), String(srvMod.length));
const sb = boundary(srv, 'server', { packages: SERVER_PKGS });
check('⛔ بیرون از ماژول هیچ فایلی از درونش وارد نمی‌کند (جز src/modules/registry.js)', sb.inward.length === 0, sb.inward.join(' · '));
check('⛔ درونِ ماژول فقط ./ ِ خودش و host.js — نه db/roles/cloud/… مستقیم', sb.outward.length === 0, sb.outward.join(' · '));
check('⛔ درونِ ماژول فقط node:* و بسته‌های npm ِ server/package.json', sb.npm.length === 0, sb.npm.join(' · '));
const adminSrc = srv.get('routes/account-admin.js') || '';
check('پلِ سرورِ حساب ماژول را فقط با mountModules و MODULE_CAPABILITIES می‌شناسد',
  /import \{ MODULE_CAPABILITIES, mountModules \} from '\.\.\/modules\/registry\.js'/.test(adminSrc) && /mountModules\(router, \{/.test(adminSrc)
  && /\.\.\.MODULE_CAPABILITIES/.test(adminSrc) && !/console-(shell|market|ops|parity|staff)\.js/.test(bare(adminSrc)));
check('⛔ پمپ دست نخورد: هیچ درِ پمپ/ایستگاه در ماژولِ فروشگاه نیست',
  !srvMod.some((f) => /station|pump/i.test(f)) && !webMod.some((f) => /station|pump/i.test(f)));

/* ═════════════════════ جهش: سنجه پوچ نیست ═════════════════════ */
console.log('\n── جهش‌ها: مرزِ شکسته باید سرخ شود ──\n');
const mutate = (files, side, opts, add) => boundary(new Map([...files, ...Object.entries(add)]), side, opts);
const kills = [
  ['صفحهٔ پنل از درونِ ماژول وارد می‌کند', () => mutate(web, 'web', { packages: WEB_PKGS, shared: SHARED }, { 'pages/Sites.tsx': (web.get('pages/Sites.tsx') || '') + "\nimport { ShopsTab } from '../modules/shop/ShopConsole';\n" }).inward.length > 0],
  ['ماژول مستقیم از پنل وارد می‌کند (نه از host)', () => mutate(web, 'web', { packages: WEB_PKGS, shared: SHARED }, { 'modules/shop/Evil.tsx': "import { useApp } from '../../app-context';\n" }).outward.length > 0],
  ['ماژول با import() ِ پویا از پنل', () => mutate(web, 'web', { packages: WEB_PKGS, shared: SHARED }, { 'modules/shop/console/Evil.tsx': "const T = () => import('../../../pages/Terminal');\n" }).outward.length > 0],
  ['ماژول با export … from از پنل', () => mutate(web, 'web', { packages: WEB_PKGS, shared: SHARED }, { 'modules/shop/market/Evil.ts': "export { api } from '../../../api';\n" }).outward.length > 0],
  ['ساختِ جدا صفحهٔ فقط‌پنل می‌گیرد', () => mutate(web, 'web', { packages: WEB_PKGS, shared: SHARED }, { 'modules/shop/standalone/Evil.tsx': "import Files from '../../../pages/Files';\n" }).standalone.length > 0],
  ['ساختِ جدا میزبانِ پنل را (نه فقط نوعش) وارد می‌کند', () => mutate(web, 'web', { packages: WEB_PKGS, shared: SHARED }, { 'modules/shop/standalone/Evil2.tsx': "import { PanelUsers } from '../host';\n" }).standalone.length > 0],
  ['ماژول بستهٔ npm ِ نصب‌نشده می‌خواهد', () => mutate(web, 'web', { packages: WEB_PKGS, shared: SHARED }, { 'modules/shop/Evil3.ts': "import x from 'left-pad';\n" }).npm.length > 0],
  ['سرور: پل مستقیم از درونِ ماژول وارد می‌کند', () => mutate(srv, 'server', { packages: SERVER_PKGS }, { 'routes/evil.js': "import { mountConsoleShell } from '../modules/shop/routes/console-shell.js';\n" }).inward.length > 0],
  ['سرور: ماژول مستقیم از db.js وارد می‌کند', () => mutate(srv, 'server', { packages: SERVER_PKGS }, { 'modules/shop/routes/evil.js': "import { db } from '../../../db.js';\n" }).outward.length > 0],
];
for (const [name, killed] of kills) check(`جهش کشته شد: ${name}`, killed());

console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
