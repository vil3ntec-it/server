// ---------------------------------------------------------------------------
//  🩺 «چه چیزی خراب است؟» — زیربخشِ تنظیمات و داده‌های پمپ
//
//  ⚠️ چرا این‌جا: وقتی پمپی کار نمی‌کند، جوابِ «چرا» تا امروز در چند صفحهٔ
//  متفاوت پخش بود — تونل یک‌جا، ایمیل جای دیگر، ابر جای سوم. کسی که وسطِ
//  کار گیر کرده نمی‌تواند سه صفحه را کنار هم بگذارد.
//
//  ⚠️ و اگر خودِ این سنجه نشد، صفحه نباید بیفتد: صفحه‌ای که قرار است
//  بگوید چه چیزی خراب است، خودش نباید جزو خراب‌ها باشد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Stethoscope } from 'lucide-react';

import { api } from '../api';
import { Card, Loading } from '../components/ui';
import { ActionButton, Notice } from '../control/ui';

type Check = { key: string; title: string; state: 'good' | 'warn' | 'bad'; value?: string; hint?: string };

const TONE: Record<string, string> = {
  good: 'var(--status-good)',
  warn: 'var(--status-warning)',
  bad: 'var(--status-critical)',
};
const LABEL: Record<string, string> = { good: 'خوب', warn: 'توجه', bad: 'خراب' };

export default function PumpHealth() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api<{ checks: Check[] }>('/api/diagnostics');
      setChecks(res.checks || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'سنجیده نشد');
      setChecks([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (checks === null) return <Card title="بررسیِ سلامت" icon={<Stethoscope size={18} />}><Loading /></Card>;

  return (
    <Card
      title="بررسیِ سلامت"
      icon={<Stethoscope size={18} />}
      action={<ActionButton onClick={load}>دوباره بسنج</ActionButton>}
    >
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map((c) => (
          <div key={c.key} className="card flex items-start gap-3 p-3">
            <span
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: TONE[c.state] || 'var(--text-muted)' }}
              aria-label={LABEL[c.state] || c.state}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">{c.title}</span>
                {c.value && <span className="text-xs opacity-70" dir="auto">{c.value}</span>}
              </div>
              {c.hint && <div className="mt-0.5 text-xs leading-relaxed opacity-70" dir="auto">{c.hint}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
