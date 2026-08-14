// ═══════════════════════════════════════════════════════════════════════════
//  تست‌های «فقط‌خواندنی» — اثباتِ اینکه AI هیچ CREATE/UPDATE/DELETE ندارد
//
//  این پرونده مستقیماً بندهای ۲۶ تا ۲۹ خواستهٔ پروژه را بررسی می‌کند.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert, assertEqual } from './helpers.mjs';
import { TOOLS, CLIENT_TOOLS, TOOL_BY_NAME, toolSchemasFor } from '../src/agent/tools/registry.js';
import { callTool, activeTools } from '../src/agent/tools/router.js';
import { registerAllSources } from '../src/gateway/sources.js';
import { listSources, assertGatewayIsReadOnly, readSource, registerSource, _clearSources } from '../src/gateway/readonly.js';
import { loadKnowledgeBase } from '../src/kb/loader.js';
import { Retriever } from '../src/rag/retriever.js';
import { scanSourceForBannedApis } from '../src/security/guard.js';
import config, { ROOT } from '../src/config.js';

/** کلماتی که وجودشان در نامِ یک ابزار یعنی احتمالِ نوشتن */
const WRITE_WORDS = ['create', 'update', 'delete', 'remove', 'write', 'set', 'add', 'edit',
                     'modify', 'insert', 'drop', 'reset', 'change', 'grant', 'revoke', 'exec', 'run'];

