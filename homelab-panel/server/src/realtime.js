// ---------------------------------------------------------------------------
// اطلاعات لحظه‌ای با Socket.IO — نمودارها و لاگ‌ها بدون Refresh بروز می‌شوند
// ---------------------------------------------------------------------------
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { processEvents } from './sites/process.js';
import { getHistory, setViewers } from './metrics/index.js';
import { listSites } from './sites/registry.js';
import { getSiteSync } from './state.js';
import { userRole, liveSessionUser, freshUntil } from './auth.js';
import { audit } from './lib/audit.js';
import * as terminal from './system/terminal.js';
import { shellAllowed, OWNER_ONLY_MESSAGE } from './lib/shell-owner.js';

// تبی که پشت پنجره رفته «بیننده» حساب نمی‌شود؛ سرور برای آن کاری انجام نمی‌دهد
function countViewers(io) {
  let n = 0;
  for (const socket of io.of('/').sockets.values()) {
    if (socket.data.active !== false) n++;
  }
  setViewers(n);
}

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    serveClient: false,
  });

  io.use((socket, next) => {
    //  ⛔ فقط از `auth` ِ دست‌دادن، نه `?token=` ِ نشانی (۶-۶): نشانیِ
    //  وب‌سوکت در لاگِ پراکسی می‌نشیند. رابطِ وب از روزِ اول `auth` می‌فرستد.
    const token = socket.handshake.auth?.token;
    const user = token ? verifyToken(String(token)) : null;
    if (!user || user.mustChangePassword) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    socket.data.active = true;
    countViewers(io);
    socket.emit('history', getHistory());

    // مرورگر وقتی تب را پنهان می‌کند خبر می‌دهد تا سرور بی‌جهت کار نکند
    socket.on('viewer', (active) => {
      socket.data.active = active !== false;
      countViewers(io);
    });

    socket.on('disconnect', () => countViewers(io));

    socket.on('watch:site', (slug) => {
      if (typeof slug !== 'string') return;
      for (const room of socket.rooms) {
        if (room.startsWith('site:')) socket.leave(room);
      }
      socket.join(`site:${slug}`);
    });

    socket.on('unwatch:site', (slug) => {
      if (typeof slug === 'string') socket.leave(`site:${slug}`);
    });

    /* ------------------------------ ترمینال ------------------------------
     *
     *  اجرای فرمانِ دلخواه فقط برای admin. نقش از دیتابیس خوانده می‌شود، نه
     *  از توکن: اگر نقشِ کسی همین حالا پایین آورده شده باشد، نشستِ بازِ او
     *  هم باید فوراً بی‌اثر شود — نه بعد از انقضای توکن.
     */
    const isAdmin = () => userRole(socket.data.user?.id) === 'admin';
    /*
     *  ⛔ (۱.۵۰.۷۱) نشستِ همین اتصال هنوز زنده است؟ — نقش از دیتابیس خوانده می‌شد ولی نشست نه:
     *  پس از «خروج از همه»، بستنِ حساب یا `vill3n owner-reset` وب‌سوکتِ بازِ نشستِ باطل‌شده هنوز
     *  فرمان اجرا می‌کرد. نشستِ مرده ⇒ ترمینال بسته و اتصال قطع.
     */
    const alive = () => {
      if (liveSessionUser(socket.data.user)) return true;
      if (socket.data.termId) terminal.close(socket.data.termId);
      socket.data.termId = null;
      setImmediate(() => socket.disconnect(true));
      return false;
    };

    socket.on('term:open', (_payload, ack) => {
      if (!alive()) return ack?.({ ok: false, error: 'unauthorized' });
      if (!isAdmin()) return ack?.({ ok: false, error: 'forbidden' });
      //  ⛔ S19 (۱.۵۰.۸۶، همیشه): پوسته فقط مالک یا کلیدِ محلی (lib/shell-owner.js)
      if (!shellAllowed(socket.data.user)) {
        audit({ user: socket.data.user, ip: socket.handshake.address }, 'panel.shell.owner_only', { target: 'terminal', ok: false });
        return ack?.({ ok: false, error: 'owner_only', message: OWNER_ONLY_MESSAGE });
      }
      //  ⛔ ترمینال = اجرای هر فرمانی روی این کامپیوتر ⇒ همان احرازِ دوبارهٔ کارِ حساس (۶-۵):
      //  نشستِ دزدیده‌شده یا مرورگرِ بازِ رهاشده بی رمزِ ده دقیقهٔ اخیر پوسته نمی‌گیرد.
      if (!(freshUntil(socket.data.user?.sessionId) > Date.now())) return ack?.({ ok: false, error: 'reauth_required' });
      const res = terminal.create({
        userId: socket.data.user?.id,
        username: socket.data.user?.username,
      });
      if (res.ok) socket.data.termId = res.id;
      ack?.(res);
    });

    socket.on('term:run', async (payload, ack) => {
      if (!alive()) return ack?.({ ok: false, error: 'unauthorized' });
      if (!isAdmin()) return ack?.({ ok: false, error: 'forbidden' });
      if (!shellAllowed(socket.data.user)) return ack?.({ ok: false, error: 'owner_only', message: OWNER_ONLY_MESSAGE });
      const id = socket.data.termId;
      const command = String(payload?.command ?? '');
      if (!id) return ack?.({ ok: false, error: 'no_session' });

      // هر فرمان ثبت می‌شود — این تنها ردی است که بعداً می‌شود دنبالش کرد
      audit(
        { user: socket.data.user, ip: socket.handshake.address },
        'terminal.run',
        { target: command.slice(0, 400) }
      );

      const result = await terminal.run(id, command, {
        onData: (chunk) => socket.emit('term:data', { chunk }),
      });
      ack?.(result);
    });

    socket.on('term:interrupt', (_payload, ack) => {
      if (!alive()) return ack?.({ ok: false, error: 'unauthorized' });
      if (!isAdmin()) return ack?.({ ok: false, error: 'forbidden' });
      if (!shellAllowed(socket.data.user)) return ack?.({ ok: false, error: 'owner_only', message: OWNER_ONLY_MESSAGE });
      ack?.(terminal.interrupt(socket.data.termId));
    });

    socket.on('term:close', (_payload, ack) => {
      if (socket.data.termId) terminal.close(socket.data.termId);
      socket.data.termId = null;
      ack?.({ ok: true });
    });

    // قطعِ اتصال یعنی نشستِ پوسته هم باید برود؛ وگرنه تا مهلتِ بی‌کاری
    // یک پوستهٔ بی‌صاحب روی سرور می‌ماند
    socket.on('disconnect', () => {
      if (socket.data.termId) terminal.close(socket.data.termId);
    });
  });

  // لاگ زندهٔ هر سایت فقط به کسانی که همان سایت را باز کرده‌اند
  processEvents.on('log', (entry) => {
    io.to(`site:${entry.slug}`).emit('site:log', entry);
  });

  processEvents.on('status', async (entry) => {
    io.emit('site:status', entry);
  });

  /*
   *  ⛔ (۱.۵۰.۷۱) بازبینیِ دوره‌ایِ همهٔ اتصال‌ها: نشستی که دیگر نیست (خروج از همه، بستن یا تغییرِ
   *  نقش، `vill3n owner-reset`، انقضا) نه نمودار و لاگِ زنده می‌گیرد، نه ترمینالِ بازش می‌ماند —
   *  حتی اگر خودش هیچ پیامی نفرستد. هر بار یک SELECT ِ کوچک برای هر اتصال (پنلِ خانگی، چند تب).
   */
  const revalidateMs = Math.max(200, Number(process.env.HLP_WS_REVALIDATE_MS) || 15_000);
  const sweep = setInterval(() => {
    for (const socket of io.of('/').sockets.values()) {
      try {
        if (liveSessionUser(socket.data.user)) continue;
      } catch {
        continue; //  دیتابیس لحظه‌ای قفل بود — دورِ بعد
      }
      if (socket.data.termId) terminal.close(socket.data.termId);
      socket.data.termId = null;
      socket.disconnect(true);
    }
  }, revalidateMs);
  sweep.unref?.();
  httpServer.on('close', () => clearInterval(sweep));

  return io;
}

// در هر چرخهٔ جمع‌آوری معیارها فراخوانی می‌شود
export async function broadcastMetrics(io, snapshot) {
  if (!io) return;
  io.emit('metrics', snapshot);

  // خلاصهٔ سایت‌ها گران‌تر است (تست پورت هر سایت)، پس خیلی کم‌تر فرستاده می‌شود
  broadcastMetrics.lastSites = broadcastMetrics.lastSites || 0;
  if (Date.now() - broadcastMetrics.lastSites > 20000) {
    broadcastMetrics.lastSites = Date.now();
    try {
      const sites = await listSites({ withSize: false });
      const sync = getSiteSync();
      io.emit('sites', {
        sites,
        siteSync: sync ? sync.snapshot() : null,
      });
    } catch { /* یک چرخهٔ ناموفق مهم نیست */ }
  }
}
