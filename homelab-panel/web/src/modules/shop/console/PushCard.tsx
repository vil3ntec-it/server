// ---------------------------------------------------------------------------
//  🔔 «اعلانِ گوشی (Firebase)» — کلیدِ حسابِ سرویس و «روشن» ِ پوشِ سرورِ حساب، از مرکزِ فرمان (۱.۵۱.۲)
//
//  دستورِ صاحب سامانه: «‎/admin/‎ ِ سرورِ حساب برایم باز نمی‌شود؛ کلیدِ پوش را همین‌جا بگذارم و روشنش کنم.»
//   • حال از ‎GET /console/push‎ (پوشیده: روشن؟ پروژه، دستگاه‌ها — هرگز خودِ کلید).
//   • متن یا فایل ⇒ فقط در حافظهٔ همین صفحه (‎FileReader‎ ِ محلی؛ نه بارگذاری به جای دیگر، نه localStorage)؛ سنجشِ پیش از
//     فرستادن با همان قاعدهٔ سرور (`serviceAccountProblem`). پس از ذخیره (یا «پاک کردن») متن از حافظه و صفحه می‌رود.
//   • ذخیره پشتِ «حالتِ تغییر» ِ ۱.۵۱.۱: پنجرهٔ باز ⇒ بی رمز؛ بسته ⇒ یک بار رمز (و کد) ⇒ پنجره باز می‌شود.
//  ⛔ هیچ ‎console.log‎، هیچ نشانی، هیچ پیامِ خطایی با متنِ کلید. خطای سرور پیامِ ثابتِ خودش را دارد.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, FileUp, LockOpen, Smartphone } from 'lucide-react';

import {
  api, Card, errText, KV, type Load, Modal, Notice, outcomeUnknown, StateLoading, toast, type Tx, useApp, useLoad, useTx,
} from '../host';
import { Problem, SourceLine } from '../ShopConsole';
import {
  CONSOLE, type PushRead, type PushSaved, type PushView, PUSH_SA_MAX, serviceAccountProblem, serviceAccountSummary, shown,
} from '../consoleData';
import { useSudo } from './FlagsCard';

const NOT_KEY = (tx: Tx) => tx('این فایلِ کلید نیست؛ فایلی را بزنید که از Service accounts ← Generate new private key گرفتید',
  'This is not the key file; use the file you got from Service accounts → Generate new private key',
  'دا د کیلي فایل نه دی؛ هغه فایل ورکړئ چې له Service accounts ← Generate new private key مو اخیستی');

/** پیامِ هر مشکلِ متن — سه‌زبانه؛ همان کدهای سرور */
export function problemText(tx: Tx, code: string): string {
  switch (code) {
    case 'sa_empty': return tx('متنِ فایلِ کلید خالی است', 'The key text is empty', 'د کیلي متن خالي دی');
    case 'sa_too_large': return tx('این متن از یک فایلِ کلید بسیار بزرگ‌تر است', 'This text is far larger than a key file', 'دا متن له کیلي فایل ډېر لوی دی');
    case 'sa_not_json': return `${NOT_KEY(tx)} ${tx('(متن JSON ِ درست نیست — شاید نیمه کپی شده)', '(not valid JSON — perhaps only partly copied)', '(سم JSON نه دی)')}`;
    case 'sa_app_config': return `${NOT_KEY(tx)} ${tx('(این google-services.json ِ برنامه است، نه کلیدِ سرویس)', '(this is the app’s google-services.json, not a service key)', '(دا google-services.json دی)')}`;
    case 'sa_incomplete': return `${NOT_KEY(tx)} ${tx('(project_id، client_email یا private_key ندارد)', '(project_id, client_email or private_key is missing)', '(project_id، client_email یا private_key نشته)')}`;
    case 'sa_bad_project': return tx('شناسهٔ پروژه (project_id) در این فایل شکلِ درستی ندارد', 'The project_id in this file is malformed', 'project_id سم نه دی');
    default: return NOT_KEY(tx);
  }
}

