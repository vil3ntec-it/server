'use strict';
/*
  نگهبانِ کوچک: سرورِ اصلی را به‌شکلِ پروسهٔ فرزند اجرا می‌کند.
  • فرزند با کدِ 75 بیرون آمد (یعنی «به‌روز شدم») ⇒ همان لحظه نسخهٔ تازه را بالا می‌آورد.
  • هر کدِ دیگر ⇒ نگهبان هم با همان کد بیرون می‌رود تا پنل یا سرویس بداند و خودش تصمیم بگیرد.
  • اگر خودِ نگهبان کشته شود، فرزند از قطع‌شدنِ کانالِ IPC می‌فهمد و خودش بسته می‌شود؛
    پس دیگر نسخهٔ جامانده‌ای که قفلِ داده را نگه دارد درست نمی‌شود.
*/
const { fork } = require('child_process');

const RESTART_CODE = 75;

function run(entry, args) {
  let child = null;
  let stopping = false;
  let restarts = 0;
  const childArgs = args.filter((a) => a !== '--open');

  const start = (first) => {
    child = fork(entry, first ? args : childArgs, { env: { ...process.env, VILL3N_CHILD: '1' }, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) return process.exit(code ?? 0);
      if (code === RESTART_CODE && restarts < 20) {
        restarts++;
        console.log('\n  نسخهٔ تازه نصب شد؛ سرور دوباره بالا می‌آید …\n');
        return setTimeout(() => start(false), 500);
      }
      process.exit(code ?? (signal ? 1 : 0));
    });
  };

  const stop = (sig) => {
    stopping = true;
    if (child) { try { child.kill(sig); } catch (_) { /* رفته */ } } else process.exit(0);
    setTimeout(() => process.exit(0), 6000).unref();
  };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => stop(s));
  start(true);
}

module.exports = { run, RESTART_CODE };
