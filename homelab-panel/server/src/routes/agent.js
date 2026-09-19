// ---------------------------------------------------------------------------
//  API دستیارِ هوشمند — فقط روی پورتِ پنل، فقط با نشستِ پنل
//
//  خواندن برای هر کاربرِ واردشده؛ گفت‌وگو و تأییدِ اقدام دستِ‌کم operator؛
//  روشن/خاموش، مدل و تنظیمات فقط admin (در index.js با writeNeedsOperator
//  سوار می‌شود و این‌جا admin روی چند مسیر اضافه است).
//
//  پاسخِ گفت‌وگو و دانلودِ مدل **جریانی** است (SSE): هر رویداد یک سطرِ
//  `data: {json}`. مرورگر با fetch می‌خواند، چون EventSource هدرِ Authorization
//  ندارد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireRole } from '../control/roles.js';
import { audit } from '../control/audit.js';
import { config } from '../config.js';
import { versionInfo } from '../version.js';
import * as ollama from '../agent/ollama.js';
import * as guard from '../agent/guard.js';
import * as memory from '../agent/memory.js';
import { detectHardware, recommend, CATALOG } from '../agent/hardware.js';
import { chat } from '../agent/agent.js';
import { TOOLS, executeAction } from '../agent/tools.js';
import { runDailyReport, collectDaily, renderDaily } from '../agent/reports.js';
import { installOllama, installStatus } from '../agent/installer.js';
import { knowledgeIndex, searchKnowledge } from '../agent/kb.js';

const router = Router();
const actorOf = (req) => req.user?.username || 'admin';

function sse(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); res.flush?.(); } catch { /* بسته شد */ } };
}

/** حالِ کلی — همان کارتِ بالای صفحه */
router.get('/status', async (req, res) => {
  const cfg = guard.settings();
  const up = await ollama.available({ force: req.query.force === '1' });
  let models = [];
  let loaded = [];
  if (up) {
    try { models = await ollama.tags(); } catch { /* لحظه‌ای */ }
    loaded = await ollama.loaded();
  }
  const hw = await detectHardware();
  const rec = recommend(hw);
  res.json({
    enabled: config.agent.enabled && cfg.enabled,
    guard: guard.guardStatus(),
    ollama: { url: ollama.ollamaUrl(), up, version: up ? await ollama.version() : null, models, loaded },
    model: cfg.model,
    modelReady: up && !!cfg.model && models.some((m) => m.name === cfg.model),
    hardware: hw,
    recommendation: rec,
    install: installStatus(),
    pending: memory.listActions({ status: 'pending', limit: 20 }),
    knowledge: { docs: knowledgeIndex().docs.length, chunks: knowledgeIndex().chunks.length },
    tools: TOOLS.map((t) => ({ name: t.name, kind: t.kind, description: t.description })),
    panelVersion: versionInfo.version,
  });
});

router.get('/settings', (req, res) => res.json(guard.settings()));
router.put('/settings', requireRole('admin'), async (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ['model', 'idleMinutes', 'pauseAtC', 'stopAtC', 'resumeBelowC', 'reportHour', 'reportEmail']) if (b[k] !== undefined) patch[k] = b[k];
  if (patch.stopAtC !== undefined && patch.pauseAtC !== undefined && Number(patch.stopAtC) <= Number(patch.pauseAtC)) {
    return res.status(400).json({ error: 'bad_thresholds', message: 'آستانهٔ خاموشی باید از آستانهٔ مکث بالاتر باشد' });
  }
  const out = guard.saveSettings(patch);
  audit({ actor: actorOf(req), action: 'agent.settings', detail: patch });
  res.json(out);
});

/** روشن/خاموش — خاموش یعنی مدل از رَم بیرون */
router.post('/power', requireRole('admin'), async (req, res) => {
  const on = req.body?.on !== false;
  if (on) guard.powerOn(); else await guard.powerOff();
  audit({ actor: actorOf(req), action: on ? 'agent.on' : 'agent.off' });
  res.json({ ok: true, ...guard.guardStatus() });
});

