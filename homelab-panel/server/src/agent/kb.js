// ---------------------------------------------------------------------------
//  دانشِ برنامه‌ها — جست‌وجوی واژگانی روی فایل‌های markdownِ پوشهٔ knowledge/
//
//  از سرویسِ جدای قدیمیِ «ai-support» فقط همین به درد می‌خورد و به داخلِ پنل
//  آمد: نرمال‌سازیِ فارسی («می‌شود»/«میشود»/«مي‌شود» یکی)، BM25 روی دو نما
//  (کلمه برای دقت، سه‌گرام برای پوشش و غلطِ املایی) و ادغامِ RRF.
//  بردار و مدلِ embedding عمداً نیست: یک وابستگیِ دیگر و یک دانلودِ دیگر،
//  برای چند ده سند، ارزشش را ندارد.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT } from '../config.js';

export const KB_DIR = path.join(SERVER_ROOT, 'knowledge');

// ── نرمال‌سازی ──────────────────────────────────────────────────────────────
const AR_TO_FA = { 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ی' };
const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const DIACRITICS = /[ً-ٰـ]/g;
const INVISIBLE = /[​-‏‪-‮﻿]/g;
const STOPWORDS = new Set(['از', 'به', 'با', 'در', 'را', 'که', 'این', 'آن', 'و', 'یا', 'هم', 'تا', 'بر', 'برای',
  'است', 'بود', 'شد', 'شود', 'می', 'های', 'ها', 'یک', 'کن', 'کند', 'کردن', 'دارد', 'دارم', 'من', 'تو', 'او', 'ما',
  'شما', 'چه', 'چی', 'کجا', 'چطور', 'چگونه', 'ایا', 'ایم', 'the', 'a', 'an', 'is', 'are', 'to', 'of', 'in', 'on',
  'for', 'and', 'or', 'how', 'what']);

export function normalize(s) {
  if (typeof s !== 'string') return '';
  let out = s.normalize('NFKC').replace(DIACRITICS, '').replace(/‌/g, ' ').replace(INVISIBLE, '');
  let buf = '';
  for (const ch of out) buf += AR_TO_FA[ch] ?? DIGITS[ch] ?? ch;
  return buf.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function stem(w) {
  if (w.length <= 3) return w;
  for (const suf of ['هایی', 'هایم', 'هایت', 'هایش', 'ترین', 'های', 'شان', 'تان', 'مان', 'ها', 'تر', 'ام', 'ات', 'اش']) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

export function tokenize(s) {
  const out = [];
  for (const raw of normalize(s).split(' ')) {
    if (!raw || STOPWORDS.has(raw)) continue;
    if (raw.length === 1 && !/\p{N}/u.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export function trigrams(s, n = 3) {
  const t = normalize(s).replace(/ /g, '');
  if (t.length < n) return t ? [t] : [];
  const out = [];
  for (let i = 0; i <= t.length - n; i++) out.push(t.slice(i, i + n));
  return out;
}

// ── BM25 ────────────────────────────────────────────────────────────────────
const K1 = 1.5;
const B = 0.75;

function buildOne(docsTerms) {
  const df = new Map();
  const tfs = [];
  const lengths = [];
  docsTerms.forEach((terms, i) => {
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    tfs[i] = tf;
    lengths[i] = terms.length || 1;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  });
  const avgLen = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  return { df, tfs, lengths, avgLen, N: docsTerms.length };
}

function bm25(idx, queryTerms, limit) {
  const scores = new Map();
  const { df, tfs, lengths, avgLen, N } = idx;
  if (!N) return [];
  const seen = new Map();
  for (const t of queryTerms) seen.set(t, (seen.get(t) || 0) + 1);
  for (const [term, qtf] of seen) {
    const n = df.get(term);
    if (!n) continue;
    const idf = Math.max(0.05, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
    const qWeight = 1 + Math.log(qtf);
    for (let i = 0; i < N; i++) {
      const tf = tfs[i].get(term);
      if (!tf) continue;
      const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * lengths[i]) / avgLen));
      scores.set(i, (scores.get(i) || 0) + idf * norm * qWeight);
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i, score]) => ({ i, score }));
}

// ── سربرگ و چانک ────────────────────────────────────────────────────────────
function parseFrontmatter(raw) {
  const text = String(raw || '').replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  let pendingKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && pendingKey) { (meta[pendingKey] ||= []).push(item[1].trim().split('|')[0].trim()); continue; }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val === '') { pendingKey = key; meta[key] ||= []; continue; }
    pendingKey = null;
    meta[key] = val.startsWith('[') && val.endsWith(']')
      ? val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["'](.*)["']$/, '$1')).filter(Boolean)
      : val.replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

function splitBySections(body) {
  const out = [];
  let heading = '';
  let buf = [];
  const flush = () => { const text = buf.join('\n').trim(); if (text) out.push({ heading, text }); buf = []; };
  for (const line of body.split(/\r?\n/)) {
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) { flush(); heading = h[2].trim(); continue; }
    buf.push(line);
  }
  flush();
  return out;
}

function splitLong(text, max = 1200, overlap = 150) {
  if (text.length <= max) return [text];
  const parts = [];
  let cur = '';
  for (const p of text.split(/\n{2,}/)) {
    if (cur && cur.length + p.length + 2 > max) {
      parts.push(cur.trim());
      cur = cur.slice(Math.max(0, cur.length - overlap)) + '\n\n' + p;
    } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) parts.push(cur.trim());
  const out = [];
  for (const part of parts) {
    if (part.length <= max * 1.5) { out.push(part); continue; }
    for (let i = 0; i < part.length; i += max - overlap) out.push(part.slice(i, i + max));
  }
  return out;
}

export function loadKnowledge(dir = KB_DIR) {
  const docs = [];
  const chunks = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f)).sort(); } catch { return { docs, chunks }; }
  for (const file of files) {
    let raw = '';
    try { raw = fs.readFileSync(path.join(dir, file), 'utf8'); } catch { continue; }
    const { meta, body } = parseFrontmatter(raw);
    const id = String(meta.id || file.replace(/\.md$/i, ''));
    const doc = {
      id, file, title: String(meta.title || id), feature: String(meta.feature || ''), version: String(meta.version || ''),
      kind: String(meta.kind || 'doc'), app: String(meta.app || 'pump'),
      tags: Array.isArray(meta.tags) ? meta.tags : [], synonyms: Array.isArray(meta.synonyms) ? meta.synonyms : [],
    };
    docs.push(doc);
    let n = 0;
    for (const sec of splitBySections(body)) {
      for (const piece of splitLong(sec.text)) {
        chunks.push({ id: `${doc.id}#${n}`, docId: doc.id, title: doc.title, heading: sec.heading, feature: doc.feature,
          kind: doc.kind, app: doc.app, tags: doc.tags, synonyms: n === 0 ? doc.synonyms : [], text: piece });
        n++;
      }
    }
  }
  return { docs, chunks };
}

