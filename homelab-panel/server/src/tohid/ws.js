// ---------------------------------------------------------------------------
//  ورود با کدِ شش‌رقمی — روی WebSocket
//
//  قرارداد را خودِ برنامه تعیین کرده و ما همان را پیاده می‌کنیم: یک اتصال،
//  یک پیام، یک پاسخ، بعد بسته می‌شود.
//
//      { action:'send-code',   method, value, name }        → { ok:true }
//      { action:'verify-code', method, value, code, name }  → { ok:true, token, user:{name} }
//      هر خطا                                               → { ok:false, message }
//
//  رمزِ سرور پیش از ساختِ WebSocket سنجیده می‌شود و اتصال در همان سطحِ HTTP
//  رد می‌شود. اگر به‌جایش دست‌دادن را تمام می‌کردیم و بعد می‌بستیم، «آزمایش
//  اتصال»ِ برنامه اول رویدادِ open را می‌دید و اشتباهاً «متصل شد» می‌گفت.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { sendCode, verifyCode, pruneCodes } from './otp.js';
import { readTohidSettings } from './settings.js';
import { accountForContact, issueTokens } from './accounts.js';
import { noteActivity } from './presence.js';
import { logEvent } from '../db.js';

const MESSAGE_LIMIT = 4096;
const IDLE_MS = 15000;

/** مقایسهٔ رمز بدونِ نشت دادنِ زمان */
function sameToken(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function createTohidWs() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MESSAGE_LIMIT });

  wss.on('connection', (ws, req) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || null;

    // یک پیام و تمام؛ اتصالِ باز و بی‌کار بسته می‌شود
    const idle = setTimeout(() => {
      try { ws.close(1000, 'idle'); } catch { /* بسته شده */ }
    }, IDLE_MS);

    let answered = false;
    const reply = (payload) => {
      if (answered) return;
      answered = true;
      clearTimeout(idle);
      try {
        ws.send(JSON.stringify(payload));
        ws.close();
      } catch { /* رفته */ }
    };

    ws.on('message', async (raw) => {
      if (answered) return;
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return reply({ ok: false, message: 'درخواست نامعتبر بود.' });
      }

      const method = msg?.method === 'email' ? 'email' : 'phone';
      try {
        if (msg?.action === 'send-code') {
          await sendCode({ method, value: msg.value, name: msg.name });
          noteActivity({ kind: 'otp', ip });
          return reply({ ok: true });
        }

        if (msg?.action === 'verify-code') {
          const { contact, name } = verifyCode({ method, value: msg.value, code: msg.code });
          const account = accountForContact({ method, value: contact, name: msg.name || name });
          const tokens = issueTokens(account);
          noteActivity({ accountId: account.account_id, kind: 'otp', ip });
          logEvent('info', 'tohid', `ورود با کد: ${account.account_id}`);
          return reply({
            ok: true,
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: {
              id: account.account_id,
              name: account.name || '',
              email: account.email || '',
              phone: account.phone || '',
            },
          });
        }

        return reply({ ok: false, message: 'درخواست شناخته نشد.' });
      } catch (e) {
        // پیامِ فارسیِ ماژول‌ها مستقیم به کاربر نشان داده می‌شود
        return reply({ ok: false, message: e.message || 'خطای سرور.' });
      }
    });

    ws.on('close', () => clearTimeout(idle));
    ws.on('error', () => clearTimeout(idle));
  });

  /**
   * ارتقای اتصال. رمزِ سرور اینجا سنجیده می‌شود، پیش از اینکه اصلاً
   * WebSocket ای ساخته شود.
   */
  function handleUpgrade(req, socket, head) {
    const cfg = readTohidSettings();
    if (!cfg.enabled) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    let given = '';
    try {
      given = new URL(req.url, 'http://x').searchParams.get('token') || '';
    } catch { /* آدرسِ خراب */ }

    if (cfg.serverToken && !sameToken(given, cfg.serverToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    pruneCodes();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  return { wss, handleUpgrade };
}
