// ---------------------------------------------------------------------------
//  🌐 «پنلِ مدیرِ سرور» — دکمهٔ یک‌کلیکیِ ‎<نشانیِ عمومیِ سرورِ حساب>/admin/‎، نام و رمزِ مدیرش، و «باز می‌شود؟» (۱.۵۱.۲)
//
//  دستورِ صاحب سامانه: «همون آدرس رو توی برنامهٔ سرور هم بزار، اگه خواستم با یک کلیک برم اون‌جا» — و «آدرس باز نمی‌شود».
//   • نشانی از سرورِ پنل (‎GET /api/account-server/admin-web‎ ⇐ ‎PUBLIC_BASE_URLS‎ ِ سرورِ حساب) — هیچ دامنه‌ای این‌جا نوشته نشده.
//   • نام و رمز: همان درهای «پمپ‌ها ← سرورِ حساب» (نام از وضعیت؛ رمز فقط مالک، «نمایشِ یک‌باره» با احرازِ دوباره و ردیفِ دفتر،
//     ‎POST /api/account-server/admin-password/reveal‎). رمز فقط در همان پنجره، یک دقیقه، و بعد از حافظهٔ صفحه هم می‌رود.
//   • «باز می‌شود؟» از خودِ سرور (‎GET …/admin-web/check‎) با دلیلِ روشن و راهِ درست کردن در همین پنل.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Globe, RefreshCw } from 'lucide-react';

import { api, ApiError, Card, CopyButton, getToken, KV, Modal, Notice, StateLoading, toast, type Tx, useTx } from '../host';
import { adminWebFixPath, type AdminWebCheck, type AdminWebInfo, CONSOLE } from '../consoleData';

/* ── یک خواندنِ مشترک برای کارت و منوی کناری (یک دقیقه، بسته به همان توکن) ── */
const FRESH_MS = 60_000;
let shared: { token: string | null; at: number; promise: Promise<AdminWebInfo> } | null = null;
function fetchInfo(force: boolean): Promise<AdminWebInfo> {
  const token = getToken();
  if (!force && shared && shared.token === token && Date.now() - shared.at < FRESH_MS) return shared.promise;
  const entry = { token, at: Date.now(), promise: api<AdminWebInfo>(CONSOLE.adminWeb) };
  shared = entry;
  entry.promise.catch(() => { if (shared === entry) shared = null; });
  return entry.promise;
}
export function useAdminWebInfo() {
  const [data, setData] = useState<AdminWebInfo | null>(null);
  const [error, setError] = useState(false);
  const run = useCallback(async (force: boolean) => {
    try { setData(await fetchInfo(force)); setError(false); } catch { setError(true); }
  }, []);
  useEffect(() => { void run(false); }, [run]);
  return { data, error, reload: () => run(true) };
}

