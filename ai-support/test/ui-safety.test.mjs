// ═══════════════════════════════════════════════════════════════════════════
//  تستِ «AI نمی‌تواند ظاهرِ برنامه را عوض کند»
//
//  بندهای ۱۶ و ۲۹ خواستهٔ پروژه. سه چیز بررسی می‌شود:
//    ۱) هیچ ابزاری برای دست زدن به ظاهر وجود ندارد.
//    ۲) خودِ سرویس هیچ CSS/فونت/رنگی برنمی‌گرداند.
//    ۳) ویجت جوابِ مدل را به‌عنوان HTML اجرا نمی‌کند (تزریقِ ظاهر از راهِ متن).
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { suite, test, assert } from './helpers.mjs';
import { TOOLS } from '../src/agent/tools/registry.js';
import { callTool } from '../src/agent/tools/router.js';
import { loadKnowledgeBase } from '../src/kb/loader.js';
import { Retriever } from '../src/rag/retriever.js';
import { ROOT } from '../src/config.js';

const UI_WORDS = ['font', 'color', 'theme', 'style', 'css', 'layout', 'size',
                  'فونت', 'رنگ', 'پوسته', 'اندازه', 'ظاهر'];

export default async function run() {
  const { docs, chunks } = loadKnowledgeBase();
  const ctx = { level: 'ADMIN', user: 't', index: { docs, chunks }, retriever: new Retriever(chunks) };

  suite('ظاهرِ برنامه دستِ AI نیست');

  test('هیچ ابزاری نامِ مربوط به ظاهر ندارد', () => {
    for (const t of TOOLS) {
      for (const w of UI_WORDS) {
        assert(!t.name.toLowerCase().includes(w), `ابزارِ «${t.name}» به ظاهر مربوط است`);
      }
    }
  });

  test('ابزارهای مربوط به ظاهر اجرا نمی‌شوند', async () => {
    const attempts = [
      ['set_theme', { theme: 'dark' }],
      ['set_font_size', { size: 32 }],
      ['change_color', { color: '#ff0000' }],
      ['update_css', { css: 'body{display:none}' }],
      ['set_layout', { layout: 'rtl' }],
    ];
    for (const [name, args] of attempts) {
      const res = await callTool(name, args, ctx);
      assert(!res.ok, `«${name}» اجرا شد`);
    }
  });

  test('هیچ‌جای سرویس CSS تولید نمی‌کند', () => {
    const bad = [];
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.js$/.test(e.name)) continue;
        const code = fs.readFileSync(p, 'utf8')
          .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        for (const api of ['document.styleSheets', 'insertRule', 'style.setProperty', 'classList.add']) {
          if (code.includes(api)) bad.push(`${e.name}: ${api}`);
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    assert(bad.length === 0, bad.join('، '));
  });

  test('ویجت جوابِ مدل را به‌عنوان HTML اجرا نمی‌کند', () => {
    const widget = path.join(ROOT, 'web', 'widget.js');
    if (!fs.existsSync(widget)) return;   // ویجت داخلِ index.html هم می‌تواند باشد
    const src = fs.readFileSync(widget, 'utf8');
    // innerHTML با متنِ مدل = راهِ تغییرِ ظاهر و XSS. باید فقط textContent باشد.
    const risky = /innerHTML\s*=\s*[^'"`]*\b(text|answer|reply|content|md)\b/i.test(src);
    assert(!risky, 'ویجت متنِ مدل را داخلِ innerHTML می‌گذارد');
  });
}
