/* =============================================
   HERO SPHERE TEXT WRAP
   ---------------------------------------------
   Wraps the hero bio around the model as text lying
   on the surface of a sphere — like lettering painted
   around a planet. Each CHARACTER is placed on the
   sphere at its own longitude, so words genuinely bend
   and wrap around the curve (not flat plaques). The
   band is tipped forward so the front reads large and
   low; the text shrinks and fades as it wraps away.

   Built with real CSS 3D transforms (perspective +
   rotateY/rotateX + translateZ). Characters on the
   near hemisphere live in a front layer (over the
   model); those on the far hemisphere live in a back
   layer (behind the model) and are faded, so the model
   occludes the back of the wrap while it stays visible
   where it clears the silhouette.

   ── Tune the look here ───────────────────────── */
const RING = {
  radius:    0.46,  // sphere radius as a fraction of the stage's smaller side
  latitude:  0,     // band latitude in degrees (−down / +up from the equator)
  viewTilt: -22,    // sphere tip: negative bows the front band into a "bowl"
  depth:     1.15,  // perspective distance as a fraction of the stage size
                    //   (smaller = stronger near/far size contrast)
  speed:    -0.10,  // spin speed, radians / second (sign flips direction)
  fontFrac:  0.070, // glyph size as a fraction of the stage size
  minAlpha:  0.22,  // opacity of characters on the far side of the sphere
};

(function () {
  const front = document.querySelector('.hero-ring--front');
  const back  = document.querySelector('.hero-ring--back');
  if (!front || !back) return;

  const text = front.getAttribute('data-ring-text') || '';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // One element per character (spaces included, as non-breaking so they hold
  // their slot), spread evenly around the full band so the text wraps exactly
  // once around the sphere.
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  if (!chars.length) return;

  const glyphs = chars.map((ch, i) => {
    const el = document.createElement('span');
    el.className = 'hero-ring-word';
    el.textContent = ch === ' ' ? ' ' : ch;
    front.appendChild(el);
    return { el, lon: (i / chars.length) * Math.PI * 2 };
  });
  const N = glyphs.length;

  const PHI_DEG = RING.latitude;
  const VT_DEG  = RING.viewTilt;
  const PHI = PHI_DEG * Math.PI / 180;
  const VT  = VT_DEG  * Math.PI / 180;
  const sinPhi = Math.sin(PHI), cosPhi = Math.cos(PHI);
  const sinVt  = Math.sin(VT),  cosVt  = Math.cos(VT);

  let spin = 0;
  let Rs = 0;

  function measure() {
    const rect = front.getBoundingClientRect();
    const stage = Math.min(rect.width, rect.height);
    Rs = stage * RING.radius;
    const persp = (stage * RING.depth).toFixed(1) + 'px';
    const fs = (stage * RING.fontFrac).toFixed(2) + 'px';
    [front, back].forEach((l) => { l.style.perspective = persp; });
    for (let i = 0; i < N; i++) glyphs[i].el.style.fontSize = fs;
  }

  function frame(theta) {
    for (let i = 0; i < N; i++) {
      const lon = theta + glyphs[i].lon;          // longitude around the sphere
      const lonDeg = lon * 180 / Math.PI;
      const el = glyphs[i].el;

      // Lay the character on the sphere: spin to its longitude, lift to the band
      // latitude, push out to the surface, tip the whole sphere. Rightmost is
      // applied first, so the box is centred, laid tangent, then rotated out.
      el.style.transform =
        'rotateX(' + VT_DEG + 'deg) ' +
        'rotateY(' + lonDeg.toFixed(2) + 'deg) ' +
        'rotateX(' + (-PHI_DEG) + 'deg) ' +
        'translateZ(' + Rs.toFixed(2) + 'px) ' +
        'translate(-50%,-50%)';

      // Depth (matches the composition above): +toward viewer.
      const z2 = Rs * cosPhi * Math.cos(lon);
      const z3 = Rs * sinPhi * sinVt + z2 * cosVt;
      const f  = (z3 / Rs + 1) / 2;               // 0 = far, 1 = near
      el.style.opacity = (RING.minAlpha + (1 - RING.minAlpha) * f).toFixed(3);

      // Near hemisphere → front layer (over the model); far → back (behind it).
      const parent = z3 >= 0 ? front : back;
      if (el.parentNode !== parent) parent.appendChild(el);
    }
  }

  measure();
  window.addEventListener('resize', measure, { passive: true });

  if (reduce) {
    frame(0);                         // static wrap, no spin
    return;
  }

  let last = performance.now();
  (function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    spin += RING.speed * dt;
    frame(spin);
    requestAnimationFrame(loop);
  })(last);
})();
