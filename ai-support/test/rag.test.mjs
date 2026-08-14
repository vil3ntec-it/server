// ═══════════════════════════════════════════════════════════════════════════
//  تست‌های بازیابی و کیفیتِ دانش
//
//  مهم‌ترینشان «سؤال با کلماتِ کاربر، سندِ درست» است — همان چیزی که پروژه صریح
//  خواسته بود: کاربر می‌نویسد «رمزم یادم نیست» و سند «بازیابی دسترسی» پیدا شود.
// ═══════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual } from './helpers.mjs';
import { normalize, tokenize, trigrams } from '../src/rag/normalize.js';
import { loadKnowledgeBase } from '../src/kb/loader.js';
import { Retriever, packContext } from '../src/rag/retriever.js';
import { parseFrontmatter } from '../src/kb/frontmatter.js';
import { clientIndex } from '../src/rag/store.js';
import { LEVELS } from '../src/security/auth.js';

/** سؤالِ کاربر → شناسهٔ سندی که باید در نتایج بیاید */
const EXPECTATIONS = [
  ['رمزم یادم نیست، چطوری دوباره وارد حسابم بشم؟', 'account-access'],
  ['نمیتونم وارد بشم', 'account-access'],
  ['میانبرهای برنامه چی هستند؟', 'keyboard-shortcuts'],
  ['چطور سریع جستجو را باز کنم', 'keyboard-shortcuts'],
  ['کلید ترکیبی برای پی دی اف', 'keyboard-shortcuts'],
  ['برنامه هنگ میکنه', 'troubleshooting'],
  ['تغییراتم روی گوشی نمیاد', 'sync-server'],
  ['چطور برای مشتری کیوآر بسازم', 'messenger-qr'],
  ['فیصدی دیزل و پطرول', 'debtors-accounts'],
  ['لینک دانلود اندروید', 'official-links'],
  ['میتونی حساب منو پاک کنی؟', 'assistant-limits'],
  ['قابلیت های مخفی برنامه', 'hidden-features'],
];

