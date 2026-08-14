// ═══════════════════════════════════════════════════════════════════════════
//  منابعِ داده — همه GET، همه فقط‌خواندنی
//
//  این‌ها همان endpoint هایی هستند که در خواستهٔ پروژه آمده بود:
//      GET /ai/support/search
//      GET /ai/support/documentation
//      GET /ai/support/faq
//      GET /ai/support/info
//      GET /ai/support/links
//  به‌علاوهٔ shortcuts و index که برای ویجت لازم بودند.
// ═══════════════════════════════════════════════════════════════════════════

import { registerSource } from './readonly.js';
import { canAccess } from '../security/auth.js';
import { clientIndex } from '../rag/store.js';

const str = (q, key, max = 200) => String(q?.[key] || '').trim().slice(0, max);

export function registerAllSources() {
  // ── جست‌وجوی کلی ──────────────────────────────────────────────────────
  registerSource('search', {
    minLevel: 'PUBLIC',
    handler: async ({ query, level, ctx }) => {
      const q = str(query, 'q', 300);
      if (!q) return { query: '', results: [] };
      const { results, usedVectors } = await ctx.retriever.search(q, { level, topK: 8 });
      return {
        query: q,
        semantic: usedVectors,
        results: results.map(r => ({
          title: r.title, section: r.heading, feature: r.feature,
          version: r.version, updated: r.updated,
          excerpt: r.text.length > 400 ? r.text.slice(0, 400) + '…' : r.text,
          score: Number(r.relScore.toFixed(3)),
        })),
      };
    },
  });

  // ── فقط مستندات (بدونِ پرسش‌های پرتکرار) ──────────────────────────────
  registerSource('documentation', {
    minLevel: 'PUBLIC',
    handler: async ({ query, level, ctx }) => {
      const q = str(query, 'q', 300);
      const { results } = await ctx.retriever.search(q || 'راهنمای برنامه', { level, topK: 12 });
      const docs = results.filter(r => r.kind !== 'faq').slice(0, 8);
      return { query: q, results: docs.map(r => ({ title: r.title, section: r.heading, version: r.version, text: r.text })) };
    },
  });

  // ── پرسش‌های پرتکرار ──────────────────────────────────────────────────
  registerSource('faq', {
    minLevel: 'PUBLIC',
    handler: async ({ query, level, ctx }) => {
      const q = str(query, 'q', 300);
      const pool = ctx.index.chunks.filter(c => c.kind === 'faq' && canAccess(level, c.access));
      if (!q) return { results: pool.map(c => ({ title: c.title, section: c.heading, text: c.text })) };
      const { results } = await ctx.retriever.search(q, { level, topK: 10 });
      return { query: q, results: results.filter(r => r.kind === 'faq').map(r => ({ title: r.title, section: r.heading, text: r.text })) };
    },
  });

  // ── اطلاعاتِ یک قابلیت ────────────────────────────────────────────────
  registerSource('info', {
    minLevel: 'PUBLIC',
    handler: async ({ query, level, ctx }) => {
      const feature = str(query, 'feature', 80).toLowerCase();
      const docs = (ctx.index.docs || []).filter(d => canAccess(level, d.access));
      if (!feature) {
        return { features: docs.map(d => ({ id: d.id, feature: d.feature || d.title, title: d.title, version: d.version, updated: d.updated })) };
      }
      const hit = docs.filter(d =>
        String(d.feature).toLowerCase().includes(feature) ||
        String(d.title).toLowerCase().includes(feature) ||
        (d.tags || []).some(t => String(t).toLowerCase().includes(feature)));
      return { feature, found: hit.length > 0, results: hit };
    },
  });

  // ── لینک‌های رسمی ─────────────────────────────────────────────────────
  registerSource('links', {
    minLevel: 'PUBLIC',
    handler: async ({ level, ctx }) => {
      const links = [];
      for (const d of ctx.index.docs || []) {
        if (!canAccess(level, d.access)) continue;
        for (const l of d.links || []) if (l?.url) links.push({ text: l.text, url: l.url, source: d.title });
      }
      return { links };
    },
  });

  // ── میانبرها ──────────────────────────────────────────────────────────
  registerSource('shortcuts', {
    minLevel: 'PUBLIC',
    handler: async ({ level, ctx }) => {
      const out = [];
      for (const d of ctx.index.docs || []) {
        if (!canAccess(level, d.access)) continue;
        for (const s of d.shortcuts || []) if (s?.keys) out.push({ keys: s.keys, does: s.does, version: d.version, source: d.title });
      }
      return { shortcuts: out };
    },
  });

  // ── ایندکسِ سبک برای ویجتِ آفلاین ────────────────────────────────────
  // فیلترِ سطحِ دسترسی داخلِ clientIndex انجام می‌شود: مرورگر چیزی را که اجازه‌اش
  // را ندارد اصلاً **دریافت** نمی‌کند.
  registerSource('index', {
    minLevel: 'PUBLIC',
    handler: async ({ level, ctx }) => clientIndex(ctx.index, level),
  });
}
