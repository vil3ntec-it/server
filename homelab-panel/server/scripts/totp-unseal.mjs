#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  C-02 — برگشتِ مهاجرتِ ۰۱۵: پاکتِ رازِ دوعاملی ⇒ خام، فقط پیش از برگشت به پنلِ ۱.۵۳.۱ (که پاکت را نمی‌شناسد).
//      node scripts/totp-unseal.mjs
//  همان ‎HLP_DATA_DIR‎/پوشهٔ دادهٔ پنل و ‎data/vault.key‎ ِ خودش لازم است. پنل را پیش از اجرا ببندید.
//  ⛔ هیچ راز یا پاکتی چاپ نمی‌شود — فقط شمار. پنلِ ۱.۵۳.۲+ در بالا آمدنِ بعدی دوباره رمز نمی‌کند مگر مهاجرتِ ۰۱۵
//  را از ‎schema_migrations‎ بردارید؛ برای همین پس از این دستور همان نسخهٔ پیشین را نصب کنید.
// ---------------------------------------------------------------------------
import { DatabaseSync } from 'node:sqlite';
import { paths } from '../src/config.js';
import { unsealAllTotp } from '../src/lib/totp-seal.js';

const db = new DatabaseSync(paths.db);
try {
  console.log(`رازِ دوعاملیِ ${unsealAllTotp(db)} کاربر برای نسخهٔ پیشین باز شد`);
} finally {
  db.close();
}
