// ---------------------------------------------------------------------------
//  نصبِ Ollama از خودِ پنل — «من به ترمینال نروم»
//
//  ویندوز: فایلِ نصبِ رسمی دانلود و بی‌صدا اجرا می‌شود (Inno Setup:
//  /VERYSILENT). لینوکس: اسکریپتِ رسمی. مک: فقط لینک، چون نصبِ بی‌صدا ندارد.
//  پیشرفت با رویدادِ سوکت به پنل می‌رود؛ همه‌چیز در یک کار (job) در حافظه.
//
//  ⛔ هیچ ورودیِ کاربر یا مدل داخلِ دستورها نمی‌رود — نشانی و آرگومان‌ها ثابت‌اند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { getIo } from '../state.js';
import { logEvent } from '../db.js';
import * as ollama from './ollama.js';

const WIN_URL = 'https://ollama.com/download/OllamaSetup.exe';
const LINUX_SCRIPT = 'https://ollama.com/install.sh';

const job = { status: 'idle', step: '', percent: null, error: null, startedAt: null, finishedAt: null };
const emit = () => getIo()?.emit('agent:install', { ...job });

export const installStatus = () => ({ ...job, platform: process.platform, downloadUrl: process.platform === 'win32' ? WIN_URL : 'https://ollama.com/download' });

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`دانلود نشد (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    onProgress?.(total ? Math.round((got / total) * 100) : null);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  return dest;
}

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { windowsHide: true, ...opts });
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ ok: false, out: e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}

async function waitFor(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ollama.available({ force: true })) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** شروعِ نصب — یکی در یک زمان */
export async function installOllama() {
  if (job.status === 'running') return installStatus();
  if (await ollama.available({ force: true })) { Object.assign(job, { status: 'done', step: 'از قبل نصب و روشن است', percent: 100, error: null }); return installStatus(); }
  Object.assign(job, { status: 'running', step: 'شروع', percent: 0, error: null, startedAt: Date.now(), finishedAt: null });
  emit();
  (async () => {
    try {
      if (process.platform === 'win32') {
        const dest = path.join(os.tmpdir(), 'OllamaSetup.exe');
        job.step = 'دانلودِ فایلِ نصب';
        emit();
        await download(WIN_URL, dest, (p) => { job.percent = p; emit(); });
        job.step = 'نصبِ بی‌صدا';
        job.percent = null;
        emit();
        const r = await runProcess(dest, ['/VERYSILENT', '/NORESTART', '/SP-']);
        if (!r.ok) throw new Error(`نصب‌کننده خطا داد: ${r.out.slice(0, 200)}`);
        job.step = 'منتظرِ بالا آمدنِ Ollama';
        emit();
        if (!(await waitFor(90_000))) {
          // نصب شده ولی سرویس بالا نیامده — یک بار خودمان صدایش بزنیم
          const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
          if (fs.existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
          if (!(await waitFor(60_000))) throw new Error('Ollama نصب شد ولی روی پورتِ ۱۱۴۳۴ جواب نمی‌دهد — یک بار کامپیوتر را دوباره راه بیندازید');
        }
      } else if (process.platform === 'linux') {
        job.step = 'اجرای اسکریپتِ رسمیِ نصب (به sudo نیاز دارد)';
        emit();
        const r = await runProcess('sh', ['-c', `curl -fsSL ${LINUX_SCRIPT} | sh`]);
        if (!r.ok) throw new Error(`اسکریپتِ نصب خطا داد: ${r.out.slice(-300)}`);
        job.step = 'منتظرِ بالا آمدنِ Ollama';
        emit();
        if (!(await waitFor(60_000))) {
          spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
          if (!(await waitFor(30_000))) throw new Error('Ollama نصب شد ولی سرویسش بالا نیامد');
        }
      } else {
        throw new Error('روی این سیستم نصبِ خودکار نیست — از https://ollama.com/download نصب کنید');
      }
      Object.assign(job, { status: 'done', step: 'نصب شد', percent: 100, finishedAt: Date.now() });
      logEvent('info', 'agent', 'Ollama از خودِ پنل نصب شد');
    } catch (e) {
      Object.assign(job, { status: 'failed', error: e.message, finishedAt: Date.now() });
      logEvent('warn', 'agent', `نصبِ Ollama نشد: ${e.message}`);
    }
    emit();
  })();
  return installStatus();
}
