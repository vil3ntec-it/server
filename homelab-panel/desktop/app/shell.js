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
  termGrip: $('termGrip'),
  termAway: $('termAway'),
  termBody: $('termBody'),
  follow: $('follow'),
  btnTerminal: $('btnTerminal'),
  updated: $('updated'),
  updatedText: $('updatedText'),
};

let loadedUrl = null;
/** ترمینال در پنجرهٔ خودش باز است؟ */
let popped = false;

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
    el.placeholderHint.textContent = 'ترمینال می‌گوید دقیقاً چه شد.';
    // خرابی را نباید پشتِ ترمینالِ بسته قایم کرد
    if (!popped) setTerminalOpen(true);
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

/* -------------------- کادرِ ترمینال: باز، بسته، جدا --------------------- */

const MIN_TERM = 108;
const DEFAULT_TERM = 240;

/** بلندیِ ترمینال هیچ‌وقت نباید بیشتر از سهمِ معقولش از پنجره شود */
function clampHeight(px) {
  const max = Math.max(MIN_TERM, Math.round(window.innerHeight * 0.75));
  return Math.min(max, Math.max(MIN_TERM, Math.round(px)));
}

function applyHeight(px) {
  const h = clampHeight(px);
  el.term.style.setProperty('--term-height', `${h}px`);
  return h;
}

/**
 * باز و بستنِ ترمینال.
 *
 * از صفتِ hidden استفاده می‌شود، نه کلاس: قانونِ [hidden] در shell.css با
 * ‎!important‎ نوشته شده، پس بستن همیشه کار می‌کند و هیچ قانونِ دیگری
 * نمی‌تواند دوباره بازش کند.
 */
function setTerminalOpen(open, remember = true) {
  if (popped) open = false;
  el.term.hidden = !open;
  el.btnTerminal.classList.toggle('on', open && !popped);
  el.btnTerminal.setAttribute('aria-pressed', String(open && !popped));
  if (open) scrollTerminalToEnd();
  if (remember && !popped) window.cc.setUi({ terminalOpen: open }).catch(() => {});
}

function scrollTerminalToEnd() {
  if (el.follow.checked) el.termBody.scrollTop = el.termBody.scrollHeight;
}

/** ترمینال داخلِ برنامه است یا در پنجرهٔ خودش */
function applyTerminalPlace(place) {
  popped = Boolean(place?.popped);
  el.termAway.hidden = !popped;
  el.btnTerminal.textContent = popped ? 'ترمینال ⧉' : 'ترمینال';
  if (popped) {
    el.term.hidden = true;
    el.btnTerminal.classList.remove('on');
  } else {
    // پنجره که بسته شد، به همان حالتی برمی‌گردیم که کاربر قبلاً انتخاب کرده بود
    setTerminalOpen(wantedOpen, false);
  }
}

/** آخرین انتخابِ خودِ کاربر برای بازبودنِ ترمینالِ داخلِ برنامه */
let wantedOpen = false;

el.btnTerminal.addEventListener('click', () => {
  if (popped) {
    window.cc.focusMain();
    window.cc.popOutTerminal(); // پنجره‌اش را جلو می‌آورد
    return;
  }
  wantedOpen = el.term.hidden;
  setTerminalOpen(wantedOpen);
});

$('btnTermClose').addEventListener('click', () => {
  wantedOpen = false;
  setTerminalOpen(false);
});

$('btnPopout').addEventListener('click', () => window.cc.popOutTerminal());
$('btnTermFocus').addEventListener('click', () => window.cc.popOutTerminal());
$('btnTermBack').addEventListener('click', async () => {
  wantedOpen = true;
  await window.cc.dockTerminal();
});

/* --------- کشیدنِ دستگیره: بلندیِ ترمینال دستِ خودِ کاربر است ---------- */

let drag = null;

/*
 * حرکت و رها شدن روی خودِ پنجره دنبال می‌شود، نه روی دستگیره.
 *
 * قبلاً همه‌چیز به setPointerCapture بند بود و شنونده‌ها روی نوارِ هفت
 * پیکسلیِ دستگیره بودند: اگر گرفتنِ اشاره‌گر نمی‌گرفت یا ماوس تندتر از آن
 * بیرون می‌زد، حرکت‌ها دیگر نمی‌رسید و کشیدن بی‌صدا هیچ کاری نمی‌کرد.
 */
function onDragMove(e) {
  if (!drag) return;
  // دستگیره بالای ترمینال است: بالا کشیدن یعنی بلندتر
  applyHeight(drag.start + (drag.y - e.clientY));
  e.preventDefault();
}

function endDrag() {
  if (!drag) return;
  drag = null;
  document.body.classList.remove('resizing');
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);

  const h = Math.round(el.term.getBoundingClientRect().height);
  window.cc.setUi({ terminalHeight: h }).catch(() => {});
  scrollTerminalToEnd();
}

el.termGrip.addEventListener('pointerdown', (e) => {
  drag = { y: e.clientY, start: el.term.getBoundingClientRect().height };
  document.body.classList.add('resizing');
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  e.preventDefault();
});

// کوچک شدنِ پنجره نباید ترمینال را از حدش بزرگ‌تر بگذارد
window.addEventListener('resize', () => {
  applyHeight(el.term.getBoundingClientRect().height || DEFAULT_TERM);
});

/* ------------------------------ دکمه‌ها --------------------------------- */

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

/* ------------------------ به‌روزرسانی نشست ------------------------------ */

function showUpdated(applied) {
  if (!applied?.at) return;
  el.updatedText.textContent = applied.version
    ? `به‌روزرسانی به نسخهٔ ${applied.version} نصب شد — برای اعمال، برنامه باید دوباره باز شود.`
    : 'به‌روزرسانی نصب شد — برای اعمال، برنامه باید دوباره باز شود.';
  el.updated.hidden = false;
}

$('btnRelaunch').addEventListener('click', () => window.cc.relaunch());
$('btnUpdatedClose').addEventListener('click', () => {
  el.updated.hidden = true;
});

/* ------------------------------- شروع ----------------------------------- */

(async () => {
  setEmptyTerminal();

  const ui = await window.cc.getUi().catch(() => ({}));
  applyHeight(Number(ui?.terminalHeight) || DEFAULT_TERM);
  wantedOpen = ui?.terminalOpen === true;

  window.cc.onTerminalPlace(applyTerminalPlace);
  applyTerminalPlace(await window.cc.terminalPlace().catch(() => ({ popped: false })));

  window.cc.onLog(appendLine);
  window.cc.onStatus(applyStatus);
  window.cc.onUpdateApplied(showUpdated);

  for (const entry of await window.cc.getLogs()) appendLine(entry);

  if (await window.cc.setupNeeded()) {
    await showSetup();
  } else {
    el.stage.hidden = false;
  }

  applyStatus(await window.cc.getState());
})();
