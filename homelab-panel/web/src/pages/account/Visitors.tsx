// ---------------------------------------------------------------------------
//  👣 بازدیدکننده‌ها — «چه کسی برنامه را باز کرد»
//
//  ⛔ این هم با دفترِ قدیمی رفت و در پل نوشته نشد.
//
//  ⚠️ ارزشش دقیقاً در «مهمان‌ها»ست: کسی که برنامه را نصب کرده و هنوز حساب
//     نساخته، همان کسی است که باید دنبالش رفت. صاحبِ سامانه پیش از این
//     فقط کسانی را می‌دید که ثبت‌نام کرده بودند — یعنی دقیقاً کسانی که
//     دیگر لازم نبود دنبالشان برود.
//  ⚠️ تپشِ برنامهٔ پمپ هم این‌جاست (`stationName`)؛ بی آن، پمپ‌ها «مهمانِ
//     بی‌حساب» شمرده می‌شدند.
//  ⛔ فقط دیدنی است — هیچ دکمه‌ای این‌جا چیزی را عوض نمی‌کند.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Footprints } from 'lucide-react';

import { Badge, Card, Empty, Skeleton } from '../../components/ui';
import { Cell, Row, Table } from '../../control/ui';
import { APP_LABEL, AppPicker, CloudProblem, PageHead, moment, useLoad, type AppId, type Scope } from './shared';

type Visitor = {
  id: string;
  app: string;
  platform: string;
  appVersion: string;
  userId: string;
  name: string;
  ip: string;
  accountName: string;
  accountEmail: string;
  shopName: string;
  stationName: string;
  stationCode: string;
  location: { label: string } | null;
  lastSeenAt?: number;
  firstSeenAt?: number;
  visits?: number;
};

export default function Visitors() {
  //  ⚠️ بخشِ آغازین از نشانی (`?app=`)، مثلِ بقیهٔ تب‌های «اشتراک‌ها»
  const [params] = useSearchParams();
  const fromUrl = params.get('app');
  const [app, setApp] = useState<Scope>(fromUrl === 'pump' || fromUrl === 'shop' ? fromUrl : 'both');
  const [guests, setGuests] = useState(false);
  const [q, setQ] = useState('');

  const path = `/api/account-admin/visitors?${new URLSearchParams({
    ...(app === 'both' ? {} : { app }),
    ...(guests ? { guests: '1' } : {}),
    ...(q ? { q } : {}),
  })}`;
  const list = useLoad<{ visitors: Visitor[]; summary?: Record<string, number> }>(path, [app, guests, q]);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="بازدیدکننده‌ها"
        sub="هر دستگاهی که برنامه را باز کرده — با حساب یا بی حساب"
        actions={
          <>
            <input
              className="input input-sm w-44"
              placeholder="نام، ایمیل، IP…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} />
              فقط مهمان‌ها
            </label>
            <AppPicker value={app} onChange={setApp} withBoth />
          </>
        }
      />

      {list.error && <CloudProblem code={list.code} message={list.error} onRetry={list.reload} />}

      <Card title="آخرین بازدیدها" icon={<Footprints className="h-4 w-4" />}>
        {list.busy && !list.data ? (
          <Skeleton rows={5} />
        ) : (list.data?.visitors.length || 0) === 0 ? (
          <Empty
            title={guests ? 'مهمانی نیست' : 'هنوز کسی برنامه را باز نکرده'}
            hint={guests ? 'یعنی هر کسی که برنامه را باز کرده، حساب هم ساخته.' : ''}
          />
        ) : (
          <Table head={['بخش', 'کی', 'حساب', 'دکان / پمپ', 'دستگاه', 'جا', 'آخرین بار']}>
            {(list.data?.visitors || []).map((v) => (
              <Row key={v.id}>
                <Cell><Badge tone={v.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[v.app as AppId] || v.app}</Badge></Cell>
                <Cell>{v.accountName || v.name || '—'}</Cell>
                <Cell>
                  {v.userId
                    ? <span dir="ltr">{v.accountEmail || '—'}</span>
                    : <Badge tone="warn">مهمان</Badge>}
                </Cell>
                <Cell>{v.shopName || v.stationName || '—'}</Cell>
                <Cell>{[v.platform, v.appVersion].filter(Boolean).join(' ') || '—'}</Cell>
                <Cell>{v.location?.label || v.ip || '—'}</Cell>
                <Cell>{v.lastSeenAt ? moment(v.lastSeenAt) : '—'}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
