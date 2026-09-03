// ---------------------------------------------------------------------------
//  دکان — چند نفر روی یک دکان، با همگام‌سازیِ تغییرات
//
//  هر تغییر یک شمارهٔ ترتیبی (rev) می‌گیرد. هر دستگاه می‌گوید «از این شماره
//  به بعد چه خبر؟» و فقط همان‌ها را می‌گیرد. تغییرِ خودِ دستگاه دوباره به
//  خودش برنمی‌گردد، وگرنه بی‌نهایت رفت‌وبرگشت می‌شد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db } from '../db.js';
import { accountById } from './accounts.js';

const PAGE = 200;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const newId = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;

export function shopOf(accountId) {
  return db.prepare(`
    SELECT s.* FROM th_shops s
    JOIN th_shop_members m ON m.shop_id = s.shop_id
    WHERE m.account_id = ?
    LIMIT 1
  `).get(accountId) || null;
}

export function membersOf(shopId) {
  return db.prepare(`
    SELECT m.role, m.joined_at, a.account_id, a.name, a.email, a.phone, a.last_seen_at
    FROM th_shop_members m
    JOIN th_accounts a ON a.account_id = m.account_id
    WHERE m.shop_id = ?
    ORDER BY m.joined_at
  `).all(shopId).map((m) => ({
    userId: m.account_id,
    name: m.name || '',
    email: m.email || '',
    phone: m.phone || '',
    role: m.role,
    joinedAt: m.joined_at,
    lastSeenAt: m.last_seen_at,
  }));
}

