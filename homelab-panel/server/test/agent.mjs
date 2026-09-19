// ---------------------------------------------------------------------------
//  دستیارِ هوشمندِ داخلِ پنل — با Ollamaی ساختگی
//      node test/agent.mjs
//
//  چه چیزی سنجیده می‌شود (بخشِ ۹ پرامپت):
//    • بی مدل هم جواب می‌دهد — از دادهٔ واقعیِ سرور، نه «مدل نیست».
//    • مدل ابزارِ خواندنی صدا می‌زند ⇒ اجرا ⇒ نتیجه به مدل ⇒ جوابِ جریانی.
//    • ابزارِ تغییردهنده اجرا **نمی‌شود**؛ پیشنهاد می‌ماند تا مدیر تأیید کند.
//    • تأیید ⇒ اجرای واقعی (پشتیبانِ تازه روی دیسک) و ثبت در Audit؛ رد ⇒ هیچ.
//    • viewer نمی‌تواند بپرسد یا تأیید کند؛ روی پورتِ عمومی هیچ چیزی نیست.
//    • راز داخلِ لاگ به مدل نمی‌رسد (پوشانده می‌شود).
//    • دانلودِ مدل با پیشرفت، انتخاب، حذف؛ پیشنهادِ مدل از روی سخت‌افزار.
//    • نگهبانِ حرارتی: مکث/خاموشی/برگشت — و بی‌کاری ⇒ مدل از رَم بیرون.
//    • گزارشِ صبحگاهی ساخته و ثبت می‌شود، با جمع‌بندیِ مدل.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4891);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 300)}`);
};

// ── ۰) واحدها — بی سرور ─────────────────────────────────────────────────────
console.log('\n── نگهبانِ حرارتی (تصمیمِ خالص) ──');
{
  process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
  const { decide, DEFAULTS } = await import('../src/agent/guard.js');
  check('۸۶ درجه ⇒ خاموشی', decide({ tempC: 86, paused: false, cfg: DEFAULTS }) === 'stop');
  check('۷۸ درجه ⇒ مکث', decide({ tempC: 78, paused: false, cfg: DEFAULTS }) === 'pause');
  check('۷۸ درجه در مکث ⇒ همان مکث', decide({ tempC: 78, paused: true, cfg: DEFAULTS }) === 'none');
  check('۷۲ درجه در مکث ⇒ هنوز نه (زیرِ ۷۰ باید بشود)', decide({ tempC: 72, paused: true, cfg: DEFAULTS }) === 'none');
  check('۶۵ درجه در مکث ⇒ برگشت', decide({ tempC: 65, paused: true, cfg: DEFAULTS }) === 'resume');
  check('بی سنسور ⇒ هیچ تصمیمِ حرارتی', decide({ tempC: null, paused: false, cfg: DEFAULTS }) === 'none');

  const { redactText } = await import('../src/agent/redact.js');
  const r = redactText('token: abcdefabcdefabcdefabcdefabcdefab رمز: MySecret123 ok ghp_ABCDEFGHIJKLMNOPQRSTUV');
  check('راز پوشانده می‌شود', !/MySecret123|ghp_ABCDEF|abcdefabcdefabcdefabcdefabcdefab/.test(r) && /پنهان/.test(r), r);

  const { recommend } = await import('../src/agent/hardware.js');
  check('۸ گیگ رَم ⇒ ۳B', recommend({ ramGb: 8, vramGb: 0, cpu: { cores: 4 }, gpus: [] }).model === 'qwen2.5:3b-instruct');
  check('۱۶ گیگ رَم ⇒ ۷B', recommend({ ramGb: 16, vramGb: 0, cpu: { cores: 8 }, gpus: [] }).model === 'qwen2.5:7b-instruct');
  check('کارتِ ۱۲ گیگ ⇒ ۱۴B', recommend({ ramGb: 16, vramGb: 12, cpu: { cores: 8 }, gpus: [{ name: 'RTX', vramGb: 12 }] }).model === 'qwen2.5:14b-instruct');
  check('۳ گیگ رَم ⇒ هیچ مدلی، ولی دلیلش گفته می‌شود', recommend({ ramGb: 3, vramGb: 0, cpu: { cores: 2 }, gpus: [] }).model === null);

  const { searchKnowledge } = await import('../src/agent/kb.js');
  const hits = searchKnowledge('میانبر');
  check('دانشِ برنامه جست‌وجو می‌شود (نرمال‌سازیِ فارسی)', hits.length > 0 && hits[0].text.length > 0, JSON.stringify(hits[0]?.source));
  check('«مینبر» با غلطِ املایی هم پیدا می‌شود (سه‌گرام)', searchKnowledge('مینبر').length > 0);
}

