// ---------------------------------------------------------------------------
//  پوستهٔ برنامه — وضعیت، ترمینال و صفحهٔ بارِ اول
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const el = {
  dot: $('dot'),
  statusText: $('statusText'),
  setup: $('setup'),
  stage: $('stage'),
  dataPath: $('dataPath'),
  tree: $('tree'),
  setupError: $('setupError'),
  view: $('view'),
  placeholder: $('placeholder'),
  placeholderText: $('placeholderText'),
  placeholderHint: $('placeholderHint'),
  term: $('term'),
  termBody: $('termBody'),
  follow: $('follow'),
};

let loadedUrl = null;

/* ------------------------------- ترمینال -------------------------------- */

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

  // سقفِ سطرها تا حافظه پر نشود
  while (el.termBody.childElementCount > 3000) el.termBody.firstElementChild.remove();
  if (el.follow.checked) el.termBody.scrollTop = el.termBody.scrollHeight;
}

function setEmptyTerminal() {
  el.termBody.innerHTML = '<div class="empty">هنوز چیزی نوشته نشده.</div>';
}

/* -------------------------------- وضعیت --------------------------------- */

const LABEL = {
  stopped: 'متوقف',
  starting: 'در حال بالا آمدن…',
  running: 'آماده',
  error: 'مشکل',
};

function applyStatus(s) {
  el.dot.className = `dot ${s.status}`;
  el.statusText.textContent =
    s.status === 'running' ? `${LABEL.running} · ${s.url}` : s.error ? `${LABEL[s.status]} — ${s.error}` : LABEL[s.status];

  if (s.status === 'running' && s.url && loadedUrl !== s.url) {
    loadedUrl = s.url;
    el.view.src = s.url;
    el.view.hidden = false;
    el.placeholder.hidden = true;
  }

  if (s.status === 'error') {
    el.view.hidden = true;
    el.placeholder.hidden = false;
    el.placeholder.querySelector('.spinner')?.remove();
    el.placeholderText.textContent = s.error || 'سرور بالا نیامد.';
    el.placeholderHint.textContent = 'ترمینالِ پایین می‌گوید دقیقاً چه شد.';
    loadedUrl = null;
  }
}

/* ------------------------------ بارِ اول -------------------------------- */

function drawTree(dir) {
  const clean = (dir || '').replace(/[\\/]+$/, '');
  el.tree.textContent = [
    `${clean || '…'}\\`,
    '├── panel.db          دیتابیس پنل',
    '├── Projects\\         پوشهٔ هر پروژه',
    '│   └── <نام پروژه>\\',
    '│       ├── app\\  config\\  data\\',
    '│       ├── backups\\    بکاپ‌ها',
    '│       ├── logs\\       لاگ‌ها',
    '│       └── releases\\   فایل‌های منتشرشده',
    '├── vault.key         کلید گاوصندوق — با اولین راز ساخته می‌شود',
    '└── updates\\          بستهٔ به‌روزرسانی‌ها',
  ].join('\n');
}

async function showSetup() {
  const suggested = await window.cc.defaultDataDir();
  el.dataPath.value = suggested;
  drawTree(suggested);
  el.setup.hidden = false;
  el.stage.hidden = true;
}

el.dataPath?.addEventListener('input', () => {
  drawTree(el.dataPath.value);
  el.setupError.hidden = true;
});

$('btnBrowse').addEventListener('click', async () => {
  const picked = await window.cc.chooseFolder(el.dataPath.value);
  if (picked) {
    el.dataPath.value = picked;
    drawTree(picked);
    el.setupError.hidden = true;
  }
});

function showSetupError(text) {
  el.setupError.textContent = text;
  el.setupError.hidden = false;
}

$('btnSaveSetup').addEventListener('click', async () => {
  const button = $('btnSaveSetup');
  button.disabled = true;
  button.textContent = 'در حال آماده‌سازی…';
  el.setupError.hidden = true;
  try {
    const res = await window.cc.saveSetup(el.dataPath.value);
    if (!res?.ok) {
      showSetupError(res?.error || 'این مسیر پذیرفته نشد.');
      return;
    }
    el.setup.hidden = true;
    el.stage.hidden = false;
  } catch (e) {
    // حتی اگر پروسهٔ اصلی خطا داد، کاربر نباید پشتِ دکمهٔ قفل‌شده بماند
    showSetupError(String(e?.message || e));
  } finally {
    button.disabled = false;
    button.textContent = 'شروع';
  }
});

/* ------------------------------ دکمه‌ها --------------------------------- */

$('btnTerminal').addEventListener('click', (e) => {
  el.term.classList.toggle('hidden');
  e.currentTarget.classList.toggle('on', !el.term.classList.contains('hidden'));
});
$('btnBrowser').addEventListener('click', () => window.cc.openInBrowser());
$('btnData').addEventListener('click', () => window.cc.openDataFolder());
$('btnRestart').addEventListener('click', () => window.cc.restart());
$('btnClear').addEventListener('click', async () => {
  await window.cc.clearLogs();
  setEmptyTerminal();
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
  $('btnTerminal').classList.add('on');
  setEmptyTerminal();

  window.cc.onLog(appendLine);
  window.cc.onStatus(applyStatus);

  for (const entry of await window.cc.getLogs()) appendLine(entry);

  if (await window.cc.setupNeeded()) {
    await showSetup();
  } else {
    el.stage.hidden = false;
  }

  applyStatus(await window.cc.getState());
})();
