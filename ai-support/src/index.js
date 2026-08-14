// ═══════════════════════════════════════════════════════════════════════════
//  سرویسِ دستیارِ پشتیبانی — نقطهٔ ورود
//
//      node src/index.js
//
//  یک پروسهٔ مستقل روی پورتِ خودش. هیچ ارتباطی با سرورِ اصلیِ برنامه
//  (server/server.js روی 8787) ندارد و نمی‌تواند داشته باشد.
// ═══════════════════════════════════════════════════════════════════════════

import http from 'node:http';
import crypto from 'node:crypto';
import config from './config.js';
import { enforceBoundaryOrExit } from './security/guard.js';
import { sessionFromRequest, checkAppCredentials, issueSession, levelForAppRole, levelRank } from './security/auth.js';
import { checkRate } from './security/ratelimit.js';
import { readJsonBody, ValidationError, validate } from './security/validate.js';
import { audit } from './security/audit.js';
import { loadIndex } from './rag/store.js';
import { Retriever } from './rag/retriever.js';
import { SupportAgent } from './agent/agent.js';
import { registerAllSources } from './gateway/sources.js';
import { readSource, listSources, assertGatewayIsReadOnly } from './gateway/readonly.js';
import { getProvider } from './llm/provider.js';
import { llmPool } from './llm/pool.js';
import { answerCache } from './llm/cache.js';
import { startLoadMonitor, loadSnapshot } from './llm/load.js';
import { activeTools } from './agent/tools/router.js';
import { getMemory, rememberFact, forgetMemory, ALLOWED_KEYS } from './memory/memory.js';

const BANNER = `
╔═══════════════════════════════════════════════════════════╗
║   دستیارِ پشتیبانیِ پمپ یعقوبی                              ║
║   فقط‌خواندنی · جدا از برنامهٔ اصلی · بدونِ اجرای دستور      ║
╚═══════════════════════════════════════════════════════════╝`;

console.log(BANNER);
console.log('\n🔒 بررسیِ مرزِ امنیتی…');
enforceBoundaryOrExit();

// ── بارگذاریِ دانش ─────────────────────────────────────────────────────────
console.log('\n📚 بارگذاریِ دانش…');
const { index, vectors } = loadIndex();
const retriever = new Retriever(index.chunks, vectors);
console.log(`   ✅ ${index.chunks.length} چانک${vectors ? ` · ${vectors.vectors.length} بردار (${vectors.model})` : ' · بدونِ بردار'}`);

const APP_VERSION = (index.docs || []).map(d => d.version).filter(Boolean).sort().pop() || '';
const agent = new SupportAgent({ retriever, index, appVersion: APP_VERSION });

// ── دروازه ────────────────────────────────────────────────────────────────
registerAllSources();
try {
  assertGatewayIsReadOnly();
  console.log(`   ✅ دروازه فقط‌خواندنی است — ${listSources().length} منبع، همه GET`);
} catch (e) {
  console.error('\n❌ ' + e.message + '\n');
  process.exit(1);
}
console.log(`   ✅ ${activeTools().length} ابزارِ فعال، همه read-only`);

startLoadMonitor();

// ═══════════════════════════════════════════════════════════════════════════
//  کمکی‌های HTTP
// ═══════════════════════════════════════════════════════════════════════════

function send(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // هیچ صفحه‌ای از این سرویس نباید داخلِ قابِ سایتِ دیگری برود
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(body);
}

function cors(req, res) {
  const origin = req.headers.origin;
  const allowed = config.server.allowedOrigins;

  if (!origin) return true;                       // same-origin یا ابزارِ خط فرمان
  if (allowed.length && !allowed.includes(origin)) {
    audit({ kind: 'denied', where: 'cors', origin });
    send(res, 403, { error: 'این دامنه اجازهٔ دسترسی ندارد' });
    return false;
  }

  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-ai-session');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-max-age', '600');
  return true;
}

/** نشست + محدودیتِ نرخ. اگر مشکلی بود خودش جواب می‌دهد و null برمی‌گرداند. */
function gate(req, res, { requireSession = true, llm = false } = {}) {
  const s = sessionFromRequest(req);
  if (requireSession && !s.ok) {
    send(res, 401, { error: s.reason || 'نشست معتبر نیست', needSession: true });
    return null;
  }
  const session = s.ok ? s.session : { sub: ipKey(req), lvl: 'PUBLIC', role: 'guest' };

  const rate = checkRate(session.sub, { llm });
  if (!rate.ok) {
    if (rate.degrade) return { session, degrade: true };
    audit({ kind: 'rate_limit', user: session.sub, reason: rate.reason });
    send(res, 429, { error: rate.reason, retryAfter: rate.retryAfterSec }, { 'retry-after': String(rate.retryAfterSec) });
    return null;
  }
  return { session, degrade: false };
}

function ipKey(req) {
  return String(req.socket?.remoteAddress || 'unknown');
}

// ═══════════════════════════════════════════════════════════════════════════
//  مسیرها
// ═══════════════════════════════════════════════════════════════════════════

