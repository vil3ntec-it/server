// ---------------------------------------------------------------------------
//  S18 (۱.۵۰.۷۵): قراردادِ نسخه‌دارِ پل ⇄ سرورِ حساب — در «یکپارچه‌سازی»
//
//  ⛔ از `GET /console/capabilities` (`contract`): سرورِ حسابِ بی `admin-contract.v1` ⇒ «پشتیبانی نمی‌شود» با نامِ توانایی؛
//     با آن ⇒ نسخهٔ قرارداد، «سازگار/ناسازگار» (نسخهٔ سرور ≤ نسخهٔ پل)، اثرِ انگشت و درهای پل که آن‌جا نیستند. هیچ عددی
//     این‌جا ساخته نمی‌شود؛ «از سورس خوانده نشد» فقط شمرده می‌شود.
// ---------------------------------------------------------------------------
import { FileCheck2 } from 'lucide-react';

import { Card, Loading } from '../../../components/ui';
import { Notice } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { shown } from '../consoleData';
import { NotSupported } from './parts';
import { useTx } from './text';

type Contract = {
  available: boolean; reason?: string; capability?: string; error?: string; message?: string;
  apiVersion?: number | null; apiVersionSeen?: number | null; bridgeVersion?: number; compatible?: boolean;
  routesHash?: string | null; count?: number | null; serverVersion?: string | null; checked?: number; unresolved?: number; missing?: string[];
  fetchedAt?: number;
};

export default function ContractCard() {
  const tx = useTx();
  const load = useLoad<{ contract?: Contract }>('/api/account-admin/console/capabilities');
  const c = load.data?.contract;
  return (
    <Card title={tx('قراردادِ پل با سرورِ حساب', 'Bridge contract with the account server', 'د حساب سرور سره د پل تړون')} icon={<FileCheck2 size={16} />}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : !c ? (
        <p className="text-xs text-ink-muted">—</p>
      ) : !c.available ? (
        c.reason === 'capability_missing'
          ? <NotSupported needs={c.capability || 'admin-contract.v1'}>{tx('این سرورِ حساب قراردادِ نسخه‌دار ندارد — سازگاری سنجیده نمی‌شود.',
            'This account server has no versioned contract — compatibility is not checked.', 'دا د حساب سرور نسخه‌لرونکی تړون نه لري — سمون نه ازمویل کېږي.')}</NotSupported>
          : <Notice tone="bad">{c.message || c.error}</Notice>
      ) : (
        <div className="space-y-2 text-xs" data-card="bridge-contract">
          <Notice tone={c.compatible ? 'good' : 'bad'}>
            {c.compatible
              ? tx('سازگار: نسخهٔ قراردادِ سرورِ حساب {v}، پل تا {b}', 'Compatible: account-server contract v{v}, bridge up to v{b}', 'سم: د حساب سرور تړون v{v}، پل تر v{b}', { v: shown(c.apiVersion), b: shown(c.bridgeVersion) })
              : tx('ناسازگار: نسخهٔ قراردادِ سرورِ حساب {v} از پل ({b}) تازه‌تر است — پنل را به‌روز کنید', 'Incompatible: account-server contract v{v} is newer than the bridge (v{b}) — update the panel', 'ناسم: د حساب سرور تړون v{v} له پل (v{b}) نوی دی — پینل نوی کړئ', { v: shown(c.apiVersion), b: shown(c.bridgeVersion) })}
          </Notice>
          <p>{tx('درهای مدیرِ آن‌جا', 'Admin routes there', 'هلته د مدیر لارې')}: {shown(c.count)} · {tx('اثرِ انگشت', 'hash', 'ګوتې نښه')} <code dir="ltr">{c.routesHash || '—'}</code>
            {c.serverVersion ? <> · {tx('نسخهٔ سرورِ حساب', 'server', 'سرور')} <code dir="ltr">{c.serverVersion}</code></> : null}</p>
          <p>{tx('مقصدهای پل که سنجیده شد: {n} (از سورس خوانده نشد: {u})', 'Bridge targets checked: {n} (not readable from source: {u})', 'ازمویل شوې د پل موخې: {n} (له سرچینې ونه لوستل شوې: {u})',
            { n: shown(c.checked), u: shown(c.unresolved) })}</p>
          {(c.missing || []).length === 0
            ? <Notice tone="good">{tx('هر درِ پل روی این سرورِ حساب هست', 'Every bridge target exists on this account server', 'د پل هره موخه په دې سرور شته')}</Notice>
            : (
              <Notice tone="warn">
                <span className="block font-semibold">{tx('این درهای پل روی این سرورِ حساب نیستند ({n})', 'These bridge targets are missing on this account server ({n})', 'دا د پل موخې په دې سرور نشته ({n})', { n: shown(c.missing!.length) })}</span>
                <ul className="mt-1 font-mono text-[11px]" dir="ltr">{c.missing!.slice(0, 50).map((m) => <li key={m}>{m}</li>)}</ul>
              </Notice>
            )}
          <SourceLine source="/api/admin/contract" data={c} at={load.at} />
        </div>
      )}
    </Card>
  );
}
