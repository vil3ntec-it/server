/* VILL3N — رفتار سایت عمومی. بدون کتابخانه. هر بخش مستقل است و نبودِ یکی دیگری را خراب نمی‌کند.
   همهٔ کارهای وابسته به اسکرول با IntersectionObserver یا CSS انجام می‌شود؛ هیچ محاسبه‌ای در هر پیکسل اسکرول نیست. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  var nf = new Intl.NumberFormat('fa-AF');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;

  function toFa(s) { return String(s).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function toLatin(s) { return String(s).replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 0x06f0; }).replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 0x0660; }); }
  function safe(fn) { try { fn(); } catch (e) { /* این بخش کنار گذاشته می‌شود؛ بقیهٔ صفحه کار می‌کند */ } }

  /* ───── حالت روشن و تیره ───── */
  $$('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      var apply = function () {
        root.setAttribute('data-theme', next);
        var meta = $('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', next === 'light' ? '#f4f5fa' : '#000000');
        window.dispatchEvent(new Event('v3-theme'));
      };
      try { localStorage.setItem('v3-theme', next); } catch (e) { /* فقط همین بار */ }
      if (doc.startViewTransition && !calm) doc.startViewTransition(apply); else apply();
    });
  });

  /* ───── سربرگ: خط زیرین بعد از اسکرول، و فهرست در موبایل ───── */
  safe(function () {
    var top = $('[data-top]');
    if (!top) return;
    if (hasIO) {
      var mark = doc.createElement('i');
      mark.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:24px;pointer-events:none';
      doc.body.insertBefore(mark, doc.body.firstChild);
      new IntersectionObserver(function (e) { top.classList.toggle('is-stuck', !e[0].isIntersecting); }).observe(mark);
    }
    var btn = $('[data-menu]', top);
    if (!btn) return;
    var set = function (open) { top.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    btn.addEventListener('click', function (e) { e.stopPropagation(); set(!top.classList.contains('is-open')); });
    doc.addEventListener('click', function (e) { if (top.classList.contains('is-open') && (!e.target.closest('.nav') || e.target.closest('a'))) set(false); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && top.classList.contains('is-open')) { set(false); btn.focus(); } });
  });

  /* ───── خط پیشرفت اسکرول (فقط اگر مرورگر نسخهٔ بدون جاوااسکریپتش را ندارد) ───── */
  if (!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'))) {
    var bar = $('.progress i'), queued = false;
    var paint = function () {
      queued = false;
      var max = root.scrollHeight - window.innerHeight;
      if (bar) bar.style.setProperty('--p', max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : 0);
    };
    window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();
  }

  /* ───── رابط نمایشیِ داخل دستگاه‌ها: فقط وقتی دیده می‌شود حرکت می‌کند ───── */
  // دوباره از اول: حرکت‌ها یک لحظه برداشته و برگردانده می‌شوند
  function revive(screen) {
    if (!screen) return;
    screen.classList.remove('is-live');
    void screen.offsetWidth;
    screen.classList.add('is-live');
  }
  safe(function () {
    var screens = $$('.device-screen, .device.has-floats').filter(function (s) { return !s.closest('.stage-app'); });
    if (!screens.length) return;
    if (!hasIO) { screens.forEach(function (s) { s.classList.add('is-live'); }); return; }
    var io = new IntersectionObserver(function (list) { list.forEach(function (e) { e.target.classList.toggle('is-live', e.isIntersecting); }); }, { threshold: 0.25 });
    screens.forEach(function (s) { io.observe(s); });
  });
  // عددهای نمونه (نرخ اسعار، فروش) کمی بالا و پایین می‌روند تا صفحه زنده دیده شود
  safe(function () {
    var ticks = $$('[data-tick]');
    if (!ticks.length || calm) return;
    ticks.forEach(function (el) { el._v = parseFloat(el.getAttribute('data-tick')) || 0; el._s = parseFloat(el.getAttribute('data-step')) || 1; el._f = parseInt(el.getAttribute('data-fix'), 10) || 0; });
    var fmt = {};
    setInterval(function () {
      if (doc.hidden) return;
      ticks.forEach(function (el) {
        if (Math.random() < 0.55 || !el.closest('.is-live')) return;
        el._v = Math.max(0, el._v + (Math.random() < 0.5 ? -1 : 1) * el._s);
        fmt[el._f] = fmt[el._f] || new Intl.NumberFormat('fa-AF', { minimumFractionDigits: el._f, maximumFractionDigits: el._f });
        el.textContent = fmt[el._f].format(el._v);
      });
    }, 1700);
  });

  /* ───── قهرمان صفحهٔ اصلی: کد تایپ می‌شود و هر خط، برنامهٔ خودش را روی دستگاه زنده می‌کند ───── */
  safe(function () {
    var stage = $('[data-stage]');
    if (!stage) return;
    var apps = $$('.stage-app', stage), tabs = $$('.stage-tab', stage), lines = $$('.ln', stage);
    if (!apps.length) return;
    var current = -1, timer = 0, visible = true, typed = calm, manual = false;
    var hero = stage.closest ? stage.closest('.hero') : null;
    var show = function (i) {
      if (i === current || !apps[i]) return;
      current = i;
      apps.forEach(function (a, k) { a.classList.toggle('is-on', k === i); });
      tabs.forEach(function (t, k) { t.classList.toggle('is-on', k === i); });
      lines.forEach(function (l) { l.classList.toggle('is-on', l.getAttribute('data-i') === String(i)); });
      // رنگ همان برنامه روی کل صحنه می‌نشیند
      ['--app', '--app2'].forEach(function (p) { stage.style.setProperty(p, apps[i].style.getPropertyValue(p)); });
      // …و نور پس‌زمینهٔ قهرمان هم به همان رنگ می‌رود
      if (hero) { hero.style.setProperty('--hero-c', apps[i].style.getPropertyValue('--app')); hero.style.setProperty('--hero-c2', apps[i].style.getPropertyValue('--app2')); }
      apps.forEach(function (a, k) { var s = $('.device-screen', a); if (!s) return; if (k === i) revive(s); else s.classList.remove('is-live'); });
    };
    var arm = function () {
      clearTimeout(timer);
      stage.classList.remove('is-auto');
      if (calm || !(typed || manual) || !visible || doc.hidden || apps.length < 2) return;
      void stage.offsetWidth;
      stage.classList.add('is-auto');
      timer = setTimeout(function () { show((current + 1) % apps.length); arm(); }, 5000);
    };
    tabs.forEach(function (t, i) { t.addEventListener('click', function () { manual = true; show(i); arm(); }); });
    if (hasIO) new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting;
      // بیرون از دید: رابط نمایشیِ صحنه هم می‌ایستد
      var s = apps[current] && $('.device-screen', apps[current]);
      if (s) { if (visible) s.classList.add('is-live'); else s.classList.remove('is-live'); }
      arm();
    }, { threshold: 0.2 }).observe(stage);
    doc.addEventListener('visibilitychange', arm);
    show(0);
    if (calm) return;

    // تایپ‌شدن کد
    var parts = lines.map(function (ln) {
      return { el: ln, i: ln.getAttribute('data-i'), parts: Array.prototype.map.call(ln.children, function (sp) { var t = sp.textContent; sp.textContent = ''; return { el: sp, text: t }; }) };
    });
    var caret = doc.createElement('i'); caret.className = 'caret';
    var li = 0, pi = 0, ci = 0;
    var step = function () {
      var line = parts[li];
      if (!line) { typed = true; if (caret.parentNode) caret.parentNode.removeChild(caret); if (!manual) arm(); return; } // تمام شد؛ از این‌جا برنامه‌ها به نوبت نشان داده می‌شوند
      if (caret.parentNode !== line.el) line.el.appendChild(caret);
      var part = line.parts[pi];
      if (!part) {
        if (line.i !== null && !manual) show(+line.i);
        li++; pi = 0; ci = 0;
        setTimeout(step, line.i !== null ? 900 : (line.parts.length ? 160 : 50));
        return;
      }
      ci = Math.min(part.text.length, ci + 2);
      part.el.textContent = part.text.slice(0, ci);
      if (ci >= part.text.length) { pi++; ci = 0; }
      setTimeout(step, 24);
    };
    setTimeout(step, 700);
  });

  /* ───── کج‌شدن سه‌بعدی زیر نشانگر و نور روی کارت‌ها (فقط با ماوس) ───── */
  if (fine && !calm) safe(function () {
    var tiltTarget = $('.stage-3d') || $('.app-hero .device-3d');
    var area = $('.hero') || $('.app-hero');
    if (tiltTarget && area) {
      var tr = 0, te = null;
      // نور نرمی که دنبال نشانگر می‌آید: یک عنصر، فقط با transform
      var light = doc.createElement('i'); light.className = 'ptr-light'; light.setAttribute('aria-hidden', 'true'); area.appendChild(light);
      var runTilt = function () {
        tr = 0;
        if (!te) return;
        var x = te.clientX / window.innerWidth - .5, y = te.clientY / window.innerHeight - .5;
        tiltTarget.style.setProperty('--ty', (x * 10).toFixed(2) + 'deg');
        tiltTarget.style.setProperty('--tx', (-y * 8).toFixed(2) + 'deg');
        var box = area.getBoundingClientRect();
        light.style.transform = 'translate3d(' + (te.clientX - box.left).toFixed(0) + 'px,' + (te.clientY - box.top).toFixed(0) + 'px,0)';
        light.classList.add('is-on');
      };
      area.addEventListener('pointermove', function (e) { te = e; if (!tr) tr = requestAnimationFrame(runTilt); }, { passive: true });
      area.addEventListener('pointerleave', function () { te = null; light.classList.remove('is-on'); tiltTarget.style.setProperty('--ty', '0deg'); tiltTarget.style.setProperty('--tx', '0deg'); });
    }
    var sr = 0, se = null, sel = null;
    var runSpot = function () {
      sr = 0;
      if (!se || !sel) return;
      var box = sel.getBoundingClientRect();
      sel.style.setProperty('--mx', (se.clientX - box.left).toFixed(0) + 'px');
      sel.style.setProperty('--my', (se.clientY - box.top).toFixed(0) + 'px');
    };
    doc.addEventListener('pointermove', function (e) {
      var el = e.target.closest ? e.target.closest('.spot') : null;
      if (!el) return;
      se = e; sel = el;
      if (!sr) sr = requestAnimationFrame(runSpot);
    }, { passive: true });
  });

  /* ───── صحنهٔ متحرک پس‌زمینه: بعد از کامل‌شدن صفحه و در زمان بیکاری مرورگر بار می‌شود ───── */
  var sceneSrc = doc.body.getAttribute('data-scene-src');
  if (sceneSrc && $('canvas.scene')) {
    var boot = function () { var s = doc.createElement('script'); s.src = sceneSrc; s.async = true; doc.head.appendChild(s); };
    var later = function () { if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 1500 }); else setTimeout(boot, 200); };
    if (doc.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
  }

  /* ───── دسته‌بندی برنامه‌ها ───── */
  var chips = $$('.chip');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var cat = chip.getAttribute('data-cat');
      chips.forEach(function (c) { c.classList.toggle('is-on', c === chip); c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      $$('.chapter, .mini-wrap').forEach(function (li) { li.hidden = !!cat && li.getAttribute('data-cat') !== cat; });
      var more = $('.more-title');
      if (more) more.hidden = !$$('.mini-wrap').some(function (li) { return !li.hidden; });
    });
  });

  /* ───── شمارش عددها هنگام دیده‌شدن ───── */
  safe(function () {
    var nums = $$('[data-count]');
    if (!nums.length || calm || !hasIO) return;
    var run = function (el) {
      var raw = el.textContent, m = /^(\D*?)(\d[\d.,٬٫]*)(\D*)$/.exec(toLatin(raw).trim());
      if (!m) return;
      var clean = m[2].replace(/[,٬]/g, '').replace('٫', '.');
      var target = parseFloat(clean);
      if (!isFinite(target) || target <= 0) return;
      var dec = (clean.split('.')[1] || '').length;
      var f = new Intl.NumberFormat('fa-AF', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: /[,٬]/.test(m[2]) || target >= 10000 });
      var pre = toFa(m[1]), post = toFa(m[3]), t0 = 0, dur = 1400;
      var tick = function (now) {
        if (!t0) t0 = now;
        var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
        el.textContent = pre + f.format(target * e) + post;
        if (p < 1) requestAnimationFrame(tick); else el.textContent = raw;
      };
      requestAnimationFrame(tick);
    };
    var io = new IntersectionObserver(function (list) { list.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); run(e.target); } }); }, { threshold: 0.6 });
    nums.forEach(function (n) { io.observe(n); });
  });

  /* ───── نوار بخش‌های صفحهٔ برنامه: بخشِ در حال دیدن پررنگ می‌شود ───── */
  safe(function () {
    var nav = $('[data-subnav]');
    if (!nav || !hasIO) return;
    var links = $$('li a', nav), map = {};
    links.forEach(function (a) { var el = doc.getElementById(a.getAttribute('href').slice(1)); if (el) map[el.id] = a; });
    var ids = Object.keys(map), ul = $('ul', nav), active = null;
    // بخشِ فعال: آخرین بخشی که بالایش از ۴۰٪ بالای صفحه گذشته است
    var pick = function () {
      var best = null, line = window.innerHeight * 0.4;
      ids.forEach(function (id) { if (doc.getElementById(id).getBoundingClientRect().top < line) best = id; });
      var on = best ? map[best] : null;
      if (on === active) return;
      active = on;
      links.forEach(function (a) { if (a === on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      if (on && ul && ul.scrollWidth > ul.clientWidth) {
        var r = on.getBoundingClientRect(), u = ul.getBoundingClientRect();
        ul.scrollBy({ left: (r.left + r.width / 2) - (u.left + u.width / 2), behavior: calm ? 'auto' : 'smooth' });
      }
    };
    var io = new IntersectionObserver(pick, { rootMargin: '-39% 0px -59% 0px', threshold: [0, 1] });
    ids.forEach(function (id) { io.observe(doc.getElementById(id)); });
    var hero = $('.app-hero');
    if (hero) new IntersectionObserver(pick, { threshold: [0, 0.5, 1] }).observe(hero);
    pick();
  });

  /* ───── گشت در برنامه: با رسیدن به هر توضیح، تصویرِ همان روی دستگاه می‌آید ───── */
  safe(function () {
    var tour = $('[data-tour]');
    if (!tour || !hasIO) return;
    var imgs = $$('.tour-stage img', tour), steps = $$('.tour-steps li', tour);
    var io = new IntersectionObserver(function (list) {
      list.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = +e.target.getAttribute('data-i');
        imgs.forEach(function (im, k) { im.classList.toggle('is-on', k === i); });
        steps.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { io.observe(s); });
  });

  /* ───── بزرگ‌نمایی تصویرهای برنامه ───── */
  safe(function () {
    var zone = $('[data-zoomable]');
    if (!zone || !window.HTMLDialogElement) return;
    var dlg = doc.createElement('dialog'); dlg.className = 'zoom';
    var big = doc.createElement('img'); big.alt = ''; dlg.appendChild(big);
    doc.body.appendChild(dlg);
    dlg.addEventListener('click', function () { dlg.close(); });
    zone.addEventListener('click', function (e) {
      var hit = e.target.closest('.shot, img');
      var im = hit && (hit.tagName === 'IMG' ? hit : $('img', hit));
      if (!im) return;
      big.src = im.currentSrc || im.src; big.alt = im.alt;
      dlg.showModal();
    });
  });

  /* ───── نوار روان: دکمهٔ ایستادن و حرکت ───── */
  safe(function () {
    var band = $('[data-band]'), btn = band && $('[data-band-toggle]', band);
    if (!band) return;
    // بیرون از دید، نوار حرکت نمی‌کند
    if (hasIO) new IntersectionObserver(function (e) { band.classList.toggle('is-off', !e[0].isIntersecting); }).observe(band);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var paused = band.classList.toggle('is-paused');
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    });
  });

  /* ───── جدول‌های پهن: اگر جا نشد، راهنمای کشیدن به پهلو دیده می‌شود ───── */
  safe(function () {
    var wraps = $$('.tbl-wrap');
    if (!wraps.length) return;
    var mark = function () { wraps.forEach(function (w) { w.classList.toggle('can-scroll', w.scrollWidth > w.clientWidth + 4); }); };
    mark();
    var t = 0;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(mark, 200); }, { passive: true });
  });

  /* ───── دکمهٔ دانلود: نسخهٔ مناسب همین دستگاه ───── */
  var cta = $('[data-downloads]');
  if (cta) {
    try {
      var list = JSON.parse(cta.getAttribute('data-downloads'));
      var ua = navigator.userAgent, mine = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : /windows/i.test(ua) ? 'windows' : /mac os x|macintosh/i.test(ua) ? 'mac' : /linux/i.test(ua) ? 'linux' : '';
      var hit = list.filter(function (d) { return d.p === mine; })[0];
      if (hit) {
        $('[data-dl-main]', cta).setAttribute('href', hit.href);
        $('[data-dl-label]', cta).textContent = 'دانلود برای ' + hit.label;
        $('[data-dl-sub]', cta).textContent = 'نسخهٔ ' + toFa(hit.v) + ' · ' + hit.size;
      }
    } catch (e) { /* همان پیش‌فرض سرور می‌ماند */ }
  }

  /* ───── شمارش معکوس تخفیف ───── */
  var untils = $$('[data-until]');
  if (untils.length) {
    var tick = function () {
      untils.forEach(function (el) {
        var ms = new Date(el.getAttribute('data-until')).getTime() - Date.now();
        if (!(ms > 0)) { el.textContent = 'تخفیف تمام شد'; return; }
        var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
        el.textContent = d > 0 ? nf.format(d) + ' روز و ' + nf.format(h) + ' ساعت مانده' : h > 0 ? nf.format(h) + ' ساعت و ' + nf.format(m) + ' دقیقه مانده' : nf.format(Math.max(1, m)) + ' دقیقه مانده';
      });
    };
    tick(); setInterval(tick, 30000);
  }

  function post(url, data) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'پاسخ سرور خوانده نشد' }; }).then(function (j) { if (!r.ok && !j.error) j.error = 'خطا در ارتباط با سرور'; j.status = r.status; return j; }); })
      .catch(function () { return { ok: false, error: 'اینترنت قطع است یا سرور در دسترس نیست. دوباره تلاش کنید.' }; });
  }

  /* ───── سفارش اشتراک ───── */
  var dlg = $('#order');
  if (dlg && dlg.showModal) {
    var form = $('form', dlg), err = $('[data-err]', dlg), bill = $('[data-bill]', dlg), submit = $('[data-submit]', dlg);
    var currency = (dlg.getAttribute('data-currency') || '').replace(/[&<>"']/g, '');
    var money = function (n) { return n === 0 ? 'رایگان' : nf.format(n) + ' ' + currency; };
    var seq = 0;
    var requote = function (showCouponError) {
      var mine2 = ++seq;
      return post('/api/quote', { appId: dlg.getAttribute('data-app'), planId: form.planId.value, coupon: form.coupon.value.trim() }).then(function (q) {
        if (mine2 !== seq) return; // پاسخ قدیمی
        if (!q.ok) { err.textContent = q.error || ''; bill.textContent = ''; return; }
        var rows = '';
        if (q.planOff || q.couponOff) rows += '<dt>قیمت</dt><dd>' + money(q.base) + '</dd>';
        if (q.planOff) rows += '<dt>تخفیف اشتراک</dt><dd class="off">' + money(q.planOff) + ' کمتر</dd>';
        if (q.couponOff) rows += '<dt>تخفیف کد</dt><dd class="off">' + money(q.couponOff) + ' کمتر</dd>';
        rows += '<dt class="sum">قابل پرداخت</dt><dd class="sum">' + money(q.total) + '</dd>';
        bill.innerHTML = rows;
        err.textContent = showCouponError && q.couponError ? q.couponError : '';
      });
    };
    var open = function (planId) {
      if (planId) form.planId.value = planId;
      $('[data-step="form"]', dlg).hidden = false; $('[data-step="done"]', dlg).hidden = true;
      err.textContent = '';
      dlg.showModal();
      requote(false);
      setTimeout(function () { form.name.focus(); }, 60);
    };
    $$('[data-order]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); open(b.getAttribute('data-order')); }); });
    $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
    // بستن با کلیک روی زمینه: فقط اگر خودِ کلیک از زمینه شروع شده باشد (نه پایانِ انتخاب متن)
    var downOnBackdrop = false;
    dlg.addEventListener('pointerdown', function (e) { downOnBackdrop = e.target === dlg; });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && downOnBackdrop) dlg.close(); });
    form.planId.addEventListener('change', function () { requote(!!form.coupon.value.trim()); });
    $('[data-apply]', dlg).addEventListener('click', function () { requote(true); });
    form.coupon.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); requote(true); } });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submit.disabled) return;
      var name = form.name.value.trim(), phone = form.phone.value.trim();
      if (name.length < 2) { err.textContent = 'نام خود را بنویسید'; form.name.focus(); return; }
      if (phone.replace(/[^\d۰-۹٠-٩]/g, '').length < 9) { err.textContent = 'شمارهٔ تماس را کامل بنویسید'; form.phone.focus(); return; }
      submit.disabled = true; submit.textContent = 'در حال ثبت…'; err.textContent = '';
      post('/api/order', { appId: dlg.getAttribute('data-app'), planId: form.planId.value, name: name, phone: phone, coupon: form.coupon.value.trim(), note: form.note.value, website: form.website.value }).then(function (r) {
        submit.disabled = false; submit.textContent = 'ثبت سفارش';
        if (!r.ok || !r.no) { err.textContent = r.error || 'ثبت نشد. دوباره تلاش کنید.'; return; }
        $('[data-no]', dlg).textContent = toFa(r.no);
        var wa = dlg.getAttribute('data-wa'), link = $('[data-wa-link]', dlg);
        if (wa && link) {
          link.hidden = false;
          link.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('سلام، سفارش شمارهٔ ' + r.no + ' را برای «' + dlg.getAttribute('data-appname') + '» (' + (r.plan || '') + ') ثبت کردم. نام: ' + name);
        }
        $('[data-step="form"]', dlg).hidden = true; $('[data-step="done"]', dlg).hidden = false;
        var done = $('[data-done]', dlg);
        if (done) done.focus();
      });
    });
  }
  // مرورگر خیلی قدیمی (بدون پنجرهٔ سفارش): همان پیوند واتساپِ خودِ دکمه باز می‌شود

  /* ───── بررسی اشتراک ───── */
  var check = $('[data-check]');
  if (check) {
    var out = $('[data-check-out]'), input = check.code;
    var fromUrl = new URLSearchParams(location.search).get('code');
    var verdict = function (cls, title, texts) {
      var box = doc.createElement('p'); box.className = 'verdict ' + cls;
      var b = doc.createElement('b'); b.textContent = title; box.appendChild(b);
      (texts || []).forEach(function (t) { var s = doc.createElement('span'); s.textContent = t; box.appendChild(s); });
      out.textContent = ''; out.appendChild(box);
    };
    var run = function () {
      var code = input.value.trim().toUpperCase().replace(/\s+/g, '');
      if (code.length < 8) { verdict('is-bad', 'کد کامل نیست', ['کد فعال‌سازی را کامل بنویسید.']); input.focus(); return; }
      verdict('', 'در حال بررسی…');
      fetch('/api/license/' + encodeURIComponent(code)).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) return verdict('is-bad', j.error || 'بررسی نشد');
        if (!j.found) return verdict('is-bad', 'این کد پیدا نشد', ['کد را دوباره بررسی کنید یا با ما تماس بگیرید.']);
        var head = j.app + ' — ' + j.plan;
        if (j.state === 'active') return verdict('is-ok', 'اشتراک فعال است', [head, j.lifetime ? 'این اشتراک دایمی است.' : 'تا ' + j.endFa + ' (' + nf.format(j.daysLeft) + ' روز دیگر)']);
        if (j.state === 'expired') return verdict('is-bad', 'اشتراک تمام شده است', [head, 'پایان: ' + j.endFa + '. برای تمدید با ما تماس بگیرید.']);
        return verdict('is-bad', 'این اشتراک باطل شده است', [head, 'برای پیگیری با ما تماس بگیرید.']);
      }).catch(function () { verdict('is-bad', 'اینترنت قطع است یا سرور در دسترس نیست', ['دوباره تلاش کنید.']); });
    };
    check.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    if (fromUrl) { input.value = fromUrl; run(); }
  }
})();