export default async function run() {
  const { docs, chunks } = loadKnowledgeBase();
  const index = { docs, chunks };
  const retriever = new Retriever(chunks);
  const ctx = { level: 'ADMIN', user: 'test', index, retriever };

  suite('هیچ ابزارِ نوشتنی وجود ندارد');

  test('همهٔ ابزارها readOnly === true هستند', () => {
    for (const t of TOOLS) {
      assertEqual(t.readOnly, true, `ابزارِ ${t.name} فقط‌خواندنی نیست`);
    }
  });

  test('هیچ نامِ ابزاری بوی نوشتن نمی‌دهد', () => {
    for (const t of TOOLS) {
      for (const w of WRITE_WORDS) {
        assert(!t.name.toLowerCase().includes(w),
          `نامِ ابزارِ «${t.name}» شاملِ «${w}» است — اگر واقعاً فقط‌خواندنی است، اسمش را عوض کن`);
      }
    }
  });

  test('کدِ هیچ ابزاری روی دیسک نمی‌نویسد', () => {
    const dir = path.join(ROOT, 'src', 'agent', 'tools');
    for (const f of fs.readdirSync(dir)) {
      if (!/\.js$/.test(f)) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const bad of ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'mkdirSync', 'createWriteStream']) {
        assert(!code.includes(bad), `${f} از ${bad} استفاده می‌کند`);
      }
    }
  });

  test('ابزارِ خارج از whitelist اجرا نمی‌شود', async () => {
    const res = await callTool('delete_everything', {}, ctx);
    assert(!res.ok, 'ابزارِ ناشناخته اجرا شد');
    assert(res.error.includes('مجاز'), res.error);
  });

  test('ابزارِ تعریف‌شده ولی whitelist‌نشده اجرا نمی‌شود', async () => {
    const saved = [...config.tools.whitelist];
    config.tools.whitelist = saved.filter(n => n !== 'get_shortcuts');
    try {
      const res = await callTool('get_shortcuts', {}, ctx);
      assert(!res.ok, 'ابزارِ whitelist‌نشده اجرا شد — این یعنی whitelist بی‌اثر است');
    } finally {
      config.tools.whitelist = saved;
    }
  });

  test('ابزارِ readOnly:false اجرا نمی‌شود حتی اگر whitelist باشد', async () => {
    const fake = { name: 'get_shortcuts', readOnly: false, minLevel: 'PUBLIC', schema: { type: 'object', properties: {} }, handler: () => 'نباید اجرا شود' };
    const original = TOOL_BY_NAME.get('get_shortcuts');
    TOOL_BY_NAME.set('get_shortcuts', fake);
    try {
      const res = await callTool('get_shortcuts', {}, ctx);
      assert(!res.ok, 'ابزارِ غیرِ فقط‌خواندنی اجرا شد');
      assert(res.error.includes('فقط‌خواندنی'), res.error);
    } finally {
      TOOL_BY_NAME.set('get_shortcuts', original);
    }
  });

  test('ابزار با سطحِ دسترسیِ ناکافی اجرا نمی‌شود', async () => {
    const original = TOOL_BY_NAME.get('get_shortcuts');
    TOOL_BY_NAME.set('get_shortcuts', { ...original, minLevel: 'ADMIN' });
    try {
      const res = await callTool('get_shortcuts', {}, { ...ctx, level: 'PUBLIC' });
      assert(!res.ok, 'ابزارِ سطحِ بالا برای کاربرِ عادی اجرا شد');
    } finally {
      TOOL_BY_NAME.set('get_shortcuts', original);
    }
  });

  test('آرگومانِ نامعتبر رد می‌شود', async () => {
    const res = await callTool('search_knowledge_base', { query: '' }, ctx);
    assert(!res.ok, 'پرسشِ خالی پذیرفته شد');
  });

  test('فیلدِ اضافه در آرگومان‌ها دور ریخته می‌شود', async () => {
    // مدل می‌تواند فیلدِ من‌درآوردی بسازد؛ نباید به handler برسد
    const res = await callTool('search_knowledge_base', { query: 'میانبر', __proto__: { x: 1 }, danger: 'rm -rf' }, ctx);
    assert(res.ok, res.error);
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('دروازه فقط GET است');

  test('همهٔ منابع GET هستند', () => {
    _clearSources();
    registerAllSources();
    assertGatewayIsReadOnly();
    for (const s of listSources()) assertEqual(s.method, 'GET', `منبعِ ${s.name}`);
  });

  test('ثبتِ منبع با متدِ نوشتنی خطا می‌دهد', () => {
    let threw = false;
    try { registerSource('bad', { method: 'POST', handler: () => {} }); } catch { threw = true; }
    assert(threw, 'منبعِ POST ثبت شد — دروازه بی‌اثر است');
  });

  test('منابع واقعاً داده برمی‌گردانند', async () => {
    const out = await readSource('shortcuts', { level: 'USER', query: {}, ctx: { index, retriever } });
    assert(out.ok, out.error);
    assert(out.data.shortcuts.length > 0, 'هیچ میانبری برنگشت');
  });

  test('منبعِ ناموجود ۴۰۴ می‌دهد', async () => {
    const out = await readSource('secrets', { level: 'ADMIN', query: {}, ctx: { index, retriever } });
    assert(!out.ok);
    assertEqual(out.status, 404);
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('عدمِ دسترسی به دیتابیسِ اصلی و به Shell');

  test('هیچ‌جای سرویس اجرای دستور نیست', () => {
    const hits = scanSourceForBannedApis();
    assert(hits.length === 0, 'ردِ اجرای دستور: ' + hits.map(h => `${h.file} (${h.why})`).join('، '));
  });

  test('هیچ‌جای سرویس به سرورِ برنامه وصل نمی‌شود', () => {
    const bad = [];
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.js$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        // پورتِ سرورِ اصلی، WebSocket، و مسیرِ دادهٔ برنامه
        if (/\b8787\b/.test(code)) bad.push(`${e.name}: پورتِ سرورِ اصلی`);
        if (/\bnew\s+WebSocket\b|\bfrom\s+['"]ws['"]/.test(code)) bad.push(`${e.name}: WebSocket`);
        if (/server\/data|server[\\/]+data/.test(code) && !/FORBIDDEN|ممنوع/.test(src)) bad.push(`${e.name}: مسیرِ دادهٔ برنامه`);
      }
    };
    walk(path.join(ROOT, 'src'));
    assert(bad.length === 0, bad.join('، '));
  });

  test('ابزارها فقط از دانش می‌خوانند، نه از دادهٔ زنده', async () => {
    // اگر ابزاری روزی به دادهٔ واقعی وصل شود، این تست باید عمداً شکسته شود
    for (const name of config.tools.whitelist) {
      const res = await callTool(name, defaultArgsFor(name), ctx);
      if (!res.ok) continue;
      const json = JSON.stringify(res.result);
      assert(!/"balance"|"debtPersons"|الباقیِ واقعی/.test(json), `ابزارِ ${name} چیزی شبیهِ دادهٔ زنده برگرداند`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('QR فقط برای لینکِ رسمی');

  test('لینکِ رسمی QR می‌گیرد', async () => {
    const res = await callTool('generate_qr', { target: 'yaqobipump.top' }, ctx);
    assert(res.ok, res.error);
    assert(res.result.ok, res.result.reason);
    assertEqual(res.result.render, 'qr');
  });

  test('آدرسِ غریبه QR نمی‌گیرد', async () => {
    for (const bad of ['https://evil.example.com/steal', 'http://192.168.1.1/admin', 'javascript:alert(1)']) {
      const res = await callTool('generate_qr', { target: bad }, ctx);
      assert(res.ok, 'ابزار خطا داد به‌جای ردِ محترمانه');
      assert(res.result.ok === false, `برای «${bad}» کد ساخته شد`);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('ابزارهای سمتِ دستگاه (اعدادِ حساب‌ها)');

  test('ابزارهای سمتِ دستگاه هم فقط‌خواندنی‌اند', () => {
    for (const t of CLIENT_TOOLS) {
      assertEqual(t.readOnly, true, `${t.name} فقط‌خواندنی نیست`);
      assertEqual(t.clientSide, true, `${t.name} علامتِ سمتِ دستگاه ندارد`);
    }
  });

  test('سرور آن‌ها را اجرا نمی‌کند — فقط واگذار می‌کند', async () => {
    const res = await callTool('get_account_balance', { name: 'احمد' }, ctx);
    assert(res.deferred === true, 'سرور خودش خواست اجرایش کند');
    assert(res.ok === false, 'نباید نتیجهٔ آماده برگرداند');
    assertEqual(res.tool, 'get_account_balance');
  });

  test('هیچ ابزارِ سمتِ دستگاه روی سرور پیاده‌سازی ندارد', () => {
    // اگر روزی کسی handler برایشان بنویسد، یعنی داده روی سرور خوانده می‌شود
    for (const t of CLIENT_TOOLS) {
      assertEqual(typeof t.handler, 'undefined', `${t.name} روی سرور handler دارد`);
    }
  });

  test('واگذاری هم از whitelist و سطحِ دسترسی رد می‌شود', async () => {
    // جست‌وجوی سراسری فقط مدیر
    const asUser = await callTool('search_app_data', { query: 'احمد' }, { ...ctx, level: 'USER' });
    assert(!asUser.deferred, 'برای کاربرِ عادی واگذار شد');
    assert(!asUser.ok);
    const asAdmin = await callTool('search_app_data', { query: 'احمد' }, ctx);
    assert(asAdmin.deferred, 'برای مدیر واگذار نشد');
  });

  test('آرگومانِ نامعتبر پیش از رفتن به دستگاه رد می‌شود', async () => {
    const res = await callTool('get_account_balance', { name: 'ا' }, ctx);
    assert(!res.deferred && !res.ok, 'نامِ خیلی کوتاه به دستگاه رفت');
  });

  test('ابزارِ سمتِ دستگاه هم اسمِ نوشتنی ندارد', () => {
    for (const t of CLIENT_TOOLS) {
      for (const w of WRITE_WORDS) {
        // «get_» و «list_» و «search_» مجازند؛ بقیهٔ فعل‌ها نه
        if (t.name.startsWith('get_') || t.name.startsWith('list_') || t.name.startsWith('search_')) continue;
        assert(!t.name.toLowerCase().includes(w), `${t.name} شاملِ «${w}» است`);
      }
    }
  });

  test('طرحِ ابزارها فقط شاملِ ابزارهای مجاز است', () => {
    const schemas = toolSchemasFor('PUBLIC', config.tools.whitelist);
    assertEqual(schemas.length, activeTools('PUBLIC').length);
    for (const s of schemas) assert(config.tools.whitelist.includes(s.function.name));
  });
}

function defaultArgsFor(name) {
  switch (name) {
    case 'search_knowledge_base':
    case 'search_documentation':
    case 'search_faq': return { query: 'میانبر' };
    case 'get_feature_info': return { feature: 'میانبرها' };
    case 'generate_qr': return { target: 'yaqobipump.top' };
    default: return {};
  }
}
