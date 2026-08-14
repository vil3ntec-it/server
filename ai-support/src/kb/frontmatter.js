// ═══════════════════════════════════════════════════════════════════════════
//  خواندنِ سربرگِ اسناد (frontmatter)
//
//  یک زیرمجموعهٔ کوچک از YAML — عمداً کوچک. یک کتابخانهٔ کاملِ YAML برای پنج
//  نوع فیلد، هم وابستگی اضافه است هم سطحِ حمله (YAML امکاناتی دارد که اصلاً
//  نمی‌خواهیمشان).
//
//  قالبِ پشتیبانی‌شده:
//      key: مقدارِ ساده
//      key: [a, b, c]
//      key:
//        - قلمِ اول
//        - متن | https://link
// ═══════════════════════════════════════════════════════════════════════════

const LIST_FIELDS = new Set(['tags', 'synonyms', 'links', 'shortcuts', 'permissions', 'steps', 'related']);

function parseScalar(v) {
  const s = v.trim().replace(/^["'](.*)["']$/, '$1');
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

/** «متن | https://…» → {text, url}؛ وگرنه همان رشته */
function parseListItem(raw) {
  const s = raw.trim().replace(/^["'](.*)["']$/, '$1');
  const bar = s.indexOf('|');
  if (bar > 0) {
    const text = s.slice(0, bar).trim();
    const rest = s.slice(bar + 1).trim();
    if (/^https?:\/\//i.test(rest)) return { text, url: rest };
    return { text, value: rest };
  }
  return s;
}

/**
 * @param {string} raw محتوای کاملِ فایل
 * @returns {{meta: object, body: string}}
 */
export function parseFrontmatter(raw) {
  const text = String(raw || '').replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };

  const meta = {};
  const lines = m[1].split(/\r?\n/);
  let pendingKey = null;

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    // قلمِ فهرست: «  - چیزی»
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && pendingKey) {
      (meta[pendingKey] ||= []).push(parseListItem(item[1]));
      continue;
    }

    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();

    if (val === '') {
      // فهرستِ چندخطی در خطوطِ بعدی می‌آید
      pendingKey = key;
      meta[key] ||= [];
      continue;
    }
    pendingKey = null;

    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => parseListItem(s)).filter(x => x !== '');
    } else if (LIST_FIELDS.has(key)) {
      meta[key] = [parseListItem(val)];
    } else {
      meta[key] = parseScalar(val);
    }
  }

  return { meta, body: text.slice(m[0].length).trim() };
}

/** متنِ قابلِ جست‌وجو از یک قلمِ فهرست (چه رشته باشد چه شیء) */
export function itemText(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return [item.text, item.value].filter(Boolean).join(' ');
  return '';
}