const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string', minLength: 1, maxLength: 1000 },
    history: { type: 'array', maxItems: 12 },
    // ادامهٔ گفت‌وگویی که منتظرِ دادهٔ دستگاه بود
    continuation: { type: 'string', maxLength: 64 },
    toolResults: { type: 'array', maxItems: 4 },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  انبارِ گفت‌وگوهای نیمه‌کاره
//
//  وقتی مدل دادهٔ دستگاه می‌خواهد، گفت‌وگو این‌جا نگه داشته می‌شود و فقط یک
//  شناسه به مرورگر می‌رود. دلیلش: اگر خودِ پیام‌ها را به مرورگر بدهیم، system
//  prompt و متنِ بازیابی‌شده هم می‌رود بیرون — بی‌دلیل و قابلِ دست‌کاری.
//
//  عمرِ کوتاه و سقفِ تعداد دارد تا به نشتِ حافظه تبدیل نشود.
// ═══════════════════════════════════════════════════════════════════════════
const PENDING_TTL_MS = 120_000;
const PENDING_MAX = 200;
const pendingTurns = new Map();

function putPending(state) {
  if (pendingTurns.size >= PENDING_MAX) {
    // قدیمی‌ترین‌ها را بریز دور (ترتیبِ درجِ Map)
    for (const k of pendingTurns.keys()) {
      pendingTurns.delete(k);
      if (pendingTurns.size < PENDING_MAX) break;
    }
  }
  const id = crypto.randomBytes(12).toString('hex');
  pendingTurns.set(id, { state, expires: Date.now() + PENDING_TTL_MS });
  return id;
}

function takePending(id, user) {
  const hit = pendingTurns.get(id);
  if (!hit) return null;
  pendingTurns.delete(id);
  if (hit.expires < Date.now()) return null;
  // گفت‌وگوی یک نفر را نفرِ دیگری نمی‌تواند ادامه بدهد
  if (hit.state?.user !== user) return null;
  return hit.state;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingTurns) if (v.expires < now) pendingTurns.delete(k);
}, 60_000).unref?.();

const SESSION_SCHEMA = {
  type: 'object',
  properties: {
    deviceId: { type: 'string', maxLength: 64 },
    role: { type: 'string', maxLength: 24, default: 'guest' },
    appToken: { type: 'string', maxLength: 200 },
    adminToken: { type: 'string', maxLength: 200 },
  },
};

const MEMORY_SCHEMA = {
  type: 'object',
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', maxLength: 40 },
    value: { type: 'string', maxLength: 300 },
  },
};