// ── مدل‌ها ───────────────────────────────────────────────────────────────────
router.get('/models', async (req, res) => {
  const hw = await detectHardware({ force: req.query.force === '1' });
  const up = await ollama.available();
  let installed = [];
  if (up) { try { installed = await ollama.tags(); } catch { /* */ } }
  res.json({ hardware: hw, recommendation: recommend(hw), catalog: CATALOG, installed, up, current: guard.settings().model });
});

const pulls = new Map(); // name → {percent, status, startedAt}
router.get('/models/pulls', (req, res) => res.json({ pulls: Object.fromEntries(pulls) }));

/** دانلودِ مدل — جریانی؛ یکی برای هر نام */
router.post('/models/pull', requireRole('admin'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!/^[a-z0-9][a-z0-9._:\-/]{1,80}$/i.test(name)) return res.status(400).json({ error: 'bad_model', message: 'نامِ مدل معتبر نیست' });
  if (!(await ollama.available())) return res.status(503).json({ error: 'ollama_down', message: 'Ollama روشن نیست' });
  const send = sse(res);
  if (pulls.has(name)) { send({ type: 'busy', name }); return res.end(); }
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort()); // req.on('close') بعد از خوانده شدنِ بدنه شلیک می‌شود، نه با قطعِ مرورگر
  pulls.set(name, { percent: 0, status: 'شروع', startedAt: Date.now() });
  try {
    await ollama.pull(name, { signal: ctrl.signal, onProgress: (p) => { pulls.set(name, { ...p, startedAt: pulls.get(name)?.startedAt }); send({ type: 'progress', name, ...p }); } });
    if (!guard.settings().model) guard.saveSettings({ model: name });
    audit({ actor: actorOf(req), action: 'agent.model.pull', entity: 'model', entityId: name });
    send({ type: 'done', name });
  } catch (e) {
    send({ type: 'error', name, message: e.message });
  } finally {
    pulls.delete(name);
    res.end();
  }
});

router.post('/models/select', requireRole('admin'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name && !(await ollama.hasModel(name))) return res.status(400).json({ error: 'model_missing', message: 'این مدل نصب نیست — اول دانلودش کنید' });
  const prev = guard.settings().model;
  guard.saveSettings({ model: name });
  if (prev && prev !== name) await ollama.unload(prev).catch(() => {});
  audit({ actor: actorOf(req), action: 'agent.model.select', entity: 'model', entityId: name });
  res.json({ ok: true, model: name });
});

router.delete('/models/:name', requireRole('admin'), async (req, res) => {
  const name = String(req.params.name || '');
  try {
    await ollama.deleteModel(name);
    if (guard.settings().model === name) guard.saveSettings({ model: '' });
    audit({ actor: actorOf(req), action: 'agent.model.delete', entity: 'model', entityId: name });
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: 'delete_failed', message: e.message }); }
});

router.post('/ollama/install', requireRole('admin'), async (req, res) => {
  audit({ actor: actorOf(req), action: 'agent.ollama.install' });
  res.json(await installOllama());
});
router.get('/ollama/install', (req, res) => res.json(installStatus()));

// ── گفت‌وگو ──────────────────────────────────────────────────────────────────
router.get('/conversations', (req, res) => res.json({ conversations: memory.listConversations(50) }));
router.get('/conversations/:id', (req, res) => {
  const c = memory.getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  res.json(c);
});
router.delete('/conversations/:id', (req, res) => res.json({ ok: memory.deleteConversation(req.params.id) }));

