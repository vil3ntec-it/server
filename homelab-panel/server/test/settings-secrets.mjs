// ---------------------------------------------------------------------------
//  شورا، پ۳ (ممیزی L3) — رازهای جدولِ settings رمزشده روی دیسک
//      node test/settings-secrets.mjs
//
//  هر بند در یک پروسهٔ جدا (‎HLP_DATA_DIR‎ِ موقت) با همان ‎db.js‎ِ واقعی:
//    ۱) نوشتن ⇒ در فایلِ SQLite هیچ رازی خوانا نیست؛ خواندن ⇒ همان مقدار
//    ۲) نصبِ کهنه با رازِ خام ⇒ بالا آمدن همه را رمز می‌کند، یک بار
//    ۳) کلیدِ گاوصندوقِ دیگر ⇒ راز خوانده نمی‌شود ولی بقیهٔ تنظیم سرِ جایش است
//  روی کدِ پیشین بندِ ۱ و ۲ سرخ‌اند.
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (d ? ' — ' + d : '')); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-sec-'));
const env = { ...process.env, HLP_DATA_DIR: dir, NODE_NO_WARNINGS: '1' };
function run(code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env, encoding: 'utf8' });
  if (r.status !== 0) console.log(r.stderr);
  return (r.stdout || '').trim().split('\n').pop();
}
const dbFile = () => fs.readdirSync(dir).find((f) => f === 'panel.db');
const rawRows = () => {
  const d = new DatabaseSync(path.join(dir, dbFile()));
  const o = Object.fromEntries(d.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  d.close();
  return o;
};
const all = () => { const d = new DatabaseSync(path.join(dir, dbFile())); const b = fs.readFileSync(path.join(dir, dbFile())); d.close(); return b.toString('latin1'); };

console.log('── ۱) نوشتن ⇒ روی دیسک رمزشده، خواندن ⇒ همان');
const out1 = run(`
  const { setSetting, getSetting, allSettings } = await import('./src/db.js');
  setSetting('tunnel_token', 'TUNNELSECRET-abc123');
  setSetting('codes_settings', { email: { host: 'smtp.gmail.com', user: 'a@b.c', password: 'SMTPSECRET-xyz' } });
  setSetting('otp_settings', { sms: { apiKey: 'SMSKEY-777', password: '' }, email: { password: 'OTPMAIL-9' } });
  setSetting('server_name', 'pump-home');
  const a = allSettings();
  console.log(JSON.stringify([getSetting('tunnel_token'), getSetting('codes_settings').email, getSetting('otp_settings'), a.tunnel_token, a.server_name]));
`);
const [tok, mail, otp, allTok, name] = JSON.parse(out1);
ok(tok === 'TUNNELSECRET-abc123' && allTok === tok, 'رمزِ تونل همان برمی‌گردد (getSetting و allSettings)');
ok(mail.password === 'SMTPSECRET-xyz' && mail.host === 'smtp.gmail.com', 'رمزِ SMTP همان، میزبان خوانا');
ok(otp.sms.apiKey === 'SMSKEY-777' && otp.email.password === 'OTPMAIL-9' && otp.sms.password === '', 'کلیدِ پیامک و رمزِ خالی درست');
ok(name === 'pump-home', 'تنظیمِ عادی دست نخورد');
const raw = rawRows();
for (const s of ['TUNNELSECRET', 'SMTPSECRET', 'SMSKEY', 'OTPMAIL'])
  ok(!Object.values(raw).some((v) => v.includes(s)) && !all().includes(s), `«${s}» در فایلِ دیتابیس خوانا نیست`);
ok(raw.codes_settings.includes('smtp.gmail.com') && raw.server_name.includes('pump-home'), 'بقیهٔ تنظیم‌ها خوانا مانده‌اند (پشتیبان روی کامپیوترِ دیگر)');

console.log('── ۲) نصبِ کهنه: رازِ خام ⇒ با بالا آمدن رمز می‌شود');
{
  const d = new DatabaseSync(path.join(dir, 'panel.db'));
  d.prepare("UPDATE settings SET value = ? WHERE key = 'tunnel_token'").run(JSON.stringify('OLDPLAIN-tok'));
  d.prepare("INSERT INTO settings(key, value) VALUES('jwt_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify('OLDPLAIN-jwt'));
  d.prepare("UPDATE settings SET value = ? WHERE key = 'codes_settings'").run(JSON.stringify({ email: { host: 'h', password: 'OLDPLAIN-smtp' } }));
  d.close();
}
const out2 = run(`
  const { getSetting, sealPlainSecrets } = await import('./src/db.js');
  console.log(JSON.stringify([getSetting('tunnel_token'), getSetting('jwt_secret'), getSetting('codes_settings').email.password, sealPlainSecrets()]));
`);
const [t2, j2, p2, again] = JSON.parse(out2);
ok(t2 === 'OLDPLAIN-tok' && j2 === 'OLDPLAIN-jwt' && p2 === 'OLDPLAIN-smtp', 'مقدارهای کهنه همان خوانده می‌شوند');
ok(!Object.values(rawRows()).some((v) => v.includes('OLDPLAIN')), 'و روی دیسک دیگر خام نیستند');
ok(again === 0, 'بارِ دوم هیچ چیزی دوباره رمز نمی‌شود');

console.log('── ۳) کلیدِ گاوصندوقِ دیگر');
fs.writeFileSync(path.join(dir, 'vault.key'), 'ab'.repeat(32));
const out3 = run(`
  const { getSetting } = await import('./src/db.js');
  console.log(JSON.stringify([getSetting('tunnel_token', 'NONE'), getSetting('codes_settings').email, getSetting('server_name')]));
`);
const [t3, m3, n3] = JSON.parse(out3);
ok(t3 === 'NONE', 'رازِ کلِ‌مقدار بی کلید ⇒ همان پیش‌فرض (نه زباله، نه استثنا)');
ok(m3.password === '' && m3.host === 'h', 'رمزِ SMTP خالی، بقیهٔ تنظیم سرِ جایش');
ok(n3 === 'pump-home', 'تنظیمِ عادی خوانا');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
console.log(`\n${pass} موفق، ${fail} ناموفق`);
process.exit(fail ? 1 : 0);
