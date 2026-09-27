// ---------------------------------------------------------------------------
//  🔑 کدِ اشتراکِ آفلاینِ پمپ — برای کامپیوتری که اینترنت ندارد
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۵): «یک کد برای اشتراک می‌سازی که برای
//  کسانی که نت ندارن هم اشتراک بدم… سه نوع کد… و اگه یارو اینترنت پیدا
//  کرد، سرور همون کد رو ببینه و بگه آره این حساب اشتراک داره.»
//
//    ۱) مشتری در برنامهٔ پمپ «پروفایل ← 💎 اشتراک و پلن‌ها» کدِ کامپیوترش
//       را می‌بیند (XXXX-XXXX-XXXX-XXXX) و برای شما می‌فرستد
//    ۲) همین‌جا با پلن زده می‌شود ⇒ سرورِ حساب امضا می‌کند
//    ۳) کد (یا فایلِ ‎.pumpkey‎) برای مشتری می‌رود؛ برنامه بی اینترنت
//       می‌سنجدش و قفل‌ها همان لحظه باز می‌شوند
//    ۴) روزی که آن کامپیوتر به حسابی وصل شد، ستونِ «سرور دید» پر می‌شود
//
//  ⚠️ کدِ خام فقط همین یک بار دیده می‌شود؛ سرور فقط سریالش را نگه می‌دارد.
//  ⚠️ کد فقط روی **همان** کامپیوتر کار می‌کند — کدِ کامپیوتر را درست بزنید
//     (نویسهٔ آخرش سنجش است و خطای تایپ را همین‌جا می‌گیرد).
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Check, Copy, Download, KeyRound } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, Notice, Row, Table } from '../../control/ui';
import { CloudProblem, day, fa, moment, useLoad } from './shared';

type Offline = {
  id: string;
  serial: string;
  plan: string;
  planTitle: string;
  computer: string;
  issuedAt: number;
  endsAt: number;
  permanent: boolean;
  note: string;
  status: string;
  redeemedStationId: string;
  redeemedAt: number | null;
  createdAt: number;
};

type Made = { code: string; offline: Offline; file: Record<string, unknown> };

const PLANS = [
  { code: 'std', title: 'استاندارد', days: '365' },
  { code: 'vip', title: 'وی‌آی‌پی', days: '365' },
  { code: 'perm', title: 'دائمی', days: '' },
];

