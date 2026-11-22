// Crema hero: swirl logos fall with gravity and settle on the ground and the phone.
(function () {
  const wrap = document.querySelector('.cr-hero-wrap');
  if (!wrap) return;
  const img = wrap.querySelector('img');
  const cv = document.createElement('canvas');
  cv.className = 'cr-rain';
  wrap.appendChild(cv);
  const ctx = cv.getContext('2d');
  const logo = new Image();
  logo.src = 'images/crema/logo-swirl.svg';

  // phone in the source image (4214x2344), as fractions
  const PH = { l: 0.371, r: 0.629, t: 0.202 };
  const IW = 4214, IH = 2344;
  let W = 0, H = 0, dpr = 1, phone = null, bodies = [], spawned = 0, running = false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function layout() {
    const r = wrap.getBoundingClientRect();
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    W = r.width / z; H = r.height / z;
    dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    // object-fit: cover mapping
    const s = Math.max(W / IW, H / IH);
    const ox = (W - IW * s) / 2, oy = (H - IH * s) / 2;
    phone = { l: ox + PH.l * IW * s, r: ox + PH.r * IW * s, t: oy + PH.t * IH * s };
  }

  function spawn() {
    const rad = W * (0.012 + Math.random() * 0.03);
    bodies.push({
      x: (() => { const L = phone.l - 2 * rad, R = W - phone.r - 2 * rad; const p = Math.random() * (L + R); return p < L ? rad + p : phone.r + rad + (p - L); })(), y: -rad - Math.random() * 40,
      vx: 0, vy: 0, r: rad,
      a: Math.random() * Math.PI * 2, va: (Math.random() - 0.5) * 0.05,
    });
  }

  function step() {
    for (const b of bodies) if (!b.rest && b.hit && (b.hit = false, true) && Math.abs(b.vy) < 0.6 && Math.abs(b.vx) < 0.6) { b.rest = true; b.va = 0; }
    const g = 0.28, damp = 0.25; // low restitution: settle, small nudge on impact
    for (const b of bodies) {
      if (b.rest) continue;
      b.vy += g; b.x += b.vx; b.y += b.vy; b.a += b.va; b.va *= 0.97;
      // ground
      if (b.y + b.r > H) { b.y = H - b.r; b.vy *= -damp; b.vx *= 0.85; b.va = 0; b.hit = true; }
      // walls
      if (b.x - b.r < 0) { b.x = b.r; b.vx *= -damp; }
      if (b.x + b.r > W) { b.x = W - b.r; b.vx *= -damp; }
      // phone (box from phone.t to the bottom), resolve against nearest point
      const cx = Math.max(phone.l, Math.min(b.x, phone.r));
      const cy = Math.max(phone.t, Math.min(b.y, H));
      let dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      if (d < b.r) {
        if (d === 0) { dx = 0; dy = -1; d = 1; }
        const nx = dx / d, ny = dy / d, pen = b.r - d;
        b.x += nx * pen; b.y += ny * pen;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + damp) * vn * nx; b.vy -= (1 + damp) * vn * ny; }
        b.vx *= 0.9; b.va = 0; if (ny < -0.5) b.hit = true;
      }
    }
    // body-body
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], c = bodies[j];
      const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy), m = a.r + c.r;
      if (d > 0 && d < m) {
        if (a.rest && c.rest) continue;
        const nx = dx / d, ny = dy / d;
        const wa = a.rest ? 0 : c.rest ? 1 : 0.5, wc = 1 - wa, pen = m - d;
        a.x -= nx * pen * wa; a.y -= ny * pen * wa; c.x += nx * pen * wc; c.y += ny * pen * wc;
        if (c.rest && ny > 0.3) a.hit = true; if (a.rest && ny < -0.3) c.hit = true;
        const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rv < 0) {
          const k = -(1 + damp) * rv * (a.rest || c.rest ? 1 : 0.5);
          if (!a.rest) { a.vx -= k * nx; a.vy -= k * ny; }
          if (!c.rest) { c.vx += k * nx; c.vy += k * ny; }
          a.va = c.va = 0;
        }
      }
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const b of bodies) {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      const w = b.r * 2, h = w * 1813 / 1692;
      ctx.drawImage(logo, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  let last = 0, prev = 0, acc = 0;
  function loop(t) {
    if (!prev) prev = t;
    acc += Math.min(250, t - prev); prev = t;
    while (acc >= 8) { // fixed 8ms physics steps, so throttled frames don't slow it
      acc -= 8; last += 8;
      if (spawned < 20 && last >= 90) { spawn(); spawned++; last = 0; }
      step();
    }
    draw();
    requestAnimationFrame(loop);
  }

  function start() {
    if (running) return; running = true;
    layout();
    if (reduce) { // static pile, no animation
      for (let i = 0; i < 20; i++) spawn();
      for (let i = 0; i < 1500; i++) step();
      draw(); return;
    }
    requestAnimationFrame(loop);
  }

  addEventListener('resize', () => {
    if (!running) return;
    const ow = W, oh = H; layout();
    const sx = W / ow, sy = H / oh;
    if (isFinite(sx) && isFinite(sy)) for (const b of bodies) { b.x *= sx; b.y *= sy; b.r *= sx; }
    draw();
  });
  const go = () => (img.complete ? start() : img.addEventListener('load', start, { once: true }));
  logo.onload = go;
  if (logo.complete) go();
})();
