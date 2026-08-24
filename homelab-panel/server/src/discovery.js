// ---------------------------------------------------------------------------
//  پیدا شدنِ خودکارِ سرور در شبکهٔ خانگی
//
//  مسئله: IP سرور با هر بار روشن شدنِ مودم عوض می‌شود و کاربر باید دستی
//  آدرس را در اپ بنویسد. حالا اپ فقط یک بستهٔ کوچک در شبکه پخش می‌کند و
//  سرور خودش جواب می‌دهد: «من این‌جام، آدرسم این است».
//
//  چرا UDP و نه mDNS: mDNS روی ویندوز و اندرویدِ قدیمی لنگ می‌زند و
//  کتابخانه می‌خواهد. این‌جا با سوکتِ خامِ خودِ Node، بدونِ هیچ وابستگی.
//
//  امنیت: پاسخ فقط می‌گوید «سرور این‌جاست و نامش چیست» — هیچ رمزی در آن
//  نیست. برای ورود، همان کدِ شش‌رقمی لازم است.
// ---------------------------------------------------------------------------
import dgram from 'node:dgram';
import os from 'node:os';
import { config } from './config.js';
import { getSetting } from './db.js';
import { secret } from './lib/secrets.js';
import { versionInfo } from './version.js';
import { logEvent } from './db.js';

export const DISCOVERY_PORT = Number(process.env.HLP_DISCOVERY_PORT) || 4702;
const PROBE = 'PUMP-SERVER-DISCOVER?';
const REPLY = 'PUMP-SERVER-HERE';

let socket = null;

/** شناسهٔ ثابتِ این سرور — با نصبِ دوباره عوض نمی‌شود مگر داده پاک شود */
export function serverId() {
  return secret('server_id', 8);
}

/** آدرس‌های شبکهٔ خانگیِ این کامپیوتر */
function localAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      found.push(net.address);
    }
  }
  return found;
}

/** همان چیزی که به پرسنده جواب داده می‌شود */
export function serverCard() {
  const addresses = localAddresses();
  return {
    reply: REPLY,
    id: serverId(),
    name: getSetting('server_name', null) || os.hostname(),
    version: versionInfo.version,
    port: config.port,
    publicPort: config.siteSync.port || null,
    addresses,
    // آدرسی که اپ باید مستقیم استفاده کند
    url: addresses.length ? `http://${addresses[0]}:${config.port}` : null,
    api: '/api/app',
    time: Date.now(),
  };
}

export function startDiscovery() {
  if (socket) return socket;

  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  } catch (e) {
    logEvent('error', 'panel', `کشفِ خودکار بالا نیامد: ${e.message}`);
    return null;
  }

  socket.on('message', (message, from) => {
    const text = String(message).trim();
    // فقط به پرسشِ درست جواب می‌دهیم — نه به هر بسته‌ای
    if (!text.startsWith(PROBE)) return;
    try {
      const answer = Buffer.from(JSON.stringify(serverCard()), 'utf8');
      socket.send(answer, from.port, from.address);
    } catch { /* شبکه قطع شد */ }
  });

  socket.on('error', (e) => {
    logEvent('warn', 'panel', `کشفِ خودکار خطا داد: ${e.message}`);
    try {
      socket.close();
    } catch { /* بسته شده */ }
    socket = null;
  });

  try {
    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true);
      } catch { /* اجازهٔ broadcast نبود */ }
    });
  } catch (e) {
    logEvent('warn', 'panel', `پورتِ کشفِ خودکار باز نشد: ${e.message}`);
    socket = null;
  }

  socket?.unref?.();
  return socket;
}

export function stopDiscovery() {
  try {
    socket?.close();
  } catch { /* بسته شده */ }
  socket = null;
}
