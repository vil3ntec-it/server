// ---------------------------------------------------------------------------
//  🔐 «اجازهٔ دسترسیِ پشتیبانی لازم است» — TEN-04 (۱.۵۰.۹۸؛ shop `support-grant-read.v1`)
//
//  وقتی پرچمِ ‎security / admin.support_grant‎ ِ سرورِ حساب روشن است، دادهٔ خصوصیِ یک دکان فقط با اجازهٔ زندهٔ «دیدنِ دادهٔ
//  خصوصی» (`read_private`) ِ **همان آدم** روی همان دکان دیده می‌شود: درها ‎403 grant_required‎ می‌دهند و پرونده‌های دکان/کاربر
//  ‎restricted: {code:'grant_required'}‎. همین یک پیام برای همهٔ آن جاها (پروندهٔ دکان و کاربر، اجازه‌های کارکنان، تعارض‌ها، جزئیاتِ
//  تغییرهای عکس) — ⛔ نه خطای خام و نه «خالی است»: می‌گوید چرا پنهان است و به کارتِ «دسترسیِ پشتیبانی» ِ همان دکان می‌برد.
// ---------------------------------------------------------------------------
import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';

import { useApp } from '../../../app-context';
import { Notice } from '../../../control/ui';
import { useTx } from './text';

export const GRANT_REQUIRED = 'grant_required';
export const SUPPORT_ACCESS_ANCHOR = 'support-access';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;   //  همان مرزِ شناسهٔ پل

export type GrantShop = { id: string; name?: string };
/** ‎restricted‎ ِ پرونده‌ها از پل (‎account-admin.js › restrictedOf‎) */
export type Restricted = { code: 'grant_required'; hidden: string[]; shops: GrantShop[] };

export const supportAccessHref = (shopId: string) => `/shop?tab=shops&shop=${encodeURIComponent(shopId)}#${SUPPORT_ACCESS_ANCHOR}`;

/** کارتِ همین دکان همین حالا روی صفحه است (پروندهٔ دکان) ⇒ همان‌جا، بی رفتن */
function jumpIfHere(e: MouseEvent, shopId: string) {
  const el = document.getElementById(SUPPORT_ACCESS_ANCHOR);
  if (!el || el.dataset.shop !== shopId) return;
  e.preventDefault();
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

export default function GrantNeeded({ shops, what }: { shops: GrantShop[]; what?: string }) {
  const tx = useTx();
  const { can } = useApp();
  const list = shops.filter((s) => ID_RE.test(String(s?.id || ''))).slice(0, 5);
  const label = (s: GrantShop) => (s.name ? `${s.name} (${s.id})` : s.id);
  return (
    <div data-grant-required role="status">
      <Notice tone="warn">
        <b>{tx('اجازهٔ دسترسیِ پشتیبانی لازم است', 'Support access grant required', 'د ملاتړ لاسرسي اجازه پکار ده')}</b>
        {' — '}
        {tx('{w} دادهٔ خصوصیِ دکان است و سرورِ حساب آن را فقط با اجازهٔ زندهٔ «دیدنِ دادهٔ خصوصی» ِ خودِ شما روی همان دکان نشان می‌دهد. چیزی پاک یا خالی نشده؛ فقط پنهان است.',
          '{w} is private shop data; the account server shows it only with your own live “Read private data” grant on that shop. Nothing was deleted or emptied — it is only hidden.',
          '{w} د هټۍ خصوصي معلومات دي؛ د حساب سرور یې یوازې ستاسو د «خصوصي معلومات لیدل» ژوندۍ اجازې سره ښيي. هېڅ نه دي ړنګ شوي؛ یوازې پټ دي.',
          { w: what || tx('این بخش', 'This section', 'دا برخه') })}
        <span className="mt-1 block">
          {can('admin')
            ? tx('اجازه را از کارتِ «دسترسیِ پشتیبانی» ِ پروندهٔ دکان بخواهید (پس از پذیرشِ صاحبِ دکان در برنامه‌اش باز می‌شود):',
              'Request it from the shop’s “Support access” card (it opens once the shop owner accepts in their app):',
              'اجازه د هټۍ د «د ملاتړ لاسرسی» کارت څخه وغواړئ:')
            : tx('اجازه برای هر کس جداست و فقط مدیرِ پنل درخواستش می‌کند — از مدیر بخواهید یا با حسابِ مدیر ببینید:',
              'Grants are per person and only panel admins can request one — ask an admin or view it with an admin account:',
              'اجازه د هر چا لپاره جلا ده او یوازې د پینل مدیر یې غوښتلی شي:')}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {list.length ? list.map((s) => (
            <Link key={s.id} data-grant-link={s.id} className="underline" to={supportAccessHref(s.id)} onClick={(e) => jumpIfHere(e, s.id)}>
              {tx('کارتِ «دسترسیِ پشتیبانی» ِ {s}', '“Support access” card of {s}', 'د {s} «د ملاتړ لاسرسی» کارت', { s: label(s) })}
            </Link>
          )) : (
            <Link data-grant-link="" className="underline" to="/shop?tab=shops">{tx('پروندهٔ دکان در «فروشگاه‌ها»', 'The shop’s page under “Shops”', 'په «هټۍ» کې د هټۍ دوسیه')}</Link>
          )}
        </span>
      </Notice>
    </div>
  );
}
