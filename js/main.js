/* =============================================
   LOADING SCREEN
   ---------------------------------------------
   Stays up until:
     1. the 3D hero model is ready ('hero-model-ready')
     2. every <img> / <video> in the work section
        (and other above-the-fold media) has loaded
   A safety cap prevents an infinite hang on a
   broken asset. Project media uses eager load so
   it actually fetches while the loader is visible
   (lazy would defer until scroll and never finish).
   ============================================= */
(function () {
  var loader = document.getElementById('siteLoader');
  if (!loader) return;

  var start = Date.now();
  var MIN_MS = 900;
  // Deliberately generous: better a longer load than projects that stutter
  // in on scroll. Only a broken asset should ever reach this.
  var MAX_MS = 180000;
  var done = false;
  var heroReady = false;
  var mediaReady = false;

  /* ── Progress readout ────────────────────────
     The number is real: it's the share of the work this screen is actually
     waiting on. Every media item counts as one unit and only completes when
     it's decoded / buffered (the same signal that releases the loader), and
     the 3D model counts as one more unit that fills continuously from its
     own download progress. Nothing is invented on a timer, so the bar can
     legitimately sit still while a large file downloads. */
  var bar  = document.getElementById('loaderBar');
  var fill = document.getElementById('loaderFill');
  var pct  = document.getElementById('loaderPct');

  var mediaTotal = 0;     // set once the media list is built
  var mediaDone  = 0;
  var modelUnits = document.getElementById('hero3d') ? 1 : 0;
  var modelFrac  = 0;
  var shown      = 0;     // never allowed to run backwards

  function paint() {
    var total = mediaTotal + modelUnits;
    var value = total ? (mediaDone + modelFrac * modelUnits) / total : 1;

    // Hold at 99 until everything is genuinely finished, so 100% always
    // means done rather than nearly-done.
    var next = Math.min(99, Math.floor(value * 100));
    if (done || (mediaReady && heroReady)) next = 100;
    if (next < shown) return;
    shown = next;

    if (fill) fill.style.width = shown + '%';
    if (pct)  pct.textContent = shown + '%';
    if (bar)  bar.setAttribute('aria-valuenow', String(shown));
  }

  document.addEventListener('hero-model-progress', function (e) {
    var d = e.detail || {};
    if (typeof d.fraction === 'number' && isFinite(d.fraction)) {
      modelFrac = Math.min(1, Math.max(modelFrac, d.fraction));
      paint();
    }
  });

  function hide() {
    if (done) return;
    if (!heroReady || !mediaReady) return;
    done = true;
    paint();                                  // land on a true 100%
    var wait = Math.max(0, MIN_MS - (Date.now() - start));
    setTimeout(function () {
      loader.classList.add('is-hidden');
      document.documentElement.classList.remove('is-loading');
      // Signals other scripts (e.g. the homepage scroll-memory below) that
      // it's now safe to move the page — layout is settled and overflow
      // is no longer locked.
      document.dispatchEvent(new Event('site-loader-hidden'));
      setTimeout(function () { if (loader.parentNode) loader.remove(); }, 600);
    }, wait);
  }

  function tryHide() { hide(); }

  /* ── Hero 3D ───────────────────────────────── */
  document.addEventListener('hero-model-ready', function () {
    heroReady = true;
    modelFrac = 1;
    paint();
    tryHide();
  });
  // If this page has no hero mount, don't block on the model.
  if (!document.getElementById('hero3d')) {
    heroReady = true;
    tryHide();
  }

  /* ── Page / project media ───────────────────── */
  // Force eager fetch on work-section media so the loader can wait on them.
  var work = document.getElementById('work');
  var media = [];
  if (work) {
    work.querySelectorAll('img, video').forEach(function (el) {
      if (el.tagName === 'IMG') {
        el.loading = 'eager';
        el.setAttribute('loading', 'eager');
      } else if (el.tagName === 'VIDEO') {
        el.preload = 'auto';
        el.setAttribute('preload', 'auto');
      }
      media.push(el);
    });
  }
  // Also wait on logo / other critical imgs outside work
  document.querySelectorAll('.nav-logo img, .footer-logo img').forEach(function (el) {
    media.push(el);
  });

  var pending = media.length;
  mediaTotal = media.length;
  paint();

  if (!pending) {
    mediaReady = true;
    tryHide();
  } else {
    function oneDone() {
      pending -= 1;
      mediaDone += 1;
      paint();
      if (pending <= 0) {
        mediaReady = true;
        paint();
        tryHide();
      }
    }
    /* An image that has merely finished downloading still has to be
       decoded, and a video that can show one frame still has to buffer.
       Both of those land on the first frame of the reveal animation and
       show up as the projects stuttering in. So wait for the stronger
       signal on each: decoded bitmap, and enough buffered to play
       through. The loading screen is the right place to spend that time. */
    function whenDecoded(img) {
      if (img.decode) {
        img.decode().then(oneDone, oneDone);
      } else {
        oneDone();
      }
    }

    media.forEach(function (el) {
      if (el.tagName === 'IMG') {
        if (el.complete && el.naturalWidth > 0) { whenDecoded(el); return; }
        el.addEventListener('load', function () { whenDecoded(el); }, { once: true });
        el.addEventListener('error', oneDone, { once: true });
      } else {
        // video: buffered far enough to play without stalling
        if (el.readyState >= 4) { oneDone(); return; }
        el.addEventListener('canplaythrough', oneDone, { once: true });
        el.addEventListener('error', oneDone, { once: true });
        // Kick load in case autoplay/preload hasn't started
        try { el.load(); } catch (e) {}
      }
    });
  }

  // Safety: never hang forever (huge GIFs / offline assets).
  setTimeout(function () {
    heroReady = true;
    mediaReady = true;
    tryHide();
  }, MAX_MS);
})();


