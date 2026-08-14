// ---------------------------------------------------------------------------
//  «کدام نسخه الان بالاست؟»
//
//  اگر نسخهٔ تازه را باز کنید ولی نسخهٔ قدیمی هنوز روی همان پورت در حال اجرا
//  باشد، مرورگر همان قدیمی را نشان می‌دهد و آدم فکر می‌کند به‌روزرسانی نشده.
//  برای همین نسخه از دو جا خوانده و همه‌جا نشان داده می‌شود:
//
//      نسخهٔ سرور    ← package.json
//      شناسهٔ ساخت   ← نام فایلِ ساخته‌شدهٔ رابط کاربری (با هر build عوض می‌شود)
//
//  کافی است http://localhost:4700/health را باز کنید تا ببینید کدام نسخه بالاست.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT } from './config.js';

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

/** نام فایل جاوااسکریپتِ رابط کاربری — با هر بار build عوض می‌شود */
function uiBuild() {
  try {
    const html = fs.readFileSync(path.join(SERVER_ROOT, 'public', 'index.html'), 'utf8');
    const m = html.match(/assets\/(index-[A-Za-z0-9_-]+)\.js/);
    return m ? m[1].replace('index-', '') : null;
  } catch {
    return null;
  }
}

const version = packageVersion();
const build = uiBuild();

export const versionInfo = {
  version,
  build,
  // مسیر واقعیِ همین نسخه — اگر دو نسخه روی سیستم باشد، معلوم می‌کند کدام بالاست
  root: SERVER_ROOT,
  startedAt: Date.now(),
};

export function versionLine() {
  return `نسخهٔ ${version || '?'}${build ? ` (build ${build})` : ''}`;
}