export function createShop(accountId, { name, maxMembers = 5 }) {
  if (shopOf(accountId)) throw Object.assign(new Error('شما از قبل عضو یک دکان هستید'), { code: 'already_member' });
  const title = String(name || '').trim();
  if (!title) throw Object.assign(new Error('نام دکان لازم است'), { code: 'name_required' });

  const shopId = newId('shop');
  const now = Date.now();
  db.prepare(`
    INSERT INTO th_shops (shop_id, name, owner_id, max_members, rev, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(shopId, title, accountId, Math.max(1, Number(maxMembers) || 5), now);
  db.prepare(`
    INSERT INTO th_shop_members (shop_id, account_id, role, joined_at) VALUES (?, ?, 'owner', ?)
  `).run(shopId, accountId, now);

  return db.prepare('SELECT * FROM th_shops WHERE shop_id = ?').get(shopId);
}

/*
 *  نقش‌ها
 *
 *  owner   — صاحبِ دکان. یکی است و حذف نمی‌شود.
 *  manager — مدیر: همه‌کاره جز حذفِ دکان و جز ساختنِ مدیرِ دیگر.
 *  staff   — شاگرد: فروش و ثبت.
 *
 *  «owner» هیچ‌وقت با کدِ پیوستن داده نمی‌شود؛ وگرنه هر کسی که کد را داشت
 *  می‌توانست صاحبِ دومِ دکان شود.
 */
export const SHOP_ROLES = ['staff', 'manager'];

const canInvite = (role) => role === 'owner' || role === 'manager';

/** نقشی که خواسته شده، اگر بشناسیمش؛ وگرنه شاگرد */
function cleanRole(value) {
  const r = String(value ?? '').trim().toLowerCase();
  if (r === 'manager' || r === 'admin' || r === 'مدیر') return 'manager';
  return 'staff';
}

/** عددِ غیرمنفی از هر چیزی که آمده — خالی و بی‌معنی یعنی پیش‌فرض */
function count(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** نقشِ این حساب در دکانش */
export function roleOf(accountId) {
  const shop = shopOf(accountId);
  if (!shop) return null;
  const row = db.prepare('SELECT role FROM th_shop_members WHERE shop_id = ? AND account_id = ?')
    .get(shop.shop_id, accountId);
  return row?.role || null;
}

/**
 * ساختِ کدِ پیوستن.
 *
 * ⚠️ نامِ فیلدها آزاد گرفته می‌شود (uses/maxUses/count و days/expiresDays/ttlDays)
 * چون نسخه‌های مختلفِ برنامه نام‌های مختلفی می‌فرستند و کدی که به‌خاطرِ نامِ
 * فیلد ساخته نشود، برای کاربر یعنی «این قابلیت روی سرور نیست».
 *
 * uses = 0 یعنی بی‌شمار، days = 0 یعنی همیشه.
 */
export function createInvite(accountId, options = {}) {
  // نسخهٔ قدیمی رشته می‌فرستاد: createInvite(id, 'staff')
  const opts = typeof options === 'string' ? { role: options } : (options || {});

  const shop = shopOf(accountId);
  if (!shop) throw Object.assign(new Error('اول دکان بسازید'), { code: 'no_shop' });

  const mine = roleOf(accountId);
  if (!canInvite(mine)) {
    throw Object.assign(new Error('فقط صاحب دکان یا مدیر می‌تواند کد بسازد'), { code: 'not_allowed' });
  }

  const role = cleanRole(opts.role);
  // مدیر، مدیرِ دیگری نمی‌سازد — وگرنه یک شاگردِ ارتقایافته می‌توانست
  // بی‌نهایت مدیر بسازد و دکان از دستِ صاحبش در برود.
  if (role === 'manager' && mine !== 'owner') {
    throw Object.assign(new Error('فقط صاحب دکان می‌تواند مدیر اضافه کند'), { code: 'owner_only' });
  }

  const uses = count(opts.uses ?? opts.maxUses ?? opts.max_uses ?? opts.count, 1);
  const days = count(opts.days ?? opts.expiresDays ?? opts.ttlDays ?? opts.validDays, 7);

  const now = Date.now();
  const expiresAt = days > 0 ? now + days * 24 * 60 * 60 * 1000 : 0;   // ۰ = بی‌پایان

  // برخوردِ کد عملاً غیرممکن است، ولی UNIQUE است و یک برخورد یعنی خطای
  // نامفهوم برای کاربر. چند بار امتحان می‌کنیم.
  let code = null;
  for (let attempt = 0; attempt < 8 && !code; attempt++) {
    const candidate = crypto.randomBytes(4).toString('hex').toUpperCase();
    const taken = db.prepare('SELECT 1 FROM th_shop_invites WHERE code = ?').get(candidate);
    if (!taken) code = candidate;
  }
  if (!code) throw Object.assign(new Error('کد ساخته نشد، دوباره بزنید'), { code: 'code_clash' });

  db.prepare(`
    INSERT INTO th_shop_invites
      (shop_id, code, role, created_at, expires_at, max_uses, used_count, revoked, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
  `).run(shop.shop_id, code, role, now, expiresAt, uses, accountId);

  return { code, role, uses, days, expiresAt: expiresAt || null, createdAt: now };
}

/** یک کد، به شکلی که برنامه نشان می‌دهد */
function inviteRow(row) {
  const now = Date.now();
  const expired = row.expires_at > 0 && row.expires_at < now;
  const spent = row.max_uses > 0 && row.used_count >= row.max_uses;
  return {
    code: row.code,
    role: row.role,
    uses: row.max_uses,               // ۰ = بی‌شمار
    maxUses: row.max_uses,
    usedCount: row.used_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,  // ۰ = همیشه
    revoked: Boolean(row.revoked),
    active: !row.revoked && !expired && !spent,
  };
}

/** کدهای همین دکان */
export function listInvites(accountId) {
  const shop = shopOf(accountId);
  if (!shop) return [];
  if (!canInvite(roleOf(accountId))) return [];
  return db.prepare('SELECT * FROM th_shop_invites WHERE shop_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(shop.shop_id)
    .map(inviteRow);
}

/** باطل کردنِ یک کد — ردیف می‌ماند تا در سابقه پیدا باشد */
export function revokeInvite(accountId, code) {
  const shop = shopOf(accountId);
  if (!shop) throw Object.assign(new Error('دکانی ندارید'), { code: 'no_shop' });
  if (!canInvite(roleOf(accountId))) {
    throw Object.assign(new Error('فقط صاحب دکان یا مدیر می‌تواند کد را باطل کند'), { code: 'not_allowed' });
  }
  const clean = String(code || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM th_shop_invites WHERE shop_id = ? AND code = ?').get(shop.shop_id, clean);
  if (!row) throw Object.assign(new Error('این کد پیدا نشد'), { code: 'bad_invite' });
  db.prepare('UPDATE th_shop_invites SET revoked = 1 WHERE id = ?').run(row.id);
  return { ok: true, code: clean };
}

export function joinShop(accountId, code) {
  if (shopOf(accountId)) throw Object.assign(new Error('شما از قبل عضو یک دکان هستید'), { code: 'already_member' });
  const invite = db.prepare('SELECT * FROM th_shop_invites WHERE code = ?').get(String(code || '').trim().toUpperCase());
  if (!invite) throw Object.assign(new Error('کد دعوت درست نیست'), { code: 'bad_invite' });
  if (invite.revoked) throw Object.assign(new Error('این کد باطل شده'), { code: 'invite_revoked' });

  /*
   *  ⚠️ سقفِ استفاده، نه «یک‌بار مصرف».
   *
   *  کدهای قدیمی فقط used_by داشتند و همان اولین نفر کد را می‌سوزاند. حالا
   *  max_uses تصمیم می‌گیرد و ۰ یعنی بی‌شمار. برای ردیف‌های قدیمی که
   *  used_by دارند ولی used_count صفر است، همان used_by شمرده می‌شود —
   *  وگرنه کدی که قبلاً مصرف شده بود دوباره زنده می‌شد.
   */
  const maxUses = Number(invite.max_uses ?? 1);
  const used = Number(invite.used_count ?? 0) || (invite.used_by ? 1 : 0);
  if (maxUses > 0 && used >= maxUses) {
    throw Object.assign(new Error('این کد قبلاً استفاده شده'), { code: 'invite_used' });
  }
  // expires_at صفر یعنی بی‌پایان
  if (invite.expires_at > 0 && invite.expires_at < Date.now()) {
    throw Object.assign(new Error('کد دعوت منقضی شده'), { code: 'invite_expired' });
  }

  const shop = db.prepare('SELECT * FROM th_shops WHERE shop_id = ?').get(invite.shop_id);
  const members = db.prepare('SELECT COUNT(*) AS n FROM th_shop_members WHERE shop_id = ?').get(shop.shop_id).n;
  if (members >= shop.max_members) throw Object.assign(new Error('ظرفیت دکان پر است'), { code: 'shop_full' });

  const now = Date.now();
  db.prepare('INSERT INTO th_shop_members (shop_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(shop.shop_id, accountId, invite.role, now);
  db.prepare('UPDATE th_shop_invites SET used_count = ?, used_by = COALESCE(used_by, ?) WHERE id = ?')
    .run(used + 1, accountId, invite.id);
  return shop;
}

export function removeMember(accountId, targetId) {
  const shop = shopOf(accountId);
  if (!shop) throw Object.assign(new Error('دکانی ندارید'), { code: 'no_shop' });
  const mine = roleOf(accountId);
  if (!canInvite(mine)) throw Object.assign(new Error('فقط صاحب دکان یا مدیر می‌تواند حذف کند'), { code: 'not_allowed' });
  if (targetId === shop.owner_id) throw Object.assign(new Error('صاحب دکان حذف نمی‌شود'), { code: 'cannot_remove_owner' });
  // مدیر، مدیرِ دیگر را برنمی‌دارد — فقط صاحبِ دکان
  const target = db.prepare('SELECT role FROM th_shop_members WHERE shop_id = ? AND account_id = ?')
    .get(shop.shop_id, targetId);
  if (target?.role === 'manager' && mine !== 'owner') {
    throw Object.assign(new Error('فقط صاحب دکان می‌تواند مدیر را بردارد'), { code: 'owner_only' });
  }
  db.prepare('DELETE FROM th_shop_members WHERE shop_id = ? AND account_id = ?').run(shop.shop_id, targetId);
  return { ok: true };
}

/** شکلِ /api/v1/shop/me */
/**
 * چیزهایی که این سرور بلد است.
 *
 * ⚠️ برنامه وقتی مسیری را پیدا نکند می‌گوید «این قابلیت روی سرورِ شما نیست».
 * این فهرست به آن اجازه می‌دهد پیش از زدنِ دکمه بفهمد چه چیزی هست — و اگر
 * سرور قدیمی بود، همان پیام را درست نشان دهد به‌جای خطای ۴۰۴ وسطِ کار.
 */
export const SHOP_FEATURES = [
  'shop',            // دکان و اعضا
  'invites',         // کدِ پیوستن
  'invite_roles',    // نقشِ شاگرد/مدیر روی کد
  'invite_uses',     // چند بار قابل استفاده (۰ = بی‌شمار)
  'invite_days',     // تا چند روز معتبر (۰ = همیشه)
  'invite_list',     // فهرستِ کدها
  'invite_revoke',   // باطل کردنِ کد
  'sync',            // همگام‌سازیِ تغییرات
];

export function shopInfo(accountId) {
  const shop = shopOf(accountId);
  // حتی وقتی دکانی نیست، فهرستِ قابلیت‌ها باید برگردد — برنامه با همین
  // تصمیم می‌گیرد صفحهٔ کارمندان را نشان بدهد یا نه.
  if (!shop) return { shop: null, members: [], invites: [], features: SHOP_FEATURES, roles: SHOP_ROLES };

  const mine = roleOf(accountId);
  return {
    shop: {
      id: shop.shop_id,
      name: shop.name,
      ownerId: shop.owner_id,
      maxMembers: shop.max_members,
      rev: shop.rev,
      isOwner: shop.owner_id === accountId,
      myRole: mine,
      canInvite: canInvite(mine),
    },
    members: membersOf(shop.shop_id),
    invites: listInvites(accountId),
    features: SHOP_FEATURES,
    roles: SHOP_ROLES,
  };
}

export function pushChanges(accountId, { deviceId, changes, settings }) {
  const shop = shopOf(accountId);
  if (!shop) throw Object.assign(new Error('اول دکان بسازید یا به یکی بپیوندید'), { code: 'no_shop' });

  const list = Array.isArray(changes) ? changes : [];
  const now = Date.now();
  let rev = shop.rev;

  const insert = db.prepare(`
    INSERT INTO th_shop_changes (shop_id, rev, device_id, account_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const change of list) {
    rev += 1;
    insert.run(shop.shop_id, rev, String(deviceId || ''), accountId, JSON.stringify(change), now);
  }

  if (settings !== undefined && settings !== null) {
    db.prepare('UPDATE th_shops SET settings = ? WHERE shop_id = ?')
      .run(JSON.stringify(settings), shop.shop_id);
  }
  if (rev !== shop.rev) {
    db.prepare('UPDATE th_shops SET rev = ? WHERE shop_id = ?').run(rev, shop.shop_id);
  }

  db.prepare('UPDATE th_accounts SET last_seen_at = ? WHERE account_id = ?').run(now, accountId);
  return { rev, accepted: list.length };
}

export function pullChanges(accountId, { since = 0, deviceId = null } = {}) {
  const shop = shopOf(accountId);
  if (!shop) throw Object.assign(new Error('اول دکان بسازید یا به یکی بپیوندید'), { code: 'no_shop' });

  const from = Number(since) || 0;
  const rows = db.prepare(`
    SELECT * FROM th_shop_changes
    WHERE shop_id = ? AND rev > ?
    ORDER BY rev
    LIMIT ?
  `).all(shop.shop_id, from, PAGE + 1);

  const page = rows.slice(0, PAGE);
  const hasMore = rows.length > PAGE;
  // تغییرِ خودِ همین دستگاه دوباره برنمی‌گردد
  const mine = String(deviceId || '');
  const changes = page
    .filter((r) => !mine || r.device_id !== mine)
    .map((r) => {
      try { return JSON.parse(r.payload); } catch { return null; }
    })
    .filter(Boolean);

  let settings = null;
  if (shop.settings) {
    try { settings = JSON.parse(shop.settings); } catch { settings = null; }
  }

  return {
    changes,
    settings,
    rev: page.length ? page[page.length - 1].rev : from,
    hasMore,
  };
}