/* =============================================
   HOMEPAGE SCROLL MEMORY
   ---------------------------------------------
   Leaving the homepage to open a project and then coming back should land
   you where you left off, not back at the top. sessionStorage (rather than
   relying on the browser's own history scroll restoration) means this
   works the same way whether the return trip is a real back-navigation or
   a fresh link back to index.html — both are just "returning within this
   tab", which is exactly the case this should cover. A brand-new tab has
   nothing saved, so it starts at the top as normal.
   ============================================= */
(function () {
  // Only the homepage has a #work section — every other page keeps the
  // browser's default scroll behaviour untouched.
  if (!document.getElementById('work')) return;

  var KEY = 'homeScrollY';

  // Take control from the browser so its own restoration attempt (which
  // can fire before the loader's layout has settled) never fights with
  // the deliberate restore below.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  // Keep the saved position current as the user scrolls, throttled to
  // once per frame so this never competes with scroll-driven work
  // elsewhere (the reveal-on-scroll observer, the project carousels).
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      sessionStorage.setItem(KEY, String(window.scrollY));
      ticking = false;
    });
  }, { passive: true });

  var saved = sessionStorage.getItem(KEY);
  if (!saved || saved === '0') return;
  var y = parseInt(saved, 10);
  if (!y) return;

  // While the loader is up, html.is-loading locks overflow — the page
  // can't actually be scrolled yet, so wait for it to clear. If the
  // loader has already been removed (e.g. this script re-ran), jump
  // immediately instead of waiting for an event that will never fire.
  function restore() {
    // The site sets `scroll-behavior: smooth` globally, which would turn
    // this into a visible glide down the page right after load — the
    // opposite of "already where you left off". Force it instant.
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  }
  if (document.documentElement.classList.contains('is-loading')) {
    document.addEventListener('site-loader-hidden', restore, { once: true });
  } else {
    restore();
  }
})();


/* =============================================
   LIGHT / DARK MODE
   ============================================= */
(function () {
  var html   = document.documentElement;
  var toggle = document.getElementById('modeToggle');

  var saved = localStorage.getItem('theme') || 'light';
  html.setAttribute('data-theme', saved);

  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }
})();


/* =============================================
   ACTIVE NAV LINK  (index.html only)
   ============================================= */
(function () {
  if (!document.querySelector('section[id]')) return;

  var sections = document.querySelectorAll('section[id]');
  var navLinks  = document.querySelectorAll('.nav-links a');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var id = '#' + entry.target.id;
      navLinks.forEach(function (link) {
        link.classList.toggle('active', link.getAttribute('href') === id);
      });
    });
  }, { rootMargin: '-35% 0px -60% 0px' });

  sections.forEach(function (s) { io.observe(s); });
})();


