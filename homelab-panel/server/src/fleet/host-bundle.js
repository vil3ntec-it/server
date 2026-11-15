// ---------------------------------------------------------------------------
//  بستهٔ «هاستِ اشتراکی» (۱.۵۱.۱) — سرورِ حساب + نمایندهٔ هاست، آماده برای cPanel ⇐ «Setup Node.js App»
//
//  هاستِ اشتراکی root، systemd و داکر ندارد ⇒ پنلِ کامل نمی‌شود (docs/DEPLOY-ANYWHERE-fa.md §۵). آن‌چه می‌شود: سرورِ حساب
//  به‌عنوانِ یک برنامهٔ Node، و کنارش **نمایندهٔ هاست** (‎server/host-agent/‎) که با کدِ یک‌بارهٔ همین مرکز وصل می‌شود و
//  تپشِ امضاشده (Ed25519) را **فقط بیرون‌رو** با HTTPS می‌فرستد — هیچ درِ ورودیِ مدیریتی باز نمی‌کند.
//
//  چیدمانِ بسته (پوشهٔ ریشه = «Application root» ِ cPanel):
//      vill3n-host/                    ← همان کدِ سرورِ حسابِ همین پنل (package.json، src/ …) بی node_modules/داده/.env
//      vill3n-host/vill3n-agent/       ← start.cjs (Application startup file)، agent.cjs، center.json
//      vill3n-host/README-fa.txt       ← گام‌به‌گام
//  ⛔ هیچ رازی در بسته نیست: نه کدِ وصل (متغیرِ ‎VILL3N_JOIN_CODE‎ در همان صفحهٔ cPanel)، نه ‎.env‎، نه کلیدِ خصوصی؛
//     ‎center.json‎ فقط نشانی و **کلیدِ عمومیِ** مرکز (سنجاق برای پاسخ‌های امضاشده).
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createZip, walk } from '../control/zip.js';
import { resolveAccountDir } from '../account/supervisor.js';
import { centerKeys } from './keys.js';
import { defaultName } from './report.js';
import { versionInfo } from '../version.js';
import { config } from '../config.js';

export const AGENT_SRC = path.resolve(import.meta.dirname, '..', '..', 'host-agent');
export const AGENT_FILES = Object.freeze(['agent.cjs', 'start.cjs']);

/** آن‌چه از پوشهٔ سرورِ حساب در بسته نمی‌آید: وابستگی‌ها (cPanel خودش ‎npm install‎ می‌زند)، داده، راز، لاگ */
const SKIP_TOP = new Set(['node_modules', '.git', 'data', 'backups', 'logs', 'coverage', 'uploads', '.vmove-aside', '.vmove-panel']);
export function skipAccountPath(rel) {
  const parts = rel.replace(/\/$/, '').split('/');
  if (parts.some((p) => p === 'node_modules' || p === '.git')) return true;
  if (SKIP_TOP.has(parts[0])) return true;
  const base = parts[parts.length - 1];
  return /^\.env(\..*)?$/.test(base) || /\.(log|pem|key|vmove)$/i.test(base) || base === 'local-admin.key';
}