export default async function run() {
  const { docs, chunks, problems } = loadKnowledgeBase();
  const retriever = new Retriever(chunks);

  suite('نرمال‌سازیِ فارسی');

  test('یای عربی و کافِ عربی یکسان می‌شوند', () => {
    assertEqual(normalize('كيبورد'), normalize('کیبورد'));
    assertEqual(normalize('مي‌شود'), normalize('می شود'));
  });

  test('ارقامِ فارسی و عربی به لاتین تبدیل می‌شوند', () => {
    assertEqual(normalize('۱۲۳'), '123');
    assertEqual(normalize('٤٥٦'), '456');
  });

  test('نیم‌فاصله و اعراب حذف می‌شوند', () => {
    assertEqual(normalize('قرض‌دار'), 'قرض دار');
    assertEqual(normalize('مُحَمَّد'), 'محمد');
  });

  test('توکن‌ساز کلماتِ بی‌ارزش را دور می‌ریزد', () => {
    const t = tokenize('این یک برنامه است که برای من است');
    assert(!t.includes('این'), 'کلمهٔ ایست حذف نشد');
    assert(t.includes('برنامه'), 'کلمهٔ معنادار حذف شد');
  });

  test('ریشه‌یاب پسوند را برمی‌دارد ولی کلمهٔ کوتاه را خراب نمی‌کند', () => {
    assert(tokenize('میانبرها').includes('میانبر'));
    assertEqual(tokenize('تیل')[0], 'تیل');
  });

  test('سه‌گرام برای نوشتنِ چسبیده و جدا مشترک است', () => {
    const a = new Set(trigrams('میانبر'));
    const b = new Set(trigrams('میان بر'));
    const shared = [...a].filter(x => b.has(x));
    assert(shared.length >= 3, `فقط ${shared.length} سه‌گرامِ مشترک`);
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('سلامتِ Knowledge Base');

  test('اسناد بدونِ ایراد خوانده می‌شوند', () => {
    assert(problems.length === 0, problems.join(' | '));
  });

  test('همهٔ اسناد نسخه و عنوان دارند', () => {
    for (const d of docs) {
      assert(d.version, `سندِ ${d.file} نسخه ندارد`);
      assert(d.title, `سندِ ${d.file} عنوان ندارد`);
      assert(d.updated, `سندِ ${d.file} تاریخِ به‌روزرسانی ندارد`);
    }
  });

  test('سطحِ دسترسیِ همهٔ اسناد معتبر است', () => {
    for (const d of docs) assert(LEVELS.includes(d.access), `${d.file}: ${d.access}`);
  });

  test('هیچ سندی رمز یا توکن ندارد', async () => {
    const { containsSecret } = await import('../src/security/redact.js');
    for (const c of chunks) {
      assert(!containsSecret(c.text), `سندِ «${c.title}» چیزی شبیهِ راز دارد`);
    }
  });

  test('سربرگ‌خوان قالب‌های مختلف را می‌فهمد', () => {
    const { meta } = parseFrontmatter(`---
id: x
tags: [الف, ب]
links:
  - نام | https://example.com
count: 3
---
بدنه`);
    assertEqual(meta.id, 'x');
    assertEqual(meta.tags.length, 2);
    assertEqual(meta.links[0].url, 'https://example.com');
  });

  test('همهٔ لینک‌های اسناد https یا wa.me هستند', () => {
    for (const d of docs) {
      for (const l of d.links || []) {
        assert(/^https:\/\//.test(l.url), `لینکِ ناامن در ${d.file}: ${l.url}`);
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('کیفیتِ بازیابی');

  for (const [question, expectedDoc] of EXPECTATIONS) {
    test(`«${question}» → ${expectedDoc}`, async () => {
      const { results } = await retriever.search(question, { level: 'ADMIN', topK: 4 });
      assert(results.length > 0, 'هیچ نتیجه‌ای نیامد');
      const ids = results.map(r => r.docId);
      assert(ids.includes(expectedDoc), `پیدا نشد. آمد: ${[...new Set(ids)].join('، ')}`);
    });
  }

  test('سؤالِ نامربوط نتیجهٔ کم یا هیچ می‌دهد', async () => {
    const { results } = await retriever.search('دستور پخت قورمه سبزی با گوشت گوسفند', { level: 'ADMIN' });
    // انتظار «صفر» نداریم — بازیابِ لغوی همیشه چیزی پیدا می‌کند. انتظار داریم
    // مدل با دیدنِ همین‌ها بگوید «نمی‌دانم»، و برای حالتِ بی‌مدل، تعداد کم بماند.
    assert(results.length <= 6, `${results.length} نتیجه برای سؤالِ بی‌ربط`);
  });

  test('بودجهٔ متن رعایت می‌شود', async () => {
    const { results } = await retriever.search('میانبر', { level: 'ADMIN', topK: 6 });
    const packed = packContext(results, 800);
    const total = packed.join('').length;
    assert(total <= 900, `بودجه رد شد: ${total} نویسه`);
  });

  test('نتیجه‌ها همیشه منبع دارند', async () => {
    const { results } = await retriever.search('چطور پی دی اف بگیرم', { level: 'USER' });
    for (const r of results) {
      assert(r.title, 'نتیجه بدونِ عنوان');
      assert(r.version !== undefined, 'نتیجه بدونِ نسخه');
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('فیلترِ سطحِ دسترسی در بازیابی');

  test('کاربرِ PUBLIC اسنادِ USER را نمی‌گیرد', async () => {
    const { results } = await retriever.search('میانبرهای برنامه', { level: 'PUBLIC', topK: 8 });
    for (const r of results) {
      assertEqual(r.access, 'PUBLIC', `سندِ ${r.access} به کاربرِ PUBLIC رسید`);
    }
  });

  test('ایندکسِ مرورگر فیلترشده تحویل می‌شود', () => {
    const idx = { docs, chunks, builtAt: 'x' };
    const pub = clientIndex(idx, 'PUBLIC');
    const admin = clientIndex(idx, 'ADMIN');
    assert(pub.chunks.length < admin.chunks.length, 'فیلترِ سطح روی ایندکسِ مرورگر کار نکرد');
    // مهم: چیزی که فیلتر شده اصلاً در خروجی نیست، نه اینکه علامت خورده باشد
    const pubDocIds = new Set(pub.docs.map(d => d.id));
    for (const d of docs) {
      if (d.access !== 'PUBLIC') assert(!pubDocIds.has(d.id), `سندِ ${d.access} در ایندکسِ عمومی ماند`);
    }
  });

  test('هیچ سندِ INTERNAL به هیچ سطحی نمی‌رسد', () => {
    const idx = { docs, chunks, builtAt: 'x' };
    for (const lvl of LEVELS) {
      const out = clientIndex(idx, lvl);
      assert(!out.chunks.some(c => c.access === 'INTERNAL'), `INTERNAL به ${lvl} رسید`);
    }
  });
}
