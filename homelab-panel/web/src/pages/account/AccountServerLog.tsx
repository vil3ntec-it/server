// ---------------------------------------------------------------------------
//  🩺 سرورِ حساب — وضعیت و لاگ
//
//  گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۳، با عکس): پس از به‌روز کردنِ سرورِ حساب
//  `api.<دامنه>/admin/` می‌گفت «پروسه بسته شد (کد 1)… لاگِ سرورِ حساب در پنل
//  را ببینید» — و **هیچ صفحه‌ای در پنل آن لاگ را نشان نمی‌داد**. مسیرِ
//  `/api/account-server/logs` از قبل بود؛ فقط کسی آن را نمی‌خواند.
//
//  ⛔ این صفحه فقط می‌خواند و یک دکمهٔ «راه‌اندازیِ دوباره» دارد؛ هیچ تصمیمی
//     این‌جا گرفته نمی‌شود — ناظر (`account/supervisor.js`) تنها جای آن است.
//  ⚠️ «چرا افتاد» (`lastCrash`) سطرهای stderrِ خودِ پروسه است و نشانیِ
//     پوشه‌ها را دارد، پس فقط پشتِ ورودِ همین پنل دیده می‌شود، نه در پیامِ
//     عمومیِ درگاه.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { RotateCcw, ScrollText, ServerCog } from 'lucide-react';
import { api } from '../../api';
import { Badge, Card, Skeleton, toast } from '../../components/ui';
import { ActionButton, KV, Notice } from '../../control/ui';
import { fa, moment } from './shared';

type Status = {
  installed: boolean;
  running: boolean;
  up: boolean;
  version: string | null;
  restarts: number;
  lastError: string | null;
  lastCrash: { at: number; code: number | string; lines: string[] } | null;
  startedAt: number | null;
  uptimeMs: number;
};

/** هر سطرِ لاگ: «زمان \t سطح \t متن» (همان `push`ِ ناظر). */
function parse(line: string) {
  const [at, level, ...rest] = line.split('\t');
  return { at, level, text: rest.join('\t') };
}

const TONE: Record<string, string> = {
  error: 'var(--status-critical)',
  warn: 'var(--status-warning)',
};

export default function AccountServerLog() {
  const [st, setSt] = useState<Status | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const [s, l] = await Promise.all([
        api<Status>('/api/account-server/status'),
        api<{ lines: string[] }>('/api/account-server/logs?limit=200'),
      ]);
      setSt(s);
      setLines(l.lines || []);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    //  سه ثانیه — افتادن و دوباره بالا آمدن همین‌جا دیده شود
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  if (!st && !err) return <Skeleton className="h-40" />;

  const tone = st?.up ? 'good' : st?.running ? 'warn' : 'bad';
  const label = st?.up ? 'بالاست و جواب می‌دهد' : st?.running ? 'روشن شده ولی هنوز جواب نمی‌دهد' : 'خاموش است';

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="وضعیتِ سرورِ حساب"
        icon={<ServerCog className="h-4 w-4" />}
        action={(
          <ActionButton
            onClick={async () => {
              await api('/api/account-server/restart', { method: 'POST', body: {} });
              toast('سرورِ حساب دوباره راه‌اندازی شد', 'good');
              await load();
            }}
            busyLabel="در حالِ راه‌اندازی…"
          >
            <RotateCcw className="h-4 w-4" /> راه‌اندازیِ دوباره
          </ActionButton>
        )}
      >
        {err && <Notice tone="bad">{err}</Notice>}
        {st && (
          <>
            <KV label="حال"><Badge tone={tone}>{label}</Badge></KV>
            <KV label="نسخه" mono>{st.version || '—'}</KV>
            <KV label="روشن از">{st.up && st.startedAt ? moment(st.startedAt) : '—'}</KV>
            <KV label="بازگشت‌ها پس از افتادن">{fa(st.restarts)}</KV>
            {!st.installed && (
              <Notice tone="bad">پوشهٔ سرورِ حساب روی این کامپیوتر نیست — مرکز فرمان را از فایلِ نصبِ تازه دوباره نصب کنید.</Notice>
            )}
          </>
        )}
      </Card>

      {st?.lastCrash && (
        <Card title={`آخرین افتادن — کدِ ${st.lastCrash.code} · ${moment(st.lastCrash.at)}`} icon={<ScrollText className="h-4 w-4" />}>
          <p className="mb-2 text-xs text-ink-muted">
            این سطرها خودِ دلیلِ افتادن‌اند. اگر نفهمیدید، عکسِ همین کادر کافی است.
          </p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-surface-sunken p-3 text-[11px] leading-5" dir="ltr">
            {st.lastCrash.lines.length ? st.lastCrash.lines.join('\n') : '(پروسه پیش از افتادن هیچ خطایی ننوشت)'}
          </pre>
        </Card>
      )}

      <Card title="لاگ" icon={<ScrollText className="h-4 w-4" />}>
        {lines.length === 0 ? (
          <p className="text-sm text-ink-muted">هنوز سطری نیست.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg bg-surface-sunken p-2 text-[11px] leading-5" dir="ltr">
            {lines.slice().reverse().map((l, i) => {
              const p = parse(l);
              return (
                <div key={i} className="whitespace-pre-wrap break-words" style={{ color: TONE[p.level] }}>
                  <span className="text-ink-muted">{p.at?.slice(11, 19)} </span>{p.text}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