/* ── دلیل و راهِ درست کردن، سه‌زبانه ── */
export function adminWebReason(tx: Tx, c: Pick<AdminWebCheck, 'code' | 'host' | 'http' | 'errorCode' | 'local'>): { title: string; fix: string } {
  const host = c.host || 'api.<…>';
  const http = String(c.http ?? '—');
  const ec = c.errorCode ? ` (${c.errorCode})` : '';
  switch (c.code) {
    case 'ok': return { title: tx('در دسترس است', 'Reachable', 'د لاسرسي وړ دی'), fix: '' };
    case 'unchecked': return { title: tx('هنوز سنجیده نشده', 'Not checked yet', 'لا نه دی ازمویل شوی'), fix: '' };
    case 'no_domain': return {
      title: tx('هنوز دامنه‌ای برای سرورِ حساب تنظیم نشده', 'No domain is set for the account server yet', 'د حساب سرور لپاره تر اوسه ډومېن نشته'),
      fix: tx('در «دامنه‌ها و تونل» دامنهٔ خودتان را بیفزایید؛ ‎api.<دامنه>‎ خودش ساخته می‌شود.', 'Add your domain under “Domains & tunnel”; api.<domain> is created automatically.', 'خپل ډومېن په «ډومېنونه او تونل» کې ورزیات کړئ.'),
    };
    case 'dns': return {
      title: tx('نامِ {h} در DNS پیدا نشد{e}', '{h} was not found in DNS{e}', '{h} په DNS کې ونه موندل شو{e}', { h: host, e: ec }),
      fix: tx('رکوردِ DNS ِ این نام نیست یا هنوز پخش نشده. در «دامنه‌ها و تونل» مسیرهای تونل را دوباره بسازید، یا در Cloudflare ← DNS یک CNAME برای همین نام به تونل بگذارید.',
        'There is no DNS record for this name yet. Rebuild the tunnel routes under “Domains & tunnel”, or add a CNAME for this name pointing at the tunnel in Cloudflare → DNS.',
        'د دې نوم DNS ریکارډ نشته. د تونل لارې بیا جوړې کړئ.'),
    };
    case 'tls': return {
      title: tx('گواهیِ HTTPS ِ {h} درست نیست{e}', 'The HTTPS certificate of {h} is not valid{e}', 'د {h} HTTPS سند سم نه دی{e}', { h: host, e: ec }),
      fix: tx('اگر نام دو سطح زیرِ دامنه است (مثلِ api.shop.example.com) گواهیِ رایگانِ Cloudflare آن را نمی‌پوشاند؛ یا رکوردِ DNS «فقط DNS» (ابرِ خاکستری) است. در Cloudflare آن را «Proxied» کنید یا نامِ یک‌سطحی بگذارید.',
        'If the name is two levels deep (e.g. api.shop.example.com) Cloudflare’s free certificate does not cover it; or the DNS record is “DNS only” (grey cloud). Make it “Proxied” in Cloudflare or use a one-level name.',
        'که نوم دوه کچې ژور وي، د Cloudflare وړیا سند یې نه پوښي؛ یا DNS ریکارډ «یوازې DNS» دی.'),
    };
    case 'timeout': return {
      title: tx('در ۶ ثانیه جوابی نیامد', 'No answer within 6 seconds', 'په ۶ ثانیو کې ځواب رانغی'),
      fix: tx('اینترنتِ این کامپیوتر یا تونل کند یا قطع است؛ «دامنه‌ها و تونل» را ببینید و چند دقیقهٔ دیگر دوباره بسنجید.', 'This computer’s internet or the tunnel is slow or down; check “Domains & tunnel” and try again in a few minutes.', 'انټرنېټ یا تونل ورو یا پرې دی.'),
    };
    case 'refused': return {
      title: tx('اتصال رد شد{e}', 'Connection refused{e}', 'اړیکه رد شوه{e}', { e: ec }),
      fix: tx('چیزی روی این نام گوش نمی‌دهد — رکوردِ DNS به جای دیگری (نه تونل) اشاره می‌کند؟ در Cloudflare ← DNS ببینید.', 'Nothing listens on this name — does the DNS record point somewhere other than the tunnel? Check Cloudflare → DNS.', 'په دې نوم څه نه اوري — DNS وګورئ.'),
    };
    case 'network': return { title: tx('خطای شبکه{e}', 'Network error{e}', 'د شبکې تېروتنه{e}', { e: ec }), fix: '' };
    case 'tunnel_down': return {
      title: tx('Cloudflare به تونلِ این سرور نرسید (خطای ۱۰۳۳ / ۵۳۰)', 'Cloudflare could not reach this server’s tunnel (error 1033 / 530)', 'Cloudflare د دې سرور تونل ته ونه رسېد (۱۰۳۳ / ۵۳۰)'),
      fix: tx('تونل روی این کامپیوتر خاموش یا قطع است. «دامنه‌ها و تونل» ← تونل را روشن یا تعمیر کنید.', 'The tunnel on this computer is off or disconnected. “Domains & tunnel” → start or repair the tunnel.', 'تونل بند یا پرې دی. «ډومېنونه او تونل» وګورئ.'),
    };
    case 'origin_down': return {
      title: tx('تونل وصل است ولی پنل روی این کامپیوتر جواب نداد (کدِ {c})', 'The tunnel is up but the panel on this computer did not answer (code {c})', 'تونل وصل دی خو پینل ځواب ورنه کړ ({c})', { c: http }),
      fix: tx('پنل یا پورتِ عمومی‌اش بالا نیست، یا تونل به پورتِ اشتباهی می‌رود. «دامنه‌ها و تونل» را ببینید.', 'The panel or its public port is not up, or the tunnel points at the wrong port. Check “Domains & tunnel”.', 'پینل یا یې عمومي پورټ پورته نه دی.'),
    };
    case 'account_down': return {
      title: tx('سرورِ حساب روی این کامپیوتر روشن نیست', 'The account server is not running on this computer', 'د حساب سرور په دې کمپیوټر روښانه نه دی'),
      fix: tx('«سرورِ حساب ← وضعیت و لاگ» ← روشن کردن، و لاگش را ببینید.', '“Account server → Status & log” → start it and check its log.', '«د حساب سرور ← حالت» ← روښانه یې کړئ.'),
    };
    case 'gateway_off': return {
      title: tx('درِ سرورِ حساب در این پنل خاموش است — ‎/admin/‎ از تونل به سرورِ حساب نمی‌رسد', 'The account-server gateway is off in this panel — /admin/ never reaches the account server', 'د حساب سرور دروازه بنده ده'),
      fix: tx('در ‎.env‎ ِ پنل ‎HLP_ACCOUNT_API‎ خاموش (۰) است یا سرورِ حساب نصب نیست — «سرورِ حساب ← وضعیت و لاگ».', 'HLP_ACCOUNT_API is off (0) in the panel’s .env, or the account server is not installed — see “Account server → Status & log”.', 'HLP_ACCOUNT_API بند دی.'),
    };
    case 'route_missing': return {
      title: tx('نامِ {h} در مسیرهای تونل نیست', '{h} is not among the tunnel routes', '{h} د تونل په لارو کې نشته', { h: host }),
      fix: c.local?.tunnelMode === 'token'
        ? tx('تونل از داشبوردِ Cloudflare مدیریت می‌شود: Zero Trust ← Networks ← Tunnels ← همین تونل ← Public Hostname ← این نام را به پورتِ عمومیِ پنل (http://localhost:<پورت>) بدهید و خانهٔ Path را خالی بگذارید.',
          'This tunnel is managed in the Cloudflare dashboard: Zero Trust → Networks → Tunnels → this tunnel → Public Hostname → point this name at the panel’s public port (http://localhost:<port>) and leave Path empty.',
          'تونل د Cloudflare له ډشبورډ اداره کېږي: Public Hostname ته دا نوم ورزیات کړئ.')
        : tx('در «دامنه‌ها و تونل» مسیرهای تونل را دوباره بسازید (یا همین نام را در «سرورهای من ← دامنه‌های هر برنامه» برای سرورِ حساب بگذارید).',
          'Rebuild the tunnel routes under “Domains & tunnel” (or add this name to the account server under “My servers → Domains per app”).',
          'د تونل لارې بیا جوړې کړئ.'),
    };
    case 'admin_not_forwarded': return {
      title: tx('تونل فقط ‎/api‎ را می‌رساند؛ ‎/admin/‎ به سرورِ حساب نمی‌رسد', 'The tunnel only forwards /api; /admin/ never reaches the account server', 'تونل یوازې /api رسوي؛ /admin/ نه رسېږي'),
      fix: tx('مسیرِ تونلِ این نام یک «Path» دارد. داشبوردِ Cloudflare ← Zero Trust ← Networks ← Tunnels ← Public Hostname ← {h} ← خانهٔ Path را خالی کنید (یا قاعدهٔ Rules/Workers ِ همین نام را بردارید). مسیرهای تونلِ خودِ این پنل برای کلِ نام‌اند، نه یک پوشه.',
        'This name’s tunnel route has a “Path”. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Public Hostname → {h} → clear the Path field (or remove the Rules/Workers rule for this name). This panel’s own tunnel routes cover the whole name, never one folder.',
        'د دې نوم د تونل لاره «Path» لري؛ هغه خالي کړئ.', { h: host }),
    };
    case 'tunnel_quick': return {
      title: tx('تونل در حالتِ «سریع» است — دامنهٔ خودتان از راهِ تونل سرو نمی‌شود', 'The tunnel is in “quick” mode — your own domain is not served through it', 'تونل په «چټک» حالت کې دی'),
      fix: tx('در «دامنه‌ها و تونل» تونلِ دائمی را راه بیندازید.', 'Set up the permanent tunnel under “Domains & tunnel”.', 'دایمي تونل جوړ کړئ.'),
    };
    case 'not_found': return {
      title: tx('این نشانی «پیدا نشد» (۴۰۴) داد', 'This address answered “not found” (404)', 'دې پته ۴۰۴ ورکړ'),
      fix: tx('سرورِ حساب یا ‎/admin/‎ ِ آن پشتِ این نام نیست؛ «دامنه‌ها و تونل» و «سرورِ حساب ← وضعیت و لاگ» را ببینید.', 'The account server (or its /admin/) is not behind this name; check “Domains & tunnel” and “Account server → Status & log”.', 'د حساب سرور د دې نوم تر شا نه دی.'),
    };
    case 'access': return {
      title: tx('پشتِ Cloudflare Access است — اول در صفحهٔ ورودِ Cloudflare وارد شوید', 'Behind Cloudflare Access — sign in on Cloudflare’s page first', 'د Cloudflare Access تر شا دی'),
      fix: '',
    };
    case 'redirect': return { title: tx('به نشانیِ دیگری فرستاده می‌شود (کدِ {c})', 'It redirects elsewhere (code {c})', 'بلې پتې ته لېږي ({c})', { c: http }), fix: '' };
    case 'blocked': return {
      title: tx('Cloudflare یا سرور راه نداد (کدِ {c})', 'Cloudflare or the server refused (code {c})', 'Cloudflare یا سرور لاره ورنه کړه ({c})', { c: http }),
      fix: tx('قاعده‌های امنیتیِ Cloudflare (WAF، کشور، Bot Fight) را برای همین نام ببینید.', 'Check Cloudflare security rules (WAF, country, Bot Fight) for this name.', 'د Cloudflare امنیتي قاعدې وګورئ.'),
    };
    case 'wrong_app': return { title: tx('جوابی آمد ولی صفحهٔ پنلِ مدیر نبود', 'Something answered, but not the admin page', 'ځواب راغی خو د مدیر پاڼه نه وه'), fix: '' };
    default: return { title: tx('پاسخِ غیرمنتظره (کدِ {c})', 'Unexpected answer (code {c})', 'ناڅاپي ځواب ({c})', { c: http }), fix: '' };
  }
}

