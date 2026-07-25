// Live clock + running shift ticker + time-of-day greeting.
// Server-rendered values are the source of truth; this only animates the display.
(function () {
  function two(n) { return String(n).padStart(2, '0'); }

  // Time-of-day greeting (client-side so it matches the user's device time).
  const greetingEl = document.getElementById('greeting');
  if (greetingEl) {
    const h = new Date().getHours();
    const word = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
    greetingEl.textContent = greetingEl.textContent.replace(/^\S+(?=,)/, word);
  }

  const clock = document.getElementById('clock');
  function tickClock() {
    const d = new Date();
    if (clock) clock.textContent = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  }

  // Running counters: the shift timer and, when on break, the break timer.
  function makeTicker(id) {
    const el = document.getElementById(id);
    const start = el ? parseInt(el.dataset.start, 10) : null;
    return function () {
      if (!el || !start) return;
      let ms = Date.now() - start;
      if (ms < 0) ms = 0;
      const totalMin = Math.floor(ms / 60000);
      el.textContent = `${Math.floor(totalMin / 60)}h${two(totalMin % 60)}`;
    };
  }
  const tickShift = makeTicker('ticker');
  const tickBreak = makeTicker('breakTicker');

  tickClock(); tickShift(); tickBreak();
  setInterval(tickClock, 1000);
  // Break time is short, so refresh it every second; the shift every 30s.
  setInterval(tickShift, 1000 * 30);
  setInterval(tickBreak, 1000);

  // Auto-dismiss floating flash after a few seconds.
  const flash = document.querySelector('.flash-float');
  if (flash) setTimeout(() => { flash.style.opacity = '0'; }, 3500);
})();