export default function OfflineCodes() {
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [revoke, setRevoke] = useState<Offline | null>(null);
  const codes = useLoad<{ codes: Offline[] }>('/api/account-admin/offline-codes', []);

  return (
    <>
      <Card
        title="کدِ اشتراکِ آفلاین (بی اینترنت، بسته به یک کامپیوتر)"
        icon={<KeyRound className="h-4 w-4" />}
        action={<button className="btn btn-sm btn-primary" onClick={() => setMaking(true)}>کدِ آفلاینِ تازه</button>}
      >
        {codes.error && <CloudProblem code={codes.code} message={codes.error} onRetry={codes.reload} />}
        {codes.busy && !codes.data ? (
          <Skeleton rows={3} />
        ) : (codes.data?.codes.length || 0) === 0 ? (
          <Empty title="کدِ آفلاینی ساخته نشده"
                 hint="کدِ کامپیوتر را از مشتری بگیرید (برنامه ← پروفایل ← اشتراک و پلن‌ها) و «کدِ آفلاینِ تازه» را بزنید." />
        ) : (
          <Table head={['کامپیوتر', 'پلن', 'تا', 'یادداشت', 'حال', 'سرور دید', 'ساخته شد', '']}>
            {(codes.data?.codes || []).map((c) => (
              <Row key={c.id}>
                <Cell mono>{c.computer}</Cell>
                <Cell>{c.planTitle}</Cell>
                <Cell>{c.permanent ? 'دائمی' : day(c.endsAt)}</Cell>
                <Cell>{c.note || '—'}</Cell>
                <Cell>
                  <Badge tone={c.status === 'revoked' ? 'bad' : !c.permanent && c.endsAt < Date.now() ? 'warn' : 'good'}>
                    {c.status === 'revoked' ? 'باطل' : !c.permanent && c.endsAt < Date.now() ? 'منقضی' : 'فعال'}
                  </Badge>
                </Cell>
                <Cell>{c.redeemedAt ? `✅ ${moment(c.redeemedAt)}` : 'هنوز آنلاین نشده'}</Cell>
                <Cell>{moment(c.createdAt)}</Cell>
                <Cell>
                  {c.status !== 'revoked' && (
                    <button className="btn btn-sm btn-danger" onClick={() => setRevoke(c)}>باطل کن</button>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {making && (
        <NewOffline
          onClose={() => setMaking(false)}
          onMade={async (out) => { setMade(out); await codes.reload(); }}
        />
      )}
      {made && <MadeOffline made={made} onClose={() => setMade(null)} />}

      <ConfirmDialog
        open={Boolean(revoke)}
        danger
        title={revoke ? `باطل کردنِ کدِ کامپیوترِ ${revoke.computer}` : ''}
        message="از این لحظه سرورِ حساب این کد را نمی‌پذیرد و برنامه وقتی آنلاین شد کد را کنار می‌گذارد. ⚠️ کامپیوتری که هرگز آنلاین نشود تا پایانِ مهلتِ کد با آن کار می‌کند — کدِ آفلاین ذاتاً همین است."
        onCancel={() => setRevoke(null)}
        onConfirm={async () => {
          const c = revoke;
          setRevoke(null);
          if (!c) return;
          try {
            await api(`/api/account-admin/offline-codes/${c.id}/revoke`, { body: {} });
            toast('کد باطل شد');
            await codes.reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'نشد', 'bad');
          }
        }}
      />
    </>
  );
}

function NewOffline({ onClose, onMade }: { onClose: () => void; onMade: (out: Made) => Promise<void> }) {
  const [computer, setComputer] = useState('');
  const [plan, setPlan] = useState('vip');
  const [days, setDays] = useState('365');
  const [note, setNote] = useState('');
  const perm = plan === 'perm';

  return (
    <Modal
      open
      onClose={onClose}
      title="کدِ اشتراکِ آفلاینِ تازه — پمپ"
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                const out = await api<Made>('/api/account-admin/offline-codes', {
                  body: { computer: computer.trim(), plan, days: perm || days === '' ? null : Number(days), note },
                });
                onClose();
                await onMade(out);
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            ساختن
          </ActionButton>
        </>
      }
    >
      <Notice tone="info">
        کد فقط روی <b>همان کامپیوتری</b> کار می‌کند که کدش را این‌جا می‌زنید، و بی اینترنت قفل‌ها را باز می‌کند.
      </Notice>

      <label className="label">کدِ کامپیوترِ مشتری (۱۶ نویسه)</label>
      <input className="input mb-3 w-full font-mono tracking-widest" dir="ltr" placeholder="XXXX-XXXX-XXXX-XXXX"
             value={computer} onChange={(e) => setComputer(e.target.value.toUpperCase())} />

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">پلن</label>
          <select className="input w-full" value={plan}
                  onChange={(e) => { setPlan(e.target.value); setDays(PLANS.find((p) => p.code === e.target.value)?.days ?? ''); }}>
            {PLANS.map((p) => <option key={p.code} value={p.code}>{p.title}</option>)}
          </select>
        </div>
        <div>
          <label className="label">مدت به روز</label>
          <input className="input w-full" inputMode="numeric" disabled={perm}
                 value={perm ? 'همیشه' : days} onChange={(e) => setDays(e.target.value)} />
        </div>
      </div>

      <label className="label">یادداشت (نامِ مشتری، پمپ…)</label>
      <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

function MadeOffline({ made, onClose }: { made: Made; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const o = made.offline;
  const message = `کدِ اشتراکِ آفلاینِ برنامهٔ پمپ بنزین (${o.planTitle}${o.permanent ? '' : ` تا ${day(o.endsAt)}`}) — فقط برای کامپیوترِ ${o.computer}:\n\n${made.code}\n\nدر برنامه: پروفایل ← اشتراک و پلن‌ها ← کدِ اشتراکِ آفلاین ← چسباندن و «ثبتِ کد».`;

  return (
    <Modal
      open
      onClose={onClose}
      title="کدِ آفلاین ساخته شد"
      footer={<button className="btn btn-primary" onClick={onClose}>برداشتم، ببند</button>}
    >
      <Notice tone="warn">این کد را همین حالا بردارید — با بستنِ این پنجره دیگر دیده نمی‌شود.</Notice>

      <div className="my-3 text-sm">
        {o.planTitle} · {o.permanent ? 'دائمی' : `${fa(Math.round((o.endsAt - o.issuedAt) / 86400000))} روز، تا ${day(o.endsAt)}`} · کامپیوترِ <span className="font-mono" dir="ltr">{o.computer}</span>
      </div>

      <pre className="whitespace-pre-wrap break-all rounded-xl p-3 font-mono text-sm leading-7" dir="ltr"
           style={{ background: 'var(--surface-raised)' }}>{made.code}</pre>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="btn btn-sm"
          onClick={async () => {
            try { await navigator.clipboard.writeText(message); setCopied(true); toast('پیامِ آماده کپی شد'); }
            catch { toast('کپی نشد — دستی برش دارید', 'bad'); }
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          کپیِ پیامِ واتساپ
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            const blob = new Blob([JSON.stringify(made.file, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pump-${o.computer}.pumpkey`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }}
        >
          <Download className="h-4 w-4" />
          فایلِ ‎.pumpkey‎
        </button>
      </div>
    </Modal>
  );
}
