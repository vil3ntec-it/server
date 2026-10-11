// پیش از نقاشی صفحه اجرا می‌شود تا حالت روشن/تیره بدون پرش اعمال شود.
(function () {
  var t = 'dark';
  try { var s = localStorage.getItem('v3-theme'); if (s === 'light' || s === 'dark') t = s; } catch (e) { /* ذخیره‌سازی بسته است */ }
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m && t === 'light') m.setAttribute('content', '#f4f5fa');
  document.documentElement.classList.add('js');
})();
