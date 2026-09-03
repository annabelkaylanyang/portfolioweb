/* =============================================
   PLAY — LIGHTBOX  (play.html only)
   ---------------------------------------------
   Clicking a gallery card dims the page and shows that piece enlarged and
   centred. Cards carrying a data-group open as a set; cards without one open
   alone. Two ways of moving through a set:

     • slides  — side arrows, wrapping forever in both directions (default)
     • book    — data-view="book": the set opens as a bound zine, two pages
                 to a spread, turned a leaf at a time around a centre spine

   The sets themselves are declared in play.html (<script id="playGroups">),
   so adding artwork is an HTML edit and this file stays behavioural.
   ============================================= */
(function () {
  var box = document.getElementById('lightbox');
  var groupsEl = document.getElementById('playGroups');
  var gallery = document.getElementById('parallax');
  if (!box || !gallery) return;

  var groups = {};
  if (groupsEl) {
    try {
      groups = JSON.parse(groupsEl.textContent) || {};
    } catch (e) {
      console.warn('[play-lightbox] Could not parse #playGroups:', e);
    }
  }

  var stage    = box.querySelector('[data-role="stage"]');
  var counter  = box.querySelector('[data-role="counter"]');
  var prevBtn  = box.querySelector('[data-role="prev"]');
  var nextBtn  = box.querySelector('[data-role="next"]');
  var closeBtn = box.querySelector('[data-role="close"]');

  var items = [];        // current set: array of src strings
  var index = 0;
  var mode  = 'slides';  // 'slides' | 'book'
  var lastFocused = null;

  var VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;

  /* ---- shared helpers ------------------------------------------------ */

  function altFor(src) {
    var card = gallery.querySelector('img[src="' + src.replace(/"/g, '\\"') + '"]');
    if (card && card.alt) return card.alt;
    return src.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  }

  function preload(src) {
    if (!src || VIDEO_RE.test(src)) return;
    var img = new Image();
    img.src = src;
  }

  /* Wrap in both directions — what makes the cycle endless. */
  function step(delta) {
    var n = items.length;
    return ((index + delta) % n + n) % n;
  }

  /* =============================================================
     SLIDES
     ============================================================= */
  function renderSlide() {
    var src = items[index];
    if (!src) return;
    stage.innerHTML = '';

    var node;
    if (VIDEO_RE.test(src)) {
      node = document.createElement('video');
      node.src = src;
      node.muted = true;
      node.loop = true;
      node.autoplay = true;
      node.playsInline = true;
      node.setAttribute('playsinline', '');
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      node = document.createElement('img');
      node.src = src;
      node.alt = altFor(src);
      node.decoding = 'async';
    }
    node.className = 'lightbox__media';
    stage.appendChild(node);

    var many = items.length > 1;
    prevBtn.hidden = !many;
    nextBtn.hidden = !many;
    counter.textContent = many ? (index + 1) + ' / ' + items.length : '';
    if (many) preload(items[step(1)]);
  }

  /* =============================================================
     BOOK — a bound zine, two pages to a spread
     -------------------------------------------------------------
     The interior pages are laid out the way they would be printed: page 1
     alone on the right, then 2|3, 4|5, and so on. Turning forward lifts the
     right-hand page, swings it left about the spine, and sets it down as the
     new left-hand page — so the leaf's reverse is the very next page, and the
     one after that is uncovered beneath it.

     Spread s therefore holds pages 2s-1 (left) and 2s (right), which makes
     spread 0 the lone opening page. Sides that fall outside the set are blank,
     exactly as the inside of a cover would be.
     ============================================================= */
  var book = null;

  var TURN_MS  = 760;    // a leaf's travel time
  var MAX_BOW  = 0.055;  // bow of the top edge, as a share of page height
  var MAX_FOLD = 0.16;   // how far the free top corner rolls inward, likewise

  // A cosine ease rather than a stepped cubic — it has no seam at the
  // midpoint, so the turn reads as one continuous motion instead of two
  // halves glued together, and it eases off the start/landing the most,
  // which is where a dropped frame is most visible.
  function easeInOut(t) {
    return 0.5 - 0.5 * Math.cos(t * Math.PI);
  }

  function pageAt(i) {
    return (i >= 0 && i < book.pages.length) ? book.pages[i] : null;
  }

  function spreadCount(n) {
    return Math.floor(n / 2) + 1;   // page 1 sits alone, then pairs
  }

  function buildBook(pages) {
    stage.innerHTML = '';
    prevBtn.hidden = true;    // the leaf itself is the control now
    nextBtn.hidden = true;

    var root = document.createElement('div');
    root.className = 'lightbox__book';

    var inner = document.createElement('div');
    inner.className = 'lightbox__book-inner';

    function makePage(side) {
      var el = document.createElement('div');
      el.className = 'zine-page zine-page--' + side;
      el.appendChild(document.createElement('img'));
      return el;
    }

    function makeFace(side) {
      var f = document.createElement('div');
      f.className = 'zine-face zine-face--' + side;
      f.appendChild(document.createElement('img'));
      var sh = document.createElement('span');
      sh.className = 'zine-shade';
      f.appendChild(sh);
      var curlShine = document.createElement('span');
      curlShine.className = 'zine-curl';
      f.appendChild(curlShine);
      return f;
    }

    var leftPage = makePage('left');
    var rightPage = makePage('right');

    var leaf = document.createElement('div');
    leaf.className = 'zine-sheet zine-sheet--turn';
    var front = makeFace('front');
    var back = makeFace('back');
    leaf.appendChild(front);
    leaf.appendChild(back);
    leaf.hidden = true;

    inner.appendChild(leftPage);
    inner.appendChild(rightPage);
    inner.appendChild(leaf);
    root.appendChild(inner);

    var prevHit = document.createElement('button');
    prevHit.type = 'button';
    prevHit.className = 'lightbox__book-hit lightbox__book-hit--prev';
    prevHit.setAttribute('aria-label', 'Previous page');

    var nextHit = document.createElement('button');
    nextHit.type = 'button';
    nextHit.className = 'lightbox__book-hit lightbox__book-hit--next';
    nextHit.setAttribute('aria-label', 'Next page');

    root.appendChild(prevHit);
    root.appendChild(nextHit);
    stage.appendChild(root);

    prevHit.addEventListener('click', function (e) { e.stopPropagation(); flip(-1); });
    nextHit.addEventListener('click', function (e) { e.stopPropagation(); flip(1); });

    book = {
      root: root,
      inner: inner,
      leftPage: leftPage,
      leftImg: leftPage.querySelector('img'),
      rightPage: rightPage,
      rightImg: rightPage.querySelector('img'),
      leaf: leaf,
      front: front,
      back: back,
      frontImg: front.querySelector('img'),
      frontShade: front.querySelector('.zine-shade'),
      frontCurl: front.querySelector('.zine-curl'),
      backImg: back.querySelector('img'),
      backShade: back.querySelector('.zine-shade'),
      backCurl: back.querySelector('.zine-curl'),
      pages: pages,
      spread: 0,
      spreads: spreadCount(pages.length),
      aspect: 0.75,        // seeded to the zine's page ratio; refined on load
      seen: {},
      w: 0,
      h: 0,
      shiftFrom: 0,
      shiftTo: 0,
      turning: false
    };

    /* Learn the real page ratio from the artwork as it arrives. The median
       ignores any odd one out, so the book keeps the proportions of an actual
       page rather than of whichever file happened to load first. */
    pages.forEach(function (src) {
      if (VIDEO_RE.test(src)) return;
      var im = new Image();
      im.onload = function () {
        if (!book) return;
        book.seen[src] = im.naturalWidth / im.naturalHeight;
        var vals = [];
        for (var k in book.seen) { if (book.seen.hasOwnProperty(k)) vals.push(book.seen[k]); }
        vals.sort(function (a, b) { return a - b; });
        var med = vals[Math.floor(vals.length / 2)];
        if (med && Math.abs(med - book.aspect) > 0.01) {
          book.aspect = med;
          layoutBook();
        }
      };
      im.src = src;
    });

    layoutBook();
    showSpread(0);
  }

  /* Each page needs a definite pixel size: the leaf rotates about its own
     spine edge, and a percentage-sized box would collapse mid-turn. The book
     is two pages wide, so it is the pair that has to fit the stage. */
  function layoutBook() {
    if (!book) return;
    var availW = stage.clientWidth;
    var availH = stage.clientHeight;
    if (!availW || !availH) return;

    var h = availH;
    var w = h * book.aspect;
    if (w * 2 > availW) { w = availW / 2; h = w / book.aspect; }

    book.w = w;
    book.h = h;
    book.inner.style.width = (w * 2) + 'px';
    book.inner.style.height = h + 'px';

    [book.leftPage, book.rightPage, book.leaf].forEach(function (el) {
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    });
    book.leftPage.style.left = '0px';
    book.rightPage.style.left = w + 'px';
    book.leaf.style.left = w + 'px';       // hinged on the spine, opening right

    book.inner.style.transform = 'translateX(' + offsetFor(book.spread) + 'px)';
  }

  /* A spread with only one page would otherwise sit off to one side, so the
     book slides over by half a page until both leaves are in play. */
  function offsetFor(s) {
    if (!book) return 0;
    var hasL = !!pageAt(2 * s - 1);
    var hasR = !!pageAt(2 * s);
    if (hasL === hasR) return 0;
    return hasR ? -book.w / 2 : book.w / 2;
  }

  function paintPage(el, img, src) {
    if (src) {
      if (img.getAttribute('src') !== src) {
        img.src = src;
        img.alt = altFor(src);
      }
      el.hidden = false;
    } else {
      el.hidden = true;      // a blank side: the inside of a cover
    }
  }

  function label(s) {
    var n = book.pages.length;
    var l = 2 * s - 1, r = 2 * s;
    var nums = [];
    if (pageAt(l)) nums.push(l + 1);
    if (pageAt(r)) nums.push(r + 1);
    return nums.join('–') + ' / ' + n;
  }

  function showSpread(s) {
    book.spread = s;
    paintPage(book.leftPage, book.leftImg, pageAt(2 * s - 1));
    paintPage(book.rightPage, book.rightImg, pageAt(2 * s));
    book.inner.style.transform = 'translateX(' + offsetFor(s) + 'px)';
    counter.textContent = label(s);

    preload(pageAt(2 * s + 1));
    preload(pageAt(2 * s + 2));
    preload(pageAt(2 * s - 2));
  }

  /* The silhouette of a leaf mid-turn. Two things happen to it at once:

       • the top edge bows, flat at the spine and deepest toward the free edge
         — the shape paper takes when it is lifted
       • the free top corner folds inward, eaten back by a concave sweep, the
         way the corner actually under your thumb rolls over on itself

     `mirrored` reverses the whole shape, since rotateY flips a face's local x
     axis and the reverse of the leaf is hinged on its other side. */
  function curl(w, h, bow, fold, mirrored) {
    if (bow <= 0.2 && fold <= 0.4) return 'none';
    var X = function (x) { return (mirrored ? w - x : x).toFixed(2); };
    var Y = function (y) { return y.toFixed(2); };
    var f = Math.max(fold, 0);

    /* Real paper doesn't just have its corner cut away — it rolls under, so
       the silhouette dips inward past the edge before returning to it. The
       first Q sweeps the top edge down to the start of the roll; the second
       curls in past the free edge and back out to it, which is what reads as
       the corner curling under rather than a corner simply missing. */
    return 'path("M' + X(0) + ' 0' +
           ' Q' + X(w * 0.55) + ' ' + Y(bow * 1.5) +
              ' ' + X(w - f * 1.9) + ' ' + Y(bow * 0.5 + f * 0.22) +
           ' Q' + X(w - f * 1.15) + ' ' + Y(f * 0.62) +
              ' ' + X(w - f * 0.55) + ' ' + Y(f * 1.05) +
           ' Q' + X(w - f * 0.18) + ' ' + Y(f * 1.32) +
              ' ' + X(w) + ' ' + Y(f * 1.18) +
           ' L' + X(w) + ' ' + Y(h) +
           ' L' + X(0) + ' ' + Y(h) + ' Z")';
  }

  /* progress 0 -> 1 runs the leaf from lying on the right to lying on the
     left. Backward turns play the same arc in reverse. */
  function paintTurn(progress, dir) {
    var w = book.w, h = book.h;
    var p = dir > 0 ? progress : 1 - progress;
    book.leaf.style.transform = 'rotateY(' + (-180 * p) + 'deg)';

    /* The book slides back to centre in step with the leaf. This rides the
       same loop rather than a CSS transition, so it always lands on its end
       value — a transition interrupted by the next turn leaves an animation
       stuck holding the old offset, and the spread never re-centres. */
    var shift = book.shiftFrom + (book.shiftTo - book.shiftFrom) * progress;
    book.inner.style.transform = 'translateX(' + shift.toFixed(2) + 'px)';

    var lift = Math.sin(progress * Math.PI);
    var bow = lift * MAX_BOW * h;
    // The corner rolls hardest while the leaf is upright and squares off as it
    // lands, so a resting page is never anything but a rectangle.
    var foldT = lift * lift;
    var fold = foldT * MAX_FOLD * h;
    book.front.style.clipPath = curl(w, h, bow, fold, false);
    book.back.style.clipPath = curl(w, h, bow, fold, true);

    /* Past edge-on the viewer is looking at the leaf's reverse; before it, at
       the face still turning away. Each darkens as it leaves the light. */
    var mag = 180 * p;
    var past = mag > 90;
    book.frontShade.style.opacity = past ? 0 : (mag / 90) * 0.85;
    book.backShade.style.opacity = past ? (1 - (mag - 90) / 90) * 0.7 : 0;

    /* A patch of light at the corner that's rolling under — what actually
       sells paper rather than a cut-out shape. It sits over the top-right
       corner on the front face (the free corner, non-mirrored) and the
       top-left on the back (mirrored), grows with the fold, and fades out
       once the corner has squared back off. */
    var curlSize = (24 + foldT * 30).toFixed(1) + '%';
    var curlOp = (foldT * 0.55).toFixed(2);
    book.frontCurl.style.setProperty('--curl-size', curlSize);
    book.frontCurl.style.opacity = curlOp;
    book.backCurl.style.setProperty('--curl-size', curlSize);
    book.backCurl.style.opacity = curlOp;
  }

  function flip(dir) {
    if (!book || book.turning || book.spreads < 2) return;

    var s = book.spread;
    var to = ((s + dir) % book.spreads + book.spreads) % book.spreads;

    /* Forward, the leaf is the right-hand page: its reverse is the next page,
       which lands on the left, and the page after that is uncovered beneath
       it. Backward is the same leaf travelling the other way. */
    var frontSrc, backSrc;
    if (dir > 0) {
      frontSrc = pageAt(2 * s);            // lifts off the right
      backSrc  = pageAt(2 * to - 1);       // comes to rest on the left
      paintPage(book.rightPage, book.rightImg, pageAt(2 * to));   // revealed
    } else {
      frontSrc = pageAt(2 * to);           // comes to rest on the right
      backSrc  = pageAt(2 * s - 1);        // lifts off the left
      paintPage(book.leftPage, book.leftImg, pageAt(2 * to - 1)); // revealed
    }

    // Nothing to turn at the wrap between the last spread and the first.
    if (!frontSrc && !backSrc) { showSpread(to); return; }

    book.turning = true;
    paintPage(book.front, book.frontImg, frontSrc);
    paintPage(book.back, book.backImg, backSrc);
    book.frontImg.alt = '';
    book.backImg.alt = '';

    // The book re-centres as it opens or closes, in step with the turn.
    book.shiftFrom = offsetFor(s);
    book.shiftTo = offsetFor(to);

    book.leaf.hidden = false;
    paintTurn(0, dir);

    var done = false;
    function settle() {
      if (done || !book) return;
      done = true;
      window.clearTimeout(guard);
      book.leaf.hidden = true;
      book.leaf.style.transform = '';
      book.front.style.clipPath = 'none';
      book.back.style.clipPath = 'none';
      book.turning = false;
      showSpread(to);
    }

    var start = null;
    function frame(now) {
      if (done || !book) return;
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / TURN_MS);
      paintTurn(easeInOut(t), dir);
      if (t < 1) requestAnimationFrame(frame); else settle();
    }
    requestAnimationFrame(frame);

    /* rAF is suspended entirely while the tab is in the background, so a turn
       started there would never finish: the leaf would stay mid-air, the
       counter would disagree with the pages on screen, and book.turning would
       latch on and block every later turn. Land the leaf regardless. */
    var guard = window.setTimeout(settle, TURN_MS + 400);
  }

  /* =============================================================
     open / close
     ============================================================= */
  function open(setName, src, view) {
    var list = (setName && groups[setName]) ? groups[setName].slice() : null;
    if (!list || !list.length) list = [src];

    var start = list.indexOf(src);
    if (start === -1) { list.unshift(src); start = 0; }

    items = list;
    index = start;

    /* The first entry of a set is its gallery cover. A zine's cover is a
       photograph of the printed thing, not a page of it, so the book is bound
       from the interior pages alone. */
    var pages = list.slice(1);
    mode = (view === 'book' && pages.length > 0) ? 'book' : 'slides';

    lastFocused = document.activeElement;
    box.hidden = false;
    box.classList.toggle('is-book', mode === 'book');
    document.documentElement.classList.add('is-lightbox-open');

    if (mode === 'book') buildBook(pages); else renderSlide();
    closeBtn.focus();
  }

  function close() {
    box.hidden = true;
    box.classList.remove('is-book');
    document.documentElement.classList.remove('is-lightbox-open');
    stage.innerHTML = '';       // also stops any playing video
    book = null;
    items = [];
    mode = 'slides';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function go(delta) {
    if (mode === 'book') { flip(delta); return; }
    if (items.length < 2) return;
    index = step(delta);
    renderSlide();
  }

  /* =============================================================
     wiring
     ============================================================= */

  /* Delegated, so it covers the duplicate cards js/main.js clones into each
     column for the seamless loop (clones carry the same data attributes). */
  gallery.addEventListener('click', function (e) {
    var card = e.target.closest ? e.target.closest('.gallery-card') : null;
    if (!card || !gallery.contains(card)) return;
    var media = card.querySelector('img, video');
    if (!media) return;
    e.preventDefault();
    open(card.dataset.group, media.getAttribute('src'), card.dataset.view);
  });

  prevBtn.addEventListener('click', function (e) { e.stopPropagation(); go(-1); });
  nextBtn.addEventListener('click', function (e) { e.stopPropagation(); go(1); });
  closeBtn.addEventListener('click', function (e) { e.stopPropagation(); close(); });

  box.addEventListener('click', function (e) {
    if (e.target === box || e.target === stage) close();
  });

  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });

  window.addEventListener('resize', function () {
    if (!box.hidden && mode === 'book') layoutBook();
  }, { passive: true });

  /* The parallax columns swallow wheel events to scroll themselves; while the
     viewer is open that would scroll the gallery behind the overlay. */
  box.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
})();