// ── ۱) Ollamaی ساختگی ───────────────────────────────────────────────────────
const MODEL = 'qwen2.5:3b-instruct';
const seen = { chats: [], pulls: [], deletes: [], unloads: 0 };
let installed = [MODEL];
let script = 'status'; // چه سناریویی برای پاسخ
const nd = (res, objs) => { res.setHeader('content-type', 'application/x-ndjson'); for (const o of objs) res.write(JSON.stringify(o) + '\n'); res.end(); };
const chunkText = (text) => text.split(' ').map((w, i, a) => ({ message: { role: 'assistant', content: w + (i < a.length - 1 ? ' ' : '') }, done: false }));

const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    const p = req.url.split('?')[0];
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/tags') return j(200, { models: installed.map((n) => ({ name: n, size: 2e9, modified_at: new Date().toISOString(), details: { family: 'qwen2', parameter_size: '3B', quantization_level: 'Q4' } })) });
    if (p === '/api/ps') return j(200, { models: [] });
    if (p === '/api/version') return j(200, { version: '0.9.9' });
    if (p === '/api/generate') { seen.unloads++; return j(200, { done: true }); }
    if (p === '/api/delete') { installed = installed.filter((n) => n !== body.name); seen.deletes.push(body.name); return j(200, {}); }
    if (p === '/api/pull') {
      seen.pulls.push(body.name);
      installed.push(body.name);
      return nd(res, [{ status: 'pulling manifest' }, { status: 'pulling', total: 1000, completed: 300 }, { status: 'pulling', total: 1000, completed: 1000 }, { status: 'success' }]);
    }
    if (p === '/api/chat') {
      seen.chats.push(body);
      if (!installed.includes(body.model)) return j(404, { error: `model '${body.model}' not found` });
      const lastRole = body.messages.at(-1)?.role;
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      if (script === 'status' && hasTools && lastRole === 'user') {
        return nd(res, [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_metrics', arguments: {} } }] }, done: false }, { message: { role: 'assistant', content: '' }, done: true, eval_count: 1 }]);
      }
      if (script === 'restart' && hasTools && lastRole === 'user') {
        return nd(res, [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'restart_site', arguments: { slug: 'shop' } } }] }, done: false }, { message: { role: 'assistant', content: '' }, done: true }]);
      }
      if (script === 'backup' && hasTools && lastRole === 'user') {
        return nd(res, [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'run_backup', arguments: { note: 'به درخواستِ آزمون' } } }] }, done: false }, { message: { role: 'assistant', content: '' }, done: true }]);
      }
      if (script === 'logs' && hasTools && lastRole === 'user') {
        return nd(res, [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_logs', arguments: { level: 'error', limit: 5 } } }] }, done: false }, { message: { role: 'assistant', content: '' }, done: true }]);
      }
      if (script === 'loop' && hasTools) {
        return nd(res, [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_metrics', arguments: {} } }] }, done: false }, { message: { role: 'assistant', content: '' }, done: true }]);
      }
      // جوابِ نهایی — از روی آخرین دادهٔ ابزار
      const toolMsg = [...body.messages].reverse().find((m) => m.role === 'tool');
      const text = toolMsg
        ? (toolMsg.content.includes('cpuPercent') ? 'پردازنده و حافظه عادی است؛ همه‌چیز بالاست.'
          : toolMsg.content.includes('proposal') ? 'پیشنهاد ثبت شد و منتظرِ تأییدِ شماست.'
            : 'دادهٔ ابزار خوانده شد.')
        : body.messages.at(-1)?.content?.includes('گزارش') ? 'همه‌چیز عادی است؛ امروز کاری لازم نیست.'
          : 'سلام! چه کمکی از دستم برمی‌آید؟';
      return nd(res, [...chunkText(text), { message: { role: 'assistant', content: '' }, done: true, eval_count: 5, prompt_eval_count: 50, total_duration: 5e8 }]);
    }
    j(404, { error: 'not found' });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const OLLAMA = `http://127.0.0.1:${fake.address().port}`;

// ── ۲) پنل ──────────────────────────────────────────────────────────────────
const dataDir = path.join(tmp, 'data');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
    HLP_TUNNEL: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: '0', HLP_OLLAMA_URL: OLLAMA },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));
