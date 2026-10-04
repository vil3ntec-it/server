// ---------------------------------------------------------------------------
//  🧑‍💼 نماینده‌های فروش — شورا، چ۳
//
//  «نقشِ نماینده در سرورِ حساب و پنل: کدِ تخفیفِ هر نماینده، فروش‌های او، و
//  گزارشِ کمیسیون (درصد از پنل). نماینده فقط مشتری‌های خودش را می‌بیند.»
//
//  ⛔ **هیچ درصدی این‌جا پیش‌فرض ندارد** — کادرِ درصد خالی باز می‌شود و تا مدیر
//     ننویسد چیزی ساخته نمی‌شود (سرورِ حساب `commission_required` می‌دهد).
//  ⛔ **هیچ عددی این‌جا حساب نمی‌شود**: فروش و کمیسیون از گزارشِ خودِ سرورِ
//     حساب (`/reps/:id/report`) — و فروش همان ردیف‌های کدِ تخفیفِ همان نماینده.
//  ⚠️ خودِ نماینده فروش‌هایش را در «پورتالِ مشتری»ِ سرورِ حساب، زبانهٔ
//     «نمایندگی»، می‌بیند — فقط مالِ خودش.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserCheck } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { Cell, Row, Table } from '../../control/ui';
import { APP_LABEL, AppPicker, CloudProblem, PageHead, day, fa, useLoad, type AppId, type Scope } from './shared';

type Rep = {
  id: string; app: AppId; userId: string; name: string; email: string;
  commissionPct: number; status: 'active' | 'disabled'; createdAt: number;
};
type RepSale = {
  id: string; app: AppId; code: string; customer: string; plan: string;
  finalPrice: number; currency: string; commissionPct: number; commission: number; at: number;
};
type RepReport = {
  rep: Rep;
  totals: { count: number; customers: number; byCurrency: { currency: string; count: number; sales: number; commission: number }[] };
  sales: RepSale[];
};

