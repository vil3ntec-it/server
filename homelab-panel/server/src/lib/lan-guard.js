// ---------------------------------------------------------------------------
//  ══ درِ پنل فقط به شبکهٔ خانه باز است (۱۴۰۵/۰۷/۱۳) ═════════════════════════
//
//  گزارشِ صاحب سامانه: «برنامهٔ پمپ به سرور نمی‌رسد و خانه‌اش سبز نمی‌شود.»
//
//  ریشه، با سرورِ واقعی سنجیده شد: برنامهٔ ویندوزِ مرکز فرمان پنل را با
//  ‎HLP_HOST=127.0.0.1‎ بالا می‌آورد، یعنی پورتِ پنل **فقط روی خودِ همان
//  کامپیوتر** گوش می‌داد. کشفِ خودکار (UDP ‎4702‎) جواب می‌داد و نشانیِ
//  ‎http://192.168.x.x:4700‎ را می‌گفت، ولی هر کامپیوتر و گوشیِ دیگرِ شبکه
//  روی همان نشانی «اتصال رد شد» می‌گرفت — و حتی روی خودِ همان کامپیوتر،
//  اگر اولین جوابِ کشف از کارتِ شبکه می‌آمد نه از ‎127.0.0.1‎.
//
//  پس پنل حالا روی کارتِ شبکه هم گوش می‌دهد — و این فایل نگهبانِ همان است:
//  ⛔ **هر اتصالی که از شبکهٔ خانه یا خودِ همین کامپیوتر نیست، پیش از هر
//  بایتی بسته می‌شود.** کامپیوتری که مستقیم IPِ عمومی دارد (بی مودم و NAT)
//  نباید پنلش را به اینترنت نشان بدهد؛ راهِ اینترنت همان تونل است که به
//  پورتِ عمومی می‌رسد، نه به این پورت.
//
//  ⚠️ در سطحِ TCP است، نه میان‌افزارِ express: وب‌سوکت و Socket.IO و هر
//  درخواستِ دیگری که از این سرور بگذرد را هم می‌گیرد.
// ---------------------------------------------------------------------------
import net from 'node:net';

/** شبکه‌های خانه — همان‌هایی که ‎install.sh‎ هم در دیوارِ آتش باز می‌کند. */
export const LOCAL_NETS = Object.freeze([
  '127.0.0.0/8',      // خودِ همین کامپیوتر
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',    // Tailscale و CGNATِ مودم‌ها
  '169.254.0.0/16',   // لینک‌محلی (بی DHCP)
  '::1/128',
  'fc00::/7',         // IPv6ِ محلی
  'fe80::/10',
]);

function toBig(addr) {
  if (net.isIPv4(addr)) {
    return { v: 4, n: addr.split('.').reduce((a, p) => (a << 8n) + BigInt(Number(p)), 0n) };
  }
  if (!net.isIPv6(addr)) return null;
  //  باز کردنِ «::» و بخشِ IPv4ِ آخر (::ffff:1.2.3.4)
  let s = addr.split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const b = toBig(v4[1]).n;
    s = s.slice(0, -v4[1].length) + ((b >> 16n) & 0xffffn).toString(16) + ':' + (b & 0xffffn).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  const parts = [...h, ...fill, ...t];
  if (parts.length !== 8) return null;
  return { v: 6, n: parts.reduce((a, p) => (a << 16n) + BigInt(parseInt(p || '0', 16)), 0n) };
}

/** ‎"10.0.0.0/8"‎ ⇒ آزمونی که یک نشانی را می‌سنجد. بدشکل ⇒ ‎null‎. */
export function parseCidr(cidr) {
  const [ip, bitsRaw] = String(cidr || '').trim().split('/');
  const base = toBig(ip);
  if (!base) return null;
  const width = base.v === 4 ? 32 : 128;
  const bits = bitsRaw === undefined ? width : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(width - bits);
  return (addr) => addr.v === base.v && (addr.n & mask) === (base.n & mask);
}

/**
 * نشانیِ طرفِ اتصال از شبکهٔ خانه است؟
 *
 * ⚠️ ‎::ffff:192.168.1.5‎ (IPv4 داخلِ سوکتِ دوپشته) همان ‎192.168.1.5‎ است.
 * @param {string} address
 * @param {string[]} [extra] شبکه‌های افزوده (‎HLP_PANEL_NETS‎) — برای شبکهٔ خانه‌ای
 *   که نشانی‌اش در فهرستِ بالا نیست.
 */
export function isLocalPeer(address, extra = []) {
  let a = String(address || '').trim();
  if (!a) return false;
  const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) a = m[1];
  const addr = toBig(a);
  if (!addr) return false;
  for (const c of [...LOCAL_NETS, ...extra]) {
    const test = parseCidr(c);
    if (test && test(addr)) return true;
  }
  return false;
}

/** ‎HLP_PANEL_NETS="192.0.2.0/24, 203.0.113.7"‎ ⇒ فهرست. */
export function extraNetsFromEnv(env = process.env) {
  return String(env.HLP_PANEL_NETS || '')
    .split(/[,\s]+/).map((s) => s.trim()).filter((s) => s && parseCidr(s));
}

/**
 * نگهبان را روی یک سرورِ ‎http/https‎ می‌گذارد.
 * ⚠️ یک خطِ هشدار برای هر نشانی در هر ساعت — نه سیلِ لاگ از یک اسکنر.
 */
export function guardServer(server, { extra = extraNetsFromEnv(), log = () => {} } = {}) {
  const warned = new Map();
  server.on('connection', (socket) => {
    const from = socket.remoteAddress;
    if (isLocalPeer(from, extra)) return;
    const last = warned.get(from) || 0;
    if (Date.now() - last > 3600_000) {
      warned.set(from, Date.now());
      if (warned.size > 500) warned.clear();
      log(from);
    }
    socket.destroy();
  });
  return server;
}
