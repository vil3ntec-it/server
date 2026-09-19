// ---------------------------------------------------------------------------
//  دستیار هوشمند — ایجنتِ شخصی روی همین سرور
//
//  سه تب: گفت‌وگو (جریانی، با ابزار و پیشنهادِ اقدام)، گزارش‌ها و رخدادها،
//  مدل و تنظیمات (سخت‌افزار، Ollama، دانلودِ مدل با پیشرفت، نگهبانِ حرارتی).
//
//  قانونِ طلایی همین‌جا دیده می‌شود: هر اقدامِ تغییردهنده یک کارتِ «تأیید و
//  اجرا / رد» است. تا کلیک نشود هیچ چیزی روی سرور عوض نمی‌شود.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Cpu, Download, FileText, Power, RefreshCw, Send, Trash2, Wrench, X, Zap } from 'lucide-react';
import { useApp } from '../app-context';
import { api, streamApi } from '../api';
import { Badge, Card, Loading, Modal, toast } from '../components/ui';
import { Tabs } from '../control/ui';
import { dateTime, relative } from '../format';
import type { Lang } from '../i18n';

type Action = { id: number; tool: string; args: Record<string, unknown>; summary: string; status: string; at: number; result?: string | null };
type Msg = { id?: number; role: 'user' | 'assistant' | 'tool'; content: string; tool_name?: string | null; tools?: string[]; proposals?: Action[]; mode?: string; streaming?: boolean };
type Conversation = { id: number; title: string; updated_at: number };
type Status = {
  enabled: boolean;
  guard: { enabled: boolean; model: string; paused: boolean; pausedReason: string; stoppedByHeat: boolean; busy: boolean; modelLoaded: boolean; lastTempC: number | null; idleMinutes: number; pauseAtC: number; stopAtC: number; reportHour: number; reportEmail: string };
  ollama: { url: string; up: boolean; version: string | null; models: { name: string; sizeBytes: number }[]; loaded: { name: string }[] };
  model: string;
  modelReady: boolean;
  hardware: { platform: string; cpu: { model: string; cores: number }; ramGb: number; gpus: { name: string; vramGb: number }[]; vramGb: number };
  recommendation: { model: string | null; reason: string; options: { name: string; params: string; downloadGb: number; label: string; fits: boolean }[] };
  install: { status: string; step: string; percent: number | null; error: string | null; platform: string; downloadUrl: string };
  pending: Action[];
  knowledge: { docs: number; chunks: number };
  tools: { name: string; kind: 'read' | 'confirm'; description: string }[];
};

const fmtGb = (n: number) => `${n.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} GB`;

export default function Assistant() {
  const { t, lang, socket, role, can } = useApp();
  const [tab, setTab] = useState('chat');
  const [status, setStatus] = useState<Status | null>(null);

  const loadStatus = useCallback(async () => {
    try { setStatus(await api<Status>('/api/agent/status')); } catch (e) { toast((e as Error).message, 'bad'); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!socket) return;
    const refresh = () => loadStatus();
    socket.on('agent:install', refresh);
    socket.on('agent:notice', (n: { title: string }) => { toast(n.title, 'bad'); refresh(); });
    return () => { socket.off('agent:install', refresh); socket.off('agent:notice', refresh); };
  }, [socket, loadStatus]);

  const isAdmin = role === 'admin';
  const canAct = can('operator');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Bot className="h-5 w-5" />{t('agTitle')}</h1>
          <p className="text-xs text-ink-muted">{t('agSubtitle')}</p>
        </div>
        {status && <StatusPills status={status} t={t} />}
      </header>

      {status && !status.model && (
        <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'color-mix(in srgb, var(--status-warning) 40%, transparent)', background: 'color-mix(in srgb, var(--status-warning) 8%, transparent)' }}>
          {t('agNoModelYet')}
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'chat', label: t('agChatTab'), badge: status?.pending?.length || 0 },
          { id: 'reports', label: t('agReportsTab') },
          { id: 'model', label: t('agModelTab') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'chat' && <ChatTab t={t} lang={lang} canAct={canAct} status={status} onChanged={loadStatus} />}
      {tab === 'reports' && <ReportsTab t={t} lang={lang} canAct={canAct} />}
      {tab === 'model' && status && <ModelTab t={t} status={status} isAdmin={isAdmin} reload={loadStatus} />}
    </div>
  );
}

