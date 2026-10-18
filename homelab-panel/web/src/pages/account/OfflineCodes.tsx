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
  accountEmail?: string;
  gift?: boolean;
  issuedAt: number;
  endsAt: number;
  permanent: boolean;
  note: string;
  status: string;
  redeemedStationId: string;
  redeemedAt: number | null;
  createdAt: number;
};

type Made = { code: string; offline: Offline; file?: Record<string, unknown> };

type App = 'pump' | 'shop';

/** پمپ سه پلن دارد؛ فروشگاه («فروشگاه من») زمان‌دار یا دائمی — ‎shop-offline-codes.js‎ */
const PLANS_OF: Record<App, { code: string; title: string; days: string }[]> = {
  pump: [
    { code: 'std', title: 'استاندارد', days: '365' },
    { code: 'vip', title: 'وی‌آی‌پی', days: '365' },
    { code: 'perm', title: 'دائمی', days: '' },
  ],
  shop: [
    { code: 'sub', title: 'زمان‌دار', days: '365' },
    { code: 'perm', title: 'دائمی', days: '' },
  ],
};
const NAME_OF: Record<App, string> = { pump: 'پمپ بنزین', shop: 'فروشگاه من' };
const base = (app: App) => `/api/account-admin/offline-codes${app === 'shop' ? '?app=shop' : ''}`;
const revokeUrl = (app: App, id: string) => `/api/account-admin/offline-codes/${id}/revoke${app === 'shop' ? '?app=shop' : ''}`;

