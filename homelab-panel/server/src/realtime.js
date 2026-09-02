// ---------------------------------------------------------------------------
// اطلاعات لحظه‌ای با Socket.IO — نمودارها و لاگ‌ها بدون Refresh بروز می‌شوند
// ---------------------------------------------------------------------------
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { processEvents } from './sites/process.js';
import { getHistory, setViewers } from './metrics/index.js';
import { listSites } from './sites/registry.js';
import { getSiteSync } from './state.js';
import { userRole } from './auth.js';
import { audit } from './lib/audit.js';
import * as terminal from './system/terminal.js';

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
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const user = token ? verifyToken(String(token)) : null;
    if (!user) return next(new Error('unauthorized'));
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

    socket.on('term:open', (_payload, ack) => {
      if (!isAdmin()) return ack?.({ ok: false, error: 'forbidden' });
      const res = terminal.create({
        userId: socket.data.user?.id,
        username: socket.data.user?.username,
      });
      if (res.ok) socket.data.termId = res.id;
      ack?.(res);
    });

    socket.on('term:run', async (payload, ack) => {
      if (!isAdmin()) return ack?.({ ok: false, error: 'forbidden' });
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
      if (!isAdmin()) return ack?.({ ok: false, error: 'forbidden' });
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