/* =============================================
   PROJECT IMAGE CAROUSELS
   ---------------------------------------------
   Transform-based, bounded strip. A translateX on the
   track is driven by a damped rAF loop (instead of
   native scrolling, which fights momentum and the
   click-vs-drag distinction below). The strip stops at
   its own two ends — it does not loop.

   Input:
     • horizontal trackpad swipe anywhere over the
       project area (|deltaX| > |deltaY|) moves the
       strip; vertical scroll passes to the page.
     • click-drag on the strip scrubs it 1:1.
     • a tap (no drag) opens the project page.
   ============================================= */
(function () {
  document.querySelectorAll('.project-scroll').forEach(function (scroller) {
    var track = scroller.querySelector('.project-images');
    if (!track) return;

    var originals = Array.from(track.children);
    // A carousel with nothing in it would otherwise sit as an empty band.
    if (!originals.length) { scroller.classList.add('is-empty'); return; }
    if (originals.length < 2) return;

    function playVideos() {
      track.querySelectorAll('video').forEach(function (v) {
        v.muted = true;
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      });
    }
    playVideos();
    track.querySelectorAll('video').forEach(function (v) {
      v.addEventListener('loadeddata', playVideos, { once: true });
    });

    // How far the strip can travel: its full width minus what's visible.
    // 0 (or negative, clamped to 0) means everything already fits — no
    // scrolling needed at all.
    var maxScroll = 0;
    function measure() {
      maxScroll = Math.max(0, track.scrollWidth - scroller.clientWidth);
      // Clamp in case the viewport grew since the last measurement — never
      // leave the strip parked past its own new end.
      target = Math.min(target, maxScroll);
      pos    = Math.min(pos, maxScroll);
      applied = null;
      thumbApplied = null;
      paintThumb();
    }

    // `target` is where we want to be; `pos` eases toward it each frame.
    // Both are always kept inside [0, maxScroll] — this is what makes the
    // strip stop at its ends instead of wrapping.
    var pos = 0, target = 0, dragging = false, moved = false, lastX = 0;

    function clamp(v) { return Math.min(maxScroll, Math.max(0, v)); }

    measure();
    window.addEventListener('resize', measure, { passive: true });
    // content-visibility skips layout while the entry is off screen; re-measure
    // when it lays out (and on any later size change) so maxScroll is correct.
    if (window.ResizeObserver) new ResizeObserver(measure).observe(track);
    // Media can lay out after load — re-measure so maxScroll is accurate.
    track.querySelectorAll('img, video').forEach(function (media) {
      if (media.tagName === 'VIDEO') {
        if (media.readyState < 1) media.addEventListener('loadedmetadata', measure, { once: true });
      } else if (!media.complete) {
        media.addEventListener('load', measure, { once: true });
      }
    });

    /* ── Slider ───────────────────────────────────────────────────────────
       A drag handle for the strip, sitting just below it. Since the strip
       is now bounded, the thumb is a conventional scrollbar-style handle:
       its width is the share of the full strip currently visible, and it
       runs the strip's whole length exactly once, start to end. It lives
       outside .project-scroll so dragging it can't be mistaken for a tap
       on the strip (which opens the project). */
    var slider = document.createElement('div');
    slider.className = 'project-slider';
    var thumb = document.createElement('div');
    thumb.className = 'project-slider__thumb';
    slider.appendChild(thumb);
    scroller.insertAdjacentElement('afterend', slider);

    var thumbApplied = null;

    function paintThumb() {
      // measure() can fire before the slider exists (it runs during setup).
      if (!slider) return;
      var trackW = slider.clientWidth;
      var fullW = track.scrollWidth;
      if (!maxScroll || !trackW || !fullW) {   // nothing to scroll through
        slider.classList.add('is-idle');
        return;
      }
      slider.classList.remove('is-idle');

      var tw = Math.max(32, trackW * (scroller.clientWidth / fullW));
      var x = (pos / maxScroll) * (trackW - tw);
      if (thumbApplied === null || Math.abs(x - thumbApplied) > 0.5) {
        thumb.style.width = tw.toFixed(1) + 'px';
        thumb.style.transform = 'translate3d(' + x.toFixed(1) + 'px,-50%,0)';
        thumbApplied = x;
      }
    }

    var applied = null;
    (function loop() {
      requestAnimationFrame(loop);
      // 1:1 while dragging (direct manipulation), smooth glide otherwise.
      pos += (target - pos) * (dragging ? 1 : 0.14);
      var w = -pos;
      // Skip the style write when nothing moved — avoids constant idle reflows
      // across every project carousel on the page.
      if (applied === null || Math.abs(w - applied) > 0.01) {
        track.style.transform = 'translate3d(' + w.toFixed(2) + 'px,0,0)';
        applied = w;
        paintThumb();
      }
    })();
    paintThumb();

    /* Dragging the slider moves the strip 1:1 — pos is set alongside target
       so there's no easing lag under the finger. */
    var sliding = false;

    function seekFrom(clientX) {
      var box = slider.getBoundingClientRect();
      if (!maxScroll || !box.width) return;

      var tw = Math.max(32, box.width * (scroller.clientWidth / track.scrollWidth));
      var span = Math.max(1, box.width - tw);
      var f = Math.min(1, Math.max(0, (clientX - box.left - tw / 2) / span));
      target = f * maxScroll;
      pos = target;
      applied = null;                    // force the track to repaint
    }

    slider.addEventListener('pointerdown', function (e) {
      sliding = true;
      slider.classList.add('is-active');
      try { slider.setPointerCapture(e.pointerId); } catch (err) {}
      seekFrom(e.clientX);
      e.preventDefault();
      e.stopPropagation();
    });
    slider.addEventListener('pointermove', function (e) {
      if (sliding) seekFrom(e.clientX);
    });
    function endSlide() {
      sliding = false;
      slider.classList.remove('is-active');
    }
    slider.addEventListener('pointerup', endSlide);
    window.addEventListener('pointerup', endSlide);
    window.addEventListener('pointercancel', endSlide);
    // Never let a slider drag fall through as a click on the project.
    slider.addEventListener('click', function (e) { e.stopPropagation(); });

    window.addEventListener('resize', function () {
      thumbApplied = null;
      paintThumb();
    }, { passive: true });

    /* ── Horizontal swipe over the whole project area ─────────────────────
       Bound to the entry so hovering the title/description works too. Only
       horizontal intent is captured; vertical scroll falls through to the page. */
    var area = scroller.closest('.project-entry') || scroller;
    area.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // vertical → page
      if (maxScroll === 0) return;                            // nothing to scroll
      e.preventDefault();
      target = clamp(target + e.deltaX);
    }, { passive: false });

    /* ── Pointer drag scrubs the strip 1:1; a tap navigates ─────────────── */
    scroller.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false;
      lastX = e.clientX;
      target = pos;                     // cancel any residual glide
      try { scroller.setPointerCapture(e.pointerId); } catch (err) {}
      scroller.style.cursor = 'grabbing';
    });
    scroller.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX;
      lastX = e.clientX;
      if (Math.abs(dx) > 1) moved = true;
      target = clamp(target - dx);
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      scroller.style.cursor = 'grab';
      try { scroller.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    scroller.addEventListener('pointerup', endDrag);
    scroller.addEventListener('pointercancel', endDrag);
    scroller.addEventListener('click', function () {
      if (!moved && scroller.dataset.href) window.location.href = scroller.dataset.href;
    });
  });
})();