export default function OfflineCodes({ app = 'pump' }: { app?: App }) {
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [revoke, setRevoke] = useState<Offline | null>(null);
  const codes = useLoad<{ codes: Offline[] }>(base(app), [app]);

  return (
    <>
      <Card
        title={`کدِ اشتراکِ آفلاینِ ${NAME_OF[app]} (بی اینترنت، بسته به یک کامپیوتر)`}
        icon={<KeyRound className="h-4 w-4" />}
        action={<button className="btn btn-sm btn-primary" onClick={() => setMaking(true)}>کدِ آفلاینِ تازه</button>}
      >
        {codes.error && <CloudProblem code={codes.code} message={codes.error} onRetry={codes.reload} />}
        {codes.busy && !codes.data ? (
          <Skeleton rows={3} />
        ) : (codes.data?.codes.length || 0) === 0 ? (
          <Empty title="کدِ آفلاینی ساخته نشده"
                 hint={app === 'shop' ? 'شناسهٔ کامپیوتر را از مشتری بگیرید (برنامه ← اشتراک ← کدِ اشتراکِ آفلاین) و «کدِ آفلاینِ تازه» را بزنید.' : 'کدِ کامپیوتر را از مشتری بگیرید (برنامه ← پروفایل ← اشتراک و پلن‌ها) و «کدِ آفلاینِ تازه» را بزنید.'} />
        ) : (
          <Table head={['کامپیوتر', 'حساب', 'پلن', 'تا', 'یادداشت', 'حال', 'سرور دید', 'ساخته شد', '']}>
            {(codes.data?.codes || []).map((c) => (
              <Row key={c.id}>
                <Cell mono>{c.gift ? '🎁 گیفت' : c.computer}</Cell>
                <Cell>{c.accountEmail || 'هر حسابی'}</Cell>
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
          app={app}
          onClose={() => setMaking(false)}
          onMade={async (out) => { setMade(out); await codes.reload(); }}
        />
      )}
      {made && <MadeOffline app={app} made={made} onClose={() => setMade(null)} />}

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
            await api(revokeUrl(app, c.id), { body: {} });
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

function NewOffline({ app, onClose, onMade }: { app: App; onClose: () => void; onMade: (out: Made) => Promise<void> }) {
  const PLANS = PLANS_OF[app];
  const [computer, setComputer] = useState('');
  const [plan, setPlan] = useState(app === 'shop' ? 'sub' : 'vip');
  const [days, setDays] = useState('365');
  const [note, setNote] = useState('');
  const [account, setAccount] = useState('');
  //  🎁 گیفت‌کارت (۱۴۰۵/۰۷/۲۶): بی کدِ کامپیوتر، روی هر برنامه یک بار — فقط پمپ
  const [gift, setGift] = useState(false);
  const perm = plan === 'perm';

  return (
    <Modal
      open
      onClose={onClose}
      title={`کدِ اشتراکِ آفلاینِ تازه — ${NAME_OF[app]}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                const out = await api<Made>(base(app), {
                  body: { computer: gift ? '' : computer.trim(), gift, account: account.trim(), plan, days: perm || days === '' ? null : Number(days), note },
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
        کد فقط روی <b>همان کامپیوتری</b> (و اگر ایمیل بدهید، همان حسابی) کار می‌کند که این‌جا می‌زنید، بی اینترنت قفل‌ها را
        باز می‌کند و <b>یک بار</b> به کار می‌رود.
      </Notice>

      {app === 'pump' && (
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
          🎁 گیفت‌کارت — بی کدِ کامپیوتر؛ روی هر برنامه‌ای یک بار می‌نشیند و کدِ دیگر دوباره
        </label>
      )}

      {!gift && <>
      <label className="label">{app === 'shop' ? 'شناسهٔ کامپیوترِ مشتری (۱۶ نویسه)' : 'کدِ کامپیوترِ مشتری (۱۶ نویسه)'}</label>
      <input className="input mb-3 w-full font-mono tracking-widest" dir="ltr" placeholder="XXXX-XXXX-XXXX-XXXX"
             value={computer} onChange={(e) => setComputer(e.target.value.toUpperCase())} />
      </>}

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

      <label className="label">ایمیلِ حسابِ مشتری</label>
      <input className="input w-full" dir="ltr" type="email" placeholder="name@example.com"
             value={account} onChange={(e) => setAccount(e.target.value)} />
      <p className="mb-3 mt-1 text-xs text-ink-muted">
        کد فقط با همین حساب کار می‌کند. اگر آن کامپیوتر هرگز آنلاین نشده و حسابی ندارد، خالی بگذارید.
      </p>

      <label className="label">یادداشت (نامِ مشتری، پمپ…)</label>
      <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

function MadeOffline({ app, made, onClose }: { app: App; made: Made; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const o = made.offline;
  const where = app === 'shop' ? 'اشتراک ← کدِ اشتراکِ آفلاین' : 'پروفایل ← اشتراک و پلن‌ها ← کدِ اشتراکِ آفلاین';
  const message = `کدِ اشتراکِ آفلاینِ برنامهٔ ${NAME_OF[app]} (${o.planTitle}${o.permanent ? '' : ` تا ${day(o.endsAt)}`}) — ${o.gift ? 'گیفت‌کارت، روی هر کامپیوتر یک بار' : `فقط برای کامپیوترِ ${o.computer}، یک بار`}:\n\n${made.code}\n\nدر برنامه: ${where} ← چسباندن و «ثبتِ کد».`;

  return (
    <Modal
      open
      onClose={onClose}
      title="کدِ آفلاین ساخته شد"
      footer={<button className="btn btn-primary" onClick={onClose}>برداشتم، ببند</button>}
    >
      <Notice tone="warn">این کد را همین حالا بردارید — با بستنِ این پنجره دیگر دیده نمی‌شود.</Notice>

      <div className="my-3 text-sm">
        {o.planTitle} · {o.permanent ? 'دائمی' : `${fa(Math.round((o.endsAt - o.issuedAt) / 86400000))} روز، تا ${day(o.endsAt)}`} · {o.gift ? '🎁 گیفت‌کارت (هر کامپیوتر)' : <>کامپیوترِ <span className="font-mono" dir="ltr">{o.computer}</span></>}
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
        {made.file && <button
          className="btn btn-sm"
          onClick={() => {
            const blob = new Blob([JSON.stringify(made.file, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pump-${o.gift ? 'gift-' + o.serial : o.computer}.pumpkey`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }}
        >
          <Download className="h-4 w-4" />
          فایلِ ‎.pumpkey‎
        </button>}
      </div>
    </Modal>
  );
}