const README = (centerUrl) => `VILL3N — هاستِ اشتراکی (cPanel): فقط سرورِ حساب، وصل به مرکزِ ${centerUrl}
═══════════════════════════════════════════════════════════════════════

۱) cPanel ⇐ File Manager: همین فایلِ zip را در پوشهٔ خانه (نه public_html) بارگذاری و Extract کنید ⇒ پوشهٔ vill3n-host.
۲) cPanel ⇐ «Setup Node.js App» ⇐ CREATE APPLICATION:
     Node.js version:            20 یا 22
     Application mode:           Production
     Application root:           vill3n-host
     Application URL:            دامنه یا زیردامنه‌ای که برنامه‌های دکان صدا می‌زنند (مثلاً api.دامنهٔ‌شما)
     Application startup file:   vill3n-agent/start.cjs
۳) همان صفحه ⇐ Environment variables (ADD VARIABLE):
     VILL3N_JOIN_CODE      = کدِ ۱۲ نویسه‌ایِ «افزودنِ سرور» در پنل (فقط یک بار و تا ۱۰ دقیقه)
     NODE_ENV              = production
     DATABASE_URL          = pglite:/home/<نامِ کاربری>/vill3n-data/pg
     BACKUP_PATH           = /home/<نامِ کاربری>/vill3n-data/backups
     PUBLIC_URL            = https://<همان Application URL>
     TRUST_PROXY           = true
     (و API_SECRET · OTP_SECRET · JWT_SECRET · HESABPAY_CRED_KEY · ADMIN_BOOTSTRAP_USER · ADMIN_BOOTSTRAP_PASSWORD — بخشِ ۵ ِ docs/DEPLOY-ANYWHERE-fa.md)
     ⛔ HESABPAY_CRED_KEY (حساب‌پیِ خودکارِ دکان‌ها): همان مقدارِ سرورِ پیشین (‎--account-env‎)؛ تازه ⇒ یک بار ‎openssl rand -hex 32‎ —
        هرگز عوضش نکنید، وگرنه هر دکان کلیدِ حساب‌پی‌اش را دوباره می‌گذارد.
۴) «Run NPM Install» ⇐ «START APP» (یا RESTART).
۵) در پنل، پنجرهٔ «افزودنِ سرور» تا چند ثانیه «وصل شد ✓» می‌گوید. پس از آن VILL3N_JOIN_CODE را پاک کنید (دیگر لازم نیست).

محدودیت‌ها (صادقانه):
  • فقط سرورِ حساب — نه پنل، نه داکر، نه سایتِ دیگر، نه پمپ‌ها.
  • هاست برنامهٔ بی‌کار را می‌خواباند؛ نخستین درخواست کند است و تپش در خواب نمی‌رسد («آفلاین» در پنل).
  • نماینده هیچ درِ ورودی ندارد؛ فقط بیرون‌رو به مرکز تپش می‌فرستد. کلیدش در ~/.vill3n-agent با دسترسیِ ۶۰۰.
  • کدِ وصل جایی نوشته نمی‌شود (نه دیسک، نه لاگ).
`;

/**
 * بسته را در یک فایلِ موقت می‌سازد. ⇐ ‎{ file, size, files, cleanup }‎
 * @param {{ centerUrl: string }} opts
 */
export async function buildHostBundle({ centerUrl }) {
  //  پوشهٔ سرورِ حسابی که همین پنل اجرا می‌کند؛ وگرنه پوشهٔ صریحِ ‎HLP_ACCOUNT_DIR‎ حتی بی node_modules (cPanel خودش نصب می‌کند)
  const forced = config.accountApi?.dir || '';
  const acct = resolveAccountDir() || (forced && fs.existsSync(path.join(forced, 'src', 'index.js')) ? forced : null);
  if (!acct || !fs.existsSync(path.join(acct, 'package.json'))) {
    throw Object.assign(new Error('کدِ سرورِ حساب روی این پنل نیست — اول در «سرورِ حساب» نصبش کنید.'), { status: 409, code: 'account_missing' });
  }
  for (const f of AGENT_FILES) {
    if (!fs.existsSync(path.join(AGENT_SRC, f))) throw Object.assign(new Error(`نمایندهٔ هاست ناقص است (${f})`), { status: 500, code: 'agent_missing' });
  }
  const ROOT = 'vill3n-host';
  const entries = [];
  for (const e of await walk(acct, { skip: (rel) => skipAccountPath(rel) })) {
    if (e.name.startsWith('vill3n-agent/')) continue;
    entries.push({ ...e, name: `${ROOT}/${e.name}` });
  }
  for (const f of AGENT_FILES) entries.push({ name: `${ROOT}/vill3n-agent/${f}`, path: path.join(AGENT_SRC, f) });
  const center = {
    centerUrl: String(centerUrl),
    centerKey: centerKeys().publicKey,
    centerName: defaultName(),
    agentVersion: versionInfo.version || null,
    builtAt: Date.now(),
  };
  entries.push({ name: `${ROOT}/vill3n-agent/center.json`, data: Buffer.from(`${JSON.stringify(center, null, 2)}\n`) });
  entries.push({ name: `${ROOT}/README-fa.txt`, data: Buffer.from(README(centerUrl)) });
  const file = path.join(os.tmpdir(), `vill3n-host-${crypto.randomBytes(8).toString('hex')}.zip`);
  const r = await createZip(file, entries);
  const size = (await fsp.stat(file)).size;
  return { file, size, files: r.files, cleanup: () => fs.rm(file, { force: true }, () => {}) };
}