function hintText(tx: Tx, h: string): string {
  switch (h) {
    case 'tunnel_quick': return tx('تونل در حالتِ سریع است', 'the tunnel is in quick mode', 'تونل چټک حالت کې دی');
    case 'tunnel_stopped': return tx('تونل روی این کامپیوتر روشن نیست', 'the tunnel is not running on this computer', 'تونل روښانه نه دی');
    case 'dns_not_routed': return tx('رکوردِ DNS ِ این نام هنوز از پنل ساخته نشده', 'the panel has not created this name’s DNS record yet', 'DNS ریکارډ لا نه دی جوړ');
    case 'protected_host': return tx('این نام «قُرق» است و عمداً به تونل نمی‌رود', 'this name is protected and deliberately kept off the tunnel', 'دا نوم خوندي دی');
    case 'gateway_off': return tx('درِ سرورِ حساب در پنل خاموش است', 'the account-server gateway is off in the panel', 'دروازه بنده ده');
    case 'account_stopped': return tx('سرورِ حساب روشن نیست', 'the account server is not running', 'د حساب سرور روښانه نه دی');
    default: return h;
  }
}

function fixLabel(tx: Tx, to: string): string {
  if (to.startsWith('/domains?tab=cloudflare')) return 'Cloudflare';
  if (to.startsWith('/domains')) return tx('دامنه‌ها و تونل', 'Domains & tunnel', 'ډومېنونه او تونل');
  return tx('سرورِ حساب ← وضعیت و لاگ', 'Account server → Status & log', 'د حساب سرور ← حالت');
}