router.post('/chat', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty', message: 'سؤالی نوشته نشده' });
  if (!config.agent.enabled) return res.status(503).json({ error: 'disabled', message: 'دستیار در تنظیماتِ سرور خاموش است (HLP_AGENT=0)' });
  const serve = guard.canServe();
  if (!serve.ok) return res.status(serve.code === 'busy' ? 429 : 409).json({ error: serve.code, message: serve.reason });
  const send = sse(res);
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort()); // req.on('close') بعد از خوانده شدنِ بدنه شلیک می‌شود، نه با قطعِ مرورگر
  try {
    await chat({ conversationId: req.body?.conversationId, text, user: actorOf(req), emit: send, signal: ctrl.signal });
  } catch (e) {
    send({ type: 'error', message: e.message });
  }
  res.end();
});

// ── اقدام‌های منتظرِ تأیید ────────────────────────────────────────────────────
router.get('/actions', (req, res) => res.json({ actions: memory.listActions({ status: String(req.query.status || 'pending'), limit: 100 }) }));

router.post('/actions/:id/confirm', async (req, res) => {
  const action = memory.getAction(req.params.id);
  if (!action) return res.status(404).json({ error: 'not_found' });
  if (action.status !== 'pending') return res.status(409).json({ error: 'not_pending', message: 'این اقدام قبلاً تصمیمش گرفته شده' });
  try {
    const result = await executeAction(action, { decidedBy: actorOf(req) });
    const out = memory.decideAction(action.id, { status: 'done', decidedBy: actorOf(req), result });
    if (action.conversation_id) memory.addMessage(action.conversation_id, { role: 'assistant', content: `✅ اقدامِ «${action.summary}» با تأییدِ ${actorOf(req)} اجرا شد.` });
    res.json({ ok: true, action: out });
  } catch (e) {
    const out = memory.decideAction(action.id, { status: 'failed', decidedBy: actorOf(req), result: e.message });
    res.status(500).json({ ok: false, error: e.code || 'failed', message: e.message, action: out });
  }
});

router.post('/actions/:id/reject', (req, res) => {
  const action = memory.getAction(req.params.id);
  if (!action) return res.status(404).json({ error: 'not_found' });
  if (action.status !== 'pending') return res.status(409).json({ error: 'not_pending' });
  const out = memory.decideAction(action.id, { status: 'rejected', decidedBy: actorOf(req) });
  audit({ actor: actorOf(req), action: 'agent.action.reject', entity: 'agent_action', entityId: String(action.id) });
  if (action.conversation_id) memory.addMessage(action.conversation_id, { role: 'assistant', content: `⛔ اقدامِ «${action.summary}» رد شد.` });
  res.json({ ok: true, action: out });
});

// ── گزارش‌ها، رخدادها، دانسته‌ها ────────────────────────────────────────────
router.get('/reports', (req, res) => res.json({ reports: memory.listReports(30) }));
router.get('/reports/:id', (req, res) => {
  const r = memory.getReport(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(r);
});
router.post('/reports/run', async (req, res) => {
  try {
    const r = await runDailyReport({ trigger: actorOf(req) });
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'report_failed', message: e.message }); }
});
/** پیش‌نمایشِ بی‌مدل — برای آزمون و برای وقتی مدل نیست */
router.get('/reports/preview/daily', async (req, res) => {
  res.json({ body: renderDaily(await collectDaily()) });
});

router.get('/incidents', (req, res) => res.json({ incidents: memory.listIncidents(50) }));
router.put('/incidents/:id', (req, res) => {
  const out = memory.updateIncident(req.params.id, { solution: req.body?.solution, status: req.body?.status });
  if (!out) return res.status(404).json({ error: 'not_found' });
  res.json(out);
});

router.get('/facts', (req, res) => res.json({ facts: memory.listFacts() }));
router.put('/facts', (req, res) => {
  if (!memory.setFact(req.body?.key, req.body?.value)) return res.status(400).json({ error: 'bad_fact' });
  res.json({ ok: true, facts: memory.listFacts() });
});
router.delete('/facts/:key', (req, res) => res.json({ ok: memory.deleteFact(req.params.key) }));

router.get('/knowledge/search', (req, res) => res.json({ results: searchKnowledge(String(req.query.q || ''), { limit: 8 }) }));

export default router;
