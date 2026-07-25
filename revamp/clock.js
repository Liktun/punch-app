/* Shared live clock for the theme mockups. External (not inline) so the app's
   strict CSP (script-src 'self') allows it when revamp/ is served by Express. */
(function () {
  var el = document.getElementById('clock');
  if (!el) return;
  function two(n) { return String(n).padStart(2, '0'); }
  function tick() {
    var d = new Date();
    el.textContent = two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }
  tick();
  setInterval(tick, 1000);
})();
