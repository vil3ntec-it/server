// ---------------------------------------------------------------------------
//  ضربانِ وب‌سوکت — تا اتصال‌های مُرده روی سرور نمانند
//
//  وقتی گوشی از آنتن می‌افتد یا لپ‌تاپ می‌خوابد، TCP بی‌صدا قطع می‌شود و سرور
//  خبردار نمی‌شود: اتصال «باز» می‌ماند، حافظه می‌گیرد، و در شمارِ «آنلاین»
//  می‌آید. این‌جا هر چند ثانیه ping فرستاده می‌شود؛ هر که pong نداد، بسته
//  می‌شود.
//
//  عمداً به رویدادِ connection وابسته نیست: این سرورها با handleUpgrade و
//  callback کار می‌کنند و در آن حالت ws رویدادِ connection را نمی‌فرستد.
// ---------------------------------------------------------------------------
const DEFAULT_MS = Number(process.env.HLP_WS_PING_MS) > 0 ? Number(process.env.HLP_WS_PING_MS) : 30000;

export function attachHeartbeat(wss, { intervalMs = DEFAULT_MS } = {}) {
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      // بارِ اول که این اتصال را می‌بینیم، برایش گوشِ pong می‌گذاریم
      if (ws.hlpAlive === undefined) {
        ws.hlpAlive = true;
        ws.on('pong', () => {
          ws.hlpAlive = true;
        });
      }

      if (ws.hlpAlive === false) {
        try {
          ws.terminate();
        } catch { /* از قبل بسته شده */ }
        continue;
      }

      ws.hlpAlive = false;
      try {
        ws.ping();
      } catch {
        try {
          ws.terminate();
        } catch { /* بسته شده */ }
      }
    }
  }, intervalMs);

  timer.unref?.();
  wss.on('close', () => clearInterval(timer));
  return () => clearInterval(timer);
}
