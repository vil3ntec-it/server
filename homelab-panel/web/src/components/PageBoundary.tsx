import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * ══ یک صفحهٔ خراب، کلِ برنامه را نمی‌بندد ═══════════════════════════════
 *
 * گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۰): «بخشِ فروشگاه را اصلاً باز نمی‌کند،
 * می‌زنم روش از برنامه می‌ندازه بیرون.»
 *
 * ⛔ **و ریشه‌اش یک صفحه نبود، نبودنِ این بود.** در React هر استثنایی که
 * وسطِ رندر پرتاب شود و کسی نگیردش، **کلِ درخت** را از ریشه برمی‌دارد —
 * یعنی پنجره سفید می‌شود و کاربر «بیرون انداخته» می‌شود. تا امروز هیچ
 * `ErrorBoundary`ی در این پنل نبود، پس یک `undefined.length` در یک صفحه،
 * همهٔ بیست‌وچند صفحهٔ دیگر را هم با خودش می‌برد.
 *
 * ⛔ **و این پنهان کردنِ خطا نیست.** خودِ خطا نوشته می‌شود (هم روی صفحه،
 * هم در کنسول برای بازبینی)، فقط جای مردنِ برنامه، همان یک صفحه سرخ
 * می‌شود و منو و بقیهٔ صفحه‌ها سرِ جایشان می‌مانند.
 *
 * ⚠️ و `key` عوض شدنِ مسیر آن را از نو می‌سازد، وگرنه یک بار خطا یعنی
 * همان صفحهٔ سرخ تا آخرِ عمرِ برنامه — حتی وقتی کاربر به جای دیگری رفت.
 */
type Props = { children: ReactNode };
type State = { err: Error | null };

export class PageBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    //  ⚠️ در کنسول می‌ماند تا بشود ریشه‌اش را دید؛ روی صفحه فقط جمله‌اش
    console.error('[صفحه شکست]', err, info.componentStack);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;

    return (
      <div
        className="mx-auto max-w-2xl rounded-2xl border p-5 text-sm leading-relaxed"
        style={{
          borderColor: 'color-mix(in srgb, var(--status-critical) 35%, transparent)',
          background: 'color-mix(in srgb, var(--status-critical) 8%, transparent)',
        }}
      >
        <h2 className="mb-2 text-base font-semibold" style={{ color: 'var(--status-critical)' }}>
          این صفحه باز نشد
        </h2>
        <p className="mb-3 text-ink-muted">
          بقیهٔ برنامه سرِ جایش است — از منو به هر بخشِ دیگری می‌توانید بروید.
          اگر این صفحه به سرورِ حساب وصل است، معمولاً یعنی نسخهٔ سرورِ حساب از
          پنل عقب‌تر است.
        </p>
        <pre className="mb-3 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs text-ink-muted">
          {err.message || String(err)}
        </pre>
        <button className="btn btn-sm" onClick={() => this.setState({ err: null })}>
          دوباره تلاش کن
        </button>
      </div>
    );
  }
}
