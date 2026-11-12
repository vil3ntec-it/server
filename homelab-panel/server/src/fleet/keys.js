// ---------------------------------------------------------------------------
//  «سرورهای من» — کلیدهای خصوصیِ همین نصب (۱.۵۰.۹۴)
//
//  ⛔ کلیدِ خصوصی فقط این‌جاست: ‎<پوشهٔ داده>/fleet/‎ (پوشه ‎0700‎، فایل ‎0600‎). نه در دیتابیس، نه در دفتر، نه در لاگ،
//     نه در هیچ پاسخی. پاک هم نمی‌شود: جدا شدن فقط ردیفِ `fleet_link` را «left» می‌کند و کلیدِ کهنه سرِ جایش می‌ماند.
//    • `center.key` — کلیدِ مرکز؛ پاسخِ تپش را امضا می‌کند تا گره فقط فرمانِ «نگه‌داری» ِ مرکزِ واقعی را بپذیرد.
//    • `node-<شناسه>.key` — کلیدِ این نصب به‌عنوانِ گرهٔ همان شناسه.
//  ⚠️ این پوشه با «جابه‌جایی به کامپیوترِ دیگر» (‎move-server.mjs‎) همراهِ پوشهٔ داده می‌رود: کامپیوترِ تازه همان گره است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { generateKeys } from './crypto.js';

export function fleetDir() {
  return path.join(config.dataDir, 'fleet');
}

function ensureDir() {
  const dir = fleetDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* ویندوز: ACLِ پوشهٔ کاربر */ }
  return dir;
}

/** نوشتنِ اتمی با ‎0600‎ از همان لحظهٔ ساخت (نه ساختن و بعد تنگ کردن) */
function writeSecretFile(file, text) {
  ensureDir();
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(tmp, 0o600); } catch { /* ویندوز */ }
  fs.renameSync(tmp, file);
}

const nodeKeyFile = (nodeId) => path.join(fleetDir(), `node-${String(nodeId).replace(/[^A-Za-z0-9_-]/g, '')}.key`);

export function writeNodeKey(nodeId, privateKeyPem) {
  writeSecretFile(nodeKeyFile(nodeId), privateKeyPem);
}

export function readNodeKey(nodeId) {
  try {
    const pem = fs.readFileSync(nodeKeyFile(nodeId), 'utf8');
    return crypto.createPrivateKey(pem);
  } catch {
    return null;
  }
}

export function nodeKeyPath(nodeId) {
  return nodeKeyFile(nodeId);
}

let centerKey = null;

/** کلیدِ مرکز — بارِ اول ساخته می‌شود. ‎{ privateKey: KeyObject, publicKey: base64 }‎ */
export function centerKeys() {
  if (centerKey) return centerKey;
  const file = path.join(fleetDir(), 'center.key');
  let pem = null;
  try { pem = fs.readFileSync(file, 'utf8'); } catch { /* هنوز نیست */ }
  if (!pem) {
    pem = generateKeys().privateKeyPem;
    try {
      writeSecretFile(file, pem);
    } catch (e) {
      //  دو درخواستِ هم‌زمان: دیگری زودتر نوشت ⇒ همان را بخوان
      try { pem = fs.readFileSync(file, 'utf8'); } catch { throw e; }
    }
  }
  const privateKey = crypto.createPrivateKey(pem);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  centerKey = { privateKey, publicKey };
  return centerKey;
}