function StatusPills({ status, t }: { status: Status; t: (k: any, v?: any) => string }) {
  const g = status.guard;
  const tone = !status.enabled ? 'neutral' : g.stoppedByHeat ? 'bad' : g.paused ? 'warn' : status.modelReady ? 'good' : 'warn';
  const label = !status.enabled ? t('agOff') : g.stoppedByHeat ? t('agOverheated') : g.paused ? t('agPaused') : status.modelReady ? `${t('agOn')} · ${status.model}` : t('agQuickMode');
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge tone={tone}>{label}</Badge>
      <Badge tone={status.ollama.up ? 'good' : 'neutral'}>Ollama {status.ollama.up ? (status.ollama.version || t('agOllamaUp')) : t('agOllamaDown')}</Badge>
      {g.lastTempC != null && <Badge tone={g.lastTempC > g.pauseAtC ? 'warn' : 'neutral'}>{g.lastTempC}°C</Badge>}
      {g.modelLoaded && <Badge tone="info">RAM</Badge>}
    </div>
  );
}

/* ------------------------------- گفت‌وگو -------------------------------- */

function ChatTab({ t, lang, canAct, status, onChanged }: { t: (k: any, v?: any) => string; lang: Lang; canAct: boolean; status: Status | null; onChanged: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Action[]>(status?.pending || []);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const r = await api<{ conversations: Conversation[] }>('/api/agent/conversations');
    setConversations(r.conversations);
  }, []);
  const loadPending = useCallback(async () => {
    const r = await api<{ actions: Action[] }>('/api/agent/actions?status=pending');
    setPending(r.actions);
  }, []);
  useEffect(() => { loadList().catch(() => {}); loadPending().catch(() => {}); }, [loadList, loadPending]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const open = async (id: number) => {
    setActive(id);
    const c = await api<{ messages: Msg[] }>(`/api/agent/conversations/${id}`);
    setMessages(c.messages.filter((m) => m.role !== 'tool'));
  };

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true, tools: [], proposals: [] }]);
    const patch = (fn: (a: Msg) => Msg) => setMessages((m) => { const copy = [...m]; const last = copy[copy.length - 1]; if (last?.role === 'assistant') copy[copy.length - 1] = fn(last); return copy; });
    try {
      await streamApi('/api/agent/chat', { text: q, conversationId: active }, (ev) => {
        if (ev.type === 'conversation') setActive(ev.id);
        else if (ev.type === 'token') patch((a) => ({ ...a, content: a.content + ev.text }));
        else if (ev.type === 'tool') patch((a) => ({ ...a, tools: [...(a.tools || []), ev.name] }));
        else if (ev.type === 'proposal') { patch((a) => ({ ...a, proposals: [...(a.proposals || []), ev.action] })); setPending((p) => [ev.action, ...p]); }
        else if (ev.type === 'done') patch((a) => ({ ...a, streaming: false, mode: ev.mode }));
        else if (ev.type === 'error') toast(ev.message, 'bad');
      });
    } catch (e) {
      toast((e as Error).message, 'bad');
      patch((a) => ({ ...a, streaming: false, content: a.content || `⚠️ ${(e as Error).message}` }));
    } finally {
      setBusy(false);
      loadList().catch(() => {});
      onChanged();
    }
  };

  const decide = async (a: Action, ok: boolean) => {
    try {
      const r = await api<{ action: Action }>(`/api/agent/actions/${a.id}/${ok ? 'confirm' : 'reject'}`, { method: 'POST', body: {} });
      toast(ok ? t('agActionDone') : t('agActionRejected'), ok ? 'good' : 'bad');
      setPending((p) => p.filter((x) => x.id !== a.id));
      setMessages((m) => m.map((msg) => ({ ...msg, proposals: msg.proposals?.map((p) => (p.id === a.id ? r.action : p)) })));
    } catch (e) {
      toast(`${t('agActionFailed')}: ${(e as Error).message}`, 'bad');
      loadPending().catch(() => {});
    }
  };

  const remove = async (id: number) => {
    await api(`/api/agent/conversations/${id}`, { method: 'DELETE' });
    if (active === id) { setActive(null); setMessages([]); }
    loadList().catch(() => {});
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
      <Card className="!p-2">
        <button className="btn btn-primary btn-sm mb-2 w-full" onClick={() => { setActive(null); setMessages([]); }}>{t('agNewChat')}</button>
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-ink-muted">{t('agNoConversations')}</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {conversations.map((c) => (
              <li key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${active === c.id ? 'font-semibold' : ''}`} style={active === c.id ? { background: 'color-mix(in srgb, var(--accent) 14%, transparent)' } : undefined}>
                <button className="min-w-0 flex-1 truncate text-start" onClick={() => open(c.id)} title={c.title}>{c.title || '—'}</button>
                <button className="opacity-0 group-hover:opacity-100" onClick={() => remove(c.id)} title={t('delete')}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-3">
        {pending.length > 0 && (
          <Card title={t('agPendingActions')} icon={<Zap className="h-4 w-4" />}>
            <ul className="space-y-2">{pending.map((a) => <ProposalCard key={a.id} a={a} t={t} lang={lang} canAct={canAct} onDecide={decide} />)}</ul>
          </Card>
        )}
        <Card className="!p-0">
          <div className="max-h-[55vh] min-h-[280px] space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="py-10 text-center text-sm text-ink-muted">
                <Bot className="mx-auto mb-2 h-8 w-8 opacity-50" />
                {t('agPlaceholder')}
              </div>
            )}
            {messages.map((m, i) => <Bubble key={m.id ?? i} m={m} t={t} lang={lang} canAct={canAct} onDecide={decide} />)}
            <div ref={bottom} />
          </div>
          <div className="flex items-end gap-2 border-t border-line p-3">
            <textarea
              className="input min-h-[44px] flex-1 resize-y"
              rows={1}
              value={text}
              placeholder={t('agPlaceholder')}
              disabled={!canAct}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="btn btn-primary" disabled={busy || !canAct || !text.trim()} onClick={send}>
              <Send className="h-4 w-4" />{t('agSend')}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Bubble({ m, t, lang, canAct, onDecide }: { m: Msg; t: (k: any, v?: any) => string; lang: Lang; canAct: boolean; onDecide: (a: Action, ok: boolean) => void }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed" style={mine ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--surface-2)' }}>
        {!!m.tools?.length && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {m.tools.map((n, i) => <span key={i} className="chip inline-flex items-center gap-1 text-[10px]" style={{ background: 'var(--surface-0)', color: 'var(--text-secondary)' }}><Wrench className="h-3 w-3" />{n}</span>)}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{m.content || (m.streaming ? <span className="text-ink-muted">{t('agThinking')}</span> : '')}</div>
        {!!m.proposals?.length && (
          <ul className="mt-2 space-y-2">{m.proposals.map((a) => <ProposalCard key={a.id} a={a} t={t} lang={lang} canAct={canAct} onDecide={onDecide} />)}</ul>
        )}
        {m.mode === 'quick' && <p className="mt-1 text-[10px] opacity-70">{t('agQuickMode')}</p>}
      </div>
    </div>
  );
}

function ProposalCard({ a, t, lang, canAct, onDecide }: { a: Action; t: (k: any, v?: any) => string; lang: Lang; canAct: boolean; onDecide: (a: Action, ok: boolean) => void }) {
  const done = a.status !== 'pending';
  const tone = a.status === 'done' ? 'var(--status-good)' : a.status === 'pending' ? 'var(--status-warning)' : 'var(--status-critical)';
  return (
    <li className="rounded-xl border p-2.5 text-xs" style={{ borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`, background: `color-mix(in srgb, ${tone} 6%, transparent)` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{a.summary}</p>
          <p className="text-[10px] text-ink-muted">{a.tool} · {relative(a.at, lang)} · {done ? (a.status === 'done' ? t('agActionDone') : a.status === 'rejected' ? t('agActionRejected') : t('agActionFailed')) : t('agProposal')}</p>
        </div>
        {!done && canAct && (
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={() => onDecide(a, true)}><Check className="h-3.5 w-3.5" />{t('agConfirm')}</button>
            <button className="btn btn-sm" onClick={() => onDecide(a, false)}><X className="h-3.5 w-3.5" />{t('agReject')}</button>
          </div>
        )}
      </div>
    </li>
  );
}

