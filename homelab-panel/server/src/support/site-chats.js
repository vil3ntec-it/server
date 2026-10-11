// ---------------------------------------------------------------------------
//  گفت‌وگوهای سایت‌ها (مثلاً vill3n.top) در کنترول سنتر
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۲۰): «پیامی که توی سایت می‌دهند هم توی تلگرام بیاید
//  هم توی پنلِ مدیریت و سرور، که اگر توی هر کدام جواب دادم درجا برود برای طرف.»
//
//      بازدیدکننده ──▶ سایت (data/) ◀── پنلِ خودِ سایت
//                         ▲
//                         └── http://127.0.0.1:<پورت>/api/panel/chats  (همین ماژول)
//                                ▲                    ▲
//                    صفحهٔ «پشتیبانی ← سایت‌ها»    پلِ تلگرام (support/telegram.js)
//
//  ⛔ گفت‌وگو فقط در خودِ سایت است؛ این‌جا هیچ نسخهٔ دومی نگه داشته نمی‌شود.
//  ⛔ کلید (SITE_PANEL_KEY) را خودِ پنل به پروسهٔ سایت می‌دهد (sites/workspace.js)؛
//     سایت فقط از لوکال‌هاستِ بی پراکسی و با همان کلید جواب می‌دهد.
//  ⚠️ سایتی که پیش از این نسخه روشن شده، یک بار باید از پنل ری‌استارت شود تا کلید را بگیرد.
// ---------------------------------------------------------------------------
import { listSitesRaw, getSiteBySlug } from '../sites/registry.js';
import { panelKeyFor } from '../sites/workspace.js';

const SLUG = /^[a-z0-9؀-ۿ-]{1,60}$/;
const CID = /^[A-Za-z0-9_-]{1,40}$/;

function err(status, message) {
  return Object.assign(new Error(message), { status });
}

/** سایت‌هایی که کلید دارند و پورتشان معلوم است */
export function chatSites() {
  return listSitesRaw()
    .filter((s) => s.port && panelKeyFor(s.slug, { create: false }))
    .map((s) => ({ slug: s.slug, name: s.name, port: s.port, domain: s.domain || '' }));
}

async function call(site, method, rel, { body, via } = {}) {
  const key = panelKeyFor(site.slug, { create: false });
  if (!key) throw err(409, 'این سایت هنوز کلیدِ پنل را ندارد؛ یک بار از «سایت‌ها» ری‌استارتش کنید');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(`http://127.0.0.1:${Number(site.port)}/api/panel/chats${rel}`, {
      method,
      headers: { 'x-panel-key': key, ...(via ? { 'x-panel-via': via } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
      redirect: 'error',
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && rel.startsWith('?')) throw err(409, 'سایت این گفت‌وگو را نمی‌شناسد (نسخهٔ قدیمی یا هنوز ری‌استارت نشده)');
    if (!r.ok) throw err(r.status, (j && j.error) || `سایت پاسخ نداد (${r.status})`);
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw err(504, 'سایت پاسخ نداد');
    if (e.status) throw e;
    throw err(502, 'سایت روشن نیست یا در دسترس نیست');
  } finally { clearTimeout(t); }
}

function siteOf(slug) {
  if (!SLUG.test(String(slug || ''))) throw err(400, 'نشانیِ سایت درست نیست');
  const s = getSiteBySlug(slug);
  if (!s || !s.port) throw err(404, 'سایت پیدا نشد');
  return { slug: s.slug, name: s.name, port: s.port, domain: s.domain || '' };
}
const idOf = (id) => { if (!CID.test(String(id || ''))) throw err(400, 'شناسهٔ گفت‌وگو درست نیست'); return String(id); };

/** فهرستِ گفت‌وگوهای یک سایت (since: فقط آن‌هایی که از آن لحظه عوض شده‌اند) */
export async function listChats(site, since = 0) {
  const j = await call(site, 'GET', `?since=${Number(since) || 0}`);
  return { chats: Array.isArray(j.chats) ? j.chats : [], unread: Number(j.unread) || 0 };
}

/** همهٔ سایت‌ها با هم؛ سایتی که خاموش است فقط با «error» می‌آید */
export async function listAll() {
  const sites = chatSites();
  const out = await Promise.all(sites.map(async (s) => {
    try {
      const r = await listChats(s);
      return { slug: s.slug, name: s.name, domain: s.domain, ...r };
    } catch (e) {
      return { slug: s.slug, name: s.name, domain: s.domain, chats: [], unread: 0, error: e.message };
    }
  }));
  return { sites: out, unread: out.reduce((n, s) => n + s.unread, 0) };
}

export async function getChat(slug, id) {
  return call(siteOf(slug), 'GET', `/${encodeURIComponent(idOf(id))}`);
}

export async function reply(slug, id, text, via = 'panel') {
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) throw err(400, 'جواب خالی است');
  return call(siteOf(slug), 'POST', `/${encodeURIComponent(idOf(id))}`, { body: { text: body }, via: via === 'telegram' ? 'telegram' : '' });
}

export { siteOf };