export default function SalesReps() {
  const [params] = useSearchParams();
  const fromUrl = params.get('app');
  const [app, setApp] = useState<Scope>(fromUrl === 'pump' || fromUrl === 'shop' ? fromUrl : 'both');
  const reps = useLoad<{ reps: Rep[] }>(`/api/account-admin/reps${app === 'both' ? '' : `?app=${app}`}`, [app], 'sales');
  const [adding, setAdding] = useState(false);
  const [report, setReport] = useState<Rep | null>(null);
  const [codeFor, setCodeFor] = useState<Rep | null>(null);
  const [editPct, setEditPct] = useState<Rep | null>(null);

  const toggle = async (r: Rep) => {
    try {
      await api(`/api/account-admin/reps/${r.id}`, { method: 'PATCH', body: { status: r.status === 'active' ? 'disabled' : 'active' } });
      reps.reload();
    } catch (e) { toast((e as Error).message, 'bad'); }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="نماینده‌های فروش"
        sub="هر نماینده کدِ تخفیفِ خودش را دارد؛ هر اشتراکی که با کدِ او داده شود فروشِ اوست. درصدِ کمیسیون فقط از همین‌جا."
        actions={
          <>
            <AppPicker value={app} onChange={setApp} withBoth />
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)} data-testid="rep-add">نمایندهٔ تازه</button>
          </>
        }
      />
      {reps.error && <CloudProblem code={reps.code} message={reps.error} onRetry={reps.reload} />}
      <Card title="نماینده‌ها" icon={<UserCheck className="h-4 w-4" />}>
        {reps.busy && !reps.data ? <Skeleton rows={3} />
          : (reps.data?.reps.length || 0) === 0 ? (
            <Empty title="هنوز نماینده‌ای نیست" hint="نماینده اول در برنامه حساب می‌سازد؛ بعد با همان ایمیل این‌جا «نمایندهٔ تازه»." />
          ) : (
            <Table head={['نام', 'ایمیل', 'بخش', 'کمیسیون', 'حال', '']}>
              {(reps.data?.reps || []).map((r) => (
                <Row key={r.id}>
                  <Cell>{r.name || '—'}</Cell>
                  <Cell mono>{r.email}</Cell>
                  <Cell><Badge tone={r.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[r.app]}</Badge></Cell>
                  <Cell className="tnum">٪{fa(r.commissionPct)}</Cell>
                  <Cell><Badge tone={r.status === 'active' ? 'good' : 'bad'}>{r.status === 'active' ? 'فعال' : 'غیرفعال'}</Badge></Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-1">
                      <button className="btn btn-sm" onClick={() => setReport(r)}>گزارش</button>
                      {r.status === 'active' && <button className="btn btn-sm" onClick={() => setCodeFor(r)}>کدِ تخفیف</button>}
                      <button className="btn btn-sm" onClick={() => setEditPct(r)}>درصد</button>
                      <button className={`btn btn-sm ${r.status === 'active' ? 'btn-danger' : ''}`} onClick={() => toggle(r)}>
                        {r.status === 'active' ? 'غیرفعال کن' : 'فعال کن'}
                      </button>
                    </div>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
      </Card>
      {adding && <AddRep onClose={() => setAdding(false)} onDone={() => { setAdding(false); reps.reload(); }} />}
      {report && <ReportModal rep={report} onClose={() => setReport(null)} />}
      {codeFor && <RepCode rep={codeFor} onClose={() => setCodeFor(null)} />}
      {editPct && <EditPct rep={editPct} onClose={() => setEditPct(null)} onDone={() => { setEditPct(null); reps.reload(); }} />}
    </div>
  );
}

function AddRep({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [app, setApp] = useState<AppId>('shop');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pct, setPct] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/account-admin/reps', { body: { app, email: email.trim(), name: name.trim(), commissionPct: pct.trim() } });
      toast('نماینده ساخته شد');
      onDone();
    } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="نمایندهٔ تازه"
      footer={<button className="btn btn-primary" disabled={busy || !email.trim() || !pct.trim()} onClick={save}>ساختن</button>}>
      <div className="flex flex-col gap-2">
        <AppPicker value={app} onChange={(v) => setApp(v as AppId)} />
        <input className="input" dir="ltr" placeholder="ایمیلِ حسابِ نماینده" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="rep-email" />
        <input className="input" placeholder="نام (اختیاری)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" inputMode="decimal" placeholder="درصدِ کمیسیون — مثلاً 10" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="rep-pct" />
        <p className="text-xs text-ink-muted">درصد پیش‌فرض ندارد. عوض کردنش بعداً فروش‌های گذشته را دست نمی‌زند — هر فروش درصدِ همان روزِ خودش را نگه می‌دارد.</p>
      </div>
    </Modal>
  );
}

function EditPct({ rep, onClose, onDone }: { rep: Rep; onClose: () => void; onDone: () => void }) {
  const [pct, setPct] = useState(String(rep.commissionPct));
  const save = async () => {
    try {
      await api(`/api/account-admin/reps/${rep.id}`, { method: 'PATCH', body: { commissionPct: pct.trim() } });
      onDone();
    } catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <Modal open onClose={onClose} title={`درصدِ کمیسیونِ ${rep.name || rep.email}`}
      footer={<button className="btn btn-primary" disabled={!pct.trim()} onClick={save}>ذخیره</button>}>
      <input className="input w-full" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
      <p className="mt-2 text-xs text-ink-muted">فقط فروش‌های از این به بعد با درصدِ تازه حساب می‌شوند.</p>
    </Modal>
  );
}

function RepCode({ rep, onClose }: { rep: Rep; onClose: () => void }) {
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const save = async () => {
    try {
      const out = await api<{ code: { code: string } }>('/api/account-admin/discount-codes', {
        body: { app: rep.app, kind, value: Number(value) || 0, code: code.trim(), repId: rep.id, note: `نماینده: ${rep.name || rep.email}` },
      });
      toast(`کدِ ${out.code.code} ساخته شد`);
      onClose();
    } catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <Modal open onClose={onClose} title={`کدِ تخفیفِ ${rep.name || rep.email} (${APP_LABEL[rep.app]})`}
      footer={<button className="btn btn-primary" disabled={!value.trim()} onClick={save}>ساختن</button>}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          <button className={`btn btn-sm ${kind === 'percent' ? 'btn-primary' : ''}`} onClick={() => setKind('percent')}>درصدی</button>
          <button className={`btn btn-sm ${kind === 'amount' ? 'btn-primary' : ''}`} onClick={() => setKind('amount')}>مبلغی</button>
        </div>
        <input className="input" inputMode="decimal" placeholder={kind === 'percent' ? 'درصدِ تخفیف' : 'مبلغِ تخفیف'} value={value} onChange={(e) => setValue(e.target.value)} />
        <input className="input" dir="ltr" placeholder="کد (خالی ⇒ خودِ سرور می‌سازد)" value={code} onChange={(e) => setCode(e.target.value)} />
        <p className="text-xs text-ink-muted">هر اشتراکی که با این کد داده شود («اشتراک بده» ← کدِ تخفیف) فروشِ همین نماینده است.</p>
      </div>
    </Modal>
  );
}

function ReportModal({ rep, onClose }: { rep: Rep; onClose: () => void }) {
  const r = useLoad<RepReport>(`/api/account-admin/reps/${rep.id}/report`, [rep.id], 'sales');
  return (
    <Modal open onClose={onClose} title={`گزارشِ ${rep.name || rep.email}`}>
      {r.error && <CloudProblem code={r.code} message={r.error} onRetry={r.reload} />}
      {!r.data ? <Skeleton rows={3} /> : (
        <div className="flex flex-col gap-3" data-testid="rep-report">
          <p className="text-sm">{fa(r.data.totals.count)} فروش · {fa(r.data.totals.customers)} مشتری · کمیسیونِ امروز ٪{fa(rep.commissionPct)}</p>
          {r.data.totals.byCurrency.map((c) => (
            <p key={c.currency} className="text-sm tnum">
              جمعِ فروش <b>{fa(c.sales)} {c.currency}</b> — کمیسیون <b>{fa(c.commission)} {c.currency}</b>
            </p>
          ))}
          {r.data.sales.length === 0 ? <Empty title="هنوز فروشی با کدهای این نماینده نیست" /> : (
            <Table head={['تاریخ', 'مشتری', 'پلن', 'کد', 'مبلغ', 'کمیسیون']}>
              {r.data.sales.map((s) => (
                <Row key={s.id}>
                  <Cell>{day(s.at)}</Cell>
                  <Cell>{s.customer || '—'}</Cell>
                  <Cell>{s.plan || '—'}</Cell>
                  <Cell mono>{s.code}</Cell>
                  <Cell className="tnum">{fa(s.finalPrice)} {s.currency}</Cell>
                  <Cell className="tnum">{fa(s.commission)} (٪{fa(s.commissionPct)})</Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
      )}
    </Modal>
  );
}
