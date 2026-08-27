// ---------------------------------------------------------------------------
//  ترمینال در پنجرهٔ خودش — همان خروجیِ زندهٔ سرور، تمامِ صفحه
//
//  همان جریانِ log و status ای را می‌گیرد که پوستهٔ اصلی می‌گیرد؛ پروسهٔ اصلی
//  برای هر دو پنجره می‌فرستد.
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const el = {
  dot: $('dot'),
  statusText: $('statusText'),
  termBody: $('termBody'),
  follow: $('follow'),
};

const LABEL = {
  stopped: 'متوقف',
  starting: 'در حال بالا آمدن…',
  running: 'آماده',
  error: 'مشکل',
};

function clock(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function appendLine(entry) {
  const empty = el.termBody.querySelector('.empty');
  if (empty) empty.remove();

  const line = document.createElement('div');
  line.className = `line${entry.stream === 'err' ? ' err' : ''}`;

  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = clock(entry.at);
  line.appendChild(ts);
  line.appendChild(document.createTextNode(entry.text));

  el.termBody.appendChild(line);

  while (el.termBody.childElementCount > 3000) el.termBody.firstElementChild.remove();
  if (el.follow.checked) el.termBody.scrollTop = el.termBody.scrollHeight;
}

function setEmpty() {
  el.termBody.innerHTML = '<div class="empty">هنوز چیزی نوشته نشده.</div>';
}

function applyStatus(s) {
  el.dot.className = `dot ${s.status}`;
  el.statusText.textContent =
    s.status === 'running' ? `${LABEL.running} · ${s.url}` : s.error ? `${LABEL[s.status]} — ${s.error}` : LABEL[s.status];
}

/* ------------------------------ دکمه‌ها --------------------------------- */

$('btnBack').addEventListener('click', () => window.cc.dockTerminal());
$('btnFull').addEventListener('click', toggleFull);

async function toggleFull() {
  const res = await window.cc.toggleFullScreen();
  $('btnFull').textContent = res?.full ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFull();
  }
  if (e.key === 'Escape') window.cc.dockTerminal();
});

$('btnClear').addEventListener('click', async () => {
  await window.cc.clearLogs();
  setEmpty();
});

$('btnCopy').addEventListener('click', async () => {
  const text = [...el.termBody.querySelectorAll('.line')].map((l) => l.textContent).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    const b = $('btnCopy');
    b.textContent = 'کپی شد';
    setTimeout(() => (b.textContent = 'کپی'), 1400);
  } catch { /* بی‌خیال */ }
});

/* ------------------------------- شروع ----------------------------------- */

(async () => {
  setEmpty();
  window.cc.onLog(appendLine);
  window.cc.onStatus(applyStatus);
  for (const entry of await window.cc.getLogs()) appendLine(entry);
  applyStatus(await window.cc.getState());
})();