async function handle(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  // ── سلامت ─────────────────────────────────────────────────────────────
  if (p === '/ai/support/health' && method === 'GET') {
    const provider = getProvider();
    return send(res, 200, {
      ok: true,
      service: 'pump-yaqobi-ai-support',
      readOnly: true,
      kb: { chunks: index.chunks.length, docs: (index.docs || []).length, builtAt: index.builtAt, vectors: !!vectors },
      model: { provider: config.llm.provider, name: provider.name, available: await provider.available() },
      load: { ...loadSnapshot(), pool: llmPool.snapshot(), cache: answerCache.snapshot() },
      tools: activeTools(),
      sources: listSources(),
    });
  }

  // ── گرفتنِ نشست ───────────────────────────────────────────────────────
  if (p === '/ai/support/session' && method === 'POST') {
    const body = validate(await readJsonBody(req, config.server.maxBodyBytes), SESSION_SCHEMA, 'نشست');
    const cred = checkAppCredentials({ appToken: body.appToken, adminToken: body.adminToken });
    if (!cred.ok) {
      audit({ kind: 'denied', where: 'session', reason: cred.reason });
      return send(res, 401, { error: cred.reason });
    }

    // نقشی که برنامه می‌گوید، ولی **سقف** با اعتبارنامه تعیین می‌شود.
    // یعنی ادعای «admin» بدونِ رمزِ مدیر، به USER تقلیل پیدا می‌کند.
    const claimed = levelForAppRole(body.role);
    const level = levelRank(claimed) <= levelRank(cred.maxLevel) ? claimed : cred.maxLevel;

    const { token, payload } = issueSession({
      deviceId: body.deviceId || ipKey(req),
      role: body.role,
      level,
    });
    audit({ kind: 'session', user: payload.sub, role: payload.role, level: payload.lvl, note: cred.reason });
    return send(res, 200, { token, level: payload.lvl, expiresAt: payload.exp, note: cred.reason });
  }

  // ── چت ────────────────────────────────────────────────────────────────
  if (p === '/ai/support/chat' && method === 'POST') {
    const g = gate(req, res, { llm: true });
    if (!g) return;

    const body = validate(await readJsonBody(req, config.server.maxBodyBytes), CHAT_SCHEMA, 'چت');

    // ── ادامهٔ گفت‌وگو با دادهٔ دستگاه ────────────────────────────────────
    if (body.continuation) {
      const state = takePending(body.continuation, g.session.sub);
      if (!state) return send(res, 410, { error: 'این گفت‌وگو منقضی شده — دوباره بپرسید.' });

      const out2 = await agent.continueWithClientData({
        state,
        toolResults: Array.isArray(body.toolResults) ? body.toolResults : [],
      });
      audit({
        kind: 'chat', user: g.session.sub, level: g.session.lvl,
        mode: out2.mode, clientData: true, ms: out2.ms,
        tools: (body.toolResults || []).map(t => t && t.name).filter(Boolean),
      });
      return send(res, 200, out2);
    }

    if (!body.question) throw new ValidationError('«question» لازم است', 'question');

    const history = (body.history || [])
      .filter(m => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 1500) }));

    const out = await agent.answer({
      question: body.question,
      level: g.session.lvl,
      user: g.session.sub,
      history,
      memory: getMemory(g.session.sub),
      // وقتی سهمیهٔ مدل پر شده، عمداً مدل را صدا نمی‌زنیم — جوابِ استخراجی می‌رود
      signal: g.degrade ? AbortSignal.abort() : undefined,
    });

    // مدل دادهٔ دستگاه خواست → شناسه بده، خودِ گفت‌وگو پیشِ ما می‌ماند
    if (out.mode === 'need-client-data') {
      const id = putPending({ ...out.state, user: g.session.sub });
      audit({
        kind: 'chat', user: g.session.sub, level: g.session.lvl,
        mode: out.mode, needs: out.needsClient.map(t => t.name), ms: out.ms,
      });
      return send(res, 200, {
        mode: 'need-client-data',
        needsClient: out.needsClient,
        continuation: id,
        ms: out.ms,
      });
    }

    audit({
      kind: 'chat', user: g.session.sub, level: g.session.lvl,
      mode: out.mode, degraded: out.degraded, ms: out.ms,
      tools: out.usedTools?.map(t => t.name) || [],
    });
    return send(res, 200, out);
  }

  // ── حافظهٔ کاربر (بیرون از دروازهٔ داده — مالِ خودِ کاربر است) ─────────
  if (p === '/ai/support/memory') {
    const g = gate(req, res);
    if (!g) return;

    if (method === 'GET') {
      return send(res, 200, { items: getMemory(g.session.sub), allowedKeys: [...ALLOWED_KEYS] });
    }
    if (method === 'POST') {
      const body = validate(await readJsonBody(req, config.server.maxBodyBytes), MEMORY_SCHEMA, 'حافظه');
      const out = rememberFact(g.session.sub, body.key, body.value);
      audit({ kind: 'memory_write', user: g.session.sub, key: body.key, ok: out.ok });
      return send(res, out.ok ? 200 : 400, out);
    }
    if (method === 'DELETE') {
      const key = url.searchParams.get('key');
      const out = forgetMemory(g.session.sub, key);
      audit({ kind: 'memory_delete', user: g.session.sub, key: key || '(همه)', removed: out.removed });
      return send(res, 200, out);
    }
    return send(res, 405, { error: 'متدِ پشتیبانی‌نشده' });
  }

  // ── دروازهٔ منابع: فقط GET ────────────────────────────────────────────
  const m = /^\/ai\/support\/([a-z-]+)$/.exec(p);
  if (m) {
    const name = m[1];
    if (method !== 'GET') {
      audit({ kind: 'denied', where: 'gateway', source: name, method });
      return send(res, 405, { error: 'این دروازه فقط‌خواندنی است. تنها GET پذیرفته می‌شود.' }, { allow: 'GET' });
    }
    const g = gate(req, res, { requireSession: false });
    if (!g) return;

    const query = Object.fromEntries(url.searchParams.entries());
    const out = await readSource(name, { level: g.session.lvl, query, ctx: { index, retriever } });
    return send(res, out.status, out.ok ? out.data : { error: out.error });
  }

  return send(res, 404, { error: 'مسیر پیدا نشد' });
}

// ═══════════════════════════════════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return send(res, 400, { error: 'آدرسِ نامعتبر' }); }

  if (!cors(req, res)) return;
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    await handle(req, res, url);
  } catch (e) {
    if (e instanceof ValidationError) return send(res, 400, { error: e.message, field: e.field });
    audit({ kind: 'error', where: 'handler', path: url.pathname, msg: e.message });
    console.error('⚠️ ', e);
    // پیامِ خطای داخلی به کاربر نمی‌رود — می‌تواند ساختارِ سرویس را لو بدهد
    send(res, 500, { error: 'خطای داخلیِ سرویس' });
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`\n🚀 آماده: http://${config.server.host}:${config.server.port}/ai/support/health`);
  console.log(`   مدل: ${config.llm.provider} · ${getProvider().name}`);
  console.log(`   هم‌زمانی: ${config.load.maxConcurrent} · صف: ${config.load.maxQueue} · آستانهٔ بار: ${config.load.loadLimit}`);
  if (config.server.host === '127.0.0.1') {
    console.log('   ℹ️  فقط روی همین کامپیوتر در دسترس است. برای شبکهٔ خانه: AI_HOST=0.0.0.0\n');
  } else {
    console.log('   ⚠️  روی شبکه باز است — مطمئن شو AI_ALLOWED_ORIGINS تنظیم شده.\n');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n👋 خاموش می‌شوم…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