const BASE = `http://127.0.0.1:${PANEL}`;

async function api(method, p, body, headers = {}, base = BASE) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}
/** خواندنِ SSE تا پایان */
async function stream(p, body, headers) {
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (res.status !== 200) return { status: res.status, events: [], json: await res.json().catch(() => null) };
  const text = await res.text();
  const events = text.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  return { status: res.status, events, text: events.filter((e) => e.type === 'token').map((e) => e.text).join('') };
}

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'admin', password: 'Agent-1405-test' });
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'Agent-1405-test' });
  const auth = { Authorization: `Bearer ${login.json?.token}` };
  check('ورود به پنل', Boolean(login.json?.token));

  console.log('\n── حال و سخت‌افزار ──');
  const st = await api('GET', '/api/agent/status', undefined, auth);
  check('وضعیت می‌آید و Ollama را بالا می‌بیند', st.status === 200 && st.json?.ollama?.up === true && st.json?.ollama?.version === '0.9.9', JSON.stringify(st.json).slice(0, 200));
  check('هنوز مدلی انتخاب نشده', st.json?.model === '' && st.json?.modelReady === false);
  check('پیشنهادِ مدل از روی سخت‌افزارِ واقعی', typeof st.json?.recommendation?.model === 'string' || st.json?.recommendation?.model === null);
  check('ابزارها فهرست می‌شوند و هر کدام kind دارد', st.json?.tools?.length >= 15 && st.json.tools.every((t) => ['read', 'confirm'].includes(t.kind)));
  check('دانشِ برنامه بارگذاری شده', st.json?.knowledge?.docs > 5);

  console.log('\n── بی مدل هم جواب می‌دهد ──');
  const q0 = await stream('/api/agent/chat', { text: 'سرور چطوره؟' }, auth);
  check('پاسخ در حالتِ quick با دادهٔ واقعی', q0.status === 200 && q0.events.some((e) => e.type === 'done' && e.mode === 'quick') && /پردازنده/.test(q0.text), q0.text.slice(0, 160));
  check('و می‌گوید چرا مدل نیست', /مدلی انتخاب نشده/.test(q0.text));

  console.log('\n── انتخابِ مدل ──');
  const badSel = await api('POST', '/api/agent/models/select', { name: 'nope:latest' }, auth);
  check('مدلِ نصب‌نشده انتخاب نمی‌شود', badSel.status === 400);
  const sel = await api('POST', '/api/agent/models/select', { name: MODEL }, auth);
  check('مدلِ نصب‌شده انتخاب می‌شود', sel.status === 200 && (await api('GET', '/api/agent/settings', undefined, auth)).json?.model === MODEL);

  console.log('\n── مدل ابزار می‌خواند و جوابِ جریانی می‌دهد ──');
  script = 'status';
  const q1 = await stream('/api/agent/chat', { text: 'وضعیتِ سرور را بگو' }, auth);
  check('ابزارِ get_metrics صدا زده شد', q1.events.some((e) => e.type === 'tool' && e.name === 'get_metrics'), JSON.stringify(q1.events.map((e) => e.type)));
  check('نتیجهٔ ابزار به مدل رسید و جواب آمد', q1.events.some((e) => e.type === 'done' && e.mode === 'model') && /عادی است/.test(q1.text), q1.text);
  check('جواب حرف‌به‌حرف (چند token) آمد', q1.events.filter((e) => e.type === 'token').length >= 3);
  const convId = q1.events.find((e) => e.type === 'conversation')?.id;
  check('گفت‌وگو ذخیره شد', Number.isInteger(convId));
  const conv = await api('GET', `/api/agent/conversations/${convId}`, undefined, auth);
  check('پیام‌های کاربر، ابزار و دستیار در حافظه‌اند', conv.json?.messages?.some((m) => m.role === 'user') && conv.json?.messages?.some((m) => m.role === 'tool' && m.tool_name === 'get_metrics') && conv.json?.messages?.some((m) => m.role === 'assistant'), JSON.stringify(conv.json?.messages?.map((m) => m.role)));
  const sys = seen.chats.at(-2)?.messages?.[0];
  check('system prompt فارسی و با قانونِ طلایی', sys?.role === 'system' && /دستیارِ هوشمند/.test(sys.content) && /تأیید/.test(sys.content));
  const toolMsg = seen.chats.at(-1)?.messages?.find((m) => m.role === 'tool');
  check('خروجیِ ابزار داخلِ پاکتِ داده به مدل رفت', toolMsg && /<<<DATA get_metrics/.test(toolMsg.content) && /cpuPercent/.test(toolMsg.content));

  console.log('\n── ابزارِ تغییردهنده فقط پیشنهاد می‌سازد ──');
  // یک سایتِ واقعی می‌سازیم تا ری‌استارتش معنا داشته باشد
  const siteDir = path.join(tmp, 'sites', 'shop');
  await fsp.mkdir(siteDir, { recursive: true });
  await fsp.writeFile(path.join(siteDir, 'index.html'), '<h1>shop</h1>');
  const mk = await api('POST', '/api/sites', { name: 'shop', path: siteDir, kind: 'static' }, auth);
  check('سایتِ آزمون ساخته شد', mk.status < 300, JSON.stringify(mk.json).slice(0, 160));
  script = 'restart';
  const q2 = await stream('/api/agent/chat', { text: 'سایت شاپ را ری‌استارت کن' }, auth);
  const prop = q2.events.find((e) => e.type === 'proposal')?.action;
  check('پیشنهادِ ری‌استارت ثبت شد، اجرا نشد', prop && prop.status === 'pending' && prop.tool === 'restart_site' && prop.args?.slug === 'shop', JSON.stringify(prop));
  check('مدل به کاربر گفت منتظرِ تأیید است', /تأیید/.test(q2.text), q2.text);
  const pend = await api('GET', '/api/agent/actions?status=pending', undefined, auth);
  check('در فهرستِ منتظرها هست', pend.json?.actions?.some((a) => a.id === prop?.id));
  const rej = await api('POST', `/api/agent/actions/${prop?.id}/reject`, {}, auth);
  check('رد شد', rej.status === 200 && rej.json?.action?.status === 'rejected');
  const again = await api('POST', `/api/agent/actions/${prop?.id}/confirm`, {}, auth);
  check('اقدامِ ردشده دیگر تأیید نمی‌شود', again.status === 409);

  console.log('\n── تأیید ⇒ اجرای واقعی ──');
  script = 'backup';
  const before = fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.db')).length : 0;
  const q3 = await stream('/api/agent/chat', { text: 'یک پشتیبان بگیر' }, auth);
  const bprop = q3.events.find((e) => e.type === 'proposal')?.action;
  check('پیشنهادِ پشتیبان ثبت شد و هنوز فایلی ساخته نشده', bprop?.tool === 'run_backup'
    && (fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.db')).length : 0) === before);
  const conf = await api('POST', `/api/agent/actions/${bprop?.id}/confirm`, {}, auth);
  const after = fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.db')).length;
  check('تأیید ⇒ پشتیبانِ واقعی روی دیسک', conf.status === 200 && conf.json?.action?.status === 'done' && after === before + 1, `${conf.status} ${before}→${after} ${JSON.stringify(conf.json).slice(0, 160)}`);
  const aud = await api('GET', '/api/control/audit?q=agent.run_backup', undefined, auth);
  check('در Audit Log ثبت شد', (aud.json?.rows || []).some((r) => r.action === 'agent.run_backup' && r.actor === 'admin'), JSON.stringify(aud.json).slice(0, 160));

  console.log('\n── راز به مدل نمی‌رسد ──');
  await api('POST', '/api/sites', { name: 'leaky', path: siteDir, kind: 'static' }, auth).catch(() => {});
  // یک رویدادِ خطا با توکن داخلش
  const { logEvent } = await import('../src/db.js').catch(() => ({}));
  // از راهِ خودِ پنل: پرس‌وجوی ناموفق روی مسیرِ نبوده لاگ نمی‌شود، پس مستقیم در دیتابیسِ همان پنل نمی‌نویسیم؛
  // به‌جایش لاگِ سایت را با یک توکن پر می‌کنیم
  const ws = path.join(dataDir, 'sites', 'shop');
  await fsp.mkdir(ws, { recursive: true }).catch(() => {});
  script = 'logs';
  const q4 = await stream('/api/agent/chat', { text: 'خطاهای اخیر چیست؟' }, auth);
  const sent = JSON.stringify(seen.chats.at(-1)?.messages || []);
  check('read_logs اجرا شد', q4.events.some((e) => e.type === 'tool' && e.name === 'read_logs'));
  check('هیچ JWT یا توکنِ بلندی در آن‌چه به مدل رفت نیست', !/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{16,}/.test(sent));
  void logEvent;

  console.log('\n── سقفِ گام‌ها ──');
  script = 'loop';
  const q5 = await stream('/api/agent/chat', { text: 'دوباره' }, auth);
  check('مدلی که بی‌نهایت ابزار می‌خواهد، بعد از سقف مجبور به جواب می‌شود', q5.events.some((e) => e.type === 'done') && q5.events.filter((e) => e.type === 'tool').length <= 7, `${q5.events.filter((e) => e.type === 'tool').length} ابزار`);
  script = 'status';

  console.log('\n── نقش‌ها و پورتِ عمومی ──');
  await api('POST', '/api/auth/users', { username: 'viewer1', password: 'Viewer-1405-x', role: 'viewer' }, auth);
  const v = await api('POST', '/api/auth/login', { username: 'viewer1', password: 'Viewer-1405-x' });
  const vAuth = { Authorization: `Bearer ${v.json?.token}` };
  const vRead = await api('GET', '/api/agent/status', undefined, vAuth);
  const vChat = await stream('/api/agent/chat', { text: 'سلام' }, vAuth);
  const vConfirm = await api('POST', `/api/agent/actions/${bprop?.id}/confirm`, {}, vAuth);
  check('viewer می‌بیند ولی نه می‌پرسد نه تأیید می‌کند', vRead.status === 200 && vChat.status === 403 && vConfirm.status === 403, `${vRead.status} ${vChat.status} ${vConfirm.status}`);
  const vPower = await api('POST', '/api/agent/power', { on: false }, vAuth);
  check('خاموش/روشن فقط admin', vPower.status === 403);
  const pub = await api('GET', '/api/agent/status', undefined, auth, `http://127.0.0.1:${PUBLIC}`);
  check('روی پورتِ عمومی «نبوده» است', pub.status === 404, `${pub.status}`);
  const noAuth = await api('GET', '/api/agent/status');
  check('بی نشست ۴۰۱', noAuth.status === 401);

  console.log('\n── مدل‌ها: دانلود، حذف ──');
  const pull = await stream('/api/agent/models/pull', { name: 'qwen2.5:1.5b-instruct' }, auth);
  check('دانلود با پیشرفت و پایان', pull.events.some((e) => e.type === 'progress' && e.percent === 30) && pull.events.some((e) => e.type === 'done'), JSON.stringify(pull.events));
  check('Ollama واقعاً pull گرفت', seen.pulls.includes('qwen2.5:1.5b-instruct'));
  const badPull = await api('POST', '/api/agent/models/pull', { name: '../etc; rm -rf' }, auth);
  check('نامِ مدلِ خراب رد می‌شود', badPull.status === 400);
  const del = await api('DELETE', '/api/agent/models/qwen2.5:1.5b-instruct', undefined, auth);
  check('حذف', del.status === 200 && seen.deletes.includes('qwen2.5:1.5b-instruct'));
  const models = await api('GET', '/api/agent/models', undefined, auth);
  check('فهرستِ مدل‌ها: کاتالوگ با fits و نصب‌شده‌ها', models.json?.catalog?.length === 5 && models.json?.recommendation?.options?.every((o) => typeof o.fits === 'boolean') && models.json?.installed?.some((m) => m.name === MODEL));

  console.log('\n── گزارشِ صبحگاهی ──');
  const rep = await api('POST', '/api/agent/reports/run', {}, auth);
  check('گزارش ساخته شد', rep.status === 200 && /گزارشِ صبحگاهی/.test(rep.json?.title) && /## سرویس‌ها/.test(rep.json?.body), JSON.stringify(rep.json).slice(0, 200));
  check('جمع‌بندیِ مدل بالای گزارش نشست', /جمع‌بندیِ دستیار/.test(rep.json?.body) && /عادی است/.test(rep.json?.body));
  check('سایتِ آزمون در گزارش آمده', /سایت ثبت شده/.test(rep.json?.body));
  const reps = await api('GET', '/api/agent/reports', undefined, auth);
  check('در فهرستِ گزارش‌ها', reps.json?.reports?.some((r) => r.id === rep.json?.id));

  console.log('\n── دانسته‌ها ──');
  const f1 = await api('PUT', '/api/agent/facts', { key: 'سایتِ اصلی', value: 'shop' }, auth);
  check('دانسته ثبت شد', f1.status === 200 && f1.json?.facts?.some((f) => f.key === 'سایتِ اصلی'));
  await stream('/api/agent/chat', { text: 'سلام' }, auth);
  check('دانسته در system prompt می‌نشیند', /سایتِ اصلی: shop/.test(seen.chats.at(-1)?.messages?.[0]?.content || ''));

  console.log('\n── خاموش/روشن و تنظیمات ──');
  const off = await api('POST', '/api/agent/power', { on: false }, auth);
  check('خاموش ⇒ مدل از رَم بیرون (keep_alive 0)', off.status === 200 && seen.unloads >= 1 && off.json?.enabled === false, JSON.stringify(off.json).slice(0, 120));
  const offChat = await api('POST', '/api/agent/chat', { text: 'سلام' }, auth);
  check('خاموش ⇒ چت ۴۰۹ با دلیل', offChat.status === 409 && offChat.json?.error === 'disabled');
  await api('POST', '/api/agent/power', { on: true }, auth);
  const badCfg = await api('PUT', '/api/agent/settings', { pauseAtC: 80, stopAtC: 70 }, auth);
  check('آستانهٔ خاموشیِ پایین‌تر از مکث رد می‌شود', badCfg.status === 400);
  const cfg = await api('PUT', '/api/agent/settings', { idleMinutes: 5, reportHour: 7 }, auth);
  check('تنظیمات ذخیره می‌شود', cfg.json?.idleMinutes === 5 && cfg.json?.reportHour === 7);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-2000));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
