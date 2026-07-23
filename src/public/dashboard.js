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

  const ticker = document.getElementById('ticker');
  const start = ticker ? parseInt(ticker.dataset.start, 10) : null;
  function tickShift() {
    if (!ticker || !start) return;
    let ms = Date.now() - start;
    if (ms < 0) ms = 0;
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    ticker.textContent = `${h}h${two(m)}`;
  }

  tickClock(); tickShift();
  setInterval(tickClock, 1000);
  setInterval(tickShift, 1000 * 30);

  // Auto-dismiss floating flash after a few seconds.
  const flash = document.querySelector('.flash-float');
  if (flash) setTimeout(() => { flash.style.opacity = '0'; }, 3500);
})();
