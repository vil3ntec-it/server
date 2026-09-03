// ---------------------------------------------------------------------------
//  خواندنِ نامه‌ای که سرورِ آزمایشی گرفته است
//
//  ⚠️ چرا این فایل هست: نامهٔ کدِ ورود دیگر یک تکه نیست. از وقتی نسخهٔ HTML
//  هم فرستاده می‌شود، پیام multipart/alternative است — یعنی بعد از سربرگ‌ها
//  چند تکه با مرزِ خودشان می‌آید و هر تکه سربرگ و کدگذاریِ جدا دارد.
//
//  آزمون‌ها قبلاً «هرچه بعد از خطِ خالی آمد را base64 بخوان» می‌کردند و با
//  چندتکه‌ای شدن، نتیجه‌شان آشغالِ دودویی می‌شد. این تابع هر دو شکل را
//  می‌فهمد و متنِ همهٔ تکه‌ها را به هم می‌چسباند.
// ---------------------------------------------------------------------------

/** سربرگ‌ها را از بدنه جدا می‌کند — خطِ خالی مرزِ آن‌هاست */
function split(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const at = text.indexOf('\n\n');
  if (at < 0) return { head: '', body: text };
  return { head: text.slice(0, at), body: text.slice(at + 2) };
}

function decode(body, encoding) {
  if (/base64/i.test(encoding || '')) {
    return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  return body;
}

/**
 * متنِ خواندنیِ نامه — چه یک‌تکه باشد چه چندتکه.
 * تکه‌ها با یک خطِ خالی به هم چسبانده می‌شوند.
 */
export function mailText(raw) {
  const { head, body } = split(raw);
  const boundary = /boundary="?([^";\s]+)"?/i.exec(head)?.[1];

  if (!boundary) return decode(body, /Content-Transfer-Encoding:\s*(\S+)/i.exec(head)?.[1]);

  return body
    .split(`--${boundary}`)
    .slice(1)                                   // پیش از مرزِ اول چیزی نیست
    .filter((part) => part.trim() && !part.startsWith('--'))  // «--» یعنی پایان
    .map((part) => {
      const inner = split(part.replace(/^\n/, ''));
      return decode(inner.body, /Content-Transfer-Encoding:\s*(\S+)/i.exec(inner.head)?.[1]);
    })
    .join('\n\n');
}

/** فقط تکهٔ HTML — برای وقتی که ظاهرِ نامه سنجیده می‌شود */
export function mailHtml(raw) {
  const text = mailText(raw);
  const at = text.search(/<!DOCTYPE html|<html/i);
  return at < 0 ? '' : text.slice(at);
}
