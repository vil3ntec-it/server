// ---------------------------------------------------------------------------
//  دفترِ رخدادها — چه کسی، چه کاری، کِی، با چه نتیجه‌ای
//  رمز و توکن هرگز این‌جا نوشته نمی‌شود.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Loading, toast } from '../../components/ui';
import { dateTime } from '../../format';
import { cc } from '../../control/api';
import type { AuditRow } from '../../control/types';
import { Cell, Row, Table } from '../../control/ui';

const PAGE = 100;

export default function Audit() {
  const { t, lang } = useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await cc.audit({ limit: PAGE, offset, q: query || undefined });
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [offset, query]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccAudit')}</h1>
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
          <input
            className="input ps-9"
            placeholder={t('ccSearch')}
            value={query}
            onChange={(e) => {
              setOffset(0);
              setQuery(e.target.value);
            }}
          />
        </div>
      </header>

      <Card title={t('ccAudit')} icon={<ScrollText className="h-4 w-4" />}>
        <Table head={[t('lastUpdate'), t('username'), 'Action', t('ccDetails'), t('status')]} empty={rows.length === 0}>
          {rows.map((r) => (
            <Row key={r.id}>
              <Cell className="whitespace-nowrap text-xs">{dateTime(r.at, lang)}</Cell>
              <Cell className="text-xs">{r.actor}</Cell>
              <Cell>
                <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{r.action}</span>
                {r.entity_id ? <span dir="ltr" className="ms-1.5 font-mono text-[10px] text-ink-muted">{r.entity_id}</span> : null}
              </Cell>
              <Cell>
                <span dir="ltr" className="block max-w-96 truncate font-mono text-[10px] text-ink-muted" title={r.detail || ''}>
                  {r.detail || '—'}
                </span>
              </Cell>
              <Cell style={{ color: r.result === 'ok' ? 'var(--status-good)' : 'var(--status-critical)' }} className="text-xs">
                {r.result}
              </Cell>
            </Row>
          ))}
        </Table>

        {total > PAGE && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ←
            </button>
            <span className="tnum text-xs text-ink-muted">
              {offset + 1}–{Math.min(offset + PAGE, total)} / {total}
            </span>
            <button className="btn btn-sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
              →
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
