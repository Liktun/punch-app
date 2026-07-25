/* Interactive black & white universe for the Cosmos (v7) theme.
   A full-page canvas: multi-layer starfield with parallax that follows the
   pointer, slow drift, twinkle, occasional shooting stars, and a soft cursor
   halo. Monochrome only (white on black). Pure vanilla, no deps. */
(function () {
  const canvas = document.getElementById("cosmos");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Pointer state (parallax target) + smoothed value.
  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: false };

  let stars = [];
  const LAYERS = [
    { count: 90, speed: 0.02, size: [0.4, 0.9], depth: 6,  alpha: [0.25, 0.55] },
    { count: 60, speed: 0.05, size: [0.7, 1.4], depth: 14, alpha: [0.4, 0.8] },
    { count: 28, speed: 0.10, size: [1.1, 2.1], depth: 26, alpha: [0.6, 1.0] },
  ];
  let dust = [];       // faint slow nebula grains
  let shooters = [];   // shooting stars

  function rand(a, b) { return a + Math.random() * (b - a); }

  function build() {
    stars = [];
    LAYERS.forEach((L, li) => {
      for (let i = 0; i < L.count; i++) {
        stars.push({
          l: li,
          x: Math.random(), y: Math.random(),
          r: rand(L.size[0], L.size[1]),
          a: rand(L.alpha[0], L.alpha[1]),
          tw: Math.random() * Math.PI * 2,       // twinkle phase
          tws: rand(0.4, 1.6),                    // twinkle speed
        });
      }
    });
    dust = [];
    for (let i = 0; i < 40; i++) {
      dust.push({ x: Math.random(), y: Math.random(), r: rand(18, 60), a: rand(0.015, 0.05) });
    }
  }

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function spawnShooter() {
    if (prefersReduced) return;
    const fromLeft = Math.random() < 0.5;
    const y = rand(0.05, 0.5) * H;
    const x = fromLeft ? -40 : W + 40;
    const dir = fromLeft ? 1 : -1;
    const speed = rand(6, 10);
    shooters.push({
      x, y,
      vx: dir * speed * rand(0.8, 1.2),
      vy: speed * rand(0.25, 0.5),
      life: 0, max: rand(60, 100),
    });
  }

  let t = 0, lastShoot = 0;
  function frame(now) {
    t += 1;
    // Smooth pointer parallax.
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const px = (pointer.x - 0.5), py = (pointer.y - 0.5);

    // Background: pure black.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // Faint nebula dust (very low alpha, white).
    for (const d of dust) {
      const dx = d.x * W - px * 8;
      const dy = d.y * H - py * 8;
      const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, d.r);
      g.addColorStop(0, `rgba(255,255,255,${d.a})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(dx, dy, d.r, 0, Math.PI * 2); ctx.fill();
    }

    // Stars, per layer with parallax offset by depth.
    for (const s of stars) {
      const L = LAYERS[s.l];
      // slow constant drift + pointer parallax
      let sx = (s.x * W) - px * L.depth - (t * L.speed) % W;
      let sy = (s.y * H) - py * L.depth;
      // wrap
      sx = ((sx % W) + W) % W;
      sy = ((sy % H) + H) % H;

      const tw = prefersReduced ? 1 : (0.7 + 0.3 * Math.sin(s.tw + t * 0.02 * s.tws));
      // brighten stars near the cursor
      let boost = 1;
      if (pointer.active) {
        const mx = pointer.x * W, my = pointer.y * H;
        const dist = Math.hypot(sx - mx, sy - my);
        boost = 1 + Math.max(0, 1 - dist / 160) * 1.6;
      }
      ctx.globalAlpha = Math.min(1, s.a * tw * boost);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Cursor halo (soft white glow).
    if (pointer.active && !prefersReduced) {
      const mx = pointer.x * W, my = pointer.y * H;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 150);
      g.addColorStop(0, "rgba(255,255,255,0.06)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(mx - 150, my - 150, 300, 300);
    }

    // Shooting stars.
    if (now - lastShoot > rand(2600, 6000)) { lastShoot = now; spawnShooter(); }
    for (const sh of shooters) {
      sh.x += sh.vx; sh.y += sh.vy; sh.life++;
      const p = sh.life / sh.max;
      const fade = Math.sin(Math.min(1, p) * Math.PI);
      const tailX = sh.x - sh.vx * 6, tailY = sh.y - sh.vy * 6;
      const grad = ctx.createLinearGradient(tailX, tailY, sh.x, sh.y);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, `rgba(255,255,255,${0.8 * fade})`);
      ctx.strokeStyle = grad; ctx.lineWidth = 1.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(sh.x, sh.y); ctx.stroke();
    }
    shooters = shooters.filter(s => s.life < s.max && s.x > -80 && s.x < W + 80);

    requestAnimationFrame(frame);
  }

  // Pointer input (parallax + halo). Also supports touch.
  function setPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = (clientX - rect.left) / rect.width;
    pointer.ty = (clientY - rect.top) / rect.height;
    pointer.active = true;
  }
  window.addEventListener("pointermove", (e) => setPointer(e.clientX, e.clientY), { passive: true });
  window.addEventListener("pointerdown", (e) => { setPointer(e.clientX, e.clientY);
    // click = a little burst of shooting stars
    for (let i = 0; i < 2; i++) spawnShooter();
  });
  window.addEventListener("pointerleave", () => { pointer.active = false; pointer.tx = 0.5; pointer.ty = 0.5; });

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize(); build();
  requestAnimationFrame(frame);
})();