function sourceLabel(tx: Tx, s?: string) {
  if (s === 'panel') return tx('همین پنل', 'this panel', 'همدا پینل');
  if (s === 'env') return tx('محیطِ سرورِ حساب (env)', 'account-server environment (env)', 'چاپېریال (env)');
  if (s === 'file') return tx('فایلِ کنارِ سرورِ حساب', 'a file next to the account server', 'فایل');
  return '—';
}

function StatusLine({ p }: { p: PushView }) {
  const tx = useTx();
  const tone = !p.configured ? 'warn' : p.enabled ? 'good' : 'warn';
  const color = tone === 'good' ? 'var(--status-good)' : 'var(--status-warning)';
  const text = !p.configured
    ? tx('⚠️ فایلِ کلید داده نشده — پیام‌ها گم نمی‌شوند ولی به گوشیِ بسته زنگ نمی‌زنند', '⚠️ No key file yet — messages are not lost, but closed phones do not ring', '⚠️ د کیلي فایل نشته — پیغامونه نه ورکېږي خو تړلي ګوشي نه زنګېږي')
    : p.enabled
      ? tx('✅ روشن · {n} دستگاه · {p}', '✅ On · {n} devices · {p}', '✅ روښانه · {n} وسیلې · {p}', { n: shown(p.devices), p: p.project || '—' })
      : tx('⏸ کلید هست ولی خاموش است — هیچ اعلانی به گوشی نمی‌رود · {p}', '⏸ The key is set but push is off — nothing reaches phones · {p}', '⏸ کیلي شته خو بند دی · {p}', { p: p.project || '—' });
  return (
    <p role="status" data-testid="push-state" data-state={!p.configured ? 'unset' : p.enabled ? 'on' : 'off'}
       className="rounded-xl border px-3 py-2 text-sm font-medium" dir="auto"
       style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 9%, transparent)` }}>
      {text}
    </p>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} data-testid="push-enabled"
              className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              style={{ background: on ? 'var(--accent)' : 'color-mix(in srgb, var(--text-muted) 35%, transparent)', outlineColor: 'var(--accent)' }}>
        <span className="absolute h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] duration-150"
              style={{ insetInlineStart: on ? 'calc(100% - 1.375rem)' : '0.125rem' }} />
      </button>
      <span>{label}</span>
    </label>
  );
}

export default function PushCard() {
  const tx = useTx();
  const { can } = useApp();
  const admin = can('admin');
  const load = useLoad<PushRead>(CONSOLE.push);
  const sudo = useSudo(admin);
  const totp = useLoad<{ enabled?: boolean }>(admin ? '/api/auth/totp' : null);

  const [text, setText] = useState('');
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [done, setDone] = useState('');
  const [saved, setSaved] = useState<PushView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const cur: PushView | null = saved || load.data?.push || null;
  //  کلیدِ «روشن» از حالِ سرور — تا کاربر خودش عوضش نکرده
  useEffect(() => { if (cur && on === null) setOn(cur.enabled); }, [cur, on]);
  //  ⛔ بیرون رفتن از صفحه ⇒ متن هم می‌رود (state با خودِ کارت از بین می‌رود؛ این برای DOM ِ textarea است)
  useEffect(() => () => { if (areaRef.current) areaRef.current.value = ''; }, []);

  const trimmed = text.trim();
  const problem = trimmed ? serviceAccountProblem(trimmed) : null;
  const summary = trimmed && !problem ? serviceAccountSummary(trimmed) : null;
  const want = on ?? cur?.enabled ?? false;
  const changed = Boolean(trimmed) || (cur ? want !== cur.enabled : false);
  const keyMissing = want && !trimmed && cur ? !cur.configured : false;
  const ready = Boolean(cur) && changed && !problem && !keyMissing && !busy;

  const clearKey = () => {
    setText('');
    if (areaRef.current) areaRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = async (f: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    if (f.size > PUSH_SA_MAX) { setErr(problemText(tx, 'sa_too_large')); return; }
    setErr('');
    try { setText(await f.text()); } catch { setErr(tx('فایل خوانده نشد', 'Could not read the file', 'فایل ونه لوستل شو')); }
  };

  const send = async (cred?: { password: string; code?: string }) => {
    if (!ready || !cur) return;
    setBusy(true);
    setErr('');
    setUnknown(false);
    setDone('');
    try {
      const body: Record<string, unknown> = { enabled: want };
      if (trimmed) body.serviceAccount = trimmed;
      if (cred) { body.password = cred.password; if (cred.code) body.code = cred.code.trim(); }
      const r = await api<PushSaved>(CONSOLE.push, { method: 'PUT', body });
      clearKey();
      setSaved(r.push);
      setOn(r.push.enabled);
      sudo.set(r.sudo);
      setAsking(false);
      setDone(tx('ذخیره شد — تأییدشده از سرورِ حساب', 'Saved — confirmed by the account server', 'خوندي شو — د حساب سرور تایید'));
      toast(tx('اعلانِ گوشی ذخیره شد', 'Phone notifications saved', 'خوندي شو'));
      void load.reload();
    } catch (e) {
      if (outcomeUnknown(e)) { setUnknown(true); void load.reload(); } else setErr(errText(e));
      throw e;
    } finally { setBusy(false); }
  };
  const save = () => {
    if (!ready) return;
    if (sudo.open) { void send().catch(() => {}); return; }
    setAsking(true);
  };

  const title = tx('اعلانِ گوشی (Firebase)', 'Phone notifications (Firebase)', 'د ګوشي خبرتیا (Firebase)');
  const icon = <BellRing size={15} />;
  if (load.error) return <Card title={title} icon={icon}><Problem load={load as Load<unknown>} /></Card>;
  if (!cur) return <Card title={title} icon={icon}><StateLoading /></Card>;

  return (
    <Card title={title} icon={icon}>
      <div className="space-y-3" data-testid="push-card">
        <StatusLine p={cur} />
        <div className="grid gap-x-6 sm:grid-cols-2">
          <KV label={tx('پروژهٔ Firebase', 'Firebase project', 'Firebase پروژه')} mono>{cur.project || '—'}</KV>
          <KV label={tx('دستگاه‌های ثبت‌شده', 'Registered devices', 'ثبت شوې وسیلې')}>{shown(cur.devices)}</KV>
          <KV label={tx('حسابِ سرویس', 'Service account', 'د خدمت حساب')} mono><span dir="ltr">{cur.account || '—'}</span></KV>
          <KV label={tx('کلید از', 'Key from', 'کیلي له')}>{cur.configured ? sourceLabel(tx, cur.source) : '—'}</KV>
          {cur.apns && (
            <KV label={tx('آیفون (APNs)', 'iPhone (APNs)', 'آیفون (APNs)')}>
              {cur.apns.configured ? tx('آماده · {e}', 'ready · {e}', 'چمتو · {e}', { e: cur.apns.env || '—' }) : tx('تنظیم نشده (فقط در محیطِ سرور)', 'not set (server environment only)', 'نه دی تنظیم')}
            </KV>
          )}
        </div>
        <SourceLine source="/api/admin/push" data={load.data} at={load.at} />

        {/* راهنمای صاحب سامانه */}
        <div className="rounded-xl border border-line p-3 text-sm leading-7" data-testid="push-help">
          <p className="flex items-start gap-2">
            <Smartphone size={16} className="mt-1 shrink-0 text-ink-muted" />
            <span>{tx('تا خبرِ سفارش و پیام حتی وقتی برنامهٔ دکان بسته است به گوشی برسد و زنگ بزند، سرورِ حساب یک «کلیدِ حسابِ سرویس» از Firebase می‌خواهد. کلید فقط روی سرورِ حساب می‌ماند و هیچ‌جا دوباره نشان داده نمی‌شود.',
              'For order and chat alerts to reach and ring a phone even when the shop app is closed, the account server needs a Firebase “service account key”. The key stays on the account server only and is never shown again.',
              'د دې لپاره چې خبرتیا تړلې ګوشۍ ته هم ورسېږي، د حساب سرور د Firebase «د خدمت حساب کیلي» غواړي. کیلي یوازې په سرور کې پاتې کېږي.')}</span>
          </p>
          <ol className="mt-2 list-decimal space-y-1 ps-6 text-[13px]">
            <li>{tx('در console.firebase.google.com پروژهٔ برنامه را باز کنید ← چرخ‌دندهٔ ⚙️ ← Project settings.', 'At console.firebase.google.com open the app’s project → the ⚙️ gear → Project settings.', 'په console.firebase.google.com کې پروژه پرانیزئ ← ⚙️ ← Project settings.')}</li>
            <li>{tx('زبانهٔ Service accounts ← دکمهٔ Generate new private key ← Generate key. یک فایلِ ‎.json‎ دانلود می‌شود.', 'Service accounts tab → Generate new private key → Generate key. A .json file downloads.', 'Service accounts ← Generate new private key ← Generate key. یو ‎.json‎ فایل ښکته کېږي.')}</li>
            <li>{tx('همین‌جا «انتخابِ فایل» را بزنید و همان فایل را بدهید — یا فایل را باز کنید و همهٔ متنش را در کادرِ پایین بچسبانید.', 'Press “Choose file” here and pick that file — or open it and paste all of its text into the box below.', 'دلته «فایل وټاکئ» کېکاږئ — یا ټول متن یې لاندې ولګوئ.')}</li>
            <li>{tx('«روشن» را بزنید و «ذخیره». بعد در کارتِ پایین، دو کلیدِ دکان (ثبتِ دستگاه و اعلانِ سفارش) را روشن کنید.', 'Switch “On” and press “Save”. Then turn on the two shop switches in the card below (device registration and order alerts).', '«روښانه» او «خوندي کول» کېکاږئ؛ بیا لاندې دوه کیلي روښانه کړئ.')}</li>
          </ol>
        </div>

        {!admin ? (
          <Notice>{tx('گذاشتن یا عوض کردنِ کلید فقط برای مدیرِ پنل است (سرور هم همین را می‌سنجد).', 'Only panel admins can set or change the key (enforced by the server).', 'یوازې د پینل مدیر.')}</Notice>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }} autoComplete="off">
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="push-sa" className="text-xs font-semibold">{tx('متنِ فایلِ کلید (Service account JSON)', 'Key file text (Service account JSON)', 'د کیلي فایل متن (Service account JSON)')}</label>
                <span className="flex items-center gap-2">
                  <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" id="push-file" tabIndex={-1}
                         onChange={(e) => void pickFile(e.target.files?.[0])} />
                  <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} data-testid="push-pick">
                    <FileUp size={14} />{tx('انتخابِ فایل', 'Choose file', 'فایل وټاکئ')}
                  </button>
                  {text && <button type="button" className="btn btn-sm" onClick={clearKey}>{tx('پاک کردن', 'Clear', 'پاکول')}</button>}
                </span>
              </div>
              <textarea ref={areaRef} id="push-sa" data-testid="push-sa" className="input w-full font-mono text-xs leading-5" rows={6} dir="ltr"
                        value={text} onChange={(e) => setText(e.target.value)}
                        autoComplete="off" spellCheck={false} autoCorrect="off" autoCapitalize="off" data-gramm="false" data-lpignore="true"
                        placeholder={'{ "type": "service_account", "project_id": "…", "private_key": "…", "client_email": "…" }'} />
              {cur.configured && !text && (
                <p className="mt-1 text-[11px] text-ink-muted">{tx('کلیدی گذاشته شده (پروژهٔ {p}). برای عوض کردن، متنِ تازه را بگذارید؛ خالی = همان کلید می‌ماند.', 'A key is already set (project {p}). Paste a new one to replace it; empty = keep it.', 'کیلي شته ({p}). د بدلون لپاره نوې ولګوئ.', { p: cur.project || '—' })}</p>
              )}
              {problem && <p className="mt-1 text-xs" role="alert" data-testid="push-problem" style={{ color: 'var(--status-critical)' }}>{problemText(tx, problem)}</p>}
              {summary && <p className="mt-1 text-xs" data-testid="push-summary" style={{ color: 'var(--status-good)' }}>✓ {tx('کلیدِ پروژهٔ {p}', 'Key for project {p}', 'د {p} پروژې کیلي', { p: summary.project })} · <span dir="ltr">{summary.account}</span></p>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Toggle on={want} onChange={setOn} label={tx('روشن', 'On', 'روښانه')} />
              {keyMissing && <span className="text-xs" style={{ color: 'var(--status-warning)' }}>{tx('اول متنِ فایلِ کلید را بگذارید؛ بی کلید «روشن» هیچ پیامی نمی‌فرستد.', 'Add the key text first; “On” without a key sends nothing.', 'لومړی کیلي ورکړئ.')}</span>}
              <span className="flex-1" />
              {sudo.open && <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--status-good)' }}><LockOpen size={13} />{tx('حالتِ تغییر باز است — رمز لازم نیست', 'Edit mode is unlocked — no password needed', 'رمز ته اړتیا نشته')}</span>}
              <button type="submit" className="btn btn-primary" disabled={!ready} data-testid="push-save">{busy ? tx('در حالِ فرستادن…', 'Sending…', 'لېږل کېږي…') : tx('ذخیره', 'Save', 'خوندي کول')}</button>
            </div>
            {done && <Notice tone="good">{done}</Notice>}
            {err && !asking && <Notice tone="bad">{err}</Notice>}
            {unknown && <Notice tone="warn">{tx('نتیجه معلوم نیست — سرورِ حساب به‌موقع جواب نداد؛ شاید ذخیره شده باشد. حالِ بالا را ببینید و بعد دوباره بزنید.', 'Outcome unknown — the account server did not answer in time; it may have been saved. Check the status above before retrying.', 'پایله معلومه نه ده.')}</Notice>}
          </form>
        )}
      </div>
      {asking && (
        <PasswordDialog totpOn={totp.data?.enabled === true} busy={busy} err={err}
                        onClose={() => { setAsking(false); setErr(''); }} onSubmit={(c) => send(c).catch(() => {})} />
      )}
    </Card>
  );
}

/** «حالتِ تغییر» بسته است ⇒ یک بار رمز (و کد)؛ پس از آن ۱۵ دقیقه (تا ۶۰ با کارِ پیوسته) نه برای این کارت، نه برای پرچم‌ها. */
function PasswordDialog({ totpOn, busy, err, onClose, onSubmit }: {
  totpOn: boolean; busy: boolean; err: string; onClose: () => void; onSubmit: (c: { password: string; code?: string }) => void;
}) {
  const tx = useTx();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const ok = password.length > 0 && (!totpOn || /^\s*[0-9۰-۹٠-٩]{6}\s*$/.test(code));
  return createPortal(
    <Modal open onClose={onClose} title={tx('ذخیرهٔ اعلانِ گوشی', 'Save phone notifications', 'د ګوشي خبرتیا خوندي کول')}
           footer={<>
             <button className="btn" onClick={onClose}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
             <button className="btn btn-primary" disabled={!ok || busy} data-testid="push-confirm"
                     onClick={() => onSubmit({ password, ...(totpOn ? { code } : {}) })}>
               {busy ? tx('در حالِ فرستادن…', 'Sending…', 'لېږل کېږي…') : tx('ذخیره', 'Save', 'خوندي کول')}
             </button>
           </>}>
      <form className="space-y-2 text-sm" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSubmit({ password, ...(totpOn ? { code } : {}) }); }}>
        <p className="text-xs text-ink-muted">{tx('یک بار رمز بزنید؛ پس از آن تا ۱۵ دقیقه (و تا ۶۰ دقیقه با کارِ پیوسته) این کارت و پرچم‌ها رمز نمی‌خواهند.', 'Enter your password once; this card and the flags then need no password for 15 minutes (up to 60 with activity).', 'یو ځل پټنوم ولیکئ؛ بیا تر ۱۵ دقیقو پټنوم نه غواړي.')}</p>
        <label className="block text-xs">
          {tx('رمزِ پنلِ خودتان', 'Your panel password', 'ستاسو د پینل پټنوم')}
          <input className="input mt-1 w-full" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {totpOn && (
          <label className="block text-xs">
            {tx('کدِ شش‌رقمیِ دوعاملی', '6-digit two-factor code', 'د دوه فکتوري شپږ عددي کوډ')}
            <input className="input mt-1 w-full font-mono" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        )}
        {err && <Notice tone="bad">{err}</Notice>}
      </form>
    </Modal>,
    document.body,
  );
}