/* =============================================
   PLAY — PARALLAX COLUMNS  (play.html only)
   ---------------------------------------------
   Each column translates vertically at its own
   speed (depth). Every column's cards are duplicated
   once so it loops seamlessly: once a column passes
   its own set height, the offset wraps back to the
   top over identical content — no visible jump.

   Columns start at staggered offsets. Whichever
   column the cursor is over becomes the fastest, so
   the user always drives the column they're looking
   at (the others ease along slower).
   ============================================= */
(function () {
  var root = document.getElementById('parallax');
  if (!root) return;

  var cols = Array.from(root.querySelectorAll('.parallax-col'));
  if (!cols.length) return;

  var state = cols.map(function (col) {
    var track = col.querySelector('.parallax-col-track');
    // Duplicate the cards once so the column can wrap seamlessly.
    Array.from(track.children).forEach(function (card) {
      var clone = card.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
    return {
      col: col,
      track: track,
      base: parseFloat(col.dataset.speed) || 0.7,   // depth speed
      setH: 0,                                       // height of one set
      pos: 0,
      vel: 0,                                        // momentum (glide) velocity
      applied: null,
      staggered: false
    };
  });

  function measure() {
    state.forEach(function (s, i) {
      s.setH = s.track.scrollHeight / 2;
      // Offset each column to a different starting Y so they don't line up.
      if (!s.staggered && s.setH) {
        s.pos = (i / state.length) * s.setH;
        s.staggered = true;
      }
    });
  }
  measure();
  window.addEventListener('resize', measure, { passive: true });
  root.querySelectorAll('img').forEach(function (img) {
    if (!img.complete) img.addEventListener('load', measure, { once: true });
  });

  // Track which column the cursor is over → that one runs fastest.
  var hovered = -1;
  root.addEventListener('pointermove', function (e) {
    hovered = -1;
    for (var i = 0; i < state.length; i++) {
      var r = state[i].col.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right) { hovered = i; break; }
    }
  });
  root.addEventListener('pointerleave', function () { hovered = -1; });

  var HOVER_SPEED = 1.4;   // speed factor for the column under the cursor
  // Each wheel tick adds to a per-column velocity; friction then eases it to a
  // stop, so every column keeps gliding for a moment after you stop scrolling.
  root.addEventListener('wheel', function (e) {
    e.preventDefault();
    for (var i = 0; i < state.length; i++) {
      var speed = (i === hovered) ? HOVER_SPEED : state[i].base;
      state[i].vel += e.deltaY * speed * 0.12;
    }
  }, { passive: false });

  function wrap(v, h) { return h ? ((v % h) + h) % h : 0; }

  var FRICTION = 0.93;   // higher = longer glide after scrolling stops
  (function loop() {
    requestAnimationFrame(loop);
    for (var i = 0; i < state.length; i++) {
      var s = state[i];
      s.vel *= FRICTION;
      if (Math.abs(s.vel) < 0.02) s.vel = 0;
      s.pos += s.vel;
      var w = -wrap(s.pos, s.setH);
      if (s.applied === null || Math.abs(w - s.applied) > 0.01) {
        s.track.style.transform = 'translate3d(0,' + w.toFixed(2) + 'px,0)';
        s.applied = w;
      }
    }
  })();
})();


/* =============================================
   REVEAL ON SCROLL-IN  (replays on re-entry)
   ---------------------------------------------
   `.in-view` gates the CSS reveal animations. We put
   it on two things:
     • the selected-work index (.hero-index)
     • the WHOLE work section (#work)
   For #work, every project's text/lines/images are
   gated on `#work.in-view`, so they all play once when
   the work portion enters the viewport and reset when
   it fully leaves — meaning scrolling BETWEEN projects
   (without leaving #work) never re-triggers them, but
   leaving and re-entering the work portion does.
   ============================================= */
(function () {
  var items = document.querySelectorAll('.hero-index, #work');
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in-view'); });
    return;
  }

  // threshold 0: in-view the moment any part shows, out only when it fully
  // leaves. #work is much taller than the viewport, so it stays in-view the
  // entire time you scroll through its projects.
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      entry.target.classList.toggle('in-view', entry.isIntersecting);
    });
  }, { threshold: 0 });

  items.forEach(function (el) { io.observe(el); });
})();


/* =============================================
   CUSTOM CURSOR  (white pixel, exclusion blend)
   ---------------------------------------------
   Creates one dot, appended to <body>, and moves it
   1:1 with the pointer. Hidden until the first mouse
   move and whenever the mouse leaves the window, so
   no stray dot lingers. Skipped on touch devices.
   ============================================= */
(function () {
  if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  var dot = document.createElement('div');
  dot.className = 'cursor-dot';
  dot.setAttribute('aria-hidden', 'true');

  function mount() {
    (document.body || document.documentElement).appendChild(dot);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    dot.style.transform =
      'translate(' + e.clientX + 'px,' + e.clientY + 'px) translate(-50%,-50%)';
    dot.style.opacity = '1';
  }, { passive: true });

  // Hide when the pointer leaves the document or the window loses focus.
  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget && !e.toElement) dot.style.opacity = '0';
  });
  window.addEventListener('blur', function () { dot.style.opacity = '0'; });
})();
