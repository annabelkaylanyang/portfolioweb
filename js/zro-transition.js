/* =============================================
   ZRO PAGE TRANSITION  (index.html only)

   Clicking through to the Zro project doesn't load a new page and then
   animate. The transition plays here, on the home page: the Zro page is
   rendered underneath in a frame at full viewport size, and uneven
   fragments of it are cut out and dropped in, bursting from the centre
   of the screen until they've covered it. The fragments aren't coloured
   rectangles standing in for the page - each one is that piece of the
   real page, in the position it will occupy once you land on it. Only
   when the screen is covered does the browser navigate, so the frame
   hands over to the actual page without anything appearing to move.
   ============================================= */
(function () {
  var TARGET = 'project-zro.html';

  var MIN = window.innerWidth < 700 ? 26 : 40;   // smallest fragment edge, px
  var MAX = window.innerWidth < 700 ? 130 : 220; // largest fragment edge, px

  var HOLD   = 110;   // ms before the first fragment lands
  var EXPAND = 1250;  // ms for the burst to reach the far corner
  var WAIT   = 1000;  // ms we'll wait on the frame to render before starting

  /* The front's radius over its lifetime, t and the result both 0..1:

       r(t) = LAUNCH*t + (1 - LAUNCH)*t^EASE

     LAUNCH is how much of the growth is already moving at full speed on
     frame one, so the burst opens fast instead of creeping out of the
     centre. The t^EASE term keeps adding speed on top of that, and with
     EASE between 1 and 2 the speed climbs the whole way while climbing
     less steeply as it goes - gaining less, never losing. There is no
     ease-out: the last fragment lands at full tilt. */
  var LAUNCH = 0.55;
  var EASE   = 1.6;

  var JITTER = 0.06;  // distance noise, so the front isn't a clean circle

  /* Strays: fragments that jump out ahead of the front and land on their
     own, detached from the mass, before the front catches up to them.
     STRAY_ODDS is roughly what share of fragments break rank; STRAY_REACH
     is how far ahead the boldest of them can get, as a share of the full
     radius. The lead is heavily skewed, so most strays sit just off the
     edge and only a few make it far out. Small fragments stray more
     readily than large ones - a stray slab reads as a mistake, a stray
     chip reads as debris. */
  var STRAY_ODDS  = 0.55;
  var STRAY_REACH = 0.45;

  // clip-path: path() with several subpaths is what lets one frame show
  // through as many separate fragments. Without it, fall back to a plain
  // link and no animation.
  var supported = window.CSS && CSS.supports &&
                  CSS.supports('clip-path', 'path("M0 0Z")');

  var sheet = null;   // the fixed overlay
  var view  = null;   // the frame showing the Zro page
  var ready = false;  // has the frame finished loading?
  var running = false;

  /* The frame must match the layout viewport the destination page will
     have. document.documentElement.clientWidth is that width - it already
     excludes the scrollbar, which both pages have. */
  function sizeToViewport() {
    if (!view) return;
    var d = document.documentElement;
    view.style.width  = d.clientWidth + 'px';
    view.style.height = d.clientHeight + 'px';
  }

  /* ---- the frame -------------------------------------------------
     Built on first hover so it has a head start, but the animation
     never waits on it for longer than WAIT. */
  function prewarm(href) {
    if (sheet) return;

    sheet = document.createElement('div');
    sheet.className = 'zro-burst';
    sheet.setAttribute('aria-hidden', 'true');

    view = document.createElement('iframe');
    view.className = 'zro-burst__view';
    view.setAttribute('tabindex', '-1');
    view.setAttribute('scrolling', 'no');
    view.setAttribute('title', '');

    /* Sized in exact pixels rather than percentages. The frame has to lay
       the page out at the same width the real page will get after the
       navigation, or every line of text wraps a pixel differently and the
       whole screen appears to twitch on hand-off. */
    sizeToViewport();

    // Nothing is visible until the first fragment lands.
    view.style.clipPath = 'path("M0 0Z")';

    view.addEventListener('load', function () {
      var doc = view.contentDocument;
      if (!doc) { ready = true; return; }

      /* Wait for the frame's webfonts. If it were still showing fallback
         faces when the fragments landed, the text would reflow the moment
         the real page took over. */
      var fonts = (doc.fonts && doc.fonts.ready)
        ? doc.fonts.ready
        : Promise.resolve();

      /* And for the hero video's first frame to be decoded. Until it is,
         that corner of the frame is an empty box - and the fragments cut
         from it would show nothing where the video belongs. */
      var media = new Promise(function (resolve) {
        var v = doc.querySelector('video[data-start-delay]');
        if (!v || v.readyState >= 2) return resolve();
        v.addEventListener('loadeddata', function () { resolve(); }, { once: true });
      });

      Promise.all([fonts, media]).then(function () { ready = true; });
    });

    view.src = href;

    sheet.appendChild(view);
    document.body.appendChild(sheet);

    // Keep it matched if the window changes size while it sits waiting.
    window.addEventListener('resize', function () {
      if (!running) sizeToViewport();
    });
  }

  function run(href) {
    if (running) return;
    running = true;

    prewarm(href);

    sizeToViewport();

    // Same measure as the frame: the layout viewport, scrollbar excluded.
    // window.innerWidth would include it, and the right-hand column of
    // fragments would then be cut off by the frame's edge.
    var W = document.documentElement.clientWidth;
    var H = document.documentElement.clientHeight;

    /* ---- cut the screen into uneven fragments ----------------------
       Recursive splits along the longer edge, stopping early some of
       the time so large pieces sit next to small ones. */
    var rects = [];

    function cut(x, y, w, h) {
      var splittable = w > MIN * 2 || h > MIN * 2;
      var mustSplit  = w > MAX || h > MAX;

      if (!splittable || (!mustSplit && Math.random() < 0.3)) {
        rects.push({ x: x, y: y, w: w, h: h });
        return;
      }

      var ratio = 0.32 + Math.random() * 0.36;

      if (w >= h) {
        var cw = Math.max(MIN, Math.round(w * ratio));
        cut(x, y, cw, h);
        cut(x + cw, y, w - cw, h);
      } else {
        var ch = Math.max(MIN, Math.round(h * ratio));
        cut(x, y, w, ch);
        cut(x, y + ch, w, h - ch);
      }
    }

    cut(0, 0, W, H);

    /* ---- time them by distance from a single centre ----------------
       One origin only: the burst reads as one thing opening up rather
       than several puddles spreading into each other. */
    var ox = W / 2;
    var oy = H * 0.46;
    var maxDist = 0;
    var i, r;

    for (i = 0; i < rects.length; i++) {
      r = rects[i];
      var dx = (r.x + r.w / 2) - ox;
      var dy = (r.y + r.h / 2) - oy;
      r.d = Math.sqrt(dx * dx + dy * dy);
      if (r.d > maxDist) maxDist = r.d;
    }

    function radius(t) {
      return LAUNCH * t + (1 - LAUNCH) * Math.pow(t, EASE);
    }

    // When the front reaches a given radius.
    function timeFor(u) {
      var lo = 0, hi = 1, mid;
      for (var n = 0; n < 24; n++) {
        mid = (lo + hi) / 2;
        if (radius(mid) < u) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }

    // Smallest and largest fragment areas, for weighting which pieces
    // are allowed to break rank.
    var minArea = Infinity, maxArea = 0;
    for (i = 0; i < rects.length; i++) {
      var a = rects[i].w * rects[i].h;
      if (a < minArea) minArea = a;
      if (a > maxArea) maxArea = a;
    }

    for (i = 0; i < rects.length; i++) {
      r = rects[i];

      var u = r.d / (maxDist || 1) + (Math.random() - 0.5) * 2 * JITTER;

      // Small pieces stray freely, big ones almost never.
      var size = maxArea > minArea
        ? (r.w * r.h - minArea) / (maxArea - minArea)
        : 0;

      if (Math.random() < STRAY_ODDS * (1 - size * 0.85)) {
        // Cubed, so most strays land just off the edge of the mass and
        // only the occasional one gets right out in front.
        u -= Math.pow(Math.random(), 3) * STRAY_REACH;
      }

      // Nothing outruns the opening moment - strays still need the burst
      // to have started.
      u = Math.min(1, Math.max(0.06, u));

      r.at = HOLD + timeFor(u) * EXPAND;
      // +1px so neighbouring cut-outs overlap and leave no seams.
      r.sub = 'M' + r.x + ' ' + r.y +
              'h' + (r.w + 1) +
              'v' + (r.h + 1) +
              'h' + -(r.w + 1) + 'Z';
    }

    rects.sort(function (a, b) { return a.at - b.at; });

    /* ---- one clock for every fragment ------------------------------
       Each frame, whatever is due gets added to the clip path. Nothing
       fades: a fragment is absent until the frame it appears, then it's
       there in full. */
    var next = 0;
    var start = 0;
    var path = '';

    /* Hand the exact first frame of the hero video over to the next page.
       That page can show it instantly as a poster while its own <video>
       decodes, instead of leaving a black slot for a moment - which is
       the flick you see at the switch. It's grabbed from the frame's
       video, so it's the same pixels, not a re-encoded stand-in. */
    function stashHeroStill() {
      try {
        var doc = view.contentDocument;
        var v = doc && doc.querySelector('video[data-start-delay]');
        if (!v || v.readyState < 2 || !v.videoWidth) return;

        var w = Math.min(1920, v.videoWidth);
        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = Math.round(v.videoHeight * (w / v.videoWidth));
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);

        sessionStorage.setItem(
          'zroHeroStill:' + v.currentSrc.split('/').pop(),
          canvas.toDataURL('image/jpeg', 0.88)
        );
      } catch (e) {
        // Tainted canvas (file:// has no real origin) or storage full.
        // The page just falls back to decoding its own first frame.
      }
    }

    function done() {
      // Drop the clip entirely so the frame is whole, in case a
      // sub-pixel gap survived, then hand over to the real page.
      view.style.clipPath = 'none';
      stashHeroStill();
      window.location.href = href;
    }

    function tick(now) {
      if (!start) start = now;
      var elapsed = now - start;

      var added = false;
      while (next < rects.length && rects[next].at <= elapsed) {
        path += rects[next].sub;
        next++;
        added = true;
      }
      if (added) view.style.clipPath = 'path("' + path + '")';

      if (next < rects.length) requestAnimationFrame(tick);
      else done();
    }

    // Give the frame a moment to render so the first fragments aren't
    // blank, but never stall the click on it.
    var waited = 0;
    (function begin() {
      if (ready || waited >= WAIT) {
        requestAnimationFrame(function () { requestAnimationFrame(tick); });
        return;
      }
      waited += 50;
      window.setTimeout(begin, 50);
    })();

    // Safety net: never strand someone on a half-covered home page.
    window.setTimeout(done, WAIT + (HOLD + EXPAND) * 3);
  }

  /* ---- intercept the ways into the Zro page ------------------------
     Capture phase, so this runs before the card's own click handler in
     main.js gets a chance to navigate. */
  function targetOf(el) {
    if (!el || !el.closest) return null;
    var link = el.closest('a[href], [data-href]');
    if (!link) return null;
    var href = link.getAttribute('href') || link.getAttribute('data-href');
    return (href && href.split('/').pop() === TARGET) ? href : null;
  }

  if (!supported) return;

  // Start loading the Zro page as soon as the pointer is over the link.
  document.addEventListener('pointerover', function (e) {
    var href = targetOf(e.target);
    if (href) prewarm(href);
  }, true);

  /* The project cards double as drag-scrollers, so a drag that ends on
     the card is not a click through to the project. Same test main.js
     uses for its own data-href navigation. */
  var downX = 0, downY = 0, dragged = false;

  document.addEventListener('pointerdown', function (e) {
    downX = e.clientX;
    downY = e.clientY;
    dragged = false;
  }, true);

  document.addEventListener('pointerup', function (e) {
    dragged = Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8;
  }, true);

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey ||
        e.ctrlKey || e.shiftKey || e.altKey) return;
    if (dragged) return;

    var href = targetOf(e.target);
    if (!href) return;

    // Respect the reduced-motion preference: just follow the link.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    e.preventDefault();
    e.stopPropagation();
    run(href);
  }, true);
})();
