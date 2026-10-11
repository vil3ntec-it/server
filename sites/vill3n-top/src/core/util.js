'use strict';
// ابزارهای کوچک مشترک — بدون هیچ وابستگی بیرونی
const crypto = require('crypto');

const TZ = 'Asia/Kabul';

function id(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// کد خوانا برای اشتراک: بدون حروف شبیه‌به‌هم (0/O و 1/I)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function licenseCode() {
  const buf = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += CODE_ALPHABET[buf[i] % 32];
  return `V3-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// رشتهٔ امن برای جاسازی JSON داخل <script type="application/ld+json">
function jsonForHtml(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

// ورودی‌های بیرونی فقط اگر رشته یا عدد باشند پذیرفته می‌شوند (شیء و آرایه نادیده گرفته می‌شود)
function str(v, max = 200) {
  if (typeof v === 'number') v = Number.isFinite(v) ? String(v) : '';
  if (typeof v !== 'string') return '';
  // حذف نویسه‌های کنترلی (به‌جز خط جدید و تب)
  return v.slice(0, max * 4 + 64).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

// عدد با رقم فارسی یا لاتین و با جداکنندهٔ هزارگان (1,500 ، ۱٬۵۰۰ ، 1 500). null یعنی «عدد نیست».
function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = toLatinDigits(v).replace(/[\s,٬،'’_]/g, '').replace(/٫/g, '.').replace(/[%٪]$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

function int(v, min = 0, max = Number.MAX_SAFE_INTEGER, dflt = 0) {
  const n = parseNumber(v);
  if (n === null) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function toLatinDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function slugify(s) {
  return toLatinDigits(String(s || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function isColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function isoOrNull(v) {
  if (!v || (typeof v !== 'string' && typeof v !== 'number')) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const nfFa = new Intl.NumberFormat('fa-AF');
function num(n) {
  return nfFa.format(Number(n) || 0);
}

function faDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

const dfDate = new Intl.DateTimeFormat('fa-AF-u-ca-persian', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric' });
const dfShort = new Intl.DateTimeFormat('fa-AF-u-ca-persian', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function faDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dfDate.format(d);
}
function faDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dfShort.format(d);
}

// کلید روز به وقت کابل (برای آمار روزانه)
const dfKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(d = new Date()) {
  return dfKey.format(d);
}

function bytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${num(n)} بایت`;
  const units = ['کیلوبایت', 'مگابایت', 'گیگابایت'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${nfFa.format(Math.round(n * 10) / 10)} ${units[i]}`;
}

// مقایسهٔ نسخه‌ها: 1.10.0 > 1.9.2 ؛ نسخهٔ نهایی > beta
function cmpVersion(a, b) {
  const pa = String(a || '').match(/\d+|[a-zA-Z]+/g) || [];
  const pb = String(b || '').match(/\d+|[a-zA-Z]+/g) || [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return /^\d+$/.test(y) ? (Number(y) === 0 ? 0 : -1) : 1;
    if (y === undefined) return /^\d+$/.test(x) ? (Number(x) === 0 ? 0 : 1) : -1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1; }
    else if (nx !== ny) return nx ? 1 : -1;
    else if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// نشانی برای محدودیت نرخ: IPv6 با ۶۴ بیت اول (یک مشترک، یک شبکهٔ /64)
function ipKey(ip) {
  ip = typeof ip === 'string' ? ip : '';
  if (!ip.includes(':')) return ip;
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const full = tail === undefined ? h : h.concat(new Array(Math.max(0, 8 - h.length - t.length)).fill('0'), t);
  return full.slice(0, 4).map((x) => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function safeEqual(a, b) {
  const ba = Buffer.from(typeof a === 'string' ? a : '');
  const bb = Buffer.from(typeof b === 'string' ? b : '');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  TZ, id, licenseCode, sha256, esc, jsonForHtml, str, int, bool, toLatinDigits, slugify, isColor,
  parseNumber, ipKey, isoOrNull, num, faDigits, faDate, faDateShort, dayKey, bytes, cmpVersion, safeEqual,
};