/* ---------------------------- گزارش‌ها و رخدادها ---------------------------- */

function ReportsTab({ t, lang, canAct }: { t: (k: any, v?: any) => string; lang: Lang; canAct: boolean }) {
  const [reports, setReports] = useState<{ id: number; title: string; at: number; preview: string }[]>([]);
  const [incidents, setIncidents] = useState<{ id: number; kind: string; title: string; detail: string; analysis: string; solution: string; status: string; at: number }[]>([]);
  const [facts, setFacts] = useState<{ key: string; value: string }[]>([]);
  const [open, setOpen] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [r, i, f] = await Promise.all([
        api<{ reports: typeof reports }>('/api/agent/reports'),
        api<{ incidents: typeof incidents }>('/api/agent/incidents'),
        api<{ facts: typeof facts }>('/api/agent/facts'),
      ]);
      setReports(r.reports); setIncidents(i.incidents); setFacts(f.facts);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  if (loading) return <Loading />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t('agReports')} icon={<FileText className="h-4 w-4" />} action={canAct ? (
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<{ title: string; body: string }>('/api/agent/reports/run', { method: 'POST', body: {} }); setOpen(r); load(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); } }}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />{t('agRunReport')}
        </button>
      ) : undefined}>
        {reports.length === 0 ? <p className="py-6 text-center text-xs text-ink-muted">—</p> : (
          <ul className="divide-y divide-line">
            {reports.map((r) => (
              <li key={r.id}>
                <button className="w-full py-2 text-start" onClick={async () => setOpen(await api(`/api/agent/reports/${r.id}`))}>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-[11px] text-ink-muted">{dateTime(r.at, lang)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('agIncidents')} icon={<Zap className="h-4 w-4" />}>
        {incidents.length === 0 ? <p className="py-6 text-center text-xs text-ink-muted">—</p> : (
          <ul className="space-y-3">
            {incidents.map((i) => (
              <li key={i.id} className="rounded-xl border border-line p-3 text-xs">
                <p className="text-sm font-medium">{i.title}</p>
                <p className="text-[11px] text-ink-muted">{i.kind} · {relative(i.at, lang)}</p>
                {i.analysis && <p className="mt-1.5 whitespace-pre-wrap">{i.analysis}</p>}
                {canAct && (
                  <form className="mt-2 flex gap-1" onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); await api(`/api/agent/incidents/${i.id}`, { method: 'PUT', body: { solution: String(fd.get('solution') || ''), status: 'resolved' } }); load(); }}>
                    <input className="input flex-1 py-1 text-xs" name="solution" defaultValue={i.solution || ''} placeholder={t('agSolution')} />
                    <button className="btn btn-sm"><Check className="h-3.5 w-3.5" /></button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('agFacts')} icon={<Bot className="h-4 w-4" />} className="lg:col-span-2">
        {facts.length === 0 ? <p className="py-4 text-center text-xs text-ink-muted">—</p> : (
          <ul className="flex flex-wrap gap-2">
            {facts.map((f) => (
              <li key={f.key} className="chip inline-flex items-center gap-1.5 text-xs" style={{ background: 'var(--surface-2)' }}>
                <b>{f.key}</b>: {f.value}
                {canAct && <button onClick={async () => { await api(`/api/agent/facts/${encodeURIComponent(f.key)}`, { method: 'DELETE' }); load(); }}><X className="h-3 w-3" /></button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.title || ''} wide>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed" style={{ fontFamily: 'inherit' }}>{open?.body}</pre>
      </Modal>
    </div>
  );
}

/* ----------------------------- مدل و تنظیمات ------------------------------ */

function ModelTab({ t, status, isAdmin, reload }: { t: (k: any, v?: any) => string; status: Status; isAdmin: boolean; reload: () => void }) {
  const [pull, setPull] = useState<{ name: string; percent: number | null; status: string } | null>(null);
  const [form, setForm] = useState({ idleMinutes: status.guard.idleMinutes, pauseAtC: status.guard.pauseAtC, stopAtC: status.guard.stopAtC, reportHour: status.guard.reportHour, reportEmail: status.guard.reportEmail });
  const installed = new Set(status.ollama.models.map((m) => m.name));

  const doPull = async (name: string) => {
    setPull({ name, percent: 0, status: '…' });
    try {
      await streamApi('/api/agent/models/pull', { name }, (ev) => {
        if (ev.type === 'progress') setPull({ name, percent: ev.percent, status: ev.status });
        else if (ev.type === 'error') toast(ev.message, 'bad');
      });
      toast(t('agInstalled'), 'good');
    } catch (e) { toast((e as Error).message, 'bad'); }
    setPull(null);
    reload();
  };

  const act = async (fn: () => Promise<unknown>) => { try { await fn(); reload(); } catch (e) { toast((e as Error).message, 'bad'); } };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t('agOllama')} icon={<Cpu className="h-4 w-4" />} action={isAdmin ? (
        <button className={`btn btn-sm ${status.enabled ? '' : 'btn-primary'}`} onClick={() => act(() => api('/api/agent/power', { body: { on: !status.enabled } }))}>
          <Power className="h-3.5 w-3.5" />{status.enabled ? t('agOff') : t('agOn')}
        </button>
      ) : undefined}>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <KV k="Ollama" v={status.ollama.up ? `${t('agOllamaUp')} ${status.ollama.version || ''}` : t('agOllamaDown')} />
          <KV k={t('agModels')} v={String(status.ollama.models.length)} />
          <KV k="RAM" v={status.guard.modelLoaded ? status.model : '—'} />
          <KV k={t('agKnowledge')} v={`${status.knowledge.docs} ${t('agDocs')}`} />
        </dl>
        {!status.ollama.up && isAdmin && (
          <div className="mt-3">
            {status.install.status === 'running' ? (
              <p className="text-xs">{t('agInstalling')} {status.install.step}{status.install.percent != null ? ` — ${status.install.percent}٪` : ''}</p>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => act(() => api('/api/agent/ollama/install', { body: {} }))}><Download className="h-3.5 w-3.5" />{t('agInstallOllama')}</button>
            )}
            {status.install.status === 'failed' && <p className="mt-1 text-xs" style={{ color: 'var(--status-critical)' }}>{status.install.error}</p>}
            <p className="mt-1 text-[11px] text-ink-muted"><a className="underline" href={status.install.downloadUrl} target="_blank" rel="noreferrer">{status.install.downloadUrl}</a></p>
          </div>
        )}
      </Card>

      <Card title={t('agHardware')} icon={<Cpu className="h-4 w-4" />}>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <KV k="CPU" v={`${status.hardware.cpu.model || '—'} · ${status.hardware.cpu.cores}`} />
          <KV k="RAM" v={fmtGb(status.hardware.ramGb)} />
          <KV k="GPU" v={status.hardware.gpus.length ? status.hardware.gpus.map((g) => `${g.name} ${fmtGb(g.vramGb)}`).join(' · ') : '—'} />
          <KV k={t('agRecommended')} v={status.recommendation.model || '—'} />
        </dl>
        <p className="mt-2 text-[11px] text-ink-muted">{status.recommendation.reason}</p>
      </Card>

      <Card title={t('agModels')} icon={<Download className="h-4 w-4" />} className="lg:col-span-2">
        <ul className="divide-y divide-line">
          {status.recommendation.options.map((o) => {
            const has = installed.has(o.name);
            const current = status.model === o.name;
            const pulling = pull?.name === o.name;
            return (
              <li key={o.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-mono text-sm" dir="ltr">{o.name} <span className="text-ink-muted">({o.params}, {fmtGb(o.downloadGb)})</span></p>
                  <p className="text-[11px] text-ink-muted">{o.label} · {o.fits ? t('agFits') : t('agTooBig')}{o.name === status.recommendation.model ? ` · ⭐ ${t('agRecommended')}` : ''}</p>
                  {pulling && (
                    <div className="mt-1 h-1.5 w-64 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full" style={{ width: `${pull?.percent ?? 5}%`, background: 'var(--accent)' }} />
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  {current && <Badge tone="good">{t('agInUse')}</Badge>}
                  {has && !current && isAdmin && <button className="btn btn-sm btn-primary" onClick={() => act(() => api('/api/agent/models/select', { body: { name: o.name } }))}>{t('agUse')}</button>}
                  {!has && isAdmin && status.ollama.up && <button className="btn btn-sm" disabled={Boolean(pull)} onClick={() => doPull(o.name)}><Download className="h-3.5 w-3.5" />{t('agDownload')}</button>}
                  {has && isAdmin && <button className="btn btn-sm" onClick={() => act(() => api(`/api/agent/models/${encodeURIComponent(o.name)}`, { method: 'DELETE' }))}><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={t('agSettings')} icon={<Wrench className="h-4 w-4" />}>
        <form className="space-y-2 text-xs" onSubmit={(e) => { e.preventDefault(); act(() => api('/api/agent/settings', { method: 'PUT', body: form })); }}>
          <label className="block">{t('agIdleMinutes')}<input className="input mt-1" type="number" min={1} value={form.idleMinutes} disabled={!isAdmin} onChange={(e) => setForm({ ...form, idleMinutes: Number(e.target.value) })} /></label>
          <label className="block">{t('agPauseAt')}<input className="input mt-1" type="number" min={40} max={100} value={form.pauseAtC} disabled={!isAdmin} onChange={(e) => setForm({ ...form, pauseAtC: Number(e.target.value) })} /></label>
          <label className="block">{t('agStopAt')}<input className="input mt-1" type="number" min={40} max={110} value={form.stopAtC} disabled={!isAdmin} onChange={(e) => setForm({ ...form, stopAtC: Number(e.target.value) })} /></label>
          <label className="block">{t('agReportHour')}<input className="input mt-1" type="number" min={0} max={23} value={form.reportHour} disabled={!isAdmin} onChange={(e) => setForm({ ...form, reportHour: Number(e.target.value) })} /></label>
          <label className="block">{t('agReportEmail')}<input className="input mt-1" type="email" dir="ltr" value={form.reportEmail} disabled={!isAdmin} onChange={(e) => setForm({ ...form, reportEmail: e.target.value })} /></label>
          {isAdmin && <button className="btn btn-primary btn-sm">{t('save')}</button>}
        </form>
      </Card>

      <Card title={t('agTools')} icon={<Wrench className="h-4 w-4" />}>
        <ul className="space-y-1 text-xs">
          {status.tools.map((tool) => (
            <li key={tool.name} className="flex items-start gap-2">
              <Badge tone={tool.kind === 'read' ? 'neutral' : 'warn'}>{tool.kind === 'read' ? t('agReadOnly') : t('agNeedsApproval')}</Badge>
              <span><span className="font-mono" dir="ltr">{tool.name}</span> — {tool.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-muted">{k}</dt>
      <dd className="truncate font-medium">{v}</dd>
    </div>
  );
}
