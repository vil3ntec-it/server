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

export function createInvite(accountId, role = 'staff') {
  const shop = shopOf(accountId);
  if (!shop) throw Object.assign(new Error('اول دکان بسازید'), { code: 'no_shop' });
  if (shop.owner_id !== accountId) throw Object.assign(new Error('فقط صاحب دکان می‌تواند دعوت کند'), { code: 'not_owner' });

  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const now = Date.now();
  db.prepare(`
    INSERT INTO th_shop_invites (shop_id, code, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
  `).run(shop.shop_id, code, role === 'owner' ? 'staff' : role, now, now + INVITE_TTL_MS);
  return { code, expiresAt: now + INVITE_TTL_MS };
}

export function joinShop(accountId, code) {
  if (shopOf(accountId)) throw Object.assign(new Error('شما از قبل عضو یک دکان هستید'), { code: 'already_member' });
  const invite = db.prepare('SELECT * FROM th_shop_invites WHERE code = ?').get(String(code || '').trim().toUpperCase());
  if (!invite) throw Object.assign(new Error('کد دعوت درست نیست'), { code: 'bad_invite' });
  if (invite.used_by) throw Object.assign(new Error('این کد قبلاً استفاده شده'), { code: 'invite_used' });
  if (invite.expires_at < Date.now()) throw Object.assign(new Error('کد دعوت منقضی شده'), { code: 'invite_expired' });

  const shop = db.prepare('SELECT * FROM th_shops WHERE shop_id = ?').get(invite.shop_id);
  const count = db.prepare('SELECT COUNT(*) AS n FROM th_shop_members WHERE shop_id = ?').get(shop.shop_id).n;
  if (count >= shop.max_members) throw Object.assign(new Error('ظرفیت دکان پر است'), { code: 'shop_full' });

  const now = Date.now();
  db.prepare('INSERT INTO th_shop_members (shop_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(shop.shop_id, accountId, invite.role, now);
  db.prepare('UPDATE th_shop_invites SET used_by = ? WHERE id = ?').run(accountId, invite.id);
  return shop;
}

export function removeMember(accountId, targetId) {
  const shop = shopOf(accountId);
  if (!shop) throw Object.assign(new Error('دکانی ندارید'), { code: 'no_shop' });
  if (shop.owner_id !== accountId) throw Object.assign(new Error('فقط صاحب دکان می‌تواند حذف کند'), { code: 'not_owner' });
  if (targetId === shop.owner_id) throw Object.assign(new Error('صاحب دکان حذف نمی‌شود'), { code: 'cannot_remove_owner' });
  db.prepare('DELETE FROM th_shop_members WHERE shop_id = ? AND account_id = ?').run(shop.shop_id, targetId);
  return { ok: true };
}

/** شکلِ /api/v1/shop/me */
export function shopInfo(accountId) {
  const shop = shopOf(accountId);
  if (!shop) return { shop: null, members: [] };
  return {
    shop: {
      id: shop.shop_id,
      name: shop.name,
      ownerId: shop.owner_id,
      maxMembers: shop.max_members,
      rev: shop.rev,
      isOwner: shop.owner_id === accountId,
    },
    members: membersOf(shop.shop_id),
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