export default function AdminWebCard({ owner }: { owner: boolean }) {
  const tx = useTx();
  const info = useAdminWebInfo();
  const [check, setCheck] = useState<AdminWebCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState('');
  const runCheck = useCallback(async (fresh: boolean) => {
    setChecking(true);
    try { setCheck(await api<AdminWebCheck>(CONSOLE.adminWebCheck(fresh))); setCheckErr(''); } catch (e) { setCheckErr(e instanceof Error ? e.message : String(e)); } finally { setChecking(false); }
  }, []);
  useEffect(() => { void runCheck(false); }, [runCheck]);

  //  ⛔ رمز فقط در همین پنجره و یک دقیقه — بسته شد، از حافظهٔ صفحه هم رفت (همان قاعدهٔ «پمپ‌ها ← سرورِ حساب»)
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  useEffect(() => {
    if (!revealed) return undefined;
    const t = setTimeout(() => setRevealed(null), 60_000);
    return () => clearTimeout(t);
  }, [revealed]);
  const reveal = async () => {
    if (revealing) return;
    setRevealing(true);
    try {
      const r = await api<{ password: string }>(CONSOLE.adminPasswordReveal, { method: 'POST', body: {} });
      setRevealed(r.password);
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      toast(c === 'owner_only' ? tx('فقط مالکِ اصلیِ پنل این رمز را می‌بیند.', 'Only the panel’s primary owner can see this password.', 'یوازې اصلي مالک یې ویني.')
        : c === 'reauth_required' ? tx('بی رمزِ تازه نشان داده نشد.', 'Not shown without re-entering your password.', 'بې تازه پټنوم ونه ښودل شو.')
          : (e as Error).message, 'bad');
    } finally { setRevealing(false); }
  };

  const title = tx('پنلِ مدیرِ سرور', 'Server admin panel', 'د سرور د مدیر پینل');
  const icon = <Globe size={15} />;
  if (info.error && !info.data) {
    return <Card title={title} icon={icon}><Notice tone="warn">{tx('نشانیِ پنلِ مدیرِ سرور از این میزبان خوانده نشد.', 'Could not read the admin panel address from this host.', 'پته ونه لوستل شوه.')}</Notice></Card>;
  }
  if (!info.data) return <Card title={title} icon={icon}><StateLoading /></Card>;
  const d = info.data;
  const verdict = check ? adminWebReason(tx, check) : null;
  const fixTo = check && check.code !== 'ok' ? adminWebFixPath(check.code) : null;
  const toneColor = !check ? 'var(--text-muted)' : check.tone === 'good' ? 'var(--status-good)' : check.tone === 'warn' ? 'var(--status-warning)' : 'var(--status-critical)';

  return (
    <Card title={title} icon={icon}>
      <div data-testid="admin-web">
        {d.url ? (
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn btn-primary" href={d.url} target="_blank" rel="noopener noreferrer" data-testid="admin-web-open">
              <ExternalLink size={15} />{tx('باز کردنِ پنلِ مدیرِ سرور', 'Open the server admin panel', 'د سرور د مدیر پینل پرانیستل')}
            </a>
            <code dir="ltr" className="min-w-0 truncate font-mono text-xs text-ink-muted">{d.url}</code>
            <CopyButton value={d.url} label={tx('کپیِ نشانی', 'Copy address', 'پته کاپي')} />
          </div>
        ) : (
          <Notice tone="bad">
            {adminWebReason(tx, { code: 'no_domain', host: null, http: null, errorCode: '', local: undefined }).title} —{' '}
            <Link className="underline" to="/domains?tab=tunnel">{tx('دامنه‌ها و تونل', 'Domains & tunnel', 'ډومېنونه او تونل')}</Link>
          </Notice>
        )}

        {/* باز می‌شود؟ */}
        {d.url && (
          <div className="mt-3 rounded-xl border border-line p-3" data-testid="admin-web-check" data-code={check?.code || ''}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: toneColor }} aria-hidden="true" />
              <span className="min-w-0 flex-1 font-medium" role="status">
                {checking && !check ? tx('در حالِ سنجش…', 'Checking…', 'ازمویل کېږي…')
                  : checkErr ? tx('سنجش نشد: {m}', 'Check failed: {m}', 'ازموینه ونه شوه: {m}', { m: checkErr })
                    : verdict ? <>{check?.code === 'ok' ? tx('در دسترس', 'Reachable', 'د لاسرسي وړ') : verdict.title}{check?.code === 'ok' && check.ms != null ? <span className="text-ink-muted"> · {tx('{n} میلی‌ثانیه', '{n} ms', '{n} ms', { n: check.ms })}</span> : null}</> : '—'}
              </span>
              <button type="button" className="btn btn-sm" disabled={checking} onClick={() => void runCheck(true)}>
                <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />{tx('دوباره بسنج', 'Check again', 'بیا ازمویل')}
              </button>
            </div>
            {verdict?.fix && <p className="mt-2 text-xs leading-6 text-ink-soft" dir="auto">{verdict.fix}</p>}
            {fixTo && <Link className="mt-1 inline-block text-xs underline" to={fixTo}>{fixLabel(tx, fixTo)} ←</Link>}
            {check && check.code !== 'ok' && (check.hints?.length ?? 0) > 0 && (
              <p className="mt-2 text-[11px] text-ink-muted">{tx('روی این کامپیوتر: ', 'On this computer: ', 'په دې کمپیوټر: ')}{check.hints!.map((h) => hintText(tx, h)).join(' · ')}</p>
            )}
            <p className="mt-2 text-[11px] text-ink-muted">
              {tx('این سنجش از خودِ سرور است. اگر این‌جا «در دسترس» است و برای شما باز نمی‌شود، مشکل از اینترنت، DNS یا مرورگرِ همان دستگاه است (مثلاً فیلتر).',
                'This check runs from the server itself. If it says “reachable” here but does not open for you, the problem is that device’s internet, DNS or browser (e.g. filtering).',
                'دا ازموینه له سرور څخه ده. که دلته د لاسرسي وړ وي او تاسو ته نه پرانیستل کېږي، ستونزه ستاسو د انټرنېټ ده.')}
              {check?.checkedAt ? <> · {new Date(check.checkedAt).toLocaleTimeString()}</> : null}
            </p>
          </div>
        )}

        {/* نام و رمزِ مدیرِ سرورِ حساب — همان درهای «پمپ‌ها ← سرورِ حساب» */}
        {d.admin ? (
          <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
            <KV label={tx('نامِ کاربری', 'Username', 'کارن نوم')}>
              <span className="inline-flex items-center gap-2"><span className="font-mono text-xs" dir="ltr">{d.admin.username}</span><CopyButton value={d.admin.username} /></span>
            </KV>
            <KV label={tx('رمز', 'Password', 'پټنوم')}>
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{d.admin.passwordSet ? '••••••••••' : '—'}</span>
                {d.admin.passwordSet && owner && (
                  <button type="button" className="btn btn-sm" disabled={revealing} onClick={reveal} data-testid="admin-web-reveal">
                    {revealing ? '…' : tx('نمایشِ یک‌باره', 'Show once', 'یو ځل ښودل')}
                  </button>
                )}
                {d.admin.passwordSet && !owner && <span className="text-[11px] text-ink-muted">{tx('فقط مالکِ اصلی می‌بیند', 'Primary owner only', 'یوازې اصلي مالک')}</span>}
              </span>
            </KV>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">{tx('نام و رمزِ مدیرِ سرورِ حساب این‌جا نیست (سرورِ حساب را این پنل بالا نمی‌آورد) — همان نام و رمزی که خودتان برایش گذاشته‌اید.', 'The account-server admin login is not managed by this panel — use the one you set for it.', 'د مدیر کارن نوم دلته نشته.')}</p>
        )}
        {(d.others?.length ?? 0) > 0 && (
          <p className="mt-2 text-[11px] text-ink-muted">{tx('نشانی‌های دیگرِ همین سرور: ', 'Other addresses of the same server: ', 'نورې پتې: ')}<span dir="ltr">{d.others!.join(' · ')}</span></p>
        )}
      </div>
      <Modal open={Boolean(revealed)} onClose={() => setRevealed(null)} title={tx('رمزِ مدیرِ سرورِ حساب', 'Account-server admin password', 'د حساب سرور د مدیر پټنوم')}
             footer={<button className="btn" onClick={() => setRevealed(null)}>{tx('بستن', 'Close', 'بندول')}</button>}>
        <p className="mb-2 text-xs text-ink-muted">{tx('این نمایش در دفترِ رخدادها ثبت شد. پنجره پس از یک دقیقه خودش بسته می‌شود و رمز دیگر در این صفحه نمی‌ماند.', 'This was recorded in the audit log. The window closes itself after a minute and the password leaves this page.', 'دا په دفتر کې ثبت شو؛ یوه دقیقه وروسته بندېږي.')}</p>
        <div className="flex items-center gap-2 font-mono text-sm" dir="ltr">
          <span className="select-all break-all">{revealed}</span>
          {revealed && <CopyButton value={revealed} />}
        </div>
      </Modal>
    </Card>
  );
}
