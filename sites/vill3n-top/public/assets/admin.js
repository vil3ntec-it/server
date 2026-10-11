/* VILL3N — پنل مالک (یک‌صفحه‌ای، بدون کتابخانه).
   همهٔ متن‌هایی که از سرور می‌آیند با textContent گذاشته می‌شوند، نه innerHTML. */
(function () {
  'use strict';
  var root = document.getElementById('app');
  var nf = new Intl.NumberFormat('fa-AF');
  var df = new Intl.DateTimeFormat('fa-AF-u-ca-persian', { timeZone: 'Asia/Kabul', year: 'numeric', month: 'long', day: 'numeric' });
  var dayShort = new Intl.DateTimeFormat('fa-AF-u-ca-persian', { timeZone: 'Asia/Kabul', month: 'short', day: 'numeric' });
  var dtf = new Intl.DateTimeFormat('fa-AF-u-ca-persian', { timeZone: 'Asia/Kabul', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  var S = { state: null, meta: null, dirty: false };

  /* ───── ابزار ───── */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // فقط برای آیکن‌های ثابتِ خودِ پنل
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open' || k === 'hidden') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    if (kids === null || kids === undefined || kids === false) return el;
    if (Array.isArray(kids)) kids.forEach(function (c) { add(el, c); });
    else el.appendChild(typeof kids === 'object' ? kids : document.createTextNode(String(kids)));
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function num(n) { return nf.format(Number(n) || 0); }
  function fa(s) { return String(s).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function date(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : df.format(d); }
  function dateTime(v) { if (!v) return ''; var d = new Date(v); return isNaN(d) ? '' : dtf.format(d); }
  function bytes(n) { n = Number(n) || 0; if (n < 1024) return num(n) + ' بایت'; var u = ['کیلوبایت', 'مگابایت', 'گیگابایت'], i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 2); return nf.format(Math.round(n * 10) / 10) + ' ' + u[i]; }
  function money(n) { return n === 0 ? 'رایگان' : num(n) + ' ' + ((S.meta && S.meta.currency) || 'افغانی'); }
  function toLocalInput(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return ''; var p = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function fromLocalInput(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function mono(name) { var w = String(name || '').trim().split(/\s+/); var f = w[0] || 'V'; return /^[A-Za-z0-9]/.test(f) ? (w[1] && /^[A-Za-z0-9]/.test(w[1]) ? f[0] + w[1][0] : f.slice(0, 2)).toUpperCase() : f[0]; }

  var ICON = {
    home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>', apps: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    cart: '<path d="M4 5h2l2 11h10l2-8H7"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 2.5 2.5"/>',
    tag: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.4"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z"/>',
    box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>', search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>', out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M9.5 9.5V20"/>', pages: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>', right: '<path d="M9 6l6 6-6 6"/>', left: '<path d="M15 6l-6 6 6 6"/>',
    img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.500" cy="9.500" r="1.500"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    up: '<path d="M6 14l6-6 6 6"/>', down: '<path d="M6 10l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  };
  function ic(name) { return h('span', { html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || '') + '</svg>', style: 'display:inline-flex' }); }

  function api(method, path, body, raw) {
    var opt = { method: method, headers: { 'X-V3': '1' }, credentials: 'same-origin' };
    if (raw) { opt.body = body; opt.headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    return fetch('/api/admin' + path, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'پاسخ سرور خوانده نشد' }; }).then(function (j) {
        if (r.status === 401 && S.state && S.state.authed) { S.state.authed = false; gate(); }
        if (!r.ok) { var e = new Error(j.error || 'خطا در ارتباط با سرور'); e.data = j; e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('ارتباط با سرور قطع است. دوباره تلاش کنید.'); });
  }

  var toasts = h('div', { class: 'toasts', role: 'status' });
  function toast(msg, bad) { var t = h('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg }); toasts.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 7000 : 3600); }
  function fail(e) { toast(e && e.message ? e.message : 'خطا', true); }
  function copy(text, what) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast((what || 'متن') + ' کپی شد'); }, function () { window.prompt('کپی کنید:', text); }); }

  function modal(title, body, actions) {
    var d = h('dialog', { class: 'modal' });
    var box = h('div', { class: 'modal-box' }, [h('h2', { text: title }), body, h('div', { class: 'row end' }, actions(function () { d.close(); }))]);
    d.appendChild(box);
    d.addEventListener('close', function () { d.remove(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    document.body.appendChild(d); d.showModal();
    return d;
  }
  function confirmBox(title, text, yes, danger) {
    return new Promise(function (resolve) {
      var done = false;
      var d = modal(title, h('p', { class: 'mute', text: text }), function (close) {
        return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn ' + (danger ? 'danger' : 'main'), type: 'button', text: yes, onclick: function () { done = true; close(); } })];
      });
      d.addEventListener('close', function () { resolve(done); });
    });
  }

  function field(label, input, hint, cls) {
    var id = 'f' + Math.random().toString(36).slice(2, 9);
    if (input.tagName && /INPUT|SELECT|TEXTAREA/.test(input.tagName)) input.id = id;
    return h('div', { class: 'field ' + (cls || '') }, [h('label', { for: id, text: label }), input, hint ? h('small', { text: hint }) : null]);
  }
  // quiet=true: این ورودی نوار «ذخیرهٔ تغییرها»ی صفحه را بالا نمی‌آورد (بخش‌هایی که دکمهٔ ذخیرهٔ خودشان را دارند)
  function inp(obj, key, attrs, quiet) {
    var a = Object.assign({ type: 'text', value: obj[key] === null || obj[key] === undefined ? '' : obj[key] }, attrs || {});
    a.oninput = function (e) { obj[key] = e.target.value; if (!quiet) touch(); };
    return h('input', a);
  }
  function area(obj, key, attrs, quiet) { var t = h('textarea', Object.assign({ oninput: function (e) { obj[key] = e.target.value; if (!quiet) touch(); } }, attrs || {})); t.value = obj[key] || ''; return t; }
  function sel(obj, key, options, attrs) {
    var s = h('select', Object.assign({ onchange: function (e) { obj[key] = e.target.value; if (!(attrs && attrs.quiet)) touch(); if (attrs && attrs.after) attrs.after(); } }, attrs && attrs.dom || {}));
    Object.keys(options).forEach(function (k) { s.appendChild(h('option', { value: k, text: options[k], selected: String(obj[key]) === k })); });
    return s;
  }
  function chk(obj, key, label, after) { return h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: !!obj[key], onchange: function (e) { obj[key] = e.target.checked; touch(); if (after) after(); } }), h('span', { text: label })]); }
  function touch() { if (S.onDirty) S.onDirty(); }
  // پیوند به سایتِ عمومی: روی admin.<دامنه> همهٔ نشانی‌ها پنل را باز می‌کنند، پس «دیدن در سایت» باید به دامنهٔ اصلی برود
  function siteUrl(p) { return location.origin.replace('//admin.', '//') + p; }
  // دانسته‌های ثابت پنل (نوع بخش‌ها، نشانه‌ها، صحنه‌ها) همراه فهرست برنامه‌ها می‌آید؛ یک بار گرفته می‌شود
  function needMeta() { return S.meta && S.meta.icons ? Promise.resolve() : api('GET', '/apps').then(function (r) { S.meta = Object.assign(S.meta || {}, r); }); }

  /* ───── ورود و راه‌اندازی ───── */
  function gate() {
    S.onDirty = null;
    var st = S.state, box = h('div', { class: 'gate-box' });
    var head = h('div', { class: 'gate-brand' }, [h('b', { text: st.brand || 'VILL3N' }), h('span', { text: 'پنل مالک' })]);
    var err = h('p', { class: 'small', style: 'color:var(--bad);min-height:1.7em;margin-top:8px', role: 'alert' });
    var f = {};
    if (st.setup) {
      f.code = (location.hash.match(/setup=([A-Z0-9-]+)/i) || [])[1] || ''; f.username = 'owner'; f.email = ''; f.password = ''; f.again = '';
      var form = h('form', { onsubmit: function (e) {
        e.preventDefault(); err.textContent = '';
        if (f.password !== f.again) { err.textContent = 'رمز و تکرار آن یکی نیست'; return; }
        btn.disabled = true;
        api('POST', '/setup', { code: f.code, username: f.username, email: f.email, password: f.password }).then(function () { history.replaceState(null, '', location.pathname); boot(); }, function (e2) { err.textContent = e2.message; btn.disabled = false; });
      } });
      var btn = h('button', { class: 'btn main', type: 'submit', text: 'ساخت رمز و ورود' });
      add(form, [
        h('h1', { text: 'راه‌اندازی اولین بار' }),
        h('p', { class: 'lead', text: 'برای اینکه فقط خودتان مالک این پنل شوید، کد راه‌اندازی را از روی سرور بردارید و رمز خود را بسازید.' }),
        h('div', { class: 'codebox ltr', text: st.codeFile || 'data/SETUP-CODE.txt' }),
        field('کد راه‌اندازی', inp(f, 'code', { dir: 'ltr', autocomplete: 'off', required: true, placeholder: 'XXXX-XXXX-XXXX' }), 'داخل همین فایل روی سرور نوشته شده است.'),
        field('نام کاربری', inp(f, 'username', { dir: 'ltr', autocomplete: 'username', required: true })),
        field('ایمیل', inp(f, 'email', { type: 'email', dir: 'ltr', autocomplete: 'email' }), 'اختیاری؛ برای ورود با کد ۶ رقمی لازم می‌شود.'),
        field('رمز', inp(f, 'password', { type: 'password', dir: 'ltr', autocomplete: 'new-password', required: true, minlength: 10 }), 'دست‌کم ۱۰ نویسه.'),
        field('تکرار رمز', inp(f, 'again', { type: 'password', dir: 'ltr', autocomplete: 'new-password', required: true })),
        err, btn,
      ]);
      add(box, [head, form]);
    } else {
      f.username = 'owner'; f.password = ''; f.code = '';
      var step2 = function (ticket, hint) {
        clear(box); err.textContent = '';
        var form2 = h('form', { onsubmit: function (e) { e.preventDefault(); b2.disabled = true; api('POST', '/login/code', { ticket: ticket, code: f.code }).then(boot, function (e2) { err.textContent = e2.message; b2.disabled = false; }); } });
        var b2 = h('button', { class: 'btn main', type: 'submit', text: 'تأیید و ورود' });
        add(form2, [h('h1', { text: 'کد ۶ رقمی' }), h('p', { class: 'lead', text: 'کدی به ' + (hint || 'ایمیل شما') + ' فرستاده شد. تا ۵ دقیقه اعتبار دارد.' }), field('کد', inp(f, 'code', { dir: 'ltr', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true })), err, b2, h('button', { class: 'btn', type: 'button', text: 'بازگشت', onclick: gate })]);
        add(box, [head, form2]);
      };
      var form1 = h('form', { onsubmit: function (e) {
        e.preventDefault(); err.textContent = ''; b1.disabled = true;
        api('POST', '/login', { username: f.username, password: f.password }).then(function (r) { if (r.step === 'code') step2(r.ticket, r.hint); else boot(); }, function (e2) { err.textContent = e2.message; b1.disabled = false; });
      } });
      var b1 = h('button', { class: 'btn main', type: 'submit', text: 'ورود' });
      add(form1, [h('h1', { text: 'ورود مالک' }), h('p', { class: 'lead', text: 'این بخش فقط برای مالک سایت است.' }), field('نام کاربری', inp(f, 'username', { dir: 'ltr', autocomplete: 'username', required: true })), field('رمز', inp(f, 'password', { type: 'password', dir: 'ltr', autocomplete: 'current-password', required: true })), err, b1]);
      add(box, [head, form1]);
    }
    clear(root).appendChild(h('div', { class: 'gate' }, box));
    var first = box.querySelector('input:not([value]), input[type=password]') || box.querySelector('input');
    if (first) first.focus();
  }

  /* ───── قالب و مسیرها ───── */
  var NAV = [['', 'داشبورد', 'home'], ['apps', 'برنامه‌ها', 'apps'], ['home', 'صفحهٔ اصلی', 'layout'], ['pages', 'صفحه‌ها', 'pages'], ['orders', 'سفارش‌ها', 'cart'], ['licenses', 'اشتراک‌ها', 'key'], ['coupons', 'کدهای تخفیف', 'tag'], ['seo', 'سئو و هوش مصنوعی', 'search'], ['deploy', 'اتصال و استقرار', 'link'], ['settings', 'تنظیمات', 'gear'], ['security', 'امنیت', 'shield'], ['backup', 'پشتیبان', 'box']];
  var main, side;
  function shell() {
    main = h('main', { class: 'main' });
    side = h('aside', { class: 'side' });
    add(side, h('a', { class: 'side-brand', href: siteUrl('/'), target: '_blank', rel: 'noopener', title: 'دیدن سایت' }, [h('b', { text: S.state.brand }), h('span', { text: 'پنل مالک' })]));
    NAV.forEach(function (n) { side.appendChild(h('a', { class: 'nav', href: '#/' + n[0], 'data-r': n[0] }, [ic(n[2]), h('span', { class: 't', text: n[1] })])); });
    add(side, h('div', { class: 'side-foot' }, [
      h('span', { class: 'who small mute', text: 'وارد شده: ' + S.state.username }),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn sm icon', type: 'button', title: 'حالت روشن یا تیره', 'aria-label': 'حالت روشن یا تیره', onclick: function () { var n = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('v3-theme', n); } catch (e) { /* فقط همین بار */ } } }, ic('sun')),
        h('button', { class: 'btn sm', type: 'button', onclick: function () { api('POST', '/logout').then(boot, boot); } }, [ic('out'), 'خروج']),
      ]),
    ]));
    clear(root).appendChild(h('div', { class: 'shell' }, [side, main]));
    document.body.appendChild(toasts);
  }

  function head(title, sub, actions) { return h('div', { class: 'page-head' }, [h('h1', { text: title }), h('span', { class: 'spacer' }), actions || null, sub ? h('p', { text: sub }) : null]); }
  function loading() { clear(main).appendChild(h('p', { class: 'mute', text: 'در حال بارگذاری…' })); }

  var ROUTES = {};
  function route() {
    var hash = location.hash.replace(/^#\/?/, ''), parts = hash.split('/');
    var name = /^setup=/.test(hash) ? '' : parts[0];
    if (!ROUTES[name]) name = '';
    lastHash = location.hash;
    S.onDirty = null;
    Array.prototype.forEach.call(side.querySelectorAll('a.nav'), function (a) { a.classList.toggle('is-on', a.getAttribute('data-r') === name); });
    loading();
    Promise.resolve(ROUTES[name](parts.slice(1))).catch(function (e) { clear(main).appendChild(h('div', { class: 'empty' }, [h('b', { text: 'این بخش باز نشد' }), e.message])); });
    window.scrollTo(0, 0);
  }
  var lastHash = location.hash, undoing = false;
  window.addEventListener('hashchange', function () {
    if (!S.state || !S.state.authed) return;
    if (undoing) { undoing = false; return; } // همان برگرداندنِ نشانی است، نه جابه‌جایی تازه
    if (S.dirty && !window.confirm('تغییرهای ذخیره‌نشده از بین می‌رود. ادامه می‌دهید؟')) {
      // نشانی را به صفحهٔ فعلی برمی‌گردانیم و صفحه را دست نمی‌زنیم
      undoing = true; history.replaceState(null, '', lastHash || '#/'); undoing = false;
      return;
    }
    S.dirty = false; lastHash = location.hash; route();
  });
  window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ───── داشبورد ───── */
  function chart(days) {
    var W = 720, H = 220, pl = 34, pb = 26, pt = 10, n = days.length, max = Math.max(4, Math.max.apply(null, days.map(function (d) { return d.downloads; })));
    var step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step; if (top / step > 5) { top = Math.ceil(max / (step * 2)) * step * 2; }
    var cw = (W - pl) / n, ph = H - pb - pt, ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('direction', 'ltr'); svg.style.direction = 'ltr'; svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'دانلودهای ۳۰ روز گذشته');
    var mk = function (tag, a, text) { var e = document.createElementNS(ns, tag); for (var k in a) e.setAttribute(k, a[k]); if (text !== undefined) e.textContent = text; return e; };
    var grid = mk('g', { class: 'grid' }), axis = mk('g', { class: 'axis' });
    for (var g = 0; g <= 4; g++) { var y = pt + ph - ph * g / 4; grid.appendChild(mk('line', { x1: pl, x2: W, y1: y, y2: y })); axis.appendChild(mk('text', { x: pl - 6, y: y + 4, 'text-anchor': 'end' }, num(Math.round(top * g / 4)))); }
    svg.appendChild(grid);
    var wrap = h('div', { class: 'chart' }), tip = h('div', { class: 'tip', hidden: true });
    days.forEach(function (d, i) {
      var bh = Math.max(d.downloads ? 3 : 0, ph * d.downloads / top), x = pl + i * cw, w = Math.max(2, cw - 2), col = mk('g', { class: 'col' });
      var r = Math.min(4, w / 2, bh);
      // میله با سر گرد و پایهٔ صاف روی خط صفر
      col.appendChild(mk('path', { class: 'bar', d: 'M' + (x + 1) + ' ' + (pt + ph) + 'v' + (-(bh - r)) + 'q0 ' + (-r) + ' ' + r + ' ' + (-r) + 'h' + (w - 2 * r) + 'q' + r + ' 0 ' + r + ' ' + r + 'v' + (bh - r) + 'z' }));
      var hit = mk('rect', { class: 'hit', x: x, y: pt, width: cw, height: ph });
      hit.addEventListener('pointerenter', function () { tip.hidden = false; clear(tip); add(tip, [h('b', { text: num(d.downloads) }), ' دانلود، ', date(d.day + 'T08:00:00Z')]); tip.style.left = ((x + cw / 2) / W * 100) + '%'; tip.style.top = ((pt + ph - bh) / H * 100) + '%'; });
      hit.addEventListener('pointerleave', function () { tip.hidden = true; });
      col.appendChild(hit); svg.appendChild(col);
      if (i % 7 === (n - 1) % 7) axis.appendChild(mk('text', { x: x + cw / 2, y: H - 8, 'text-anchor': 'middle' }, dayShort.format(new Date(d.day + 'T08:00:00Z'))));
    });
    svg.appendChild(axis);
    var tbl = h('table', { class: 'data' }, [h('thead', null, h('tr', null, [h('th', { text: 'روز' }), h('th', { text: 'دانلود' }), h('th', { text: 'بازدید' })])), h('tbody', null, days.slice().reverse().map(function (d) { return h('tr', null, [h('td', { text: date(d.day + 'T08:00:00Z') }), h('td', { text: num(d.downloads) }), h('td', { text: num(d.views) })]); }))]);
    add(wrap, [svg, tip]);
    return [wrap, h('details', { class: 'table' }, [h('summary', { text: 'دیدن همین آمار به‌صورت جدول' }), tbl])];
  }

  ROUTES[''] = function () {
    return api('GET', '/overview').then(function (o) {
      S.meta = Object.assign(S.meta || {}, { currency: o.currency });
      var t = o.totals, c = o.checklist;
      var tile = function (label, value, sub, small) { return h('div', { class: 'tile' + (small ? ' sm' : '') }, [h('span', { text: label }), h('b', { text: value }), sub ? h('small', { text: sub }) : null]); };
      var todo = [['published', 'یک برنامه را منتشر کنید', '#/apps'], ['files', 'فایل یک برنامه را بارگذاری کنید', '#/apps'], ['plans', 'برای یک برنامه اشتراک و قیمت بگذارید', '#/apps'], ['font', 'فونت وزیرمتن روی سرور باشد', '#/settings'], ['emailCode', 'ورود با کد ۶ رقمی ایمیل را روشن کنید', '#/security']];
      var left = todo.filter(function (x) { return !c[x[0]]; }).length;
      clear(main);
      add(main, [
        head('داشبورد', 'وضعیت سایت در یک نگاه.', h('a', { class: 'btn', href: siteUrl('/'), target: '_blank', rel: 'noopener', text: 'دیدن سایت' })),
        h('div', { class: 'tiles' }, [tile('دانلود امروز', num(t.downloadsToday)), tile('دانلود ۳۰ روز', num(t.downloads30), 'کل: ' + num(t.downloads)), tile('بازدید ۳۰ روز', num(t.views30)), tile('سفارش تازه', num(t.newOrders), t.newOrders ? 'منتظر پیگیری' : ''), tile('درآمد ثبت‌شده', money(t.revenue), num(t.paidOrders) + ' سفارش پرداخت‌شده', true), tile('اشتراک فعال', num(t.activeLicenses))]),
        o.attention.length ? h('div', { class: 'card', style: 'border-color:var(--warn)' }, [h('h2', { text: 'نیاز به توجه' }), h('ul', { class: 'list' }, o.attention.map(function (a) { return h('li', { class: 'row' }, [h('span', { class: 'badge warn', text: a.reason }), h('a', { href: '#/apps/' + a.appId + '/versions', text: a.app + ' — ' + a.file })]); }))]) : null,
        h('div', { class: 'grid2' }, [
          h('div', { class: 'card wide' }, [h('h2', null, ['دانلودهای ۳۰ روز گذشته']), chart(o.days)]),
          left ? h('div', { class: 'card' }, [h('h2', null, ['کارهای باقی‌مانده', h('small', { text: num(left) + ' مورد' })]), h('ul', { class: 'todo' }, todo.map(function (x) { return h('li', { class: c[x[0]] ? 'done' : '' }, [h('span', { class: 'dot', text: c[x[0]] ? '✓' : '' }), c[x[0]] ? x[1] : h('a', { href: x[2], text: x[1] })]); }))]) : null,
          h('div', { class: 'card' }, [h('h2', { text: 'سفارش‌های تازه' }), o.recentOrders.length ? h('ul', { class: 'list' }, o.recentOrders.map(function (r) { return h('li', { class: 'row between' }, [h('span', null, [h('b', { text: r.name }), ' — ', r.appName, '، ', r.planName]), h('span', { class: 'badge ' + (r.status === 'paid' ? 'ok' : r.status === 'new' ? 'warn' : ''), text: ORDER_STATUS[r.status] })]); })) : h('p', { class: 'mute', text: 'هنوز سفارشی ثبت نشده است.' }), h('a', { class: 'btn sm', href: '#/orders', style: 'margin-top:10px', text: 'همهٔ سفارش‌ها' })]),
          o.expiring.length ? h('div', { class: 'card' }, [h('h2', { text: 'اشتراک‌هایی که تا ۷ روز دیگر تمام می‌شوند' }), h('ul', { class: 'list' }, o.expiring.map(function (l) { return h('li', { class: 'row between' }, [h('span', null, [h('b', { text: l.customer }), ' — ', l.app]), h('span', { class: 'mute small', text: date(l.endAt) })]); }))]) : null,
          o.topApps.length ? h('div', { class: 'card' }, [h('h2', { text: 'پردانلودترین‌ها در ۳۰ روز' }), h('ul', { class: 'list' }, o.topApps.map(function (a) { return h('li', { class: 'row between' }, [h('span', { text: a.name }), h('b', { text: num(a.n) })]); }))]) : null,
        ]),
      ]);
    });
  };

  /* ───── برنامه‌ها ───── */
  var STATUS = { published: 'منتشرشده', soon: 'به‌زودی', draft: 'پیش‌نویس' };
  function appIcon(a) { return h('span', { class: 'app-ic', style: 'background:linear-gradient(140deg,' + a.color + ',#0b0d14)' }, a.icon ? h('img', { src: '/media/' + a.icon, alt: '' }) : mono(a.name)); }

  ROUTES.apps = function (p) {
    if (p[0]) return appEditor(p[0], p[1]);
    return api('GET', '/apps').then(function (r) {
      S.meta = Object.assign(S.meta || {}, r);
      var apps = r.apps;
      var move = function (i, d) { var j = i + d; if (j < 0 || j >= apps.length) return; var x = apps[i]; apps[i] = apps[j]; apps[j] = x; api('POST', '/apps/order', { ids: apps.map(function (a) { return a.id; }) }).then(render, fail); };
      var create = function () {
        var f = { name: '', slug: '' };
        modal('برنامهٔ تازه', h('div', { class: 'fields' }, [field('نام برنامه', inp(f, 'name', { required: true })), field('نشانی صفحه', inp(f, 'slug', { dir: 'ltr', placeholder: 'my-app' }), 'حروف انگلیسی کوچک و خط تیره. صفحهٔ برنامه با همین نشانی باز می‌شود: /app/my-app')]), function (close) {
          return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn main', type: 'button', text: 'ساختن', onclick: function () { api('POST', '/apps', { name: f.name, slug: f.slug, status: 'draft' }).then(function (x) { close(); location.hash = '#/apps/' + x.app.id; }, fail); } })];
        });
      };
      function render() {
        clear(main);
        add(main, [head('برنامه‌ها', 'هر برنامه صفحه، رنگ و صحنهٔ خودش را دارد. ترتیب این فهرست همان ترتیب نمایش در سایت است.', h('button', { class: 'btn main', type: 'button', text: 'برنامهٔ تازه', onclick: create }))]);
        if (!apps.length) return main.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'هنوز برنامه‌ای نیست' }), 'اولین برنامه را بسازید و فایلش را بارگذاری کنید.', h('br'), h('button', { class: 'btn main', type: 'button', text: 'برنامهٔ تازه', onclick: create })]));
        var samples = apps.filter(function (a) { return a.sample; }), fresh = apps.filter(function (a) { return a.untouched; });
        if (samples.length) main.appendChild(h('div', { class: 'card note' }, [
          h('h2', { text: num(samples.length) + ' برنامهٔ نمونه' }),
          h('p', { class: 'hint', text: 'این برنامه‌ها نمونه‌اند تا ببینید یک صفحهٔ کامل چه شکلی است. هر کدام را که واقعاً دارید «ویرایش» کنید (بعد از ذخیره دیگر نمونه نیست) و بقیه را حذف کنید. برای برنامه‌ای که این‌جا نیست، «برنامهٔ تازه» را بزنید.' }),
          fresh.length ? h('button', { class: 'btn danger', type: 'button', text: 'حذف ' + num(fresh.length) + ' نمونهٔ دست‌نخورده', onclick: function () {
            confirmBox('حذف برنامه‌های نمونه', num(fresh.length) + ' برنامهٔ نمونه‌ای که هنوز چیزی به آن‌ها اضافه نکرده‌اید پاک می‌شود. این کار برنمی‌گردد. بعد از آن، جدول و عددهای «صفحهٔ اصلی» را هم با برنامه‌های خودتان به‌روز کنید.', 'حذف نمونه‌ها', true).then(function (ok) {
              if (ok) api('POST', '/apps/clear-samples').then(function (r) { toast(num(r.removed) + ' برنامهٔ نمونه حذف شد'); route(); }, fail);
            });
          } }) : null,
        ]));
        var removeApp = function (a) {
          confirmBox('حذف «' + a.name + '»', 'برنامه با همهٔ نسخه‌ها و تصویرهایش پاک می‌شود. این کار برنمی‌گردد.', 'حذف برنامه', true).then(function (ok) {
            if (!ok) return;
            var go = function (force) { return api('DELETE', '/apps/' + a.id + (force ? '?force=1' : '')).then(function () { toast('حذف شد'); route(); }, function (e) { if (e.data && e.data.needsForce) return confirmBox('اشتراک فعال دارد', e.message, 'با این حال حذف کن', true).then(function (y) { if (y) return go(true); }); fail(e); }); };
            go(false);
          });
        };
        main.appendChild(h('ul', { class: 'list' }, apps.map(function (a, i) {
          return h('li', { class: 'item' }, [
            appIcon(a),
            h('div', { class: 'grow' }, [h('a', { href: '#/apps/' + a.id, style: 'text-decoration:none;color:inherit' }, h('b', { class: 't', text: a.name })), h('div', { class: 'meta' }, [h('span', { class: 'ltr', text: '/app/' + a.slug }), h('span', { text: a.latest ? 'آخرین نسخه ' + fa(a.latest) : 'بدون فایل' }), h('span', { text: num(a.versions) + ' نسخه' }), h('span', { text: num(a.plans) + ' اشتراک' }), h('span', { text: num(a.downloads) + ' دانلود' })])]),
            a.attention ? h('span', { class: 'badge warn', text: num(a.attention) + ' مورد نیاز به توجه' }) : null,
            a.sample ? h('span', { class: 'badge', text: 'نمونه' }) : null,
            a.featured ? h('span', { class: 'badge gold', text: 'ویژه' }) : null,
            h('span', { class: 'badge ' + (a.status === 'published' ? 'ok' : a.status === 'soon' ? 'warn' : ''), text: STATUS[a.status] }),
            h('button', { class: 'btn sm icon', type: 'button', title: 'بالا', 'aria-label': 'بالا بردن ' + a.name, disabled: i === 0, onclick: function () { move(i, -1); } }, ic('up')),
            h('button', { class: 'btn sm icon', type: 'button', title: 'پایین', 'aria-label': 'پایین بردن ' + a.name, disabled: i === apps.length - 1, onclick: function () { move(i, 1); } }, ic('down')),
            h('a', { class: 'btn sm', href: '#/apps/' + a.id, text: 'ویرایش' }),
            h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', 'aria-label': 'حذف ' + a.name, onclick: function () { removeApp(a); } }),
          ]);
        })));
      }
      render();
    });
  };

  // limitText: پیامی که وقتی فهرست به سقف رسید، به‌جای دکمهٔ افزودن دیده می‌شود
  function repeater(list, make, render, addLabel, max, limitText) {
    var box = h('div', { class: 'rep' });
    function draw() {
      clear(box);
      list.forEach(function (item, i) {
        var top = h('div', { class: 'rep-top' }, [h('span', { class: 'grow mute small', text: fa(i + 1) }),
          h('button', { class: 'btn sm icon', type: 'button', title: 'بالا', 'aria-label': 'بالا', disabled: i === 0, onclick: function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); touch(); draw(); } }, ic('up')),
          h('button', { class: 'btn sm icon', type: 'button', title: 'پایین', 'aria-label': 'پایین', disabled: i === list.length - 1, onclick: function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); touch(); draw(); } }, ic('down')),
          h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () { list.splice(i, 1); touch(); draw(); } })]);
        box.appendChild(h('div', { class: 'rep-item' }, [top, render(item, draw)]));
      });
      if (!max || list.length < max) box.appendChild(h('button', { class: 'btn', type: 'button', text: addLabel, onclick: function () { list.push(make()); touch(); draw(); } }));
      else if (limitText) box.appendChild(h('p', { class: 'small mute', text: limitText }));
    }
    draw();
    return box;
  }

  /* ───── انتخابگر نشانه (برای کادرها و ویژگی‌ها) ─────
     شکل نشانه‌ها از سرور می‌آید (همان‌هایی که سایت نشان می‌دهد)، پس این‌جا دوباره تعریف نمی‌شوند. */
  function pickSvg(key) {
    var m = S.meta && S.meta.icons && S.meta.icons[key];
    return h('span', { class: 'pi', html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (m ? m.svg : '') + '</svg>' });
  }
  var closePicker = null; // هم‌زمان فقط یک انتخابگر باز می‌ماند
  function iconPicker(obj, key, what) {
    var icons = (S.meta && S.meta.icons) || {}, keys = Object.keys(icons), pop = null;
    var btn = h('button', { class: 'ipick-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: function () { if (pop) shut(true); else show(); } });
    var wrap = h('span', { class: 'ipick' }, btn);
    function paint() {
      var m = icons[obj[key]];
      clear(btn).appendChild(m ? pickSvg(obj[key]) : ic('plus'));
      btn.classList.toggle('is-empty', !m);
      btn.title = m ? 'نشانه: ' + m.label : 'انتخاب نشانه';
      btn.setAttribute('aria-label', (what || 'نشانه') + ': ' + (m ? m.label : 'بدون نشانه') + '. برای تغییر بزنید');
    }
    function shut(refocus) {
      if (!pop) return;
      pop.remove(); pop = null;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      if (closePicker === shut) closePicker = null;
      if (refocus) btn.focus();
    }
    function outside(e) { if (!wrap.contains(e.target)) shut(false); }
    function show() {
      if (closePicker) closePicker(false);
      closePicker = shut;
      var name = h('span', { class: 'small mute', 'aria-hidden': 'true' });
      var opt = function (k, label) {
        var on = (obj[key] || '') === k;
        return h('button', { class: 'ipick-opt' + (on ? ' is-on' : ''), type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(on),
          onclick: function () { obj[key] = k; touch(); paint(); shut(true); }, onfocus: function () { name.textContent = label; }, onpointerenter: function () { name.textContent = label; } }, k ? pickSvg(k) : ic('x'));
      };
      var grid = h('div', { class: 'ipick-grid' }, [opt('', 'بدون نشانه')].concat(keys.map(function (k) { return opt(k, icons[k].label); })));
      pop = h('div', { class: 'ipick-pop', role: 'dialog', 'aria-label': 'انتخاب نشانه', onkeydown: onKey,
        onfocusout: function (e) { if (pop && e.relatedTarget && !wrap.contains(e.relatedTarget)) shut(false); } }, [h('div', { class: 'ipick-head' }, [h('b', { text: 'انتخاب نشانه' }), name]), grid]);
      wrap.appendChild(pop);
      btn.setAttribute('aria-expanded', 'true');
      // اگر از لبهٔ صفحه بیرون بزند (موبایل)، به داخل کشیده می‌شود
      var r = pop.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      if (r.left < 8) pop.style.transform = 'translateX(' + Math.round(8 - r.left) + 'px)';
      else if (r.right > vw - 8) pop.style.transform = 'translateX(' + Math.round(vw - 8 - r.right) + 'px)';
      document.addEventListener('pointerdown', outside, true);
      (grid.querySelector('.is-on') || grid.firstChild).focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(true); return; }
      var all = Array.prototype.slice.call(pop.querySelectorAll('.ipick-opt')), i = all.indexOf(document.activeElement), cols = 1;
      if (i < 0 || !/^Arrow/.test(e.key)) return;
      while (cols < all.length && all[cols].offsetTop === all[0].offsetTop) cols++;
      // صفحه راست‌به‌چپ است: فلش چپ یعنی خانهٔ بعدی
      var j = e.key === 'ArrowLeft' ? i + 1 : e.key === 'ArrowRight' ? i - 1 : e.key === 'ArrowDown' ? i + cols : i - cols;
      if (j >= 0 && j < all.length) { e.preventDefault(); all[j].focus(); }
    }
    paint();
    return wrap;
  }
  function iconField(obj, key, what) { return h('div', { class: 'field ipick-field' }, [h('span', { class: 'lab', 'aria-hidden': 'true', text: 'نشانه' }), iconPicker(obj, key, what)]); }

  /* ───── برچسب‌های کوتاه ───── */
  function chips(list, max, maxLen, placeholder) {
    var box = h('div', { class: 'chips', role: 'group', 'aria-label': 'برچسب‌ها' });
    var push = function (t) { t = String(t).trim().slice(0, maxLen); if (t && list.indexOf(t) < 0 && list.length < max) { list.push(t); touch(); } };
    function draw(focus, rest) {
      clear(box);
      list.forEach(function (t, i) {
        box.appendChild(h('span', { class: 'chip' }, [h('span', { text: t }), h('button', { class: 'chip-x', type: 'button', title: 'حذف', 'aria-label': 'حذف برچسب ' + t, onclick: function () { list.splice(i, 1); touch(); draw(true); } }, ic('x'))]));
      });
      if (list.length >= max) { box.appendChild(h('span', { class: 'small mute', text: 'حداکثر ' + fa(max) + ' برچسب.' })); return; }
      var commit = function (again) { if (!input.value.trim()) return false; push(input.value); draw(again); return true; };
      var input = h('input', { type: 'text', class: 'chip-in', maxlength: maxLen + 2, placeholder: placeholder, 'aria-label': 'برچسب تازه', value: rest || '',
        onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); touch(); draw(true); } },
        // ویرگول هم برچسب را می‌بندد (از رویداد input، چون صفحه‌کلید موبایل کلید را جدا خبر نمی‌دهد)
        oninput: function () { if (!/[،,]/.test(input.value)) return; var parts = input.value.split(/[،,]/), tail = parts.pop(); parts.forEach(push); draw(true, tail.replace(/^\s+/, '')); },
        // نوشته‌ای که هنوز «افزودن» نخورده با رفتن از این خانه هم ثبت می‌شود تا هنگام ذخیره گم نشود
        onblur: function () { setTimeout(function () { if (box.contains(input) && input.value.trim() && !box.contains(document.activeElement)) commit(false); }, 0); } });
      add(box, [input, h('button', { class: 'btn sm', type: 'button', text: 'افزودن', onclick: function () { if (!commit(true)) input.focus(); } })]);
      if (focus) input.focus();
    }
    draw(false);
    return box;
  }

  /* ───── بخش‌های صفحه: ویرایشگر مشترکِ صفحهٔ برنامه، صفحهٔ اصلی و صفحه‌های دلخواه ───── */
  var BLOCKS = {
    text: ['<path d="M5 6h14M5 10h14M5 14h9M5 18h12"/>', 'یک عنوان و چند بند نوشته؛ برای معرفی، توضیح یا هر متن آزاد.'],
    cards: ['<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/>', 'چند کادر کنار هم با نشانه، عنوان و توضیح کوتاه؛ برای ویژگی‌ها و مزیت‌ها.'],
    table: ['<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 14.8h18M9.5 4v16"/>', 'جدول با سرستون و ردیف؛ برای مقایسهٔ نسخه‌ها، قیمت‌ها یا مشخصات.'],
    stats: ['<path d="M5 20V11M12 20V4M19 20v-6"/>', 'چند عدد بزرگ با یک توضیح کوتاه؛ مثل «۵۰۰+ مشتری».'],
    steps: ['<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M6 8.5v7M12 6h8M12 18h8"/>', 'گام‌های شماره‌دارِ پشت‌سرهم؛ برای آموزش نصب یا روش کار.'],
    image: ['<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/>', 'یک تصویر با متنی در کنارش، یا تصویر تمام‌عرض.'],
    video: ['<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9.2 5 2.8-5 2.8z"/>', 'یک ویدیوی کوتاه از برنامه (فایل MP4 یا WebM) با تصویر پیش‌نمایش.'],
    quote: ['<path d="M10 7H7a2 2 0 0 0-2 2v3h4v2a3 3 0 0 1-3 3M19 7h-3a2 2 0 0 0-2 2v3h4v2a3 3 0 0 1-3 3"/>', 'یک جملهٔ برجسته؛ نظر مشتری یا نکته‌ای که باید دیده شود.'],
    reviews: ['<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>', 'چند نظر واقعی از مشتری‌ها، کنار هم.'],
    cta: ['<rect x="3" y="7.5" width="18" height="9" rx="4.5"/><path d="M15 12H9m0 0 2.5-2.5M9 12l2.5 2.5"/>', 'یک پیام کوتاه با دکمه؛ برای دانلود، تماس یا سفارش.'],
    faq: ['<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 17h.01"/>', 'پرسش‌های پرتکرار که با زدن روی هر کدام، پاسخش باز می‌شود.'],
  };
  function bicon(type) { return h('span', { class: 'blk-ic', html: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ((BLOCKS[type] || [''])[0]) + '</svg>' }); }
  function newId() { var s = 'b', c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 9; i++) s += c.charAt(Math.floor(Math.random() * 36)); return s; }
  function idMap(blocks) { var m = {}; (blocks || []).forEach(function (b) { if (b && b.id) m[b.id] = 1; }); return m; }
  function tx(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function snip(v) { var t = tx(v).replace(/\s+/g, ' '); return t.length > 70 ? t.slice(0, 70) + '…' : t; }
  function hrefOk(v) { return /^(\/|#|https?:\/\/|tel:|mailto:)/i.test(tx(v)); }
  function filled(items, keys) { return (Array.isArray(items) ? items : []).filter(function (x) { return x && keys.every(function (k) { return tx(x[k]); }); }).length; }

  function newBlock(type) {
    var b = { id: newId(), type: type, title: '', intro: '' };
    if (type === 'text') { b.body = ''; b.align = 'start'; }
    else if (type === 'cards') { b.layout = 'bento'; b.items = [1, 2, 3].map(function () { return { icon: '', title: '', text: '' }; }); }
    else if (type === 'table') { b.head = ['', '', '']; b.rows = [['', '', ''], ['', '', '']]; b.firstCol = true; b.note = ''; }
    else if (type === 'stats') b.items = [1, 2, 3].map(function () { return { value: '', label: '' }; });
    else if (type === 'steps') b.items = [1, 2, 3].map(function () { return { title: '', text: '' }; });
    else if (type === 'image') { b.image = null; b.alt = ''; b.text = ''; b.side = 'start'; }
    else if (type === 'video') { b.video = null; b.poster = null; b.caption = ''; }
    else if (type === 'quote') { b.text = ''; b.by = ''; b.role = ''; }
    else if (type === 'reviews') b.items = [1, 2, 3].map(function () { return { text: '', by: '', role: '' }; });
    else if (type === 'cta') { b.text = ''; b.label = ''; b.href = ''; }
    else if (type === 'faq') b.items = [1, 2].map(function () { return { q: '', a: '' }; });
    return b;
  }
  // همان قاعدهٔ سرور: بخشی که چیزی برای نمایش ندارد ذخیره نمی‌شود (این‌جا فقط برای هشدار دادن پیش از ذخیره)
  function blockEmpty(b) {
    switch (b.type) {
      case 'text': return !tx(b.title) && !tx(b.body);
      case 'cards': case 'steps': return !filled(b.items, ['title']);
      case 'table': return !(b.head || []).some(tx) && !(b.rows || []).some(function (r) { return (r || []).some(tx); });
      case 'stats': return !filled(b.items, ['value', 'label']);
      case 'image': return !b.image && !tx(b.title) && !tx(b.text) && !tx(b.alt);
      case 'video': return !b.video && !b.poster && !tx(b.title) && !tx(b.caption);
      case 'quote': return !tx(b.text);
      case 'reviews': return !filled(b.items, ['text']);
      case 'cta': return !tx(b.title) && !tx(b.text) && !(tx(b.label) && hrefOk(b.href));
      case 'faq': return !filled(b.items, ['q', 'a']);
    }
    return false;
  }
  function blockSummary(b) {
    switch (b.type) {
      case 'text': return snip(b.body);
      case 'cards': return fa(filled(b.items, ['title'])) + ' کادر';
      case 'table': return fa((b.head || []).length) + ' ستون، ' + fa((b.rows || []).filter(function (r) { return (r || []).some(tx); }).length) + ' ردیف';
      case 'stats': return (b.items || []).map(function (x) { return tx(x.value); }).filter(Boolean).join(' · ');
      case 'steps': return fa(filled(b.items, ['title'])) + ' مرحله';
      case 'image': return (b.image ? 'با تصویر' : 'بدون تصویر') + (tx(b.text) ? ' — ' + snip(b.text) : '');
      case 'video': return (b.video ? 'با ویدیو' : 'بدون ویدیو — در سایت دیده نمی‌شود') + (tx(b.caption) ? ' — ' + snip(b.caption) : '');
      case 'quote': return snip(b.text);
      case 'reviews': return fa(filled(b.items, ['text'])) + ' نظر';
      case 'cta': return snip(b.label || b.text);
      case 'faq': return fa(filled(b.items, ['q', 'a'])) + ' پرسش';
    }
    return '';
  }
  // سرور بخش خالی را نگه نمی‌دارد؛ اگر چیزی کنار گذاشته شد، مالک باید بداند
  function dropped(sent, kept) { if (kept < sent) toast(fa(sent - kept) + ' بخشِ خالی ذخیره نشد. بخشی که هیچ نوشته‌ای ندارد در سایت جایی نمی‌گیرد.', true); }

  /* جدول: خانه‌ها فقط ورودی‌اند تا Tab خانه‌به‌خانه جلو برود؛ کارهای ردیف و ستون روی «خانهٔ انتخاب‌شده» انجام می‌شود. */
  function tableEditor(b) {
    var MAXC = 8, MAXR = 40;
    var s = function (v) { return v === null || v === undefined ? '' : String(v); };
    if (!Array.isArray(b.head) || !b.head.length) b.head = ['', '', ''];
    b.head = b.head.slice(0, MAXC).map(s);
    b.rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, MAXR).map(function (r) { r = Array.isArray(r) ? r : []; return b.head.map(function (_, i) { return s(r[i]); }); });
    var wrap = h('div', { class: 'tbl' }), cur = null, inputs = {}, selBar = h('div', { class: 'tbl-bar', hidden: true }), status = h('p', { class: 'small mute', role: 'status' });
    var key = function (r, c) { return r + ':' + c; };
    function focusCell(r, c) { var el = inputs[key(r, c)]; if (el) { el.focus(); if (el.select) el.select(); } }
    function addRow() { if (b.rows.length >= MAXR) return false; b.rows.push(b.head.map(function () { return ''; })); touch(); return true; }
    function addCol() { if (b.head.length >= MAXC) return false; b.head.push(''); b.rows.forEach(function (r) { r.push(''); }); touch(); return true; }
    function delRow(r) { if (r < 0 || r >= b.rows.length) return; b.rows.splice(r, 1); touch(); cur = b.rows.length ? { r: Math.min(r, b.rows.length - 1), c: cur ? cur.c : 0 } : { r: -1, c: cur ? cur.c : 0 }; draw(true); }
    function delCol(c) { if (b.head.length < 2) return; b.head.splice(c, 1); b.rows.forEach(function (r) { r.splice(c, 1); }); touch(); cur = { r: cur ? cur.r : -1, c: Math.min(c, b.head.length - 1) }; draw(true); }
    function moveRow(d) { var r = cur.r, j = r + d; if (r < 0 || j < 0 || j >= b.rows.length) return; b.rows.splice(j, 0, b.rows.splice(r, 1)[0]); touch(); cur.r = j; draw(true); }
    function moveCol(d) { var c = cur.c, j = c + d; if (j < 0 || j >= b.head.length) return; var mv = function (a) { a.splice(j, 0, a.splice(c, 1)[0]); }; mv(b.head); b.rows.forEach(mv); touch(); cur.c = j; draw(true); }
    // چسباندن از اکسل یا ورد: چند خانه یک‌جا پر می‌شود
    function paste(e, r0, c0) {
      var t = (e.clipboardData || window.clipboardData).getData('text');
      if (!t || !/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return;
      e.preventDefault();
      var lines = t.replace(/\r/g, '').replace(/\n$/, '').split('\n'), cut = false;
      lines.forEach(function (line, i) {
        var r = r0 + i;
        if (r >= MAXR) { cut = true; return; }
        while (r >= b.rows.length) b.rows.push(b.head.map(function () { return ''; }));
        line.split('\t').forEach(function (v, k) {
          var c = c0 + k;
          if (c >= MAXC) { cut = true; return; }
          while (c >= b.head.length) { b.head.push(''); b.rows.forEach(function (row) { row.push(''); }); }
          v = v.trim().slice(0, r < 0 ? 60 : 160);
          if (r < 0) b.head[c] = v; else b.rows[r][c] = v;
        });
      });
      touch(); cur = { r: r0, c: c0 }; draw(true);
      if (cut) toast('جدول حداکثر ۸ ستون و ۴۰ ردیف دارد؛ بقیهٔ نوشته جا نشد.', true);
    }
    function cell(r, c) {
      var head = r < 0;
      var el = h('input', { type: 'text', class: head ? 'tbl-h' : '', maxlength: head ? 60 : 160, value: head ? b.head[c] : b.rows[r][c],
        placeholder: head ? 'سرستون ' + fa(c + 1) : '', 'aria-label': head ? 'سرستون ' + fa(c + 1) : 'ردیف ' + fa(r + 1) + '، ستون ' + fa(c + 1),
        oninput: function (e) { if (head) b.head[c] = e.target.value; else b.rows[r][c] = e.target.value; touch(); },
        onfocus: function () { cur = { r: r, c: c }; paintSel(); },
        onpaste: function (e) { paste(e, r, c); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (r + 1 >= b.rows.length) { if (e.key !== 'Enter' || !addRow()) return; cur = { r: r + 1, c: c }; draw(true); } else focusCell(r + 1, c);
          } else if (e.key === 'ArrowUp' && r >= 0) { e.preventDefault(); focusCell(r - 1, c); }
        } });
      inputs[key(r, c)] = el;
      return el;
    }
    function tool(label, icon, fn, off) { return h('button', { class: 'btn sm' + (icon ? ' icon' : ' danger'), type: 'button', title: label, 'aria-label': label, disabled: off, onclick: fn }, icon ? ic(icon) : label); }
    function markBtn(ch, label) { return h('button', { class: 'btn sm tbl-mark', type: 'button', title: label, 'aria-label': label, text: ch, onclick: function () { mark(ch); } }); }
    function paintSel() {
      clear(selBar); selBar.hidden = !cur;
      if (!cur) return;
      var r = cur.r, c = cur.c, n = b.rows.length, m = b.head.length;
      add(selBar, [
        h('span', { class: 'small mute', text: 'خانهٔ انتخاب‌شده: ' + (r < 0 ? 'سرستون' : 'ردیف ' + fa(r + 1)) + '، ستون ' + fa(c + 1) }),
        r < 0 ? null : h('span', { class: 'tbl-grp' }, [h('span', { class: 'small', text: 'ردیف' }), tool('بردن ردیف به بالا', 'up', function () { moveRow(-1); }, r === 0), tool('بردن ردیف به پایین', 'down', function () { moveRow(1); }, r === n - 1), tool('حذف ردیف', null, function () { delRow(cur.r); })]),
        h('span', { class: 'tbl-grp' }, [h('span', { class: 'small', text: 'ستون' }), tool('بردن ستون به راست', 'right', function () { moveCol(-1); }, c === 0), tool('بردن ستون به چپ', 'left', function () { moveCol(1); }, c === m - 1), tool('حذف ستون', null, function () { delCol(cur.c); }, m < 2)]),
      ]);
    }
    function mark(ch) {
      if (!cur || cur.r < 0) return toast('اول روی یکی از خانه‌های جدول بزنید، بعد ' + ch + ' را بگذارید.', true);
      b.rows[cur.r][cur.c] = ch; touch();
      var el = inputs[key(cur.r, cur.c)]; if (el) { el.value = ch; el.focus(); }
    }
    function draw(refocus) {
      inputs = {};
      var cols = b.head.length, rows = b.rows.length;
      if (cur && (cur.c >= cols || cur.r >= rows)) cur = null;
      var x = function (label, fn) { return h('button', { class: 'tbl-x', type: 'button', tabindex: '-1', title: label, 'aria-label': label, onclick: fn }, ic('x')); };
      var table = h('table', { class: 'tbl-grid' }, [
        h('thead', null, [
          h('tr', { class: 'tbl-cx' }, [h('td')].concat(b.head.map(function (_, c) { return h('td', null, cols > 1 ? x('حذف ستون ' + fa(c + 1), function () { delCol(c); }) : null); }), [h('td')])),
          h('tr', null, [h('td', { class: 'tbl-n' })].concat(b.head.map(function (_, c) { return h('th', { scope: 'col' }, cell(-1, c)); }), [h('td')])),
        ]),
        h('tbody', null, b.rows.map(function (_, r) {
          return h('tr', null, [h('td', { class: 'tbl-n', text: fa(r + 1) })].concat(b.head.map(function (_x, c) { return h('td', { class: c === 0 && b.firstCol ? 'tbl-first' : '' }, cell(r, c)); }), [h('td', null, x('حذف ردیف ' + fa(r + 1), function () { delRow(r); }))]));
        })),
      ]);
      status.textContent = fa(cols) + ' ستون از ' + fa(MAXC) + ' · ' + fa(rows) + ' ردیف از ' + fa(MAXR) + (cols >= MAXC ? ' — به سقف ۸ ستون رسیده‌اید.' : '') + (rows >= MAXR ? ' — به سقف ۴۰ ردیف رسیده‌اید.' : '');
      clear(wrap);
      add(wrap, [
        h('div', { class: 'tbl-scroll', role: 'group', 'aria-label': 'خانه‌های جدول' }, table),
        h('div', { class: 'tbl-bar' }, [
          h('button', { class: 'btn sm', type: 'button', disabled: rows >= MAXR, onclick: function () { if (addRow()) { cur = { r: b.rows.length - 1, c: cur ? cur.c : 0 }; draw(true); } } }, [ic('plus'), 'افزودن ردیف']),
          h('button', { class: 'btn sm', type: 'button', disabled: cols >= MAXC, onclick: function () { if (addCol()) { cur = { r: -1, c: b.head.length - 1 }; draw(true); } /* سرستونِ تازه آمادهٔ نوشتن است */ } }, [ic('plus'), 'افزودن ستون']),
          h('span', { class: 'tbl-grp' }, [h('span', { class: 'small', text: 'گذاشتن در خانه' }), markBtn('✓', 'گذاشتن تیک (✓) در خانهٔ انتخاب‌شده'), markBtn('✗', 'گذاشتن ضربدر (✗) در خانهٔ انتخاب‌شده')]),
        ]),
        selBar, status,
      ]);
      paintSel();
      if (refocus && cur) focusCell(cur.r, cur.c);
    }
    draw(false);
    return { el: wrap, redraw: function () { draw(false); } };
  }

  // opt: { get(): آرایهٔ بخش‌ها ، max ، base: مسیر API صاحب بخش‌ها ، isSaved(id) ، save(): Promise<boolean> ، redraw() ، alt }
  function blockEditor(opt) {
    var box = h('div', { class: 'blks' }), adding = false;
    var open = S.blockOpen || (S.blockOpen = {});
    var types = (S.meta && S.meta.blockTypes) || {};
    var list = function () { return opt.get(); };

    function imageBox(b) {
      var box2 = h('div', { class: 'imgbox' }), busy = false;
      function upload(file) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('فقط تصویر PNG، JPG، WebP یا GIF پذیرفته می‌شود', true);
        if (file.size > 6 * 1024 * 1024) return toast('تصویر باید کمتر از ۶ مگابایت باشد', true);
        var id = b.id, first;
        busy = true; paint();
        if (opt.isSaved(id)) first = Promise.resolve(true);
        else {
          // بخشِ تازه اول باید روی سرور ساخته شود؛ متن جایگزین نمی‌گذارد سرور آن را «خالی» حساب کند
          if (blockEmpty(b)) b.alt = opt.alt ? 'تصویر ' + opt.alt : 'تصویر';
          first = opt.save();
        }
        first.then(function (ok) {
          if (!ok) return null;
          if (!opt.isSaved(id)) { toast('این بخش ذخیره نشد؛ تصویر بارگذاری نشد.', true); return null; }
          return api('PUT', opt.base + '/blocks/' + id + '/image', file, true);
        }).then(function (r) {
          busy = false;
          var now = list().filter(function (x) { return x.id === id; })[0];
          if (r && now) { now.image = r.image; delete now.imageFrom; toast('تصویر ذخیره شد'); }
          opt.redraw();
        }, function (e) { busy = false; fail(e); opt.redraw(); });
      }
      function remove() {
        // تصویرِ بخشی که هنوز ذخیره نشده (کپیِ یک بخش دیگر) فقط از همین فرم برداشته می‌شود
        if (!opt.isSaved(b.id)) { b.image = null; delete b.imageFrom; touch(); return paint(); }
        busy = true; paint();
        api('DELETE', opt.base + '/blocks/' + b.id + '/image').then(function () { busy = false; b.image = null; toast('تصویر برداشته شد'); paint(); }, function (e) { busy = false; fail(e); paint(); });
      }
      function paint() {
        clear(box2);
        var pick = function () { var i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onchange: function () { if (i.files[0]) upload(i.files[0]); } }); i.click(); };
        add(box2, [
          b.image ? h('img', { src: '/media/' + b.image.file, alt: tx(b.alt) || 'تصویر این بخش', loading: 'lazy' }) : h('div', { class: 'imgbox-none' }, [ic('img'), h('span', { text: 'هنوز تصویری نیست' })]),
          h('div', { class: 'imgbox-side' }, [
            h('div', { class: 'row' }, [
              h('button', { class: 'btn' + (b.image ? '' : ' main'), type: 'button', 'data-f': 'img', disabled: busy, text: busy ? 'در حال بارگذاری…' : b.image ? 'عوض کردن تصویر' : 'گذاشتن تصویر', onclick: pick }),
              b.image ? h('button', { class: 'btn danger', type: 'button', disabled: busy, text: 'برداشتن تصویر', onclick: remove }) : null,
            ]),
            h('small', { class: 'mute', text: 'PNG، JPG، WebP یا GIF، تا ۶ مگابایت.' }),
            opt.isSaved(b.id) ? null : h('small', { class: 'warn-note', text: 'این بخش هنوز ذخیره نشده است. با انتخاب تصویر، اول همهٔ تغییرهای این صفحه ذخیره می‌شود و بعد تصویر بارگذاری می‌شود.' }),
          ]),
        ]);
      }
      paint();
      return box2;
    }

    // بارگذاری ویدیو و تصویر پیش‌نمایشِ بخش «ویدیو» (همان روال تصویر: بخش اول ذخیره می‌شود، بعد فایل می‌رود)
    function fileBox(b, c) {
      var box2 = h('div', { class: 'imgbox' }), busy = false;
      function upload(file) {
        if (!c.type.test(file.type)) return toast(c.badType, true);
        if (file.size > c.max) return toast(c.tooBig, true);
        var id = b.id, first;
        busy = true; paint();
        if (opt.isSaved(id)) first = Promise.resolve(true);
        else { if (blockEmpty(b)) b.title = opt.alt ? 'ویدیوی ' + opt.alt : 'ویدیو'; first = opt.save(); }
        first.then(function (ok) {
          if (!ok) return null;
          if (!opt.isSaved(id)) { toast('این بخش ذخیره نشد؛ فایل بارگذاری نشد.', true); return null; }
          return api('PUT', opt.base + '/blocks/' + id + '/' + c.key, file, true);
        }).then(function (r) {
          busy = false;
          var now = list().filter(function (x) { return x.id === id; })[0];
          if (r && now) { now[c.key] = r[c.key]; delete now[c.key + 'From']; toast(c.saved); }
          opt.redraw();
        }, function (e) { busy = false; fail(e); opt.redraw(); });
      }
      function remove() {
        if (!opt.isSaved(b.id)) { b[c.key] = null; delete b[c.key + 'From']; touch(); return paint(); }
        busy = true; paint();
        api('DELETE', opt.base + '/blocks/' + b.id + '/' + c.key).then(function () { busy = false; b[c.key] = null; toast(c.removed); paint(); }, function (e) { busy = false; fail(e); paint(); });
      }
      function paint() {
        clear(box2);
        var has = b[c.key];
        var pick = function () { var i = h('input', { type: 'file', accept: c.accept, onchange: function () { if (i.files[0]) upload(i.files[0]); } }); i.click(); };
        add(box2, [
          has ? c.preview(has) : h('div', { class: 'imgbox-none' }, [ic('img'), h('span', { text: c.none })]),
          h('div', { class: 'imgbox-side' }, [
            h('div', { class: 'row' }, [
              h('button', { class: 'btn' + (has ? '' : ' main'), type: 'button', 'data-f': c.key, disabled: busy, text: busy ? 'در حال بارگذاری…' : has ? c.change : c.put, onclick: pick }),
              has ? h('button', { class: 'btn danger', type: 'button', disabled: busy, text: c.take, onclick: remove }) : null,
            ]),
            h('small', { class: 'mute', text: c.hint + (has && has.size ? ' حجم این فایل: ' + bytes(has.size) + '.' : '') }),
            opt.isSaved(b.id) ? null : h('small', { class: 'warn-note', text: 'این بخش هنوز ذخیره نشده است. با انتخاب فایل، اول همهٔ تغییرهای این صفحه ذخیره می‌شود و بعد فایل بارگذاری می‌شود.' }),
          ]),
        ]);
      }
      paint();
      return box2;
    }
    var vmax = (S.meta && S.meta.videoMaxMB) || 60;
    var VIDEO_BOX = { key: 'video', type: /^video\/(mp4|webm)$/, accept: 'video/mp4,video/webm', max: vmax * 1048576, badType: 'فقط ویدیوی MP4 یا WebM پذیرفته می‌شود', tooBig: 'ویدیو باید کمتر از ' + fa(vmax) + ' مگابایت باشد', saved: 'ویدیو ذخیره شد', removed: 'ویدیو برداشته شد', none: 'هنوز ویدیویی نیست', put: 'گذاشتن ویدیو', change: 'عوض کردن ویدیو', take: 'برداشتن ویدیو', hint: 'MP4 یا WebM، تا ' + fa(vmax) + ' مگابایت. ویدیوی کوتاه (زیر یک دقیقه) بهتر دیده می‌شود.',
      preview: function (v) { return h('video', { src: '/media/' + v.file, controls: true, preload: 'metadata', playsinline: true }); } };
    var POSTER_BOX = { key: 'poster', type: /^image\/(png|jpeg|webp|gif)$/, accept: 'image/png,image/jpeg,image/webp,image/gif', max: 6 * 1048576, badType: 'فقط تصویر PNG، JPG، WebP یا GIF پذیرفته می‌شود', tooBig: 'تصویر باید کمتر از ۶ مگابایت باشد', saved: 'تصویر پیش‌نمایش ذخیره شد', removed: 'تصویر پیش‌نمایش برداشته شد', none: 'بدون تصویر پیش‌نمایش', put: 'گذاشتن تصویر پیش‌نمایش', change: 'عوض کردن تصویر', take: 'برداشتن تصویر', hint: 'تصویری که پیش از پخش دیده می‌شود (اختیاری). PNG، JPG یا WebP تا ۶ مگابایت.',
      preview: function (im) { return h('img', { src: '/media/' + im.file, alt: 'تصویر پیش‌نمایش ویدیو', loading: 'lazy' }); } };

    var sub = function (t) { return h('p', { class: 'blk-sub', text: t }); };
    var forms = {
      text: function (b) {
        if (!b.align) b.align = 'start';
        return h('div', { class: 'fields c2' }, [
          field('عنوان', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'),
          field('چینش متن', sel(b, 'align', { start: 'راست‌چین', center: 'وسط‌چین' })),
          field('متن', area(b, 'body', { rows: 7, maxlength: 6000 }), 'با یک خط خالی، بند تازه شروع می‌شود. خط‌هایی که با «- » شروع شوند فهرست نقطه‌ای می‌شوند.', 'full'),
        ]);
      },
      cards: function (b) {
        if (!Array.isArray(b.items)) b.items = [];
        if (!b.layout) b.layout = 'bento';
        return [h('div', { class: 'fields c2' }, [
          field('عنوان بخش', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'),
          field('چیدمان', sel(b, 'layout', { bento: 'موزاییکی (کادرها با اندازه‌های گوناگون)', grid: 'شبکهٔ ساده (کادرهای هم‌اندازه)' })),
          field('توضیح زیر عنوان', inp(b, 'intro', { maxlength: 400 }), 'اختیاری.', 'full'),
        ]), sub('کادرها'),
        repeater(b.items, function () { return { icon: '', title: '', text: '' }; }, function (x) {
          return h('div', { class: 'with-icon' }, [iconField(x, 'icon', 'نشانهٔ کادر'), h('div', { class: 'fields c2' }, [field('عنوان کادر', inp(x, 'title', { maxlength: 80 })), field('توضیح', area(x, 'text', { rows: 2, maxlength: 300 }))])]);
        }, 'افزودن کادر', 12, 'هر بخش حداکثر ۱۲ کادر دارد.')];
      },
      table: function (b) {
        var t = tableEditor(b);
        return [h('div', { class: 'fields c2' }, [
          field('عنوان جدول', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'),
          field('توضیح زیر عنوان', inp(b, 'intro', { maxlength: 400 }), 'اختیاری.'),
        ]), sub('خانه‌های جدول'), t.el,
        h('p', { class: 'small mute', text: 'با Tab خانه‌به‌خانه جلو بروید و با Enter به ردیف بعد. نوشتن ✓ یا ✗ در یک خانه، در سایت نشانهٔ تیک یا ضربدر نشان می‌دهد. جدولِ کپی‌شده از اکسل را می‌توانید یک‌جا در خانهٔ اول بچسبانید.' }),
        h('div', { class: 'fields c2' }, [
          h('div', { class: 'field' }, chk(b, 'firstCol', 'ستون اول، عنوانِ ردیف‌هاست (پررنگ نمایش داده می‌شود)', t.redraw)),
          field('یادداشت زیر جدول', inp(b, 'note', { maxlength: 300 }), 'اختیاری؛ مثل «قیمت‌ها به افغانی است».'),
        ])];
      },
      stats: function (b) {
        if (!Array.isArray(b.items)) b.items = [];
        return [h('div', { class: 'fields c2' }, [field('عنوان بخش', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'), field('توضیح زیر عنوان', inp(b, 'intro', { maxlength: 400 }), 'اختیاری.')]), sub('عددها'),
          repeater(b.items, function () { return { value: '', label: '' }; }, function (x) { return h('div', { class: 'fields c2' }, [field('عدد', inp(x, 'value', { maxlength: 16, placeholder: 'مثل ۵۰۰+ یا ۹۹٪' })), field('توضیح عدد', inp(x, 'label', { maxlength: 60, placeholder: 'مثل: مشتری فعال' }))]); }, 'افزودن عدد', 6, 'هر بخش حداکثر ۶ عدد دارد.')];
      },
      steps: function (b) {
        if (!Array.isArray(b.items)) b.items = [];
        return [h('div', { class: 'fields c2' }, [field('عنوان بخش', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'), field('توضیح زیر عنوان', inp(b, 'intro', { maxlength: 400 }), 'اختیاری.')]), sub('مرحله‌ها (به همین ترتیب شماره می‌خورند)'),
          repeater(b.items, function () { return { title: '', text: '' }; }, function (x) { return h('div', { class: 'fields c2' }, [field('عنوان مرحله', inp(x, 'title', { maxlength: 80 })), field('توضیح', area(x, 'text', { rows: 2, maxlength: 300 }))]); }, 'افزودن مرحله', 8, 'هر بخش حداکثر ۸ مرحله دارد.')];
      },
      image: function (b) {
        if (!b.side) b.side = 'start';
        return [imageBox(b), h('div', { class: 'fields c2' }, [
          field('عنوان', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'),
          field('جای تصویر', sel(b, 'side', { start: 'تصویر در سمت راست، متن کنارش', end: 'تصویر در سمت چپ، متن کنارش', full: 'تصویر تمام‌عرض، متن زیر آن' })),
          field('توضیح تصویر (متن جایگزین)', inp(b, 'alt', { maxlength: 140 }), 'یک جمله که بگوید در تصویر چه دیده می‌شود؛ برای نابینایان و موتورهای جست‌وجو.', 'full'),
          field('متن کنار تصویر', area(b, 'text', { rows: 5, maxlength: 1200 }), 'با یک خط خالی، بند تازه شروع می‌شود.', 'full'),
        ])];
      },
      video: function (b) {
        return [sub('ویدیو'), fileBox(b, VIDEO_BOX), sub('تصویر پیش‌نمایش'), fileBox(b, POSTER_BOX), h('div', { class: 'fields c2' }, [
          field('عنوان بخش', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'),
          field('توضیح زیر عنوان', inp(b, 'intro', { maxlength: 400 }), 'اختیاری.'),
          field('زیرنویس ویدیو', inp(b, 'caption', { maxlength: 200 }), 'یک جمله که بگوید ویدیو چه چیزی را نشان می‌دهد.', 'full'),
        ])];
      },
      reviews: function (b) {
        if (!Array.isArray(b.items)) b.items = [];
        return [h('div', { class: 'fields c2' }, [field('عنوان بخش', inp(b, 'title', { maxlength: 120 }), 'اختیاری؛ مثل «مشتری‌ها چه می‌گویند».'), field('توضیح زیر عنوان', inp(b, 'intro', { maxlength: 400 }), 'اختیاری.')]),
          h('small', { class: 'warn-note', text: 'فقط نظر واقعی مشتری‌ها را بنویسید؛ نظر ساختگی اعتماد را از بین می‌برد.' }), sub('نظرها'),
          repeater(b.items, function () { return { text: '', by: '', role: '' }; }, function (x) { return h('div', { class: 'fields c2' }, [field('نظر', area(x, 'text', { rows: 3, maxlength: 600 }), null, 'full'), field('نام مشتری', inp(x, 'by', { maxlength: 60 })), field('کار یا شهر', inp(x, 'role', { maxlength: 80 }), 'اختیاری.')]); }, 'افزودن نظر', 12, 'هر بخش حداکثر ۱۲ نظر دارد.')];
      },
      quote: function (b) {
        return h('div', { class: 'fields c2' }, [
          field('متن نقل‌قول یا نکته', area(b, 'text', { rows: 4, maxlength: 600 }), null, 'full'),
          field('از چه کسی', inp(b, 'by', { maxlength: 80 }), 'اختیاری؛ برای نکته خالی بگذارید.'),
          field('کار یا شهر', inp(b, 'role', { maxlength: 80 }), 'اختیاری.'),
        ]);
      },
      cta: function (b) {
        // سرور پیوندِ ناشناس را خالی می‌کند؛ همین‌جا گفته می‌شود تا دکمه بی‌صدا بی‌پیوند نماند
        var warn = h('small', { class: 'warn-note', role: 'alert', hidden: true, text: 'این پیوند به یکی از شکل‌های بالا نیست و ذخیره نمی‌شود.' });
        var link = inp(b, 'href', { maxlength: 300, dir: 'ltr', placeholder: '/app/vill3n-shop' });
        var check = function () { warn.hidden = !tx(b.href) || hrefOk(b.href); };
        link.addEventListener('input', check); check();
        return h('div', { class: 'fields c2' }, [
          field('عنوان', inp(b, 'title', { maxlength: 120 }), null, 'full'),
          field('متن', area(b, 'text', { rows: 3, maxlength: 400 }), 'اختیاری.', 'full'),
          field('نوشتهٔ دکمه', inp(b, 'label', { maxlength: 40, placeholder: 'مثل: دانلود رایگان' })),
          add(field('پیوند دکمه', link, 'یکی از این شکل‌ها: \u2066/app/…\u2069 برای صفحه‌ای از همین سایت، \u2066#plans\u2069 برای بخشی از همین صفحه، \u2066https://…\u2069 ، \u2066tel:0792236008\u2069 یا \u2066mailto:…\u2069'), warn),
        ]);
      },
      faq: function (b) {
        if (!Array.isArray(b.items)) b.items = [];
        return [h('div', { class: 'fields c2' }, [field('عنوان بخش', inp(b, 'title', { maxlength: 120 }), 'اختیاری.'), field('توضیح زیر عنوان', inp(b, 'intro', { maxlength: 400 }), 'اختیاری.')]), sub('پرسش‌ها'),
          repeater(b.items, function () { return { q: '', a: '' }; }, function (x) { return h('div', { class: 'fields' }, [field('پرسش', inp(x, 'q', { maxlength: 200 })), field('پاسخ', area(x, 'a', { rows: 3, maxlength: 1500 }))]); }, 'افزودن پرسش', 20, 'هر بخش حداکثر ۲۰ پرسش دارد.')];
      },
    };

    function card(b, i, blocks) {
      var bodyId = 'blk-' + b.id, built = false;
      var name = types[b.type] || b.type;
      var titleEl = h('span', { class: 'blk-title' }), flag = h('span', { class: 'badge warn', hidden: true, text: 'خالی است؛ ذخیره نمی‌شود' });
      var paintHead = function () { titleEl.textContent = tx(b.title) || blockSummary(b) || 'بدون عنوان'; flag.hidden = !blockEmpty(b); };
      var body = h('div', { class: 'blk-body', id: bodyId, hidden: !open[b.id] });
      var el = h('div', { class: 'blk' + (open[b.id] ? ' is-open' : ''), 'data-b': b.id });
      var fill = function () { if (built) return; built = true; add(body, forms[b.type] ? forms[b.type](b) : h('p', { class: 'mute', text: 'این نوع بخش در این نسخهٔ پنل ویرایش نمی‌شود.' })); };
      var toggle = h('button', { class: 'blk-toggle', type: 'button', 'data-f': 'toggle', 'aria-expanded': String(!!open[b.id]), 'aria-controls': bodyId, onclick: function () {
        open[b.id] = !open[b.id];
        if (open[b.id]) fill();
        body.hidden = !open[b.id]; el.classList.toggle('is-open', !!open[b.id]); toggle.setAttribute('aria-expanded', String(!!open[b.id]));
      } }, [bicon(b.type), h('span', { class: 'blk-type', text: name }), titleEl, flag, h('span', { class: 'blk-chev' }, ic('down'))]);
      var tools = h('div', { class: 'blk-tools', role: 'group', 'aria-label': 'ابزار بخش ' + fa(i + 1) });
      var paintTools = function (asking) {
        clear(tools);
        if (asking) {
          add(tools, [h('span', { class: 'small', text: 'این بخش حذف شود؟' }),
            h('button', { class: 'btn sm danger', type: 'button', 'data-f': 'yes', text: 'بله، حذف کن', onclick: function () { blocks.splice(i, 1); delete open[b.id]; touch(); var nx = blocks[i] || blocks[i - 1]; draw(nx ? { id: nx.id, what: 'toggle' } : { what: 'add' }); } }),
            h('button', { class: 'btn sm', type: 'button', text: 'نه', onclick: function () { paintTools(false); tools.querySelector('[data-f="del"]').focus(); } })]);
          tools.querySelector('[data-f="yes"]').focus();
          return;
        }
        add(tools, [
          h('button', { class: 'btn sm icon', type: 'button', 'data-f': 'up', title: 'بالاتر', 'aria-label': 'بردن بخش «' + name + '» به بالا', disabled: i === 0, onclick: function () { blocks.splice(i - 1, 0, blocks.splice(i, 1)[0]); touch(); draw({ id: b.id, what: 'up' }); } }, ic('up')),
          h('button', { class: 'btn sm icon', type: 'button', 'data-f': 'down', title: 'پایین‌تر', 'aria-label': 'بردن بخش «' + name + '» به پایین', disabled: i === blocks.length - 1, onclick: function () { blocks.splice(i + 1, 0, blocks.splice(i, 1)[0]); touch(); draw({ id: b.id, what: 'down' }); } }, ic('down')),
          h('button', { class: 'btn sm icon', type: 'button', 'data-f': 'dup', title: 'کپی این بخش', 'aria-label': 'ساختن یک کپی از بخش «' + name + '»', disabled: blocks.length >= opt.max, onclick: function () {
            var c = JSON.parse(JSON.stringify(b)); c.id = newId();
            if (b.type === 'image' && b.image) c.imageFrom = b.imageFrom || b.id; // کپی همان تصویر را نگه می‌دارد
            if (b.type === 'video') { if (b.video) c.videoFrom = b.videoFrom || b.id; if (b.poster) c.posterFrom = b.posterFrom || b.id; }
            blocks.splice(i + 1, 0, c); open[c.id] = true; touch(); draw({ id: c.id, what: 'toggle' });
          } }, ic('copy')),
          h('button', { class: 'btn sm icon danger', type: 'button', 'data-f': 'del', title: 'حذف', 'aria-label': 'حذف بخش «' + name + '»', onclick: function () { paintTools(true); } }, ic('trash')),
        ]);
      };
      // هر تغییری در فرم، خلاصهٔ بالای کادر را تازه می‌کند
      ['input', 'change'].forEach(function (ev) { body.addEventListener(ev, paintHead); });
      body.addEventListener('click', function () { setTimeout(paintHead, 0); });
      if (open[b.id]) fill();
      paintHead(); paintTools(false);
      add(el, [h('div', { class: 'blk-head' }, [toggle, tools]), body]);
      return el;
    }

    function adder(blocks) {
      var full = blocks.length >= opt.max, show = !full && (adding || !blocks.length);
      var known = Object.keys(types).filter(function (t) { return BLOCKS[t]; });
      var grid = h('div', { class: 'blk-types', id: 'blk-types', hidden: !show }, known.map(function (t) {
        return h('button', { class: 'blk-pick', type: 'button', onclick: function () { var nb = newBlock(t); blocks.push(nb); open[nb.id] = true; adding = false; touch(); draw({ id: nb.id, what: 'first' }); } }, [bicon(t), h('b', { text: types[t] }), h('small', { text: BLOCKS[t][1] })]);
      }));
      return h('div', { class: 'blk-add' }, [
        h('div', { class: 'row' }, [
          blocks.length ? h('button', { class: 'btn main', type: 'button', 'data-f': 'add', 'aria-expanded': String(show), 'aria-controls': 'blk-types', disabled: full, onclick: function () { adding = !adding; draw({ what: 'add' }); } }, [ic('plus'), 'افزودن بخش']) : h('b', { class: 'blk-add-t', 'data-f': 'add', tabindex: '-1', text: 'افزودن بخش' }),
          h('span', { class: 'small mute', text: full ? 'به سقف ' + fa(opt.max) + ' بخش رسیده‌اید. برای افزودن، اول یکی را حذف کنید.' : blocks.length ? fa(blocks.length) + ' بخش از ' + fa(opt.max) : 'نوع بخش را انتخاب کنید:' }),
        ]),
        grid,
      ]);
    }

    function draw(focus) {
      var blocks = list();
      clear(box);
      if (!blocks.length) box.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'هنوز بخشی اضافه نشده است' }), 'از پایین یک نوع را انتخاب کنید؛ بعد از پر کردن، «ذخیرهٔ تغییرها» را بزنید.']));
      blocks.forEach(function (b, i) { box.appendChild(card(b, i, blocks)); });
      box.appendChild(adder(blocks));
      if (!focus) return;
      var at = focus.id ? box.querySelector('[data-b="' + focus.id + '"]') : box, el = null;
      if (at && focus.what === 'first') { el = at.querySelector('.blk-body input, .blk-body textarea, .blk-body select'); if (at.scrollIntoView) at.scrollIntoView({ block: 'nearest' }); }
      else if (at) el = at.querySelector('[data-f="' + focus.what + '"]');
      // دکمه‌ای که در لبهٔ فهرست خاموش شده، جایش را به دکمهٔ جهتِ دیگر می‌دهد تا صفحه‌کلید سرگردان نشود
      if (el && el.disabled) el = at.querySelector('[data-f="' + (focus.what === 'up' ? 'down' : 'up') + '"]:not([disabled])') || at.querySelector('[data-f="toggle"]');
      if (el) el.focus();
    }
    draw(null);
    return { el: box };
  }
  function limit(kind, dflt) { var l = S.meta && S.meta.blockLimits; return (l && l[kind]) || dflt; }

  function appEditor(id, tab) {
    return Promise.all([api('GET', '/apps/' + id), needMeta()]).then(function (res) {
      var app = res[0].app, M = S.meta, cur = tab || 'info';
      var tabs = { info: 'مشخصات و تم', versions: 'نسخه‌ها', plans: 'اشتراک و تخفیف', media: 'آیکن و تصویرها', blocks: 'بخش‌های صفحه', extra: 'پرسش‌ها و نظرها' };
      if (!tabs[cur]) cur = 'info';
      if (!Array.isArray(app.blocks)) app.blocks = [];
      if (!Array.isArray(app.badges)) app.badges = [];
      var saved = idMap(app.blocks);
      var bar = h('div', { class: 'savebar', hidden: true }, [h('span', { text: 'تغییرها هنوز ذخیره نشده‌اند.' }), h('button', { class: 'btn main', type: 'button', text: 'ذخیرهٔ تغییرها', onclick: save })]);
      var body = h('div');
      S.onDirty = function () { S.dirty = true; bar.hidden = false; };
      // true یعنی ذخیره شد (بارگذاری تصویرِ یک بخش تازه، اول همین را صدا می‌زند)
      function save() {
        var sent = app.blocks.length;
        return api('PUT', '/apps/' + app.id, app).then(function (r) { app = r.app; saved = idMap(app.blocks); S.dirty = false; bar.hidden = true; toast('ذخیره شد'); dropped(sent, app.blocks.length); draw(); return true; }, function (e) { fail(e); return false; });
      }
      function planNow(p) {
        var price = Number(String(p.price).replace(/[^\d]/g, '')) || 0, d = p.discount, on = d && Number(d.value) > 0 && (!d.from || new Date(d.from) <= new Date()) && (!d.to || new Date(d.to) > new Date());
        var off = on ? Math.min(price, d.type === 'amount' ? Number(d.value) : Math.round(price * Number(d.value) / 100)) : 0;
        return h('p', { class: 'price-now' }, [off ? h('s', { text: money(price) }) : null, money(price - off), d && Number(d.value) > 0 && !on ? h('span', { class: 'badge', style: 'margin-inline-start:8px', text: 'تخفیف الان فعال نیست' }) : null]);
      }

      var views = {
        info: function () {
          return [h('div', { class: 'card' }, [h('h2', { text: 'مشخصات' }), h('div', { class: 'fields c2' }, [
            field('نام برنامه', inp(app, 'name', { required: true })),
            field('نشانی صفحه', inp(app, 'slug', { dir: 'ltr' }), 'صفحهٔ برنامه: \u2066/app/' + app.slug + '\u2069'),
            field('توضیح یک‌خطی', inp(app, 'tagline', { maxlength: 140 }), 'زیر نام برنامه و در نتیجهٔ جست‌وجو دیده می‌شود.', 'full'),
            field('توضیح کامل', area(app, 'description', { rows: 6 }), 'با یک خط خالی، بند تازه بسازید.', 'full'),
            field('دسته', inp(app, 'category'), 'مثل «دکان و فروشگاه». برنامه‌های هم‌دسته در سایت با هم فیلتر می‌شوند.'),
            field('وضعیت', sel(app, 'status', STATUS), 'پیش‌نویس در سایت دیده نمی‌شود. «به‌زودی» دیده می‌شود ولی دانلود ندارد.'),
            h('div', { class: 'field full' }, [h('span', { class: 'lab', 'aria-hidden': 'true', text: 'برچسب‌ها' }), chips(app.badges, 6, 28, 'مثل: بدون اینترنت'), h('small', { text: 'برچسب‌های کوتاه بالای صفحهٔ برنامه، مثل: بدون اینترنت، فارسی، اندروید' })]),
            h('div', { class: 'field full' }, chk(app, 'featured', 'برنامهٔ ویژه (نشان طلایی «ویژه» کنار نام برنامه در سایت)')),
          ])]),
          h('div', { class: 'card' }, [h('h2', { text: 'تم صفحهٔ این برنامه' }), h('p', { class: 'hint', text: 'هر برنامه رنگ‌ها و صحنهٔ متحرک خودش را دارد. دکمه‌ها، نشانه‌ها و پس‌زمینهٔ صفحه همین رنگ‌ها را می‌گیرند.' }), h('div', { class: 'fields c3' }, [
            field('رنگ اصلی', inp(app, 'color', { type: 'color' })),
            field('رنگ دوم', inp(app, 'color2', { type: 'color' })),
            field('صحنهٔ متحرک', sel(app, 'scene', M.scenes)),
          ])]),
          h('div', { class: 'card' }, [h('h2', { text: 'ویژگی‌ها' }), h('p', { class: 'hint', text: 'هر ویژگی یک نشانه، یک عنوان و یک توضیح کوتاه دارد. برای کادر، جدول و بخش‌های بیشتر به زبانهٔ «بخش‌های صفحه» بروید.' }), repeater(app.features, function () { return { icon: '', title: '', text: '' }; }, function (f) { return h('div', { class: 'with-icon' }, [iconField(f, 'icon', 'نشانهٔ ویژگی'), h('div', { class: 'fields c2' }, [field('عنوان', inp(f, 'title', { maxlength: 80 })), field('توضیح', inp(f, 'text', { maxlength: 300 }))])]); }, 'افزودن ویژگی', 24, 'هر برنامه حداکثر ۲۴ ویژگی دارد.')]),
        ];
        },
        versions: function () {
          var list = h('div', { class: 'list' }), prog = h('div', { hidden: true }, [h('p', { class: 'small', 'data-t': '1' }), h('div', { class: 'prog' }, h('i'))]);
          var file = h('input', { type: 'file', hidden: true, multiple: true, accept: M.allowedExt.map(function (x) { return '.' + x; }).join(','), onchange: function (e) { queue(e.target.files); e.target.value = ''; } });
          var drop = h('div', { class: 'drop', role: 'button', tabindex: '0', onclick: function () { file.click(); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } },
            ondragover: function (e) { e.preventDefault(); drop.classList.add('is-over'); }, ondragleave: function () { drop.classList.remove('is-over'); }, ondrop: function (e) { e.preventDefault(); drop.classList.remove('is-over'); queue(e.dataTransfer.files); } },
          [h('b', { text: 'فایل برنامه را این‌جا رها کنید یا انتخاب کنید' }), h('span', { text: 'نسخه خودکار از داخل فایل خوانده می‌شود (APK، EXE، ZIP، HTML و …). تا ' + num(M.maxUploadMB) + ' مگابایت.' })]);
          var busy = false;
          function queue(files) { var arr = Array.prototype.slice.call(files || []); if (busy || !arr.length) return; busy = true; (function next() { var f = arr.shift(); if (!f) { busy = false; prog.hidden = true; return; } upload(f).then(next, function (e) { fail(e); next(); }); })(); }
          function upload(f) {
            var label = prog.querySelector('[data-t]'), fill = prog.querySelector('i');
            prog.hidden = false; fill.style.transform = 'scaleX(0)'; label.textContent = 'در حال فرستادن ' + f.name + ' …';
            return api('POST', '/apps/' + app.id + '/upload', { name: f.name, size: f.size }).then(function (st) {
              var i = 0, off = 0;
              var sendChunk = function (tries) {
                if (off >= f.size) return api('POST', '/uploads/' + st.uploadId + '/finish', {});
                return api('PUT', '/uploads/' + st.uploadId + '?i=' + i, f.slice(off, off + st.chunk), true).then(function (r) {
                  off = r.received; i++; fill.style.transform = 'scaleX(' + (off / f.size).toFixed(4) + ')'; label.textContent = f.name + ' — ' + bytes(off) + ' از ' + bytes(f.size);
                  return sendChunk(0);
                }, function (e) {
                  // قطعی کوتاه اینترنت: همان تکه تا سه بار دوباره فرستاده می‌شود
                  if (!e.status && tries < 3) return new Promise(function (ok) { setTimeout(ok, 1500 * (tries + 1)); }).then(function () { return sendChunk(tries + 1); });
                  api('DELETE', '/uploads/' + st.uploadId).catch(function () {}); throw e;
                });
              };
              return sendChunk(0);
            }).then(function (r) {
              var v = r.version; app.versions.unshift(v);
              toast(v.version ? 'نسخهٔ ' + v.version + ' پیدا و ثبت شد' : 'فایل ثبت شد، ولی نسخه پیدا نشد؛ شماره را دستی بنویسید', !v.version);
              drawList(v.id);
            });
          }
          function drawList(freshId) {
            clear(list);
            if (!app.versions.length) return list.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'هنوز فایلی نیست' }), 'اولین فایل برنامه را بارگذاری کنید.']));
            app.versions.forEach(function (v) {
              var f = { version: v.version, platform: v.platform, notes: v.notes, minOs: v.minOs };
              var saveV = function (extra) { return api('PUT', '/apps/' + app.id + '/versions/' + v.id, Object.assign({}, f, extra || {})).then(function () { if (f.version !== v.version) { v.source = 'manual'; v.sourceLabel = 'دستی وارد شد'; } Object.assign(v, f, extra || {}); toast('ذخیره شد'); drawList(); }, fail); };
              list.appendChild(h('div', { class: 'ver' + (v.id === freshId ? ' is-new' : '') + (!v.version || v.missing ? ' needs' : '') }, [
                h('div', { class: 'ver-head' }, [
                  h('span', { class: 'v', text: v.version ? 'v' + v.version : 'بدون نسخه' }),
                  h('span', { class: 'badge', text: v.platformLabel || M.platforms[v.platform] }),
                  v.missing ? h('span', { class: 'badge bad', text: 'فایل روی دیسک نیست' }) : h('span', { class: 'badge ' + (v.published ? 'ok' : 'warn'), text: v.published ? 'منتشرشده' : 'منتشرنشده' }),
                  h('span', { class: 'badge', text: v.sourceLabel || 'پیدا نشد' }),
                  h('span', { class: 'grow' }),
                  h('span', { class: 'mute small', text: bytes(v.size) + ' · ' + date(v.publishedAt) + ' · ' + num(v.downloads) + ' دانلود' }),
                ]),
                h('div', { class: 'fields' }, [
                  field('شمارهٔ نسخه', inp(f, 'version', { dir: 'ltr', placeholder: '1.0.0' }, true)),
                  field('پلتفرم', sel(f, 'platform', M.platforms, { quiet: true })),
                  field('حداقل سیستم', inp(f, 'minOs', { placeholder: 'مثل: اندروید ۷ به بالا' }, true)),
                  field('تغییرهای این نسخه', area(f, 'notes', { rows: 3, placeholder: 'هر خط یک تغییر' }, true), null, 'full'),
                ]),
                h('div', { class: 'sha', text: v.fileName + (v.package ? ' · ' + v.package : '') + ' · SHA-256 ' + v.sha256 }),
                h('div', { class: 'row end' }, [
                  h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () { confirmBox('حذف نسخه', 'فایل این نسخه از سرور پاک می‌شود و برنمی‌گردد.', 'حذف', true).then(function (ok) { if (ok) api('DELETE', '/apps/' + app.id + '/versions/' + v.id).then(function () { app.versions = app.versions.filter(function (x) { return x !== v; }); toast('حذف شد'); drawList(); }, fail); }); } }),
                  v.missing || !v.published || app.status !== 'published' ? null : h('a', { class: 'btn sm', href: siteUrl('/download/' + app.slug + '/' + v.id), text: 'دانلود' }),
                  v.missing ? null : h('button', { class: 'btn sm', type: 'button', text: v.published ? 'برداشتن از سایت' : 'انتشار', onclick: function () { saveV({ published: !v.published }); } }),
                  h('button', { class: 'btn sm main', type: 'button', text: 'ذخیرهٔ این نسخه', onclick: function () { saveV(); } }),
                ]),
              ]));
            });
          }
          var watch = h('div', { class: 'card' }, [h('h2', { text: 'پیدا کردن خودکار نسخه‌های تازه' }), h('p', { class: 'hint', text: 'دو راه بدون باز کردن پنل: فایل را در پوشهٔ ورودی کپی کنید، یا نشانی پوشه‌ای را بدهید که برنامه در آن ساخته می‌شود. سرور هر ۱۵ ثانیه نگاه می‌کند و نسخهٔ تازه را خودش ثبت می‌کند.' }),
            h('div', { class: 'fields' }, [
              h('div', { class: 'field' }, [h('span', { class: 'lab', text: 'پوشهٔ ورودی این برنامه' }), h('div', { class: 'codebox ltr copy', title: 'کپی', text: app.inbox, onclick: function () { copy(app.inbox, 'نشانی پوشه'); } })]),
              field('پوشهٔ ساخت (اختیاری)', inp(app, 'watchDir', { dir: 'ltr', placeholder: 'D:\\shop app\\app\\build\\outputs\\apk\\release' }), 'فایل‌های این پوشه کپی می‌شوند و اصل آن‌ها دست نمی‌خورد. بعد از نوشتن، «ذخیرهٔ تغییرها» را بزنید.'),
            ]),
            h('div', { class: 'row end', style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'button', text: 'همین حالا بررسی کن', onclick: function () { api('POST', '/scan', {}).then(function (r) { if (r.errors && r.errors.length) toast(r.errors[0], true); toast(r.added.length ? num(r.added.length) + ' نسخهٔ تازه پیدا شد' : 'نسخهٔ تازه‌ای نبود'); if (r.added.length) appEditor(app.id, 'versions'); }, fail); } }))]);
          drawList();
          return [h('div', { class: 'card' }, [h('h2', { text: 'بارگذاری نسخهٔ تازه' }), drop, file, prog]), h('div', { class: 'card' }, [h('h2', null, ['نسخه‌ها', h('small', { text: num(app.versions.length) + ' فایل' })]), list]), watch];
        },
        plans: function () {
          return [h('div', { class: 'card' }, [h('h2', { text: 'اشتراک‌های این برنامه' }), h('p', { class: 'hint', text: 'قیمت‌ها به ' + ((S.meta && S.meta.currency) || 'افغانی') + ' است و همیشه روی سرور حساب می‌شود. تخفیف زمان‌دار، سر وقت خودش شروع و تمام می‌شود.' }),
            repeater(app.plans, function () { return { name: '', period: 'month', days: 30, price: 0, features: [], popular: false, vip: false, active: true, discount: { type: 'percent', value: 0, from: null, to: null, label: '' } }; }, function (p, redraw) {
              if (!p.discount) p.discount = { type: 'percent', value: 0, from: null, to: null, label: '' };
              var d = p.discount, ft = { text: (p.features || []).join('\n') }, pr = h('div');
              var show = function () { clear(pr).appendChild(planNow(p)); };
              var periods = {}; Object.keys(M.periods).forEach(function (k) { periods[k] = M.periods[k].label; });
              var price = inp(p, 'price', { type: 'text', inputmode: 'numeric', dir: 'ltr' }); price.addEventListener('input', show);
              var dval = inp(d, 'value', { type: 'text', inputmode: 'numeric', dir: 'ltr' }); dval.addEventListener('input', show);
              var from = h('input', { type: 'datetime-local', value: toLocalInput(d.from), onchange: function (e) { d.from = fromLocalInput(e.target.value); touch(); show(); } });
              var to = h('input', { type: 'datetime-local', value: toLocalInput(d.to), onchange: function (e) { d.to = fromLocalInput(e.target.value); touch(); show(); } });
              var fta = area(ft, 'text', { rows: 3, placeholder: 'هر خط یک مورد' }); fta.addEventListener('input', function () { p.features = ft.text.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); });
              show();
              return [h('div', { class: 'fields c3' }, [
                field('نام اشتراک', inp(p, 'name', { placeholder: 'ماهانه' })),
                field('مدت', sel(p, 'period', periods, { after: redraw })),
                p.period === 'custom' ? field('چند روز', inp(p, 'days', { type: 'text', inputmode: 'numeric', dir: 'ltr' })) : field('قیمت', price),
                p.period === 'custom' ? field('قیمت', price) : null,
                field('چه چیزهایی دارد', fta, null, 'full'),
                h('div', { class: 'field' }, chk(p, 'popular', 'نشان «پیشنهادی»')),
                h('div', { class: 'field' }, chk(p, 'vip', 'اشتراک VIP (کارت طلایی)')),
                h('div', { class: 'field' }, chk(p, 'active', 'قابل سفارش')),
              ]), h('div', { class: 'fields c3', style: 'margin-top:4px' }, [
                field('نوع تخفیف', sel(d, 'type', { percent: 'درصد', amount: 'مبلغ ثابت' }, { after: show })),
                field('مقدار تخفیف', dval, 'صفر یعنی بدون تخفیف.'),
                field('نام تخفیف', inp(d, 'label', { placeholder: 'مثل: تخفیف عید' })),
                field('شروع تخفیف', from, 'خالی یعنی از همین حالا.'),
                field('پایان تخفیف', to, 'خالی یعنی بدون پایان.'),
                h('div', { class: 'field' }, [h('span', { class: 'lab', text: 'قیمت همین حالا' }), pr]),
              ])];
            }, 'افزودن اشتراک', 12)])];
        },
        media: function () {
          var pick = function (multiple, cb) { var i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: multiple, onchange: function () { cb(Array.prototype.slice.call(i.files)); } }); i.click(); };
          var shots = h('div', { class: 'shots' });
          var drawShots = function () {
            clear(shots);
            app.screenshots.forEach(function (s, i) {
              shots.appendChild(h('div', { class: 'shot' }, [h('img', { src: '/media/' + s.file, alt: s.caption || 'تصویر برنامه', loading: 'lazy' }), inp(s, 'caption', { placeholder: 'عنوان تصویر', 'aria-label': 'عنوان تصویر' }),
                h('div', { class: 'row' }, [
                  h('button', { class: 'btn sm icon', type: 'button', title: 'جلوتر', 'aria-label': 'جلوتر', disabled: i === 0, onclick: function () { app.screenshots.splice(i - 1, 0, app.screenshots.splice(i, 1)[0]); touch(); drawShots(); } }, ic('up')),
                  h('button', { class: 'btn sm icon', type: 'button', title: 'عقب‌تر', 'aria-label': 'عقب‌تر', disabled: i === app.screenshots.length - 1, onclick: function () { app.screenshots.splice(i + 1, 0, app.screenshots.splice(i, 1)[0]); touch(); drawShots(); } }, ic('down')),
                  h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () { api('DELETE', '/apps/' + app.id + '/screenshots/' + s.id).then(function () { app.screenshots.splice(i, 1); drawShots(); }, fail); } }),
                ])]));
            });
            if (!app.screenshots.length) shots.appendChild(h('p', { class: 'mute', text: 'هنوز تصویری نیست. تا آن زمان، صفحهٔ برنامه یک طرح ساده از رابط نشان می‌دهد.' }));
          };
          drawShots();
          var iconBox = h('div', { class: 'row' });
          var drawIcon = function () { clear(iconBox); add(iconBox, [appIcon(app), h('button', { class: 'btn', type: 'button', text: app.icon ? 'عوض کردن آیکن' : 'گذاشتن آیکن', onclick: function () { pick(false, function (fs) { if (fs[0]) api('PUT', '/apps/' + app.id + '/icon', fs[0], true).then(function (r) { app.icon = r.icon; drawIcon(); toast('آیکن ذخیره شد'); }, fail); }); } }), app.icon ? h('button', { class: 'btn danger', type: 'button', text: 'برداشتن', onclick: function () { api('DELETE', '/apps/' + app.id + '/icon').then(function () { app.icon = ''; drawIcon(); }, fail); } }) : null]); };
          drawIcon();
          return [h('div', { class: 'card' }, [h('h2', { text: 'آیکن' }), h('p', { class: 'hint', text: 'تصویر مربع PNG، JPG یا WebP. بدون آیکن، حرف اول نام با رنگ برنامه نمایش داده می‌شود.' }), iconBox]),
            h('div', { class: 'card' }, [h('h2', null, ['تصویرهای برنامه', h('small', { text: 'تا ۱۲ تصویر' })]), h('p', { class: 'hint', text: 'اولین تصویر داخل دستگاه سه‌بعدیِ بالای صفحه نمایش داده می‌شود.' }), shots, h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn main', type: 'button', text: 'افزودن تصویر', onclick: function () { pick(true, function (fs) { (function next() { var f = fs.shift(); if (!f) return drawShots(); api('POST', '/apps/' + app.id + '/screenshots', f, true).then(function (r) { app.screenshots.push(r.screenshot); next(); }, function (e) { fail(e); next(); }); })(); }); } }))])];
        },
        blocks: function () {
          return [h('div', { class: 'sec-head' }, [h('div', { class: 'grow' }, [h('h2', { text: 'بخش‌های صفحهٔ این برنامه' }), h('p', { text: 'هر چیزی که می‌خواهید به صفحهٔ برنامه اضافه کنید: متن، کادر، جدول مقایسه، آمار، مرحله‌ها، تصویر، ویدیو، نظر مشتری‌ها، نقل‌قول، دکمه و پرسش و پاسخ. ترتیب این فهرست همان ترتیب نمایش در سایت است.' })]),
            app.status !== 'draft' ? h('a', { class: 'btn', href: siteUrl('/app/' + app.slug), target: '_blank', rel: 'noopener', text: 'دیدن در سایت' }) : h('span', { class: 'badge', text: 'پیش‌نویس؛ هنوز در سایت نیست' })]),
          blockEditor({ get: function () { return app.blocks; }, max: limit('app', 30), base: '/apps/' + app.id, isSaved: function (bid) { return !!saved[bid]; }, save: save, redraw: draw, alt: app.name }).el];
        },
        extra: function () {
          if (!app.faq) app.faq = [];
          return [h('div', { class: 'card' }, [h('h2', { text: 'پرسش‌های پرتکرار' }), h('p', { class: 'hint', text: 'این پرسش‌ها در صفحهٔ برنامه می‌آیند و به موتورهای جست‌وجو و هوش مصنوعی کمک می‌کنند جواب درست بدهند.' }), repeater(app.faq, function () { return { q: '', a: '' }; }, function (f) { return h('div', { class: 'fields' }, [field('پرسش', inp(f, 'q')), field('پاسخ', area(f, 'a', { rows: 3 }))]); }, 'افزودن پرسش', 20)]),
            h('div', { class: 'card' }, [h('h2', { text: 'نظر مشتری‌ها' }), h('p', { class: 'hint', text: 'فقط نظرهای واقعی مشتری‌های خودتان را بنویسید.' }), repeater(app.testimonials, function () { return { name: '', role: '', text: '' }; }, function (t) { return h('div', { class: 'fields c2' }, [field('نام', inp(t, 'name')), field('کار یا شهر', inp(t, 'role')), field('متن نظر', area(t, 'text', { rows: 3 }), null, 'full')]); }, 'افزودن نظر', 12)])];
        },
      };

      function draw() {
        clear(main);
        var tabBar = h('div', { class: 'tabs', role: 'tablist' }, Object.keys(tabs).map(function (k) { return h('button', { type: 'button', role: 'tab', 'aria-selected': k === cur ? 'true' : 'false', class: k === cur ? 'is-on' : '', text: tabs[k], onclick: function () { cur = k; history.replaceState(null, '', '#/apps/' + app.id + '/' + k); lastHash = location.hash; draw(); } }); }));
        clear(body); add(body, views[cur]());
        add(main, [
          head(app.name, null, [h('a', { class: 'btn', href: '#/apps', text: 'بازگشت به فهرست' }), app.status !== 'draft' ? h('a', { class: 'btn', href: siteUrl('/app/' + app.slug), target: '_blank', rel: 'noopener', text: 'دیدن صفحه' }) : null,
            h('button', { class: 'btn danger', type: 'button', text: 'حذف برنامه', onclick: function () {
              confirmBox('حذف «' + app.name + '»', 'برنامه با همهٔ نسخه‌ها و تصویرهایش پاک می‌شود. این کار برنمی‌گردد.', 'حذف برنامه', true).then(function (ok) {
                if (!ok) return;
                var go = function (force) { return api('DELETE', '/apps/' + app.id + (force ? '?force=1' : '')).then(function () { S.dirty = false; toast('حذف شد'); location.hash = '#/apps'; }, function (e) { if (e.data && e.data.needsForce) return confirmBox('اشتراک فعال دارد', e.message, 'با این حال حذف کن', true).then(function (y) { if (y) return go(true); }); fail(e); }); };
                go(false);
              });
            } })]),
          tabBar, body, bar,
        ]);
        bar.hidden = !S.dirty;
      }
      draw();
    });
  }

  /* ───── صفحهٔ اصلی (بخش‌های افزودنی) ───── */
  ROUTES.home = function () {
    return Promise.all([api('GET', '/home'), needMeta()]).then(function (res) {
      var doc = { blocks: res[0].blocks || [] }, saved = idMap(doc.blocks);
      var bar = h('div', { class: 'savebar', hidden: true }, [h('span', { text: 'تغییرها هنوز ذخیره نشده‌اند.' }), h('button', { class: 'btn main', type: 'button', text: 'ذخیرهٔ تغییرها', onclick: save })]);
      S.onDirty = function () { S.dirty = true; bar.hidden = false; };
      function save() {
        var sent = doc.blocks.length;
        return api('PUT', '/home', { blocks: doc.blocks }).then(function (r) { doc.blocks = r.blocks; saved = idMap(doc.blocks); S.dirty = false; toast('ذخیره شد'); dropped(sent, doc.blocks.length); draw(); return true; }, function (e) { fail(e); return false; });
      }
      function draw() {
        clear(main);
        add(main, [
          head('صفحهٔ اصلی', 'بخش‌هایی که این‌جا می‌سازید به صفحهٔ اصلی سایت اضافه می‌شود: متن، کادر، جدول، آمار، مرحله‌ها، تصویر، ویدیو، نظر مشتری‌ها، نقل‌قول، دکمه و پرسش و پاسخ. ترتیب این فهرست همان ترتیب نمایش در سایت است.', h('a', { class: 'btn', href: siteUrl('/'), target: '_blank', rel: 'noopener', text: 'دیدن در سایت' })),
          h('p', { class: 'small mute blk-note' }, ['تیتر بزرگ و متن بالای صفحهٔ اصلی در ', h('a', { href: '#/settings', text: 'تنظیمات' }), ' است و فهرست برنامه‌ها خودکار ساخته می‌شود.']),
          blockEditor({ get: function () { return doc.blocks; }, max: limit('home', 40), base: '/home', isSaved: function (id) { return !!saved[id]; }, save: save, redraw: draw, alt: S.state.brand }).el,
          bar,
        ]);
        bar.hidden = !S.dirty;
      }
      draw();
    });
  };

  /* ───── صفحه‌های دلخواه ───── */
  var PAGE_STATUS = { published: 'منتشرشده', draft: 'پیش‌نویس' };
  ROUTES.pages = function (p) {
    if (p[0]) return pageEditor(p[0]);
    return Promise.all([api('GET', '/pages'), needMeta()]).then(function (res) {
      var pages = res[0].pages, max = limit('pages', 40);
      var move = function (i, d) { var j = i + d; if (j < 0 || j >= pages.length) return; var x = pages[i]; pages[i] = pages[j]; pages[j] = x; api('POST', '/pages/order', { ids: pages.map(function (pg) { return pg.id; }) }).then(render, fail); };
      var create = function () {
        if (pages.length >= max) return toast('حداکثر ' + fa(max) + ' صفحه می‌توان ساخت', true);
        var f = { title: '', slug: '' };
        modal('صفحهٔ تازه', h('div', { class: 'fields' }, [field('عنوان صفحه', inp(f, 'title', { required: true, maxlength: 80, placeholder: 'مثل: دربارهٔ ما' }, true)), field('نشانی صفحه', inp(f, 'slug', { dir: 'ltr', placeholder: 'about' }, true), 'حروف انگلیسی کوچک و خط تیره. صفحه با این نشانی باز می‌شود: \u2066/p/about\u2069')]), function (close) {
          return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn main', type: 'button', text: 'ساختن', onclick: function () { api('POST', '/pages', { title: f.title, slug: f.slug, status: 'draft', nav: false, blocks: [] }).then(function (x) { close(); location.hash = '#/pages/' + x.page.id; }, fail); } })];
        });
      };
      function render() {
        clear(main);
        add(main, [head('صفحه‌ها', 'صفحه‌های دلخواه خودتان را بسازید؛ مثل «دربارهٔ ما»، «راهنمای خرید» یا «قیمت‌ها». ترتیب این فهرست، ترتیب صفحه‌ها در منوی سایت است.', h('button', { class: 'btn main', type: 'button', text: 'صفحهٔ تازه', onclick: create }))]);
        if (!pages.length) return main.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'هنوز صفحه‌ای نساخته‌اید' }), 'یک صفحه بسازید و با متن، کادر، جدول و تصویر پرش کنید.', h('br'), h('button', { class: 'btn main', type: 'button', text: 'صفحهٔ تازه', onclick: create })]));
        main.appendChild(h('ul', { class: 'list' }, pages.map(function (pg, i) {
          return h('li', { class: 'item' }, [
            h('span', { class: 'app-ic page-ic' }, ic('pages')),
            h('div', { class: 'grow' }, [h('a', { href: '#/pages/' + pg.id, style: 'text-decoration:none;color:inherit' }, h('b', { class: 't', text: pg.title })), h('div', { class: 'meta' }, [h('span', { class: 'ltr', text: '/p/' + pg.slug }), h('span', { text: fa((pg.blocks || []).length) + ' بخش' }), h('span', { text: 'آخرین تغییر ' + date(pg.updatedAt) })])]),
            pg.nav ? h('span', { class: 'badge', text: 'در منو' }) : null,
            h('span', { class: 'badge ' + (pg.status === 'published' ? 'ok' : ''), text: PAGE_STATUS[pg.status] || pg.status }),
            h('button', { class: 'btn sm icon', type: 'button', title: 'بالا', 'aria-label': 'بالا بردن ' + pg.title, disabled: i === 0, onclick: function () { move(i, -1); } }, ic('up')),
            h('button', { class: 'btn sm icon', type: 'button', title: 'پایین', 'aria-label': 'پایین بردن ' + pg.title, disabled: i === pages.length - 1, onclick: function () { move(i, 1); } }, ic('down')),
            pg.status === 'published' ? h('a', { class: 'btn sm', href: siteUrl('/p/' + pg.slug), target: '_blank', rel: 'noopener', text: 'دیدن در سایت' }) : null,
            h('a', { class: 'btn sm', href: '#/pages/' + pg.id, text: 'ویرایش' }),
          ]);
        })));
      }
      render();
    });
  };

  function pageEditor(id) {
    return Promise.all([api('GET', '/pages/' + id), needMeta()]).then(function (res) {
      var page = res[0].page;
      if (!Array.isArray(page.blocks)) page.blocks = [];
      var saved = idMap(page.blocks), live = { status: page.status, slug: page.slug, title: page.title };
      var bar = h('div', { class: 'savebar', hidden: true }, [h('span', { text: 'تغییرها هنوز ذخیره نشده‌اند.' }), h('button', { class: 'btn main', type: 'button', text: 'ذخیرهٔ تغییرها', onclick: save })]);
      S.onDirty = function () { S.dirty = true; bar.hidden = false; };
      function save() {
        var sent = (page.blocks || []).length;
        return api('PUT', '/pages/' + page.id, { title: page.title, slug: page.slug, description: page.description, nav: page.nav, status: page.status, blocks: page.blocks }).then(function (r) {
          page = r.page; saved = idMap(page.blocks); live = { status: page.status, slug: page.slug, title: page.title };
          S.dirty = false; toast('ذخیره شد'); dropped(sent, page.blocks.length); draw(); return true;
        }, function (e) { fail(e); return false; });
      }
      function draw() {
        clear(main);
        add(main, [
          head(live.title, null, [h('a', { class: 'btn', href: '#/pages', text: 'بازگشت به فهرست' }),
            live.status === 'published' ? h('a', { class: 'btn', href: siteUrl('/p/' + live.slug), target: '_blank', rel: 'noopener', text: 'دیدن در سایت' }) : h('span', { class: 'badge', text: 'پیش‌نویس؛ هنوز در سایت نیست' }),
            h('button', { class: 'btn danger', type: 'button', text: 'حذف صفحه', onclick: function () {
              confirmBox('حذف «' + live.title + '»', 'صفحه با همهٔ بخش‌ها و تصویرهایش پاک می‌شود. این کار برنمی‌گردد.', 'حذف صفحه', true).then(function (ok) { if (ok) api('DELETE', '/pages/' + page.id).then(function () { S.dirty = false; toast('حذف شد'); location.hash = '#/pages'; }, fail); });
            } })]),
          h('div', { class: 'card' }, [h('h2', { text: 'مشخصات صفحه' }), h('div', { class: 'fields c2' }, [
            field('عنوان صفحه', inp(page, 'title', { required: true, maxlength: 80 })),
            field('نشانی صفحه', inp(page, 'slug', { dir: 'ltr' }), 'نشانی این صفحه در سایت: \u2066/p/' + live.slug + '\u2069'),
            field('توضیح کوتاه', area(page, 'description', { rows: 2, maxlength: 300 }), 'زیر عنوان صفحه و در نتیجهٔ جست‌وجو دیده می‌شود.', 'full'),
            field('وضعیت', sel(page, 'status', PAGE_STATUS), 'پیش‌نویس در سایت دیده نمی‌شود.'),
            h('div', { class: 'field' }, [h('span', { class: 'lab', 'aria-hidden': 'true', text: 'منوی سایت' }), chk(page, 'nav', 'این صفحه در منوی بالای سایت بیاید')]),
          ])]),
          h('div', { class: 'sec-head' }, h('div', { class: 'grow' }, [h('h2', { text: 'بخش‌های صفحه' }), h('p', { text: 'محتوای صفحه را با همین بخش‌ها بسازید: متن، کادر، جدول، آمار، مرحله‌ها، تصویر، ویدیو، نظر مشتری‌ها، نقل‌قول، دکمه و پرسش و پاسخ. ترتیب این فهرست همان ترتیب نمایش در سایت است.' })])),
          blockEditor({ get: function () { return page.blocks; }, max: limit('page', 40), base: '/pages/' + page.id, isSaved: function (bid) { return !!saved[bid]; }, save: save, redraw: draw, alt: live.title }).el,
          bar,
        ]);
        bar.hidden = !S.dirty;
      }
      draw();
    });
  }

  /* ───── سفارش‌ها ───── */
  var ORDER_STATUS = { new: 'تازه', paid: 'پرداخت‌شده', cancelled: 'لغوشده' };
  function waLink(phone, text) { var d = String(phone || '').replace(/\D/g, ''); if (d.charAt(0) === '0') d = '93' + d.slice(1); return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text); }

  ROUTES.orders = function () {
    return api('GET', '/orders').then(function (r) {
      S.meta = Object.assign(S.meta || {}, { currency: r.currency });
      var orders = r.orders, filter = 'new', q = { text: '' }, list = h('div', { class: 'list' });
      var tabsEl = h('div', { class: 'tabs' });
      function act(o, body) { return api('PUT', '/orders/' + o.id, body).then(function (x) { Object.assign(o, x.order); o.license = x.license ? x.license.code : o.license; draw(); return x; }, fail); }
      function draw() {
        clear(tabsEl);
        [['new', 'تازه'], ['paid', 'پرداخت‌شده'], ['cancelled', 'لغوشده'], ['all', 'همه']].forEach(function (t) { var n = t[0] === 'all' ? orders.length : orders.filter(function (o) { return o.status === t[0]; }).length; tabsEl.appendChild(h('button', { type: 'button', class: filter === t[0] ? 'is-on' : '', text: t[1] + ' (' + num(n) + ')', onclick: function () { filter = t[0]; draw(); } })); });
        clear(list);
        var s = q.text.trim().toLowerCase();
        var rows = orders.filter(function (o) { return (filter === 'all' || o.status === filter) && (!s || (o.name + ' ' + o.phone + ' ' + o.no + ' ' + o.appName).toLowerCase().indexOf(s) >= 0); });
        if (!rows.length) return list.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'سفارشی در این بخش نیست' }), 'سفارش‌هایی که مشتری از صفحهٔ برنامه ثبت می‌کند این‌جا می‌آید.']));
        rows.forEach(function (o) {
          var msg = 'سلام ' + o.name + '، سفارش شمارهٔ ' + o.no + ' (' + o.appName + '، ' + o.planName + ') دریافت شد.';
          var codeMsg = 'سلام ' + o.name + '، اشتراک ' + o.appName + ' (' + o.planName + ') فعال شد.\nکد فعال‌سازی: ' + o.license + '\nبررسی اشتراک: ' + location.origin.replace('//admin.', '//') + '/check?code=' + o.license;
          list.appendChild(h('div', { class: 'item col' }, [
            h('div', { class: 'row between' }, [h('b', { class: 't', text: 'سفارش ' + fa(o.no) + ' — ' + o.name }), h('span', { class: 'badge ' + (o.status === 'paid' ? 'ok' : o.status === 'new' ? 'warn' : ''), text: ORDER_STATUS[o.status] })]),
            h('div', { class: 'meta' }, [h('span', { text: o.appName + '، ' + o.planName }), h('span', { text: dateTime(o.createdAt) }), h('a', { class: 'ltr', href: 'tel:' + o.phone, text: o.phone }), o.email ? h('span', { class: 'ltr', text: o.email }) : null]),
            h('div', { class: 'meta' }, [h('span', null, ['قابل پرداخت: ', h('b', { style: 'color:var(--ink)', text: money(o.total) })]), o.planOff ? h('span', { text: 'تخفیف اشتراک ' + money(o.planOff) }) : null, o.couponOff ? h('span', { text: 'کد ' + o.coupon + ': ' + money(o.couponOff) }) : null]),
            o.note ? h('p', { class: 'small', text: 'یادداشت مشتری: ' + o.note }) : null,
            o.license ? h('div', { class: 'row' }, [h('span', { class: 'mute small', text: 'کد فعال‌سازی:' }), h('span', { class: 'code', text: o.license }), h('button', { class: 'btn sm', type: 'button', onclick: function () { copy(o.license, 'کد'); } }, [ic('copy'), 'کپی']), o.status === 'paid' ? h('a', { class: 'btn sm main', href: waLink(o.phone, codeMsg), target: '_blank', rel: 'noopener', text: 'فرستادن کد در واتساپ' }) : null]) : null,
            h('div', { class: 'row end' }, [
              h('a', { class: 'btn sm', href: waLink(o.phone, msg), target: '_blank', rel: 'noopener', text: 'پیام در واتساپ' }),
              o.status === 'new' ? h('button', { class: 'btn sm main', type: 'button', text: 'پرداخت شد؛ کد فعال‌سازی بساز', onclick: function () { act(o, { status: 'paid' }).then(function (x) { if (x) toast('کد فعال‌سازی ساخته شد'); }); } }) : null,
              o.status !== 'cancelled' ? h('button', { class: 'btn sm danger', type: 'button', text: 'لغو سفارش', onclick: function () { confirmBox('لغو سفارش ' + fa(o.no), o.status === 'paid' ? 'اشتراکِ این سفارش هم باطل می‌شود.' : 'سفارش به بخش لغوشده می‌رود.', 'لغو سفارش', true).then(function (ok) { if (ok) act(o, { status: 'cancelled' }); }); } }) : null,
              o.status === 'cancelled' ? h('button', { class: 'btn sm', type: 'button', text: 'برگرداندن', onclick: function () { act(o, { status: 'new' }); } }) : null,
              o.status !== 'paid' ? h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () { confirmBox('حذف سفارش', 'سفارش برای همیشه پاک می‌شود.', 'حذف', true).then(function (ok) { if (ok) api('DELETE', '/orders/' + o.id).then(function () { orders.splice(orders.indexOf(o), 1); draw(); }, fail); }); } }) : null,
            ]),
          ]));
        });
      }
      clear(main);
      var search = inp(q, 'text', { type: 'search', placeholder: 'جست‌وجوی نام، شماره یا شمارهٔ سفارش', 'aria-label': 'جست‌وجو', style: 'max-width:340px' }, true); search.addEventListener('input', draw);
      add(main, [head('سفارش‌ها', 'وقتی پول سفارش رسید «پرداخت شد» را بزنید؛ کد فعال‌سازی ساخته می‌شود و می‌توانید آن را در واتساپ بفرستید.', search), tabsEl, list]);
      draw();
    });
  };

  /* ───── اشتراک‌ها ───── */
  var LIC = { active: ['فعال', 'ok'], expired: ['تمام‌شده', 'warn'], revoked: ['باطل', 'bad'] };
  ROUTES.licenses = function () {
    return api('GET', '/licenses').then(function (r) {
      var lics = r.licenses, q = { text: '' }, list = h('div', { class: 'list' });
      function act(l, body) { return api('PUT', '/licenses/' + l.id, body).then(function (x) { Object.assign(l, x.license); draw(); toast('انجام شد'); }, fail); }
      function create() {
        var f = { appId: r.apps[0] ? r.apps[0].id : '', customer: '', phone: '', days: '30', lifetime: false, planName: '', note: '' };
        var appsMap = {}; r.apps.forEach(function (a) { appsMap[a.id] = a.name; });
        if (!r.apps.length) return toast('اول یک برنامه بسازید', true);
        modal('ساخت دستی اشتراک', h('div', { class: 'fields c2' }, [field('برنامه', sel(f, 'appId', appsMap), null, 'full'), field('نام مشتری', inp(f, 'customer')), field('شماره', inp(f, 'phone', { dir: 'ltr' })), field('نام اشتراک', inp(f, 'planName', { placeholder: 'مثل: سالانه' })), field('چند روز', inp(f, 'days', { type: 'text', inputmode: 'numeric', dir: 'ltr' })), h('div', { class: 'field full' }, chk(f, 'lifetime', 'دایمی (بدون تاریخ پایان)')), field('یادداشت', inp(f, 'note'), null, 'full')]), function (close) {
          return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn main', type: 'button', text: 'ساخت کد', onclick: function () { api('POST', '/licenses', f).then(function (x) { lics.unshift(x.license); close(); draw(); toast('کد فعال‌سازی ساخته شد'); }, fail); } })];
        });
      }
      function draw() {
        clear(list);
        var s = q.text.trim().toLowerCase();
        var rows = lics.filter(function (l) { return !s || (l.code + ' ' + l.customer + ' ' + l.phone + ' ' + l.app).toLowerCase().indexOf(s) >= 0; });
        if (!rows.length) return list.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'اشتراکی پیدا نشد' }), 'با پرداخت‌شدن هر سفارش، اشتراکش این‌جا ساخته می‌شود.']));
        rows.forEach(function (l) {
          var st = LIC[l.state] || LIC.active, ext = { days: '30' };
          list.appendChild(h('div', { class: 'item col' }, [
            h('div', { class: 'row between' }, [h('span', { class: 'code', text: l.code }), h('span', { class: 'badge ' + st[1], text: st[0] })]),
            h('div', { class: 'meta' }, [h('b', { style: 'color:var(--ink)', text: l.customer || 'بدون نام' }), h('span', { text: l.app + '، ' + l.planName }), l.phone ? h('span', { class: 'ltr', text: l.phone }) : null, h('span', { text: 'شروع ' + date(l.startAt) }), h('span', { text: l.endAt ? 'پایان ' + date(l.endAt) : 'دایمی' })]),
            l.note ? h('p', { class: 'small mute', text: l.note }) : null,
            h('div', { class: 'row end' }, [
              h('button', { class: 'btn sm', type: 'button', onclick: function () { copy(l.code, 'کد'); } }, [ic('copy'), 'کپی کد']),
              l.endAt ? h('span', { class: 'row' }, [inp(ext, 'days', { type: 'text', inputmode: 'numeric', dir: 'ltr', style: 'width:76px;min-height:34px', 'aria-label': 'تعداد روز تمدید' }), h('button', { class: 'btn sm', type: 'button', text: 'روز تمدید کن', onclick: function () { act(l, { action: 'extend', days: ext.days }); } })]) : null,
              l.endAt ? h('button', { class: 'btn sm', type: 'button', text: 'دایمی کن', onclick: function () { act(l, { action: 'lifetime' }); } }) : null,
              l.state === 'revoked' ? h('button', { class: 'btn sm', type: 'button', text: 'فعال کن', onclick: function () { act(l, { action: 'activate' }); } }) : h('button', { class: 'btn sm danger', type: 'button', text: 'باطل کن', onclick: function () { confirmBox('باطل‌کردن اشتراک', 'این کد دیگر معتبر نخواهد بود.', 'باطل کن', true).then(function (ok) { if (ok) act(l, { action: 'revoke' }); }); } }),
              h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () { confirmBox('حذف اشتراک', 'کد برای همیشه پاک می‌شود.', 'حذف', true).then(function (ok) { if (ok) api('DELETE', '/licenses/' + l.id).then(function () { lics.splice(lics.indexOf(l), 1); draw(); }, fail); }); } }),
            ]),
          ]));
        });
      }
      clear(main);
      var search = inp(q, 'text', { type: 'search', placeholder: 'جست‌وجوی کد، نام یا شماره', 'aria-label': 'جست‌وجو', style: 'max-width:300px' }); search.addEventListener('input', draw);
      add(main, [head('اشتراک‌ها', 'هر اشتراک یک کد فعال‌سازی دارد. مشتری می‌تواند وضعیتش را در صفحهٔ «بررسی اشتراک» ببیند و برنامه‌های شما می‌توانند همین کد را از سرور بپرسند.', [search, h('button', { class: 'btn main', type: 'button', text: 'ساخت دستی', onclick: create })]), list]);
      draw();
    });
  };

  /* ───── کدهای تخفیف ───── */
  ROUTES.coupons = function () {
    return api('GET', '/coupons').then(function (r) {
      var coupons = r.coupons, list = h('div', { class: 'list' });
      function edit(c) {
        var f = c ? JSON.parse(JSON.stringify(c)) : { code: '', type: 'percent', value: '10', appIds: [], maxUses: '0', from: null, to: null, active: true, note: '' };
        var appsBox = h('div', { class: 'row' }, r.apps.map(function (a) { return h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: f.appIds.indexOf(a.id) >= 0, onchange: function (e) { if (e.target.checked) f.appIds.push(a.id); else f.appIds = f.appIds.filter(function (x) { return x !== a.id; }); } }), h('span', { text: a.name })]); }));
        modal(c ? 'ویرایش کد ' + c.code : 'کد تخفیف تازه', h('div', { class: 'fields c2' }, [
          field('کد', inp(f, 'code', { dir: 'ltr', placeholder: 'EID10' }), 'حروف انگلیسی و عدد.'), field('نوع', sel(f, 'type', { percent: 'درصد', amount: 'مبلغ ثابت' })),
          field('مقدار', inp(f, 'value', { type: 'text', inputmode: 'numeric', dir: 'ltr' })), field('حداکثر دفعات استفاده', inp(f, 'maxUses', { type: 'text', inputmode: 'numeric', dir: 'ltr' }), 'صفر یعنی بدون محدودیت.'),
          field('شروع', h('input', { type: 'datetime-local', value: toLocalInput(f.from), onchange: function (e) { f.from = fromLocalInput(e.target.value); } })), field('پایان', h('input', { type: 'datetime-local', value: toLocalInput(f.to), onchange: function (e) { f.to = fromLocalInput(e.target.value); } })),
          h('div', { class: 'field full' }, [h('span', { class: 'lab', text: 'فقط برای این برنامه‌ها' }), appsBox, h('small', { text: 'هیچ‌کدام را نزنید تا برای همهٔ برنامه‌ها باشد.' })]),
          field('یادداشت', inp(f, 'note'), null, 'full'), h('div', { class: 'field full' }, chk(f, 'active', 'فعال')),
        ]), function (close) {
          return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn main', type: 'button', text: 'ذخیره', onclick: function () { api(c ? 'PUT' : 'POST', '/coupons' + (c ? '/' + c.id : ''), f).then(function (x) { if (c) coupons[coupons.indexOf(c)] = x.coupon; else coupons.unshift(x.coupon); close(); draw(); toast('ذخیره شد'); }, fail); } })];
        });
      }
      function draw() {
        clear(list);
        if (!coupons.length) return list.appendChild(h('div', { class: 'empty' }, [h('b', { text: 'کد تخفیفی نیست' }), 'کدی بسازید و به مشتری بدهید تا هنگام سفارش وارد کند.']));
        coupons.forEach(function (c) {
          var now = Date.now(), dead = !c.active || (c.to && new Date(c.to) <= now) || (c.maxUses && c.used >= c.maxUses), wait = c.from && new Date(c.from) > now;
          list.appendChild(h('div', { class: 'item' }, [
            h('span', { class: 'code', text: c.code }),
            h('div', { class: 'grow meta' }, [h('b', { style: 'color:var(--ink)', text: c.type === 'percent' ? num(c.value) + '٪' : money(c.value) }), h('span', { text: 'استفاده: ' + num(c.used) + (c.maxUses ? ' از ' + num(c.maxUses) : '') }), c.to ? h('span', { text: 'تا ' + dateTime(c.to) }) : null, c.appIds.length ? h('span', { text: num(c.appIds.length) + ' برنامه' }) : h('span', { text: 'همهٔ برنامه‌ها' }), c.note ? h('span', { text: c.note }) : null]),
            h('span', { class: 'badge ' + (dead ? 'bad' : wait ? 'warn' : 'ok'), text: dead ? 'غیرفعال' : wait ? 'هنوز شروع نشده' : 'فعال' }),
            h('button', { class: 'btn sm', type: 'button', text: 'ویرایش', onclick: function () { edit(c); } }),
            h('button', { class: 'btn sm danger', type: 'button', text: 'حذف', onclick: function () { confirmBox('حذف کد ' + c.code, 'کد پاک می‌شود. سفارش‌های قبلی تغییری نمی‌کنند.', 'حذف', true).then(function (ok) { if (ok) api('DELETE', '/coupons/' + c.id).then(function () { coupons.splice(coupons.indexOf(c), 1); draw(); }, fail); }); } }),
          ]));
        });
      }
      clear(main);
      add(main, [head('کدهای تخفیف', 'کد تخفیف روی قیمتِ بعد از تخفیفِ خودِ اشتراک حساب می‌شود.', h('button', { class: 'btn main', type: 'button', text: 'کد تازه', onclick: function () { edit(null); } })), list]);
      draw();
    });
  };

  /* ───── جست‌وجو و هوش مصنوعی ───── */
  ROUTES.seo = function () {
    return Promise.all([api('GET', '/seo'), api('GET', '/settings')]).then(function (res) {
      var seo = res[0], s = res[1].settings;
      var save = function () { api('PUT', '/settings', { allowAI: s.allowAI, indexNow: s.indexNow, googleVerify: s.googleVerify, bingVerify: s.bingVerify }).then(function () { S.dirty = false; toast('ذخیره شد'); ROUTES.seo(); }, fail); };
      var link = function (label, url) { return h('li', { class: 'row between' }, [h('span', { text: label }), h('a', { class: 'ltr small', href: url, target: '_blank', rel: 'noopener', text: url })]); };
      var last = seo.indexNow.last;
      clear(main);
      add(main, [
        head('جست‌وجو و هوش مصنوعی', 'سایت طوری ساخته شده که هم موتورهای جست‌وجو و هم دستیارهای هوش مصنوعی (ChatGPT، Claude، Gemini، Perplexity و …) آن را درست بخوانند.'),
        h('div', { class: 'grid2' }, [
          h('div', { class: 'card' }, [h('h2', { text: 'هوش مصنوعی' }), h('p', { class: 'hint', text: 'با روشن‌بودن این گزینه، خزنده‌های هوش مصنوعی اجازهٔ خواندن سایت را دارند و یک خلاصهٔ ساده از سایت و هر برنامه برایشان آماده است.' }),
            chk(s, 'allowAI', 'هوش مصنوعی‌ها اجازهٔ خواندن سایت را داشته باشند'),
            h('ul', { class: 'list', style: 'margin-top:12px' }, [link('خلاصهٔ سایت', seo.links.llms), link('متن کامل همهٔ برنامه‌ها', seo.links.full), link('فهرست ماشینی برنامه‌ها', seo.links.api), link('توضیح API', seo.links.openapi)])]),
          h('div', { class: 'card' }, [h('h2', { text: 'موتورهای جست‌وجو' }), h('p', { class: 'hint', text: 'نقشهٔ سایت و دادهٔ ساختاریافتهٔ هر برنامه خودکار ساخته می‌شود. برای دیدن آمار جست‌وجو، سایت را در Google Search Console و Bing Webmaster ثبت کنید و کد تأییدشان را این‌جا بگذارید.' }),
            h('div', { class: 'fields' }, [field('کد تأیید Google', inp(s, 'googleVerify', { dir: 'ltr', placeholder: 'مقدار content از تگ google-site-verification' })), field('کد تأیید Bing', inp(s, 'bingVerify', { dir: 'ltr', placeholder: 'مقدار content از تگ msvalidate.01' }))]),
            h('ul', { class: 'list', style: 'margin-top:12px' }, [link('نقشهٔ سایت', seo.links.sitemap), link('robots.txt', seo.links.robots)])]),
          h('div', { class: 'card wide' }, [h('h2', { text: 'خبر دادن فوری تغییرها (IndexNow)' }), h('p', { class: 'hint', text: 'با انتشار هر نسخه یا تغییر صفحه، نشانی‌های سایت خودکار به Bing و موتورهای هم‌پیمانش فرستاده می‌شود تا زودتر در نتیجه‌ها بیاید. این کار فقط وقتی انجام می‌شود که نشانی سایت یک دامنهٔ واقعی با https باشد. (Google این روش را ندارد؛ برای Google نقشهٔ سایت را در Search Console ثبت کنید.)' }),
            chk(s, 'indexNow', 'تغییرها خودکار خبر داده شود'),
            h('dl', { class: 'kv', style: 'margin-top:12px' }, [h('dt', { text: 'وضعیت' }), h('dd', { text: !seo.indexNow.eligible ? 'منتظر اتصال دامنه با https' : last ? (last.ok ? 'آخرین بار موفق: ' : 'آخرین بار ناموفق (کد ' + last.status + '): ') + dateTime(last.at) : 'هنوز چیزی فرستاده نشده' }), h('dt', { text: 'فایل کلید' }), h('dd', { class: 'ltr small', text: seo.indexNow.keyUrl })]),
            h('div', { class: 'row end', style: 'margin-top:12px' }, [h('button', { class: 'btn', type: 'button', text: 'همین حالا بفرست', disabled: !seo.indexNow.eligible, onclick: function () { api('POST', '/seo/indexnow', {}).then(function (x) { toast(x.result.ok ? 'فرستاده شد' : 'موتور جست‌وجو نپذیرفت (کد ' + x.result.status + ')', !x.result.ok); ROUTES.seo(); }, fail); } })])]),
        ]),
        h('div', { class: 'row end', style: 'margin-top:14px' }, h('button', { class: 'btn main', type: 'button', text: 'ذخیرهٔ این صفحه', onclick: save })),
      ]);
    });
  };

  /* ───── تنظیمات ───── */
  ROUTES.settings = function () {
    return api('GET', '/settings').then(function (r) {
      var s = r.settings, font = r.font;
      var bar = h('div', { class: 'savebar', hidden: true }, [h('span', { text: 'تغییرها هنوز ذخیره نشده‌اند.' }), h('button', { class: 'btn main', type: 'button', text: 'ذخیرهٔ تنظیمات', onclick: function () { api('PUT', '/settings', s).then(function () { S.dirty = false; bar.hidden = true; toast('ذخیره شد'); }, fail); } })]);
      S.onDirty = function () { S.dirty = true; bar.hidden = false; };
      var fontBox = h('div');
      var drawFont = function () {
        clear(fontBox);
        add(fontBox, [h('p', { class: 'row' }, [h('span', { class: 'badge ' + (font ? 'ok' : 'warn'), text: font ? 'فونت وزیرمتن روی سرور هست' : 'فونت وزیرمتن هنوز روی سرور نیست' }), font ? null : h('span', { class: 'mute small', text: 'تا آن زمان، بازدیدکننده‌ها سایت را با فونت دستگاه خودشان می‌بینند.' })]),
          h('div', { class: 'row', style: 'margin-top:10px' }, [
            h('button', { class: 'btn', type: 'button', text: 'گرفتن از اینترنت', onclick: function (e) { e.target.disabled = true; api('POST', '/font/fetch', {}).then(function (x) { font = x.font; toast('فونت گرفته شد'); drawFont(); }, function (er) { fail(er); e.target.disabled = false; }); } }),
            h('button', { class: 'btn', type: 'button', text: 'بارگذاری فایل فونت', onclick: function () { var i = h('input', { type: 'file', accept: '.woff2,.ttf', onchange: function () { if (i.files[0]) api('PUT', '/font', i.files[0], true).then(function (x) { font = x.font; toast('فونت ذخیره شد'); drawFont(); }, fail); } }); i.click(); } }),
          ])]);
      };
      drawFont();
      clear(main);
      add(main, [head('تنظیمات', 'نوشته‌های صفحهٔ اصلی، راه‌های تماس و رفتار سایت.'),
        h('div', { class: 'card' }, [h('h2', { text: 'برند و صفحهٔ اصلی' }), h('div', { class: 'fields c2' }, [field('نام برند', inp(s, 'brand')), field('شعار', inp(s, 'slogan')), field('تیتر صفحهٔ اصلی', inp(s, 'heroTitle'), null, 'full'), field('متن زیر تیتر', area(s, 'heroText', { rows: 3 }), null, 'full'), field('دربارهٔ ما (پانویس سایت)', area(s, 'about', { rows: 3 }), null, 'full')])]),
        h('div', { class: 'card' }, [h('h2', { text: 'تماس' }), h('div', { class: 'fields c2' }, [field('شمارهٔ تماس', inp(s, 'phone', { dir: 'ltr' })), field('واتساپ', inp(s, 'whatsapp', { dir: 'ltr', placeholder: '93792236008' }), 'با کد کشور و بدون صفر یا +.'), field('تلگرام', inp(s, 'telegram', { dir: 'ltr', placeholder: 'username' })), field('ایمیل', inp(s, 'email', { type: 'email', dir: 'ltr' }))])]),
        h('div', { class: 'card' }, [h('h2', { text: 'فروش' }), h('div', { class: 'fields c2' }, [field('واحد پول', inp(s, 'currency')), field('نشانی سایت', inp(s, 'siteUrl', { dir: 'ltr', type: 'url' }), 'برای پیوندها، نقشهٔ سایت و جست‌وجو. مثل https://vill3n.top'), field('پیام بعد از ثبت سفارش', area(s, 'orderNote', { rows: 2 }), null, 'full')])]),
        h('div', { class: 'card' }, [h('h2', { text: 'فایل‌ها' }), h('div', { class: 'fields c2' }, [h('div', { class: 'field' }, chk(s, 'autoPublish', 'نسخه‌ای که شماره‌اش پیدا شد، خودکار منتشر شود')), field('سقف حجم هر فایل (مگابایت)', inp(s, 'maxUploadMB', { type: 'text', inputmode: 'numeric', dir: 'ltr' }))])]),
        h('div', { class: 'card' }, [h('h2', { text: 'فونت' }), h('p', { class: 'hint', text: 'همهٔ نوشته‌های سایت با وزیرمتن نمایش داده می‌شود. فایل فونت یک بار روی سرور گذاشته می‌شود و بعد بدون اینترنت هم کار می‌کند.' }), fontBox]),
        bar]);
    });
  };

  /* ───── اتصال و استقرار ───── */
  function cmd(text) { return h('pre', { class: 'cmd copy', title: 'برای کپی بزنید', text: text, onclick: function () { copy(text, 'دستور'); } }); }
  function guide(title, sub, open, steps) { return h('details', { class: 'guide', open: open }, [h('summary', null, [title, h('small', { text: sub })]), h('div', { class: 'body' }, h('ol', null, steps.map(function (s) { return h('li', null, s); })))]); }

  ROUTES.deploy = function () {
    return api('GET', '/deploy').then(function (d) {
      var host = (function () { try { return new URL(d.siteUrl).hostname; } catch (e) { return 'vill3n.top'; } })();
      var result = h('div');
      var check = function (e) {
        e.target.disabled = true; clear(result).appendChild(h('p', { class: 'mute', text: 'در حال بررسی دامنه…' }));
        api('POST', '/deploy/check', {}).then(function (r) {
          var row = function (ok, text) { return h('li', { class: ok ? 'done' : '' }, [h('span', { class: 'dot', text: ok ? '✓' : '' }), text]); };
          clear(result).appendChild(h('ul', { class: 'todo', style: 'margin-top:12px' }, [
            row(r.dns && r.dns.length, r.dns && r.dns.length ? 'دامنه پیدا شد: ' + r.dns.join('، ') : 'دامنه هنوز به جایی وصل نیست (DNS تنظیم نشده یا هنوز پخش نشده).'),
            row(r.reach && r.reach.status === 200, r.reach && r.reach.status === 200 ? 'سایت از اینترنت باز می‌شود.' : 'سایت از اینترنت باز نشد' + (r.reach && r.reach.error ? ' (' + r.reach.error + ')' : '') + '.'),
            row(r.same, r.same ? 'دامنه به همین سرور وصل است.' : 'جواب از این سرور نیامد؛ دامنه به جای دیگری وصل است یا تونل خاموش است.'),
            row(r.https, r.https ? 'نشانی سایت با https است.' : 'نشانی سایت در تنظیمات باید با https شروع شود.'),
            row(r.adminSame, r.adminSame ? 'admin.' + host + ' هم به همین سرور وصل است.' : 'admin.' + host + ' هنوز وصل نیست (اختیاری؛ ' + host + '/admin همیشه کار می‌کند).'),
          ]));
          e.target.disabled = false;
        }, function (er) { clear(result); fail(er); e.target.disabled = false; });
      };
      var exp = h('div');
      clear(main);
      add(main, [
        head('اتصال و استقرار', 'این سایت روی سرور خانگی، وی‌پی‌اس و هاست اشتراکی اجرا می‌شود. راهنمای هر کدام پایین همین صفحه است.'),
        h('div', { class: 'grid2' }, [
          h('div', { class: 'card' }, [h('h2', { text: 'وضعیت همین سرور' }), h('dl', { class: 'kv' }, [
            h('dt', { text: 'نسخهٔ سایت' }), h('dd', { class: 'ltr', text: d.version + ' · Node ' + d.node }),
            h('dt', { text: 'سیستم' }), h('dd', { class: 'ltr', text: d.platform }),
            h('dt', { text: 'درگاه' }), h('dd', { class: 'ltr', text: d.passenger ? 'Passenger (هاست)' : d.bind + ':' + d.port }),
            h('dt', { text: 'پوشهٔ داده' }), h('dd', { class: 'ltr small', text: d.dataDir }),
            h('dt', { text: 'فضای خالی' }), h('dd', { text: d.disk ? bytes(d.disk.free) + ' از ' + bytes(d.disk.total) : 'نامشخص' }),
            h('dt', { text: 'این بازدید' }), h('dd', { text: (d.request.secure ? 'امن (https)' : 'بدون https') + (d.request.viaProxy ? '، از راه واسط' : '، مستقیم') + ' — ' + d.request.host }),
          ])]),
          h('div', { class: 'card' }, [h('h2', { text: 'آیا دامنه وصل است؟' }), h('p', { class: 'hint', text: 'نشانی سایت در تنظیمات: ' + d.siteUrl }), h('button', { class: 'btn main', type: 'button', text: 'بررسی اتصال دامنه', onclick: check }), result,
            h('p', { class: 'small mute', style: 'margin-top:12px', text: 'پنل مالک با این نشانی‌ها باز می‌شود: ' + host + '/admin و (اگر زیردامنه را بسازید) admin.' + host }),
            h('p', { class: 'small mute', text: 'نشانی «' + host + '.admin» ممکن نیست؛ مرورگر آخرین بخش بعد از نقطه را پسوند دامنه می‌داند و پسوندی به نام admin وجود ندارد.' })]),
        ]),
        h('div', { style: 'margin-top:14px' }, [
          guide('سرور خانگی', 'پیشنهادی — رایگان، بدون باز کردن پورت مودم', true, [
            ['این برنامه همین حالا روی کامپیوتر شما روشن است و روی درگاه ', h('b', { class: 'ltr', text: String(d.port) }), ' جواب می‌دهد. برای اینکه با هر بار روشن‌شدن ویندوز خودش بالا بیاید، فایل ', h('b', { class: 'ltr', text: 'INSTALL-SERVICE.bat' }), ' را یک بار اجرا کنید.'],
            ['برای رسیدن اینترنت به سرور خانگی از Cloudflare Tunnel استفاده کنید (رایگان است و با اینترنت‌های بدون IP ثابت هم کار می‌کند). دامنهٔ ' + host + ' باید در حساب Cloudflare شما باشد.'],
            ['اگر تونل ندارید، یک بار بسازید:', cmd('cloudflared tunnel login\ncloudflared tunnel create vill3n')],
            ['دامنه و زیردامنهٔ پنل را به تونل وصل کنید:', cmd('cloudflared tunnel route dns vill3n ' + host + '\ncloudflared tunnel route dns vill3n admin.' + host)],
            ['در فایل تنظیم تونل (', h('span', { class: 'ltr', text: '.cloudflared\\config.yml' }), ') این بخش را بگذارید:', cmd('tunnel: vill3n\ncredentials-file: C:\\Users\\<نام شما>\\.cloudflared\\<شناسهٔ تونل>.json\ningress:\n  - hostname: ' + host + '\n    service: http://localhost:' + d.port + '\n  - hostname: admin.' + host + '\n    service: http://localhost:' + d.port + '\n  - service: http_status:404')],
            ['تونل را به‌صورت سرویس نصب کنید تا همیشه روشن باشد:', cmd('cloudflared service install')],
            ['در «تنظیمات»، نشانی سایت را https://' + host + ' بگذارید و بالا «بررسی اتصال دامنه» را بزنید.'],
            ['فایل‌های بزرگ‌تر از ۱۰۰ مگابایت از راه Cloudflare هم بارگذاری می‌شوند، چون پنل فایل را تکه‌تکه می‌فرستد. سریع‌ترین راه اما کپی‌کردن فایل در پوشهٔ ورودی برنامه روی خودِ سرور است.'],
          ]),
          guide('وی‌پی‌اس (سرور مجازی)', 'اوبونتو یا دبیان', false, [
            ['پوشهٔ سایت را روی سرور بگذارید (مثلاً با WinSCP در ', h('span', { class: 'ltr', text: '/opt/vill3n-top' }), ') و دستور نصب را بزنید. این دستور Node را (اگر نباشد) می‌گیرد و سایت را به‌صورت سرویس همیشه‌روشن نصب می‌کند:', cmd('cd /opt/vill3n-top\nsudo bash scripts/install-linux.sh')],
            ['برای https خودکار و رایگان، Caddy را نصب کنید و این تنظیم را در ', h('span', { class: 'ltr', text: '/etc/caddy/Caddyfile' }), ' بگذارید:', cmd(host + ', admin.' + host + ' {\n    reverse_proxy 127.0.0.1:' + d.port + '\n}')],
            ['در پنل دامنه، رکورد A برای ' + host + ' و admin.' + host + ' را روی IP وی‌پی‌اس بگذارید و Caddy را دوباره بارگذاری کنید:', cmd('sudo systemctl reload caddy')],
            ['اگر دامنه در Cloudflare با ابر نارنجی (پروکسی) است، فایل config.json را کنار server.js بسازید تا نشانی واقعی بازدیدکننده‌ها درست شناخته شود، و در فایروال سرور فقط به Cloudflare اجازهٔ ورود بدهید:', cmd('{ "port": ' + d.port + ', "host": "127.0.0.1", "proxy": "cloudflare" }')],
            ['کد راه‌اندازی اولین ورود در این فایل است:', cmd('sudo cat /opt/vill3n-top/data/SETUP-CODE.txt')],
            ['دیدن وضعیت و گزارش‌ها:', cmd('systemctl status vill3n-top\njournalctl -u vill3n-top -n 50')],
          ]),
          guide('هاست اشتراکی با Node (cPanel)', 'بخش «Setup Node.js App»', false, [
            ['پوشهٔ سایت را فشرده و در File Manager هاست (بیرون از public_html، مثلاً در پوشهٔ vill3n-top) باز کنید.'],
            ['در cPanel بخش «Setup Node.js App» را باز کنید و «Create Application» را بزنید: نسخهٔ Node را ۱۸ یا بالاتر، Application root را vill3n-top، Application URL را دامنهٔ خود و Application startup file را ', h('b', { class: 'ltr', text: 'app.js' }), ' بگذارید.'],
            ['برنامه را Start کنید. به «Run NPM Install» نیازی نیست؛ این سایت هیچ بسته‌ای نصب نمی‌کند.'],
            ['کد راه‌اندازی اولین ورود در فایل ', h('span', { class: 'ltr', text: 'vill3n-top/data/SETUP-CODE.txt' }), ' است. آن را از File Manager باز کنید و بعد به ' + host + '/admin بروید.'],
            ['SSL رایگان هاست (AutoSSL یا Let’s Encrypt) را برای دامنه روشن کنید.'],
          ]),
          h('details', { class: 'guide' }, [h('summary', null, ['هاست بدون Node', h('small', { text: 'فقط فایل می‌پذیرد (PHP یا ایستا)' })]), h('div', { class: 'body' }, [
            h('p', { class: 'mute', text: 'برای این هاست‌ها یک نسخهٔ ایستا از سایت ساخته می‌شود: همهٔ صفحه‌ها، تصویرها و آخرین نسخهٔ هر برنامه. سفارش‌ها به واتساپ می‌روند و پنل مالک روی سرور خانگی شما می‌ماند. هر بار چیزی عوض کردید، دوباره بسازید و بارگذاری کنید.' }),
            h('div', { class: 'row', style: 'margin-top:12px' }, [
              h('button', { class: 'btn main', type: 'button', text: 'ساختن نسخهٔ ایستا', onclick: function (e) { e.target.disabled = true; api('POST', '/export', {}).then(function (x) { e.target.disabled = false; clear(exp); add(exp, [h('p', { text: num(x.pages) + ' صفحه و ' + num(x.files) + ' فایل برنامه (' + bytes(x.bytes) + ') ساخته شد.' }), h('div', { class: 'codebox ltr', text: x.dir }), h('a', { class: 'btn', href: '/api/admin/export.zip', style: 'margin-top:10px', text: 'دانلود به‌صورت ZIP' }), h('p', { class: 'small mute', style: 'margin-top:8px', text: 'محتوای ZIP را در public_html هاست باز کنید.' })]); }, function (er) { fail(er); e.target.disabled = false; }); } }),
            ]), exp])]),
        ]),
      ]);
    });
  };

  /* ───── امنیت ───── */
  var AUDIT = { 'app-create': 'ساخت برنامه', 'app-update': 'ویرایش برنامه', 'app-delete': 'حذف برنامه', 'home-update': 'صفحهٔ اصلی', 'page-create': 'ساخت صفحه', 'page-update': 'ویرایش صفحه', 'page-delete': 'حذف صفحه', 'block-image': 'تصویر بخش', setup: 'راه‌اندازی', login: 'ورود', 'login-fail': 'ورود ناموفق', password: 'تغییر رمز', profile: 'تغییر مشخصات', settings: 'تنظیمات', backup: 'پشتیبان', restore: 'بازگردانی', export: 'خروجی ایستا', 'email-code': 'کد ایمیل', 'reset-owner': 'پاک‌کردن رمز' };
  ROUTES.security = function () {
    return api('GET', '/security').then(function (r) {
      var pw = { current: '', next: '', again: '' }, pf = { username: r.username, email: r.email, current: '' }, ec = Object.assign({}, r.emailCode), test = { ticket: '', code: '' };
      var ecBox = h('div');
      var drawEc = function () {
        clear(ecBox);
        add(ecBox, [h('p', { class: 'row' }, [h('span', { class: 'badge ' + (r.emailCode.enabled ? 'ok' : ''), text: r.emailCode.enabled ? 'روشن است' : 'خاموش است' }), h('span', { class: 'mute small', text: 'کد به این ایمیل می‌رود: ' + (r.email || 'ایمیل مالک را بنویسید') })]),
          h('div', { class: 'fields', style: 'margin-top:10px' }, [
            field('نشانی سرویس ایمیل شما', inp(ec, 'url', { dir: 'ltr', type: 'url', placeholder: 'http://localhost:4702/send-code' }), 'سایت با روش POST به این نشانی درخواست می‌فرستد.'),
            field('سرآیندها', area(ec, 'headers', { rows: 2, dir: 'ltr', placeholder: 'Authorization: Bearer ...' }), 'هر خط یک سرآیند. اگر سرویس شما کلید می‌خواهد این‌جا بنویسید.'),
            field('متن درخواست (JSON)', area(ec, 'body', { rows: 2, dir: 'ltr' }), 'به‌جای {{email}} ایمیل شما و به‌جای {{code}} کد ۶ رقمی گذاشته می‌شود.'),
          ]),
          h('div', { class: 'row end', style: 'margin-top:12px' }, [
            r.emailCode.enabled ? h('button', { class: 'btn danger', type: 'button', text: 'خاموش کن', onclick: function () { var f = { current: '' }; modal('خاموش‌کردن کد ایمیل', field('رمز فعلی', inp(f, 'current', { type: 'password', dir: 'ltr' })), function (close) { return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn danger', type: 'button', text: 'خاموش کن', onclick: function () { api('POST', '/security/email-code/disable', f).then(function () { close(); toast('خاموش شد'); ROUTES.security(); }, fail); } })]; }); } }) : null,
            h('button', { class: 'btn main', type: 'button', text: r.emailCode.enabled ? 'ذخیره و آزمایش دوباره' : 'ذخیره و فرستادن کد آزمایشی', onclick: function () {
              var ask = !r.emailCode.enabled ? Promise.resolve('') : new Promise(function (resolve) {
                var f = { current: '' }, sent = false;
                var d = modal('رمز فعلی', h('div', { class: 'fields' }, [h('p', { class: 'mute', text: 'با تغییر این تنظیم، کد ایمیل تا آزمایش دوباره خاموش می‌شود؛ برای همین رمز فعلی لازم است.' }), field('رمز فعلی', inp(f, 'current', { type: 'password', dir: 'ltr', autocomplete: 'current-password' }, true))]), function (close) { return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn main', type: 'button', text: 'ادامه', onclick: function () { sent = true; close(); } })]; });
                d.addEventListener('close', function () { resolve(sent ? f.current : null); });
              });
              ask.then(function (current) {
                if (current === null) return null;
                return api('PUT', '/security/email-code', Object.assign({}, ec, { current: current })).then(function () { r.emailCode.enabled = false; return api('POST', '/security/email-code/test', {}); });
              }).then(function (x) {
                if (!x) return;
                test.ticket = x.ticket; test.code = '';
                modal('کد آزمایشی فرستاده شد', h('div', { class: 'fields' }, [h('p', { class: 'mute', text: 'کدی را که به ایمیل شما رسید بنویسید. فقط وقتی کد واقعاً برسد این قابلیت روشن می‌شود تا پشت در نمانید.' }), field('کد ۶ رقمی', inp(test, 'code', { dir: 'ltr', inputmode: 'numeric', maxlength: 6 }))]), function (close) { return [h('button', { class: 'btn', type: 'button', text: 'انصراف', onclick: close }), h('button', { class: 'btn main', type: 'button', text: 'روشن کن', onclick: function () { api('POST', '/security/email-code/enable', test).then(function () { close(); toast('ورود با کد ایمیل روشن شد'); ROUTES.security(); }, fail); } })]; });
              }, fail);
            } }),
          ])]);
      };
      drawEc();
      clear(main);
      add(main, [head('امنیت', 'فقط مالک به این پنل راه دارد. رمز به‌صورت رمزنگاری‌شده نگه داشته می‌شود و بعد از چند تلاش غلط، ورود موقتاً بسته می‌شود.'),
        h('div', { class: 'grid2' }, [
          h('div', { class: 'card' }, [h('h2', { text: 'تغییر رمز' }), h('div', { class: 'fields' }, [field('رمز فعلی', inp(pw, 'current', { type: 'password', dir: 'ltr', autocomplete: 'current-password' })), field('رمز تازه', inp(pw, 'next', { type: 'password', dir: 'ltr', autocomplete: 'new-password' }), 'دست‌کم ۱۰ نویسه.'), field('تکرار رمز تازه', inp(pw, 'again', { type: 'password', dir: 'ltr', autocomplete: 'new-password' }))]),
            h('div', { class: 'row end', style: 'margin-top:12px' }, h('button', { class: 'btn main', type: 'button', text: 'تغییر رمز', onclick: function () { if (pw.next !== pw.again) return toast('رمز تازه و تکرارش یکی نیست', true); api('POST', '/security/password', pw).then(function () { S.dirty = false; toast('رمز عوض شد؛ دستگاه‌های دیگر خارج شدند'); ROUTES.security(); }, fail); } }))]),
          h('div', { class: 'card' }, [h('h2', { text: 'نام کاربری و ایمیل' }), h('div', { class: 'fields' }, [field('نام کاربری', inp(pf, 'username', { dir: 'ltr', autocomplete: 'username' })), field('ایمیل', inp(pf, 'email', { type: 'email', dir: 'ltr' })), field('رمز فعلی', inp(pf, 'current', { type: 'password', dir: 'ltr', autocomplete: 'current-password' }), 'برای تأیید.')]),
            h('div', { class: 'row end', style: 'margin-top:12px' }, h('button', { class: 'btn main', type: 'button', text: 'ذخیره', onclick: function () { api('PUT', '/security/profile', pf).then(function () { S.dirty = false; toast('ذخیره شد'); ROUTES.security(); }, fail); } }))]),
          h('div', { class: 'card wide' }, [h('h2', { text: 'ورود با کد ۶ رقمی ایمیل' }), h('p', { class: 'hint', text: 'بعد از رمز، یک کد ۶ رقمی از راه سرویس ایمیلِ خودتان فرستاده می‌شود. کد ۵ دقیقه اعتبار دارد، یک‌بارمصرف است و بعد از ۵ تلاش غلط باطل می‌شود. اگر روزی پشت در ماندید، روی سرور دستور node server.js reset-owner را بزنید.' }), ecBox]),
          h('div', { class: 'card' }, [h('h2', { text: 'دستگاه‌های واردشده' }), h('ul', { class: 'list' }, r.sessions.map(function (s) { return h('li', { class: 'row between' }, [h('span', { class: 'small' }, [h('b', { class: 'ltr', text: s.ip || 'نامشخص' }), ' — ', dateTime(s.lastAt), h('br'), h('span', { class: 'mute ltr', text: (s.ua || '').slice(0, 70) })]), s.current ? h('span', { class: 'badge ok', text: 'همین دستگاه' }) : h('button', { class: 'btn sm danger', type: 'button', text: 'خارج کن', onclick: function () { api('DELETE', '/security/sessions/' + s.key).then(ROUTES.security, fail); } })]); }))]),
          h('div', { class: 'card' }, [h('h2', { text: 'رویدادهای اخیر' }), h('ul', { class: 'list' }, r.audit.slice(0, 40).map(function (a) { return h('li', { class: 'small' }, [h('b', { text: AUDIT[a.action] || a.action }), ' — ', a.detail, h('br'), h('span', { class: 'mute', text: dateTime(a.at) + (a.ip ? ' · ' + a.ip : '') })]); }))]),
        ])]);
    });
  };

  /* ───── پشتیبان ───── */
  ROUTES.backup = function () {
    clear(main);
    add(main, [head('پشتیبان', 'سرور هر روز خودش یک نسخه از داده را در پوشهٔ data/backups نگه می‌دارد (۳۰ روز آخر). این‌جا می‌توانید پشتیبان را برای خودتان هم بردارید.'),
      h('div', { class: 'grid2' }, [
        h('div', { class: 'card' }, [h('h2', { text: 'گرفتن پشتیبان' }), h('p', { class: 'hint', text: 'رمز مالک در پشتیبان نمی‌رود.' }), h('div', { class: 'row' }, [h('a', { class: 'btn main', href: '/api/admin/backup.zip', text: 'پشتیبان کامل (با فایل‌ها و تصویرها)' }), h('a', { class: 'btn', href: '/api/admin/backup', text: 'فقط داده (JSON)' })])]),
        h('div', { class: 'card' }, [h('h2', { text: 'بازگردانی' }), h('p', { class: 'hint', text: 'فایل db.json یا پشتیبان JSON را انتخاب کنید. برنامه‌ها، صفحه‌ها، بخش‌های صفحهٔ اصلی، سفارش‌ها، اشتراک‌ها و تنظیمات جایگزین می‌شوند؛ رمز و ورود شما دست نمی‌خورد. پیش از بازگردانی، دادهٔ فعلی کنار گذاشته می‌شود.' }),
          h('button', { class: 'btn danger', type: 'button', text: 'انتخاب فایل پشتیبان', onclick: function () {
            var i = h('input', { type: 'file', accept: '.json,application/json', onchange: function () {
              var f = i.files[0]; if (!f) return;
              f.text().then(function (t) { var data; try { data = JSON.parse(t); } catch (e) { return toast('این فایل JSON نیست', true); }
                confirmBox('بازگردانی پشتیبان', 'دادهٔ فعلی سایت با محتوای این فایل جایگزین می‌شود.', 'بازگردانی', true).then(function (ok) { if (ok) api('POST', '/restore', { data: data, confirm: 'RESTORE' }).then(function (x) { toast(num(x.apps) + ' برنامه بازگردانی شد' + (x.missing ? '؛ فایل ' + num(x.missing) + ' نسخه روی دیسک نیست' : ''), !!x.missing); }, fail); }); });
            } }); i.click();
          } })]),
      ])]);
    return Promise.resolve();
  };

  /* ───── شروع ───── */
  function boot() {
    return fetch('/api/admin/state', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (st) {
      S.state = st; S.dirty = false;
      if (st.setup || !st.authed) return gate();
      shell(); route();
    }).catch(function () { clear(root).appendChild(h('p', { class: 'boot', text: 'ارتباط با سرور برقرار نشد. صفحه را دوباره باز کنید.' })); });
  }
  boot();
})();