function searchableText(c) {
  return [c.title, c.title, c.heading, c.heading, c.feature, c.tags.join(' '), c.synonyms.join(' '), c.synonyms.join(' '), c.text]
    .filter(Boolean).join('\n');
}

let index = null;

/** ساختنِ ایندکس — یک بار، تنبل */
export function knowledgeIndex({ force = false, dir = KB_DIR } = {}) {
  if (index && !force) return index;
  const kb = loadKnowledge(dir);
  const texts = kb.chunks.map(searchableText);
  index = {
    ...kb,
    word: buildOne(texts.map((t) => tokenize(t))),
    tri: buildOne(texts.map((t) => trigrams(t))),
    builtAt: Date.now(),
  };
  return index;
}

/**
 * جست‌وجو — ادغامِ RRF دو نما.
 * @returns {{title:string, heading:string, text:string, score:number, source:string}[]}
 */
export function searchKnowledge(query, { limit = 5, app = '' } = {}) {
  const idx = knowledgeIndex();
  if (!idx.chunks.length || !String(query || '').trim()) return [];
  const word = bm25(idx.word, tokenize(query), 24);
  const tri = bm25(idx.tri, trigrams(query), 24);
  const fused = new Map();
  const add = (list, w) => list.forEach((r, rank) => fused.set(r.i, (fused.get(r.i) || 0) + w / (60 + rank)));
  add(word, 1.0);
  add(tri, 0.8);
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([i, score]) => ({ chunk: idx.chunks[i], score }))
    .filter(({ chunk }) => !app || chunk.app === app)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      title: chunk.title, heading: chunk.heading, app: chunk.app, kind: chunk.kind, text: chunk.text,
      score: Number(score.toFixed(4)), source: `${chunk.title}${chunk.heading ? ' ← ' + chunk.heading : ''}`,
    }));
}
