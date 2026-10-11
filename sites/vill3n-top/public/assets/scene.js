/* VILL3N — صحنهٔ متحرکِ بالای صفحهٔ هر برنامه (Canvas دوبعدی ساده، بدون کتابخانه و بدون WebGL).
   هر برنامه صحنهٔ خودش را دارد: بارکد، موج، نبض، ارقام، قفل یا کد — با رنگ‌های همان برنامه.
   برای سبک‌ماندن: فقط وقتی بالای صفحه دیده می‌شود نقاشی می‌کند، حداکثر ۳۰ بار در ثانیه،
   با برگهٔ پنهان می‌ایستد و در حالت «حرکت کم» فقط یک قاب ثابت می‌کشد. */
(function () {
  'use strict';
  var cv = document.querySelector('canvas.scene');
  if (!cv || cv.__scene) return;
  cv.__scene = true;
  var ctx = cv.getContext('2d');
  if (!ctx) return;

  var kind = cv.getAttribute('data-scene') || 'code';
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, narrow = false, A = [74, 125, 255], B = [242, 184, 75], light = false, state = {};

  function hex(v, fb) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(v || '').trim());
    if (!m) return fb;
    var n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')'; }
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
  // نوشته‌های صفحه سمت راست‌اند؛ صحنه در همان سمت کم‌رنگ می‌شود تا خوانایی کم نشود
  function fade(x) { if (narrow) return 0.75; var f = (0.7 - x / W) / 0.26; return f < 0 ? 0 : f > 1 ? 1 : f; }

  function colors() {
    var cs = getComputedStyle(document.body);
    A = hex(cs.getPropertyValue('--app'), A);
    B = hex(cs.getPropertyValue('--app2'), B);
    light = document.documentElement.getAttribute('data-theme') === 'light';
  }

  function resize() {
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.25 : 1.5);
    W = w; H = h; narrow = w < 900;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state = {};
    if (SCENES[kind].init) SCENES[kind].init();
  }

  var SCENES = {
    /* بارکد: میله‌هایی که نور اسکنر از رویشان رد می‌شود */
    bars: {
      init: function () {
        var r = rng(11), x = 0, list = [];
        while (x < W) { var w = [2, 2, 3, 3, 5, 8][Math.floor(r() * 6)]; list.push({ x: x, w: w, a: 0.05 + r() * 0.15, h: 0.55 + r() * 0.45 }); x += w + 3 + Math.floor(r() * 7); }
        state.list = list;
      },
      draw: function (t) {
        var scan = (0.5 + 0.5 * Math.sin(t * 0.55)) * W * (narrow ? 1 : 0.78), top = H * 0.14, full = H * 0.72, k = light ? 1.5 : 1;
        for (var i = 0; i < state.list.length; i++) {
          var b = state.list[i], f = fade(b.x);
          if (f <= 0) continue;
          var d = Math.abs(b.x - scan), g = d < 150 ? 1 - d / 150 : 0, h = full * b.h * (1 + g * 0.08);
          ctx.fillStyle = rgba(A, (b.a + g * 0.28) * f * k);
          ctx.fillRect(b.x, top + (full - h) / 2, b.w, h);
          if (g > 0) { ctx.fillStyle = rgba(B, g * 0.3 * f * k); ctx.fillRect(b.x, top + (full - h) / 2, b.w, h); }
        }
        var gr = ctx.createLinearGradient(0, top, 0, top + full);
        gr.addColorStop(0, rgba(B, 0)); gr.addColorStop(0.5, rgba(B, 0.85 * fade(scan))); gr.addColorStop(1, rgba(B, 0));
        ctx.fillStyle = gr; ctx.fillRect(scan - 1, top - 20, 2, full + 40);
      }
    },

    /* موج: لایه‌های مایع که آرام بالا و پایین می‌روند */
    flow: {
      draw: function (t) {
        for (var i = 0; i < 5; i++) {
          var base = H * (0.46 + i * 0.1) + Math.sin(t * 0.3 + i) * 8, amp = 12 + i * 6;
          var pts = [], x;
          for (x = -18; x <= W + 18; x += 18) pts.push(x, base + Math.sin(x * 0.0055 * (1 + i * 0.22) + t * (0.55 + i * 0.12) + i * 1.7) * amp + Math.sin(x * 0.013 - t * 0.42 + i * 2.3) * amp * 0.4);
          ctx.beginPath(); ctx.moveTo(-18, H);
          for (x = 0; x < pts.length; x += 2) ctx.lineTo(pts[x], pts[x + 1]);
          ctx.lineTo(W + 18, H); ctx.closePath();
          var g = ctx.createLinearGradient(0, base - amp, 0, H);
          g.addColorStop(0, rgba(i % 2 ? B : A, (light ? 0.13 : 0.1) + i * 0.03)); g.addColorStop(1, rgba(A, 0.02));
          ctx.fillStyle = g; ctx.fill();
          // فقط خودِ موج خط می‌خورد، نه لبه‌های بوم
          ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
          for (x = 2; x < pts.length; x += 2) ctx.lineTo(pts[x], pts[x + 1]);
          ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(i % 2 ? B : A, 0.3); ctx.stroke();
        }
      }
    },

    /* نبض: خط ضربان قلب که مثل نمایشگر از چپ به راست کشیده می‌شود */
    pulse: {
      draw: function (t) {
        var x, y, base = H * (narrow ? 0.3 : 0.52), amp = Math.min(150, H * 0.2), span = narrow ? W : W * 0.82;
        ctx.lineWidth = 1; ctx.strokeStyle = rgba(A, light ? 0.1 : 0.06);
        ctx.beginPath();
        for (x = 0; x < span; x += 44) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (y = 0; y < H; y += 44) { ctx.moveTo(0, y); ctx.lineTo(span, y); }
        ctx.stroke();
        var ecg = function (u) {
          if (u < 0.1) return 0;
          if (u < 0.18) return Math.sin((u - 0.1) / 0.08 * Math.PI) * 0.1;
          if (u < 0.26) return 0;
          if (u < 0.29) return -(u - 0.26) / 0.03 * 0.16;
          if (u < 0.33) return -0.16 + (u - 0.29) / 0.04 * 1.16;
          if (u < 0.37) return 1 - (u - 0.33) / 0.04 * 1.32;
          if (u < 0.4) return -0.32 + (u - 0.37) / 0.03 * 0.32;
          if (u < 0.52) return 0;
          if (u < 0.68) return Math.sin((u - 0.52) / 0.16 * Math.PI) * 0.2;
          return 0;
        };
        var head = (t * 230) % (span + 420), trail = 620;
        for (var pass = 0; pass < 2; pass++) {
          ctx.lineWidth = pass ? 2 : 7; ctx.lineJoin = 'round';
          var from = Math.max(0, head - trail), to = Math.min(span, head), seg = 60;
          for (x = from; x < to; x += seg) {
            var mid = x + seg / 2, age = (head - mid) / trail;
            ctx.strokeStyle = rgba(pass ? B : A, (pass ? 0.9 : 0.2) * (1 - age) * fade(mid));
            ctx.beginPath();
            for (var px = x; px <= Math.min(to, x + seg); px += 3) { y = base - ecg((px / 300) % 1) * amp; if (px === x) ctx.moveTo(px, y); else ctx.lineTo(px, y); }
            ctx.stroke();
          }
        }
        if (head <= span) { ctx.fillStyle = rgba(B, fade(head)); ctx.beginPath(); ctx.arc(head, base - ecg((head / 300) % 1) * amp, 4.5, 0, 6.2832); ctx.fill(); }
      }
    },

    /* ارقام: جدول عددهایی که یکی‌یکی عوض می‌شوند */
    ticker: {
      fps: 12,
      init: function () {
        var r = rng(5), cols = Math.max(2, Math.floor(W / 150)), rows = Math.max(3, Math.floor(H / 62)), cells = [];
        var nf = new Intl.NumberFormat('fa-AF', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        for (var i = 0; i < cols * rows; i++) { var v = 10 + r() * 190; cells.push({ v: v, s: nf.format(v), at: -9, up: true }); }
        state = { r: r, cols: cols, rows: rows, cells: cells, nf: nf, next: 0 };
      },
      draw: function (t) {
        var s = state, cw = W / s.cols, ch = H / s.rows;
        if (t > s.next) {
          for (var n = 0; n < 3; n++) { var c = s.cells[Math.floor(s.r() * s.cells.length)], d = (s.r() - 0.48) * 2.4; c.v = Math.max(1, c.v + d); c.s = s.nf.format(c.v); c.at = t; c.up = d >= 0; }
          s.next = t + 0.25;
        }
        ctx.font = '600 15px Vazirmatn, Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (var i = 0; i < s.cells.length; i++) {
          var cell = s.cells[i], x = (i % s.cols + 0.5) * cw, y = (Math.floor(i / s.cols) + 0.5) * ch, f = fade(x);
          if (f <= 0) continue;
          var hot = Math.max(0, 1 - (t - cell.at) / 1.6);
          ctx.fillStyle = hot > 0 ? rgba(cell.up ? B : A, (0.2 + hot * 0.75) * f) : rgba(A, (light ? 0.5 : 0.42) * f);
          ctx.fillText((hot > 0 ? (cell.up ? '▲ ' : '▼ ') : '') + cell.s, x, y);
        }
      }
    },

    /* قفل: حلقه‌های مدرّج که مثل قفل گاوصندوق پله‌پله می‌چرخند */
    dial: {
      init: function () {
        var rings = [];
        for (var i = 0; i < 4; i++) rings.push({ a: i * 0.7, to: i * 0.7, next: 0.4 + i * 0.5, dir: i % 2 ? 1 : -1 });
        state = { rings: rings, r: rng(23) };
      },
      draw: function (t) {
        var cx = narrow ? W * 0.5 : W * 0.26, cy = narrow ? H * 0.26 : H * 0.54, R = Math.min(W, H) * (narrow ? 0.3 : 0.4), k = light ? 1.5 : 1;
        for (var i = 0; i < state.rings.length; i++) {
          var g = state.rings[i], rad = R * (0.42 + i * 0.26);
          if (t > g.next) { g.dir = -g.dir; g.to += g.dir * (Math.floor(state.r() * 9) + 3) * 0.10472; g.next = t + 1.3 + state.r() * 1.6; }
          g.a += (g.to - g.a) * 0.09;
          ctx.lineWidth = 1; ctx.strokeStyle = rgba(A, 0.16 * k);
          ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.stroke();
          for (var n = 0; n < 60; n++) {
            var major = n % 5 === 0, ang = g.a + n * 0.10472, c = Math.cos(ang), s = Math.sin(ang), len = major ? 13 : 6;
            ctx.strokeStyle = rgba(n === 0 ? B : A, (n === 0 ? 0.95 : major ? 0.5 : 0.24) * k);
            ctx.lineWidth = n === 0 ? 3 : major ? 1.6 : 1;
            ctx.beginPath(); ctx.moveTo(cx + c * rad, cy + s * rad); ctx.lineTo(cx + c * (rad - len), cy + s * (rad - len)); ctx.stroke();
          }
        }
        ctx.fillStyle = rgba(B, 0.9);
        ctx.beginPath(); ctx.moveTo(cx, cy - R * 1.24); ctx.lineTo(cx - 7, cy - R * 1.24 - 13); ctx.lineTo(cx + 7, cy - R * 1.24 - 13); ctx.closePath(); ctx.fill();
      }
    },

    /* گرد طلا: رگه‌های طلاییِ سنگ لاجورد که آرام در عمق شناورند و چشمک می‌زنند (صفحهٔ اصلی) */
    dust: {
      init: function () {
        var r = rng(29), n = Math.min(170, Math.round(W * H / 8200)), list = [];
        for (var i = 0; i < n; i++) list.push({ x: r() * W, y: r() * H, z: 0.25 + r() * 0.75, p: r() * 6.283, s: 0.4 + r() * 1.1, g: r() < 0.72 });
        state.list = list;
      },
      draw: function (t) {
        var k = light ? 0.75 : 1;
        for (var i = 0; i < state.list.length; i++) {
          var d = state.list[i];
          var x = (d.x + t * 7 * d.z) % (W + 20) - 10, y = (d.y - t * 4.5 * d.z) % (H + 20);
          if (y < -10) y += H + 20;
          var tw = 0.5 + 0.5 * Math.sin(t * d.s * 1.3 + d.p), a = (0.1 + 0.62 * tw * tw) * d.z * k, size = 0.7 + d.z * 1.5;
          ctx.fillStyle = rgba(d.g ? (light ? A : B) : A, a);
          ctx.fillRect(x, y, size, size);
          if (d.z > 0.86 && tw > 0.8) { ctx.fillStyle = rgba(d.g ? (light ? A : B) : A, a * 0.22); ctx.fillRect(x - size * 2.5, y + size * 0.3, size * 6, size * 0.4); ctx.fillRect(x + size * 0.3, y - size * 2.5, size * 0.4, size * 6); }
        }
      }
    },

    /* کد: خط‌هایی از «کد» که تکه‌تکه تایپ می‌شوند و بالا می‌روند */
    code: {
      init: function () {
        var r = rng(3), lines = [], n = Math.ceil(H / 24) + 4;
        var make = function () { var toks = [], c = 2 + Math.floor(r() * 5); for (var i = 0; i < c; i++) toks.push({ w: 22 + r() * 96, k: Math.floor(r() * 4) }); return { indent: Math.floor(r() * 4) * 26, toks: toks }; };
        for (var i = 0; i < n; i++) lines.push(make());
        state = { lines: lines, make: make, cursor: 0, shift: 0, last: 0 };
      },
      draw: function (t) {
        var s = state, lh = 24, dt = Math.min(0.1, t - s.last); s.last = t;
        var total = 0, li, ti;
        for (li = 0; li < s.lines.length; li++) total += s.lines[li].toks.length;
        s.cursor += dt * 11;
        var visible = Math.floor(H / lh) - 2, typedLines = 0, count = 0;
        for (li = 0; li < s.lines.length; li++) { count += s.lines[li].toks.length; if (count <= s.cursor) typedLines++; else break; }
        if (typedLines > visible) { s.shift += dt * 60; if (s.shift >= lh) { s.shift -= lh; s.cursor -= s.lines[0].toks.length; s.lines.shift(); s.lines.push(s.make()); } }
        if (s.cursor >= total) s.cursor = total - 1;
        var left = narrow ? 18 : W * 0.04, seen = 0, k = light ? 1.5 : 1;
        for (li = 0; li < s.lines.length; li++) {
          var line = s.lines[li], x = left + line.indent, y = 96 + li * lh - s.shift;
          for (ti = 0; ti < line.toks.length; ti++, seen++) {
            if (seen >= s.cursor) { if (seen < s.cursor + 1) { ctx.fillStyle = rgba(B, 0.9 * fade(x)); ctx.fillRect(x, y - 2, 7, 14); } li = 1e9; break; }
            var tk = line.toks[ti], f = fade(x + tk.w / 2);
            ctx.fillStyle = tk.k === 0 ? rgba(B, 0.34 * f * k) : tk.k === 1 ? rgba(A, 0.4 * f * k) : rgba(A, 0.15 * f * k);
            ctx.fillRect(x, y, tk.w, 9);
            x += tk.w + 10;
          }
        }
      }
    }
  };
  if (!SCENES[kind]) kind = 'code';

  var raf = 0, running = false, visible = true, last = 0, t0 = performance.now();
  var gap = 1000 / (SCENES[kind].fps || 30) - 2;
  function paint(now) { ctx.clearRect(0, 0, W, H); SCENES[kind].draw((now - t0) / 1000); }
  function frame(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < gap) return;
    last = now;
    paint(now);
  }
  function start() { if (running || calm || !visible || document.hidden || !W) return; running = true; raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  // قاب ثابت (حالت «حرکت کم»): صحنهٔ «کد» از پیش چند خط نوشته دارد تا خالی دیده نشود
  function still() { if (!W) return; if (kind === 'code' && state.lines) state.cursor = 60; paint(t0 + 4200); }

  colors(); resize();
  if (!W) return;
  still();
  cv.classList.add('is-on');
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) start(); else stop(); }).observe(cv);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  window.addEventListener('v3-theme', function () { colors(); if (!running) still(); });
  var rz = 0, lastW = W;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (cv.clientWidth === lastW && Math.abs(cv.clientHeight - H) < 120) return; lastW = cv.clientWidth; resize(); if (!running) still(); }, 180); }, { passive: true });
  start();
})();
